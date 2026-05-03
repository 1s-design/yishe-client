import { app } from "electron";
import fs from "fs";
import path from "path";

type ClientLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const MAX_LOG_FILE_SIZE = 20 * 1024 * 1024;
const MAX_LOG_DAYS = 7;
const MAX_LOG_TOTAL_SIZE = 100 * 1024 * 1024;
const LOG_FLUSH_INTERVAL_MS = 500;
const LOG_BATCH_SIZE = 200;
const LOG_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const LOG_LEVEL_PRIORITY: Record<ClientLogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

let logQueue: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushPromise: Promise<void> | null = null;
let lastCleanupAt = 0;

function getLogDirectory() {
  const baseDir = app.isPackaged ? app.getPath("userData") : process.cwd();
  return path.join(baseDir, "logs", "client");
}

function getLogFilePath(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return path.join(getLogDirectory(), day, "client.log");
}

function sanitizeLogValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[MaxDepth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item, depth + 1));
  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}... [truncated ${value.length}]` : value;
  }
  if (typeof value !== "object") return value;

  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (/token|authorization|password|secret|cookie|session|api[-_]?key/i.test(key)) {
      result[key] = "[REDACTED]";
    } else if (/image|base64|file|blob|buffer|content/i.test(key) && typeof item === "string" && item.length > 300) {
      result[key] = `[OMITTED ${item.length} chars]`;
    } else {
      result[key] = sanitizeLogValue(item, depth + 1);
    }
  }
  return result;
}

function cleanupOldLogs() {
  try {
    const dir = getLogDirectory();
    if (!fs.existsSync(dir)) return;
    const files = collectClientLogFiles()
      .map((file) => ({
        name: file.fileName,
        path: resolveClientLogFilePath(file.fileName),
        mtimeMs: new Date(file.mtime).getTime(),
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const keepDates = new Set(
      Array.from(new Set(files.map((file) => file.name.split("/")[0])))
        .sort((a, b) => b.localeCompare(a))
        .slice(0, MAX_LOG_DAYS),
    );

    for (const file of files) {
      const date = file.name.split("/")[0];
      if (!keepDates.has(date)) {
        fs.unlinkSync(file.path);
      }
    }

    const remainingFiles = collectClientLogFiles()
      .map((file) => ({
        name: file.fileName,
        path: resolveClientLogFilePath(file.fileName),
        size: file.size,
        mtimeMs: new Date(file.mtime).getTime(),
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    let totalSize = remainingFiles.reduce((sum, file) => sum + file.size, 0);
    for (const file of [...remainingFiles].reverse()) {
      if (totalSize <= MAX_LOG_TOTAL_SIZE) break;
      fs.unlinkSync(file.path);
      totalSize -= file.size;
    }
  } catch {
    // 日志清理失败不能影响客户端运行
  }
}

function rotateIfNeeded(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_LOG_FILE_SIZE) return;
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    fs.renameSync(filePath, path.join(path.dirname(filePath), `client-${stamp}.log`));
  } catch {
    // 日志轮转失败不能影响客户端运行
  }
}

function isAllowedClientLogBaseName(name: string) {
  return (
    /^client(\.\d+)?\.log$/.test(name) ||
    /^client-\d{8}-\d{6}\.log$/.test(name) ||
    /^client\.\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(name)
  );
}

function normalizeClientLogFileName(fileName: string) {
  return String(fileName || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function normalizeLogLevel(level: unknown): ClientLogLevel {
  const normalized = String(level || "INFO").toUpperCase();
  if (normalized === "DEBUG" || normalized === "INFO" || normalized === "WARN" || normalized === "ERROR") {
    return normalized;
  }
  return "INFO";
}

function getMinimumLogLevel(): ClientLogLevel {
  const configured = normalizeLogLevel(process.env.YISHE_CLIENT_LOG_LEVEL || "INFO");
  return configured;
}

function shouldPersistLog(level: ClientLogLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getMinimumLogLevel()];
}

function scheduleCleanupOldLogs() {
  const now = Date.now();
  if (now - lastCleanupAt < LOG_CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupAt = now;
  setTimeout(cleanupOldLogs, 0);
}

function flushQueuedLogs() {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    while (logQueue.length > 0) {
      const batch = logQueue.splice(0, LOG_BATCH_SIZE);
      const filePath = getLogFilePath();
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      rotateIfNeeded(filePath);
      await fs.promises.appendFile(filePath, batch.join(""), "utf8");
      scheduleCleanupOldLogs();
    }
  })()
    .catch(() => {
      // 日志写入失败不能影响客户端运行
    })
    .finally(() => {
      flushPromise = null;
      if (logQueue.length > 0) {
        scheduleFlushQueuedLogs();
      }
    });

  return flushPromise;
}

function scheduleFlushQueuedLogs() {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueuedLogs();
  }, LOG_FLUSH_INTERVAL_MS);
}

export function writeClientLog(input: {
  level?: ClientLogLevel | string;
  module?: string;
  message?: string;
  context?: Record<string, any>;
}) {
  try {
    const filePath = getLogFilePath();
    const level = normalizeLogLevel(input?.level);
    if (!shouldPersistLog(level)) {
      return { success: true, filePath, skipped: true };
    }
    const record = {
      time: new Date().toISOString(),
      level,
      module: String(input?.module || "client").trim() || "client",
      pid: process.pid,
      platform: process.platform,
      appVersion: app.getVersion(),
      message: String(input?.message || ""),
      data: sanitizeLogValue(input?.context || {}),
    };
    logQueue.push(`${JSON.stringify(record)}\n`);
    scheduleFlushQueuedLogs();
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, message: error?.message || String(error) };
  }
}

function parseLogLine(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function collectClientLogFiles() {
  const dir = getLogDirectory();
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: Array<{
    fileName: string;
    relativePath: string;
    size: number;
    mtime: string;
    date: string;
  }> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      const date = entry.name;
      const dayDir = path.join(dir, date);
      for (const name of fs.readdirSync(dayDir)) {
        if (!isAllowedClientLogBaseName(name)) continue;
        const filePath = path.join(dayDir, name);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        const relativeName = `${date}/${name}`;
        files.push({
          fileName: relativeName,
          relativePath: `client/${relativeName}`,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          date,
        });
      }
      continue;
    }

    if (!entry.isFile() || !/^client\.\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(entry.name)) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    const stat = fs.statSync(filePath);
    files.push({
      fileName: entry.name,
      relativePath: `client/${entry.name}`,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      date: entry.name.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "",
    });
  }

  return files.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.fileName.localeCompare(a.fileName));
}

function listClientLogFiles() {
  return collectClientLogFiles();
}

function resolveClientLogFilePath(fileName: string) {
  const normalizedName = normalizeClientLogFileName(fileName);
  const parts = normalizedName.split("/");
  const isLegacyFile =
    parts.length === 1 &&
    (/^client\.\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(parts[0]) ||
      /^client-\d{8}-\d{6}\.log$/.test(parts[0]));
  const isDateFile =
    parts.length === 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) &&
    isAllowedClientLogBaseName(parts[1]);
  if (!normalizedName || (!isLegacyFile && !isDateFile)) {
    throw new Error("日志文件名不合法");
  }
  const filePath = path.resolve(getLogDirectory(), normalizedName);
  if (!filePath.startsWith(getLogDirectory() + path.sep) || !fs.existsSync(filePath)) {
    throw new Error("日志文件不存在");
  }
  return filePath;
}

function readClientLogLines(fileName: string) {
  const filePath = resolveClientLogFilePath(fileName);
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}

function normalizeLine(fileName: string, lineNumber: number, raw: string) {
  const parsed = parseLogLine(raw);
  return {
    id: `client/${fileName}:${lineNumber}`,
    type: "client",
    fileName,
    lineNumber,
    raw,
    parsed,
    time: parsed?.time,
    level: parsed?.level,
    module: parsed?.module,
    message: parsed?.message || raw,
    userId: parsed?.userId,
    userName: parsed?.userName,
    requestId: parsed?.requestId,
    taskId: parsed?.taskId,
  };
}

function matchesClientLogLine(line: ReturnType<typeof normalizeLine>, params: Record<string, any>) {
  const keyword = String(params.keyword || "").trim().toLowerCase();
  const moduleName = String(params.module || "").trim().toLowerCase();
  const level = String(params.level || "").trim().toLowerCase();
  const startDate = String(params.startDate || "").trim();
  const endDate = String(params.endDate || "").trim();
  const lineDate = String(line.time || "").slice(0, 10);

  if (lineDate && startDate && lineDate < startDate) return false;
  if (lineDate && endDate && lineDate > endDate) return false;
  if (keyword && !line.raw.toLowerCase().includes(keyword)) return false;
  if (moduleName && !String(line.module || "").toLowerCase().includes(moduleName) && !line.raw.toLowerCase().includes(moduleName)) return false;
  if (level && String(line.level || "").toLowerCase() !== level && !line.raw.toLowerCase().includes(level)) return false;
  return true;
}

function resolveClientLogFiles(params: Record<string, any>) {
  const all = listClientLogFiles();
  const startDate = String(params.startDate || "").trim();
  const endDate = String(params.endDate || "").trim();
  const fileName = String(params.file || "").trim();
  return all.filter((file) => {
    if (fileName && file.fileName !== fileName) return false;
    if (startDate && file.date && file.date < startDate) return false;
    if (endDate && file.date && file.date > endDate) return false;
    return true;
  });
}

export function handleClientLogCommand(action: string, payload: Record<string, any> = {}) {
  const normalizedAction = String(action || "").trim();
  if (normalizedAction === "list" || normalizedAction === "tree") {
    return {
      root: getLogDirectory(),
      files: resolveClientLogFiles(payload),
    };
  }

  if (normalizedAction === "tail" || normalizedAction === "search") {
    const files = resolveClientLogFiles(payload);
    const rows: ReturnType<typeof normalizeLine>[] = [];
    let matched = 0;
    const linesLimit = Math.min(5000, Math.max(1, Number(payload.lines) || 500));
    const page = Math.max(1, Number(payload.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize) || 200));
    const startIndex = (page - 1) * pageSize;

    for (const file of files) {
      const rawLines = readClientLogLines(file.fileName);
      rawLines.forEach((raw, index) => {
        const line = normalizeLine(file.fileName, index + 1, raw);
        if (!matchesClientLogLine(line, payload)) return;
        if (normalizedAction === "tail") {
          rows.push(line);
          if (rows.length > linesLimit) rows.shift();
        } else {
          if (matched >= startIndex && rows.length < pageSize) rows.push(line);
          matched += 1;
        }
      });
    }

    return {
      list: rows,
      total: normalizedAction === "tail" ? rows.length : matched,
      page,
      pageSize,
      lines: linesLimit,
      files,
    };
  }

  if (normalizedAction === "delete") {
    const fileName = String(payload.file || "").trim();
    const filePath = resolveClientLogFilePath(fileName);
    fs.unlinkSync(filePath);
    return {
      success: true,
      fileName,
    };
  }

  throw new Error(`未实现的客户端日志命令: ${normalizedAction}`);
}
