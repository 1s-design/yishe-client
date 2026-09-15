<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { getPlatformColor, getPlatformLabel } from "@/config/platform-colors";
import { publishConfigApi, type PublishConfig } from "@/api/publishConfig";

interface Props {
  visible: boolean;
  /** 已选中的发布配置 ID 列表 */
  selectedIds?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  selectedIds: () => [],
});

const emit = defineEmits<{
  close: [];
  confirm: [selectedIds: string[]];
}>();

// 配置列表
const configList = ref<PublishConfig[]>([]);
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);
const keyword = ref("");

// 本地选中的配置 ID
const localSelectedIds = ref<Set<string>>(new Set());

// 监听弹窗打开，加载配置
watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      localSelectedIds.value = new Set(props.selectedIds || []);
      await loadConfigs();
    }
  },
);

// 加载配置列表
async function loadConfigs() {
  loading.value = true;
  try {
    const res = await publishConfigApi.findAll();
    if (res.data && Array.isArray(res.data)) {
      configList.value = res.data.filter((c) => c.isActive);
      total.value = configList.value.length;
    }
  } catch (error) {
    console.error("加载发布配置失败:", error);
  } finally {
    loading.value = false;
  }
}

// 过滤后的配置列表
const filteredConfigs = computed(() => {
  if (!keyword.value.trim()) return configList.value;
  const kw = keyword.value.trim().toLowerCase();
  return configList.value.filter(
    (c) =>
      c.name.toLowerCase().includes(kw) ||
      c.platform.toLowerCase().includes(kw),
  );
});

// 分页后的配置列表
const pagedConfigs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredConfigs.value.slice(start, start + pageSize.value);
});

// 总页数
const totalPages = computed(() =>
  Math.ceil(filteredConfigs.value.length / pageSize.value),
);

// 切换配置选中状态
function toggleConfig(id: string) {
  if (localSelectedIds.value.has(id)) {
    localSelectedIds.value.delete(id);
  } else {
    localSelectedIds.value.add(id);
  }
  // 触发响应式更新
  localSelectedIds.value = new Set(localSelectedIds.value);
}

// 判断是否选中
function isSelected(id: string): boolean {
  return localSelectedIds.value.has(id);
}

// 确认选择
function handleConfirm() {
  emit("confirm", Array.from(localSelectedIds.value));
}

// 取消
function handleClose() {
  emit("close");
}

// 切换页码
function goToPage(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="handleClose"
    >
      <section
        class="flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-select-title"
      >
        <!-- 标题 -->
        <header class="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="config-select-title" class="font-semibold">选择发布配置</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              选择要发布到的平台配置（已选 {{ localSelectedIds.size }} 个）
            </p>
          </div>
          <Button variant="ghost" size="icon" title="关闭" @click="handleClose">
            <span class="mdi mdi-close text-lg" />
          </Button>
        </header>

        <!-- 搜索栏 -->
        <div class="border-b border-border px-5 py-3">
          <div class="relative">
            <span class="mdi mdi-magnify absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索配置名称或平台..."
              class="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
              @input="currentPage = 1"
            />
          </div>
        </div>

        <!-- 配置列表 -->
        <div class="flex-1 overflow-y-auto p-5">
          <div v-if="loading" class="flex items-center justify-center py-12">
            <span class="mdi mdi-loading animate-spin text-2xl text-muted-foreground" />
            <span class="ml-2 text-sm text-muted-foreground">加载中...</span>
          </div>

          <div v-else-if="pagedConfigs.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <span class="mdi mdi-package-variant-closed text-4xl" />
            <p class="mt-2 text-sm">暂无发布配置</p>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="config in pagedConfigs"
              :key="config.id"
              class="group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-all"
              :class="[
                isSelected(config.id)
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-primary/40 hover:bg-muted/30',
              ]"
              @click="toggleConfig(config.id)"
            >
              <!-- 复选框 -->
              <div
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors"
                :class="[
                  isSelected(config.id)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background',
                ]"
              >
                <span v-if="isSelected(config.id)" class="mdi mdi-check text-xs" />
              </div>

              <!-- 配置名称 -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ config.name }}</p>
              </div>

              <!-- 平台标签（带颜色） -->
              <Badge
                variant="outline"
                class="shrink-0 border"
                :style="{
                  borderColor: getPlatformColor(config.platform).primary,
                  backgroundColor: getPlatformColor(config.platform).light,
                  color: getPlatformColor(config.platform).text,
                }"
              >
                {{ getPlatformLabel(config.platform) }}
              </Badge>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between border-t border-border px-5 py-3"
        >
          <span class="text-xs text-muted-foreground">
            共 {{ filteredConfigs.length }} 条，第 {{ currentPage }}/{{ totalPages }} 页
          </span>
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              :disabled="currentPage <= 1"
              @click="goToPage(currentPage - 1)"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="currentPage >= totalPages"
              @click="goToPage(currentPage + 1)"
            >
              下一页
            </Button>
          </div>
        </div>

        <!-- 底部操作 -->
        <footer class="flex items-center justify-between border-t border-border px-5 py-4">
          <span class="text-xs text-muted-foreground">
            已选择 <span class="font-medium text-foreground">{{ localSelectedIds.size }}</span> 个配置
          </span>
          <div class="flex gap-2">
            <Button variant="ghost" @click="handleClose">取消</Button>
            <Button
              :disabled="localSelectedIds.size === 0"
              @click="handleConfirm"
            >
              确认选择
            </Button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
