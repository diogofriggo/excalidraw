import type { ExcalidrawElement } from "../types";

/** Which side wins when transaction output and live scene diverge. */
export type ConflictWinner = "live" | "transaction";

/** Conflict granularity used by the merge policy. */
export type ConflictScope = "prop" | "element";

/** Merge policy used when building synthetic before/after snapshots. */
export type TransactionMergePolicy = {
  conflictWinner: ConflictWinner;
  conflictScope: ConflictScope;
};

export const DEFAULT_TRANSACTION_MERGE_POLICY: TransactionMergePolicy = {
  conflictWinner: "live",
  conflictScope: "prop",
};

/** Per-element ledger record captured during a transaction session. */
export type TransactionLedgerEntry = {
  baselineElement: ExcalidrawElement | null;
  targetElement: ExcalidrawElement | null;
  touchedProps: Set<string>;
};
