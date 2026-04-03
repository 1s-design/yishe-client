<script setup lang="ts">
// Tasks 页面
</script>

<template>
  <div class="tasks-page">
    <el-card class="tasks-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div class="card-header-left">
            <i class="mdi mdi-clipboard-check-outline card-header-icon" />
            <span class="card-title">任务管理</span>
          </div>
        </div>
      </template>
      <div class="card-content">
        <div class="empty-state">
          <div class="empty-icon">
            <i class="mdi mdi-clipboard-list-outline" />
          </div>
          <h3 class="empty-title">任务管理功能开发中</h3>
          <p class="empty-description">
            我们将在这里提供任务创建、管理和监控功能
          </p>
        </div>
      </div>
    </el-card>
  </div>
</template>

