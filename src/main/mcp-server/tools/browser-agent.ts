/**
 * MCP Tool: browser_agent_execute
 * 调用 Python browser-use 服务执行浏览器自动化任务
 * 配置已在服务启动时通过环境变量/配置接口加载
 */

import { z } from 'zod';

const BROWSER_AGENT_PORT = 1596;
const BROWSER_AGENT_URL = `http://127.0.0.1:${BROWSER_AGENT_PORT}`;

const BROWSER_AGENT_TIMEOUT_MS = 285_000;
const BROWSER_START_TIMEOUT_MS = 15_000;

interface TaskResult {
  success: boolean;
  final_answer: string;
  steps_count: number;
  steps: Array<{
    thought: string;
    action: string;
    actionInput: Record<string, any>;
  }>;
  error?: string;
}

interface BrowserAgentHealth {
  status?: string;
  config_loaded?: boolean;
  browser_use_available?: boolean;
}

async function getServiceHealth(): Promise<BrowserAgentHealth | null> {
  try {
    const response = await fetch(`${BROWSER_AGENT_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return response.json() as Promise<BrowserAgentHealth>;
  } catch {
    return null;
  }
}

// 检测客户端浏览器 CDP 端口
async function detectCdpPort(): Promise<string | null> {
  // 常见的 Chrome 远程调试端口
  const ports = [9333, 9334, 9222];
  for (const port of ports) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        return `http://127.0.0.1:${port}`;
      }
    } catch {}
  }
  return null;
}

async function waitForCdp(timeoutMs = BROWSER_START_TIMEOUT_MS): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const cdpUrl = await detectCdpPort();
    if (cdpUrl) return cdpUrl;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return null;
}

// 调用 Python browser-use 服务
async function callBrowserUseService(params: {
  task: string;
  maxSteps?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  skillPrompt?: string;
  cdpUrl?: string;
}): Promise<TaskResult> {
  // 使用传入的 cdpUrl 或检测
  const cdpUrl = params.cdpUrl || await detectCdpPort();

  // 严格检查：必须检测到浏览器 CDP
  if (!cdpUrl) {
    return {
      success: false,
      final_answer: '',
      steps_count: 0,
      steps: [],
      error: '未检测到客户端浏览器。请确保客户端浏览器服务可用。',
    };
  }

  const body: Record<string, any> = {
    task: params.task,
    max_steps: params.maxSteps || 25,
  };
  if (cdpUrl) body.cdp_url = cdpUrl;
  if (params.apiKey) body.api_key = params.apiKey;
  if (params.baseUrl) body.base_url = params.baseUrl;
  if (params.model) body.model = params.model;
  if (params.skillPrompt) body.skill_prompt = params.skillPrompt;
  body.timeout_seconds = Math.floor((BROWSER_AGENT_TIMEOUT_MS - 5_000) / 1000);

  console.log(`[BrowserAgent] 执行任务: ${params.task.substring(0, 50)}...`, { cdpUrl, model: params.model, hasSkillPrompt: !!params.skillPrompt });

  const response = await fetch(`${BROWSER_AGENT_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BROWSER_AGENT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`browser-use 服务响应错误: ${response.status} ${text}`);
  }

  return response.json() as Promise<TaskResult>;
}

// MCP 工具定义
export const browserAgentTool = {
  definition: {
    name: 'browser_agent_execute',
    description:
      'AI 浏览器自动化 Agent：使用自然语言描述任务，browser-use 会自动操作浏览器完成。支持导航、点击、输入、采集数据、截图等。会自动启动浏览器（如未运行）。',
    inputSchema: {
      task: z.string().describe('要执行的浏览器任务描述，如"打开百度搜索AI助手"'),
      maxSteps: z.number().optional().describe('最大执行步数，默认 25'),
      apiKey: z.string().optional().describe('AI API Key（服务端自动注入）'),
      baseUrl: z.string().optional().describe('AI API Base URL（服务端自动注入）'),
      model: z.string().optional().describe('AI 模型名称（服务端自动注入）'),
      skillPrompt: z.string().optional().describe('匹配到的 Skill 指引（包含 goal 和 agentPrompt）'),
    },
  },
  async execute(args: {
    task: string;
    maxSteps?: number;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    skillPrompt?: string;
  }) {
    try {
      // 检查 Python 服务及 browser-use 依赖
      const health = await getServiceHealth();
      if (!health) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'browser-use 服务未启动，请稍后重试或重启客户端',
              }),
            },
          ],
          isError: true,
        };
      }
      if (health.browser_use_available !== true) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'browser-use Python 依赖不可用' }) }],
          isError: true,
        };
      }
      if (!args.apiKey && health.config_loaded !== true) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'browser-use AI 配置尚未加载' }) }],
          isError: true,
        };
      }

      // 确保浏览器已启动（自动检测或启动）
      let cdpUrl = await detectCdpPort();
      if (!cdpUrl) {
        console.log('[BrowserAgent] 未检测到浏览器，尝试启动...');
        // 通过 browser_invoke 工具启动浏览器
        try {
          const { browserInvokeTool } = await import('./browser-automation');
          const response = await browserInvokeTool.execute({
            method: 'POST',
            path: '/api/browser/connect',
          });
          const parsed = JSON.parse(
            (response.content?.[0] as any)?.text || '{}',
          );
          console.log(
            `[BrowserAgent] browser_invoke /api/browser/connect 结果:`,
            JSON.stringify(parsed),
          );
          if (response.isError || parsed?.success === false || parsed?.status === false) {
            throw new Error(parsed?.error || parsed?.message || '浏览器连接失败');
          }
          cdpUrl = await waitForCdp();
        } catch (e) {
          console.log('[BrowserAgent] 启动浏览器失败:', e);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error)?.message || String(e) }) }],
            isError: true,
          };
        }
      }

      if (!cdpUrl) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: '无法启动浏览器。请确认客户端浏览器服务可用。',
              }),
            },
          ],
          isError: true,
        };
      }

      console.log(`[BrowserAgent] 调用 browser-use 执行任务: ${args.task}，CDP: ${cdpUrl}`);

      const result = await callBrowserUseService({
        task: args.task,
        maxSteps: args.maxSteps,
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        skillPrompt: args.skillPrompt,
        cdpUrl: cdpUrl,
      });

      console.log(`[BrowserAgent] 任务完成: ${result.success ? '成功' : '失败'}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              finalAnswer: result.final_answer,
              stepsCount: result.steps_count,
              steps: result.steps,
              error: result.error,
            }, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (error: any) {
      console.error('[BrowserAgent] 执行失败:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error?.message || String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  },
};
