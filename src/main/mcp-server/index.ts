/**
 * MCP Server 模块入口
 * 管理 MCP Server 的生命周期（启动、停止、状态查询）
 */

import { McpServerManager } from './server';
import type { CapabilityCallContext } from '../capabilities/types';

let mcpManager: McpServerManager | null = null;

/**
 * 启动 MCP Server
 */
export async function startMcpServer(port: number = 3210): Promise<void> {
  if (mcpManager?.isRunning()) {
    console.log('[MCP Server] 已在运行中');
    return;
  }
  mcpManager = new McpServerManager(port);
  await mcpManager.start();
}

/**
 * 停止 MCP Server
 */
export async function stopMcpServer(): Promise<void> {
  if (mcpManager) {
    await mcpManager.stop();
    mcpManager = null;
  }
}

/**
 * 检查 MCP Server 是否运行中
 */
export function isMcpServerRunning(): boolean {
  return mcpManager?.isRunning() ?? false;
}

/**
 * 获取 MCP Server 端口
 */
export function getMcpServerPort(): number {
  return mcpManager?.getPort() ?? 3210;
}

/**
 * 获取 MCP Server 信息
 */
export function getMcpServerInfo(): {
  running: boolean;
  port: number;
  toolCount: number;
} {
  if (!mcpManager) {
    return { running: false, port: 3210, toolCount: 0 };
  }
  return mcpManager.getInfo();
}

/**
 * 执行 MCP 工具
 */
export async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, any> = {},
  context?: CapabilityCallContext,
): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
  if (!mcpManager) {
    return {
      content: [{ type: 'text', text: 'MCP Server 未运行' }],
      isError: true,
    };
  }
  return mcpManager.callTool(toolName, toolArgs, context);
}

/**
 * 列出所有可用的 MCP 工具
 */
export function listMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}> {
  if (!mcpManager) {
    return [];
  }
  return mcpManager.listTools();
}
