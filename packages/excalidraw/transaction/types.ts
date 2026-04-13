import type { ObservedAppState } from "../types";

/** Lifecycle state of a transaction session. */
export type TransactionStatus = "active" | "finalized" | "canceled";

/** Optional appState patch to include in synthetic history before/after snapshots. */
export type TransactionAppStateSnapshot = {
  before: Partial<ObservedAppState>;
  after: Partial<ObservedAppState>;
};

/** Result returned by one recorded mutation attempt inside a transaction. */
export type TransactionMutationResult<T> = {
  value?: T;
  applied: boolean;
  changedElementIds: readonly string[];
  reason?: string;
};

/** Final summary returned when a transaction is committed or canceled. */
export type TransactionSummary = {
  id: string;
  state: "finalized" | "canceled";
  appliedMutations: number;
  touchedElementIds: readonly string[];
  historyCommitted: boolean;
};
