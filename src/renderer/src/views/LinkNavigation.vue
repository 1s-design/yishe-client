<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useToast } from '../composables/useToast'
import { checkUploaderStatus, getUploaderBrowserStatus, isUploaderBrowserReady, openLink as openUploaderLink } from '../api/uploader'
import type { UploaderStatus, UploaderBrowserStatus } from '../api/uploader'

const { showToast } = useToast()

interface LinkItem {
  name: string
  url: string
  platform?: string
  icon?: string
  logoUrl?: string
  category?: string
}

// 特殊平台的 logo 映射（直接使用网站根路径的 favicon）
const specialLogos: Record<string, string> = {
  'https://www.xiaohongshu.com': 'https://www.xiaohongshu.com/favicon.ico',
  'https://baijiahao.baidu.com': 'https://www.baidu.com/favicon.ico',
  'https://www.dangdang.com': 'https://www.dangdang.com/favicon.ico',
  'https://www.goofish.com/publish': 'https://www.goofish.com/favicon.ico',
  'https://seller.ozon.ru/': 'https://seller.ozon.ru/favicon.ico',
  'https://www.ozon.ru/': 'https://www.ozon.ru/favicon.ico',
  'https://partner.kuajingmaihuo.com/': 'https://partner.kuajingmaihuo.com/favicon.ico',
  'https://cn.lianlianpay.com/account': 'https://cn.lianlianpay.com/favicon.ico',
  'https://www.1688.com': 'https://www.1688.com/favicon.ico',
  'https://op.jinritemai.com/docs/center': 'https://op.jinritemai.com/favicon.ico',
  'https://fxg.jinritemai.com/ffa/mshop/homepage/index': 'https://fxg.jinritemai.com/favicon.ico',
  'https://open.kwaixiaodian.com/': 'https://open.kwaixiaodian.com/favicon.ico',
  'https://s.kwaixiaodian.com/zone/home': 'https://s.kwaixiaodian.com/favicon.ico',
  'https://agentseller.temu.com/': 'https://agentseller.temu.com/favicon.ico'
}

// 获取平台 logo 的函数
const getLogoUrl = (url: string): string => {
  // 优先使用特殊映射的 logo
  if (specialLogos[url]) {
    return specialLogos[url]
  }
  
  try {
    const domain = new URL(url).hostname.replace('www.', '')
    // 使用 Google 的 favicon API
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return ''
  }
}

