<template>
  <div class="login-page">
    <div class="login-page__ambient login-page__ambient--primary"></div>
    <div class="login-page__ambient login-page__ambient--accent"></div>

    <section class="login-stage">
      <div class="login-stage__intro">
        <div class="login-stage__brand">
          <span class="login-stage__brand-icon">
            <i class="mdi mdi-creation-outline"></i>
          </span>
          <div>
            <div class="login-stage__brand-title">衣设客户端</div>
            <div class="login-stage__brand-subtitle">Yishe Client Console</div>
          </div>
        </div>

        <div class="login-stage__hero">
          <div class="login-stage__eyebrow">Workspace Access</div>
          <h1 class="login-stage__title">进入更轻量的执行工作台</h1>
          <p class="login-stage__desc">
            参考图的核心不是复杂装饰，而是把注意力拉回到工作本身。这里保留登录、主题和运行环境切换，让客户端更像一个安静的入口页。
          </p>
        </div>

        <div class="login-highlights">
          <article
            v-for="item in loginHighlights"
            :key="item.title"
            class="login-highlight"
          >
            <span class="login-highlight__icon">
              <i :class="['mdi', item.icon]"></i>
            </span>
            <div>
              <div class="login-highlight__title">{{ item.title }}</div>
              <div class="login-highlight__desc">{{ item.description }}</div>
            </div>
          </article>
        </div>
      </div>

      <div class="login-panel">
        <div class="login-panel__topbar">
          <el-dropdown trigger="click" placement="bottom-end">
            <el-button text class="theme-switcher__button">
              <i :class="['mdi', themeToggleIcon]"></i>
              <span>{{ themePreferenceLabel }}</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="setThemePreference('auto')">
                  跟随时间
                </el-dropdown-item>
                <el-dropdown-item @click="setThemePreference('light')">
                  浅色模式
                </el-dropdown-item>
                <el-dropdown-item @click="setThemePreference('dark')">
                  深色模式
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <span class="login-panel__mode">{{ serviceModeLabel }}</span>
        </div>

        <div class="login-panel__header">
          <div class="login-panel__eyebrow">Sign In</div>
          <h2 class="login-panel__title">欢迎回来</h2>
          <p class="login-panel__desc">
            登录后即可继续使用任务执行链路、桌面桥接能力和运行状态面板。
          </p>
        </div>

        <el-form
          class="login-form"
          label-position="top"
          @submit.prevent="handleLogin"
          autocomplete="on"
        >
          <el-form-item
            label="账号"
            :error="accountHelp || undefined"
            class="custom-form-item"
          >
            <el-input
              v-model="form.account"
              size="large"
              clearable
              autocomplete="username"
              placeholder="请输入账号"
              class="login-input"
            />
          </el-form-item>

          <el-form-item
            label="密码"
            :error="passwordHelp || undefined"
            class="custom-form-item"
          >
            <el-input
              v-model="form.password"
              size="large"
              autocomplete="current-password"
              placeholder="请输入密码"
              show-password
              class="login-input"
            />
          </el-form-item>

          <div class="login-form__meta">
            <el-checkbox v-model="rememberMe" class="custom-checkbox">
              记住我
            </el-checkbox>
            <span class="login-form__tip">客户端已切换为轻量工作台布局</span>
          </div>

          <el-alert
            v-if="errorMessage"
            class="form-error-alert"
            type="error"
            :title="errorMessage"
            show-icon
          />

          <el-button
            class="button-submit"
            type="primary"
            size="large"
            :loading="loading"
            :disabled="!formValid"
            native-type="submit"
          >
            立即登录
          </el-button>

          <div class="service-panel">
            <div class="service-panel__head">
              <div>
                <div class="service-panel__title">运行环境</div>
                <div class="service-panel__desc">
                  切换服务模式时会同步更新 API 与 WebSocket 配置。
                </div>
              </div>
            </div>

            <el-radio-group
              v-model="serviceMode"
              @change="handleServiceModeChange"
              class="service-radio-group"
              :disabled="!isDevelopment"
            >
              <el-radio-button label="local">本地服务</el-radio-button>
              <el-radio-button label="remote">远程服务</el-radio-button>
            </el-radio-group>

            <div class="service-addresses">
              <div class="service-address">
                <span class="service-address__label">API</span>
                <span class="service-address__value">{{ currentApiBase }}</span>
              </div>
              <div class="service-address">
                <span class="service-address__label">WebSocket</span>
                <span class="service-address__value">{{
                  currentWsEndpoint
                }}</span>
              </div>
            </div>

            <div v-if="!isDevelopment" class="service-tip">
              生产环境固定使用远程服务
            </div>
          </div>
        </el-form>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { login } from "../api/auth";
