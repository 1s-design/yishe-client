<template>
  <main class="login-page">
    <aside class="login-art-panel" aria-label="品牌插画区域">
      <img
        v-for="(illustration, index) in loginIllustrations"
        :key="illustration"
        :src="illustration"
        :class="[
          'login-art-image',
          { 'is-active': index === activeIllustration },
        ]"
        alt=""
        aria-hidden="true"
      />
      <div class="login-art-slogan" aria-label="创意、自由、开放">
        <span>创意</span>
        <i aria-hidden="true" />
        <span>自由</span>
        <i aria-hidden="true" />
        <span>开放</span>
      </div>
    </aside>

    <section class="login-form-pane" aria-labelledby="login-title">
      <div class="login-form-content">
        <header class="login-heading">
          <img :src="appIconSrc" alt="1s design" class="login-logo" />
          <h1 id="login-title">欢迎使用 1s design</h1>
        </header>

        <el-form
          class="login-form"
          @submit.prevent="handleLogin"
          autocomplete="on"
        >
          <label class="login-field">
            <span>账号</span>
            <el-input
              v-model="form.account"
              autocomplete="username"
              aria-label="账号"
              placeholder="请输入账号"
              class="login-input"
            >
              <template #prefix>
                <span class="mdi mdi-email-outline" aria-hidden="true" />
              </template>
            </el-input>
          </label>

          <label class="login-field">
            <span>密码</span>
            <el-input
              v-model="form.password"
              autocomplete="current-password"
              aria-label="密码"
              placeholder="请输入密码"
              show-password
              type="password"
              class="login-input"
              @keyup.enter="handleLogin"
            >
              <template #prefix>
                <span class="mdi mdi-lock-outline" aria-hidden="true" />
              </template>
            </el-input>
          </label>

          <p v-if="errorMessage" class="login-error" role="alert">
            {{ errorMessage }}
          </p>

          <el-button
            class="login-submit"
            type="primary"
            :loading="loading"
            :disabled="!formValid"
            native-type="submit"
          >
            登录
          </el-button>

          <!-- 分割线 -->
          <div class="login-divider">
            <span class="login-divider__line" />
            <span class="login-divider__text">或</span>
            <span class="login-divider__line" />
          </div>

          <!-- 一键授权登录 -->
          <el-button
            class="login-oauth-btn"
            :class="{ 'is-loading-text': oauthLoading }"
            @click="oauthLoading ? handleCancelOAuth() : handleOAuthLogin()"
          >
            <span v-if="oauthLoading" class="login-oauth-spinner" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                <circle cx="10" cy="10" r="8" stroke-opacity="0.25" />
                <path d="M10 2a8 8 0 0 1 8 8" stroke-linecap="round" />
              </svg>
            </span>
            <span v-else class="login-oauth-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </span>
            {{ oauthLoading ? '取消授权' : '一键授权登录' }}
          </el-button>
        </el-form>
      </div>

      <footer class="login-footer">衣设客户端</footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { login } from "../api/auth";
import { getApiBaseByMode, getServiceMode } from "../config/api";
import { updateApiBaseUrl } from "../api/request";
import { oauthLogin } from "../api/oauth";
import loginIllustration from "../assets/login/mondrian-composition.jpg";
import loginIllustrationNoII from "../assets/login/mondrian-composition-no-ii.jpg";
import girlWithAPearlEarring from "../assets/login/girl-with-a-pearl-earring.jpg";
import solitaryTree from "../assets/login/solitary-tree.jpg";
import lamuTown from "../assets/login/lamu-town.jpg";
import peacockAndPeonies from "../assets/login/peacock-and-peonies.jpg";
import chineseLandscape1 from "../assets/login/chinese-landscape-art-1.jpg";
import chineseLandscape2 from "../assets/login/chinese-landscape-art-2.jpg";

const emit = defineEmits<{ (e: "login-success"): void }>();

