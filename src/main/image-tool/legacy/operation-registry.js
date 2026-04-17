import { OPERATIONS_CONFIG } from './operations-config.js';
import { FILTER_OPERATIONS_CONFIG } from './filter-operations-config.js';

const RAW_OPERATION_DEFINITIONS = [
  ...OPERATIONS_CONFIG,
  ...FILTER_OPERATIONS_CONFIG,
];

const PARAM_TYPE_TO_JSON_SCHEMA_TYPE = {
  number: 'number',
  boolean: 'boolean',
  string: 'string',
  array: 'array',
  object: 'object',
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function normalizeOperationApiType(apiType) {
  if (!apiType) return null;

  let type = String(apiType).trim();
  if (!type) return null;

  if (type === 'shape-crop') type = 'shapeCrop';
  if (type.startsWith('effects-')) type = type.slice('effects-'.length);
  if (type.startsWith('effect-')) type = type.slice('effect-'.length);
  if (type.startsWith('filter_')) type = type.replace(/^filter_/, 'filter-');

  return type;
}

function buildAliases(operation) {
  const aliases = [];

  if (operation.category === 'effect') {
    aliases.push(`effects-${operation.type}`, `effect-${operation.type}`);
  }

  if (operation.type === 'shapeCrop') {
    aliases.push('shape-crop');
  }

  if (operation.category === 'filter') {
    aliases.push(operation.type.replace(/^filter-/, 'filter_'));
  }

  return aliases;
}

function buildParamSchema(paramConfig = {}) {
  const schema = {
    type: PARAM_TYPE_TO_JSON_SCHEMA_TYPE[paramConfig.type] || 'string',
    description: paramConfig.description || '',
  };

  if (paramConfig.enum) {
    schema.enum = [...paramConfig.enum];
  }
  if (paramConfig.minimum !== undefined) {
    schema.minimum = paramConfig.minimum;
  }
  if (paramConfig.maximum !== undefined) {
    schema.maximum = paramConfig.maximum;
  }
  if (paramConfig.items) {
    schema.items = { ...paramConfig.items };
  }

  return schema;
}

function buildOperationDefinition(operation) {
  const aliases = buildAliases(operation);
  const apiType = operation.category === 'effect' ? `effects-${operation.type}` : operation.type;
  const params = operation.params || {};
  const requiredParams = Object.entries(params)
    .filter(([, config]) => config.required)
    .map(([key]) => key);

  return {
    ...operation,
    apiType,
    aliases,
    params,
    requiredParams,
    jsonSchemaParams: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(params).map(([key, config]) => [key, buildParamSchema(config)]),
      ),
      required: requiredParams,
    },
  };
}

const OPERATION_DEFINITIONS = RAW_OPERATION_DEFINITIONS.map(buildOperationDefinition);

const OPERATION_MAP = new Map();
for (const operation of OPERATION_DEFINITIONS) {
  OPERATION_MAP.set(operation.type, operation);
  OPERATION_MAP.set(operation.apiType, operation);
  for (const alias of operation.aliases) {
    OPERATION_MAP.set(alias, operation);
  }
}

export function listOperationDefinitions() {
  return OPERATION_DEFINITIONS.map((operation) => ({
    ...operation,
    params: clone(operation.params),
    requiredParams: [...operation.requiredParams],
    aliases: [...operation.aliases],
    jsonSchemaParams: clone(operation.jsonSchemaParams),
  }));
}

export function getOperationDefinition(type) {
  const normalized = normalizeOperationApiType(type);
  if (!normalized) return null;

  return OPERATION_MAP.get(normalized) || null;
}

export function listOperationApiTypes() {
  return OPERATION_DEFINITIONS.map((operation) => operation.apiType);
}

export function listOperationToolSummaries() {
  return OPERATION_DEFINITIONS.map((operation) => ({
    type: operation.apiType,
    description: operation.description,
    category: operation.category,
    requiredParams: [...operation.requiredParams],
    optionalParams: Object.keys(operation.params || {}).filter((key) => !operation.requiredParams.includes(key)),
  }));
}