import {
  getRemoteApiBase,
  getServiceMode,
  getWsEndpoint,
  setServiceMode,
  type ServiceMode,
} from "../config/api";
import { updateApiBaseUrl } from "../api/request";
import { useThemeMode } from "../composables/useThemeMode";
import { websocketClient } from "../services/websocketClient";

const emit = defineEmits<{
  (e: "login-success"): void;
}>();

const loading = ref(false);
const rememberMe = ref(false);
const errorMessage = ref("");
const serviceMode = ref<ServiceMode>(getServiceMode());
const isDevelopment = process.env.NODE_ENV === "development";
const { themePreferenceLabel, themeToggleIcon, setThemePreference } =
  useThemeMode();

const form = reactive({
  account: "",
  password: "",
});

const loginHighlights = [
  {
    icon: "mdi-connection",
    title: "持续在线",
    description: "保持客户端状态、网络位置和远程链路同步。",
  },
  {
    icon: "mdi-robot-outline",
    title: "桥接自动化",
    description: "承接浏览器自动化和本地执行能力，不把复杂操作堆到客户端。",
  },
  {
    icon: "mdi-monitor-dashboard",
    title: "简洁工作台",
    description: "保留核心入口、设置与状态视图，让日常使用更专注。",
  },
];

const formValid = computed(
  () => form.account.trim().length >= 3 && form.password.length >= 6,
);
const serviceModeLabel = computed(() =>
  serviceMode.value === "local" ? "本地服务模式" : "远程服务模式",
);
const currentApiBase = computed(() => getRemoteApiBase());
const currentWsEndpoint = computed(() => getWsEndpoint());

const handleServiceModeChange = async (mode: ServiceMode) => {
  if (!isDevelopment) {
    serviceMode.value = getServiceMode();
    return;
  }

  try {
    setServiceMode(mode);
    serviceMode.value = mode;
    updateApiBaseUrl(getRemoteApiBase());
    websocketClient.switchService(mode);

    console.log("服务配置已切换:", {
      mode,
      apiBase: getRemoteApiBase(),
      wsEndpoint: getWsEndpoint(),
    });
  } catch (error) {
    console.error("切换服务配置失败:", error);
    serviceMode.value = getServiceMode();
  }
};

onMounted(() => {
  updateApiBaseUrl(getRemoteApiBase());
});

const accountHelp = computed(() => {
  if (!form.account) return "";
  return form.account.trim().length >= 3 ? "" : "账号长度至少 3 位";
});

const passwordHelp = computed(() => {
  if (!form.password) return "";
  return form.password.length >= 6 ? "" : "密码长度至少 6 位";
});

const handleLogin = async () => {
  if (!formValid.value) return;

  loading.value = true;
  errorMessage.value = "";

  try {
    await login({
      username: form.account,
      password: form.password,
    });

    emit("login-success");
  } catch (error: any) {
    console.error("登录失败:", error);
    errorMessage.value =
      error?.response?.data?.message ||
      error?.message ||
      "登录失败，请检查账号密码";
    loading.value = false;
  }
};
</script>

<style scoped>
.login-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  padding: 28px;
}

.login-page__ambient {
  position: absolute;
  border-radius: 999px;
  filter: blur(36px);
  opacity: 0.72;
  pointer-events: none;
}

.login-page__ambient--primary {
  top: 8%;
  left: 10%;
  width: 320px;
  height: 320px;
  background: color-mix(in srgb, var(--theme-primary) 20%, transparent);
}

.login-page__ambient--accent {
  right: 8%;
  bottom: 10%;
  width: 260px;
  height: 260px;
  background: color-mix(in srgb, var(--theme-accent) 18%, transparent);
}

.login-stage {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(360px, 1.06fr) minmax(360px, 0.94fr);
  gap: 22px;
  width: min(1180px, 100%);
  padding: 22px;
  border-radius: 32px;
  border: 1px solid var(--theme-border);
  background: color-mix(
    in srgb,
    var(--theme-surface-elevated) 94%,
    transparent
  );
  box-shadow: var(--theme-shadow-md);
  backdrop-filter: blur(18px);
}

.login-stage__intro,
.login-panel {
  border-radius: 26px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface);
}

.login-stage__intro {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 26px;
  padding: 28px;
  background:
    radial-gradient(
      circle at top left,
      color-mix(in srgb, var(--theme-primary) 9%, transparent),
      transparent 34%
    ),
    var(--theme-surface);
}

.login-stage__brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.login-stage__brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--theme-primary-light);
  color: var(--theme-primary);
  font-size: 20px;
}

.login-stage__brand-title {
  color: var(--theme-text);
  font-size: 15px;
  font-weight: 700;
}

.login-stage__brand-subtitle {
  margin-top: 2px;
  color: var(--theme-text-muted);
  font-size: 12px;
}

