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
import { writeClientLog } from '../clientLogger';
import { listOperationDefinitions } from '../image-tool/legacy/operation-registry.js';
import { browserTools } from './tools/browser-tools';
import { googleArtSearchTool } from './tools/google-art-search';
import { googleArtDownloadTool } from './tools/google-art-download';
import { googleArtCollectTool } from './tools/google-art-collect';

type ToolCapability = {
  key: string;
  label: string;
  description?: string;
  inputSchema?: Record<string, any>;
  aliases?: string[];
};

export function zodToJsonSchema(schema: any): Record<string, any> {
  let current = schema;
  let optional = false;
  while (current?._def?.typeName === 'ZodOptional' || current?._def?.typeName === 'ZodDefault') {
    optional = true;
    current = current._def.innerType;
  }
  const typeName = current?._def?.typeName;
  const result: Record<string, any> = {};
  if (typeName === 'ZodString') result.type = 'string';
  else if (typeName === 'ZodNumber') result.type = 'number';
  else if (typeName === 'ZodBoolean') result.type = 'boolean';
  else if (typeName === 'ZodArray') {
    result.type = 'array';
    result.items = zodToJsonSchema(current._def.type);
  } else if (typeName === 'ZodEnum') {
    result.type = 'string';
    result.enum = current._def.values;
  } else if (typeName === 'ZodObject') {
    result.type = 'object';
    result.properties = Object.fromEntries(
      Object.entries(current._def.shape()).map(([key, value]) => [key, zodToJsonSchema(value)]),
    );
  } else {
    result.type = 'object';
  }
  if (current?._def?.description) result.description = current._def.description;
  if (optional) result.optional = true;
  return result;
}

function zodShapeToInputSchema(shape: Record<string, any>): Record<string, any> {
  const properties = Object.fromEntries(
    Object.entries(shape || {}).map(([key, value]) => [key, zodToJsonSchema(value)]),
  );
  return { type: 'object', properties };
}

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
  category?: string;
  capability?: { key: string; label: string; description?: string };
  operations?: ToolCapability[];
  actions?: ToolCapability[];
  handler: (args: Record<string, any>) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

