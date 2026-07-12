import type { RegisteredTemplate } from "./registry";

const seedImage = (seed: string) => ({
  type: "image" as const,
  src: `https://picsum.photos/seed/${seed}/1600/2000`,
  alt: seed,
});

export const aiUniversalTemplateMetadata = {
  id: "ai-universal",
  compositionId: "AiUniversal",
  name: "AI 智能编排",
  description:
    "AI 原生动态视频编排引擎。不需要选择固定模板，AI 根据对话内容自动生成场景编排（SceneGraph），包括背景、文字、图片、动画、转场等。支持 14 种图层类型自由组合。",
  category: "通用",
  style: "AI 动态编排 / SceneGraph / 自由组合",
  useCase: "适合 AI Agent 根据对话内容智能生成视频，自由度远高于固定模板。",
  durationLabel: "动态",
  tags: ["AI", "智能编排", "动态", "通用", "SceneGraph"],
  scenes: [{ title: "动态场景", summary: "AI 根据内容自动生成场景编排" }],
  animationHighlights: [
    "AI 自动编排场景顺序和转场",
    "14 种图层类型自由组合",
    "16 套配色预设 + 自定义配色",
  ],
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 300,
  defaultInputProps: {
    videoConfig: {
      meta: { title: "AI Video", orientation: "portrait" },
      palette: { preset: "noirGold" },
      scenes: [
        {
          duration: 3,
          layers: [
            { type: "eyebrow", text: "AI Generated" },
            { type: "headline", text: "AI 智能编排视频" },
            { type: "subtitle", text: "基于对话内容自动生成" },
          ],
        },
        {
          duration: 4,
          layers: [
            {
              type: "text",
              text: "AI 会根据你的描述，自动编排场景、文字、图片和动画。",
            },
            {
              type: "badge-row",
              badges: ["智能编排", "自由组合", "动态生成"],
            },
          ],
          transition: "fade",
        },
        {
          duration: 3,
          layers: [{ type: "cta", text: "开始使用" }],
          transition: "fade",
        },
      ],
    },
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
  },
  editableFields: ["videoConfig", "width", "height", "fps", "durationInFrames"],
  assetSummary:
    "AI 动态生成，无需固定素材。AI 根据内容自动选择合适的图层、动画和转场。",
  assets: [
    {
      key: "width",
      type: "number",
      label: "视频宽度",
      description: "输出宽度，支持横屏/竖屏/方屏",
    },
    {
      key: "height",
      type: "number",
      label: "视频高度",
      description: "输出高度，支持横屏/竖屏/方屏",
    },
    {
      key: "fps",
      type: "number",
      label: "帧率",
      description: "默认 30fps，可按平台需要调整",
    },
    {
      key: "durationInFrames",
      type: "number",
      label: "总帧数",
      description: "控制视频总时长",
    },
  ],
  inputSchema: [
    {
      key: "videoConfig",
      type: "object",
      label: "视频配置（SceneGraph）",
      description:
        "AI 生成的视频场景编排 JSON。包含 meta（标题/画幅）、palette（配色）、scenes（场景数组）。每个场景含 duration（秒）、background（背景）、layers（图层数组）。支持 14 种图层类型：eyebrow/headline/subtitle/text/badge-row/price/metrics/features/media/cta/quote/divider/progress-bar/bullet-list。",
      required: true,
      rows: 20,
      helperText:
        "videoConfig 是 AI Agent 根据对话内容自动生成的 SceneGraph JSON。结构：{ meta: {title, orientation}, palette: {preset|custom}, scenes: [{duration, background?, layers: [{type, ...}]}] }",
      example: {
        meta: { title: "咖啡店开业", orientation: "portrait" },
        palette: { preset: "financeAmber" },
        scenes: [
          {
            duration: 3,
            layers: [
              { type: "eyebrow", text: "Grand Opening" },
              { type: "headline", text: "Morning Brew\n手冲咖啡 · 限时开业" },
            ],
          },
          {
            duration: 4,
            layers: [
              { type: "badge-row", badges: ["精品手冲", "开业周8折"] },
              { type: "price", price: "¥29.9", originalPrice: "¥38" },
            ],
            transition: "fade",
          },
          {
            duration: 3,
            layers: [{ type: "cta", text: "到店体验" }],
            transition: "fade",
          },
        ],
      },
    },
    {
      key: "width",
      type: "number",
      label: "视频宽度",
      description: "输出宽度(px)。",
      example: 1080,
    },
    {
      key: "height",
      type: "number",
      label: "视频高度",
      description: "输出高度(px)。",
      example: 1920,
    },
    {
      key: "fps",
      type: "number",
      label: "帧率",
      description: "输出帧率，默认 30。",
      example: 30,
    },
    {
      key: "durationInFrames",
      type: "number",
      label: "总帧数",
      description: "控制模板的完整时长。",
      example: 450,
    },
  ],
  example: {
    title: "AI 智能编排视频",
    copy: [
      "AI 智能编排",
      "根据对话内容自动生成场景编排",
      "14 种图层类型自由组合",
    ],
    media: [seedImage("gradient-gallery-01").src],
  },
} satisfies Omit<RegisteredTemplate<Record<string, unknown>>, "component" | "schema">;

export const publicAiTemplateCatalog = [aiUniversalTemplateMetadata];
