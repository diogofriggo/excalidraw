/**
 * Transaction-scoped mutation ledger:
 * - records net scene mutations across streamed steps
 * - reconstructs synthetic logical before/after snapshots
 * - feeds a single durable history entry at transaction end
 */
import type { Mutable } from "@excalidraw/common/utility-types";

import { deepCopyElement } from "../duplicate";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
  SceneElementsMap,
} from "../types";
import type { TransactionLedgerEntry, TransactionMergePolicy } from "./types";

const LEDGER_IGNORED_PROPS = new Set([
  "version",
  "versionNonce",
  "seed",
  "updated",
  "index",
]);

type ElementRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const getElementProp = (element: ExcalidrawElement, prop: string): unknown =>
  (element as ElementRecord)[prop];

const setOrderedElementProp = (
  element: Mutable<OrderedExcalidrawElement>,
  prop: string,
  value: unknown,
) => {
  (element as ElementRecord)[prop] = value;
};

/** Deep equality used by ledger conflict/touched-prop detection. */
const isLedgerValueEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!isLedgerValueEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false;
      }
      if (!isLedgerValueEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
};

/** Clones a scene map so synthetic before/after edits never mutate live elements. */
const cloneSceneElementsMap = (
  elements: ReadonlyMap<string, ExcalidrawElement>,
): SceneElementsMap =>
  new Map(
    [...elements.entries()].map(([id, element]) => [
      id,
      deepCopyElement(element) as OrderedExcalidrawElement,
    ]),
  ) as SceneElementsMap;

/** Returns changed property names between two element snapshots. */
const collectTouchedProps = (
  before: ExcalidrawElement | null,
  after: ExcalidrawElement | null,
) => {
  if (!before || !after) {
    return new Set<string>(["*"]);
  }

  const touchedProps = new Set<string>();
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (LEDGER_IGNORED_PROPS.has(key)) {
      continue;
    }
    if (
      !isLedgerValueEqual(getElementProp(before, key), getElementProp(after, key))
    ) {
      touchedProps.add(key);
    }
  }

  return touchedProps;
};

/** Returns ids whose element snapshot changed between two points in time. */
export const collectChangedElementIds = (
  before: ReadonlyMap<string, ExcalidrawElement>,
  after: ReadonlyMap<string, ExcalidrawElement>,
) => {
  const changedIds = new Set<string>();
  const candidateIds = new Set<string>([...before.keys(), ...after.keys()]);

  for (const id of candidateIds) {
    const beforeElement = before.get(id) ?? null;
    const afterElement = after.get(id) ?? null;
    if (collectTouchedProps(beforeElement, afterElement).size > 0) {
      changedIds.add(id);
    }
  }

  return [...changedIds];
};

/** Determines whether live conflicts should skip the whole updated element. */
const shouldSkipUpdateElementOnLiveConflict = (
  entry: TransactionLedgerEntry,
  liveElement: ExcalidrawElement,
  policy: TransactionMergePolicy,
) => {
  if (policy.conflictWinner === "transaction") {
    return false;
  }
  if (entry.touchedProps.has("*")) {
    return true;
  }
  return policy.conflictScope === "element";
};

/**
 * Keeps transaction-level scene mutations and materializes synthetic snapshots
 * for a single durable history commit.
 */
export class TransactionLedger {
  private readonly entries = new Map<string, TransactionLedgerEntry>();

  /** Whether the transaction has any net mutations to commit. */
  hasEntries() {
    return this.entries.size > 0;
  }

  /** Records one mutation step into a net per-element ledger entry. */
  recordStep(
    before: ReadonlyMap<string, ExcalidrawElement>,
    after: ReadonlyMap<string, ExcalidrawElement>,
  ) {
    for (const elementId of collectChangedElementIds(before, after)) {
      const beforeElement = before.get(elementId) ?? null;
      const afterElement = after.get(elementId) ?? null;
      const touchedProps = collectTouchedProps(beforeElement, afterElement);

      if (touchedProps.size === 0) {
        continue;
      }

      const existing = this.entries.get(elementId);
      if (!existing) {
        this.entries.set(elementId, {
          baselineElement: beforeElement
            ? deepCopyElement(beforeElement)
            : null,
          targetElement: afterElement ? deepCopyElement(afterElement) : null,
          touchedProps,
        });
        continue;
      }

      existing.targetElement = afterElement
        ? deepCopyElement(afterElement)
        : null;
      if (existing.touchedProps.has("*") || touchedProps.has("*")) {
        existing.touchedProps = new Set(["*"]);
      } else {
        for (const prop of touchedProps) {
          existing.touchedProps.add(prop);
        }
      }

      // Created then deleted inside one transaction leaves no durable footprint.
      if (!existing.baselineElement && !existing.targetElement) {
        this.entries.delete(elementId);
        continue;
      }
      if (!existing.baselineElement && existing.targetElement?.isDeleted) {
        this.entries.delete(elementId);
      }
    }
  }

