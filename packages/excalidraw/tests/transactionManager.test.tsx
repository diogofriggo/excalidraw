import React from "react";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

import type { ObservedAppState } from "../types";
import type { TransactionSummary } from "../transaction/types";

const { h } = window;

const getElement = (id: string) =>
  h.app.scene.getNonDeletedElementsMap().get(id) ?? null;

const applyElementUpdate = (
  id: string,
  updates: Partial<ExcalidrawElement>,
  captureUpdate: keyof typeof CaptureUpdateAction,
) => {
  const nextElements = h.app.scene
    .getElementsIncludingDeleted()
    .map((element) =>
      element.id === id
        ? (newElementWith(element as any, updates as any) as ExcalidrawElement)
        : element,
    );

  API.updateScene({
    elements: nextElements,
    captureUpdate: CaptureUpdateAction[captureUpdate],
  });
};

const setSceneBaseline = (elements: readonly ExcalidrawElement[]) => {
  API.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

const appendElement = (
  element: ExcalidrawElement,
  captureUpdate: keyof typeof CaptureUpdateAction,
) => {
  const nextElements = [...h.app.scene.getElementsIncludingDeleted(), element];

  API.updateScene({
    elements: nextElements,
    captureUpdate: CaptureUpdateAction[captureUpdate],
  });
};

const commitSession = (session: { commit: () => TransactionSummary }) => {
  let summary!: TransactionSummary;
  act(() => {
    summary = session.commit();
  });
  return summary;
};

describe("TransactionManager", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.restoreAllMocks();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("run() commits on success and returns summary", async () => {
    const element = API.createElement({
      type: "rectangle",
      id: "rect-1",
    });
    setSceneBaseline([element]);

    const commitSyntheticHistoryEntry = vi
      .spyOn(h.app, "commitSyntheticHistoryEntry")
      .mockReturnValue(true);

    const { result, summary } = await h.app.transactionManager.run(
      async (tx) => {
        return tx.apply(async () => {
          const current = h.app.scene
            .getElementsMapIncludingDeleted()
            .get(element.id)!;
          API.updateElement(current, {
            strokeColor: "#ff006e",
          });
          return "updated";
        });
      },
    );

    expect(result.applied).toBe(true);
    expect(result.value).toBe("updated");
    expect(summary.state).toBe("finalized");
    expect(summary.appliedMutations).toBe(1);
    expect(summary.touchedElementIds).toEqual([element.id]);
    expect(summary.historyCommitted).toBe(true);
    expect(commitSyntheticHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it("run() preserves original error when cancel path fails", async () => {
    const originalError = new Error("work failed");
    const cancelError = new Error("cancel failed");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const session = h.app.transactionManager.open();

    vi.spyOn(session, "cancel").mockImplementation(() => {
      throw cancelError;
    });
    vi.spyOn(h.app.transactionManager, "open").mockReturnValue(session);

    await expect(
      h.app.transactionManager.run(async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("commit() is idempotent and does not commit history when there are no entries", () => {
    const commitSyntheticHistoryEntry = vi.spyOn(
      h.app,
      "commitSyntheticHistoryEntry",
    );
    const session = h.app.transactionManager.open();

    const first = session.commit();
    const second = session.commit();

    expect(second).toBe(first);
    expect(first.state).toBe("finalized");
    expect(first.historyCommitted).toBe(false);
    expect(commitSyntheticHistoryEntry).not.toHaveBeenCalled();
  });

  it("forwards appState patch to commitSyntheticHistoryEntry()", async () => {
    const element = API.createElement({
      type: "rectangle",
      id: "rect-1",
    });
    setSceneBaseline([element]);

    const commitSyntheticHistoryEntry = vi
      .spyOn(h.app, "commitSyntheticHistoryEntry")
      .mockReturnValue(true);

    const session = h.app.transactionManager.open();

    await session.apply(async () => {
      const current = h.app.scene
        .getElementsMapIncludingDeleted()
        .get(element.id)!;
      API.updateElement(current, {
        backgroundColor: "#ffbe0b",
      });
    });

    const appStatePatch: {
      before: Partial<ObservedAppState>;
      after: Partial<ObservedAppState>;
    } = {
      before: { selectedElementIds: {} },
      after: { selectedElementIds: { [element.id]: true } },
    };
    session.setAppStatePatch(appStatePatch);

    act(() => {
      session.commit();
    });

    expect(commitSyntheticHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        appStateBefore: appStatePatch.before,
        appStateAfter: appStatePatch.after,
      }),
    );
  });

  it("returns inactive reason for capture/apply after cancel()", async () => {
    const session = h.app.transactionManager.open();

    session.cancel();

    const captureResult = session.capture(new Map(), new Map());
    const applyResult = await session.apply(async () => undefined);

    expect(captureResult.applied).toBe(false);
    expect(captureResult.reason).toContain("canceled");
    expect(applyResult.applied).toBe(false);
    expect(applyResult.reason).toContain("canceled");
  });

  it("keeps interleaved user edits and transaction history entries separated", async () => {
    const transactionElement = API.createElement({
      type: "rectangle",
      id: "tx-rect",
      x: 0,
      y: 0,
      strokeColor: "#1e1e1e",
      opacity: 100,
    });
    const userElement = API.createElement({
      type: "rectangle",
      id: "user-rect",
      x: 300,
      y: 0,
      backgroundColor: "#ffe8cc",
    });

    setSceneBaseline([transactionElement, userElement]);
    expect(API.getUndoStack().length).toBe(0);

    const session = h.app.transactionManager.open();

    await session.apply(async () => {
      applyElementUpdate(
        transactionElement.id,
        { x: 180, strokeColor: "#ff006e" },
        "NEVER",
      );
    });

    applyElementUpdate(
      userElement.id,
      { backgroundColor: "#00f5d4" },
      "IMMEDIATELY",
    );

    await session.apply(async () => {
      applyElementUpdate(transactionElement.id, { opacity: 60 }, "NEVER");
    });

    applyElementUpdate(userElement.id, { y: 220 }, "IMMEDIATELY");

    expect(API.getUndoStack().length).toBe(2);
    const summary = commitSession(session);
    expect(summary.historyCommitted).toBe(true);

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(3);
    });

    let liveTxElement = getElement(transactionElement.id)!;
    let liveUserElement = getElement(userElement.id)!;
    expect(liveTxElement.x).toBe(180);
    expect(liveTxElement.strokeColor).toBe("#ff006e");
    expect(liveTxElement.opacity).toBe(60);
    expect(liveUserElement.backgroundColor).toBe("#00f5d4");
    expect(liveUserElement.y).toBe(220);

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      liveTxElement = getElement(transactionElement.id)!;
      expect(liveTxElement.x).toBe(transactionElement.x);
      expect(liveTxElement.strokeColor).toBe(transactionElement.strokeColor);
      expect(liveTxElement.opacity).toBe(transactionElement.opacity);
    });
    liveUserElement = getElement(userElement.id)!;
    expect(liveUserElement.backgroundColor).toBe("#00f5d4");
    expect(liveUserElement.y).toBe(220);

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      liveUserElement = getElement(userElement.id)!;
      expect(liveUserElement.y).toBe(userElement.y);
      expect(liveUserElement.backgroundColor).toBe("#00f5d4");
    });

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      liveUserElement = getElement(userElement.id)!;
      expect(liveUserElement.backgroundColor).toBe(userElement.backgroundColor);
      expect(liveUserElement.y).toBe(userElement.y);
    });
  });

  it("undoes transaction-created elements without rolling back user history entries", async () => {
    const base = API.createElement({
      type: "rectangle",
      id: "base",
      x: 0,
      y: 0,
    });
    const txCreated = API.createElement({
      type: "ellipse",
      id: "tx-created",
      x: 420,
      y: 100,
      backgroundColor: "#b197fc",
    });

    setSceneBaseline([base]);
    expect(getElement(txCreated.id)).toBeNull();

    const session = h.app.transactionManager.open();

    await session.apply(async () => {
      appendElement(txCreated, "NEVER");
    });

    applyElementUpdate(base.id, { x: 120 }, "IMMEDIATELY");
    expect(API.getUndoStack().length).toBe(1);
    const summary = commitSession(session);
    expect(summary.historyCommitted).toBe(true);

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(2);
    });
    expect(getElement(txCreated.id)).not.toBeNull();

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      expect(getElement(txCreated.id)).toBeNull();
      expect(getElement(base.id)?.x).toBe(120);
    });

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      expect(getElement(base.id)?.x).toBe(base.x);
    });
  });

  it("keeps same-element user edits separated from transaction rollback", async () => {
    const element = API.createElement({
      type: "rectangle",
      id: "shared",
      x: 0,
      y: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffe8cc",
    });

    setSceneBaseline([element]);
    expect(API.getUndoStack().length).toBe(0);

    const session = h.app.transactionManager.open();

    await session.apply(async () => {
      applyElementUpdate(
        element.id,
        { strokeColor: "#ff006e", x: 200 },
        "NEVER",
      );
    });

    applyElementUpdate(
      element.id,
      { backgroundColor: "#00f5d4" },
      "IMMEDIATELY",
    );
    const summary = commitSession(session);
    expect(summary.historyCommitted).toBe(true);

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(2);
    });

    let live = getElement(element.id)!;
    expect(live.strokeColor).toBe("#ff006e");
    expect(live.x).toBe(200);
    expect(live.backgroundColor).toBe("#00f5d4");

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      live = getElement(element.id)!;
      expect(live.strokeColor).toBe(element.strokeColor);
      expect(live.x).toBe(element.x);
      expect(live.backgroundColor).toBe("#00f5d4");
    });

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => {
      live = getElement(element.id)!;
      expect(live.backgroundColor).toBe(element.backgroundColor);
      expect(live.strokeColor).toBe(element.strokeColor);
      expect(live.x).toBe(element.x);
    });
  });
});
