export type User = {
  id: string;
  name: string;
  createdAt: number;
};

export const DEFAULT_USER_ID = "default";

const ACTIVE_USER_KEY = "excalidraw-active-user-id";
const ACTIVE_DIAGRAM_KEY_PREFIX = "excalidraw-active-diagram-id";

export const getActiveUserId = (): string => {
  try {
    return localStorage.getItem(ACTIVE_USER_KEY) || DEFAULT_USER_ID;
  } catch {
    return DEFAULT_USER_ID;
  }
};

export const setActiveUserId = (userId: string) => {
  try {
    localStorage.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // ignore
  }
};

export const activeDiagramKey = (userId?: string) =>
  `${ACTIVE_DIAGRAM_KEY_PREFIX}:${userId ?? getActiveUserId()}`;

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${init?.method || "GET"} ${path} → ${res.status}`);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
};

export const listUsers = async (): Promise<User[]> =>
  (await api("/users")) as User[];

export const createUser = async (name: string): Promise<User> =>
  (await api("/users", {
    method: "POST",
    body: JSON.stringify({ name }),
  })) as User;

export const renameUser = async (id: string, name: string) => {
  await api(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
};

export const deleteUser = async (id: string) => {
  await api(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
};

// The backend seeds a default user on startup, so there's nothing to ensure
// from the client. Kept as a noop to preserve the call sites.
export const ensureDefaultUser = async (): Promise<void> => {};

const USER_COLORS = [
  "#6965db",
  "#e67700",
  "#0b7285",
  "#5f3dc4",
  "#c92a2a",
  "#1971c2",
  "#2b8a3e",
  "#d63384",
  "#0ca678",
  "#9c36b5",
];

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

export const getUserColor = (user: User): string =>
  USER_COLORS[hashString(user.id + user.name) % USER_COLORS.length];

export const getUserInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (
    parts[0][0] + parts[parts.length - 1][0]
  ).toUpperCase();
};
