/**
 * MCP SSE Server 核心实现
 * 基于 @modelcontextprotocol/sdk v1.29 提供 SSE 传输的 MCP Server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import express from 'express';
import type { Server as HttpServer } from 'http';
import { createServer } from 'http';

import {
  getAllPlatformConfigs,
  executePlatformCollect,
  executeAllPlatformCollect,
} from './tools/hotsearch-platforms';
import { getTokenValue } from '../server';

let serviceStatusTool: any = null;

async function loadTools() {
  if (!serviceStatusTool) {
    serviceStatusTool = (await import('./tools/service-status')).serviceStatusTool;
  }
}

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: Record<string, any>) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

export class McpServerManager {
  private serverFactory: (() => McpServer) | null = null;
  private httpServer: HttpServer | null = null;
  private transport: SSEServerTransport | null = null;
  private app: express.Express | null = null;
  private running = false;
  private port: number;
  private toolRegistry = new Map<string, RegisteredTool>();

  constructor(port: number = 3210) {
    this.port = port;
  }

  /**
   * 创建 McpServer 工厂函数，每次连接创建新实例
   */
  private createServerFactory(): () => McpServer {
    return () => {
      const server = new McpServer(
        { name: 'yishe-client-mcp', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      // 注册平台采集工具
      const platforms = getAllPlatformConfigs();
      for (const [key, config] of Object.entries(platforms)) {
        const toolName = `hotsearch_${key}`;
        server.tool(
          toolName,
          config.description,
          {
            reportToServer: z.boolean().optional().describe('是否上报到服务端，默认 true'),
          },
          async (args) => {
            return await executePlatformCollect(key, args.reportToServer ?? true);
          }
        );
        this.toolRegistry.set(toolName, {
          name: toolName,
          description: config.description,
          inputSchema: { reportToServer: { type: 'boolean', optional: true } },
          handler: async (args) => executePlatformCollect(key, args.reportToServer ?? true),
        });
      }

      // 注册全平台采集工具
      server.tool(
        'hotsearch_collect_all',
        '采集所有启用平台的热搜数据（并发采集）',
        {
          platforms: z.array(z.string()).optional().describe('指定平台 key 列表，留空则采集所有启用平台'),
          reportToServer: z.boolean().optional().describe('是否上报到服务端，默认 true'),
        },
        async (args) => {
          return executeAllPlatformCollect(args.platforms, args.reportToServer ?? true);
        }
      );
      this.toolRegistry.set('hotsearch_collect_all', {
        name: 'hotsearch_collect_all',
        description: '采集所有启用平台的热搜数据（并发采集）',
        inputSchema: { platforms: { type: 'array', items: { type: 'string' }, optional: true }, reportToServer: { type: 'boolean', optional: true } },
        handler: async (args) => executeAllPlatformCollect(args.platforms, args.reportToServer ?? true),
      });

      // 注册 AI 图片处理 MCP 工具
      server.tool(
        'image_process_execute',
        '编程式执行图片处理操作链（如缩放、裁剪、水印、低多边形、滤镜等），方便 AI 直接调用',
        {
          imageUrl: z.string().describe('待处理的远程图片 URL 地址'),
          operations: z
            .array(
              z.object({
                type: z.string().describe('操作类型，如 resize, watermark, lowpoly, sepia, crop 等'),
                params: z.record(z.string(), z.any()).optional().describe('操作参数对象'),
              })
            )
            .optional()
            .describe('按顺序排列的处理操作链'),
          processorId: z.string().optional().describe('图像引擎 ID，如 imagemagick, sharp'),
        },
        async (args) => {
          const { executeImageToolPlan } = await import('./tools/image-processing');
          return await executeImageToolPlan(args);
        }
      );
      this.toolRegistry.set('image_process_execute', {
        name: 'image_process_execute',
        description: '编程式执行图片处理操作链（如缩放、裁剪、水印、低多边形、滤镜等），方便 AI 直接调用',
        inputSchema: {
          imageUrl: { type: 'string' },
          operations: { type: 'array', optional: true },
          processorId: { type: 'string', optional: true },
        },
        handler: async (args) => {
          const { executeImageToolPlan } = await import('./tools/image-processing');
          return executeImageToolPlan(args);
        },
      });

      // 注册 Remotion 视频渲染 MCP 工具
      server.tool(
        'video_render_execute',
        'Remotion 视频渲染工具：提交视频渲染任务、查询状态、列出模板。支持两种AI模式：ai-generate（模板填充）和 ai-free-generate（自由编排SceneGraph）',
        {
          templateId: z.string().optional().describe('视频模板 ID'),
          inputProps: z.record(z.string(), z.any()).optional().describe('模板输入参数'),
          action: z.enum(['render', 'status', 'list', 'catalog', 'ai-generate', 'ai-free-generate']).optional().describe('render=渲染, status=查状态, list=列任务, catalog=列模板, ai-generate=AI模板填充, ai-free-generate=AI自由编排SceneGraph'),
          jobId: z.string().optional().describe('任务ID（action=status 时必填）'),
          prompt: z.string().optional().describe('自然语言描述（action=ai-generate/ai-free-generate 时必填）'),
          width: z.number().optional().describe('视频宽度px（action=ai-free-generate 时可选，默认竖屏1080）'),
          height: z.number().optional().describe('视频高度px（action=ai-free-generate 时可选，默认竖屏1920）'),
        },
        async (args) => {
          const { executeVideoRender } = await import('./tools/video-rendering');
          return await executeVideoRender(args);
        }
      );
      this.toolRegistry.set('video_render_execute', {
        name: 'video_render_execute',
        description: 'Remotion 视频渲染工具：提交视频渲染任务、查询状态、列出模板',
        inputSchema: {
          templateId: { type: 'string', optional: true },
          inputProps: { type: 'object', optional: true },
          action: { type: 'string', optional: true },
          jobId: { type: 'string', optional: true },
          prompt: { type: 'string', optional: true },
          width: { type: 'number', optional: true },
          height: { type: 'number', optional: true },
        },
        handler: async (args) => {
          const { executeVideoRender } = await import('./tools/video-rendering');
          return executeVideoRender(args);
        },
      });

      // 注册浏览器自动化 Agent MCP 工具
      server.tool(
        'browser_agent_execute',
        'AI 浏览器自动化 Agent：使用自然语言描述任务，browser-use 会自动操作浏览器完成。支持导航、点击、输入、采集数据、截图等。需要浏览器已启动。',
        {
          task: z.string().describe('要执行的浏览器任务描述'),
          apiKey: z.string().describe('AI API Key'),
          baseUrl: z.string().describe('AI API Base URL'),
          model: z.string().describe('AI 模型名称'),
          maxSteps: z.number().optional().describe('最大执行步数，默认 25'),
        },
        async (args) => {
          const { browserAgentTool } = await import('./tools/browser-agent');
          return browserAgentTool.execute(args as any);
        }
      );
      this.toolRegistry.set('browser_agent_execute', {
        name: 'browser_agent_execute',
        description: 'AI 浏览器自动化 Agent：使用自然语言描述任务，browser-use 会自动操作浏览器完成。支持导航、点击、输入、采集数据、截图等。需要浏览器已启动。',
        inputSchema: {
          task: { type: 'string' },
          apiKey: { type: 'string' },
          baseUrl: { type: 'string' },
          model: { type: 'string' },
          maxSteps: { type: 'number', optional: true },
        },
        handler: async (args) => {
          const { browserAgentTool } = await import('./tools/browser-agent');
          return browserAgentTool.execute(args as any);
        },
      });

      // 注册浏览器自动化调用工具
      server.tool(
        'browser_invoke',
        '调用浏览器自动化功能。可以启动/关闭浏览器、查看状态、执行页面操作等。支持的路径：/api/browser/status, /api/browser/connect, /api/browser/close',
        {
          method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP 方法，默认 GET'),
          path: z.string().describe('API 路径，如 /api/browser/connect'),
          body: z.record(z.any()).optional().describe('请求体'),
        },
        async (args) => {
          const { browserInvokeTool } = await import('./tools/browser-automation');
          return browserInvokeTool.execute(args as any);
        }
      );
      this.toolRegistry.set('browser_invoke', {
        name: 'browser_invoke',
        description: '调用浏览器自动化功能。可以启动/关闭浏览器、查看状态、执行页面操作等。',
        inputSchema: {
          method: { type: 'string', optional: true },
          path: { type: 'string' },
          body: { type: 'object', optional: true },
        },
        handler: async (args) => {
          const { browserInvokeTool } = await import('./tools/browser-automation');
          return browserInvokeTool.execute(args as any);
        },
      });

      // 注册独立的浏览器操作工具
      const browserToolNames = [
        'browser_navigate', 'browser_click', 'browser_type', 'browser_get_text',
        'browser_screenshot', 'browser_get_url', 'browser_wait', 'browser_scroll',
        'browser_hover', 'browser_press_key', 'browser_select', 'browser_eval',
        'browser_scrape_list',
      ];
      for (const toolName of browserToolNames) {
        server.tool(
          toolName,
          `浏览器操作: ${toolName}`,
          {},
          async (args) => {
            const { browserToolMap } = await import('./tools/browser-tools');
            const tool = browserToolMap.get(toolName);
            if (!tool) return { content: [{ type: 'text', text: `工具 ${toolName} 不存在` }], isError: true };
            return tool.execute(args as any);
          }
        );
        this.toolRegistry.set(toolName, {
          name: toolName,
          description: `浏览器操作: ${toolName}`,
          inputSchema: {},
          handler: async (args) => {
            const { browserToolMap } = await import('./tools/browser-tools');
            const tool = browserToolMap.get(toolName);
            if (!tool) return { content: [{ type: 'text', text: `工具 ${toolName} 不存在` }], isError: true };
            return tool.execute(args as any);
          },
        });
      }

      return server;
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    console.log(`[MCP Server] 正在启动，端口: ${this.port}`);

    await loadTools();
    this.serverFactory = this.createServerFactory();

    // 启动时立即创建一个 server 实例，注册所有工具到 toolRegistry
    try {
      this.serverFactory();
    } catch (e) {
      console.warn('[MCP Server] 预注册工具时忽略连接错误:', (e as Error)?.message);
    }

    // 创建 Express 应用
    this.app = express();

    // 消息端点 - 必须在 json 中间件之前，保留原始 stream
    this.app.post('/messages', async (req, res) => {
      if (!this.transport) {
        res.status(400).json({ error: 'No active SSE connection' });
        return;
      }
      await this.transport.handlePostMessage(req, res);
    });

    // JSON 中间件（仅用于其他路由）
    this.app.use(express.json());

    // SSE 端点 - 每次连接创建新的 McpServer 实例
    this.app.get('/sse', async (req, res) => {
      console.log('[MCP Server] 新的 SSE 连接');

      // 关闭旧连接
      if (this.transport) {
        try { this.transport = null; } catch {}
      }

      // 为每个连接创建新的 McpServer 实例
      const server = this.serverFactory!();
      const transport = new SSEServerTransport('/messages', res);
      this.transport = transport;

      await server.connect(transport);

      transport.onclose = () => {
        console.log('[MCP Server] SSE 连接已关闭');
        if (this.transport === transport) {
          this.transport = null;
        }
      };
    });

    // 健康检查
    this.app.get('/health', (req, res) => {
      const platformNames = Object.keys(getAllPlatformConfigs());
      const registeredTools = Array.from(this.toolRegistry.keys());
      res.json({
        status: 'ok',
        server: 'yishe-client-mcp',
        version: '1.0.0',
        tools: registeredTools.length > 0 ? registeredTools : [
          ...platformNames.map((k) => `hotsearch_${k}`),
          'hotsearch_collect_all',
          'browser_invoke',
          'service_status',
          'image_process_execute',
          'video_render_execute',
        ],
      });
    });

    this.httpServer = createServer(this.app);

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.port, '127.0.0.1', () => {
        const platformCount = Object.keys(getAllPlatformConfigs()).length;
        console.log(`[MCP Server] 已启动，监听 http://127.0.0.1:${this.port}`);
        console.log(`[MCP Server] 已注册 ${platformCount} 个平台采集工具 + 3 个通用工具`);
        this.running = true;
        resolve();
      });
      this.httpServer!.on('error', (err) => {
        console.error('[MCP Server] 启动失败:', err);
        reject(err);
      });
    });

    // 启动后异步获取 AI 配置并推送给 Python 浏览器服务
    // token 可能在 MCP Server 启动时尚未注入，需要等待
    this.fetchAndPushAiConfigWithRetry().catch((err) => {
      console.warn('[MCP Server] 推送 AI 配置失败（非致命）:', err?.message || err);
    });
  }

  /**
   * 从服务端获取 AI 运行时配置，推送给 Python 浏览器服务
   */
  private async fetchAndPushAiConfig(): Promise<void> {
    const token = getTokenValue();
    if (!token) {
      console.warn('[MCP Server] 无 token，跳过 AI 配置推送');
      return;
    }

    try {
      const resp = await fetch(
        'http://localhost:1521/api/ai/runtime-config?featureCode=ai.client-agent.execute',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = (await resp.json()) as any;
      if (!json?.status || !json?.data) {
        console.warn('[MCP Server] 获取 AI 配置失败:', json?.message || '未知错误');
        return;
      }
      const { apiKey, baseURL, model } = json.data;
      if (!apiKey || !baseURL || !model) {
        console.warn('[MCP Server] AI 配置不完整，跳过推送');
        return;
      }

      // 探测客户端浏览器 CDP 端口
      let cdpUrl = '';
      for (const port of [9333, 9334, 9222]) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) { cdpUrl = `http://127.0.0.1:${port}`; break; }
        } catch {}
      }

      // 推送给 Python 浏览器服务
      const pushBody: Record<string, any> = { api_key: apiKey, base_url: baseURL, model };
      if (cdpUrl) pushBody.cdp_url = cdpUrl;
      const pushResp = await fetch('http://127.0.0.1:1596/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushBody),
      });
      const pushJson = (await pushResp.json()) as any;
      if (pushJson?.status === 'ok') {
        console.log('[MCP Server] AI 配置已推送给浏览器服务', { model, baseURL });
      } else {
        console.warn('[MCP Server] 推送配置响应异常:', pushJson);
      }
    } catch (err) {
      console.warn('[MCP Server] 推送 AI 配置失败:', (err as Error)?.message || err);
    }
  }

  /**
   * 带重试的配置推送 — 等待 token 就绪
   */
  private async fetchAndPushAiConfigWithRetry(): Promise<void> {
    const maxRetries = 10;
    const intervalMs = 2000;
    for (let i = 0; i < maxRetries; i++) {
      const token = getTokenValue();
      if (token) {
        await this.fetchAndPushAiConfig();
        return;
      }
      console.log(`[MCP Server] 等待 token 注入 (${i + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    console.warn('[MCP Server] 等待 token 超时，跳过 AI 配置推送');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    console.log('[MCP Server] 正在停止...');
    if (this.transport) {
      this.transport = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          console.log('[MCP Server] 已停止');
          this.running = false;
          resolve();
        });
      });
    }
    this.httpServer = null;
    this.app = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    return this.port;
  }

  getInfo(): { running: boolean; port: number; toolCount: number } {
    const platformCount = Object.keys(getAllPlatformConfigs()).length;
    return {
      running: this.running,
      port: this.port,
      toolCount: platformCount + 3, // 平台工具 + collect_all + browser + status
    };
  }

  async callTool(
    toolName: string,
    toolArgs: Record<string, any> = {},
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
        isError: true,
      };
    }
    try {
      return await tool.handler(toolArgs);
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: error?.message || String(error) }],
        isError: true,
      };
    }
  }

  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, any> }> {
    return Array.from(this.toolRegistry.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }
}
