import { arrayToMap } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  DEFAULT_TRANSACTION_MERGE_POLICY,
  TransactionLedger,
  collectChangedElementIds,
} from "../src";

import type { ExcalidrawElement } from "../src/types";

describe("TransactionLedger", () => {
  it("ignores metadata-only changes when collecting changed ids", () => {
    const before = API.createElement({
      type: "rectangle",
      id: "rect-1",
    });
    const after = {
      ...before,
      version: before.version + 1,
      versionNonce: before.versionNonce + 1,
      seed: before.seed + 1,
      updated: before.updated + 1,
      index: "a2" as ExcalidrawElement["index"],
    };

    expect(
      collectChangedElementIds(arrayToMap([before]), arrayToMap([after])),
    ).toEqual([]);
  });

  it("drops ledger entry when element is created and deleted in one transaction", () => {
    const ledger = new TransactionLedger();
    const created = API.createElement({
      type: "rectangle",
      id: "rect-1",
    });

    ledger.recordStep(new Map(), arrayToMap([created]));
    expect(ledger.hasEntries()).toBe(true);

    ledger.recordStep(arrayToMap([created]), new Map());
    expect(ledger.hasEntries()).toBe(false);
  });

  it("materializes create operation when live scene still matches target", () => {
    const ledger = new TransactionLedger();
    const created = API.createElement({
      type: "rectangle",
      id: "rect-1",
      strokeColor: "#ff006e",
    });

    ledger.recordStep(new Map(), arrayToMap([created]));

    const { logicalBefore, logicalAfter } = ledger.buildSyntheticSnapshots(
      arrayToMap([created]),
      DEFAULT_TRANSACTION_MERGE_POLICY,
    );

    expect(logicalBefore.has(created.id)).toBe(false);
    expect(logicalAfter.get(created.id)?.strokeColor).toBe("#ff006e");
  });

  it("skips conflicting update when policy is live-wins", () => {
    const ledger = new TransactionLedger();
    const baseline = API.createElement({
      type: "rectangle",
      id: "rect-1",
      strokeColor: "#000000",
    });
    const target = {
      ...baseline,
      strokeColor: "#ff006e",
      version: baseline.version + 1,
    };
    const live = {
      ...target,
      strokeColor: "#3a86ff",
      version: target.version + 1,
    };

    ledger.recordStep(arrayToMap([baseline]), arrayToMap([target]));

    const { logicalBefore, logicalAfter } = ledger.buildSyntheticSnapshots(
      arrayToMap([live]),
      DEFAULT_TRANSACTION_MERGE_POLICY,
    );

    expect(logicalBefore.get(live.id)?.strokeColor).toBe("#3a86ff");
    expect(logicalAfter.get(live.id)?.strokeColor).toBe("#3a86ff");
  });

  it("applies conflicting update when policy is transaction-wins", () => {
    const ledger = new TransactionLedger();
    const baseline = API.createElement({
      type: "rectangle",
      id: "rect-1",
      strokeColor: "#000000",
    });
    const target = {
      ...baseline,
      strokeColor: "#ff006e",
      version: baseline.version + 1,
    };
    const live = {
      ...target,
      strokeColor: "#3a86ff",
      version: target.version + 1,
    };

    ledger.recordStep(arrayToMap([baseline]), arrayToMap([target]));

    const { logicalBefore, logicalAfter } = ledger.buildSyntheticSnapshots(
      arrayToMap([live]),
      {
        ...DEFAULT_TRANSACTION_MERGE_POLICY,
        conflictWinner: "transaction",
      },
    );

    expect(logicalBefore.get(live.id)?.strokeColor).toBe("#000000");
    expect(logicalAfter.get(live.id)?.strokeColor).toBe("#ff006e");
  });
});
