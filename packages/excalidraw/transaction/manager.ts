import { randomId } from "@excalidraw/common";
import {
  DEFAULT_TRANSACTION_MERGE_POLICY,
  TransactionLedger,
  collectChangedElementIds,
} from "@excalidraw/element";
import { deepCopyElement } from "@excalidraw/element";

import type { TransactionMergePolicy } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { AppClassProperties } from "../types";
import type {
  TransactionAppStateSnapshot,
  TransactionMutationResult,
  TransactionStatus,
  TransactionSummary,
} from "./types";

type ApplyOptions<T> = {
  isApplied?: (value: T, changedElementIds: readonly string[]) => boolean;
  reasonWhenSkipped?: (value: T) => string | undefined;
};

type TransactionFinalState = "finalized" | "canceled";

/** Takes a point-in-time deep snapshot so later mutation diffing stays stable. */
const snapshotSceneElementsById = (app: AppClassProperties) => {
  const snapshot = new Map<string, ExcalidrawElement>();
  for (const element of app.scene.getElementsIncludingDeleted()) {
    snapshot.set(element.id, deepCopyElement(element));
  }
  return snapshot;
};

/** App-level transaction session that records mutations and commits one synthetic history entry. */
export class TransactionSession {
  public readonly id = `tx-${randomId()}`;

  private readonly app: AppClassProperties;
  private readonly mergePolicy: TransactionMergePolicy;
  private readonly ledger = new TransactionLedger();
  private readonly touchedElementIds = new Set<string>();

  private appStateSnapshot: TransactionAppStateSnapshot | null = null;
  private appliedMutations = 0;
  private historyCommitted = false;
  private statusValue: TransactionStatus = "active";
  private cachedSummary: TransactionSummary | null = null;

  constructor(
    app: AppClassProperties,
    mergePolicy?: Partial<TransactionMergePolicy>,
  ) {
    this.app = app;
    this.mergePolicy = {
      ...DEFAULT_TRANSACTION_MERGE_POLICY,
      ...mergePolicy,
    };
  }

  get status() {
    return this.statusValue;
  }

  /** Returns a standardized skipped result once the session is no longer active. */
  private rejectIfInactive<T>(): TransactionMutationResult<T> | null {
    if (this.statusValue === "active") {
      return null;
    }
    return {
      applied: false,
      changedElementIds: [],
      reason: `Transaction already ${this.statusValue}.`,
    };
  }

  /** Computes changed element ids between two snapshots. */
  private getChangedElementIds(
    before: ReadonlyMap<string, ExcalidrawElement>,
    after: ReadonlyMap<string, ExcalidrawElement>,
  ) {
    return collectChangedElementIds(before, after);
  }

  /** Persists one mutation into ledger state and session-level counters. */
  private recordMutation(
    before: ReadonlyMap<string, ExcalidrawElement>,
    after: ReadonlyMap<string, ExcalidrawElement>,
    changedElementIds: readonly string[],
    applied: boolean,
  ) {
    if (applied) {
      for (const changedId of changedElementIds) {
        this.touchedElementIds.add(changedId);
      }
      this.ledger.recordStep(before, after);
      this.appliedMutations += 1;
    }
  }

  /** Executes one mutation function and records the resulting scene diff. */
  async apply<T>(
    mutate: () => T | Promise<T>,
    options?: ApplyOptions<T>,
  ): Promise<TransactionMutationResult<T>> {
    const inactiveResult = this.rejectIfInactive<T>();
    if (inactiveResult) {
      return inactiveResult;
    }

    const before = snapshotSceneElementsById(this.app);
    const value = await mutate();
    const after = this.app.scene.getElementsMapIncludingDeleted();
    const changedElementIds = this.getChangedElementIds(before, after);
    const applied = options?.isApplied
      ? options.isApplied(value, changedElementIds)
      : changedElementIds.length > 0;

    this.recordMutation(before, after, changedElementIds, applied);

    return {
      value,
      applied,
      changedElementIds,
      reason: !applied ? options?.reasonWhenSkipped?.(value) : undefined,
    };
  }

  /** Records a caller-provided before/after snapshot pair into the session ledger. */
  capture(
    before: ReadonlyMap<string, ExcalidrawElement>,
    after: ReadonlyMap<string, ExcalidrawElement>,
  ): TransactionMutationResult<void> {
    const inactiveResult = this.rejectIfInactive<void>();
    if (inactiveResult) {
      return inactiveResult;
    }

    const changedElementIds = this.getChangedElementIds(before, after);
    this.recordMutation(
      before,
      after,
      changedElementIds,
      changedElementIds.length > 0,
    );

    return {
      applied: changedElementIds.length > 0,
      changedElementIds,
    };
  }

  /** Stores optional observed appState before/after for synthetic history commit. */
  setAppStatePatch(snapshot: TransactionAppStateSnapshot | null) {
    this.appStateSnapshot = snapshot;
  }

  /** Finalizes once and memoizes the resulting summary for idempotent calls. */
  private complete(state: TransactionFinalState): TransactionSummary {
    if (this.cachedSummary) {
      return this.cachedSummary;
    }

    if (this.ledger.hasEntries()) {
      const liveMap = this.app.scene.getElementsMapIncludingDeleted();
      const { logicalBefore, logicalAfter } =
        this.ledger.buildSyntheticSnapshots(liveMap, this.mergePolicy);
      this.historyCommitted = this.app.commitSyntheticHistoryEntry({
        logicalBefore,
        logicalAfter,
        appStateBefore: this.appStateSnapshot?.before,
        appStateAfter: this.appStateSnapshot?.after,
      });
    }

    this.statusValue = state;
    this.cachedSummary = {
      id: this.id,
      state,
      appliedMutations: this.appliedMutations,
      touchedElementIds: [...this.touchedElementIds],
      historyCommitted: this.historyCommitted,
    };
    return this.cachedSummary;
  }

  /** Commits the session and returns a stable summary on repeated calls. */
  commit() {
    if (this.statusValue === "active") {
      return this.complete("finalized");
    }
    return this.complete(this.statusValue);
  }

  /** Cancels the session while preserving already-applied visual mutations. */
  cancel() {
    if (this.statusValue === "active") {
      return this.complete("canceled");
    }
    return this.complete(this.statusValue);
  }
}

/** Factory/executor facade used by app features to open and run transaction sessions. */
export class TransactionManager {
  private readonly app: AppClassProperties;

  constructor(app: AppClassProperties) {
    this.app = app;
  }

  /** Opens a new transaction session with optional merge-policy overrides. */
  open(input?: { mergePolicy?: Partial<TransactionMergePolicy> }) {
    return new TransactionSession(this.app, input?.mergePolicy);
  }

  /** Runs work inside one session and always attempts cleanup on failure. */
  async run<TResult>(
    work: (session: TransactionSession) => TResult | Promise<TResult>,
    input?: { mergePolicy?: Partial<TransactionMergePolicy> },
  ) {
    const session = this.open(input);
    try {
      const result = await work(session);
      const summary = session.commit();
      return { result, summary };
    } catch (error) {
      // Preserve the original work() failure even if cancel path fails.
      try {
        session.cancel();
      } catch (cancelError) {
        console.error("Failed to cancel transaction after run() failure.", {
          error,
          cancelError,
        });
      }
      throw error;
    }
  }
}
