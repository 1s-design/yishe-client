import type { ComponentType } from "react";
import type { z } from "zod";
import {
  CinematicStoryTemplate,
  DataInsightTemplate,
  EditorialMontageTemplate,
  GradientImageTransitionTemplate,
  ImageShowcaseTemplate,
  KnowledgeCardsTemplate,
  MoodKineticTemplate,
  ProgressStepsTemplate,
  QuoteRevealTemplate,
  SimpleFadeTextTemplate,
  SlideUpCardsTemplate,
  cinematicStorySchema,
  dataInsightSchema,
  editorialMontageSchema,
  gradientImageTransitionSchema,
  imageShowcaseSchema,
  knowledgeCardsSchema,
  moodKineticSchema,
  progressStepsSchema,
  quoteRevealSchema,
  simpleFadeTextSchema,
  slideUpCardsSchema,
} from "./commercial-library";

export type TemplateAsset = {
  key: string;
  type: string;
  label: string;
  description?: string;
};

export type TemplateInputField = {
  key: string;
  type: string;
  label: string;
  description: string;
  required?: boolean;
  example?: unknown;
  placeholder?: string;
  helperText?: string;
  rows?: number;
};

export type TemplateScene = {
  title: string;
  summary: string;
};

export type TemplateExample = {
  title: string;
  copy: string[];
  media: string[];
};

export type RegisteredTemplate<
  Props extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  name: string;
  description: string;
  category: string;
  style: string;
  useCase: string;
  durationLabel: string;
  tags: string[];
  scenes: TemplateScene[];
  animationHighlights: string[];
  compositionId: string;
  component: ComponentType<Props>;
  schema: z.ZodType<Props>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultInputProps: Props & Record<string, unknown>;
  editableFields: string[];
  assetSummary: string;
  assets: TemplateAsset[];
  inputSchema: TemplateInputField[];
  example: TemplateExample;
};

const palette = (
  background: string,
  backgroundAlt: string,
  surface: string,
  text: string,
  mutedText: string,
  accent: string,
  accentAlt: string,
  glow: string,
) => ({
  background,
  backgroundAlt,
  surface,
  text,
  mutedText,
  accent,
  accentAlt,
  glow,
});

const palettes = {
  noirGold: palette(
    "#09070c",
    "#1b1118",
    "#23171f",
    "#f8f4ee",
    "#d2c5b5",
    "#f0c97b",
    "#d88f5c",
    "#ffcf8b",
  ),
  pearlSkin: palette(
    "#0e1220",
    "#1a2237",
    "#27304c",
    "#f5f7fb",
    "#c8d0e2",
    "#cbe2ff",
    "#f6d7ff",
    "#9fc2ff",
  ),
  midnightTech: palette(
    "#061018",
    "#102335",
    "#17314a",
    "#edf5ff",
    "#a7c7de",
    "#51d0ff",
    "#8cf2d7",
    "#46c4ff",
  ),
  eduCyan: palette(
    "#08131a",
    "#112733",
    "#183746",
    "#effbff",
    "#b0dce5",
    "#53d7ff",
    "#88ffdf",
    "#62d8ff",
  ),
  brandIvory: palette(
    "#0f1014",
    "#191c24",
    "#252936",
    "#fbfaf7",
    "#d8d5ca",
    "#dcb773",
    "#f1d7b0",
    "#efd19d",
  ),
  firePulse: palette(
    "#180707",
    "#311010",
    "#4e1714",
    "#fff5ef",
    "#f2c1b3",
    "#ff7e52",
    "#ffb06e",
    "#ff8e63",
  ),
  storySlate: palette(
    "#090e14",
    "#161f2b",
    "#243244",
    "#f7f6f2",
    "#c9cec9",
    "#a8d2ff",
    "#f2d3a9",
    "#bfd3ff",
  ),
};

const seedImage = (seed: string) => ({
  type: "image" as const,
  src: `https://picsum.photos/seed/${seed}/1600/2000`,
  alt: seed,
});

const baseAssets: TemplateAsset[] = [
  {
    key: "palette",
    type: "object",
    label: "色彩系统",
    description: "背景、文本、强调色统一配置",
  },
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
];

const baseFields: TemplateInputField[] = [
  {
    key: "palette",
    type: "object",
    label: "色彩系统",
    description: "统一控制背景、面板、文字、主强调色、辅助强调色和发光色。",
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
];

const defineTemplate = <Props extends Record<string, unknown>>(
  template: RegisteredTemplate<Props>,
): RegisteredTemplate<Props> => {
  return {
    ...template,
    assets: [...template.assets, ...baseAssets],
    inputSchema: [...template.inputSchema, ...baseFields],
    editableFields: Array.from(
      new Set([
        ...template.editableFields,
        "width",
        "height",
        "fps",
        "durationInFrames",
      ]),
    ),
  };
};

const shortVideo = (seconds: number) => `${seconds}s`;

type RuntimeTemplateIntegrityCheck = {
  id: string;
  compositionId: string;
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      error?: { message: string };
    };
  };
  defaultInputProps: Record<string, unknown>;
  editableFields: string[];
  assets: TemplateAsset[];
  example: TemplateExample;
};

const assertTemplateCatalogIntegrity = <
  T extends RuntimeTemplateIntegrityCheck[],
