<template>
  <div class="login-page">
    <section class="login-panel">
      <header class="login-panel__header">
        <div class="login-brandline">
          <div class="login-brand">
            <img :src="appIconSrc" alt="衣设客户端图标" class="login-brand__icon" />
            <div class="login-brandline__title">衣设客户端</div>
          </div>

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
      </header>

      <el-form
        class="login-form"
        label-position="top"
        @submit.prevent="handleLogin"
        autocomplete="on"
      >
        <el-form-item
          :error="accountHelp || undefined"
          :show-message="false"
          class="login-form__item"
        >
          <el-input
            v-model="form.account"
            size="large"
            clearable
            autocomplete="username"
            aria-label="账号"
            placeholder="账号"
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
          :error="passwordHelp || undefined"
          :show-message="false"
          class="login-form__item"
        >
          <el-input
            v-model="form.password"
            size="large"
            autocomplete="current-password"
            aria-label="密码"
            placeholder="密码"
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
          <div class="login-sideinfo__row login-sideinfo__row--inline">
            <span class="login-sideinfo__label">服务模式</span>
            <div
              class="service-toggle"
              :class="{ 'is-disabled': !isDevelopment }"
              role="group"
              aria-label="服务模式"
            >
              <button
                type="button"
                class="service-toggle__option"
                :class="{ 'is-active': serviceMode === 'local' }"
                :disabled="!isDevelopment"
                @click="handleServiceModeChange('local')"
              >
                本地
              </button>
              <button
                type="button"
                class="service-toggle__option"
                :class="{ 'is-active': serviceMode === 'remote' }"
                :disabled="!isDevelopment"
                @click="handleServiceModeChange('remote')"
              >
                远程
              </button>
            </div>
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
  getApiBaseByMode,
  getServiceMode,
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
const appIconSrc = new URL("../assets/icon.png", import.meta.url).href;
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

const handleServiceModeChange = async (mode: ServiceMode) => {
  if (mode === serviceMode.value) {
    return;
  }

  if (!isDevelopment) {
    serviceMode.value = getServiceMode();
    return;
  }

  try {
    websocketClient.switchService(mode);
    serviceMode.value = mode;
    updateApiBaseUrl(getApiBaseByMode(mode));
  } catch (error) {
    console.error("切换服务配置失败:", error);
    serviceMode.value = getServiceMode();
  }
};

onMounted(() => {
  updateApiBaseUrl(getApiBaseByMode(serviceMode.value));
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
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100%;
  padding: 8px;
  background:
    radial-gradient(
      circle at top,
      color-mix(in srgb, var(--theme-text) 3%, transparent),
      transparent 48%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--theme-bg) 84%, var(--theme-surface) 16%),
      var(--theme-bg)
    );
  overflow: hidden;
}

.login-page::before,
.login-page::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.login-page::before {
  inset: -16%;
  z-index: -2;
  background:
    radial-gradient(
      circle at 16% 18%,
      color-mix(in srgb, var(--theme-warning) 18%, transparent),
      transparent 26%
    ),
    radial-gradient(
      circle at 82% 20%,
      color-mix(in srgb, var(--theme-success) 16%, transparent),
      transparent 24%
    ),
    radial-gradient(
      circle at 52% 86%,
      color-mix(in srgb, var(--theme-text) 7%, transparent),
      transparent 30%
    );
  filter: blur(14px);
  opacity: 0.9;
  transform: translate3d(0, 0, 0) scale(1.02);
  animation: loginAmbientFloat 18s ease-in-out infinite alternate;
}

.login-page::after {
  z-index: -1;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--theme-text) 4%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      0deg,
      color-mix(in srgb, var(--theme-text) 3%, transparent) 1px,
      transparent 1px
    );
  background-size: 68px 68px;
  opacity: 0.3;
  mask-image: radial-gradient(circle at center, black 18%, transparent 78%);
  animation: loginGridDrift 26s linear infinite;
}

