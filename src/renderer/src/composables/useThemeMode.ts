import { computed, ref } from "vue";

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "yishe.client.theme.preference";
const AUTO_LIGHT_START_HOUR = 7;
const AUTO_DARK_START_HOUR = 19;

const themePreference = ref<ThemePreference>("auto");
const resolvedTheme = ref<ResolvedTheme>("light");

let initialized = false;
let autoRefreshTimer: number | null = null;

function loadStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "auto";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }

  return "auto";
}

function resolveThemeByTime(date = new Date()): ResolvedTheme {
  const hour = date.getHours();
  return hour >= AUTO_LIGHT_START_HOUR && hour < AUTO_DARK_START_HOUR
    ? "light"
    : "dark";
}

function getEffectiveTheme(
  preference: ThemePreference = themePreference.value,
): ResolvedTheme {
  return preference === "auto" ? resolveThemeByTime() : preference;
}

function applyThemeToDocument(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.body?.setAttribute("data-theme", theme);
}

function clearAutoRefreshTimer() {
  if (autoRefreshTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function getNextAutoSwitchTime(now = new Date()) {
  const next = new Date(now);

  if (now.getHours() < AUTO_LIGHT_START_HOUR) {
    next.setHours(AUTO_LIGHT_START_HOUR, 0, 0, 0);
    return next;
  }

  if (now.getHours() < AUTO_DARK_START_HOUR) {
    next.setHours(AUTO_DARK_START_HOUR, 0, 0, 0);
    return next;
  }

  next.setDate(next.getDate() + 1);
  next.setHours(AUTO_LIGHT_START_HOUR, 0, 0, 0);
  return next;
}

function scheduleAutoRefresh() {
  clearAutoRefreshTimer();

  if (typeof window === "undefined" || themePreference.value !== "auto") {
    return;
  }

  const now = new Date();
  const nextSwitchTime = getNextAutoSwitchTime(now);
  const delay = Math.max(
    60_000,
    nextSwitchTime.getTime() - now.getTime() + 1000,
  );

  autoRefreshTimer = window.setTimeout(() => {
    const nextTheme = getEffectiveTheme("auto");
    resolvedTheme.value = nextTheme;
    applyThemeToDocument(nextTheme);
    scheduleAutoRefresh();
  }, delay);
}

function persistThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
}

function setThemePreference(nextPreference: ThemePreference) {
  themePreference.value = nextPreference;
  persistThemePreference(nextPreference);
  resolvedTheme.value = getEffectiveTheme(nextPreference);
  applyThemeToDocument(resolvedTheme.value);
  scheduleAutoRefresh();
}

function initializeThemeMode() {
  if (initialized) {
    return;
  }

  initialized = true;
  themePreference.value = loadStoredThemePreference();
  resolvedTheme.value = getEffectiveTheme(themePreference.value);
  applyThemeToDocument(resolvedTheme.value);
  scheduleAutoRefresh();
}

initializeThemeMode();

const themePreferenceLabel = computed(() => {
  if (themePreference.value === "auto") {
    return "跟随时间";
  }

  return themePreference.value === "dark" ? "深色" : "浅色";
});

const resolvedThemeLabel = computed(() =>
  resolvedTheme.value === "dark" ? "深色模式" : "浅色模式",
);

const themeToggleIcon = computed(() => {
  if (themePreference.value === "auto") {
    return "mdi-theme-light-dark";
  }

  return resolvedTheme.value === "dark"
    ? "mdi-weather-night"
    : "mdi-white-balance-sunny";
});

const isAutoTheme = computed(() => themePreference.value === "auto");

export function useThemeMode() {
  return {
    themePreference,
    themePreferenceLabel,
    resolvedTheme,
    resolvedThemeLabel,
    themeToggleIcon,
    isAutoTheme,
    setThemePreference,
  };
}