>(
  templates: T,
): T => {
  const idSet = new Set<string>();
  const compositionIdSet = new Set<string>();

  for (const template of templates) {
    if (!template.id.trim()) {
      throw new Error("Template id 不能为空");
    }

    if (idSet.has(template.id)) {
      throw new Error(`检测到重复模板 id: ${template.id}`);
    }
    idSet.add(template.id);

    if (compositionIdSet.has(template.compositionId)) {
      throw new Error(`检测到重复 compositionId: ${template.compositionId}`);
    }
    compositionIdSet.add(template.compositionId);

    const schemaResult = template.schema.safeParse(template.defaultInputProps);
    if (!schemaResult.success) {
      const errorMessage = schemaResult.error?.message ?? "未知 schema 错误";
      throw new Error(
        `模板 ${template.id} 的 defaultInputProps 未通过 schema 校验: ${errorMessage}`,
      );
    }

    const missingEditableFields = template.editableFields.filter(
      (field) => !(field in template.defaultInputProps),
    );
    if (missingEditableFields.length > 0) {
      throw new Error(
        `模板 ${template.id} 缺少 editableFields 对应默认值: ${missingEditableFields.join(", ")}`,
      );
    }

    const assetKeySet = new Set<string>();
    for (const asset of template.assets) {
      if (assetKeySet.has(asset.key)) {
        throw new Error(`模板 ${template.id} 存在重复 asset key: ${asset.key}`);
      }
      assetKeySet.add(asset.key);
    }

    if (!template.example.title.trim()) {
      throw new Error(`模板 ${template.id} 的 example.title 不能为空`);
    }
    if (template.example.copy.length === 0) {
      throw new Error(`模板 ${template.id} 的 example.copy 至少需要 1 条文案`);
    }
    if (template.example.media.length === 0) {
      throw new Error(
        `模板 ${template.id} 的 example.media 至少需要 1 个媒体示例`,
      );
    }
  }

  return templates;
};