  /**
   * Builds logical before/after snapshots by reconciling transaction targets
   * with current live scene state under the selected merge policy.
   */
  buildSyntheticSnapshots(
    live: ReadonlyMap<string, ExcalidrawElement>,
    mergePolicy: TransactionMergePolicy,
  ) {
    const logicalBefore = cloneSceneElementsMap(live);
    const logicalAfter = cloneSceneElementsMap(live);

    for (const [elementId, entry] of this.entries) {
      if (!entry.baselineElement) {
        const liveElement = live.get(elementId) ?? null;
        const targetElement = entry.targetElement;
        if (!targetElement) {
          continue;
        }
        if (
          mergePolicy.conflictWinner === "live" &&
          (!liveElement ||
            liveElement.isDeleted ||
            collectTouchedProps(targetElement, liveElement).size > 0)
        ) {
          continue;
        }
        logicalBefore.delete(elementId);
        logicalAfter.set(
          elementId,
          deepCopyElement(targetElement) as OrderedExcalidrawElement,
        );
        continue;
      }

      if (!entry.targetElement) {
        const liveElement = live.get(elementId) ?? null;
        if (
          mergePolicy.conflictWinner === "live" &&
          liveElement &&
          !liveElement.isDeleted
        ) {
          continue;
        }
        logicalBefore.set(
          elementId,
          deepCopyElement(entry.baselineElement) as OrderedExcalidrawElement,
        );
        logicalAfter.delete(elementId);
        continue;
      }

      const liveElement = live.get(elementId) ?? null;
      const targetElement = entry.targetElement;
      const baselineElement = entry.baselineElement;
      const logicalBeforeElement = logicalBefore.get(elementId);
      const logicalAfterElement = logicalAfter.get(elementId);

      if (
        !liveElement ||
        !baselineElement ||
        !targetElement ||
        !logicalBeforeElement ||
        !logicalAfterElement
      ) {
        continue;
      }

      if (entry.touchedProps.has("*")) {
        const hasLiveConflict =
          collectTouchedProps(targetElement, liveElement).size > 0;
        if (mergePolicy.conflictWinner === "live" && hasLiveConflict) {
          continue;
        }
        logicalBefore.set(
          elementId,
          deepCopyElement(baselineElement) as OrderedExcalidrawElement,
        );
        logicalAfter.set(
          elementId,
          deepCopyElement(targetElement) as OrderedExcalidrawElement,
        );
        continue;
      }

      if (
        shouldSkipUpdateElementOnLiveConflict(entry, liveElement, mergePolicy)
      ) {
        let hasConflict = false;
        for (const prop of entry.touchedProps) {
          const liveValue = getElementProp(liveElement, prop);
          const targetValue = getElementProp(targetElement, prop);
          if (!isLedgerValueEqual(liveValue, targetValue)) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) {
          continue;
        }
      }

      const mutableBefore =
        logicalBeforeElement as Mutable<OrderedExcalidrawElement>;
      const mutableAfter =
        logicalAfterElement as Mutable<OrderedExcalidrawElement>;

      let appliedProps = 0;
      for (const prop of entry.touchedProps) {
        const liveValue = getElementProp(liveElement, prop);
        const targetValue = getElementProp(targetElement, prop);
        const hasConflict = !isLedgerValueEqual(liveValue, targetValue);
        if (mergePolicy.conflictWinner === "live" && hasConflict) {
          continue;
        }

        setOrderedElementProp(
          mutableBefore,
          prop,
          getElementProp(baselineElement, prop),
        );
        setOrderedElementProp(mutableAfter, prop, targetValue);
        appliedProps += 1;
      }

      if (appliedProps > 0) {
        mutableBefore.version = baselineElement.version;
        mutableBefore.versionNonce = baselineElement.versionNonce;
        mutableAfter.version = targetElement.version;
        mutableAfter.versionNonce = targetElement.versionNonce;
      }
    }

    return { logicalBefore, logicalAfter };
  }
}