const linkCategories = [
  {
    key: 'social-media',
    label: '自媒体平台',
    icon: 'mdi-share-variant',
    links: [
      { name: '微博', url: 'https://weibo.com', platform: 'weibo', icon: 'mdi-sina-weibo' },
      { name: '小红书', url: 'https://www.xiaohongshu.com', platform: 'xiaohongshu', icon: 'mdi-book-open-variant' },
      { name: '抖音', url: 'https://www.douyin.com', platform: 'douyin', icon: 'mdi-music-note' },
      { name: '快手', url: 'https://www.kuaishou.com', platform: 'kuaishou', icon: 'mdi-lightning-bolt' },
      { name: 'B站', url: 'https://www.bilibili.com', icon: 'mdi-play-circle' },
      { name: '知乎', url: 'https://www.zhihu.com', icon: 'mdi-help-circle' },
      { name: '今日头条', url: 'https://www.toutiao.com', icon: 'mdi-newspaper' },
      { name: '百家号', url: 'https://baijiahao.baidu.com', icon: 'mdi-file-document-edit' }
    ]
  },
  {
    key: 'cross-border',
    label: '跨境电商平台',
    icon: 'mdi-earth',
    links: [
      { name: 'Amazon', url: 'https://www.amazon.com', platform: 'amazon', icon: 'mdi-cart' },
      { name: 'Temu', url: 'https://www.temu.com', icon: 'mdi-shopping' },
        { name: 'Temu 开放平台', url: 'https://partner.kuajingmaihuo.com/', icon: 'mdi-api' },
      { name: 'Temu 卖家中心', url: 'https://agentseller.temu.com/', icon: 'mdi-store-cog' },
      { name: 'Shein', url: 'https://www.shein.com', platform: 'shein', icon: 'mdi-tshirt-crew' },
      { name: 'eBay', url: 'https://www.ebay.com', icon: 'mdi-store' },
      { name: 'Shopify', url: 'https://www.shopify.com', icon: 'mdi-shopping' },
      { name: 'TikTok Shop', url: 'https://www.tiktok.com/shop', icon: 'mdi-shopping-music' },
      { name: 'TikTok Seller', url: 'https://seller.tiktokshopglobalselling.com/', icon: 'mdi-store-cog' },
      { name: '速卖通', url: 'https://www.aliexpress.com', platform: 'aliexpress', icon: 'mdi-package-variant' },
      { name: 'Wish', url: 'https://www.wish.com', icon: 'mdi-gift' },
      { name: 'Etsy', url: 'https://www.etsy.com', icon: 'mdi-hand-heart' },
      { name: 'Lazada', url: 'https://www.lazada.com', icon: 'mdi-shopping-outline' },
      { name: 'Shopee', url: 'https://www.shopee.com', icon: 'mdi-basket' },
      { name: 'Ozon', url: 'https://www.ozon.ru/', icon: 'mdi-shopping' },
      { name: 'Ozon Seller', url: 'https://seller.ozon.ru/', icon: 'mdi-store-cog' }
    ]
  },
  {
    key: 'social-networks',
    label: '常用社交媒体',
    icon: 'mdi-account-group',
    links: [
      { name: 'Facebook', url: 'https://www.facebook.com', icon: 'mdi-facebook' },
      { name: 'Twitter', url: 'https://twitter.com', icon: 'mdi-twitter' },
      { name: 'Instagram', url: 'https://www.instagram.com', icon: 'mdi-instagram' },
      { name: 'LinkedIn', url: 'https://www.linkedin.com', icon: 'mdi-linkedin' },
      { name: 'YouTube', url: 'https://www.youtube.com', icon: 'mdi-youtube' },
      { name: 'Pinterest', url: 'https://www.pinterest.com', icon: 'mdi-pinterest' },
      { name: 'TikTok', url: 'https://www.tiktok.com', icon: 'mdi-music' },
      { name: 'Snapchat', url: 'https://www.snapchat.com', icon: 'mdi-snapchat' }
    ]
  },
  {
    key: 'ecommerce',
    label: '运营电商平台',
    icon: 'mdi-storefront',
    links: [
      { name: '1688', url: 'https://www.1688.com', icon: 'mdi-shopping' },
      { name: '淘宝', url: 'https://www.taobao.com', icon: 'mdi-shopping' },
      { name: '天猫', url: 'https://www.tmall.com', icon: 'mdi-store' },
      { name: '京东', url: 'https://www.jd.com', icon: 'mdi-package' },
      { name: '拼多多', url: 'https://www.pinduoduo.com', icon: 'mdi-cart-variant' },
      { name: '抖店', url: 'https://fxg.jinritemai.com/ffa/mshop/homepage/index', icon: 'mdi-storefront' },
      { name: '抖店 开放平台', url: 'https://op.jinritemai.com/docs/center', icon: 'mdi-api' },
      { name: '快手小店', url: 'https://s.kwaixiaodian.com/zone/home', icon: 'mdi-storefront-outline' },
      { name: '快手电商 开放平台', url: 'https://open.kwaixiaodian.com/', icon: 'mdi-api' },
      { name: '咸鱼', url: 'https://www.goofish.com/publish', platform: 'xianyu', icon: 'mdi-shopping-outline' },
      { name: '苏宁易购', url: 'https://www.suning.com', icon: 'mdi-store-outline' },
      { name: '唯品会', url: 'https://www.vip.com', icon: 'mdi-tag' },
      { name: '当当', url: 'https://www.dangdang.com', icon: 'mdi-book-open' },
      { name: '国美', url: 'https://www.gome.com.cn', icon: 'mdi-home' }
    ]
  },
  {
    key: 'tools',
    label: '工具模块',
    icon: 'mdi-wrench',
    links: [
      { name: '连连付款', url: 'https://cn.lianlianpay.com/account', icon: 'mdi-credit-card-outline' }
    ]
  }
].map(category => ({
  ...category,
  links: category.links.map(link => ({
    ...link,
    logoUrl: getLogoUrl(link.url)
  }))
}))

