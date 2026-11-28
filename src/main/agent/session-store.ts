/**
 * Agent 会话存储 — 按会话分文件异步持久化，避免单文件全量同步写盘阻塞 Electron 主进程。
 *
 * 存储结构：
 *   userData/agent-sessions/<safeSessionId>.json
 * 首次启动时若存在旧版 userData/agent-sessions.json，会自动无缝迁移，不丢失历史会话。
 */
import fs from "fs";
import path from "path";
import { app } from "electron";
import type { AgentChatMessage } from "./types";

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
}

const LEGACY_SESSIONS_FILE = "agent-sessions.json";
const SESSIONS_DIR = "agent-sessions";
const PERSIST_DEBOUNCE_MS = 120;

function getUserDataDir(): string {
  return app?.getPath ? app.getPath("userData") : "/tmp";
}

function getSessionsDir(): string {
  return path.join(getUserDataDir(), SESSIONS_DIR);
}

function getLegacyStoragePath(): string {
  return path.join(getUserDataDir(), LEGACY_SESSIONS_FILE);
}

function getSessionFilePath(id: string): string {
  const safeId = encodeURIComponent(String(id || "default")).replace(
    /[%]/g,
    "_",
  );
  return path.join(getSessionsDir(), `${safeId}.json`);
}

class SessionStoreImpl {
  private sessions: Map<string, AgentSession> = new Map();
  private loaded = false;
  private persistTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private ensureDir(): void {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** 延迟加载：先读分文件目录，若检测到旧版单文件则自动迁移。 */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.ensureDir();
      const dir = getSessionsDir();
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), "utf-8");
          const session: AgentSession = JSON.parse(raw);
          if (session?.id) this.sessions.set(session.id, session);
        } catch (err) {
          console.warn(`[SessionStore] 跳过损坏会话文件 ${file}:`, err);
        }
      }

      // 无缝迁移旧版 agent-sessions.json
      const legacyPath = getLegacyStoragePath();
      if (fs.existsSync(legacyPath)) {
        try {
          const raw = fs.readFileSync(legacyPath, "utf-8");
          const legacyList: AgentSession[] = JSON.parse(raw);
          if (Array.isArray(legacyList)) {
            for (const s of legacyList) {
              if (s?.id && !this.sessions.has(s.id)) {
                this.sessions.set(s.id, s);
                this.schedulePersist(s.id);
              }
            }
          }
          // 重命名归档，避免下次重复迁移
          fs.renameSync(legacyPath, `${legacyPath}.migrated.bak`);
        } catch (err) {
          console.warn("[SessionStore] 迁移旧版会话文件失败:", err);
        }
      }
    } catch (err) {
      console.error("[SessionStore] 加载失败:", err);
    }
  }

  /** 按 sessionId 防抖异步写盘，不阻塞 Electron 主进程事件循环。 */
  private schedulePersist(sessionId: string): void {
    const existingTimer = this.persistTimers.get(sessionId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.persistTimers.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session) return;
      this.ensureDir();
      const target = getSessionFilePath(sessionId);
      const tmpTarget = `${target}.tmp`;
      const payload = JSON.stringify(session);
      void fs.promises
        .writeFile(tmpTarget, payload, "utf-8")
        .then(() => fs.promises.rename(tmpTarget, target))
        .catch((err) => {
          console.error(`[SessionStore] 异步持久化会话 ${sessionId} 失败:`, err);
        });
    }, PERSIST_DEBOUNCE_MS);

    this.persistTimers.set(sessionId, timer);
  }

  /** 获取所有会话（按更新时间倒序） */
  list(): AgentSession[] {
    this.load();
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  /** 获取单个会话 */
  get(id: string): AgentSession | undefined {
    this.load();
    return this.sessions.get(id);
  }

  /** 创建会话 */
  create(id: string, title?: string): AgentSession {
    this.load();
    const now = Date.now();
    const session: AgentSession = {
      id,
      title: title || "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.sessions.set(id, session);
    this.schedulePersist(id);
    return session;
  }

  /** 获取或创建会话 */
  getOrCreate(id: string): AgentSession {
    this.load();
    let session = this.sessions.get(id);
    if (!session) {
      session = this.create(id);
    }
    return session;
  }

  /** 追加消息 */
  appendMessage(sessionId: string, message: AgentChatMessage): void {
    this.load();
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages.push(message);
    session.updatedAt = Date.now();
    if (session.title === "新对话" && message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((c) => c.type === "text")
              .map((c) => (c as any).text)
              .join("");
      session.title = text.slice(0, 40) || "新对话";
    }
    this.schedulePersist(sessionId);
  }

  /** 更新会话消息（覆盖全部） */
  setMessages(sessionId: string, messages: AgentChatMessage[]): void {
    this.load();
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages = messages;
    session.updatedAt = Date.now();
    this.schedulePersist(sessionId);
  }

  /** 删除会话 */
  delete(id: string): boolean {
    this.load();
    const timer = this.persistTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(id);
    }
    const ok = this.sessions.delete(id);
    if (ok) {
      void fs.promises.unlink(getSessionFilePath(id)).catch(() => {});
    }
    return ok;
  }

  /** 清空所有会话 */
  clear(): void {
    this.load();
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    const ids = Array.from(this.sessions.keys());
    this.sessions.clear();
    for (const id of ids) {
      void fs.promises.unlink(getSessionFilePath(id)).catch(() => {});
    }
  }
}

export const sessionStore = new SessionStoreImpl();