const loading = ref(false);
const oauthLoading = ref(false);
const errorMessage = ref("");
let currentOAuth: { cancel: () => void } | null = null
const appIconSrc = new URL("../assets/icon.png", import.meta.url).href;

const loginIllustrations = [
  loginIllustration,
  loginIllustrationNoII,
  girlWithAPearlEarring,
  solitaryTree,
  lamuTown,
  peacockAndPeonies,
  chineseLandscape1,
  chineseLandscape2,
];
const activeIllustration = ref(Math.floor(Math.random() * loginIllustrations.length));
let illustrationTimer: number | null = null;
const form = reactive({ account: "", password: "" });
const formValid = computed(
  () => form.account.trim().length >= 3 && form.password.length >= 6,
);

onMounted(() => {
  updateApiBaseUrl(getApiBaseByMode(getServiceMode()));
  illustrationTimer = window.setInterval(() => {
    let next = Math.floor(Math.random() * loginIllustrations.length);
    if (next === activeIllustration.value && loginIllustrations.length > 1) {
      next = (next + 1) % loginIllustrations.length;
    }
    activeIllustration.value = next;
  }, 8000);
});

onBeforeUnmount(() => {
  if (illustrationTimer !== null) {
    window.clearInterval(illustrationTimer);
    illustrationTimer = null;
  }
});

async function handleLogin() {
  if (!formValid.value || loading.value) return;

  loading.value = true;
  errorMessage.value = "";
  try {
    await login({ username: form.account.trim(), password: form.password });
    emit("login-success");
  } catch (error: any) {
    const message = String(
      error?.response?.data?.message || error?.message || "",
    );
    errorMessage.value = message.includes("未获取到 token")
      ? "错误的账号密码"
      : message || "登录失败，请重试";
  } finally {
    loading.value = false;
  }
}

/** 一键授权登录 */
async function handleOAuthLogin() {
  oauthLoading.value = true;
  const { promise, cancel } = oauthLogin();
  currentOAuth = { cancel };
  try {
    await promise;
    emit("login-success");
  } catch (error: any) {
    errorMessage.value = error?.message || "授权登录失败";
  } finally {
    oauthLoading.value = false;
    currentOAuth = null;
  }
}

/** 取消授权 */
function handleCancelOAuth() {
  currentOAuth?.cancel();
  oauthLoading.value = false;
  currentOAuth = null;
}
</script>

<style scoped>
.login-page {
  --el-bg-color: var(--theme-surface);
  --el-bg-color-page: var(--theme-bg);
  --el-bg-color-overlay: var(--theme-surface);
  --el-fill-color: var(--theme-surface-muted);
  --el-fill-color-blank: var(--theme-surface);
  --el-border-color: var(--theme-border);
  --el-border-color-light: var(--theme-border);
  --el-text-color-primary: var(--theme-text);
  --el-text-color-regular: var(--theme-text-muted);
  --el-text-color-placeholder: var(--theme-text-soft);
  --el-color-primary: var(--theme-text);
  display: grid;
  min-height: 100vh;
  grid-template-columns: minmax(0, 1fr) minmax(330px, 37%);
  overflow: hidden;
  background: var(--theme-bg) !important;
  color: var(--theme-text);
}

.login-form-pane {
  display: flex;
  min-width: 0;
  min-height: 100vh;
  align-items: center;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(28px, 7vh, 64px) clamp(26px, 4vw, 60px) 24px;
  background: var(--theme-bg);
}

.login-form-content {
  display: flex;
  width: min(100%, 372px);
  flex: 1;
  flex-direction: column;
  justify-content: center;
}

.login-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: clamp(42px, 7vh, 72px);
}

.login-logo {
  width: 23px;
  height: 23px;
  flex: 0 0 23px;
  border-radius: 6px;
  object-fit: cover;
}

.login-heading h1 {
  margin: 0;
  color: var(--theme-text);
  font-size: clamp(22px, 1.65vw, 27px);
  font-weight: 620;
  letter-spacing: -0.042em;
  line-height: 1.16;
  text-rendering: optimizeLegibility;
}