export const templateCatalog = assertTemplateCatalogIntegrity([
  // ========== 通用模板：图片渐变过渡 ==========
  defineTemplate({
    id: "gradient-image-transition",
    compositionId: "GradientImageTransition",
    name: "图片渐变过渡视频",
    description:
      "根据一组任意数量的图片自动生成普通、干净的渐变过渡视频，适合相册、商品图、案例图轮播。",
    category: "通用",
    style: "极简相册 / 渐变过渡 / 干净展示",
    useCase:
      "适合把多张位置图、商品图、效果图、案例图快速生成一支平滑过渡视频。",
    durationLabel: shortVideo(15),
    tags: ["图片", "相册", "渐变", "过渡", "轮播", "通用"],
    scenes: [
      {
        title: "Scene 1",
        summary: "按图片数量自动分配镜头时长，第一张图淡入开场。",
      },
      {
        title: "Scene 2",
        summary: "每张图片使用轻微缩放和位移，避免静态图过于生硬。",
      },
      {
        title: "Scene 3",
        summary: "图片之间用渐变淡入淡出衔接，底部显示标题、说明和进度。",
      },
    ],
    animationHighlights: [
      "图片数量自适应，2 张到 20 张都可以直接生成。",
      "每张图有轻微 Ken Burns 缩放位移，画面更自然。",
      "过渡帧数可配置，支持更快或更柔和的淡入淡出。",
    ],
    component: GradientImageTransitionTemplate,
    schema: gradientImageTransitionSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 450,
    defaultInputProps: {
      palette: palettes.pearlSkin,
      title: "Image Flow",
      subtitle: "一组图片自动生成平滑渐变过渡视频",
      images: [
        {
          image: seedImage("gradient-gallery-01"),
          caption: "Image 01",
          durationSeconds: 3,
        },
        {
          image: seedImage("gradient-gallery-02"),
          caption: "Image 02",
          durationSeconds: 3,
        },
        {
          image: seedImage("gradient-gallery-03"),
          caption: "Image 03",
          durationSeconds: 4,
        },
        {
          image: seedImage("gradient-gallery-04"),
          caption: "Image 04",
          durationSeconds: 3,
        },
        {
          image: seedImage("gradient-gallery-05"),
          caption: "Image 05",
          durationSeconds: 5,
        },
      ],
      showCaptions: true,
      transitionFrames: 24,
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 450,
    },
    editableFields: [
      "palette",
      "title",
      "subtitle",
      "images",
      "showCaptions",
      "transitionFrames",
    ],
    assetSummary:
      "1组图片数组 + 标题说明 + 每张图片显示秒数 + 可配置过渡帧数，总时长自动计算。",
    assets: [
      {
        key: "images",
        type: "array",
        label: "图片列表",
        description: "支持多张图片，每项包含 image 和可选 caption。",
      },
      { key: "title", type: "text", label: "标题" },
      { key: "subtitle", type: "text", label: "副标题" },
      { key: "showCaptions", type: "boolean", label: "显示图片说明" },
      { key: "transitionFrames", type: "number", label: "过渡帧数" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "标题",
        description: "显示在视频底部的主标题。",
        required: true,
        example: "Image Flow",
      },
      {
        key: "subtitle",
        type: "text",
        label: "副标题",
        description: "没有图片说明时显示的底部描述。",
        example: "一组图片自动生成平滑渐变过渡视频",
      },
      {
        key: "images",
        type: "array",
        label: "图片列表",
        description:
          "图片数组，按顺序播放。每项格式为 { image: { type: 'image', src: '图片地址' }, caption: '说明', durationSeconds: 3 }。",
        required: true,
        rows: 10,
        placeholder:
          "直接替换 image.src，按需修改 durationSeconds 控制这一张图出现的秒数。",
        helperText:
          "每一项是一张图片：image.src 是图片地址，caption 是说明，durationSeconds 是这张图显示秒数；总时长会自动相加。",
        example: [
          {
            image: seedImage("gradient-gallery-01"),
            caption: "Image 01",
            durationSeconds: 3,
          },
          {
            image: seedImage("gradient-gallery-02"),
            caption: "Image 02",
            durationSeconds: 3,
          },
          {
            image: seedImage("gradient-gallery-03"),
            caption: "Image 03",
            durationSeconds: 4,
          },
        ],
      },
      {
        key: "showCaptions",
        type: "boolean",
        label: "显示图片说明",
        description: "开启后底部副标题区域显示当前图片 caption。",
        example: true,
      },
      {
        key: "transitionFrames",
        type: "number",
        label: "过渡帧数",
        description: "控制图片之间淡入淡出的柔和程度，建议 16-30。",
        example: 24,
      },
    ],
    example: {
      title: "多图渐变过渡视频",
      copy: [
        "Image Flow",
        "一组图片自动生成平滑渐变过渡视频",
        "2-20 张图片自适应播放",
      ],
      media: [
        seedImage("gradient-gallery-01").src,
        seedImage("gradient-gallery-02").src,
        seedImage("gradient-gallery-03").src,
      ],
    },
  }),

  // ========== 通用模板：纯文字淡入淡出 ==========
  defineTemplate({
    id: "simple-fade-text",
    compositionId: "SimpleFadeText",
    name: "纯文字淡入淡出",
    description:
      "纯文字淡入淡出渐变模板，标题 + 多行文字依次显示，底部进度指示。",
    category: "通用",
    style: "极简 / 文字驱动 / 渐变背景",
    useCase: "适合产品卖点罗列、要点提示、价值观展示、企业文化宣传。",
    durationLabel: shortVideo(15),
    tags: ["通用", "文字", "淡入淡出", "极简", "卖点"],
    scenes: [
      { title: "Scene 1", summary: "标题和副标题居中显示，建立整体氛围。" },
      { title: "Scene 2", summary: "多行文字依次淡入淡出，每行独立时间窗口。" },
      { title: "Scene 3", summary: "底部进度指示点提示当前进度。" },
    ],
    animationHighlights: [
      "文字自动按行分配时间，均匀覆盖整个视频时长。",
      "每行文字淡入淡出配合微位移，观感自然。",
      "底部指示点随当前行伸缩。",
    ],
    component: SimpleFadeTextTemplate,
    schema: simpleFadeTextSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 450,
    defaultInputProps: {
      palette: palettes.midnightTech,
      title: "我们的产品",
      subtitle: "用简单的文字传递核心信息",
      lines: [
        "快速启动，零等待体验",
        "智能匹配你的需求",
        "数据安全，全程加密",
        "随时扩展，随需而变",
      ],
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 450,
    },
    editableFields: ["palette", "title", "subtitle", "lines"],
    assetSummary: "标题 + 副标题 + 4行卖点文字，适合快速制作文字类短视频。",
    assets: [
      { key: "title", type: "text", label: "主标题" },
      { key: "subtitle", type: "text", label: "副标题" },
      { key: "lines", type: "array", label: "轮播文字" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "主标题",
        description: "页面顶部大标题。",
        required: true,
        example: "我们的产品",
      },
      {
        key: "subtitle",
        type: "text",
        label: "副标题",
        description: "标题下方补充说明。",
        example: "用简单的文字传递核心信息",
      },
      {
        key: "lines",
        type: "array",
        label: "轮播文字",
        description: "逐条显示的文字，建议 3-6 条。",
        example: ["快速启动，零等待体验", "智能匹配你的需求"],
      },
    ],
    example: {
      title: "产品卖点文字展示",
      copy: ["我们的产品", "快速启动 / 智能匹配 / 数据安全 / 随时扩展"],
      media: [seedImage("simple-fade-text-demo").src],
    },
  }),

  // ========== 通用模板：上滑卡片 ==========
  defineTemplate({
    id: "slide-up-cards",
    compositionId: "SlideUpCards",
    name: "上滑卡片",
    description: "简单上滑卡片渐变模板，卡片依次从下方滑入，适合要点列表。",
    category: "通用",
    style: "卡片列表 / 上滑动画 / 渐变背景",
    useCase: "适合功能介绍、步骤说明、服务项列表、优势对比。",
    durationLabel: shortVideo(12),
    tags: ["通用", "卡片", "上滑", "列表", "功能介绍"],
    scenes: [
      { title: "Scene 1", summary: "顶部标题定调，卡片区域留空等待。" },
      { title: "Scene 2", summary: "卡片依次从下方滑入，每条独立时间窗口。" },
      { title: "Scene 3", summary: "卡片展示完毕后停留，等待淡出。" },
    ],
    animationHighlights: [
      "卡片依次上滑入场，节奏清晰。",
      "毛玻璃卡片质感，配合渐变背景。",
      "每条卡片独立淡入淡出。",
    ],
    component: SlideUpCardsTemplate,
    schema: slideUpCardsSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 360,
    defaultInputProps: {
      palette: palettes.pearlSkin,
      title: "核心功能",
      cards: [
        { label: "功能一", text: "智能分析，自动生成报告，节省你的时间。" },
        { label: "功能二", text: "多平台数据整合，一目了然。" },
        { label: "功能三", text: "实时同步，团队协作更高效。" },
        { label: "功能四", text: "灵活的权限管理，保障数据安全。" },
      ],
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 360,
    },
    editableFields: ["palette", "title", "cards"],
    assetSummary: "标题 + 4张卡片（每张含标签和描述文字）。",
    assets: [
      { key: "title", type: "text", label: "主标题" },
      { key: "cards", type: "array", label: "卡片列表" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "主标题",
        description: "顶部大标题。",
        required: true,
        example: "核心功能",
      },
      {
        key: "cards",
        type: "array",
        label: "卡片列表",
        description: "每张卡片含 label（标签）和 text（描述）。",
        required: true,
        example: [{ label: "功能一", text: "智能分析，自动生成报告。" }],
      },
    ],
    example: {
      title: "功能列表卡片",
      copy: ["核心功能", "智能分析 / 多平台数据整合 / 实时同步"],
      media: [seedImage("slide-up-cards-demo").src],
    },
  }),

  // ========== 通用模板：进度步骤 ==========
  defineTemplate({
    id: "progress-steps",
    compositionId: "ProgressSteps",
    name: "进度步骤",
    description:
      "进度步骤式渐变模板，带顶部进度条和编号圆，适合流程/步骤展示。",
    category: "通用",
    style: "步骤流程 / 编号圆 / 进度条",
    useCase: "适合使用教程、操作流程、入职指引、项目里程碑展示。",
    durationLabel: shortVideo(14),
    tags: ["通用", "步骤", "流程", "进度条", "教程"],
    scenes: [
      { title: "Scene 1", summary: "标题和顶部进度条先出现。" },
      { title: "Scene 2", summary: "步骤依次出现，编号圆高亮当前步骤。" },
      { title: "Scene 3", summary: "进度条随步骤推进逐渐填充。" },
    ],
    animationHighlights: [
      "顶部进度条实时填充，直观展示进度。",
      "编号圆高亮当前步骤，未到的步骤灰化。",
      "步骤文字依次滑入。",
    ],
    component: ProgressStepsTemplate,
    schema: progressStepsSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 420,
    defaultInputProps: {
      palette: palettes.eduCyan,
      title: "使用流程",
      steps: [
        { label: "注册账号", description: "使用手机号或邮箱快速注册。" },
        {
          label: "完善资料",
          description: "填写基本信息，定制你的个性化体验。",
        },
        { label: "开始使用", description: "选择感兴趣的功能，马上开始。" },
        { label: "邀请好友", description: "分享给朋友，一起享受高效工具。" },
      ],
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 420,
    },
    editableFields: ["palette", "title", "steps"],
    assetSummary: "标题 + 进度条 + 4个步骤（含标签和描述）。",
    assets: [
      { key: "title", type: "text", label: "主标题" },
      { key: "steps", type: "array", label: "步骤列表" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "主标题",
        description: "顶部大标题。",
        required: true,
        example: "使用流程",
      },
      {
        key: "steps",
        type: "array",
        label: "步骤列表",
        description: "每个步骤含 label（名称）和 description（描述）。",
        required: true,
        example: [{ label: "注册账号", description: "使用手机号快速注册。" }],
      },
    ],
    example: {
      title: "操作流程步骤",
      copy: ["使用流程", "注册账号 / 完善资料 / 开始使用 / 邀请好友"],
      media: [seedImage("progress-steps-demo").src],
    },
  }),

  // ========== 通用模板：图片轮播展示 ==========
  defineTemplate({
    id: "image-showcase",
    compositionId: "ImageShowcase",
    name: "图片轮播展示",
    description:
      "图片轮播展示渐变模板，每张图片完整展示 + 底部说明 + 进度指示。",
    category: "通用",
    style: "图片轮播 / 渐变覆盖 / 简洁展示",
    useCase: "适合产品展示、案例展示、作品集、前后效果对比。",
    durationLabel: shortVideo(12),
    tags: ["通用", "图片", "轮播", "展示", "案例"],
    scenes: [
      { title: "Scene 1", summary: "标题和副标题建立整体氛围。" },
      { title: "Scene 2", summary: "图片依次展示，配合轻微缩放动画。" },
      { title: "Scene 3", summary: "底部显示当前图片说明和进度指示点。" },
    ],
    animationHighlights: [
      "图片使用轻微缩放动画，避免静态感。",
      "渐变覆盖层保证文字可读性。",
      "底部进度指示点随当前图片伸缩。",
    ],
    component: ImageShowcaseTemplate,
    schema: imageShowcaseSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 360,
    defaultInputProps: {
      palette: palettes.brandIvory,
      title: "案例展示",
      subtitle: "看看我们的优秀案例",
      images: [
        { image: seedImage("showcase-01"), caption: "品牌视觉升级项目" },
        { image: seedImage("showcase-02"), caption: "电商平台改版设计" },
        { image: seedImage("showcase-03"), caption: "移动端 App 界面" },
      ],
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 360,
    },
    editableFields: ["palette", "title", "subtitle", "images"],
    assetSummary: "标题 + 副标题 + 3张图片（每张含说明）。",
    assets: [
      { key: "title", type: "text", label: "主标题" },
      { key: "subtitle", type: "text", label: "副标题" },
      { key: "images", type: "array", label: "图片列表" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "主标题",
        description: "顶部大标题。",
        required: true,
        example: "案例展示",
      },
      {
        key: "subtitle",
        type: "text",
        label: "副标题",
        description: "标题下方补充说明。",
        example: "看看我们的优秀案例",
      },
      {
        key: "images",
        type: "array",
        label: "图片列表",
        description: "图片数组，每项包含 image 和 caption。",
        required: true,
        rows: 6,
        example: [
          { image: seedImage("showcase-01"), caption: "品牌视觉升级项目" },
        ],
      },
    ],
    example: {
      title: "案例图片轮播",
      copy: ["案例展示", "品牌视觉升级 / 电商平台改版 / 移动端 App"],
      media: [seedImage("showcase-01").src, seedImage("showcase-02").src],
    },
  }),

  // ========== 通用模板：金句揭示 ==========
  defineTemplate({
    id: "quote-reveal",
    compositionId: "QuoteReveal",
    name: "金句揭示",
    description:
      "金句揭示渐变模板，大引号装饰 + 金句渐显 + 关键词高亮 + 作者署名。",
    category: "通用",
    style: "金句海报 / 关键词高亮 / 装饰线",
    useCase: "适合品牌 slogan、用户评价、名人名言、创始人寄语。",
    durationLabel: shortVideo(10),
    tags: ["通用", "金句", "评价", "slogan", "品牌"],
    scenes: [
      { title: "Scene 1", summary: "大引号和装饰线先入场，建立氛围。" },
      { title: "Scene 2", summary: "金句文字从下方渐显，关键词用强调色高亮。" },
      { title: "Scene 3", summary: "底部作者署名延迟出现，完成收尾。" },
    ],
    animationHighlights: [
      "大引号作为视觉符号强化金句感。",
      "装饰线缩放展开，增加仪式感。",
      "关键词可配置高亮，突出重点。",
    ],
    component: QuoteRevealTemplate,
    schema: quoteRevealSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    defaultInputProps: {
      palette: palettes.noirGold,
      quote: "好的设计不是做加法，而是做减法。",
      author: "Steve Jobs",
      role: "Apple 创始人",
      highlightWords: ["设计", "做减法"],
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 300,
    },
    editableFields: ["palette", "quote", "author", "role", "highlightWords"],
    assetSummary: "金句 + 作者 + 角色 + 可选关键词高亮。",
    assets: [
      { key: "quote", type: "text", label: "金句内容" },
      { key: "author", type: "text", label: "作者" },
      { key: "role", type: "text", label: "角色/职位" },
      { key: "highlightWords", type: "array", label: "高亮关键词" },
    ],
    inputSchema: [
      {
        key: "quote",
        type: "text",
        label: "金句内容",
        description: "要展示的核心金句。",
        required: true,
        example: "好的设计不是做加法，而是做减法。",
      },
      {
        key: "author",
        type: "text",
        label: "作者",
        description: "金句作者姓名。",
        required: true,
        example: "Steve Jobs",
      },
      {
        key: "role",
        type: "text",
        label: "角色/职位",
        description: "作者的身份或职位，可选。",
        example: "Apple 创始人",
      },
      {
        key: "highlightWords",
        type: "array",
        label: "高亮关键词",
        description: "需要在金句中高亮显示的关键词，按顺序匹配。",
        example: ["设计", "做减法"],
      },
    ],
    example: {
      title: "品牌金句",
      copy: ["好的设计不是做加法，而是做减法。", "Steve Jobs / Apple 创始人"],
      media: [seedImage("quote-reveal-demo").src],
    },
  }),

  // ========== 通用模板：知识卡片 ==========
  defineTemplate({
    id: "knowledge-cards",
    compositionId: "KnowledgeCards",
    name: "知识卡片",
    description:
      "知识卡片模板，主题 + 收益承诺 + 媒体 + 章节卡 + 事实卡 + 行动清单，适合知识型短视频。",
    category: "通用",
    style: "知识拆解 / 卡片轮播 / 行动清单",
    useCase: "适合教程、框架解读、行业知识、方法论拆解等内容。",
    durationLabel: shortVideo(18),
    tags: ["通用", "知识", "卡片", "教程", "方法论"],
    scenes: [
      { title: "Scene 1", summary: "主题和收益承诺开场，建立学习预期。" },
      { title: "Scene 2", summary: "章节卡逐条拆解核心知识点。" },
      { title: "Scene 3", summary: "事实卡和行动清单给出可执行步骤。" },
    ],
    animationHighlights: [
      "章节卡逐步切换，节奏清晰。",
      "事实卡和 checklist 组合，从认知走向行动。",
      "媒体区适合放图示、案例图或录屏。",
    ],
    component: KnowledgeCardsTemplate,
    schema: knowledgeCardsSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 540,
    defaultInputProps: {
      palette: palettes.eduCyan,
      topic: "如何用结构化思维提升内容质量？",
      promise:
        "这套框架帮你把复杂知识拆成用户能直接用的行动步骤。",
      media: seedImage("knowledge-cards-01"),
      chapters: [
        {
          eyebrow: "Step 01",
          title: "明确核心问题",
          text: "先把主题聚焦到一个具体可解决的问题上。",
        },
        {
          eyebrow: "Step 02",
          title: "拆解关键要素",
          text: "把复杂内容拆成 3-5 个认知块，逐一讲透。",
        },
        {
          eyebrow: "Step 03",
          title: "给出行动清单",
          text: "让用户带着明确步骤离开，而不只是觉得有道理。",
        },
      ],
      facts: [
        { label: "Retention", value: "+31%", detail: "分段信息更容易看完" },
        { label: "Save Rate", value: "2.4x", detail: "checklist 提升收藏意愿" },
        { label: "Clarity", value: "High", detail: "复杂内容更易理解" },
      ],
      checklist: [
        "先写主题承诺",
        "拆出 3-5 个章节",
        "把每章压成一个动作",
        "最后给 checklist",
      ],
      cta: "Save This Framework",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 540,
    },
    editableFields: [
      "palette",
      "topic",
      "promise",
      "media",
      "chapters",
      "facts",
      "checklist",
      "cta",
    ],
    assetSummary: "1个知识主图 + 3个章节卡 + 3张事实卡 + 1组行动清单。",
    assets: [
      { key: "topic", type: "text", label: "主题标题" },
      { key: "promise", type: "text", label: "收益承诺" },
      { key: "media", type: "media", label: "辅助媒体" },
      { key: "chapters", type: "array", label: "章节卡" },
      { key: "facts", type: "array", label: "事实卡" },
      { key: "checklist", type: "array", label: "行动清单" },
      { key: "cta", type: "text", label: "CTA" },
    ],
    inputSchema: [
      {
        key: "topic",
        type: "text",
        label: "主题标题",
        description: "知识主问题。",
        required: true,
        example: "如何用结构化思维提升内容质量？",
      },
      {
        key: "promise",
        type: "text",
        label: "收益承诺",
        description: "说明用户能得到什么。",
        example: "这套框架帮你把复杂知识拆成行动步骤。",
      },
      {
        key: "media",
        type: "object",
        label: "辅助媒体",
        description: "图示、录屏、案例图均可。",
        example: seedImage("knowledge-cards-01"),
      },
      {
        key: "chapters",
        type: "array",
        label: "章节卡",
        description: "3-5 个章节块。",
        example: [
          { eyebrow: "Step 01", title: "明确核心问题", text: "聚焦具体问题。" },
        ],
      },
      {
        key: "facts",
        type: "array",
        label: "事实卡",
        description: "可放数据、结论、提示。",
        example: [
          { label: "Retention", value: "+31%", detail: "分段信息更容易看完" },
        ],
      },
      {
        key: "checklist",
        type: "array",
        label: "行动清单",
        description: "用户可直接照做的步骤。",
        example: ["先写主题承诺", "拆出 3-5 个章节"],
      },
      {
        key: "cta",
        type: "text",
        label: "CTA",
        description: "适合收藏、转发、下一条。",
        example: "Save This Framework",
      },
    ],
    example: {
      title: "知识结构拆解视频",
      copy: [
        "如何用结构化思维提升内容质量？",
        "Retention +31% / Save Rate 2.4x",
        "Save This Framework",
      ],
      media: [seedImage("knowledge-cards-01").src],
    },
  }),

  // ========== 通用模板：数据洞察 ==========
  defineTemplate({
    id: "data-insight",
    compositionId: "DataInsight",
    name: "数据洞察",
    description:
      "数据洞察模板，eyebrow + headline + 摘要 + 媒体 + 指标卡 + 趋势柱 + 洞察，适合经营数据视频。",
    category: "通用",
    style: "数据看板 / 趋势柱 / 经营洞察",
    useCase: "适合经营复盘、数据报告、增长分析、季度总结。",
    durationLabel: shortVideo(30),
    tags: ["通用", "数据", "洞察", "经营", "分析"],
    scenes: [
      { title: "Scene 1", summary: "标签和标题先讲最重要的结论。" },
      { title: "Scene 2", summary: "核心指标卡展示关键数据。" },
      { title: "Scene 3", summary: "趋势柱和洞察文字解释增长来源。" },
    ],
    animationHighlights: [
      "柱状图和指标卡组合成经营 dashboard。",
      "洞察区解释驱动因素，不只是展示数字。",
      "适合横屏报告，也可改成竖屏知识总结。",
    ],
    component: DataInsightTemplate,
    schema: dataInsightSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 600,
    defaultInputProps: {
      palette: palettes.midnightTech,
      eyebrow: "Q3 Performance",
      headline: "增长不只看数字，更要看结构是否更健康。",
      summary:
        "用数据洞察模板快速解释本季度最重要的经营变化和增长来源。",
      media: seedImage("data-insight-01"),
      metrics: [
        { label: "Revenue", value: "¥15.2M", detail: "季度营收同比增长 28%" },
        { label: "Repeat Rate", value: "44%", detail: "老客复购持续提升" },
        { label: "AOV", value: "¥358", detail: "客单价稳步上升" },
      ],
      bars: [
        { label: "JAN", value: 42 },
        { label: "FEB", value: 55 },
        { label: "MAR", value: 68 },
        { label: "APR", value: 74 },
        { label: "MAY", value: 82 },
      ],
      insights: [
        "客单价提升来自新品结构优化",
        "复购增长由老客运营驱动",
        "内容渠道贡献了更高质量的流量",
      ],
      cta: "Open Full Report",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 600,
    },
    editableFields: [
      "palette",
      "eyebrow",
      "headline",
      "summary",
      "media",
      "metrics",
      "bars",
      "insights",
      "cta",
    ],
    assetSummary: "1个报告主视觉 + 3张指标卡 + 5根趋势柱 + 3条洞察。",
    assets: [
      { key: "eyebrow", type: "text", label: "报告标签" },
      { key: "headline", type: "text", label: "主标题" },
      { key: "summary", type: "text", label: "摘要" },
      { key: "media", type: "media", label: "辅助媒体" },
      { key: "metrics", type: "array", label: "核心指标" },
      { key: "bars", type: "array", label: "趋势柱形图" },
      { key: "insights", type: "array", label: "经营洞察" },
      { key: "cta", type: "text", label: "CTA" },
    ],
    inputSchema: [
      {
        key: "eyebrow",
        type: "text",
        label: "报告标签",
        description: "如季度、月报、经营快讯。",
        example: "Q3 Performance",
      },
      {
        key: "headline",
        type: "text",
        label: "主标题",
        description: "本期最重要的经营结论。",
        required: true,
        example: "增长不只看数字，更要看结构是否更健康。",
      },
      {
        key: "summary",
        type: "text",
        label: "摘要",
        description: "补充本期重点。",
        example: "用数据洞察模板快速解释经营变化。",
      },
      {
        key: "media",
        type: "object",
        label: "辅助媒体",
        description: "品牌场景、门店、产品拼贴等。",
        example: seedImage("data-insight-01"),
      },
      {
        key: "metrics",
        type: "array",
        label: "核心指标",
        description: "3-6 张指标卡。",
        example: [
          { label: "Revenue", value: "¥15.2M", detail: "同比增长 28%" },
        ],
      },
      {
        key: "bars",
        type: "array",
        label: "趋势柱形图",
        description: "4-8 组趋势数据。",
        example: [{ label: "JAN", value: 42 }],
      },
      {
        key: "insights",
        type: "array",
        label: "经营洞察",
        description: "3-6 条关键解释。",
        example: ["客单价提升来自新品结构优化"],
      },
      {
        key: "cta",
        type: "text",
        label: "CTA",
        description: "结尾引导。",
        example: "Open Full Report",
      },
    ],
    example: {
      title: "季度经营复盘视频",
      copy: [
        "增长不只看数字，更要看结构是否更健康。",
        "Revenue ¥15.2M / Repeat Rate 44% / AOV ¥358",
        "Open Full Report",
      ],
      media: [seedImage("data-insight-01").src],
    },
  }),

  // ========== 通用模板：电影感故事 ==========
  defineTemplate({
    id: "cinematic-story",
    compositionId: "CinematicStory",
    name: "电影感故事",
    description:
      "电影感叙事模板，标题 + 旁白署名 + 多章节（眉题/标题/正文/字幕/媒体）+ 结尾，适合故事型长视频。",
    category: "通用",
    style: "电影叙事 / 章节切换 / 深色电影感",
    useCase: "适合品牌故事、创始人叙事、回忆录、纪录片风格内容。",
    durationLabel: shortVideo(33),
    tags: ["通用", "故事", "电影感", "叙事", "纪录片"],
    scenes: [
      { title: "Scene 1", summary: "标题和旁白署名建立叙事基调。" },
      { title: "Scene 2", summary: "章节依次切换，每章独立媒体和文案。" },
      { title: "Scene 3", summary: "结尾收束，留下余味。" },
    ],
    animationHighlights: [
      "章节式叙事自动切换素材和字幕。",
      "字幕卡与大标题分层，兼顾阅读和气质。",
      "结尾保留纪录片式余味。",
    ],
    component: CinematicStoryTemplate,
    schema: cinematicStorySchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 990,
    defaultInputProps: {
      palette: palettes.storySlate,
      title: "给三年后自己的一封信",
      narrator: "Letter Film",
      chapters: [
        {
          eyebrow: "Chapter 01",
          title: "那时的你，总觉得一切都要更快。",
          body: "你以为迟到一步就会错过人生，可后来才知道，很多东西都是在慢下来之后才看得见。",
          caption: "有些成长，不是冲刺，是允许自己走稳。",
          media: seedImage("cinematic-story-01"),
        },
        {
          eyebrow: "Chapter 02",
          title: "真正改变你的，从来不是一次漂亮的赢。",
          body: "而是无数次没人看到的坚持。你开始学会和焦虑一起生活，也开始知道不必每次都赢。",
          caption: "被生活磨过之后，温柔反而更像力量。",
          media: seedImage("cinematic-story-02"),
        },
        {
          eyebrow: "Chapter 03",
          title: "后来你终于明白，路不会白走。",
          body: "那些以为浪费掉的时间，那些不被理解的阶段，最后都在某个晚上，慢慢拼回了你自己。",
          caption: "所有绕远的路，最后都变成了你看世界的方式。",
          media: seedImage("cinematic-story-03"),
        },
      ],
      ending: "愿你在下一个想放弃的夜晚，至少记得自己曾经也这样走过来。",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 990,
    },
    editableFields: ["palette", "title", "narrator", "chapters", "ending"],
    assetSummary:
      "3个章节媒体 + 每章标题/正文/字幕 + 1句结尾收束，适合 30 秒以上故事短片。",
    assets: [
      { key: "title", type: "text", label: "总标题" },
      { key: "narrator", type: "text", label: "旁白署名" },
      {
        key: "chapters",
        type: "array",
        label: "章节数组",
        description: "每章包含标题、正文、字幕和媒体。",
      },
      { key: "ending", type: "text", label: "结尾文案" },
    ],
    inputSchema: [
      {
        key: "title",
        type: "text",
        label: "总标题",
        description: "整支故事片标题。",
        required: true,
        example: "给三年后自己的一封信",
      },
      {
        key: "narrator",
        type: "text",
        label: "旁白署名",
        description: "顶部标签。",
        example: "Letter Film",
      },
      {
        key: "chapters",
        type: "array",
        label: "章节数组",
        description: "建议 3-5 章，每章包含 eyebrow/title/body/caption/media。",
        required: true,
        example: [
          {
            eyebrow: "Chapter 01",
            title: "那时的你，总觉得一切都要更快。",
            body: "正文",
            caption: "字幕",
            media: seedImage("cinematic-story-01"),
          },
        ],
      },
      {
        key: "ending",
        type: "text",
        label: "结尾文案",
        description: "用于片尾收束。",
        example: "愿你在下一个想放弃的夜晚，至少记得自己曾经也这样走过来。",
      },
    ],
    example: {
      title: "给自己的回忆录短片",
      copy: [
        "给三年后自己的一封信",
        "Chapter 01 / Chapter 02 / Chapter 03",
        "愿你在下一个想放弃的夜晚，至少记得自己曾经也这样走过来。",
      ],
      media: [
        seedImage("cinematic-story-01").src,
        seedImage("cinematic-story-02").src,
        seedImage("cinematic-story-03").src,
      ],
    },
  }),

  // ========== 通用模板：情绪动态 ==========
  defineTemplate({
    id: "mood-kinetic",
    compositionId: "MoodKinetic",
    name: "情绪动态",
    description:
      "动态情绪模板，情绪标签 + 标题 + 多行文案 + 媒体数组 + 收束 + CTA，适合情绪驱动型短视频。",
    category: "通用",
    style: "情绪推进 / 大字排版 / 背景渐隐",
    useCase: "适合情绪文案、治愈短片、励志口号、深夜电台。",
    durationLabel: shortVideo(15),
    tags: ["通用", "情绪", "动态", "文案", "治愈"],
    scenes: [
      { title: "Scene 1", summary: "情绪标签和主标题开场定调。" },
      { title: "Scene 2", summary: "多行文案依次推进，背景媒体切换。" },
      { title: "Scene 3", summary: "收束句和 CTA 完成情绪落点。" },
    ],
    animationHighlights: [
      "大字用压缩比例和位移制造推进感。",
      "旧句微模糊退后，新句占据前景。",
      "背景媒体随文案切换，增强氛围感。",
    ],
    component: MoodKineticTemplate,
    schema: moodKineticSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 450,
    defaultInputProps: {
      palette: palettes.firePulse,
      moodLabel: "Keep Going",
      title: "别把今天的犹豫，留给明天后悔。",
      lines: [
        "再试一次。",
        "再往前一步。",
        "把目标做成行动。",
        "把行动做成结果。",
      ],
      media: [
        seedImage("mood-kinetic-01"),
        seedImage("mood-kinetic-02"),
        seedImage("mood-kinetic-03"),
      ],
      closing: "真正拉开差距的，不是想法，是你还能不能继续往前。",
      cta: "Forward Only",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 450,
    },
    editableFields: [
      "palette",
      "moodLabel",
      "title",
      "lines",
      "media",
      "closing",
      "cta",
    ],
    assetSummary: "1个情绪标签 + 1个主标题 + 4句文案 + 3段背景媒体。",
    assets: [
      { key: "moodLabel", type: "text", label: "情绪标签" },
      { key: "title", type: "text", label: "主标题" },
      { key: "lines", type: "array", label: "情绪文案" },
      { key: "media", type: "array", label: "背景媒体" },
      { key: "closing", type: "text", label: "收束文案" },
      { key: "cta", type: "text", label: "CTA" },
    ],
    inputSchema: [
      {
        key: "moodLabel",
        type: "text",
        label: "情绪标签",
        description: "用于开场情绪定调。",
        example: "Keep Going",
      },
      {
        key: "title",
        type: "text",
        label: "主标题",
        description: "情绪中心句。",
        required: true,
        example: "别把今天的犹豫，留给明天后悔。",
      },
      {
        key: "lines",
        type: "array",
        label: "情绪文案",
        description: "建议 3-6 句，逐条推进。",
        example: ["再试一次。", "再往前一步。"],
      },
      {
        key: "media",
        type: "array",
        label: "背景媒体",
        description: "氛围素材，建议 1-3 张。",
        example: [seedImage("mood-kinetic-01")],
      },
      {
        key: "closing",
        type: "text",
        label: "收束文案",
        description: "最终情绪落点。",
        example: "真正拉开差距的，是你还能不能继续往前。",
      },
      {
        key: "cta",
        type: "text",
        label: "CTA",
        description: "结尾互动指令。",
        example: "Forward Only",
      },
    ],
    example: {
      title: "励志情绪短片",
      copy: [
        "别把今天的犹豫，留给明天后悔。",
        "再试一次 / 再往前一步 / 把目标做成行动",
        "Forward Only",
      ],
      media: [
        seedImage("mood-kinetic-01").src,
        seedImage("mood-kinetic-02").src,
      ],
    },
  }),

  // ========== 通用模板：编辑蒙太奇 ==========
  defineTemplate({
    id: "editorial-montage",
    compositionId: "EditorialMontage",
    name: "编辑蒙太奇",
    description:
      "编辑蒙太奇模板，eyebrow + headline + 摘要 + 多面板（眉题/标题/文字/媒体）+ 风格标签 + CTA，适合品牌展示。",
    category: "通用",
    style: "杂志版式 / 多面板 / 编辑感",
    useCase: "适合产品展示、品牌 lookbook、时尚系列、生活方式内容。",
    durationLabel: shortVideo(16),
    tags: ["通用", "蒙太奇", "编辑", "品牌", "展示"],
    scenes: [
      { title: "Scene 1", summary: "标签和标题建立编辑调性。" },
      { title: "Scene 2", summary: "面板依次展示，每面板独立媒体和文案。" },
      { title: "Scene 3", summary: "风格标签和 CTA 完成品牌收束。" },
    ],
    animationHighlights: [
      "面板错位进场，更像杂志版式。",
      "主面板负责视觉冲击，侧面板补充细节。",
      "风格标签增强品牌记忆点。",
    ],
    component: EditorialMontageTemplate,
    schema: editorialMontageSchema,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 480,
    defaultInputProps: {
      palette: palettes.brandIvory,
      eyebrow: "Lookbook 01",
      headline: "City Style\nFor Every Day",
      summary:
        "把同一季新品拆成主视觉、细节、场景三层叙事，让品牌内容更有质感。",
      panels: [
        {
          eyebrow: "Hero Look",
          title: "主视觉定义风格方向",
          text: "用主面板承接系列核心造型，让用户一眼记住风格。",
          media: seedImage("editorial-montage-01"),
        },
        {
          eyebrow: "Detail",
          title: "细节呈现质感",
          text: "侧面板展示面料、五金或局部特写。",
          media: seedImage("editorial-montage-02"),
        },
        {
          eyebrow: "Moment",
          title: "场景赋予生活感",
          text: "用第三面板补充使用场景，让品牌更有温度。",
          media: seedImage("editorial-montage-03"),
        },
      ],
      chips: ["Urban Style", "Limited Season", "Daily Wear"],
      cta: "Shop The Collection",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 480,
    },
    editableFields: [
      "palette",
      "eyebrow",
      "headline",
      "summary",
      "panels",
      "chips",
      "cta",
    ],
    assetSummary: "3个蒙太奇面板 + 系列标题 + 3个风格标签。",
    assets: [
      { key: "eyebrow", type: "text", label: "系列标签" },
      { key: "headline", type: "text", label: "主标题" },
      { key: "summary", type: "text", label: "说明文案" },
      { key: "panels", type: "array", label: "展示面板" },
      { key: "chips", type: "array", label: "风格标签" },
      { key: "cta", type: "text", label: "CTA" },
    ],
    inputSchema: [
      {
        key: "eyebrow",
        type: "text",
        label: "系列标签",
        description: "Lookbook、Season、Collection 等。",
        example: "Lookbook 01",
      },
      {
        key: "headline",
        type: "text",
        label: "主标题",
        description: "系列主题标题。",
        required: true,
        example: "City Style For Every Day",
      },
      {
        key: "summary",
        type: "text",
        label: "说明文案",
        description: "用于概括系列内容。",
        example: "把同一季新品拆成三层叙事。",
      },
      {
        key: "panels",
        type: "array",
        label: "展示面板",
        description: "3-4 个面板，每个包含标题、说明、媒体。",
        required: true,
        example: [
          {
            eyebrow: "Hero Look",
            title: "主视觉定义风格方向",
            text: "说明",
            media: seedImage("editorial-montage-01"),
          },
        ],
      },
      {
        key: "chips",
        type: "array",
        label: "风格标签",
        description: "2-6 个关键词。",
        example: ["Urban Style", "Limited Season"],
      },
      {
        key: "cta",
        type: "text",
        label: "CTA",
        description: "结尾购买指令。",
        example: "Shop The Collection",
      },
    ],
    example: {
      title: "品牌系列 Lookbook",
      copy: [
        "City Style For Every Day",
        "Urban Style / Limited Season / Daily Wear",
        "Shop The Collection",
      ],
      media: [
        seedImage("editorial-montage-01").src,
        seedImage("editorial-montage-02").src,
        seedImage("editorial-montage-03").src,
      ],
    },
  }),
]);

export const publicTemplateCatalog = templateCatalog.map((template) => {
  const { component, schema, ...rest } = template;
  void component;
  void schema;
  return rest;
});
