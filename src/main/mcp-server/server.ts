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

let serviceStatusTool: any = null;

async function loadTools() {
  if (!serviceStatusTool) {
    serviceStatusTool = (await import('./tools/service-status')).serviceStatusTool;
  }
}

export class McpServerManager {
  private serverFactory: (() => McpServer) | null = null;
  private httpServer: HttpServer | null = null;
  private transport: SSEServerTransport | null = null;
  private app: express.Express | null = null;
  private running = false;
  private port: number;

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
        server.tool(
          `hotsearch_${key}`,
          config.description,
          {
            reportToServer: z.boolean().optional().describe('是否上报到服务端，默认 true'),
          },
          async (args) => {
            return await executePlatformCollect(key, args.reportToServer ?? true);
          }
        );
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

      return server;
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    console.log(`[MCP Server] 正在启动，端口: ${this.port}`);

    await loadTools();
    this.serverFactory = this.createServerFactory();

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
      res.json({
        status: 'ok',
        server: 'yishe-client-mcp',
        version: '1.0.0',
        tools: [
          ...platformNames.map((k) => `hotsearch_${k}`),
          'hotsearch_collect_all',
          'browser_invoke',
          'service_status',
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
}
