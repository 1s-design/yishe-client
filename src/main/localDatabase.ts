import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const LOCAL_DATABASE_SCHEMA_VERSION = 1;
const LOCAL_DATABASE_FILE_NAME = "yishe-client.sqlite3";

export interface LocalDatabaseInfo {
  connected: boolean;
  engine: "SQLite";
  databasePath: string;
  databaseUri: string;
  directory: string;
  sizeBytes: number;
  sqliteVersion: string;
  schemaVersion: number;
  journalMode: string;
  error?: string;
}

function resolveLocalDatabasePath(workspaceDirectory: string): string {
  const normalizedWorkspaceDirectory = String(workspaceDirectory || "").trim();
  if (!normalizedWorkspaceDirectory) {
    throw new Error("工作目录未设置");
  }

  return join(
    normalizedWorkspaceDirectory,
    ".yishe",
    "database",
    LOCAL_DATABASE_FILE_NAME,
  );
}

function createDisconnectedInfo(databasePath: string, error: unknown): LocalDatabaseInfo {
  return {
    connected: false,
    engine: "SQLite",
    databasePath,
    databaseUri: pathToFileURL(databasePath).href,
    directory: dirname(databasePath),
    sizeBytes: 0,
    sqliteVersion: "",
    schemaVersion: 0,
    journalMode: "",
    error: error instanceof Error ? error.message : String(error),
  };
}

export function getLocalDatabaseInfo(workspaceDirectory: string): LocalDatabaseInfo {
  let databasePath = "";

  try {
    databasePath = resolveLocalDatabasePath(workspaceDirectory);
    mkdirSync(dirname(databasePath), { recursive: true });

    const database = new DatabaseSync(databasePath);
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("PRAGMA journal_mode = WAL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS local_database_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      const now = new Date().toISOString();
      database
        .prepare(
          `
            INSERT OR IGNORE INTO local_database_meta (key, value, updated_at)
            VALUES (?, ?, ?)
          `,
        )
        .run("created_at", now, now);
      database
        .prepare(
          `
            INSERT INTO local_database_meta (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `,
        )
        .run("schema_version", String(LOCAL_DATABASE_SCHEMA_VERSION), now);
      database.exec(`PRAGMA user_version = ${LOCAL_DATABASE_SCHEMA_VERSION}`);

      const versionRow = database.prepare("SELECT sqlite_version() AS version").get() as
        | { version?: string }
        | undefined;
      const schemaRow = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      const journalRow = database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;

      return {
        connected: true,
        engine: "SQLite",
        databasePath,
        databaseUri: pathToFileURL(databasePath).href,
        directory: dirname(databasePath),
        sizeBytes: statSync(databasePath).size,
        sqliteVersion: String(versionRow?.version || ""),
        schemaVersion: Number(schemaRow?.user_version || 0),
        journalMode: String(journalRow?.journal_mode || ""),
      };
    } finally {
      database.close();
    }
  } catch (error) {
    if (!databasePath) {
      return {
        connected: false,
        engine: "SQLite",
        databasePath: "",
        databaseUri: "",
        directory: "",
        sizeBytes: 0,
        sqliteVersion: "",
        schemaVersion: 0,
        journalMode: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return createDisconnectedInfo(databasePath, error);
  }
}