.login-panel {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 348px;
  max-height: 100%;
  padding: 14px 14px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 16px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--theme-surface) 92%, var(--theme-surface-strong) 8%),
      var(--theme-surface)
    );
  box-shadow:
    0 24px 60px color-mix(in srgb, var(--theme-text) 8%, transparent),
    0 8px 24px color-mix(in srgb, var(--theme-text) 4%, transparent);
  overflow: hidden;
}

.login-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(
      circle at top right,
      color-mix(in srgb, var(--theme-success) 10%, transparent),
      transparent 28%
    ),
    linear-gradient(
      115deg,
      transparent 0%,
      color-mix(in srgb, var(--theme-warning) 8%, transparent) 46%,
      transparent 68%
    );
  opacity: 0.7;
  transform: translate3d(-10%, -4%, 0);
  animation: loginPanelSheen 12s ease-in-out infinite;
  pointer-events: none;
}

.login-panel__header,
.login-form,
.login-sideinfo {
  position: relative;
  z-index: 1;
  width: 100%;
}

.login-panel__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.login-brandline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.login-brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.login-brand__icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 6px;
  box-shadow: 0 6px 14px color-mix(in srgb, var(--theme-text) 10%, transparent);
  object-fit: cover;
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

.login-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--theme-border) 92%, transparent);
  border-radius: 14px;
  background: var(--theme-surface);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--theme-contrast) 18%, transparent) inset;
}

.login-form__item {
  margin-bottom: 0;
}

.login-form__item :deep(.el-form-item__content) {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding-bottom: 14px;
}

.login-form__hint {
  position: absolute;
  left: 1px;
  right: 0;
  bottom: 0;
  min-height: 12px;
  color: var(--theme-danger);
  font-size: 10px;
  line-height: 1.25;
}

.login-form__hint.is-empty {
  visibility: hidden;
}

.login-input {
  width: 100%;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 32px;
  border: 1px solid var(--theme-border);
  border-radius: 9px;
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
  height: 32px;
  margin-top: 0;
  border-radius: 9px;
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
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--theme-border);
}

.login-sideinfo__row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
  row-gap: 4px;
}

.login-sideinfo__row--inline {
  align-items: center;
}

.login-sideinfo__label {
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.2;
}

.service-toggle {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(46px, auto);
  justify-self: start;
  gap: 3px;
  padding: 2px;
  border: 1px solid var(--theme-border);
  border-radius: 9px;
  background: var(--theme-surface-strong);
}

.service-toggle.is-disabled {
  opacity: 0.7;
}

.service-toggle__option {
  min-height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--theme-text-muted);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}

.service-toggle__option:hover:not(:disabled) {
  color: var(--theme-text);
}

.service-toggle__option.is-active {
  background: var(--theme-text);
  color: var(--theme-contrast);
  box-shadow: var(--theme-shadow-xs);
}

.service-toggle__option:disabled {
  cursor: not-allowed;
}

@media (max-height: 620px) {
  .login-panel {
    max-width: 332px;
    padding: 12px 12px 10px;
  }

  .login-form {
    gap: 7px;
    padding: 9px;
  }

  .login-input :deep(.el-input__wrapper) {
    min-height: 32px;
  }

  .login-form__submit {
    height: 32px;
  }

  .login-sideinfo__row {
    grid-template-columns: 48px minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-page::before,
  .login-page::after,
  .login-panel::before {
    animation: none;
  }
}

@keyframes loginAmbientFloat {
  0% {
    transform: translate3d(-2%, 0, 0) scale(1.01);
  }

  50% {
    transform: translate3d(1.5%, -2.5%, 0) scale(1.04);
  }

  100% {
    transform: translate3d(3%, 1.5%, 0) scale(1.03);
  }
}

@keyframes loginGridDrift {
  0% {
    background-position:
      0 0,
      0 0;
  }

  100% {
    background-position:
      68px 0,
      0 68px;
  }
}

@keyframes loginPanelSheen {
  0% {
    transform: translate3d(-12%, -5%, 0);
    opacity: 0.45;
  }

  50% {
    transform: translate3d(8%, 3%, 0);
    opacity: 0.72;
  }

  100% {
    transform: translate3d(-4%, 6%, 0);
    opacity: 0.52;
  }
}
</style>
