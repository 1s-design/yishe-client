/**
 * 客户端自研 LangGraph Agent 远程可控能力注册。
 *
 * 注册到 CapabilityRegistry 后，design-server 工作流或后台可直接远程：
 * - clientAgent.status  查询客户端多 Agent 并发状态、运行中任务与最近记录
 * - clientAgent.run     并发派发一条客户端 Agent 思考/执行任务（支持 media_ops 等 Profile）
 * - clientAgent.stop    按 runId 精准中止某条正在运行的客户端 Agent 任务
 */
import { z } from "zod";
import { randomUUID } from "crypto";
import { BrowserWindow } from "electron";
import { CapabilityRegistry } from "./registry";
import {
  clientLangGraphAgent,
  type AgentProfileId,
} from "../agent/langgraph-agent";
import { sessionStore } from "../agent/session-store";
import { AGENT_PROFILES } from "../agent/profiles";
import type { AgentChatMessage } from "../agent/types";

function notifySessionsUpdated(sessionId: string): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("agent:sessions-updated", { sessionId });
      }
    }
  } catch {
    // 非 GUI/单测环境忽略
  }
}

export function registerClientAgentCapabilities(): void {
  CapabilityRegistry.register({
    namespace: "clientAgent",
    name: "status",
    description:
      "查询客户端自研 Agent 实时运行态（模型、并发数、正在运行的多个 Agent 任务与最近执行记录）",
    argsSchema: z.object({}),
    riskLevel: "read",
    handler: async () => {
      return {
        success: true,
        data: clientLangGraphAgent.getRuntimeStatus(),
      };
    },
  });

  CapabilityRegistry.register({
    namespace: "clientAgent",
    name: "run",
    description:
      "在客户端本地并发执行一条自研 LangGraph Agent 思考/编排任务（不占用服务端 Agent 资源）",
    argsSchema: z.object({
      prompt: z.string().min(1).describe("任务指令内容"),
      profile: z
        .enum(["default", "media_ops", "google_art"])
        .optional()
        .describe("场景 Profile，媒体运营推荐传 media_ops"),
      sessionId: z.string().optional().describe("可选会话 ID"),
      autoApproveWrite: z
        .boolean()
        .optional()
        .default(true)
        .describe("后台远程任务是否自动放行写操作，默认 true"),
      maxIterations: z.number().int().min(1).max(20).optional(),
    }),
    riskLevel: "write",
    handler: async (args, context) => {
      const runId = context?.runId || randomUUID();
      const sessionId = args.sessionId || `remote_${runId}`;
      const profileId = (args.profile as AgentProfileId | undefined) || "default";
      const profileLabel = AGENT_PROFILES[profileId]?.label || profileId;

      // 写入本地 sessionStore，使客户端「AI 对话」列表可直接看到远程派发的完整对话与工具记录
      const session = sessionStore.getOrCreate(sessionId);
      if (session.messages.length === 0) {
        const snippet = args.prompt.replace(/\s+/g, " ").trim().slice(0, 28);
        session.title = `[远程 · ${profileLabel}] ${snippet || "任务"}`;
      }
      sessionStore.appendMessage(sessionId, {
        role: "user",
        content: args.prompt,
      });
      notifySessionsUpdated(sessionId);

      const recordedToolCalls: NonNullable<AgentChatMessage["toolCalls"]> = [];

      try {
        const historyMessages: AgentChatMessage[] = [...session.messages];
        const result = await clientLangGraphAgent.run(
          historyMessages,
          {
            onToolStart: (toolCall) => {
              recordedToolCalls.push({
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args || {},
                status: "running",
              });
            },
            onToolEnd: (toolResult) => {
              const target = recordedToolCalls.find(
                (t) => t.id === toolResult.id,
              );
              if (target) {
                target.result = toolResult.result;
                target.durationMs = toolResult.durationMs;
                target.error = toolResult.error;
                target.status = toolResult.error ? "error" : "success";
              }
            },
          },
          undefined,
          { runId, sessionId },
          {
            profile: args.profile as AgentProfileId | undefined,
            autoApproveWrite: args.autoApproveWrite !== false,
            maxIterations: args.maxIterations,
          },
        );

        sessionStore.appendMessage(sessionId, {
          role: "assistant",
          content: result.text,
          reasoning_content: result.reasoning || undefined,
          toolCalls: recordedToolCalls.length ? recordedToolCalls : undefined,
        });
        notifySessionsUpdated(sessionId);

        return {
          success: true,
          data: {
            runId,
            sessionId,
            text: result.text,
            reasoning: result.reasoning,
            usage: (result as any).usage,
          },
        };
      } catch (err: any) {
        const errMsg = err?.message || "客户端 Agent 执行失败";
        sessionStore.appendMessage(sessionId, {
          role: "assistant",
          content: `[远程执行失败] ${errMsg}`,
          toolCalls: recordedToolCalls.length ? recordedToolCalls : undefined,
        });
        notifySessionsUpdated(sessionId);
        return {
          success: false,
          error: errMsg,
        };
      }
    },
  });

  CapabilityRegistry.register({
    namespace: "clientAgent",
    name: "stop",
    description: "中止客户端上正在运行的指定 Agent 任务（不传 runId 则中止全部）",
    argsSchema: z.object({
      runId: z.string().optional().describe("要中止的 runId，留空则中止全部运行中任务"),
    }),
    riskLevel: "write",
    handler: async (args) => {
      clientLangGraphAgent.abort(args.runId);
      return {
        success: true,
        data: {
          stopped: true,
          runId: args.runId || null,
          activeCount: clientLangGraphAgent.getActiveRunCount(),
        },
      };
    },
  });
}
