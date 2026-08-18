/**
 * Agent 会话存储 — 持久化到磁盘，供 HTTP API 和 UI 共享访问。
 *
 * 存储位置：electron userData 目录下的 agent-sessions.json
 */
import fs from "fs";
import path from "path";
import { app } from "electron";
import type { AgentChatMessage } from "./langgraph-agent";

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
}

const SESSIONS_FILE = "agent-sessions.json";

function getStoragePath(): string {
  const userData = app.getPath("userData");
  return path.join(userData, SESSIONS_FILE);
}

/**
 * 会话存储管理器（单例）。
 */
class SessionStoreImpl {
  private sessions: Map<string, AgentSession> = new Map();
  private loaded = false;

  /** 延迟加载，确保 electron app ready 后调用 */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const filePath = getStoragePath();
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const list: AgentSession[] = JSON.parse(raw);
        for (const s of list) {
          this.sessions.set(s.id, s);
        }
      }
    } catch (err) {
      console.error("[SessionStore] 加载失败:", err);
    }
  }

  private persist(): void {
    const filePath = getStoragePath();
    try {
      const list = Array.from(this.sessions.values()).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      console.error("[SessionStore] 持久化失败:", err);
    }
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
    this.persist();
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
    // 自动用第一条用户消息做标题
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
    this.persist();
  }

  /** 更新会话消息（覆盖全部） */
  setMessages(sessionId: string, messages: AgentChatMessage[]): void {
    this.load();
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages = messages;
    session.updatedAt = Date.now();
    this.persist();
  }

  /** 删除会话 */
  delete(id: string): boolean {
    this.load();
    const ok = this.sessions.delete(id);
    if (ok) this.persist();
    return ok;
  }

  /** 清空所有会话 */
  clear(): void {
    this.load();
    this.sessions.clear();
    this.persist();
  }
}

export const sessionStore = new SessionStoreImpl();
