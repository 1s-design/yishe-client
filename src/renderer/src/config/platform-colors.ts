/**
 * 平台颜色配置
 * 每个平台对应一个主题色，用于 UI 中标识不同平台
 */

export interface PlatformColorTheme {
  /** 平台标识 */
  id: string;
  /** 平台显示名称 */
  label: string;
  /** 主色 - 用于背景、边框等 */
  primary: string;
  /** 浅色变体 - 用于浅色背景 */
  light: string;
  /** 文字颜色 */
  text: string;
}

export const PLATFORM_COLORS: Record<string, PlatformColorTheme> = {
  douyin: {
    id: "douyin",
    label: "抖音",
    primary: "#000000",
    light: "#f0f0f0",
    text: "#000000",
  },
  kuaishou: {
    id: "kuaishou",
    label: "快手",
    primary: "#FF6600",
    light: "#FFF3E6",
    text: "#FF6600",
  },
  doudian: {
    id: "doudian",
    label: "抖店",
    primary: "#FF2442",
    light: "#FFEBEE",
    text: "#FF2442",
  },
  kuaishou_shop: {
    id: "kuaishou_shop",
    label: "快手小店",
    primary: "#FF6600",
    light: "#FFF3E6",
    text: "#FF6600",
  },
  temu: {
    id: "temu",
    label: "Temu",
    primary: "#F5A623",
    light: "#FFF8E1",
    text: "#F5A623",
  },
  taobao: {
    id: "taobao",
    label: "淘宝",
    primary: "#FF6A00",
    light: "#FFF3E6",
    text: "#FF6A00",
  },
  pdd: {
    id: "pdd",
    label: "拼多多",
    primary: "#E02020",
    light: "#FFEBEE",
    text: "#E02020",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    primary: "#000000",
    light: "#f0f0f0",
    text: "#000000",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    primary: "#FF0000",
    light: "#FFEBEE",
    text: "#FF0000",
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    primary: "#FF2442",
    light: "#FFEBEE",
    text: "#FF2442",
  },
  weibo: {
    id: "weibo",
    label: "微博",
    primary: "#E6162D",
    light: "#FFEBEE",
    text: "#E6162D",
  },
  xianyu: {
    id: "xianyu",
    label: "闲鱼",
    primary: "#FFDD00",
    light: "#FFFDE6",
    text: "#CC9900",
  },
};

/** 默认平台颜色（未匹配到平台时使用） */
export const DEFAULT_PLATFORM_COLOR: PlatformColorTheme = {
  id: "unknown",
  label: "未知",
  primary: "#888888",
  light: "#f5f5f5",
  text: "#888888",
};

/**
 * 获取平台颜色主题
 */
export function getPlatformColor(platform: string): PlatformColorTheme {
  return PLATFORM_COLORS[platform] || DEFAULT_PLATFORM_COLOR;
}

/**
 * 获取平台显示名称
 */
export function getPlatformLabel(platform: string): string {
  return PLATFORM_COLORS[platform]?.label || platform;
}