export class McpServerManager {
  private serverFactory: (() => Promise<McpServer>) | null = null;
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
  private createServerFactory(): () => Promise<McpServer> {
    return async () => {
      const server = new McpServer(
        { name: 'yishe-client-mcp', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      // 注册客户端服务状态工具
      server.tool(
        serviceStatusTool.definition.name,
        serviceStatusTool.definition.description,
        {
          service: z.string().optional().describe('要查询的服务名称，留空则查询所有服务'),
        },
        async (args) => serviceStatusTool.execute(args) as any,
      );
      this.toolRegistry.set(serviceStatusTool.definition.name, {
        name: serviceStatusTool.definition.name,
        description: serviceStatusTool.definition.description,
        inputSchema: serviceStatusTool.definition.inputSchema,
        category: 'system',
        capability: { key: 'service_status', label: '本地服务状态', description: '查询客户端本地服务健康状态。' },
        handler: async (args) => serviceStatusTool.execute(args) as any,
      });

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
          category: 'hotsearch',
          capability: { key: 'platform_hotsearch', label: '平台热搜采集', description: '采集指定平台的热搜数据。' },
          actions: [{ key, label: `${key} 热搜采集`, description: config.description }],
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
        category: 'hotsearch',
        capability: { key: 'platform_hotsearch', label: '全平台热搜采集', description: '并发采集所有启用平台热搜。' },
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
        category: 'image',
        capability: {
          key: 'image_processing',
          label: '图片处理执行器',
          description: '按顺序执行多个图片处理操作。',
        },
        operations: listOperationDefinitions().map((operation: any) => ({
          key: operation.type,
          label: operation.description || operation.type,
          description: operation.description,
          inputSchema: operation.jsonSchemaParams,
          aliases: operation.aliases,
        })),
        handler: async (args) => {
          const { executeImageToolPlan } = await import('./tools/image-processing');
          return executeImageToolPlan(args as any);
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
        category: 'video',
        capability: {
          key: 'video_rendering',
          label: '视频渲染执行器',
          description: '提交视频渲染、查询任务和 AI 视频生成。',
        },
        actions: [
          { key: 'render', label: '模板渲染', description: '使用模板提交渲染任务。' },
          { key: 'status', label: '查询状态', description: '查询渲染任务状态。' },
          { key: 'list', label: '任务列表', description: '查看渲染任务列表。' },
          { key: 'catalog', label: '模板目录', description: '查看可用视频模板。' },
          { key: 'ai-generate', label: 'AI 模板生成', description: '根据描述匹配模板并生成视频。' },
          { key: 'ai-free-generate', label: 'AI 自由编排', description: '根据自然语言生成 SceneGraph 视频。' },
        ],
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
          skillPrompt: z.string().optional().describe('匹配到的 Skill 指引（包含 goal 和 agentPrompt）'),
        },
        async (args) => {
          const { browserAgentTool } = await import('./tools/browser-agent');
          return browserAgentTool.execute(args as any) as any;
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
          skillPrompt: { type: 'string', optional: true },
        },
        category: 'browser',
        capability: { key: 'browser_intelligent_automation', label: '浏览器智能操作', description: '使用 browser-use 执行复杂网页任务。' },
        actions: [
          { key: 'navigate', label: '网页导航' },
          { key: 'interact', label: '点击与输入' },
          { key: 'understand', label: '页面理解' },
          { key: 'extract', label: '网页采集' },
        ],
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
          body: z.record(z.string(), z.any()).optional().describe('请求体'),
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
        category: 'browser',
        capability: { key: 'browser_lifecycle', label: '浏览器生命周期', description: '启动、关闭和查询本地浏览器。' },
        actions: [
          { key: 'connect', label: '连接或启动浏览器' },
          { key: 'status', label: '查询浏览器状态' },
          { key: 'close', label: '关闭浏览器' },
          { key: 'pages', label: '查询页面列表' },
        ],
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
        const browserDefinition = browserTools.find((tool) => tool.name === toolName);
        server.tool(
          toolName,
          browserDefinition?.description || `浏览器操作: ${toolName}`,
          (browserDefinition?.schema || {}) as any,
          async (args) => {
            const { browserToolMap } = await import('./tools/browser-tools');
            const tool = browserToolMap.get(toolName);
            if (!tool) return { content: [{ type: 'text' as const, text: `工具 ${toolName} 不存在` }], isError: true };
            return (await tool.execute(args as any)) as any;
          }
        );
        this.toolRegistry.set(toolName, {
          name: toolName,
          description: browserDefinition?.description || `浏览器操作: ${toolName}`,
          inputSchema: zodShapeToInputSchema(browserDefinition?.schema || {}),
          category: 'browser',
          capability: { key: 'browser_page_actions', label: '浏览器页面操作', description: '对当前页面执行单步交互。' },
          actions: [{
            key: toolName.replace(/^browser_/, ''),
            label: toolName.replace(/^browser_/, ''),
            description: browserDefinition?.description,
            inputSchema: zodShapeToInputSchema(browserDefinition?.schema || {}),
          }],
          handler: async (args) => {
            const { browserToolMap } = await import('./tools/browser-tools');
            const tool = browserToolMap.get(toolName);
            if (!tool) return { content: [{ type: 'text', text: `工具 ${toolName} 不存在` }], isError: true };
            return tool.execute(args as any);
          },
        });



      }

      // 注册 Google Art 采集工具
      try {
        const googleArtSearchSchema = {
          keyword: z.string().describe('搜索关键词（英文效果更佳，如 "van gogh"、"impressionism"）。'),
          page: z.number().optional().describe('页码，从 1 开始（每页约 60 条）。默认 1。'),
          maxCount: z.number().optional().describe('最多返回多少条结果（在分页基础上截断）。默认不限制。'),
          hl: z.string().optional().describe('语言代码，默认 "en"。'),
        };

        const googleArtDownloadSchema = {
          url: z.string().describe('Google Arts 作品链接。'),
          zoomLevel: z.number().optional().describe('分辨率级别。不传则自动选择最高分辨率。'),
          autoMax: z.boolean().optional().describe('是否自动选择最高分辨率，默认 true。'),
        };

        const googleArtCollectSchema = {
          keyword: z.string().describe('搜索关键词（英文效果更佳，如 "van gogh"、"impressionism"）。'),
          maxCount: z.number().optional().describe('采集数量，默认 10，最大 50。'),
          autoMax: z.boolean().optional().describe('是否自动选择最高分辨率，默认 true。'),
        };

        const schemasMap: Record<string, any> = {
          google_art_search: googleArtSearchSchema,
          google_art_download: googleArtDownloadSchema,
          google_art_collect: googleArtCollectSchema,
        };

        for (const toolDef of [googleArtSearchTool, googleArtDownloadTool, googleArtCollectTool]) {
          const toolName = toolDef.definition.name;
          const schema = schemasMap[toolName];

          server.tool(
            toolName,
            toolDef.definition.description,
            schema,
            async (args) => toolDef.execute(args) as any
          );
          this.toolRegistry.set(toolName, {
            name: toolName,
            description: toolDef.definition.description,
            inputSchema: toolDef.definition.inputSchema,
            category: 'google_art',
            handler: async (args) => toolDef.execute(args) as any,
          });
        }
        writeClientLog({
          level: 'INFO',
          module: 'mcp-server',
          message: '已注册 3 个 Google Art 工具',
        });
      } catch (e) {
        writeClientLog({
          level: 'ERROR',
          module: 'mcp-server',
          message: `Google Art 工具注册失败: ${(e as Error)?.message}`,
          context: { error: String(e), stack: (e as Error)?.stack },
        });
      }


      // 注册通用客户端能力工具
      try {
        const { getCapabilityMcpTools } = await import('../capabilities/bridge');
        const capTools = getCapabilityMcpTools();
        for (const capTool of capTools) {
          server.tool(
            capTool.name,
            capTool.description,
            capTool.inputSchema as any,
            async (args) => capTool.handler(args) as any
          );
          this.toolRegistry.set(capTool.name, {
            name: capTool.name,
            description: capTool.description,
            inputSchema: capTool.inputSchema,
            category: capTool.category,
            handler: capTool.handler,
          });
        }
        console.log(`[MCP Server] 已注册 ${capTools.length} 个通用能力工具`);
      } catch (e) {
        console.warn('[MCP Server] 通用能力注册失败:', (e as Error)?.message);
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
      await this.serverFactory();
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
    this.app.get('/sse', async (_req, res) => {
      console.log('[MCP Server] 新的 SSE 连接');

      // 关闭旧连接
      if (this.transport) {
        try { this.transport = null; } catch {}
      }

      // 为每个连接创建新的 McpServer 实例
      const server = await this.serverFactory!();
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
    this.app.get('/health', (_req, res) => {
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
        console.log(`[MCP Server] 已启动，监听 http://127.0.0.1:${this.port}`);
        console.log(`[MCP Server] 已注册 ${this.toolRegistry.size} 个工具`);
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
    return {
      running: this.running,
      port: this.port,
      toolCount: this.toolRegistry.size,
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

  listTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    category?: string;
    capability?: RegisteredTool['capability'];
    operations?: ToolCapability[];
    actions?: ToolCapability[];
  }> {
    return Array.from(this.toolRegistry.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
      capability: tool.capability,
      operations: tool.operations,
      actions: tool.actions,
    }));
  }
}
