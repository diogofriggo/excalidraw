import { exportToBlob } from "@excalidraw/utils";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { activeDiagramKey, getActiveUserId } from "./Users";

export type DiagramMeta = {
  id: string;
  name: string;
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DiagramData = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `API ${init?.method || "GET"} ${path} → ${res.status}`,
    );
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
};

export const getActiveDiagramId = (): string | null =>
  localStorage.getItem(activeDiagramKey());

export const setActiveDiagramId = (id: string | null) => {
  if (id) {
    localStorage.setItem(activeDiagramKey(), id);
  } else {
    localStorage.removeItem(activeDiagramKey());
  }
};

export const listDiagrams = async (): Promise<DiagramMeta[]> => {
  const userId = getActiveUserId();
  return (await api(
    `/diagrams?userId=${encodeURIComponent(userId)}`,
  )) as DiagramMeta[];
};

export const getDiagramData = async (
  id: string,
): Promise<DiagramData | undefined> => {
  try {
    const res = (await api(`/diagrams/${encodeURIComponent(id)}`)) as {
      data: DiagramData;
    };
    return res.data;
  } catch {
    return undefined;
  }
};

export const createDiagram = async (name: string): Promise<DiagramMeta> => {
  const userId = getActiveUserId();
  return (await api(`/diagrams`, {
    method: "POST",
    body: JSON.stringify({ userId, name }),
  })) as DiagramMeta;
};

let createInFlight: Promise<string | null> | null = null;

export const ensureActiveDiagramForSave = async (
  hasContent: boolean,
): Promise<string | null> => {
  const existing = getActiveDiagramId();
  if (existing) {
    return existing;
  }
  if (!hasContent) {
    return null;
  }
  if (!createInFlight) {
    createInFlight = (async () => {
      try {
        const meta = await createDiagram("Untitled");
        setActiveDiagramId(meta.id);
        return meta.id;
      } catch (err) {
        console.warn("auto-create diagram failed", err);
        return null;
      } finally {
        createInFlight = null;
      }
    })();
  }
  return createInFlight;
};

export const renameDiagram = async (id: string, name: string) => {
  await api(`/diagrams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
};

export const deleteDiagram = async (id: string) => {
  await api(`/diagrams/${encodeURIComponent(id)}`, { method: "DELETE" });
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const generateThumbnail = async (
  data: DiagramData,
): Promise<string | null> => {
  if (!data.elements.length) {
    return null;
  }
  try {
    const blob = await exportToBlob({
      elements: data.elements.filter((el) => !el.isDeleted) as any,
      appState: data.appState,
      files: data.files,
      maxWidthOrHeight: 256,
      mimeType: "image/png",
    });
    return await blobToBase64(blob);
  } catch (err) {
    console.warn("failed to generate diagram thumbnail", err);
    return null;
  }
};

export const regenerateThumbnail = async (id: string) => {
  const data = await getDiagramData(id);
  if (!data) {
    return;
  }
  const thumbnail = await generateThumbnail(data);
  await api(`/diagrams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ thumbnail }),
  });
};

export const saveDiagram = async (
  id: string,
  data: DiagramData,
  opts?: { regenerateThumbnail?: boolean },
) => {
  const payload: Record<string, unknown> = { data };
  if (opts?.regenerateThumbnail !== false) {
    payload.thumbnail = await generateThumbnail(data);
  } else if (!data.elements.length) {
    payload.thumbnail = null;
  }
  try {
    await api(`/diagrams/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Stale active-id (e.g. leftover from the pre-backend IDB era).
      // Drop it so we stop hammering a ghost diagram on every edit.
      if (getActiveDiagramId() === id) {
        setActiveDiagramId(null);
      }
      return;
    }
    console.warn("saveDiagram failed", err);
  }
};
