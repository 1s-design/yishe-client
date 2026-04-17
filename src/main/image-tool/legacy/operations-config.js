/**
 * 操作类型配置（平铺结构）
 * 
 * 用于AI prompt生成和操作类型验证
 * 当添加新操作类型时，只需在此数组中添加配置即可，AI prompt会自动同步
 * 
 * category: 'basic' - 基础操作（几何变换、格式转换等）
 * category: 'effect' - 图片效果（使用平铺格式，如 "grayscale", "blur" 等）
 */
export const OPERATIONS_CONFIG = [
  // 基础操作
  {
    type: 'resize',
    category: 'basic',
    description: '调整大小',
    params: {
      width: { type: 'number', description: '宽度（像素）', required: true, minimum: 1, maximum: 10000 },
      height: { type: 'number', description: '高度（像素）', required: true, minimum: 1, maximum: 10000 },
      maintainAspectRatio: { type: 'boolean', description: '保持宽高比', default: true },
      quality: { type: 'number', description: '质量（%）', default: 90, minimum: 1, maximum: 100 }
    }
  },
  {
    type: 'crop',
    category: 'basic',
    description: '矩形裁剪',
    params: {
      x: { type: 'number', description: 'X坐标（像素）', default: 0, minimum: 0 },
      y: { type: 'number', description: 'Y坐标（像素）', default: 0, minimum: 0 },
      width: { type: 'number', description: '宽度（像素）', required: true, minimum: 1, maximum: 10000 },
      height: { type: 'number', description: '高度（像素）', required: true, minimum: 1, maximum: 10000 },
      maintainAspectRatio: { type: 'boolean', description: '按目标宽高比例居中裁剪（忽略 x/y）', default: false }
    }
  },
  {
    type: 'shapeCrop',
    category: 'basic',
    description: '形状裁剪（圆形、椭圆等）',
    params: {
      shape: { type: 'string', description: '形状：circle|ellipse|star|triangle|diamond|heart|hexagon|octagon', required: true, enum: ['circle', 'ellipse', 'star', 'triangle', 'diamond', 'heart', 'hexagon', 'octagon'] },
      width: { type: 'number', description: '宽度（像素）', default: 200, minimum: 1, maximum: 10000 },
      height: { type: 'number', description: '高度（像素）', default: 200, minimum: 1, maximum: 10000 },
      x: { type: 'number', description: '中心X坐标（可选，留空则居中）', optional: true, minimum: 0 },
      y: { type: 'number', description: '中心Y坐标（可选，留空则居中）', optional: true, minimum: 0 },
      backgroundColor: { type: 'string', description: '背景颜色', default: 'transparent' }
    }
  },
  {
    type: 'rotate',
    category: 'basic',
    description: '旋转',
    params: {
      degrees: { type: 'number', description: '角度（度）', required: true, minimum: -360, maximum: 360 },
      backgroundColor: { type: 'string', description: '背景色', default: '#000000' }
    }
  },
  {
    type: 'convert',
    category: 'basic',
    description: '格式转换',
    params: {
      format: { type: 'string', description: '格式：jpg|png|gif|webp|bmp', required: true, enum: ['jpg', 'png', 'gif', 'webp', 'bmp'] },
      quality: { type: 'number', description: '质量（%）', default: 90, minimum: 1, maximum: 100 }
    }
  },
  {
    type: 'watermark',
    category: 'basic',
    description: '水印',
    params: {
      type: { type: 'string', description: '类型：text|image', default: 'text', enum: ['text', 'image'] },
      // ====== 文字水印 ======
      text: { type: 'string', description: '水印文字（type=text 时）', optional: true },
      fontSize: { type: 'number', description: '字体大小（px）（type=text 时）', default: 24, minimum: 1, maximum: 1000 },
      fontFamily: { type: 'string', description: '字体名称（type=text 时）', default: 'Microsoft YaHei' },
      color: { type: 'string', description: '文字颜色（type=text 时）', default: '#FFFFFF' },
      strokeColor: { type: 'string', description: '描边颜色（type=text 时，可选）', default: '' },
      strokeWidth: { type: 'number', description: '描边宽度（px）（type=text 时，可选）', default: 0 },

      // ====== 图片水印 ======
      watermarkImageFilename: { type: 'string', description: '水印图片文件名（通常是 uploads 中的文件名）（type=image 时）', optional: true },
      watermarkScale: { type: 'number', description: '水印图片缩放比例（type=image 时）', default: 1.0, minimum: 0.01, maximum: 20 },

      // ====== 通用定位/样式 ======
      position: {
        type: 'string',
        description: '位置：top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right|custom',
        default: 'bottom-right',
        enum: ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom']
      },
      marginX: { type: 'number', description: 'X 方向边距（像素）（position 生效时）', default: 10, minimum: 0, maximum: 5000 },
      marginY: { type: 'number', description: 'Y 方向边距（像素）（position 生效时）', default: 10, minimum: 0, maximum: 5000 },
      opacity: { type: 'number', description: '透明度（0-1）', default: 0.5, minimum: 0, maximum: 1 },
      angle: { type: 'number', description: '旋转角度（度）（image/text 平铺时可用）', default: 0, minimum: -360, maximum: 360 },
      repeat: { type: 'boolean', description: '是否重复平铺（仅当 image/text 水印启用平铺时）', default: false },
      tileSize: { type: 'number', description: '平铺间距（px）（repeat=true 时生效）', optional: true, minimum: 1, maximum: 5000 },

      // 自定义坐标（优先使用）
      x: { type: 'number', description: '自定义 X 坐标（像素，可选；x/y 同时传入时生效）', optional: true, minimum: 0 },
      y: { type: 'number', description: '自定义 Y 坐标（像素，可选；x/y 同时传入时生效）', optional: true, minimum: 0 }
    }
  },
  {
    type: 'adjust',
    category: 'basic',
    description: '调整亮度/对比度/饱和度',
    params: {
      brightness: { type: 'number', description: '亮度（-100到100）', default: 0, minimum: -100, maximum: 100 },
      contrast: { type: 'number', description: '对比度（-100到100）', default: 0, minimum: -100, maximum: 100 },
      saturation: { type: 'number', description: '饱和度（-100到100）', default: 0, minimum: -100, maximum: 100 }
    }
  },
  {
    type: 'trim',
    category: 'basic',
    description: '自动裁剪边缘（去除白边/透明边）',
    params: {
      fuzz: { type: 'number', description: '容差值（%）', default: 0, minimum: 0, maximum: 100 },
      backgroundColor: { type: 'string', description: '背景颜色（用于判断边缘）', optional: true }
    }
  },
  {
    type: 'extent',
    category: 'basic',
    description: '扩展画布（填充边界）',
    params: {
      width: { type: 'number', description: '宽度（像素）', required: true, minimum: 1, maximum: 10000 },
      height: { type: 'number', description: '高度（像素）', required: true, minimum: 1, maximum: 10000 },
      x: { type: 'number', description: 'X偏移（像素）', default: 0 },
      y: { type: 'number', description: 'Y偏移（像素）', default: 0 },
      backgroundColor: { type: 'string', description: '背景颜色', default: 'white' },
      gravity: { type: 'string', description: '对齐方式：center|north|south|east|west等', optional: true }
    }
  },
  {
    type: 'flip',
    category: 'basic',
    description: '垂直翻转（上下翻转）',
    params: {}
  },
  {
    type: 'flop',
    category: 'basic',
    description: '水平翻转（左右翻转）',
    params: {}
  },
  {
    type: 'transpose',
    category: 'basic',
    description: '主对角线翻转（左上到右下，旋转90度+水平翻转）',
    params: {}
  },
  {
    type: 'transverse',
    category: 'basic',
    description: '副对角线翻转（右上到左下，旋转90度+垂直翻转）',
    params: {}
  },
  // 图片效果
  { type: 'grayscale', category: 'effect', description: '黑白化', params: { intensity: { type: 'number', description: '强度（%）', default: 100, minimum: 0, maximum: 100 }, method: { type: 'string', description: '方法', optional: true } } },
  { type: 'blur', category: 'effect', description: '模糊', params: { radius: { type: 'number', description: '半径', default: 5, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 5, minimum: 0, maximum: 1000 } } },
  { type: 'sepia', category: 'effect', description: '怀旧效果', params: { intensity: { type: 'number', description: '强度', default: 80, minimum: 0, maximum: 100 } } },
  { type: 'negate', category: 'effect', description: '负片', params: {} },
  { type: 'sharpen', category: 'effect', description: '锐化', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, amount: { type: 'number', description: '数量', default: 1, minimum: 0, maximum: 100 } } },
  { type: 'charcoal', category: 'effect', description: '炭笔画', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 0.5, minimum: 0, maximum: 1000 } } },
  { type: 'sketch', category: 'effect', description: '素描', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 0.5, minimum: 0, maximum: 1000 } } },
  { type: 'emboss', category: 'effect', description: '浮雕', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 0.5, minimum: 0, maximum: 1000 } } },
  { type: 'edge', category: 'effect', description: '边缘检测', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 } } },
  { type: 'posterize', category: 'effect', description: '海报化', params: { levels: { type: 'number', description: '色阶数', default: 4, minimum: 2, maximum: 256 } } },
  { type: 'pixelate', category: 'effect', description: '像素化', params: { size: { type: 'number', description: '大小', default: 10, minimum: 1, maximum: 1000 } } },
  { type: 'mosaic', category: 'effect', description: '马赛克', params: { size: { type: 'number', description: '大小', default: 10, minimum: 1, maximum: 1000 } } },
  { type: 'brightness', category: 'effect', description: '亮度调整', params: { value: { type: 'number', description: '数值', default: 0, minimum: -100, maximum: 100 } } },
  { type: 'contrast', category: 'effect', description: '对比度调整', params: { value: { type: 'number', description: '数值', default: 0, minimum: -100, maximum: 100 } } },
  { type: 'saturation', category: 'effect', description: '饱和度调整', params: { value: { type: 'number', description: '数值', default: 0, minimum: -100, maximum: 100 } } },
  { type: 'gaussian-blur', category: 'effect', description: '高斯模糊', params: { radius: { type: 'number', description: '半径', default: 5, minimum: 0, maximum: 1000 } } },
  { type: 'motion-blur', category: 'effect', description: '运动模糊', params: { radius: { type: 'number', description: '半径', default: 10, minimum: 0, maximum: 1000 }, angle: { type: 'number', description: '角度', default: 0, minimum: -360, maximum: 360 } } },
  { type: 'oil-painting', category: 'effect', description: '油画', params: { radius: { type: 'number', description: '半径', default: 3, minimum: 0, maximum: 1000 } } },
  // 锐化相关
  { type: 'unsharp', category: 'effect', description: '非锐化遮罩', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, amount: { type: 'number', description: '数量', default: 1, minimum: 0, maximum: 100 }, threshold: { type: 'number', description: '阈值', default: 0.05, minimum: 0, maximum: 1 } } },
  // 颜色调整
  { type: 'hue', category: 'effect', description: '色相调整', params: { value: { type: 'number', description: '数值（-100到100）', default: 0, minimum: -100, maximum: 100 } } },
  { type: 'colorize', category: 'effect', description: '着色', params: { color: { type: 'string', description: '颜色（如#FF0000）', default: '#FF0000' }, intensity: { type: 'number', description: '强度（%）', default: 50, minimum: 0, maximum: 100 } } },
  { type: 'tint', category: 'effect', description: '色调调整', params: { color: { type: 'string', description: '颜色（如#FFD700）', default: '#FFD700' }, intensity: { type: 'number', description: '强度（%）', default: 50, minimum: 0, maximum: 100 } } },
  // 噪点和纹理
  {
    type: 'noise',
    category: 'effect',
    description: '添加噪点',
    params: {
      noiseType: { type: 'string', description: '噪点类型：Uniform|Gaussian|Impulse|Laplacian|Poisson|Random', default: 'Uniform', enum: ['Uniform', 'Gaussian', 'Impulse', 'Laplacian', 'Poisson', 'Random'] },
      amount: { type: 'number', description: '噪点强度（0-100），会映射到 ImageMagick 的 attenuate（amount > intensity 优先）', optional: true, minimum: 0, maximum: 100 },
      intensity: { type: 'number', description: '噪点强度别名（0-100）（等效于 amount）', optional: true, minimum: 0, maximum: 100 },
    }
  },
  // 注：ImageMagick 在噪点强度上既支持 amount/intensity，这里给出可选字段用于服务端映射
  // （服务端在 applyEffects 的 noise 分支中：params.amount ?? params.intensity）
  // 该条目保留在同一 effect 下扩展字段（不改变上面的 defaults）
  { type: 'despeckle', category: 'effect', description: '去噪点', params: {} },
  { type: 'texture', category: 'effect', description: '纹理效果', params: { textureType: { type: 'string', description: '纹理类型：Canvas|Burlap|Canvas2等', default: 'Canvas', enum: ['Canvas', 'Burlap', 'Canvas2'] } } },
  { type: 'lowpoly', category: 'effect', description: 'Low Poly 几何风格（三角面）', params: { pointCount: { type: 'number', description: '采样点数量（越大细节越多）', default: 900 }, edgeBias: { type: 'number', description: '边缘优先权重（0-1）', default: 0.65 }, edgeThreshold: { type: 'number', description: '边缘阈值（0-1）', default: 0.15 }, sampleScale: { type: 'number', description: '采样缩放（0.2-1，越小越快）', default: 1 }, colorSamples: { type: 'number', description: '每个三角形颜色采样点数（越大过渡越平滑）', default: 7 }, seed: { type: 'number', description: '随机种子（相同参数可复现）', default: 12345 }, strokeWidth: { type: 'number', description: '三角边线宽度（可选）', default: 0 }, strokeColor: { type: 'string', description: '三角边线颜色（可选）', optional: true } } },
  // 特殊效果
  { type: 'vignette', category: 'effect', description: '晕影效果', params: { radius: { type: 'number', description: '半径', default: 100, minimum: 0, maximum: 10000 }, sigma: { type: 'number', description: 'Sigma', default: 50, minimum: 0, maximum: 10000 } } },
  { type: 'solarize', category: 'effect', description: '曝光效果', params: { threshold: { type: 'number', description: '阈值（%）', default: 50, minimum: 0, maximum: 100 } } },
  { type: 'swirl', category: 'effect', description: '漩涡效果', params: { degrees: { type: 'number', description: '角度（度）', default: 90, minimum: -3600, maximum: 3600 } } },
  { type: 'wave', category: 'effect', description: '波浪效果', params: { amplitude: { type: 'number', description: '振幅', default: 25, minimum: 0, maximum: 10000 }, wavelength: { type: 'number', description: '波长', default: 150, minimum: 1, maximum: 10000 } } },
  { type: 'implode', category: 'effect', description: '内爆效果（向中心收缩）', params: { amount: { type: 'number', description: '强度（0-1）', default: 0.5, minimum: 0, maximum: 1 } } },
  { type: 'explode', category: 'effect', description: '爆炸效果（向外扩张）', params: { amount: { type: 'number', description: '强度（0-1）', default: 0.5, minimum: 0, maximum: 1 } } },
  { type: 'spread', category: 'effect', description: '扩散效果', params: { radius: { type: 'number', description: '半径', default: 3, minimum: 0, maximum: 1000 } } },
  // 图像增强
  { type: 'normalize', category: 'effect', description: '标准化（增强对比度）', params: {} },
  { type: 'equalize', category: 'effect', description: '均衡化（直方图均衡）', params: {} },
  { type: 'gamma', category: 'effect', description: '伽马校正', params: { value: { type: 'number', description: '伽马值', default: 1.0, minimum: 0.01, maximum: 10 } } },
  { type: 'threshold', category: 'effect', description: '阈值化（二值化）', params: { value: { type: 'number', description: '阈值（%）', default: 50, minimum: 0, maximum: 100 } } },
  { type: 'quantize', category: 'effect', description: '量化（减少颜色数）', params: { colors: { type: 'number', description: '颜色数量', default: 256, minimum: 2, maximum: 65536 } } },
  // 自适应效果
  { type: 'adaptive-blur', category: 'effect', description: '自适应模糊', params: { radius: { type: 'number', description: '半径', default: 5, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 5, minimum: 0, maximum: 1000 } } },
  { type: 'adaptive-sharpen', category: 'effect', description: '自适应锐化', params: { radius: { type: 'number', description: '半径', default: 1, minimum: 0, maximum: 1000 }, sigma: { type: 'number', description: 'Sigma', default: 1, minimum: 0, maximum: 1000 } } },
  // 形态学操作
  { type: 'morphology', category: 'effect', description: '形态学操作', params: { method: { type: 'string', description: '方法：Erode|Dilate|Open|Close|Smooth|EdgeIn|EdgeOut|TopHat|BottomHat|HitAndMiss|Thinning|Thicken|Distance|Voronoi|IterativeDistance', required: true, enum: ['Erode', 'Dilate', 'Open', 'Close', 'Smooth', 'EdgeIn', 'EdgeOut', 'TopHat', 'BottomHat', 'HitAndMiss', 'Thinning', 'Thicken', 'Distance', 'Voronoi', 'IterativeDistance'] }, kernel: { type: 'string', description: '核类型：Rectangle|Diamond|Octagon|Disk|Plus|Cross|Ring|Line|LineEnds|DoubleRing', default: 'Disk', enum: ['Rectangle', 'Diamond', 'Octagon', 'Disk', 'Plus', 'Cross', 'Ring', 'Line', 'LineEnds', 'DoubleRing'] }, size: { type: 'number', description: '核大小', default: 3, minimum: 1, maximum: 1000 } } },
  // 颜色空间转换
  { type: 'colorspace', category: 'effect', description: '色彩空间转换', params: { space: { type: 'string', description: '色彩空间：RGB|sRGB|Gray|CMYK|Lab|XYZ|HSL|HSV|HCL|LCH|Luv|YUV|YCbCr|YIQ|LinearGray|Rec601Luma|Rec709Luma|Rec2020Luma', required: true, enum: ['RGB', 'sRGB', 'Gray', 'CMYK', 'Lab', 'XYZ', 'HSL', 'HSV', 'HCL', 'LCH', 'Luv', 'YUV', 'YCbCr', 'YIQ', 'LinearGray', 'Rec601Luma', 'Rec709Luma', 'Rec2020Luma'] } } },
  // 自动调整
  { type: 'auto-level', category: 'effect', description: '自动色阶', params: {} },
  { type: 'auto-gamma', category: 'effect', description: '自动伽马', params: {} },
  { type: 'auto-contrast', category: 'effect', description: '自动对比度', params: {} },
  // 颜色矩阵
  { type: 'color-matrix', category: 'effect', description: '颜色矩阵变换', params: { matrix: { type: 'array', description: '5x5颜色矩阵（数组）', required: true, items: { type: 'number' } } } },
  // 扭曲变形
  { type: 'distort', category: 'effect', description: '扭曲变形', params: { method: { type: 'string', description: '方法：Affine|AffineProjection|Perspective|PerspectiveProjection|BilinearForward|BilinearReverse|Polynomial|Arc|Polar|DePolar|Barrel|BarrelInverse|Shepards|Resize', required: true, enum: ['Affine', 'AffineProjection', 'Perspective', 'PerspectiveProjection', 'BilinearForward', 'BilinearReverse', 'Polynomial', 'Arc', 'Polar', 'DePolar', 'Barrel', 'BarrelInverse', 'Shepards', 'Resize'] }, points: { type: 'array', description: '控制点数组', required: true, items: { type: 'number' } } } },
  // 其他效果
  { type: 'fx', category: 'effect', description: '自定义表达式（FX）', params: { expression: { type: 'string', description: 'FX表达式', required: true } } }
];

