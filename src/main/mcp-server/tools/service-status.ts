/**
 * MCP Tool: service_status
 * 查询客户端各服务运行状态
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// 懒加载各服务模块
let serverModulePromise: Promise<typeof import('../../server')> | null = null;
let imageToolModulePromise: Promise<typeof import('../../image-tool')> | null = null;
let videoTemplateModulePromise: Promise<typeof import('../../video-template')> | null = null;

async function getServerModule() {
  if (!serverModulePromise) {
    serverModulePromise = import('../../server');
  }
  return serverModulePromise;
}

async function getImageToolModule() {
  if (!imageToolModulePromise) {
    imageToolModulePromise = import('../../image-tool');
  }
  return imageToolModulePromise;
}

async function getVideoTemplateModule() {
  if (!videoTemplateModulePromise) {
    videoTemplateModulePromise = import('../../video-template');
  }
  return videoTemplateModulePromise;
}

export const serviceStatusTool = {
  definition: {
    name: 'service_status',
    description: '查询客户端各服务的运行状态，包括本地服务、图片工具、视频模板、MCP Server 等。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service: {
          type: 'string' as const,
          description: '要查询的服务名称（如 "local"、"image"、"video"、"mcp"），留空则查询所有服务',
        },
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const service = args.service as string | undefined;

    try {
      const status: Record<string, any> = {};

      // 本地服务 (Express :1519)
      if (!service || service === 'local') {
        try {
          const mod = await getServerModule();
          status.local = {
            name: 'Local Service (Express)',
            port: 1519,
            running: mod.isServerRunning(),
          };
        } catch {
          status.local = { name: 'Local Service', running: false, error: '模块未加载' };
        }
      }

      // 图片工具
      if (!service || service === 'image') {
        try {
          const mod = await getImageToolModule();
          const info = await mod.getImageToolStatus();
          status.image = {
            name: 'Image Tool',
            loaded: info?.success ?? false,
            status: info?.status ?? 'unknown',
          };
        } catch {
          status.image = { name: 'Image Tool', loaded: false, error: '模块未加载' };
        }
      }

      // 视频模板
      if (!service || service === 'video') {
        try {
          const mod = await getVideoTemplateModule();
          const info = await mod.getVideoTemplateStatus();
          status.video = {
            name: 'Video Template',
            running: info?.success ?? false,
            status: info?.status ?? 'unknown',
          };
        } catch {
          status.video = { name: 'Video Template', running: false, error: '模块未加载' };
        }
      }

      // MCP Server
      if (!service || service === 'mcp') {
        const { getMcpServerInfo } = await import('../index');
        const info = getMcpServerInfo();
        status.mcp = {
          name: 'MCP Server (SSE)',
          running: info.running,
          port: info.port,
          toolCount: info.toolCount,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
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
