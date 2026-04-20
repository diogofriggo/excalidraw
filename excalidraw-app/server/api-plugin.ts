import path from "path";
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import type { Plugin } from "vite";

type UserRow = {
  id: string;
  name: string;
  created_at: number;
};

type DiagramRow = {
  id: string;
  user_id: string;
  name: string;
  thumbnail: Buffer | null;
  data: string;
  created_at: number;
  updated_at: number;
};

const DEFAULT_USER_ID = "default";

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const readJsonBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

const sendJson = (res: ServerResponse, status: number, body: any) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const sendNoContent = (res: ServerResponse) => {
  res.statusCode = 204;
  res.end();
};

const sendError = (res: ServerResponse, status: number, message: string) => {
  sendJson(res, status, { error: message });
};

export const apiPlugin = (): Plugin => {
  let db: Database.Database | null = null;

  const initDb = () => {
    const dbPath = path.resolve(
      process.cwd(),
      "..",
      "excalidraw-data.sqlite",
    );
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagrams (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        thumbnail BLOB,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diagrams_user ON diagrams(user_id);
    `);

    const userCount = (
      db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }
    ).n;
    if (userCount === 0) {
      db.prepare(
        "INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)",
      ).run(DEFAULT_USER_ID, "me", Date.now());
    }

    // eslint-disable-next-line no-console
    console.log(`[api] sqlite at ${dbPath}`);
  };

  const userToWire = (row: UserRow) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  });

  const diagramMetaToWire = (row: DiagramRow) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    thumbnail: row.thumbnail
      ? `/api/diagrams/${row.id}/thumbnail?v=${row.updated_at}`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!db) {
      sendError(res, 500, "db not initialized");
      return;
    }
    const rawUrl = req.url || "/";
    // vite strips the /api prefix via use('/api', ...)
    const url = new URL(rawUrl, "http://localhost");
    const pathname = url.pathname;
    const method = req.method || "GET";

    // USERS ------------------------------------------------------------------
    if (pathname === "/users" && method === "GET") {
      const rows = db
        .prepare("SELECT * FROM users ORDER BY created_at ASC")
        .all() as UserRow[];
      sendJson(res, 200, rows.map(userToWire));
      return;
    }
    if (pathname === "/users" && method === "POST") {
      const body = await readJsonBody(req);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        sendError(res, 400, "name required");
        return;
      }
      const user: UserRow = {
        id: newId(),
        name,
        created_at: Date.now(),
      };
      db.prepare(
        "INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)",
      ).run(user.id, user.name, user.created_at);
      sendJson(res, 201, userToWire(user));
      return;
    }
    {
      const m = pathname.match(/^\/users\/([^/]+)$/);
      if (m) {
        const id = m[1];
        if (method === "PATCH") {
          const body = await readJsonBody(req);
          const name = typeof body?.name === "string" ? body.name.trim() : "";
          if (!name) {
            sendError(res, 400, "name required");
            return;
          }
          const result = db
            .prepare("UPDATE users SET name = ? WHERE id = ?")
            .run(name, id);
          if (result.changes === 0) {
            sendError(res, 404, "user not found");
            return;
          }
          const row = db
            .prepare("SELECT * FROM users WHERE id = ?")
            .get(id) as UserRow;
          sendJson(res, 200, userToWire(row));
          return;
        }
        if (method === "DELETE") {
          db.prepare("DELETE FROM users WHERE id = ?").run(id);
          sendNoContent(res);
          return;
        }
      }
    }

    // DIAGRAMS ---------------------------------------------------------------
    if (pathname === "/diagrams" && method === "GET") {
      const userId = url.searchParams.get("userId");
      if (!userId) {
        sendError(res, 400, "userId required");
        return;
      }
      const rows = db
        .prepare(
          "SELECT id, user_id, name, thumbnail, '' AS data, created_at, updated_at FROM diagrams WHERE user_id = ? ORDER BY updated_at DESC",
        )
        .all(userId) as DiagramRow[];
      sendJson(res, 200, rows.map(diagramMetaToWire));
      return;
    }
    if (pathname === "/diagrams" && method === "POST") {
      const body = await readJsonBody(req);
      const userId = typeof body?.userId === "string" ? body.userId : "";
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!userId || !name) {
        sendError(res, 400, "userId and name required");
        return;
      }
      const now = Date.now();
      const row: DiagramRow = {
        id: newId(),
        user_id: userId,
        name,
        thumbnail: null,
        data: JSON.stringify({ elements: [], appState: {}, files: {} }),
        created_at: now,
        updated_at: now,
      };
      db.prepare(
        `INSERT INTO diagrams (id, user_id, name, thumbnail, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.user_id,
        row.name,
        row.thumbnail,
        row.data,
        row.created_at,
        row.updated_at,
      );
      sendJson(res, 201, diagramMetaToWire(row));
      return;
    }
    {
      const m = pathname.match(/^\/diagrams\/([^/]+)$/);
      if (m) {
        const id = m[1];
        if (method === "GET") {
          const row = db
            .prepare("SELECT * FROM diagrams WHERE id = ?")
            .get(id) as DiagramRow | undefined;
          if (!row) {
            sendError(res, 404, "diagram not found");
            return;
          }
          sendJson(res, 200, {
            ...diagramMetaToWire(row),
            data: JSON.parse(row.data),
          });
          return;
        }
        if (method === "PUT") {
          const body = await readJsonBody(req);
          const existing = db
            .prepare("SELECT * FROM diagrams WHERE id = ?")
            .get(id) as DiagramRow | undefined;
          if (!existing) {
            sendError(res, 404, "diagram not found");
            return;
          }
          const data =
            body?.data !== undefined
              ? JSON.stringify(body.data)
              : existing.data;
          let thumbnail: Buffer | null = existing.thumbnail;
          if (body?.thumbnail === null) {
            thumbnail = null;
          } else if (typeof body?.thumbnail === "string") {
            thumbnail = Buffer.from(body.thumbnail, "base64");
          }
          const name =
            typeof body?.name === "string" ? body.name.trim() : existing.name;
          const now = Date.now();
          db.prepare(
            `UPDATE diagrams SET name = ?, data = ?, thumbnail = ?, updated_at = ? WHERE id = ?`,
          ).run(name, data, thumbnail, now, id);
          const row = db
            .prepare("SELECT * FROM diagrams WHERE id = ?")
            .get(id) as DiagramRow;
          sendJson(res, 200, diagramMetaToWire(row));
          return;
        }
        if (method === "DELETE") {
          db.prepare("DELETE FROM diagrams WHERE id = ?").run(id);
          sendNoContent(res);
          return;
        }
      }
    }
    {
      const m = pathname.match(/^\/diagrams\/([^/]+)\/thumbnail$/);
      if (m) {
        const id = m[1];
        if (method === "GET") {
          const row = db
            .prepare("SELECT thumbnail FROM diagrams WHERE id = ?")
            .get(id) as { thumbnail: Buffer | null } | undefined;
          if (!row || !row.thumbnail) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "no-cache");
          res.end(row.thumbnail);
          return;
        }
      }
    }

    sendError(res, 404, `no route for ${method} ${pathname}`);
  };

  return {
    name: "excalidraw-api",
    configureServer(server) {
      if (!db) {
        initDb();
      }
      server.middlewares.use("/api", (req, res, next) => {
        handle(req, res).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[api] error", err);
          if (!res.headersSent) {
            sendError(res, 500, err?.message || "internal error");
          } else {
            next(err);
          }
        });
      });
    },
  };
};
