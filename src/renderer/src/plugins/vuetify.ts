type ThemeTokenValue = boolean | number | string;

export interface LegacyVuetifyThemePreset {
  themeName: string;
  dark: boolean;
  colors: Record<string, string>;
  componentDefaults: Record<string, Record<string, ThemeTokenValue>>;
}

// 当前客户端主界面已经收敛到 Element Plus。
// 这里保留一份兼容旧 Vuetify 视图的主题预设，方便未来有需要时再接回运行时，
// 但默认不再强制挂载 Vuetify，也不会要求项目安装额外依赖。
export const legacyVuetifyThemePreset: LegacyVuetifyThemePreset = {
  themeName: "yisheLight",
  dark: false,
  colors: {
    background: "#f2eee7",
    surface: "#fffdf9",
    primary: "#7d8d79",
    secondary: "#6b665f",
    accent: "#c48a6a",
    error: "#dc2626",
    info: "#64748b",
    success: "#4c7a52",
    warning: "#b7791f",
  },
  componentDefaults: {
    global: {
      density: "compact",
      ripple: false,
      style: "font-size: 12px; letter-spacing: 0.1px;",
    },
    VBtn: {
      height: 32,
      rounded: "sm",
      elevation: 0,
      class: "text-none font-weight-medium",
      style: "font-size: 12px; letter-spacing: 0.2px;",
    },
    VListItem: {
      minHeight: 40,
      ripple: false,
      style: "font-size: 12.5px;",
    },
    VChip: {
      density: "comfortable",
      rounded: "sm",
      elevation: 0,
      style: "font-size: 11px; letter-spacing: 0.2px;",
    },
    VCard: {
      elevation: 0,
      rounded: "md",
      variant: "flat",
    },
    VCardTitle: {
      style: "font-size: 14px; font-weight: 600; letter-spacing: 0.2px;",
    },
    VTextField: {
      density: "compact",
      rounded: "sm",
      variant: "outlined",
      style: "font-size: 12px;",
    },
    VSheet: {
      elevation: 0,
      rounded: "md",
    },
    VAppBar: {
      elevation: 0,
      flat: true,
    },
    VNavigationDrawer: {
      elevation: 0,
    },
  },
};

export default legacyVuetifyThemePreset;
