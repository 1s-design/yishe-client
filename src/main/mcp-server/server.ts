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
import { registerAllCapabilities } from '../capabilities';
import { CapabilityRegistry } from '../capabilities/registry';
import type { CapabilityCallContext } from '../capabilities/types';

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

function getZodObjectShape(schema: any): Record<string, any> {
  if (!schema) return {};
  if (schema.shape && typeof schema.shape === 'object') return schema.shape;
  if (typeof schema?._def?.shape === 'function') return schema._def.shape();
  if (schema?._def?.shape && typeof schema._def.shape === 'object') return schema._def.shape;
  return {};
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
  readOnly?: boolean;
  executionMode?: 'read_only' | 'safe_write' | 'confirm_required';
  riskLevel?: 'low' | 'medium' | 'high';
  confirmRequired?: boolean;
  plannerEnabled?: boolean;
  handler: (args: Record<string, any>, context?: CapabilityCallContext) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

type McpToolRegistration = RegisteredTool & {
  /** MCP SDK 的 Zod raw shape；inputSchema 是同一份定义的 JSON 视图。 */
  zodShape?: Record<string, any>;
};

export class McpServerManager {
  private serverFactory: (() => Promise<McpServer>) | null = null;
  private httpServer: HttpServer | null = null;
  private transport: SSEServerTransport | null = null;
  private app: express.Express | null = null;
  private running = false;
  private port: number;
  private toolRegistry = new Map<string, RegisteredTool>();
  private readonly namesByServer = new WeakMap<object, Set<string>>();

  constructor(port: number = 3210) {
    this.port = port;
  }

  /**
   * MCP 协议注册和运行时目录必须共用同一个定义，禁止出现
   * server.tool(...) 与 toolRegistry.set(...) 两套容易漂移的 schema/handler。
   */
  private registerTool(server: McpServer, definition: McpToolRegistration): void {
    const names = this.namesByServer.get(server) || new Set<string>();
    if (names.has(definition.name)) {
      throw new Error(`MCP 工具重复注册: ${definition.name}`);
    }
    names.add(definition.name);
    this.namesByServer.set(server, names);
    server.tool(
      definition.name,
      definition.description,
      (definition.zodShape || {}) as any,
      async (args) => definition.handler(args as Record<string, any>) as any,
    );
    this.toolRegistry.set(definition.name, {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      category: definition.category,
      capability: definition.capability,
      operations: definition.operations,
      actions: definition.actions,
      readOnly: definition.readOnly,
      executionMode: definition.executionMode,
      riskLevel: definition.riskLevel,
      confirmRequired: definition.confirmRequired,
      plannerEnabled: definition.plannerEnabled,
      handler: definition.handler,
    });
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
      this.registerTool(server, {
        name: serviceStatusTool.definition.name,
        description: serviceStatusTool.definition.description,
        zodShape: {
          service: z.string().optional().describe('要查询的服务名称，留空则查询所有服务'),
        },
        inputSchema: serviceStatusTool.definition.inputSchema,
        category: 'system',
        capability: { key: 'service_status', label: '本地服务状态', description: '查询客户端本地服务健康状态。' },
        handler: async (args) => serviceStatusTool.execute(args) as any,
      });

      // 注册平台采集工具
      const platforms = getAllPlatformConfigs();
      for (const [key, config] of Object.entries(platforms)) {
        const toolName = `hotsearch_${key}`;
        this.registerTool(server, {
          name: toolName,
          description: config.description,
          zodShape: {
            reportToServer: z.boolean().optional().describe('是否上报到服务端，默认 true'),
          },
          inputSchema: { reportToServer: { type: 'boolean', optional: true } },
          category: 'hotsearch',
          capability: { key: 'platform_hotsearch', label: '平台热搜采集', description: '采集指定平台的热搜数据。' },
          actions: [{ key, label: `${key} 热搜采集`, description: config.description }],
          handler: async (args) => executePlatformCollect(key, args.reportToServer ?? true),
        });
      }

      // 注册全平台采集工具
      this.registerTool(server, {
        name: 'hotsearch_collect_all',
        description: '采集所有启用平台的热搜数据（并发采集）',
        zodShape: {
          platforms: z.array(z.string()).optional().describe('指定平台 key 列表，留空则采集所有启用平台'),
          reportToServer: z.boolean().optional().describe('是否上报到服务端，默认 true'),
        },
        inputSchema: { platforms: { type: 'array', items: { type: 'string' }, optional: true }, reportToServer: { type: 'boolean', optional: true } },
        category: 'hotsearch',
        capability: { key: 'platform_hotsearch', label: '全平台热搜采集', description: '并发采集所有启用平台热搜。' },
        handler: async (args) => executeAllPlatformCollect(args.platforms, args.reportToServer ?? true),
      });

      // 注册 AI 图片处理 MCP 工具
      const imageProcessShape = {
        imageUrl: z.string().describe('待处理的远程图片 URL 地址'),
        operations: z.array(
          z.object({
            type: z.string().describe('操作类型，如 resize, watermark, lowpoly, sepia, crop 等'),
            params: z.record(z.string(), z.any()).optional().describe('操作参数对象'),
          }),
        ).optional().describe('按顺序排列的处理操作链'),
        processorId: z.string().optional().describe('图像引擎 ID，如 imagemagick, sharp'),
      };
      this.registerTool(server, {
        name: 'image_process_execute',
        description: '编程式执行图片处理操作链（如缩放、裁剪、水印、低多边形、滤镜等），方便 AI 直接调用',
        zodShape: imageProcessShape,
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
      const videoRenderShape = {
        templateId: z.string().optional().describe('视频模板 ID'),
        inputProps: z.record(z.string(), z.any()).optional().describe('模板输入参数'),
        action: z.enum(['render', 'status', 'list', 'catalog', 'ai-generate', 'ai-free-generate']).optional().describe('render=渲染, status=查状态, list=列任务, catalog=列模板, ai-generate=AI模板填充, ai-free-generate=AI自由编排SceneGraph'),
        jobId: z.string().optional().describe('任务ID（action=status 时必填）'),
        prompt: z.string().optional().describe('自然语言描述（action=ai-generate/ai-free-generate 时必填）'),
        width: z.number().optional().describe('视频宽度px（action=ai-free-generate 时可选，默认竖屏1080）'),
        height: z.number().optional().describe('视频高度px（action=ai-free-generate 时可选，默认竖屏1920）'),
      };
      this.registerTool(server, {
        name: 'video_render_execute',
        description: 'Remotion 视频渲染工具：提交视频渲染任务、查询状态、列出模板。支持两种AI模式：ai-generate（模板填充）和 ai-free-generate（自由编排SceneGraph）',
        zodShape: videoRenderShape,
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
      const browserAgentShape = {
        task: z.string().describe('要执行的浏览器任务描述'),
        apiKey: z.string().describe('AI API Key'),
        baseUrl: z.string().describe('AI API Base URL'),
        model: z.string().describe('AI 模型名称'),
        maxSteps: z.number().optional().describe('最大执行步数，默认 25'),
        skillPrompt: z.string().optional().describe('匹配到的 Skill 指引（包含 goal 和 agentPrompt）'),
      };
      this.registerTool(server, {
        name: 'browser_agent_execute',
        description: 'AI 浏览器自动化 Agent：使用自然语言描述任务，browser-use 会自动操作浏览器完成。支持导航、点击、输入、采集数据、截图等。需要浏览器已启动。',
        zodShape: browserAgentShape,
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
      const browserInvokeShape = {
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP 方法，默认 GET'),
        path: z.string().describe('API 路径，如 /api/browser/connect'),
        body: z.record(z.string(), z.any()).optional().describe('请求体'),
      };
      this.registerTool(server, {
        name: 'browser_invoke',
        description: '调用浏览器自动化功能。可以启动/关闭浏览器、查看状态、执行页面操作等。',
        zodShape: browserInvokeShape,
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
        const inputSchema = zodShapeToInputSchema(browserDefinition?.schema || {});
        this.registerTool(server, {
          name: toolName,
          description: browserDefinition?.description || `浏览器操作: ${toolName}`,
          zodShape: (browserDefinition?.schema || {}) as any,
          inputSchema,
          category: 'browser',
          capability: { key: 'browser_page_actions', label: '浏览器页面操作', description: '对当前页面执行单步交互。' },
          actions: [{
            key: toolName.replace(/^browser_/, ''),
            label: toolName.replace(/^browser_/, ''),
            description: browserDefinition?.description,
            inputSchema,
          }],
          handler: async (args) => {
            const { browserToolMap } = await import('./tools/browser-tools');
            const tool = browserToolMap.get(toolName);
            if (!tool) return { content: [{ type: 'text', text: `工具 ${toolName} 不存在` }], isError: true };
            return tool.execute(args as any);
          },
        });
      }

      // 客户端 CapabilityRegistry 是本地工具的唯一真相源。
      // MCP 只做协议适配，不再为 googleArt / 其他本地能力重复定义 handler、schema 或参数。
      registerAllCapabilities();
      for (const capability of CapabilityRegistry.list()) {
        const definition = CapabilityRegistry.getDefinition(
          capability.namespace,
          capability.name,
        );
        if (!definition) continue;

        const toolName = `${capability.namespace}_${capability.name}`;
        const inputShape = getZodObjectShape(definition.argsSchema);
        const inputSchema = zodShapeToInputSchema(inputShape);
        const handler = async (args: Record<string, any>, context?: CapabilityCallContext) => {
          const result = await CapabilityRegistry.call(
            capability.namespace,
            capability.name,
            args,
            context,
          );
          if (!result.success) {
            console.error(`[MCP Server] ❌ 工具 "${toolName}" 执行失败:`, result);
          } else {
            console.log(`[MCP Server] ✅ 工具 "${toolName}" 执行成功:`, result);
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: !result.success,
          };
        };

        this.registerTool(server, {
          name: toolName,
          description: capability.description,
          zodShape: inputShape,
          inputSchema,
          category: capability.namespace,
          readOnly: capability.riskLevel === 'read',
          executionMode: capability.riskLevel === 'read' ? 'read_only' : 'confirm_required',
          riskLevel: capability.riskLevel === 'read' ? 'low' : 'medium',
          confirmRequired: capability.riskLevel !== 'read',
          plannerEnabled: true,
          handler,
        });
      }

      writeClientLog({
        level: 'INFO',
        module: 'mcp-server',
        message: `已从 CapabilityRegistry 注册 ${CapabilityRegistry.size} 个 MCP 工具`,
      });

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

    // 端口占用自愈：先检测目标端口是否已是本应用其他实例的 MCP Server，
    // 若是则直接复用（adopt），否则依次尝试后续端口，避免 EADDRINUSE 直接失败。
    const isYisheMcpOnPort = async (port: number): Promise<boolean> => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!resp.ok) return false;
        const body = await resp.json();
        return body?.server === 'yishe-client-mcp';
      } catch {
        return false;
      }
    };

    const tryListenOn = (port: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const onError = (err: NodeJS.ErrnoException) => {
          this.httpServer!.off('listening', onListening);
          if (err?.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            console.error('[MCP Server] 启动失败:', err);
            this.running = false;
            resolve(false);
          }
        };
        const onListening = () => {
          this.httpServer!.off('error', onError);
          this.running = true;
          resolve(true);
        };
        this.httpServer!.once('error', onError);
        this.httpServer!.once('listening', onListening);
        this.httpServer!.listen(port, '127.0.0.1');
      });

    // 如果目标端口已被同款 MCP Server 占用，直接采用复用方案
    if (await isYisheMcpOnPort(this.port)) {
      console.log(`[MCP Server] 检测到 ${this.port} 端口已有实例，直接复用`);
      this.running = true;
      // 复用模式下 httpServer 保持挂起即可，status 查询走内存状态
      return;
    }

    const candidatePorts: number[] = [];
    for (let offset = 0; offset < 20; offset += 1) {
      const nextPort = this.port + offset;
      if (nextPort > 0 && nextPort <= 65535) candidatePorts.push(nextPort);
    }

    let started = false;
    for (const candidatePort of candidatePorts) {
      const ok = await tryListenOn(candidatePort);
      if (ok) {
        this.port = candidatePort;
        started = true;
        console.log(`[MCP Server] 已启动，监听 http://127.0.0.1:${this.port}`);
        console.log(`[MCP Server] 已注册 ${this.toolRegistry.size} 个工具`);
        break;
      }
    }

    if (!started) {
      throw new Error(
        `MCP Server 端口 ${this.port}~${this.port + candidatePorts.length - 1} 均被占用`,
      );
    }

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
        process.env.NODE_ENV !== "development"
          ? "https://api.1s.design/api/ai/runtime-config?featureCode=ai.client-agent.execute"
          : "http://localhost:1521/api/ai/runtime-config?featureCode=ai.client-agent.execute",
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
      const httpServer = this.httpServer;
      this.httpServer = null;
      await new Promise<void>((resolve) => {
        // 复用模式下服务器可能尚未 listen，close 会回调错误，也视为已停止
        httpServer.close(() => {
          console.log('[MCP Server] 已停止');
          this.running = false;
          resolve();
        });
      });
    }
    this.app = null;
    this.running = false;
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
    context?: CapabilityCallContext,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    // 规范名称只有 namespace_action；点号格式仅作为无重复的兼容映射。
    // 旧 google_art_* 下载/批量采集链路不再映射，避免绕过可信 googleArt 工作流。
    const normalizedInput = String(toolName || '').trim();
    if (/^google_art_(download|collect)$/.test(normalizedInput)) {
      return {
        content: [{
          type: 'text',
          text: '旧 Google Arts MCP 工具已停用，请使用 googleArt_search → googleArt_zoom → googleArt_collect。',
        }],
        isError: true,
      };
    }
    const canonicalName = normalizedInput === 'google_art_search'
      ? 'googleArt_search'
      : normalizedInput;
    let tool = this.toolRegistry.get(canonicalName);
    if (!tool) {
      // 将点号转为下划线: googleArt.search -> googleArt_search
      const underscoreName = canonicalName.replace(/\./g, '_');
      tool = this.toolRegistry.get(underscoreName);
    }
    if (!tool) {
      // 尝试全小写加下划线: googleArt.search -> google_art_search
      const legacyName = canonicalName.replace(/\./g, '_').toLowerCase();
      if (legacyName === 'google_art_search') {
        tool = this.toolRegistry.get('googleArt_search');
      } else {
        tool = this.toolRegistry.get(legacyName);
      }
    }
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
        isError: true,
      };
    }
    try {
      return await tool.handler(toolArgs, context);
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
    readOnly?: boolean;
    executionMode?: 'read_only' | 'safe_write' | 'confirm_required';
    riskLevel?: 'low' | 'medium' | 'high';
    confirmRequired?: boolean;
    plannerEnabled?: boolean;
  }> {
    return Array.from(this.toolRegistry.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
      capability: tool.capability,
      operations: tool.operations,
      actions: tool.actions,
      readOnly: tool.readOnly,
      executionMode: tool.executionMode,
      riskLevel: tool.riskLevel,
      confirmRequired: tool.confirmRequired,
      plannerEnabled: tool.plannerEnabled,
    }));
  }
}
