<template>
  <main class="login-page">
    <aside class="login-art-panel" aria-label="品牌插画区域">
      <!-- 后续替换为提供的插画图片；容器比例与留白已按参考图预留。 -->
      <div class="login-artwork-placeholder" aria-hidden="true">
        <div class="login-artwork-placeholder__glow" />
        <div class="login-artwork-placeholder__frame" />
      </div>
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
        </el-form>
      </div>

      <footer class="login-footer">衣设客户端</footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { login } from "../api/auth";
import { getApiBaseByMode, getServiceMode } from "../config/api";
import { updateApiBaseUrl } from "../api/request";

const emit = defineEmits<{ (e: "login-success"): void }>();

const loading = ref(false);
const errorMessage = ref("");
const appIconSrc = new URL("../assets/icon.png", import.meta.url).href;
const form = reactive({ account: "", password: "" });
const formValid = computed(
  () => form.account.trim().length >= 3 && form.password.length >= 6,
);

onMounted(() => {
  updateApiBaseUrl(getApiBaseByMode(getServiceMode()));
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

.login-footer {
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
  margin: 0 0 0 8px;
  overflow: hidden;
  border-top-right-radius: clamp(26px, 3.3vw, 52px);
  border-bottom-right-radius: clamp(26px, 3.3vw, 52px);
  box-shadow: var(--theme-shadow-md);
  background:
    radial-gradient(
      circle at 50% 65%,
      color-mix(in srgb, var(--theme-text) 10%, transparent),
      transparent 30%
    ),
    linear-gradient(
      145deg,
      var(--theme-surface-strong) 0%,
      var(--theme-surface-muted) 55%,
      var(--theme-surface) 100%
    );
}

.login-art-panel::before {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--theme-text) 3%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--theme-text) 3%, transparent) 1px,
      transparent 1px
    );
  background-size: 42px 42px;
  content: "";
  mask-image: linear-gradient(to bottom, black, transparent 85%);
}

.login-art-slogan {
  position: absolute;
  z-index: 1;
  bottom: clamp(24px, 4vh, 48px);
  left: clamp(24px, 4vw, 54px);
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.login-art-slogan i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.38;
}

.login-artwork-placeholder {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(34vw, 410px);
  aspect-ratio: 1;
  transform: translate(-50%, -42%);
}

.login-artwork-placeholder__glow {
  position: absolute;
  inset: 20%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--theme-text) 18%, transparent),
    transparent 68%
  );
  filter: blur(24px);
}

.login-artwork-placeholder__frame {
  position: absolute;
  inset: 17%;
  border: 1px solid color-mix(in srgb, var(--theme-text) 18%, transparent);
  border-radius: 28px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-text) 10%, transparent),
    color-mix(in srgb, var(--theme-text) 1.5%, transparent)
  );
  box-shadow:
    inset 0 1px color-mix(in srgb, var(--theme-text) 7%, transparent),
    var(--theme-shadow-md);
  transform: rotate(-8deg);
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
