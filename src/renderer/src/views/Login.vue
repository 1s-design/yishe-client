<template>
  <main class="login-page">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-heading">
        <img :src="appIconSrc" alt="1s design" class="login-logo" />
        <h1 id="login-title" class="sr-only">登录</h1>
      </div>

      <el-form
        class="login-form"
        @submit.prevent="handleLogin"
        autocomplete="on"
      >
        <el-input
          v-model="form.account"
          autocomplete="username"
          aria-label="账号"
          placeholder="账号"
          class="login-input"
        />
        <el-input
          v-model="form.password"
          autocomplete="current-password"
          aria-label="密码"
          placeholder="密码"
          show-password
          type="password"
          class="login-input"
          @keyup.enter="handleLogin"
        />
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
    errorMessage.value =
      error?.response?.data?.message || error?.message || "登录失败，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #080808;
  color: #f2f2f2;
}

.login-panel {
  display: flex;
  width: min(100% - 40px, 328px);
  flex-direction: column;
  align-items: stretch;
  padding: 28px;
}

.login-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 22px;
}

.login-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
}

.login-form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 10px;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 42px;
  padding: 0 13px;
  border: 1px solid #303030;
  border-radius: 10px;
  background: #121212;
  box-shadow: none !important;
}

.login-input :deep(.el-input__wrapper:hover),
.login-input :deep(.el-input__wrapper.is-focus) {
  border-color: #555;
}

.login-input :deep(.el-input__inner) {
  color: #f2f2f2;
  font-size: 13px;
}

.login-input :deep(.el-input__inner::placeholder) {
  color: #858585;
}

.login-error {
  margin: 2px 0 0;
  color: #e07878;
  font-size: 12px;
  line-height: 1.45;
}

.login-submit {
  width: 100%;
  height: 42px;
  margin-top: 4px;
  border: 0;
  border-radius: 10px;
  background: #f2f2f2;
  color: #090909;
  font-size: 13px;
  font-weight: 600;
}

.login-submit:hover,
.login-submit:focus-visible {
  background: #fff;
  color: #090909;
}

.login-submit.is-disabled,
.login-submit.is-disabled:hover {
  background: #242424;
  color: #858585;
}
</style>
