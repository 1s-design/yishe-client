/**
 * 图片裂变预设配置
 * 
 * 每个配置包含：
 * - name: 配置名称
 * - description: 配置描述
 * - operations: 操作链数组
 */

export const VARIATIONS_CONFIG = [
  // ========== 基础调整类 ==========
  {
    name: '标准尺寸-正方形',
    description: '调整为800x800像素的正方形图片，保持宽高比',
    operations: [
      {
        type: 'resize',
        params: {
          width: 800,
          height: 800,
          maintainAspectRatio: true,
          quality: 90
        }
      }
    ]
  },
  {
    name: '标准尺寸-横向',
    description: '调整为1920x1080像素的横向图片，保持宽高比',
    operations: [
      {
        type: 'resize',
        params: {
          width: 1920,
          height: 1080,
          maintainAspectRatio: true,
          quality: 90
        }
      }
    ]
  },
  {
    name: '标准尺寸-竖向',
    description: '调整为1080x1920像素的竖向图片，保持宽高比',
    operations: [
      {
        type: 'resize',
        params: {
          width: 1080,
          height: 1920,
          maintainAspectRatio: true,
          quality: 90
        }
      }
    ]
  },
  {
    name: '缩略图',
    description: '生成300x300像素的缩略图，保持宽高比',
    operations: [
      {
        type: 'resize',
        params: {
          width: 300,
          height: 300,
          maintainAspectRatio: true,
          quality: 85
        }
      }
    ]
  },

  // ========== 格式转换类 ==========
  {
    name: '转换为PNG',
    description: '转换为PNG格式，支持透明背景',
    operations: [
      {
        type: 'convert',
        params: {
          format: 'png',
          quality: 95
        }
      }
    ]
  },
  {
    name: '转换为JPG',
    description: '转换为JPG格式，压缩文件大小',
    operations: [
      {
        type: 'convert',
        params: {
          format: 'jpg',
          quality: 85
        }
      }
    ]
  },
  {
    name: '转换为WEBP',
    description: '转换为WEBP格式，现代浏览器支持，文件更小',
    operations: [
      {
        type: 'convert',
        params: {
          format: 'webp',
          quality: 85
        }
      }
    ]
  },

  // ========== 黑白效果类 ==========
  {
    name: '经典黑白',
    description: '转换为经典黑白效果，使用Rec709算法',
    operations: [
      {
        type: 'grayscale',
        params: {
          method: 'Rec709',
          intensity: 100
        }
      }
    ]
  },
  {
    name: '高对比黑白',
    description: '高对比度黑白效果，增强视觉冲击力',
    operations: [
      {
        type: 'grayscale',
        params: {
          method: 'Rec709',
          intensity: 100
        }
      },
      {
        type: 'contrast',
        params: {
          value: 30
        }
      }
    ]
  },
  {
    name: '柔和黑白',
    description: '柔和的黑白效果，使用平均算法',
    operations: [
      {
        type: 'grayscale',
        params: {
          method: 'Average',
          intensity: 100
        }
      }
    ]
  },

  // ========== 复古效果类 ==========
  {
    name: '怀旧风格',
    description: '添加怀旧褐色调，营造复古氛围',
    operations: [
      {
        type: 'sepia',
        params: {
          intensity: 80
        }
      }
    ]
  },
  {
    name: '老照片',
    description: '模拟老照片效果，怀旧色调+轻微模糊',
    operations: [
      {
        type: 'sepia',
        params: {
          intensity: 70
        }
      },
      {
        type: 'blur',
        params: {
          radius: 2,
          sigma: 1
        }
      }
    ]
  },
  {
    name: '复古海报',
    description: '复古海报风格，高对比度+怀旧色调',
    operations: [
      {
        type: 'sepia',
        params: {
          intensity: 60
        }
      },
      {
        type: 'contrast',
        params: {
          value: 40
        }
      },
      {
        type: 'posterize',
        params: {
          levels: 8
        }
      }
    ]
  },

  // ========== 艺术效果类 ==========
  {
    name: '油画效果',
    description: '模拟油画笔触效果，艺术感十足',
    operations: [
      {
        type: 'oil-painting',
        params: {
          radius: 5
        }
      }
    ]
  },
  {
    name: '素描效果',
    description: '转换为铅笔素描风格',
    operations: [
      {
        type: 'sketch',
        params: {
          radius: 3,
          sigma: 1
        }
      }
    ]
  },
  {
    name: '炭笔画',
    description: '模拟炭笔画效果，黑白艺术风格',
    operations: [
      {
        type: 'charcoal',
        params: {
          radius: 2,
          sigma: 1
        }
      }
    ]
  },
  {
    name: '浮雕效果',
    description: '添加浮雕效果，增强立体感',
    operations: [
      {
        type: 'emboss',
        params: {
          radius: 1
        }
      }
    ]
  },

  // ========== 模糊与锐化类 ==========
  {
    name: '轻微模糊',
    description: '添加轻微模糊效果，柔和画面',
    operations: [
      {
        type: 'blur',
        params: {
          radius: 3,
          sigma: 2
        }
      }
    ]
  },
  {
    name: '强烈模糊',
    description: '强烈模糊效果，营造梦幻氛围',
    operations: [
      {
        type: 'blur',
        params: {
          radius: 10,
          sigma: 8
        }
      }
    ]
  },
  {
    name: '锐化增强',
    description: '增强图片清晰度，突出细节',
    operations: [
      {
        type: 'sharpen',
        params: {
          radius: 1,
          amount: 1.5
        }
      }
    ]
  },
  {
    name: '超锐化',
    description: '超强锐化效果，极致清晰',
    operations: [
      {
        type: 'sharpen',
        params: {
          radius: 2,
          amount: 2
        }
      }
    ]
  },

  // ========== 颜色调整类 ==========
  {
    name: '增强饱和度',
    description: '提高色彩饱和度，让颜色更鲜艳',
    operations: [
      {
        type: 'saturation',
        params: {
          value: 30
        }
      }
    ]
  },
  {
    name: '降低饱和度',
    description: '降低色彩饱和度，营造淡雅风格',
    operations: [
      {
        type: 'saturation',
        params: {
          value: -30
        }
      }
    ]
  },
  {
    name: '提高亮度',
    description: '提高图片亮度，让画面更明亮',
    operations: [
      {
        type: 'brightness',
        params: {
          value: 20
        }
      }
    ]
  },
  {
    name: '降低亮度',
    description: '降低图片亮度，营造暗调氛围',
    operations: [
      {
        type: 'brightness',
        params: {
          value: -20
        }
      }
    ]
  },
  {
    name: '增强对比度',
    description: '提高对比度，增强视觉冲击',
    operations: [
      {
        type: 'contrast',
        params: {
          value: 30
        }
      }
    ]
  },
  {
    name: '柔和对比度',
    description: '降低对比度，营造柔和氛围',
    operations: [
      {
        type: 'contrast',
        params: {
          value: -20
        }
      }
    ]
  },
  {
    name: '暖色调',
    description: '添加暖色调，营造温馨氛围',
    operations: [
      {
        type: 'colorize',
        params: {
          color: '#FFA500',
          amount: 30
        }
      }
    ]
  },
  {
    name: '冷色调',
    description: '添加冷色调，营造清新氛围',
    operations: [
      {
        type: 'colorize',
        params: {
          color: '#4169E1',
          amount: 30
        }
      }
    ]
  },

  // ========== 特殊效果类 ==========
  {
    name: '负片效果',
    description: '反转颜色，生成负片效果',
    operations: [
      {
        type: 'negate',
        params: {}
      }
    ]
  },
  {
    name: '晕影效果',
    description: '添加四角暗化晕影，突出中心',
    operations: [
      {
        type: 'vignette',
        params: {
          radius: 100,
          sigma: 50
        }
      }
    ]
  },
  {
    name: '像素化',
    description: '像素化效果，复古游戏风格',
    operations: [
      {
        type: 'pixelate',
        params: {
          size: 10
        }
      }
    ]
  },
  {
    name: '马赛克',
    description: '马赛克效果，保护隐私',
    operations: [
      {
        type: 'mosaic',
        params: {
          size: 20
        }
      }
    ]
  },
  {
    name: '漩涡效果',
    description: '添加漩涡扭曲效果，艺术感强',
    operations: [
      {
        type: 'swirl',
        params: {
          degrees: 90
        }
      }
    ]
  },
  {
    name: '波浪效果',
    description: '添加波浪扭曲效果，动感十足',
    operations: [
      {
        type: 'wave',
        params: {
          amplitude: 10,
          wavelength: 50
        }
      }
    ]
  },
  {
    name: '爆炸效果',
    description: '向外爆炸扭曲效果，视觉冲击强',
    operations: [
      {
        type: 'explode',
        params: {
          amount: 1.2
        }
      }
    ]
  },
  {
    name: '收缩效果',
    description: '向内收缩扭曲效果，聚焦中心',
    operations: [
      {
        type: 'implode',
        params: {
          amount: -0.5
        }
      }
    ]
  },

  // ========== 旋转与翻转类 ==========
  {
    name: '旋转90度',
    description: '顺时针旋转90度',
    operations: [
      {
        type: 'rotate',
        params: {
          degrees: 90,
          backgroundColor: 'white'
        }
      }
    ]
  },
  {
    name: '旋转180度',
    description: '旋转180度，上下颠倒',
    operations: [
      {
        type: 'rotate',
        params: {
          degrees: 180,
          backgroundColor: 'white'
        }
      }
    ]
  },
  {
    name: '水平翻转',
    description: '左右镜像翻转',
    operations: [
      {
        type: 'flop',
        params: {}
      }
    ]
  },
  {
    name: '垂直翻转',
    description: '上下镜像翻转',
    operations: [
      {
        type: 'flip',
        params: {}
      }
    ]
  },

  // ========== 组合效果类 ==========
  {
    name: '清新风格',
    description: '提高亮度+增强饱和度+轻微锐化，清新明亮',
    operations: [
      {
        type: 'brightness',
        params: {
          value: 15
        }
      },
      {
        type: 'saturation',
        params: {
          value: 20
        }
      },
      {
        type: 'sharpen',
        params: {
          radius: 1,
          amount: 1
        }
      }
    ]
  },
  {
    name: '电影风格',
    description: '降低亮度+增强对比度+添加晕影，电影质感',
    operations: [
      {
        type: 'brightness',
        params: {
          value: -10
        }
      },
      {
        type: 'contrast',
        params: {
          value: 25
        }
      },
      {
        type: 'vignette',
        params: {
          radius: 120,
          sigma: 60
        }
      }
    ]
  },
  {
    name: '日系风格',
    description: '提高亮度+降低对比度+降低饱和度，日系清新',
    operations: [
      {
        type: 'brightness',
        params: {
          value: 20
        }
      },
      {
        type: 'contrast',
        params: {
          value: -15
        }
      },
      {
        type: 'saturation',
        params: {
          value: -20
        }
      }
    ]
  },
  {
    name: '欧美风格',
    description: '增强对比度+增强饱和度+轻微锐化，欧美大片感',
    operations: [
      {
        type: 'contrast',
        params: {
          value: 30
        }
      },
      {
        type: 'saturation',
        params: {
          value: 25
        }
      },
      {
        type: 'sharpen',
        params: {
          radius: 1,
          amount: 1.2
        }
      }
    ]
  },
  {
    name: '黑白电影',
    description: '黑白+高对比度+轻微模糊，经典黑白电影',
    operations: [
      {
        type: 'grayscale',
        params: {
          method: 'Rec709',
          intensity: 100
        }
      },
      {
        type: 'contrast',
        params: {
          value: 35
        }
      },
      {
        type: 'blur',
        params: {
          radius: 1,
          sigma: 0.5
        }
      }
    ]
  },
  {
    name: '艺术海报',
    description: '高对比度+海报化+锐化，艺术海报风格',
    operations: [
      {
        type: 'contrast',
        params: {
          value: 40
        }
      },
      {
        type: 'posterize',
        params: {
          levels: 6
        }
      },
      {
        type: 'sharpen',
        params: {
          radius: 1,
          amount: 1.5
        }
      }
    ]
  },
  {
    name: '梦幻风格',
    description: '降低对比度+轻微模糊+提高亮度，梦幻柔和',
    operations: [
      {
        type: 'contrast',
        params: {
          value: -20
        }
      },
      {
        type: 'blur',
        params: {
          radius: 2,
          sigma: 1.5
        }
      },
      {
        type: 'brightness',
        params: {
          value: 15
        }
      }
    ]
  },
  {
    name: '暗黑风格',
    description: '降低亮度+增强对比度+降低饱和度，暗黑酷炫',
    operations: [
      {
        type: 'brightness',
        params: {
          value: -25
        }
      },
      {
        type: 'contrast',
        params: {
          value: 35
        }
      },
      {
        type: 'saturation',
        params: {
          value: -30
        }
      }
    ]
  },
  {
    name: '高光风格',
    description: '大幅提高亮度+增强对比度，高光明亮',
    operations: [
      {
        type: 'brightness',
        params: {
          value: 30
        }
      },
      {
        type: 'contrast',
        params: {
          value: 30
        }
      },
      {
        type: 'sharpen',
        params: {
          radius: 1,
          amount: 1.3
        }
      }
    ]
  },
  {
    name: '柔和风格',
    description: '降低对比度+降低饱和度+轻微模糊，柔和淡雅',
    operations: [
      {
        type: 'contrast',
        params: {
          value: -25
        }
      },
      {
        type: 'saturation',
        params: {
          value: -25
        }
      },
      {
        type: 'blur',
        params: {
          radius: 1,
          sigma: 0.8
        }
      }
    ]
  },

  // ========== 裁剪类 ==========
  {
    name: '正方形裁剪',
    description: '裁剪为正方形，居中裁剪',
    operations: [
      {
        type: 'crop',
        params: {
          x: 0,
          y: 0,
          width: 800,
          height: 800
        }
      }
    ]
  },
  {
    name: '圆形裁剪',
    description: '裁剪为圆形，透明背景',
    operations: [
      {
        type: 'shapeCrop',
        params: {
          shape: 'circle',
          width: 800,
          height: 800,
          backgroundColor: 'transparent'
        }
      }
    ]
  },
  {
    name: '心形裁剪',
    description: '裁剪为心形，透明背景',
    operations: [
      {
        type: 'shapeCrop',
        params: {
          shape: 'heart',
          width: 800,
          height: 800,
          backgroundColor: 'transparent'
        }
      }
    ]
  },
  {
    name: '星形裁剪',
    description: '裁剪为五角星形，透明背景',
    operations: [
      {
        type: 'shapeCrop',
        params: {
          shape: 'star',
          width: 800,
          height: 800,
          backgroundColor: 'transparent'
        }
      }
    ]
  },

  // ========== 高级效果类 ==========
  {
    name: '边缘检测',
    description: '提取图片边缘，线条艺术',
    operations: [
      {
        type: 'edge',
        params: {
          radius: 1
        }
      }
    ]
  },
  {
    name: '噪点效果',
    description: '添加噪点，模拟胶片质感',
    operations: [
      {
        type: 'noise',
        params: {
          type: 'Gaussian',
          amount: 10
        }
      }
    ]
  },
  {
    name: '去噪处理',
    description: '去除噪点，让图片更清晰',
    operations: [
      {
        type: 'despeckle',
        params: {}
      }
    ]
  },
  {
    name: '阈值处理',
    description: '二值化处理，黑白分明',
    operations: [
      {
        type: 'threshold',
        params: {
          threshold: 50
        }
      }
    ]
  },
  {
    name: '量化处理',
    description: '减少颜色数量，简化色彩',
    operations: [
      {
        type: 'quantize',
        params: {
          colors: 16
        }
      }
    ]
  },
  {
    name: '色调分离',
    description: '色调分离效果，艺术感强',
    operations: [
      {
        type: 'posterize',
        params: {
          levels: 4
        }
      }
    ]
  },
  {
    name: '纹理叠加',
    description: '添加纹理效果，增强质感',
    operations: [
      {
        type: 'texture',
        params: {
          texture: 'canvas'
        }
      }
    ]
  },
  {
    name: '曝光过度',
    description: '模拟曝光过度效果，高光溢出',
    operations: [
      {
        type: 'solarize',
        params: {
          threshold: 50
        }
      }
    ]
  },
  {
    name: '扩散效果',
    description: '扩散模糊效果，艺术感强',
    operations: [
      {
        type: 'spread',
        params: {
          amount: 5
        }
      }
    ]
  },
  {
    name: '自适应模糊',
    description: '自适应模糊，保持边缘清晰',
    operations: [
      {
        type: 'adaptive-blur',
        params: {
          radius: 5,
          sigma: 3
        }
      }
    ]
  },
  {
    name: '自适应锐化',
    description: '自适应锐化，智能增强细节',
    operations: [
      {
        type: 'adaptive-sharpen',
        params: {
          radius: 2,
          sigma: 1
        }
      }
    ]
  },
  {
    name: '自动色阶',
    description: '自动调整色阶，优化色彩',
    operations: [
      {
        type: 'auto-level',
        params: {}
      }
    ]
  },
  {
    name: '自动对比度',
    description: '自动调整对比度，优化画面',
    operations: [
      {
        type: 'auto-contrast',
        params: {}
      }
    ]
  },
  {
    name: '自动伽马',
    description: '自动调整伽马值，优化亮度',
    operations: [
      {
        type: 'auto-gamma',
        params: {}
      }
    ]
  },
  {
    name: '归一化',
    description: '归一化处理，优化色彩分布',
    operations: [
      {
        type: 'normalize',
        params: {}
      }
    ]
  },
  {
    name: '均衡化',
    description: '直方图均衡化，增强对比度',
    operations: [
      {
        type: 'equalize',
        params: {}
      }
    ]
  },
  {
    name: '伽马调整',
    description: '调整伽马值，优化亮度曲线',
    operations: [
      {
        type: 'gamma',
        params: {
          value: 1.2
        }
      }
    ]
  }
];
