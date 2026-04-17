import OpenAI from 'openai';
import {
  buildSubmitOperationPlanTool,
  listOperationToolSummaries,
  listOperationApiTypes,
  validateAndNormalizeOperationPlan,
} from './operation-registry.js';

/**
 * AI服务配置（硬编码在代码中）
 * 如需修改配置，请直接编辑以下常量
 */
const AI_CONFIG = {
  apiKey: 'sk-6b30d334c13b4995a85400958e7f1ea7',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus-latest',
  maxTokens: 4096,
  temperature: 0.2,
  enabled: true,
};

const MODEL_ALIASES = {
  'free-qwen': 'qwen-plus-latest',
  'free-qwen2': 'qwen-plus-latest',
  'qwen-plus': 'qwen-plus-latest',
  'qwen-max': 'qwen-max-latest',
};

const DASHSCOPE_MODEL_FALLBACKS = [
  'qwen-plus-latest',
  'qwen-max-latest',
  'qwen-vl-max-latest',
];

const UNSUPPORTED_INTENT_RULES = [
  {
    code: 'UNSUPPORTED_CAPABILITY',
    message: '当前服务只支持对已有图片做处理，不支持根据文字直接生成全新图片。',
    patterns: [
      /生成一张全新的?/,
      /生成一幅全新的?/,
      /根据.*生成.*图片/,
      /帮我画一张/,
      /从零生成/,
      /文生图/,
      /text\s*to\s*image/i,
    ],
  },
  {
    code: 'UNSUPPORTED_CAPABILITY',
    message: '当前服务不支持 AI 补图、扩图、重绘缺失区域。',
    patterns: [
      /扩图/,
      /补图/,
      /补全/,
      /重绘/,
      /修复缺失/,
      /outpaint/i,
      /inpaint/i,
    ],
  },
  {
    code: 'UNSUPPORTED_CAPABILITY',
    message: '当前服务不支持把图片转换成 3D 模型、视频或多视角内容。',
    patterns: [
      /3d/,
      /三维/,
      /建模/,
      /模型动画/,
      /视频/,
      /多视角/,
    ],
  },
];

function createAIPlanningError(code, message, details = {}, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function detectUnsupportedIntent(prompt) {
  const text = String(prompt || '');

  for (const rule of UNSUPPORTED_INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return rule;
    }
  }

  return null;
}

function normalizeModelName(model) {
  const normalized = String(model || '').trim();
  if (!normalized) {
    return AI_CONFIG.model;
  }

  return MODEL_ALIASES[normalized] || normalized;
}

function isDashScopeCompatibleBaseUrl(baseURL) {
  return typeof baseURL === 'string' && baseURL.includes('dashscope.aliyuncs.com/compatible-mode');
}

function shouldRetryWithFallbackModel(error) {
  const message = String(error?.message || '');
  const status = error?.status;

  return status === 404
    || message.includes('does not exist')
    || message.includes('do not have access')
    || message.includes('model_not_found');
}

function buildModelCandidates(model, baseURL) {
  const normalizedModel = normalizeModelName(model);
  if (!isDashScopeCompatibleBaseUrl(baseURL)) {
    return [normalizedModel];
  }

  return [
    normalizedModel,
    ...DASHSCOPE_MODEL_FALLBACKS.filter((candidate) => candidate !== normalizedModel),
  ];
}

function buildImagePlanningTools() {
  return [
    buildSubmitOperationPlanTool(),
    {
      type: 'function',
      function: {
        name: 'reject_request',
        description: '当用户需求无法由当前图片处理能力完成时调用，给出明确拒绝原因。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              enum: ['UNSUPPORTED_CAPABILITY'],
              description: '拒绝原因代码。',
            },
            reason: {
              type: 'string',
              description: '无法完成的明确原因。',
            },
          },
          required: ['code', 'reason'],
        },
      },
    },
  ];
}

class AIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY ||
      process.env.AI_API_KEY ||
      AI_CONFIG.apiKey;

    const baseURL = process.env.AI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      AI_CONFIG.baseURL;

    const requestedModel = process.env.AI_MODEL ||
      process.env.OPENAI_MODEL ||
      AI_CONFIG.model;
    const model = normalizeModelName(requestedModel);

    const maxTokens = process.env.AI_MAX_TOKENS
      ? parseInt(process.env.AI_MAX_TOKENS, 10)
      : AI_CONFIG.maxTokens;

    const temperature = process.env.AI_TEMPERATURE
      ? parseFloat(process.env.AI_TEMPERATURE)
      : AI_CONFIG.temperature;

    const enabled = process.env.AI_ENABLED !== undefined
      ? process.env.AI_ENABLED === 'true'
      : AI_CONFIG.enabled;

    this.configMeta = {
      enabled,
      apiKey,
      baseURL,
      requestedModel,
      model,
      maxTokens,
      temperature,
      apiKeySource: process.env.OPENAI_API_KEY || process.env.AI_API_KEY ? 'environment' : 'code',
      baseURLSource: process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL ? 'environment' : 'code',
      modelSource: process.env.AI_MODEL || process.env.OPENAI_MODEL ? 'environment' : 'code',
      enabledSource: process.env.AI_ENABLED !== undefined ? 'environment' : 'code',
    };

    if (!enabled) {
      console.log('AI服务已禁用');
      this.client = null;
      this.config = null;
      return;
    }

    if (!apiKey) {
      console.warn('警告: 未设置API密钥，AI功能将不可用');
      this.client = null;
      this.config = null;
      return;
    }

    const clientConfig = { apiKey };
    if (baseURL) {
      clientConfig.baseURL = baseURL;
    }

    this.client = new OpenAI(clientConfig);
    this.config = {
      model,
      maxTokens,
      temperature,
    };

    console.log('AI服务已初始化:', {
      baseURL: baseURL || '默认OpenAI',
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      configSource: process.env.OPENAI_API_KEY || process.env.AI_API_KEY ? '环境变量' : '代码配置',
      planningMode: 'function-calling',
    });
  }

  isAvailable() {
    return this.client !== null;
  }

  getPublicConfigSummary() {
    const meta = this.configMeta || {};
    const apiKey = String(meta.apiKey || '');
    const maskedApiKey = apiKey
      ? `${apiKey.slice(0, 6)}${'*'.repeat(Math.max(4, apiKey.length - 10))}${apiKey.slice(-4)}`
      : '';

    return {
      enabled: Boolean(meta.enabled),
      available: this.isAvailable(),
      configSource: meta.apiKeySource === 'environment' ? '环境变量' : '代码配置',
      apiKeyMasked: maskedApiKey || '未配置',
      apiKeySource: meta.apiKeySource || 'unknown',
      baseURL: meta.baseURL || '默认OpenAI',
      baseURLSource: meta.baseURLSource || 'unknown',
      model: meta.model || '',
      requestedModel: meta.requestedModel || meta.model || '',
      modelSource: meta.modelSource || 'unknown',
      maxTokens: meta.maxTokens ?? null,
      temperature: meta.temperature ?? null,
      enabledSource: meta.enabledSource || 'unknown',
      planningMode: 'function-calling',
    };
  }

  async convertPromptToOperations(prompt, imageInfo = null) {
    if (!this.client) {
      throw new Error('AI服务不可用，请检查配置或设置环境变量');
    }

    const unsupportedIntent = detectUnsupportedIntent(prompt);
    if (unsupportedIntent) {
      throw createAIPlanningError(
        unsupportedIntent.code,
        unsupportedIntent.message,
        {
          prompt,
          stage: 'rule-based-intent-check',
        },
        400,
      );
    }

    const tools = buildImagePlanningTools();
    const operationSummaries = listOperationToolSummaries();

    const systemPrompt = [
      '你是图片处理流程规划器，不直接输出自然语言答案。',
      '你的唯一任务是根据用户描述，为当前图片生成可执行的图片处理操作链。',
      '你必须通过 function calling 调用工具：提交方案时调用 submit_operation_plan，无法完成时调用 reject_request。',
      '不要输出 Markdown，不要解释过程，不要返回自由文本。',
      '操作链要尽量短，先满足用户核心目标，再考虑附加优化。',
      '只能使用支持的操作类型，绝不能发明新 type。',
      '每个 operation 的 params 只填写必要参数和明确有帮助的参数。',
      '如果请求本质上是生成新图、补图扩图、3D/视频生成、身份换脸、场景重绘等超出当前能力边界的任务，必须调用 reject_request。',
      '当你不确定是否能稳定完成时，优先 reject_request，不要猜测，不要输出勉强可执行但语义错误的操作链。',
      '如果用户目标明显无法由当前图片处理能力完成，例如“生成一张完全不存在的新图”，调用 reject_request。',
      `支持的操作概览：${JSON.stringify(operationSummaries)}`,
      imageInfo
        ? `当前图片信息：${JSON.stringify({ width: imageInfo.width, height: imageInfo.height, format: imageInfo.format })}`
        : '当前没有可用图片信息，请基于常规图片处理逻辑规划。',
    ].join('\n');

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    const candidateModels = buildModelCandidates(this.config.model, this.configMeta?.baseURL);
    let lastError = null;

    for (const candidateModel of candidateModels) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response;
        try {
          response = await this.client.chat.completions.create({
            model: candidateModel,
            messages,
            tools,
            tool_choice: 'required',
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
          });
        } catch (error) {
          lastError = error;
          if (shouldRetryWithFallbackModel(error) && candidateModel !== candidateModels[candidateModels.length - 1]) {
            console.warn(`AI模型 ${candidateModel} 不可用，尝试回退到下一个模型: ${error.message}`);
            break;
          }
          throw error;
        }

        const message = response.choices?.[0]?.message;
        const toolCall = message?.tool_calls?.[0];
        if (!toolCall) {
          throw new Error('AI未返回函数调用结果');
        }

        messages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls,
        });

        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          parsedArgs = {};
        }

        if (toolCall.function.name === 'reject_request') {
          const reason = parsedArgs.reason || '当前请求无法由现有图片处理能力完成';
          throw createAIPlanningError(
            parsedArgs.code || 'UNSUPPORTED_CAPABILITY',
            reason,
            {
              prompt,
              stage: 'model-reject',
            },
            400,
          );
        }

        if (toolCall.function.name !== 'submit_operation_plan') {
          throw new Error(`AI调用了未知工具: ${toolCall.function.name}`);
        }

        const validation = validateAndNormalizeOperationPlan(parsedArgs.operations);
        if (!validation.ok) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify({
              ok: false,
              errors: validation.errors,
              supportedOperationTypes: listOperationApiTypes(),
            }),
          });
          continue;
        }

        if (candidateModel !== this.config.model) {
          console.warn(`AI模型已自动回退为 ${candidateModel}（原始模型: ${this.config.model}）`);
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            ok: true,
            normalizedOperations: validation.operations,
          }),
        });

        return {
          operations: validation.operations,
          command: parsedArgs.summary || this.generateCommandDescription(validation.operations),
        };
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('AI连续多次未能生成可执行的操作链');
  }

  generateCommandDescription(operations) {
    return operations.map((operation, index) => {
      return `${index + 1}. ${operation.type}(${JSON.stringify(operation.params)})`;
    }).join(' -> ');
  }
}

export default new AIService();
