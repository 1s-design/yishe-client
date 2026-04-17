export const FILTER_OPERATIONS_CONFIG = [
  {
    type: 'filter-blur',
    category: 'filter',
    description: '模糊滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'blur',
  },
  {
    type: 'filter-sharpen',
    category: 'filter',
    description: '锐化滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'sharpen',
  },
  {
    type: 'filter-emboss',
    category: 'filter',
    description: '浮雕滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'emboss',
  },
  {
    type: 'filter-edge',
    category: 'filter',
    description: '边缘检测滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'edge',
  },
  {
    type: 'filter-charcoal',
    category: 'filter',
    description: '炭笔画滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'charcoal',
  },
  {
    type: 'filter-oil-painting',
    category: 'filter',
    description: '油画滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'oil-painting',
  },
  {
    type: 'filter-sepia',
    category: 'filter',
    description: '怀旧滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'sepia',
  },
  {
    type: 'filter-grayscale',
    category: 'filter',
    description: '快速灰度滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'grayscale',
  },
  {
    type: 'filter-negate',
    category: 'filter',
    description: '负片滤镜',
    params: {
      intensity: { type: 'number', description: '滤镜强度（0-10），默认 1', default: 1, minimum: 0, maximum: 10 },
    },
    filterType: 'negate',
  },
];
