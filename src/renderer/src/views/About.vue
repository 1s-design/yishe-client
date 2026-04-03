<script setup lang="ts">
import { ref, onMounted } from 'vue'

const appVersion = ref('')
const iconSrc = new URL('../assets/icon.png', import.meta.url).href

onMounted(async () => {
  try {
    appVersion.value = await window.api.getAppVersion()
  } catch (error) {
    console.error('获取版本信息失败:', error)
  }
})
</script>

<template>
  <div>
    <el-card class="about-card" shadow="never">
      <div class="about-body">
        <el-avatar :size="72" shape="square">
          <img :src="iconSrc" alt="logo" />
        </el-avatar>
        <div class="about-title">衣设客户端</div>
        <div class="about-version">版本 v{{ appVersion || "--" }}</div>
        <div class="about-desc">最具创意的设计工具</div>
        <el-button
          type="primary"
          link
          href="https://github.com/chan-max"
          target="_blank"
          rel="noopener noreferrer"
        >
          Jackie Chan
        </el-button>
      </div>
    </el-card>
  </div>
</template>

