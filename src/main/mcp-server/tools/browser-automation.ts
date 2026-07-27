/**
 * MCP Tool: browser_invoke
 * 调用客户端浏览器自动化能力
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// 懒加载 auto-browser 模块
let autoBrowserModulePromise: Promise<typeof import('../../auto-browser')> | null = null;

async function getAutoBrowserModule() {
  if (!autoBrowserModulePromise) {
    autoBrowserModulePromise = import('../../auto-browser');
  }
  return autoBrowserModulePromise;
}

export const browserInvokeTool = {
  definition: {
    name: 'browser_invoke',
    description: '调用浏览器自动化功能。可以执行页面操作、数据采集、截图等浏览器任务。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: {
          type: 'string' as const,
          description: 'HTTP 方法（GET、POST 等），默认 GET',
          default: 'GET',
        },
        path: {
          type: 'string' as const,
          description: 'API 路径（如 /api/platforms、/api/crawler 等）',
        },
        query: {
          type: 'object' as const,
          description: '查询参数',
        },
        body: {
          type: 'object' as const,
          description: '请求体（POST/PUT 时使用）',
        },
      },
      required: ['path'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const request = {
      method: (args.method as string) || 'GET',
      path: args.path as string,
      query: args.query as Record<string, any> | undefined,
      body: args.body as any,
    };

    try {
      const mod = await getAutoBrowserModule();
      const response = await mod.invokeAutoBrowserRoute(request);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: response.status,
              ok: response.ok,
              body: response.body,
            }, null, 2),
          },
        ],
        isError: !response.ok,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error?.message || String(error),
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
};
