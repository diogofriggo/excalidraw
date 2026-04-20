import { CaptureUpdateAction, useExcalidrawAPI } from "@excalidraw/excalidraw";
import {
  DotsIcon,
  PlusIcon,
  TrashIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { LocalData } from "../data/LocalData";
import {
  getActiveDiagramId,
  getDiagramData,
  regenerateThumbnail,
  setActiveDiagramId,
} from "../data/MyDiagrams";
import {
  createUser,
  deleteUser,
  ensureDefaultUser,
  getActiveUserId,
  getUserColor,
  getUserInitials,
  listUsers,
  renameUser,
  setActiveUserId,
  type User,
} from "../data/Users";

import "./UsersPanel.scss";

const USERS_TAB = "users";

const UserCard = ({
  user,
  active,
  onSelect,
  onRename,
  onDelete,
  canDelete,
}: {
  user: User;
  active: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  canDelete: boolean;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(user.name);
    }
  }, [editing, user.name]);

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

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(user.name);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(user.name);
    setEditing(false);
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== user.name) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const color = getUserColor(user);
  const initials = getUserInitials(user.name);

  return (
    <div
      className={`users-card ${active ? "is-active" : ""}`}
      onClick={() => {
        if (editing) {
          return;
        }
        onSelect();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        className="users-avatar"
        style={{ backgroundColor: color }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
      >
        <span className="users-avatar-initials">{initials}</span>
      </div>
      <div className="users-card-footer">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            className="users-card-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitEdit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                submitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="users-card-name"
            title={`${user.name} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            {user.name}
          </div>
        )}
        <div className="users-card-menu" ref={menuRef}>
          <button
            type="button"
            className="users-icon-button"
            aria-label="User menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {DotsIcon}
          </button>
          {menuOpen && (
            <div
              className="users-menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  startEditing();
                }}
              >
                <span className="users-menu-icon">{pencilIcon}</span>
                Rename
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={!canDelete}
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                title={
                  canDelete ? undefined : "Cannot delete the last user"
                }
              >
                <span className="users-menu-icon">{TrashIcon}</span>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const UsersPanel = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const uiAppState = useUIAppState();
  const [users, setUsers] = useState<User[]>([]);
  const [activeUserId, setActiveUserIdState] = useState<string>(
    getActiveUserId(),
  );

  const refresh = useCallback(async () => {
    await ensureDefaultUser();
    const next = await listUsers();
    setUsers(next);
    setActiveUserIdState(getActiveUserId());
  }, []);

  const isOpen =
    uiAppState.openSidebar?.name === "default" &&
    uiAppState.openSidebar?.tab === USERS_TAB;

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen, refresh]);

  const handleSwitchUser = useCallback(
    async (userId: string) => {
      if (!excalidrawAPI) {
        return;
      }
      if (userId === getActiveUserId()) {
        return;
      }
      LocalData.flushSave();
      const previousDiagramId = getActiveDiagramId();
      if (previousDiagramId) {
        await regenerateThumbnail(previousDiagramId);
      }
      setActiveUserId(userId);
      setActiveUserIdState(userId);
      const nextActiveDiagramId = getActiveDiagramId();
      if (nextActiveDiagramId) {
        const data = await getDiagramData(nextActiveDiagramId);
        if (data) {
          excalidrawAPI.updateScene({
            elements: restoreElements(data.elements, null, {
              repairBindings: true,
            }),
            appState: restoreAppState(data.appState, null),
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
          const fileList = Object.values(
            data.files || {},
          ) as BinaryFileData[];
          if (fileList.length) {
            excalidrawAPI.addFiles(fileList);
          }
          excalidrawAPI.history.clear();
          return;
        }
        setActiveDiagramId(null);
      }
      excalidrawAPI.resetScene();
      excalidrawAPI.history.clear();
    },
    [excalidrawAPI],
  );

  const handleCreateUser = useCallback(async () => {
    const name = window.prompt("New user name");
    if (name == null) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    await createUser(trimmed);
    await refresh();
  }, [refresh]);

  const handleRename = useCallback(
    async (user: User, newName: string) => {
      await renameUser(user.id, newName);
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (user: User) => {
      if (users.length <= 1) {
        return;
      }
      if (
        !window.confirm(
          `Delete user "${user.name}"? Their diagrams will be orphaned.`,
        )
      ) {
        return;
      }
      if (user.id === getActiveUserId()) {
        const other = users.find((u) => u.id !== user.id);
        if (other) {
          await handleSwitchUser(other.id);
        }
      }
      await deleteUser(user.id);
      await refresh();
    },
    [users, refresh, handleSwitchUser],
  );

  return (
    <div className="users-panel">
      <div className="users-toolbar">
        <button
          type="button"
          className="users-new"
          onClick={handleCreateUser}
        >
          <span className="users-menu-icon">{PlusIcon}</span>
          New user
        </button>
      </div>
      {users.length === 0 ? (
        <div className="users-empty">Loading users…</div>
      ) : (
        <div className="users-grid">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              active={user.id === activeUserId}
              onSelect={() => handleSwitchUser(user.id)}
              onRename={(newName) => handleRename(user, newName)}
              onDelete={() => handleDelete(user)}
              canDelete={users.length > 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export { USERS_TAB };
