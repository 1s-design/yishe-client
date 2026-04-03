# 发布平台数据处理系统

## 📋 概述

这是一个 **Client 端集中处理** 的发布数据转换框架，用于处理不同平台对数据的差异化需求。

### 核心特点

- ✅ **分层设计**：每个平台的转换器独立拆开，方便维护
- ✅ **统一接口**：所有转换器继承 `BaseTransformer`，遵循一致的接口
- ✅ **平台隔离**：各平台的特定逻辑完全封装，互不干扰
- ✅ **实时反馈**：Client 端处理可以提前发现问题，给用户实时反馈
- ✅ **易于扩展**：添加新平台只需创建新的转换器类

---

## 🏗️ 系统架构

```
yishe-client/src/renderer/src/services/publish/
├── types.ts                          # 类型定义
├── BaseTransformer.ts                # 基础转换器抽象类
├── PublishService.ts                 # 发布服务协调器
├── logger.ts                         # 日志服务
├── transformers/                     # 各平台转换器目录
│   ├── index.ts                      # 导出和映射
│   ├── DouyinTransformer.ts         # 抖音转换器
│   ├── XianyuTransformer.ts         # 咸鱼转换器
│   ├── ShumaiyunTransformer.ts      # 速卖通转换器
│   ├── AmazonTransformer.ts         # 亚马逊转换器
│   └── SheinTransformer.ts          # 希音转换器
├── examples.ts                       # 使用示例
├── index.ts                          # 统一导出
└── README.md                         # 本文档
```

---

## 🚀 快速开始

### 1. 导入服务

```typescript
import { publishService } from '@/services/publish'
```

### 2. 处理单个平台的发布数据

```typescript
const result = await publishService.processPublish(
  'xianyu', // 平台类型
  {
    productTitle: 'iPhone 12',
    productDesc: '商品描述...',
    images: [{ url: '...', ext: 'jpg' }]
  }
)

if (result.success) {
  console.log('转换后的数据:', result.data)
  console.log('警告信息:', result.warnings)
} else {
  console.error('处理失败:', result.error)
}
```

### 3. 批量处理多平台

```typescript
const results = await publishService.processMultiplePlatforms(
  ['douyin', 'xianyu', 'amazon'],
  rawData
)
```

### 4. 字段验证

```typescript
const validation = publishService.validateField(
  'amazon',
  'title',
  '商品标题'
)
```

---

## 📖 详细文档

### 数据流程

```
Admin 发送数据
        ↓
Client 接收 (publishService.processPublish)
        ├─ 1️⃣ 获取平台转换器
        ├─ 2️⃣ 验证数据 (validator.validate)
        ├─ 3️⃣ 预处理 (getPreprocessor)
        ├─ 4️⃣ 转换数据 (defaultTransform)
        ├─ 5️⃣ 应用限制 (applyLimits)
        └─ 返回处理结果 (PublishResult)
        ↓
Uploader 接收处理后的数据
        └─ 填充表单并发布
```

### 平台转换器详解

#### 基础转换器 (BaseTransformer)

所有转换器的基类，提供通用功能：

```typescript
// 验证数据
validate(data: PublishRawData): ValidationResult

// 转换数据
async transform(data: PublishRawData, options?: PreprocessOptions): Promise<TransformResult>

// 获取预处理器
getPreprocessor(): (data: PublishRawData) => Promise<PublishRawData>
```

#### 子转换器实现

每个平台的转换器都继承 `BaseTransformer`，可以重写以下方法：

