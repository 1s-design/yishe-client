/*
 * 裁剪审核任务 · 客户端本地台账（SQLite）
 *
 * 与 localDatabase.ts 复用同一个数据库文件（.yishe/database/yishe-client.sqlite3）。
 * 服务端 task 表保存任务真相与 Redis 认领锁；本台账负责：
 *   1) 记录客户端已认领任务的逐方案执行进度（哪张原图、哪个方案已裁剪入库）
 *   2) 断点续跑：进程重启后未完成的配置项重新入队
 *   3) 幂等：按 configKey 去重（本地台账 + 服务端 progress.results 合并），
 *      重复上报不会让同一方案反复入库或重复建立关联
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import { resolveAvailableDatabasePath } from "./localDatabase";

export interface CropPlan {
  key: string;
  label?: string;
  aspectRatio: number;
  width?: number;
  height?: number;
}

export interface CropLedgerResult {
  configKey: string;
  materialId: string;
  materialUrl?: string;
}

export interface CropLedgerTask {
  taskId: string;
  batchId: string;
  originalId: string;
  originalUrl: string;
  originalName: string;
  configs: CropPlan[];
  status: "processing" | "completed" | "failed";
  resultsJson: string;
  createdAt: string;
  updatedAt: string;
}

let cachedDatabasePath: string | null = null;

/** 由主进程在启动时注入工作目录，保证台账与 localDatabase.ts 落在同一个库文件 */
export function initCropTaskStore(workspaceDirectory: string): void {
  try {
    cachedDatabasePath = resolveAvailableDatabasePath(String(workspaceDirectory || ""));
  } catch {
    cachedDatabasePath = join(app.getPath("userData"), "database", "yishe-client.sqlite3");
  }
}

function resolveDatabasePath(): string {
  if (cachedDatabasePath) return cachedDatabasePath;
  // 未注入工作目录时退到 userData，保证台账始终可用
  cachedDatabasePath = join(app.getPath("userData"), "database", "yishe-client.sqlite3");
  return cachedDatabasePath;
}

function openDatabase(): DatabaseSync {
  const dbPath = resolveDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS crop_task_ledger (
      task_id TEXT PRIMARY KEY,
      batch_id TEXT,
      original_id TEXT,
      original_url TEXT,
      original_name TEXT,
      configs_json TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      results_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return database;
}

function rowToTask(row: any): CropLedgerTask {
  let configs: CropPlan[] = [];
  try {
    configs = JSON.parse(row.configs_json || "[]");
  } catch {
    configs = [];
  }
  return {
    taskId: row.task_id,
    batchId: row.batch_id || "",
    originalId: row.original_id || "",
    originalUrl: row.original_url || "",
    originalName: row.original_name || "",
    configs,
    status: row.status,
    resultsJson: row.results_json || "[]",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 记录/更新一个已认领任务（幂等：task_id 冲突时更新快照与状态） */
export function upsertLedgerTask(task: {
  taskId: string;
  batchId?: string;
  originalId: string;
  originalUrl: string;
  originalName?: string;
  configs: CropPlan[];
}): void {
  const db = openDatabase();
  try {
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO crop_task_ledger
          (task_id, batch_id, original_id, original_url, original_name, configs_json, status, results_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'processing', '[]', ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          original_url = excluded.original_url,
          original_name = excluded.original_name,
          configs_json = excluded.configs_json,
          updated_at = excluded.updated_at
      `,
    ).run(
      task.taskId,
      task.batchId || "",
      task.originalId,
      task.originalUrl,
      task.originalName || "",
      JSON.stringify(task.configs || []),
      now,
      now,
    );
  } finally {
    db.close();
  }
}

export function getLedgerTask(taskId: string): CropLedgerTask | null {
  const db = openDatabase();
  try {
    const row = db
      .prepare("SELECT * FROM crop_task_ledger WHERE task_id = ?")
      .get(taskId) as any;
    return row ? rowToTask(row) : null;
  } finally {
    db.close();
  }
}

/** 读取某任务已完成的方案 key 集合（用于跳过重复裁剪） */
export function getDoneConfigKeys(taskId: string): Set<string> {
  const task = getLedgerTask(taskId);
  const keys = new Set<string>();
  if (!task) return keys;
  let results: CropLedgerResult[] = [];
  try {
    results = JSON.parse(task.resultsJson || "[]");
  } catch {
    results = [];
  }
  for (const r of results) if (r?.configKey) keys.add(r.configKey);
  return keys;
}

/** 读取某任务本地台账里全部已完成结果（用于续跑时向服务端补报） */
export function getLedgerResults(taskId: string): CropLedgerResult[] {
  const task = getLedgerTask(taskId);
  if (!task) return [];
  try {
    const results = JSON.parse(task.resultsJson || "[]");
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export function addLedgerResult(taskId: string, result: CropLedgerResult): void {
  const db = openDatabase();
  try {
    const row = db
      .prepare("SELECT results_json FROM crop_task_ledger WHERE task_id = ?")
      .get(taskId) as any;
    let results: CropLedgerResult[] = [];
    try {
      results = JSON.parse(row?.results_json || "[]");
    } catch {
      results = [];
    }
    const next = results.filter((r) => r.configKey !== result.configKey);
    next.push(result);
    db.prepare(
      "UPDATE crop_task_ledger SET results_json = ?, updated_at = ? WHERE task_id = ?",
    ).run(JSON.stringify(next), new Date().toISOString(), taskId);
  } finally {
    db.close();
  }
}

export function setLedgerStatus(
  taskId: string,
  status: CropLedgerTask["status"],
): void {
  const db = openDatabase();
  try {
    db.prepare(
      "UPDATE crop_task_ledger SET status = ?, updated_at = ? WHERE task_id = ?",
    ).run(status, new Date().toISOString(), taskId);
  } finally {
    db.close();
  }
}

/** 列出本机尚未完成的任务（用于进程启动后续跑） */
export function listPendingLedgerTasks(): CropLedgerTask[] {
  const db = openDatabase();
  try {
    const rows = db
      .prepare(
        "SELECT * FROM crop_task_ledger WHERE status = 'processing' ORDER BY created_at ASC",
      )
      .all() as any[];
    return (rows || []).map(rowToTask);
  } finally {
    db.close();
  }
}

/** 清理已完成/失败的台账（可选，保留最近 N 条） */
export function pruneLedger(keepLatest = 200): void {
  const db = openDatabase();
  try {
    db.prepare(
      `
        DELETE FROM crop_task_ledger
        WHERE status IN ('completed','failed') AND task_id NOT IN (
          SELECT task_id FROM crop_task_ledger
          WHERE status IN ('completed','failed')
          ORDER BY updated_at DESC LIMIT ?
        )
      `,
    ).run(keepLatest);
  } finally {
    db.close();
  }
}