const searchKeyword = ref('')
const imageErrors = ref<Set<string>>(new Set())

// 浏览器自动化服务状态
const uploaderStatus = ref<UploaderStatus>({ connected: false })
const browserStatus = ref<UploaderBrowserStatus | null>(null)
const pollInterval = ref<ReturnType<typeof setInterval> | null>(null)
const POLL_INTERVAL_MS = 3000

// 计算浏览器是否就绪
const browserReady = computed(() => {
  return uploaderStatus.value.connected && isUploaderBrowserReady(browserStatus.value)
})

// 刷新服务状态
async function refreshStatus(silent = false) {
  try {
    const statusRes = await checkUploaderStatus()
    uploaderStatus.value = statusRes

    if (statusRes.connected) {
      const browserRes = await getUploaderBrowserStatus()
      browserStatus.value = browserRes.success && browserRes.data ? browserRes.data : null
    } else {
      browserStatus.value = null
    }
  } catch (error) {
    if (!silent) {
      console.error('刷新状态失败:', error)
    }
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshStatus(true)
  }
}

const openLink = async (link: LinkItem) => {
  try {
    // 复制链接到剪贴板
    await navigator.clipboard.writeText(link.url)
    showToast({
      color: 'success',
      icon: 'mdi-content-copy',
      message: `已复制 ${link.name} 链接`
    })

    // 如果浏览器自动化服务可用，则在自动化浏览器中打开链接
    if (browserReady.value) {
      const result = await openUploaderLink(link.url)
      if (result.success) {
        showToast({
          color: 'success',
          icon: 'mdi-open-in-new',
          message: `已在浏览器中打开 ${link.name}`
        })
      } else {
        showToast({
          color: 'warning',
          icon: 'mdi-alert',
          message: result.message || `打开 ${link.name} 失败，请手动访问`
        })
      }
    } else {
      // 否则使用系统默认浏览器打开
      await window.api.openExternal(link.url)
      showToast({
        color: 'success',
        icon: 'mdi-open-in-new',
        message: `正在打开 ${link.name}`
      })
    }
  } catch (error) {
    console.error('打开链接失败:', error)
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `操作失败，请稍后重试`
    })
  }
}

const copyUrl = async (link: LinkItem, event: Event) => {
  event.stopPropagation()
  try {
    await navigator.clipboard.writeText(link.url)
    showToast({
      color: 'success',
      icon: 'mdi-content-copy',
      message: `已复制 ${link.name} 链接`
    })
  } catch (error) {
    console.error('复制链接失败:', error)
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle',
      message: '复制失败'
    })
  }
}

const filteredCategories = computed(() => {
  if (!searchKeyword.value.trim()) {
    return linkCategories
  }
  
  const keyword = searchKeyword.value.toLowerCase().trim()
  return linkCategories.map(category => {
    const filteredLinks = category.links.filter(link => 
      link.name.toLowerCase().includes(keyword) || 
      category.label.toLowerCase().includes(keyword)
    )
    return {
      ...category,
      links: filteredLinks
    }
  }).filter(category => category.links.length > 0)
})

// 处理图片加载失败的情况
const handleImageError = (event: Event, link: LinkItem) => {
  // 标记该链接的图片加载失败
  imageErrors.value.add(link.url)
  const img = event.target as HTMLImageElement
  if (img) {
    img.style.display = 'none'
  }
}

// 检查图片是否加载失败
const isImageError = (url: string) => {
  return imageErrors.value.has(url)
}

