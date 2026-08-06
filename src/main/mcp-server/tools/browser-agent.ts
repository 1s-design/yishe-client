/**
 * MCP Tool: browser_agent_execute
 * 调用 Python browser-use 服务执行浏览器自动化任务
 * 配置已在服务启动时通过环境变量/配置接口加载
 */

import { z } from 'zod';

const BROWSER_AGENT_PORT = 1596;
const BROWSER_AGENT_URL = `http://127.0.0.1:${BROWSER_AGENT_PORT}`;

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

// 检查 Python 服务是否可用
async function isServiceAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BROWSER_AGENT_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// 检查配置是否已加载
async function isConfigLoaded(): Promise<boolean> {
  try {
    const response = await fetch(`${BROWSER_AGENT_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json() as any;
    return data.config_loaded === true;
  } catch {
    return false;
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

// 调用 Python browser-use 服务
async function callBrowserUseService(params: {
  task: string;
  maxSteps?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  skillPrompt?: string;
}): Promise<TaskResult> {
  const cdpUrl = await detectCdpPort();
  const body: Record<string, any> = {
    task: params.task,
    max_steps: params.maxSteps || 25,
  };
  if (cdpUrl) body.cdp_url = cdpUrl;
  if (params.apiKey) body.api_key = params.apiKey;
  if (params.baseUrl) body.base_url = params.baseUrl;
  if (params.model) body.model = params.model;
  if (params.skillPrompt) body.skill_prompt = params.skillPrompt;

  console.log(`[BrowserAgent] 执行任务: ${params.task.substring(0, 50)}...`, { cdpUrl, model: params.model, hasSkillPrompt: !!params.skillPrompt });

  const response = await fetch(`${BROWSER_AGENT_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
      'AI 浏览器自动化 Agent：使用自然语言描述任务，browser-use 会自动操作浏览器完成。支持导航、点击、输入、采集数据、截图等。需要浏览器已启动且 AI 配置已加载。',
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
      // 检查 Python 服务
      const available = await isServiceAvailable();
      if (!available) {
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

      // 调用 browser-use 服务（配置可由 mcp_bridge 注入或 Python 服务已缓存）
      console.log(`[BrowserAgent] 调用 browser-use 执行任务: ${args.task}`);

      const result = await callBrowserUseService({
        task: args.task,
        maxSteps: args.maxSteps,
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        skillPrompt: args.skillPrompt,
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
