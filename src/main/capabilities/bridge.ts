/**
 * 通用能力桥接 — 将 Capability Registry 的能力暴露为 MCP 工具和 REST API
 */

;
import { zodToJsonSchema } from '../mcp-server/server';
import { CapabilityRegistry } from './registry';
import { callCapability } from './index';
import type { Express } from 'express';

/**
 * 获取所有能力的 MCP 工具定义
 */
export function getCapabilityMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  category: string;
  handler: (args: any) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}> {
  const capabilities = CapabilityRegistry.list();
  return capabilities.map((cap) => {
    const def = CapabilityRegistry.getDefinition(cap.namespace, cap.name);
    return {
      name: `${cap.namespace}_${cap.name}`,
      description: cap.description,
      inputSchema: def ? zodToJsonSchema(def.argsSchema) : { type: 'object', properties: {} },
      category: cap.namespace,
      handler: async (args: any) => {
        const result = await callCapability(cap.namespace, cap.name, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      },
    };
  });
}

/**
 * 注册能力调用 REST API 路由
 */
export function registerCapabilityRoutes(app: Express): void {
  // 列出所有能力
  app.get('/api/capabilities', (_req, res) => {
    const capabilities = CapabilityRegistry.list();
    res.json({
      success: true,
      total: capabilities.length,
      capabilities,
    });
  });

  // 按命名空间列出
  app.get('/api/capabilities/:namespace', (req, res) => {
    const capabilities = CapabilityRegistry.listByNamespace(req.params.namespace);
    res.json({
      success: true,
      namespace: req.params.namespace,
      total: capabilities.length,
      capabilities,
    });
  });

  // 通用能力调用端点
  app.post('/api/capabilities/:namespace/:name', async (req, res) => {
    const { namespace, name } = req.params;
    const result = await callCapability(namespace, name, req.body || {});
    res.status(result.success ? 200 : 400).json(result);
  });

  // 批量调用
  app.post('/api/capabilities/batch', async (req, res) => {
    const { calls } = req.body as { calls: Array<{ namespace: string; name: string; args?: any }> };
    if (!Array.isArray(calls)) {
      res.status(400).json({ success: false, error: 'calls 必须是数组' });
      return;
    }
    const results = await Promise.all(
      calls.map(async (call) => {
        const result = await callCapability(call.namespace, call.name, call.args || {});
        return { namespace: call.namespace, name: call.name, ...result };
      })
    );
    res.json({ success: true, results });
  });
}
