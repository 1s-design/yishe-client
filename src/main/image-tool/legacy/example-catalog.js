import { listOperationsMeta, resolveOperationMeta } from './api-catalog.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultParamValue(paramConfig, key, operationType) {
  if (paramConfig && paramConfig.default !== undefined) {
    return clone(paramConfig.default);
  }

  const fallbacks = {
    width: 1200,
    height: 1200,
    x: 0,
    y: 0,
    quality: 90,
    degrees: 90,
    format: 'png',
    shape: 'circle',
    backgroundColor: 'transparent',
    maintainAspectRatio: true,
    brightness: 10,
    contrast: 15,
    saturation: 8,
    opacity: 0.45,
    text: 'YISHE',
    fontSize: 42,
    fontFamily: 'Microsoft YaHei',
    color: '#FFFFFF',
    strokeColor: '#000000',
    strokeWidth: 1,
    position: 'bottom-right',
    marginX: 24,
    marginY: 24,
    angle: 0,
    repeat: false,
    watermarkScale: 0.25,
    watermarkImageFilename: 'logo.png',
    fuzz: 3,
    gravity: 'center',
    intensity: operationType.startsWith('filter-') ? 1.5 : 80,
    method: operationType === 'effects-grayscale' ? 'Rec709' : 'Erode',
    radius: 5,
    sigma: 2,
    amount: 0.65,
    threshold: 50,
    levels: 6,
    size: 16,
    value: 20,
    colors: 32,
    noiseType: 'Gaussian',
    textureType: 'Canvas',
    amplitude: 18,
    wavelength: 120,
    kernel: 'Disk',
    space: 'Gray',
    matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    points: [0, 0, 0, 0, 100, 0, 100, 10, 100, 100, 95, 100, 0, 100, 10, 90],
    expression: '(r+g+b)/3',
    tileSize: 160,
  };

  if (fallbacks[key] !== undefined) {
    return clone(fallbacks[key]);
  }

  return null;
}

function buildParamsForOperation(operation) {
  const params = {};
  const paramEntries = Object.entries(operation.params || {});

  for (const [key, config] of paramEntries) {
    const value = getDefaultParamValue(config, key, operation.apiType);

    if (value !== null && value !== undefined) {
      params[key] = value;
    }
  }

  if (operation.apiType === 'shapeCrop') {
    params.width = params.width || 600;
    params.height = params.height || 600;
  }

  return params;
}

function buildOperationExample(operation) {
  const params = buildParamsForOperation(operation);

  return {
    id: `single-${operation.apiType}`,
    title: `${operation.description}示例`,
    type: 'single',
    category: operation.category,
    cover: operation.apiType,
    summary: `演示如何单独调用 ${operation.apiType}。`,
    sourceHint: '传入 uploads 中的文件名，或直接传网络图片 URL。',
    tags: [operation.category, operation.apiType, 'single'],
    operationTypes: [operation.apiType],
    operations: [
      {
        type: operation.apiType,
        params,
      },
    ],
    request: {
      endpoint: `/api/op/${operation.apiType}`,
      method: 'POST',
      body: {
        filename: 'demo.jpg',
        params,
      },
    },
  };
}