/**
 * 生成AI prompt中操作类型的描述文本
 */
export function generateOperationsPrompt() {
  let prompt = '';
  
  // 基础操作
  const basicOps = OPERATIONS_CONFIG.filter(op => op.category === 'basic');
  prompt += '支持的操作类型：\n';
  basicOps.forEach((op, index) => {
    prompt += `${index + 1}. ${op.type} - ${op.description}\n`;
    prompt += `   - type: "${op.type}"\n`;
    const paramList = Object.entries(op.params)
      .map(([key, paramDesc]) => {
        const required = paramDesc.required ? '（必填）' : paramDesc.optional ? '（可选）' : '';
        const defaultVal = paramDesc.default !== undefined ? `，默认: ${JSON.stringify(paramDesc.default)}` : '';
        return `${key}: ${paramDesc.type}${required}${defaultVal}`;
      })
      .join(', ');
    prompt += `   - params: {${paramList}}\n\n`;
  });
  
  // 图片效果
  const effectOps = OPERATIONS_CONFIG.filter(op => op.category === 'effect');
  prompt += `${basicOps.length + 1}. 图片效果 - ⚠️ 重要：不要使用 "effects" 类型，必须使用以下格式之一：\n\n`;
  prompt += `   方式1：使用平铺格式（推荐，最简单）\n`;
  effectOps.slice(0, 10).forEach((effect) => {
    const paramList = Object.keys(effect.params).length > 0 
      ? Object.entries(effect.params)
          .map(([key, paramDesc]) => {
            const defaultVal = paramDesc.default !== undefined ? `，默认: ${JSON.stringify(paramDesc.default)}` : '';
            return `${key}${defaultVal}`;
          })
          .join(', ')
      : '无参数';
    prompt += `   - type: "${effect.type}" - ${effect.description}，params: {${paramList}}\n`;
  });
  prompt += `   - 其他效果：${effectOps.slice(10).map(e => e.type).join(', ')}\n\n`;
  
  prompt += `   方式2：使用 "effects-xxx" 格式（也可以）\n`;
  prompt += `   - type: "effects-grayscale", type: "effects-blur", type: "effects-sepia" 等\n\n`;
  
  prompt += `   ⚠️ 禁止格式（会导致错误）：\n`;
  prompt += `   - ❌ type: "effects" （旧格式，已被禁用）\n`;
  prompt += `   - ❌ type: "filter" （旧格式，已被禁用）\n`;
  
  return prompt;
}

/**
 * 获取所有支持的操作类型列表
 */
export function getAllOperationTypes() {
  const basicOps = OPERATIONS_CONFIG.filter(op => op.category === 'basic');
  const effectOps = OPERATIONS_CONFIG.filter(op => op.category === 'effect');
  
  const basicTypes = basicOps.map(op => op.type);
  const effectTypes = effectOps.map(effect => effect.type);
  const effectTypesWithPrefix = effectOps.map(effect => `effects-${effect.type}`);
  
  return {
    basic: basicTypes,
    effects: effectTypes,
    effectsWithPrefix: effectTypesWithPrefix,
    all: [...basicTypes, ...effectTypes, ...effectTypesWithPrefix]
  };
}
