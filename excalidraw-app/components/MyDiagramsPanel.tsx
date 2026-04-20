import { CaptureUpdateAction, useExcalidrawAPI } from "@excalidraw/excalidraw";
import {
  DotsIcon,
  PlusIcon,
  TrashIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { restoreAppState, restoreElements } from "@excalidraw/excalidraw/data/restore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import {
  createDiagram,
  deleteDiagram,
  getActiveDiagramId,
  getDiagramData,
  listDiagrams,
  regenerateThumbnail,
  renameDiagram,
  saveDiagram,
  setActiveDiagramId,
  type DiagramMeta,
} from "../data/MyDiagrams";
import { LocalData } from "../data/LocalData";

import "./MyDiagramsPanel.scss";

const MY_DIAGRAMS_TAB = "my-diagrams";

const DiagramCard = ({
  meta,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  meta: DiagramMeta;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) => {
  const thumbUrl = meta.thumbnail;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  return (
    <div
      className={`my-diagrams-card ${active ? "is-active" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="my-diagrams-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt={meta.name} />
        ) : (
          <div className="my-diagrams-thumb-empty">empty</div>
        )}
      </div>
      <div className="my-diagrams-card-footer">
        <div className="my-diagrams-card-name" title={meta.name}>
          {meta.name}
        </div>
        <div className="my-diagrams-card-menu" ref={menuRef}>
          <button
            type="button"
            className="my-diagrams-icon-button"
            aria-label="Diagram menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {DotsIcon}
          </button>
          {menuOpen && (
            <div className="my-diagrams-menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRename();
                }}
              >
                <span className="my-diagrams-menu-icon">{pencilIcon}</span>
                Rename
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <span className="my-diagrams-menu-icon">{TrashIcon}</span>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const MyDiagramsPanel = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const uiAppState = useUIAppState();
  const [metas, setMetas] = useState<DiagramMeta[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    getActiveDiagramId(),
  );

  const refresh = useCallback(async () => {
    const next = await listDiagrams();
    setMetas(next);
    setActiveIdState(getActiveDiagramId());
  }, []);

  const isOpen =
    uiAppState.openSidebar?.name === "default" &&
    uiAppState.openSidebar?.tab === MY_DIAGRAMS_TAB;

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen, refresh]);

  const loadDiagramIntoScene = useCallback(
    async (id: string) => {
      if (!excalidrawAPI) {
        return;
      }
      LocalData.flushSave();
      const previousActive = getActiveDiagramId();
      if (previousActive && previousActive !== id) {
        await regenerateThumbnail(previousActive);
      }
      const data = await getDiagramData(id);
      setActiveDiagramId(id);
      setActiveIdState(id);
      if (!data) {
        excalidrawAPI.resetScene();
        excalidrawAPI.history.clear();
        return;
      }
      excalidrawAPI.updateScene({
        elements: restoreElements(data.elements, null, { repairBindings: true }),
        appState: restoreAppState(data.appState, null),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const fileList = Object.values(data.files || {}) as BinaryFileData[];
      if (fileList.length) {
        excalidrawAPI.addFiles(fileList);
      }
      excalidrawAPI.history.clear();
    },
    [excalidrawAPI],
  );

  const handleCreate = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    const name = window.prompt("New diagram name", "Untitled");
    if (name == null) {
      return;
    }
    const trimmed = name.trim() || "Untitled";
    LocalData.flushSave();
    const previousActive = getActiveDiagramId();
    if (previousActive) {
      await regenerateThumbnail(previousActive);
    }
    const meta = await createDiagram(trimmed);
    setActiveDiagramId(meta.id);
    setActiveIdState(meta.id);
    excalidrawAPI.resetScene();
    excalidrawAPI.history.clear();
    await refresh();
  }, [excalidrawAPI, refresh]);

  const handleRename = useCallback(
    async (meta: DiagramMeta) => {
      const name = window.prompt("Rename diagram", meta.name);
      if (name == null) {
        return;
      }
      const trimmed = name.trim();
      if (!trimmed || trimmed === meta.name) {
        return;
      }
      await renameDiagram(meta.id, trimmed);
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (meta: DiagramMeta) => {
      if (!window.confirm(`Delete "${meta.name}"? This cannot be undone.`)) {
        return;
      }
      await deleteDiagram(meta.id);
      if (getActiveDiagramId() === meta.id) {
        setActiveDiagramId(null);
        setActiveIdState(null);
        if (excalidrawAPI) {
          excalidrawAPI.resetScene();
          excalidrawAPI.history.clear();
        }
      }
      await refresh();
    },
    [excalidrawAPI, refresh],
  );

  const handleSaveSnapshot = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    const id = getActiveDiagramId();
    if (!id) {
      // No active diagram — create one and capture current scene
      const name = window.prompt("Save current scene as…", "Untitled");
      if (name == null) {
        return;
      }
      const meta = await createDiagram(name.trim() || "Untitled");
      setActiveDiagramId(meta.id);
      setActiveIdState(meta.id);
      await saveDiagram(meta.id, {
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });
    } else {
      await saveDiagram(id, {
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });
    }
    await refresh();
  }, [excalidrawAPI, refresh]);

  const sorted = useMemo(() => metas, [metas]);

  return (
    <div className="my-diagrams-panel">
      <div className="my-diagrams-toolbar">
        <button
          type="button"
          className="my-diagrams-new"
          onClick={handleCreate}
        >
          <span className="my-diagrams-menu-icon">{PlusIcon}</span>
          New diagram
        </button>
        <button
          type="button"
          className="my-diagrams-save"
          onClick={handleSaveSnapshot}
          title="Force-save thumbnail/snapshot for the active diagram"
        >
          Save snapshot
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="my-diagrams-empty">
          No diagrams yet. Click <strong>New diagram</strong> to start.
        </div>
      ) : (
        <div className="my-diagrams-grid">
          {sorted.map((meta) => (
            <DiagramCard
              key={meta.id}
              meta={meta}
              active={meta.id === activeId}
              onOpen={() => loadDiagramIntoScene(meta.id)}
              onRename={() => handleRename(meta)}
              onDelete={() => handleDelete(meta)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export { MY_DIAGRAMS_TAB };