function coerceParamValue(value, paramConfig = {}) {
  if (value === undefined) return undefined;

  switch (paramConfig.type) {
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) {
        throw new Error(`参数需要 number，收到 ${JSON.stringify(value)}`);
      }
      if (paramConfig.minimum !== undefined && num < paramConfig.minimum) {
        throw new Error(`参数不能小于 ${paramConfig.minimum}`);
      }
      if (paramConfig.maximum !== undefined && num > paramConfig.maximum) {
        throw new Error(`参数不能大于 ${paramConfig.maximum}`);
      }
      return num;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`参数需要 boolean，收到 ${JSON.stringify(value)}`);
    }
    case 'array': {
      if (!Array.isArray(value)) {
        throw new Error(`参数需要 array，收到 ${JSON.stringify(value)}`);
      }
      return value;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`参数需要 object，收到 ${JSON.stringify(value)}`);
      }
      return value;
    }
    case 'string':
    default: {
      const str = typeof value === 'string' ? value : String(value);
      if (paramConfig.enum && !paramConfig.enum.includes(str)) {
        throw new Error(`参数必须是 ${paramConfig.enum.join(', ')} 之一`);
      }
      return str;
    }
  }
}

export function validateAndNormalizeOperationPlan(operations) {
  const errors = [];

  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, errors: ['operations 必须是非空数组'], operations: [] };
  }

  const normalizedOperations = operations.map((rawOperation, index) => {
    const prefix = `第 ${index + 1} 个操作`;

    if (!rawOperation || typeof rawOperation !== 'object') {
      errors.push(`${prefix} 必须是对象`);
      return null;
    }

    const operationType = rawOperation.type;
    if (!operationType || typeof operationType !== 'string') {
      errors.push(`${prefix} 缺少合法的 type`);
      return null;
    }

    const operationDefinition = getOperationDefinition(operationType);
    if (!operationDefinition) {
      errors.push(`${prefix} 使用了不支持的 type: ${operationType}`);
      return null;
    }

    const rawParams = rawOperation.params && typeof rawOperation.params === 'object'
      ? rawOperation.params
      : {};

    const normalizedParams = {};

    for (const [paramKey, paramConfig] of Object.entries(operationDefinition.params || {})) {
      const hasValue = rawParams[paramKey] !== undefined && rawParams[paramKey] !== null && rawParams[paramKey] !== '';

      if (!hasValue) {
        if (paramConfig.required) {
          errors.push(`${prefix} 的 ${paramKey} 是必填参数`);
          continue;
        }

        if (paramConfig.default !== undefined) {
          normalizedParams[paramKey] = clone(paramConfig.default);
        }
        continue;
      }

      try {
        normalizedParams[paramKey] = coerceParamValue(rawParams[paramKey], paramConfig);
      } catch (error) {
        errors.push(`${prefix} 的 ${paramKey} 无效: ${error.message}`);
      }
    }

    return {
      type: operationDefinition.apiType,
      normalizedType: operationDefinition.type,
      params: normalizedParams,
    };
  }).filter(Boolean);

  if (errors.length > 0) {
    return { ok: false, errors, operations: normalizedOperations };
  }

  return { ok: true, errors: [], operations: normalizedOperations };
}

export function buildSubmitOperationPlanTool() {
  return {
    type: 'function',
    function: {
      name: 'submit_operation_plan',
      description: '提交最终可执行的图片处理操作链。只使用支持的 type，并尽量给出完整 params。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: {
            type: 'string',
            description: '用一句话总结你准备如何处理图片。',
          },
          operations: {
            type: 'array',
            minItems: 1,
            description: '按执行顺序排列的操作数组。',
            items: {
              oneOf: OPERATION_DEFINITIONS.map((operation) => ({
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: {
                    type: 'string',
                    enum: [operation.apiType],
                    description: operation.description,
                  },
                  params: clone(operation.jsonSchemaParams),
                },
                required: ['type', 'params'],
              })),
            },
          },
        },
        required: ['summary', 'operations'],
      },
    },
  };
}