.login-form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--theme-text-muted);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.015em;
  line-height: 1.1;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid var(--theme-border) !important;
  border-radius: 8px;
  background: var(--theme-surface) !important;
  box-shadow: none !important;
}

.login-input :deep(.el-input__wrapper:hover),
.login-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--theme-border-strong) !important;
}

.login-input :deep(.el-input__prefix) {
  margin-right: 6px;
  color: var(--theme-text-soft);
  font-size: 14px;
}

.login-input :deep(.el-input__inner) {
  color: var(--theme-text);
  font-size: 11px;
}

.login-input :deep(.el-input__inner::placeholder) {
  color: var(--theme-text-soft);
}

.login-input :deep(.el-input__suffix-inner),
.login-input :deep(.el-input__password) {
  color: var(--theme-text-soft) !important;
}

.login-input :deep(.el-input__password:hover) {
  color: var(--theme-text) !important;
}

.login-error {
  margin: -8px 0 -2px;
  color: var(--theme-danger);
  font-size: 12px;
  line-height: 1.45;
}

.login-submit {
  width: 100%;
  height: 40px;
  margin-top: 1px;
  border: 0;
  border-radius: 8px;
  background: var(--theme-text) !important;
  color: var(--theme-contrast) !important;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.035em;
  box-shadow: none !important;
}

.login-submit:hover,
.login-submit:focus-visible {
  background: var(--theme-primary-strong) !important;
  color: var(--theme-contrast) !important;
}

.login-submit.is-disabled,
.login-submit.is-disabled:hover {
  background: var(--theme-surface-muted) !important;
  color: var(--theme-text-soft) !important;
}

/* 分割线 */
.login-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}

.login-divider__line {
  flex: 1;
  height: 1px;
  background: var(--theme-border);
}

.login-divider__text {
  font-size: 11px;
  color: var(--theme-text-soft);
}

/* 一键授权登录按钮 */
.login-oauth-btn {
  width: 100%;
  height: 40px;
  border: 1px solid var(--theme-border) !important;
  border-radius: 8px;
  background: var(--theme-surface) !important;
  color: var(--theme-text) !important;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s ease;
}

.login-oauth-btn:hover {
  border-color: var(--theme-text) !important;
  background: var(--theme-surface-muted) !important;
}

.login-oauth-icon,
.login-oauth-spinner {
  display: flex;
  align-items: center;
  color: var(--theme-text-muted);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-footer {
  width: min(100%, 372px);
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 550;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.login-art-panel {
  position: relative;
  min-width: 0;
  z-index: 1;
  overflow: hidden;
  border-top-right-radius: clamp(6px, 0.8vw, 10px);
  border-bottom-right-radius: clamp(6px, 0.8vw, 10px);
  corner-shape: squircle;
  background: var(--theme-surface);
  box-shadow: var(--theme-shadow-md);
}

.login-art-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 1.1s ease-in-out;
}

.login-art-image.is-active {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .login-art-image {
    transition: none;
  }
}

.login-art-slogan {
  position: absolute;
  bottom: clamp(24px, 4vh, 48px);
  left: clamp(24px, 4vw, 54px);
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.login-art-slogan i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.56;
}

@media (max-width: 860px) {
  .login-page {
    grid-template-columns: minmax(0, 1fr);
  }

  .login-form-pane {
    align-items: center;
    padding: 30px 24px 24px;
  }

  .login-form-content {
    flex: 0 1 auto;
  }

  .login-heading {
    margin-bottom: 40px;
  }

  .login-footer {
    width: min(100%, 372px);
    margin-top: 40px;
  }

  .login-art-panel {
    display: none;
  }
}

@media (max-height: 680px) and (min-width: 861px) {
  .login-form-pane {
    padding-top: 36px;
    padding-bottom: 28px;
  }

  .login-heading {
    margin-bottom: 48px;
  }
}
</style>
