/**
 * Agent HTTP API — 提供外部调用 Agent 的 REST 接口。
 *
 * 路由：
 *   GET    /api/agent/sessions           会话列表
 *   GET    /api/agent/sessions/:id       会话详情（含消息）
 *   POST   /api/agent/sessions           创建会话
 *   DELETE /api/agent/sessions/:id       删除会话
 *   POST   /api/agent/sessions/:id/messages  发送消息（SSE 流式）
 *   POST   /api/agent/stop               停止当前生成
 *   POST   /api/agent/approve            审批工具调用（手动模式）
 *   GET    /api/agent/google-art-health    Google Arts 连通性检查
 */
import type { Router } from "express";
import { randomUUID } from "crypto";
import { sessionStore } from "./session-store";
import { clientLangGraphAgent } from "./langgraph-agent";
import type { AgentChatMessage } from "./langgraph-agent";

export function createAgentApiRouter(): Router {
  // 动态 import express 避免循环依赖
  const express = require("express");
  const router = express.Router();

  // ── Agent 配置状态（诊断用） ──────────────────────────────
  router.get("/config", async (_req, res) => {
    try {
      const { getActiveAgentConfig } = await import("./agent-config");
      const cfg = getActiveAgentConfig();
      res.json({
        success: true,
        data: {
          enabled: cfg.enabled,
          model: cfg.model,
          baseUrl: cfg.baseUrl,
          hasApiKey: !!cfg.apiKey,
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
        },
      });
    } catch (err: any) {
      res.json({ success: false, error: err?.message || String(err) });
    }
  });

  // ── 连通性测试 ──────────────────────────────────────────
  router.get("/ping", (_req, res) => {
    res.json({ success: true, data: { pong: true, time: Date.now() } });
  });

  // ── 会话列表 ──────────────────────────────────────────────
  router.get("/sessions", (_req, res) => {
    const sessions = sessionStore.list().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }));
    res.json({ success: true, data: sessions });
  });

  // ── 会话详情 ──────────────────────────────────────────────
  router.get("/sessions/:id", (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: "会话不存在" });
      return;
    }
    res.json({ success: true, data: session });
  });

  // ── 创建会话 ──────────────────────────────────────────────
  router.post("/sessions", (req, res) => {
    const id = req.body?.id || randomUUID();
    const title = req.body?.title || "新对话";
    const session = sessionStore.getOrCreate(id);
    if (title !== "新对话") session.title = title;
    res.json({ success: true, data: session });
  });

  // ── 删除会话 ──────────────────────────────────────────────
  router.delete("/sessions/:id", (req, res) => {
    const ok = sessionStore.delete(req.params.id);
    res.json({ success: ok, data: { deleted: ok } });
  });

  // ── 停止生成 ──────────────────────────────────────────────
  router.post("/stop", (_req, res) => {
    clientLangGraphAgent.abort();
    res.json({ success: true, data: { stopped: true } });
  });

  // ── 审批工具调用（手动模式） ──────────────────────────────
  router.post("/approve", (req, res) => {
    const { callId, approved } = req.body ?? {};
    if (!callId || typeof callId !== "string") {
      res.status(400).json({ success: false, error: "缺少 callId 参数" });
      return;
    }
    clientLangGraphAgent.resolveToolApproval(callId, Boolean(approved));
    res.json({ success: true, data: { resolved: true } });
  });

  // ── 服务端能力目录 ──────────────────────────────────────
  router.get("/server-capabilities", async (_req, res) => {
    try {
      const { fetchServerCapabilities } = await import("./server-capabilities");
      const catalog = await fetchServerCapabilities();
      res.json({ success: true, data: catalog });
    } catch (err: any) {
      res.json({ success: false, error: err?.message || String(err), data: { tools: [] } });
    }
  });

  // ── Google Arts 连通性检查 ──────────────────────────────
  router.get("/google-art-health", async (_req, res) => {
    const https = require("https");
    const url = "https://artsandculture.google.com/";
    const startTime = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
          response.resume(); // consume response data
          const elapsed = Date.now() - startTime;
          if (response.statusCode && response.statusCode < 400) {
            resolve();
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        });
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("请求超时"));
        });
        req.on("error", reject);
      });
      res.json({ success: true, data: { reachable: true, elapsedMs: Date.now() - startTime } });
    } catch (err: any) {
      res.json({ success: false, error: err?.message || "Google Arts & Culture 不可达" });
    }
  });

  // ── 发送消息（SSE 流式） ──────────────────────────────────
  router.post("/sessions/:id/messages", async (req, res) => {
    const sessionId = req.params.id;
    const { text, attachments, autoApprove } = req.body ?? {};

    if (!text || typeof text !== "string") {
      res.status(400).json({ success: false, error: "缺少 text 参数" });
      return;
    }

    // 获取或创建会话
    const session = sessionStore.getOrCreate(sessionId);

    // 构造用户消息
    const userMessage: AgentChatMessage = {
      role: "user",
      content: text,
      attachments: attachments || [],
    };
    sessionStore.appendMessage(sessionId, userMessage);

    // 设置 SSE 头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const runId = randomUUID();

    try {
      // 使用现有的完整消息历史
      const historyMessages: AgentChatMessage[] = [...session.messages];

      // 根据请求参数决定是否自动审批（UI 手动模式传 autoApprove=false）
      clientLangGraphAgent.autoApproveWrite = Boolean(autoApprove);

      await clientLangGraphAgent.run(
        historyMessages,
        {
          onReasoning: (delta) => {
            sendEvent("reasoning", { delta });
          },
          onContent: (delta) => {
            sendEvent("content", { delta });
          },
          onToolApproval: (toolCall) => {
            sendEvent("tool_approval", toolCall);
          },
          onToolStart: (toolCall) => {
            sendEvent("tool_start", toolCall);
          },
          onToolEnd: (toolResult) => {
            sendEvent("tool_end", toolResult);
          },
          onComplete: (fullText, fullReasoning) => {
            // 保存助手回复到会话
            const assistantMsg: AgentChatMessage = {
              role: "assistant",
              content: fullText,
              reasoning_content: fullReasoning || undefined,
            };
            sessionStore.appendMessage(sessionId, assistantMsg);
            sendEvent("complete", { fullText, fullReasoning });
            clientLangGraphAgent.autoApproveWrite = false; // 恢复
            res.end();
          },
          onError: (error) => {
            clientLangGraphAgent.autoApproveWrite = false; // 恢复
            sendEvent("error", { error });
            res.end();
          },
        },
        undefined,
        { runId, sessionId },
      );
    } catch (error: any) {
      const message = error?.message || "Agent 执行异常";
      sendEvent("error", { error: message });
      res.end();
    }

    // 客户端断开时停止 agent
    req.on("close", () => {
      clientLangGraphAgent.abort();
    });
  });

  return router;
}