onMounted(() => {
  refreshStatus()
  pollInterval.value = setInterval(() => refreshStatus(true), POLL_INTERVAL_MS)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  if (pollInterval.value) {
    clearInterval(pollInterval.value)
    pollInterval.value = null
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="link-navigation-page">
    <div class="page-hero">
      <div class="hero-copy">
        <div class="eyebrow">链接导航</div>
        <h2 class="hero-title">常用平台快速访问</h2>
        <p class="hero-desc">
          一键打开自媒体平台、跨境电商、社交媒体和电商平台，提升工作效率。
        </p>
      </div>
    </div>

    <!-- 浏览器自动化服务状态提示 -->
    <el-alert
      v-if="browserReady"
      title="浏览器自动化服务已就绪"
      type="success"
      description="点击平台卡片可复制链接并在浏览器自动化服务中打开，点击复制图标仅复制链接"
      :closable="false"
      show-icon
    />
    <el-alert
      v-else-if="uploaderStatus.connected && !browserReady"
      title="浏览器未连接"
      type="warning"
      description="浏览器自动化服务已连接，但浏览器未启动。点击平台卡片将使用系统默认浏览器打开"
      :closable="false"
      show-icon
    />
    <el-alert
      v-else
      title="浏览器自动化服务未连接"
      type="info"
      description="点击平台卡片将使用系统默认浏览器打开链接"
      :closable="false"
      show-icon
    />

    <div class="search-section">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索平台名称..."
        size="large"
        clearable
        class="search-input"
      >
        <template #prefix>
          <i class="mdi mdi-magnify"></i>
        </template>
      </el-input>
    </div>

    <div class="categories-list">
      <el-card
        v-for="category in filteredCategories"
        :key="category.key"
        class="category-card"
        shadow="never"
      >
        <div class="category-header">
          <div class="category-title">
            <i :class="['mdi', category.icon]"></i>
            <span>{{ category.label }}</span>
          </div>
          <span class="category-count">{{ category.links.length }} 个平台</span>
        </div>

        <div class="links-list">
          <div
            v-for="link in category.links"
            :key="link.url"
            class="link-item"
            @click="openLink(link)"
          >
            <div class="link-icon">
              <img 
                v-if="link.logoUrl && !isImageError(link.url)" 
                :src="link.logoUrl" 
                :alt="link.name"
                @error="handleImageError($event, link)"
                class="link-logo"
              />
              <i 
                v-if="link.icon && (!link.logoUrl || isImageError(link.url))" 
                :class="['mdi', link.icon, 'fallback-icon']"
              ></i>
            </div>
            <div class="link-name">{{ link.name }}</div>
            <div class="link-actions">
              <el-button
                text
                size="small"
                @click="copyUrl(link, $event)"
                class="copy-btn"
                title="复制链接"
              >
                <i class="mdi mdi-content-copy"></i>
              </el-button>
              <i class="mdi mdi-open-in-new open-icon"></i>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <div v-if="filteredCategories.length === 0" class="empty-state">
      <i class="mdi mdi-magnify"></i>
      <p>未找到匹配的平台</p>
    </div>
  </div>
</template>

<style scoped>
.link-navigation-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-hero {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.eyebrow {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6366f1;
  font-weight: 700;
}

.hero-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
}

.hero-desc {
  margin: 0;
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
}

.search-section {
  margin-bottom: 8px;
}

.search-input {
  max-width: 400px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.categories-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-card {
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  transition: all 0.2s ease;
}

.category-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.category-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
  color: #111827;
}

.category-title i {
  color: #6366f1;
  font-size: 20px;
}

.category-count {
  font-size: 12px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 4px 10px;
  border-radius: 12px;
}

.links-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.link-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: #fafbff;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-width: 160px;
  flex: 0 0 auto;
}

.link-item:hover {
  background: #f0f4ff;
  border-color: #6366f1;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
}

.link-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #ffffff;
  color: #6366f1;
  flex-shrink: 0;
}

.link-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

.link-icon i.fallback-icon {
  font-size: 20px;
  display: block;
}

.link-name {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  flex: 1;
  white-space: nowrap;
}

.link-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.link-item:hover .link-actions {
  opacity: 1;
}

.copy-btn {
  padding: 4px 8px;
  min-height: unset;
  transition: all 0.2s ease;
}

.copy-btn:hover {
  background: rgba(99, 102, 241, 0.1);
}

.copy-btn i {
  font-size: 16px;
  color: #64748b;
}

.open-icon {
  font-size: 16px;
  color: #6366f1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #94a3b8;
  gap: 12px;
}

.empty-state i {
  font-size: 48px;
  color: #cbd5e1;
}

.empty-state p {
  font-size: 14px;
  margin: 0;
}

@media (max-width: 768px) {
  .link-item {
    min-width: 140px;
  }
}
</style>