const CURATED_WORKFLOW_EXAMPLES = [
  {
    id: 'workflow-basic-resize-convert',
    title: '第 1 步：统一尺寸并导出格式',
    type: 'workflow',
    category: 'workflow',
    cover: 'resize',
    summary: '从最基础的两步开始，先调整尺寸，再输出为目标格式。',
    sourceHint: '适合刚开始理解链式处理时使用。',
    tags: ['workflow', 'basic', 'resize', 'convert', 'teaching'],
    lessonOrder: 101,
    operationTypes: ['resize', 'convert'],
    operations: [
      { type: 'resize', params: { width: 1200, height: 1200, maintainAspectRatio: true, quality: 92 } },
      { type: 'convert', params: { format: 'png', quality: 100 } },
    ],
  },
  {
    id: 'workflow-basic-crop-resize',
    title: '第 2 步：先裁剪，再统一尺寸',
    type: 'workflow',
    category: 'workflow',
    cover: 'crop',
    summary: '在尺寸调整之前先做基础裁剪，理解操作顺序对结果的影响。',
    sourceHint: '适合先熟悉裁剪和缩放关系。',
    tags: ['workflow', 'basic', 'crop', 'resize', 'teaching'],
    lessonOrder: 102,
    operationTypes: ['crop', 'resize', 'convert'],
    operations: [
      { type: 'crop', params: { width: 1080, height: 1080, x: 0, y: 0, maintainAspectRatio: true } },
      { type: 'resize', params: { width: 800, height: 800, maintainAspectRatio: true, quality: 92 } },
      { type: 'convert', params: { format: 'jpg', quality: 90 } },
    ],
  },
  {
    id: 'workflow-watermark-delivery',
    title: '第 3 步：在基础输出上叠加水印',
    type: 'workflow',
    category: 'workflow',
    cover: 'watermark',
    summary: '先统一尺寸，再添加文字水印，理解“处理 + 输出”的最常见组合。',
    sourceHint: '适合预览图、样稿、交付前审核图。',
    tags: ['workflow', 'watermark', 'resize', 'convert', 'teaching'],
    lessonOrder: 103,
    operationTypes: ['resize', 'watermark', 'convert'],
    operations: [
      { type: 'resize', params: { width: 1600, height: 900, maintainAspectRatio: true, quality: 92 } },
      {
        type: 'watermark',
        params: {
          type: 'text',
          text: 'YISHE PREVIEW',
          position: 'center',
          opacity: 0.18,
          fontSize: 72,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 2,
          angle: -18,
        },
      },
      { type: 'convert', params: { format: 'jpg', quality: 90 } },
    ],
  },
  {
    id: 'workflow-ecommerce-thumb',
    title: '第 4 步：电商商品主图',
    type: 'workflow',
    category: 'workflow',
    cover: 'extent',
    summary: '引入 trim 和 extent，从基础组合升级到更完整的商品图标准化流程。',
    sourceHint: '适合商品白底图、目录图、聚合页缩略图。',
    tags: ['workflow', 'ecommerce', 'trim', 'extent', 'convert', 'teaching'],
    lessonOrder: 104,
    operationTypes: ['trim', 'extent', 'resize', 'convert'],
    operations: [
      { type: 'trim', params: { fuzz: 5, backgroundColor: 'white' } },
      { type: 'extent', params: { width: 1600, height: 1600, backgroundColor: 'white', gravity: 'center' } },
      { type: 'resize', params: { width: 1200, height: 1200, maintainAspectRatio: true, quality: 90 } },
      { type: 'convert', params: { format: 'webp', quality: 88 } },
    ],
  },
  {
    id: 'workflow-avatar-pack',
    title: '第 5 步：头像卡片工作流',
    type: 'workflow',
    category: 'workflow',
    cover: 'shapeCrop',
    summary: '加入形状裁剪和锐化，让组合处理从矩形流程升级到特定场景流程。',
    sourceHint: '适合用户头像、员工卡、人像资料图。',
    tags: ['workflow', 'avatar', 'shapeCrop', 'effects-sharpen', 'teaching'],
    lessonOrder: 105,
    operationTypes: ['shapeCrop', 'resize', 'effects-sharpen', 'convert'],
    operations: [
      { type: 'shapeCrop', params: { shape: 'circle', width: 720, height: 720, backgroundColor: 'transparent' } },
      { type: 'resize', params: { width: 512, height: 512, maintainAspectRatio: true, quality: 92 } },
      { type: 'effects-sharpen', params: { radius: 1, amount: 1.2 } },
      { type: 'convert', params: { format: 'png', quality: 100 } },
    ],
  },
  {
    id: 'workflow-editorial-poster',
    title: '第 6 步：海报风格增强',
    type: 'workflow',
    category: 'workflow',
    cover: 'effects-vignette',
    summary: '开始叠加多种风格效果，进入更复杂的视觉增强案例。',
    sourceHint: '适合活动海报、宣传图、社媒封面。',
    tags: ['workflow', 'poster', 'crop', 'effects-contrast', 'effects-vignette', 'teaching'],
    lessonOrder: 106,
    operationTypes: ['crop', 'effects-contrast', 'effects-saturation', 'effects-vignette', 'effects-sepia'],
    operations: [
      { type: 'crop', params: { width: 1080, height: 1350, x: 0, y: 0, maintainAspectRatio: true } },
      { type: 'effects-contrast', params: { value: 22 } },
      { type: 'effects-saturation', params: { value: 12 } },
      { type: 'effects-vignette', params: { radius: 90, sigma: 40 } },
      { type: 'effects-sepia', params: { intensity: 28 } },
    ],
  },
  {
    id: 'workflow-social-banner',
    title: '第 7 步：社媒横幅工作流',
    type: 'workflow',
    category: 'workflow',
    cover: 'effects-colorize',
    summary: '把基础尺寸处理与品牌色、亮度增强组合起来，作为综合收尾案例。',
    sourceHint: '适合作为教学流程中的综合示例。',
    tags: ['workflow', 'banner', 'resize', 'effects-brightness', 'effects-colorize', 'teaching'],
    lessonOrder: 107,
    operationTypes: ['resize', 'effects-brightness', 'effects-colorize', 'convert'],
    operations: [
      { type: 'resize', params: { width: 1920, height: 1080, maintainAspectRatio: true, quality: 90 } },
      { type: 'effects-brightness', params: { value: 10 } },
      { type: 'effects-colorize', params: { color: '#D94F04', intensity: 18 } },
      { type: 'convert', params: { format: 'jpg', quality: 88 } },
    ],
  },
];

