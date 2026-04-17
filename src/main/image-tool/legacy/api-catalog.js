import { listOperationDefinitions, getOperationDefinition } from './operation-registry.js';
import { getDefaultImageProcessorId, listImageProcessorRegistrations } from './processors/registry.js';

function buildOperationMeta(operation) {
  const apiType = operation.apiType;
  const endpoint = `/api/op/${apiType}`;

  return {
    type: operation.type,
    apiType,
    category: operation.category,
    description: operation.description,
    params: operation.params || {},
    requiredParams: operation.requiredParams || [],
    aliases: operation.aliases || [],
    schema: operation.jsonSchemaParams || null,
    endpoints: {
      single: endpoint,
      chain: '/api/process',
    },
  };
}

export function listOperationsMeta() {
  return listOperationDefinitions().map(buildOperationMeta);
}

export function resolveOperationMeta(apiType) {
  const operation = getOperationDefinition(apiType);
  return operation ? buildOperationMeta(operation) : null;
}

export function listOperationsByCategory() {
  const operations = listOperationsMeta();

  return operations.reduce((accumulator, operation) => {
    if (!accumulator[operation.category]) {
      accumulator[operation.category] = [];
    }

    accumulator[operation.category].push(operation);
    return accumulator;
  }, {});
}

export function buildServiceCatalog() {
  const operations = listOperationsMeta();

  return {
    service: {
      name: 'image-tool',
      description: '内置在客户端主进程中的图片处理能力，支持单功能调用和链式调用。',
      capabilities: [
        '单功能处理',
        '链式处理',
        '操作元数据查询',
        '操作目录查询',
        '前端案例模块',
      ],
    },
    endpoints: {
      upload: '/api/upload',
      info: '/api/info',
      operations: '/api/operations',
      operationDetail: '/api/operations/:type',
      operationSchemas: '/api/operation-schemas',
      examples: '/api/examples',
      exampleDetail: '/api/examples/:id',
      catalog: '/api/catalog',
      processorStatus: '/api/image-processor-status',
      variationsConfig: '/api/variations-config',
      singleOperation: '/api/op/:type',
      process: '/api/process',
      effects: '/api/effects',
      variations: '/api/variations',
    },
    processors: {
      default: getDefaultImageProcessorId(),
      available: listImageProcessorRegistrations(),
    },
    counts: {
      operations: operations.length,
    },
    categories: listOperationsByCategory(),
  };
}
