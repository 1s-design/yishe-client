<template>
  <div class="login-page">
    <section class="login-panel">
      <header class="login-panel__header">
        <div class="login-brandline">
          <div class="login-brandline__title">衣设客户端</div>

          <el-dropdown trigger="click" placement="bottom-end">
            <el-button text class="login-theme">
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
        </div>

        <h1 class="login-title">登录</h1>
        <p class="login-desc">输入账号密码后进入客户端</p>
      </header>

      <el-form
        class="login-form"
        label-position="top"
        @submit.prevent="handleLogin"
        autocomplete="on"
      >
        <el-form-item
          label="账号"
          :error="accountHelp || undefined"
          :show-message="false"
          class="login-form__item"
        >
          <el-input
            v-model="form.account"
            size="large"
            clearable
            autocomplete="username"
            placeholder="请输入账号"
            class="login-input"
          />
          <div
            class="login-form__hint"
            :class="{ 'is-empty': !accountHelp }"
            aria-live="polite"
          >
            {{ accountHelp || "\u00A0" }}
          </div>
        </el-form-item>

        <el-form-item
          label="密码"
          :error="passwordHelp || undefined"
          :show-message="false"
          class="login-form__item"
        >
          <el-input
            v-model="form.password"
            size="large"
            autocomplete="current-password"
            placeholder="请输入密码"
            show-password
            class="login-input"
          />
          <div
            class="login-form__hint"
            :class="{ 'is-empty': !passwordHelp }"
            aria-live="polite"
          >
            {{ passwordHelp || "\u00A0" }}
          </div>
        </el-form-item>

        <el-alert
          v-if="errorMessage"
          class="login-form__error"
          type="error"
          :title="errorMessage"
          show-icon
        />

        <el-button
          class="login-form__submit"
          type="primary"
          size="large"
          :loading="loading"
          :disabled="!formValid"
          native-type="submit"
        >
          登录
        </el-button>

        <div class="login-sideinfo">
          <div class="login-sideinfo__row">
            <span class="login-sideinfo__label">服务模式</span>
            <el-radio-group
              v-model="serviceMode"
              @change="handleServiceModeChange"
              class="segmented-group"
              :disabled="!isDevelopment"
            >
              <el-radio-button label="local">本地</el-radio-button>
              <el-radio-button label="remote">远程</el-radio-button>
            </el-radio-group>
          </div>

          <div class="login-sideinfo__row login-sideinfo__row--stack">
            <span class="login-sideinfo__label">连接地址</span>
            <div class="login-endpoints">
              <div class="login-endpoints__item">
                <span class="login-endpoints__tag">API</span>
                <span class="login-endpoints__text">{{ currentApiBase }}</span>
              </div>
              <div class="login-endpoints__item">
                <span class="login-endpoints__tag">WS</span>
                <span class="login-endpoints__text">{{
                  currentWsEndpoint
                }}</span>
              </div>
            </div>
          </div>

          <div class="login-sideinfo__note">
            {{ isDevelopment ? serviceModeLabel : "生产环境固定为远程服务" }}
          </div>
        </div>
      </el-form>
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
const errorMessage = ref("");
const serviceMode = ref<ServiceMode>(getServiceMode());
const isDevelopment = process.env.NODE_ENV === "development";
const { themePreferenceLabel, themeToggleIcon, setThemePreference } =
  useThemeMode();

const form = reactive({
  account: "",
  password: "",
});

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
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100%;
  padding: 8px;
  overflow: hidden;
}

.login-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 320px;
  max-height: 100%;
  padding: 12px;
  border: 1px solid var(--theme-border);
  border-radius: 16px;
  background: var(--theme-surface);
  overflow: hidden;
}

.login-panel__header,
.login-form,
.login-sideinfo {
  width: 100%;
}

.login-panel__header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 2px;
}

.login-brandline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.login-brandline__title {
  color: var(--theme-text-soft);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
}

.login-theme {
  min-height: 24px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
  color: var(--theme-text);
  font-size: 9px;
}

.login-theme :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1;
}

.login-title {
  margin: 0;
  color: var(--theme-text);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
}

.login-desc {
  margin: 0;
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}

.login-form__item {
  margin-bottom: 0;
}

.login-form__item :deep(.el-form-item__label) {
  color: var(--theme-text);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  padding-bottom: 0;
  line-height: 1.1;
}

.login-form__item :deep(.el-form-item__content) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}

.login-form__hint {
  min-height: 14px;
  color: var(--theme-danger);
  font-size: 10px;
  line-height: 1.35;
  padding-left: 2px;
}

.login-form__hint.is-empty {
  visibility: hidden;
}

.login-input {
  width: 100%;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 34px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: var(--theme-surface);
  box-shadow: none;
}

.login-input :deep(.el-input__inner) {
  font-size: 12px;
}

.login-input :deep(.el-input__wrapper:hover) {
  border-color: var(--theme-border-strong);
}

.login-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--theme-text);
  box-shadow: var(--theme-shadow-focus);
}

.login-form__error {
  margin: 0;
}

.login-form__error :deep(.el-alert) {
  padding: 6px 8px;
  border-radius: 8px;
}

.login-form__error :deep(.el-alert__title) {
  font-size: 10px;
  line-height: 1.2;
}

.login-form__submit {
  --el-button-bg-color: var(--theme-text);
  --el-button-border-color: var(--theme-text);
  --el-button-text-color: var(--theme-contrast);
  --el-button-hover-bg-color: var(--theme-text);
  --el-button-hover-border-color: var(--theme-text);
  --el-button-hover-text-color: var(--theme-contrast);
  --el-button-active-bg-color: var(--theme-text);
  --el-button-active-border-color: var(--theme-text);
  --el-button-active-text-color: var(--theme-contrast);
  --el-button-disabled-bg-color: var(--theme-surface-muted);
  --el-button-disabled-border-color: var(--theme-border);
  --el-button-disabled-text-color: var(--theme-text-soft);
  width: 100%;
  height: 34px;
  margin-top: 2px;
  border-radius: 10px;
  border-color: var(--theme-text);
  background: var(--theme-text);
  color: var(--theme-contrast);
  font-size: 11px;
  font-weight: 700;
}

.login-form__submit :deep(span) {
  color: inherit;
}

.login-sideinfo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--theme-border);
}

.login-sideinfo__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-sideinfo__row--stack {
  gap: 5px;
}

.login-sideinfo__label {
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1;
}

.segmented-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
  align-self: stretch;
}

.segmented-group :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  min-height: 26px;
  border-radius: 9px !important;
  padding: 0 8px;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
}

.segmented-group :deep(.el-radio-button:first-child .el-radio-button__inner),
.segmented-group :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 9px !important;
}

.segmented-group
  :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--theme-text) !important;
  border-color: var(--theme-text) !important;
  color: var(--theme-contrast) !important;
}

.login-endpoints {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.login-endpoints__item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
}

.login-endpoints__tag {
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;
}

.login-endpoints__text {
  min-width: 0;
  color: var(--theme-text-muted);
  font-size: 9px;
  line-height: 1.3;
  word-break: break-all;
}

.login-sideinfo__note {
  color: var(--theme-text-muted);
  font-size: 9px;
  line-height: 1.25;
}

@media (max-height: 620px) {
  .login-panel {
    max-width: 304px;
    padding: 10px;
  }

  .login-title {
    font-size: 20px;
  }

  .login-form {
    gap: 8px;
  }

  .login-input :deep(.el-input__wrapper) {
    min-height: 32px;
  }

  .login-form__submit {
    height: 32px;
  }
}
</style>