.login-stage__hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 520px;
}

.login-stage__eyebrow,
.login-panel__eyebrow {
  color: var(--theme-text-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-stage__title,
.login-panel__title {
  margin: 0;
  color: var(--theme-text);
  font-weight: 700;
  line-height: 1.08;
}

.login-stage__title {
  font-size: 40px;
}

.login-stage__desc,
.login-panel__desc {
  margin: 0;
  color: var(--theme-text-muted);
  font-size: 14px;
  line-height: 1.8;
}

.login-highlights {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login-highlight {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
}

.login-highlight__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--theme-primary-light);
  color: var(--theme-primary);
  font-size: 18px;
}

.login-highlight__title {
  color: var(--theme-text);
  font-size: 14px;
  font-weight: 700;
}

.login-highlight__desc {
  margin-top: 4px;
  color: var(--theme-text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.login-panel {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px;
}

.login-panel__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.theme-switcher__button {
  border-radius: 999px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
  color: var(--theme-text);
}

.theme-switcher__button :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.login-panel__mode {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--theme-surface-strong);
  border: 1px solid var(--theme-border);
  color: var(--theme-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.login-panel__header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-panel__title {
  font-size: 32px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.custom-form-item {
  margin-bottom: 0;
}

.custom-form-item :deep(.el-form-item__label) {
  color: var(--theme-text);
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
  padding-bottom: 0;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 46px;
  border-radius: 14px;
  border: 1px solid var(--theme-border-strong);
  box-shadow: none;
  padding: 0 12px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
  background-color: var(--theme-surface-strong);
}

.login-input :deep(.el-input__wrapper):hover {
  border-color: color-mix(
    in srgb,
    var(--theme-primary) 28%,
    var(--theme-border-strong)
  );
}

.login-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--theme-primary);
  box-shadow: var(--theme-shadow-focus);
}

.login-input :deep(.el-input__wrapper.is-error) {
  border-color: var(--theme-danger);
}

.login-input :deep(.el-input__wrapper.is-error.is-focus) {
  border-color: var(--theme-danger);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--theme-danger) 12%, transparent);
}

.login-input :deep(.el-input__inner) {
  height: 42px;
  line-height: 42px;
  font-size: 13px;
}

.login-input :deep(.el-input__inner::placeholder) {
  color: var(--theme-text-soft);
}

.login-form__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 2px 0 0;
  font-size: 12px;
}

.custom-checkbox :deep(.el-checkbox__label) {
  font-size: 12px;
  color: var(--theme-text);
}

.login-form__tip {
  color: var(--theme-text-muted);
  font-size: 12px;
}

.service-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
}

.service-panel__title {
  color: var(--theme-text);
  font-size: 15px;
  font-weight: 700;
}

.service-panel__desc {
  margin-top: 4px;
  color: var(--theme-text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.service-radio-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.service-radio-group :deep(.el-radio-button__inner) {
  min-width: 110px;
  border-radius: 12px !important;
  border: 1px solid var(--theme-border) !important;
  box-shadow: none !important;
  background: var(--theme-surface);
}

.service-radio-group
  :deep(.el-radio-button:first-child .el-radio-button__inner),
.service-radio-group
  :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 12px !important;
}

.service-addresses {
  display: grid;
  gap: 10px;
}

.service-address {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
}

.service-address__label {
  color: var(--theme-text-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.service-address__value {
  color: var(--theme-text);
  font-size: 12px;
  line-height: 1.7;
  word-break: break-all;
}

.service-tip {
  color: var(--theme-text-muted);
  font-size: 12px;
}

.form-error-alert {
  margin: 0;
  font-size: 12px;
}

.button-submit {
  width: 100%;
  margin: 6px 0 0;
  border: none;
  border-radius: 14px;
  height: 44px;
  font-size: 13px;
  font-weight: 700;
  transition: 0.2s ease-in-out;
}

@media (max-width: 980px) {
  .login-page {
    padding: 18px;
  }

  .login-stage {
    grid-template-columns: 1fr;
    padding: 16px;
    border-radius: 26px;
  }

  .login-stage__title {
    font-size: 32px;
  }
}

@media (max-width: 767px) {
  .login-page {
    padding: 14px;
  }

  .login-stage {
    gap: 14px;
    padding: 14px;
    border-radius: 22px;
  }

  .login-stage__intro,
  .login-panel {
    padding: 18px;
    border-radius: 20px;
  }

  .login-panel__topbar,
  .login-form__meta {
    flex-direction: column;
    align-items: stretch;
  }

  .login-stage__title,
  .login-panel__title {
    font-size: 28px;
  }

  .theme-switcher__button,
  .login-panel__mode,
  .button-submit {
    width: 100%;
    justify-content: center;
  }

  .service-radio-group {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