**抖音转换器 (DouyinTransformer)**
- 检测内容类型（图片/视频）
- 提取话题标签 (#xxx)
- 提取@提及
- 选择合适的发布URL

**咸鱼转换器 (XianyuTransformer)**
- 提取价格信息
- 检测物品新旧状态
- 清理违规词汇
- 图片限制（最多9张）

**速卖通转换器 (ShumaiyunTransformer)**
- 生成 SKU
- 提取分类信息
- 提取关键词
- 图片限制（最多10张）

**亚马逊转换器 (AmazonTransformer)**
- 生成/验证 ASIN
- 生成 UPC/GTIN
- 提取品牌信息
- 分解标题为结构化部分
- 提取 Bullet Points
- 图片限制（最多8张）

**希音转换器 (SheinTransformer)**
- 提取尺码信息
- 提取材质信息
- 提取颜色信息
- 检测商品风格
- 生成 SKU
- 图片限制（最多12张）

---

## 🛠️ 创建新的平台转换器

### 第一步：创建转换器类

```typescript
// src/services/publish/transformers/MyPlatformTransformer.ts

import { BaseTransformer } from '../BaseTransformer'
import type { PlatformType, PlatformConfig } from '../types'

export class MyPlatformTransformer extends BaseTransformer {
  platform: PlatformType = 'myplatform'

  config: PlatformConfig = {
    name: '我的平台',
    contentTypes: ['image', 'video'],
    limits: {
      title: { min: 5, max: 100 },
      images: { max: 10, formats: ['jpg', 'png'] }
    },
    requiredFields: ['title', 'images'],
    fieldMapping: {
      productTitle: 'title'
    }
  }

  // 可选：自定义验证
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) return baseValidation

    // 添加平台特定的验证逻辑
    return { valid: true, warnings: [] }
  }

  // 可选：自定义预处理
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      // 预处理逻辑
      return data
    }
  }

  // 可选：自定义转换
  override protected defaultTransform(data: PublishRawData): PlatformPublishData {
    const baseTransform = super.defaultTransform(data)
    // 添加平台特定字段
    return baseTransform
  }
}

export const myplatformTransformer = new MyPlatformTransformer()
```

### 第二步：注册转换器

```typescript
// src/services/publish/transformers/index.ts

export { myplatformTransformer, MyPlatformTransformer } from './MyPlatformTransformer'

export const transformerMap: Record<PlatformType, ITransformer> = {
  // ...
  myplatform: myplatformTransformer,
  // ...
}
```

---

## 📊 API 文档

### PublishService

#### `processPublish(platform, rawData, options?)`

处理单个平台的发布数据。

**参数：**
- `platform`: 平台类型
- `rawData`: 原始发布数据
- `options?`: 预处理选项

**返回：** `Promise<PublishResult>`

```typescript
{
  success: boolean
  platform: PlatformType
  data?: PlatformPublishData      // 处理后的数据（成功时）
  error?: string                   // 错误信息（失败时）
  warnings?: string[]              // 警告信息
  metadata?: {
    processedAt: string           // 处理时间
    originalDataSize: number      // 原始数据大小
    processedDataSize: number     // 处理后数据大小
  }
}
```

#### `processMultiplePlatforms(platforms, rawData, options?)`

批量处理多个平台的发布数据。

**返回：** `Promise<PublishResult[]>`

#### `getSupportedPlatforms()`

获取所有支持的平台列表。

**返回：** 平台信息数组

#### `validateField(platform, fieldName, value)`

验证单个字段是否符合平台要求。

---

## ⚠️ 注意事项

1. **字段映射**：不同平台的字段名称可能不同，通过 `fieldMapping` 进行转换
2. **文件访问**：如果启用 `validateFileAccess`，会检查所有文件URL的可访问性
3. **自动截取**：当图片/视频超出限制时，设置 `autoTrimImages/autoTrimVideos` 为 true 会自动截取
4. **警告信息**：warnings 表示数据可处理但不是最优的，应该提示用户
5. **错误信息**：error 表示数据不符合要求，无法处理

---

## 🔄 与 Uploader 的集成

处理后的数据发送给 Uploader：

```typescript
const result = await publishService.processPublish(platform, rawData)

if (result.success) {
  // 发送到 uploader
  const uploaderResult = await fetch('/api/browser/open-platform', {
    method: 'POST',
    body: JSON.stringify({
      platform: result.platform,
      data: result.data,  // ← 已处理的数据
      metadata: result.metadata
    })
  })
}
```

---

## 📝 日志

系统会自动记录处理过程中的信息：

```typescript
import { logger } from '@/services/logger'

logger.info('处理完成', { duration: 123, platform: 'xianyu' })
```

---

## 🧪 测试

参考 `examples.ts` 中的示例代码进行测试。

---

## 📞 相关文件

- Admin 端发布接口：`yishe-admin/src/views/publish/publishIndex/index.vue`
- Uploader 接收端：`yishe-uploader/src/api/browser.js`
- Platform 配置：`yishe-uploader/src/config/platforms.js`