const ATOMIC_OPERATION_PRIORITY = [
  'resize',
  'crop',
  'rotate',
  'convert',
  'watermark',
  'shapeCrop',
  'trim',
  'extent',
  'adjust',
];

function getAtomicOperationOrder(operation) {
  const explicitIndex = ATOMIC_OPERATION_PRIORITY.indexOf(operation.apiType);
  if (explicitIndex >= 0) {
    return explicitIndex + 1;
  }

  if (operation.category === 'filter') {
    return 200;
  }

  if (operation.category === 'effect') {
    return 300;
  }

  return 400;
}

const SINGLE_OPERATION_EXAMPLES = listOperationsMeta()
  .sort((left, right) => {
    const orderDiff = getAtomicOperationOrder(left) - getAtomicOperationOrder(right);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    return String(left.description || left.apiType).localeCompare(String(right.description || right.apiType), 'zh-CN');
  })
  .map((operation, index) => ({
    ...buildOperationExample(operation),
    title: `原子 ${String(index + 1).padStart(2, '0')} · ${operation.description}`,
    summary: `从单一能力入手：演示如何单独调用 ${operation.apiType}。`,
    tags: ['single', 'atomic', operation.category, operation.apiType, 'teaching'],
    lessonOrder: index + 1,
  }));

export const EXAMPLE_CATALOG = [
  ...SINGLE_OPERATION_EXAMPLES,
  ...CURATED_WORKFLOW_EXAMPLES,
];

export function listExamples() {
  return EXAMPLE_CATALOG
    .slice()
    .sort((left, right) => Number(left.lessonOrder || 9999) - Number(right.lessonOrder || 9999))
    .map((example) => ({
    ...example,
    request: example.request || {
      endpoint: '/api/process',
      method: 'POST',
      body: {
        filename: 'demo.jpg',
        operations: example.operations,
      },
    },
  }));
}

export function getExampleById(id) {
  const example = EXAMPLE_CATALOG.find((item) => item.id === id);
  if (!example) return null;

  return {
    ...example,
    request: example.request || {
      endpoint: '/api/process',
      method: 'POST',
      body: {
        filename: 'demo.jpg',
        operations: example.operations,
      },
    },
    operationDetails: (example.operationTypes || [])
      .map((type) => resolveOperationMeta(type))
      .filter(Boolean),
  };
}
