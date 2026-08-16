/** Agent 专用 IPC。所有流式事件都带 runId/sessionId，避免旧请求污染当前会话。 */
import { ipcMain, type IpcMainEvent } from "electron";
import { clientLangGraphAgent, type AgentChatMessage } from "./langgraph-agent";
import {
  getActiveAgentConfig,
  saveLocalAgentConfig,
  syncCloudAgentConfig,
  type ClientAgentConfig,
} from "./agent-config";

interface AgentRequest {
  runId: string;
  sessionId: string;
  messages: AgentChatMessage[];
  config?: Partial<ClientAgentConfig>;
}

/** Renderer 只需要模型状态，不应获得服务端绑定的 API Key。 */
function publicConfig(config: ClientAgentConfig): ClientAgentConfig {
  return { ...config, apiKey: "" };
}

export function setupAgentIpc(): void {
  ipcMain.handle("agent:get-config", () =>
    publicConfig(getActiveAgentConfig()),
  );
  // 仅保留不影响服务端绑定模型的运行参数；模型、Base URL 与 Key 必须由服务端绑定提供。
  ipcMain.handle(
    "agent:save-config",
    (_event, config: Partial<ClientAgentConfig>) => {
      const saved = saveLocalAgentConfig({
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        systemPrompt: config.systemPrompt,
      });
      return publicConfig(saved);
    },
  );
  ipcMain.handle(
    "agent:sync-cloud-config",
    async (_event, payload: { serverBase: string; token: string }) => {
      const config = await syncCloudAgentConfig(
        payload.serverBase,
        payload.token,
      );
      return publicConfig(config);
    },
  );
  ipcMain.handle("agent:stop", () => {
    clientLangGraphAgent.abort();
    return { success: true };
  });

  ipcMain.on(
    "agent:send-message",
    async (event: IpcMainEvent, request: AgentRequest) => {
      const { runId, sessionId } = request;
      const send = (channel: string, payload: Record<string, unknown> = {}) => {
        if (!event.sender.isDestroyed())
          event.sender.send(channel, { runId, sessionId, ...payload });
      };

      try {
        await clientLangGraphAgent.run(
          request.messages,
          {
            onReasoning: (delta) => send("agent:stream:reasoning", { delta }),
            onContent: (delta) => send("agent:stream:content", { delta }),
            onToolStart: (toolCall) =>
              send("agent:stream:tool_start", toolCall),
            onToolEnd: (toolResult) =>
              send("agent:stream:tool_end", toolResult),
            onComplete: (fullText, fullReasoning) =>
              send("agent:stream:complete", { fullText, fullReasoning }),
            onError: (error) => send("agent:stream:error", { error }),
          },
          request.config,
        );
      } catch (error: any) {
        send("agent:stream:error", {
          error: error?.message || "Agent 执行发生异常",
        });
      }
    },
  );

  console.log("[AgentIPC] Agent IPC 通道已注册");
}
