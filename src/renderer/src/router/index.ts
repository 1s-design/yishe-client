import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: {
      title: '仪表盘',
      description: '系统运行概览与快速入口'
    }
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('../views/Tasks.vue'),
    meta: {
      title: '任务管理',
      description: '集中管理批量任务与执行情况'
    }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/Settings.vue'),
    meta: {
      title: '系统设置',
      description: '维护系统参数与设备配置'
    }
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('../views/Logs.vue'),
    meta: {
      title: '日志查看',
      description: '追踪运行日志与异常信息'
    }
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/About.vue'),
    meta: {
      title: '关于',
      description: '查看客户端版本信息'
    }
  },
  {
    path: '/local-service',
    name: 'local-service',
    component: () => import('../views/LocalService.vue'),
    meta: {
      title: '本地服务',
      description: '管理 1519 端口本地服务的启动与停止'
    }
  },
  {
    path: '/platform-publish',
    name: 'platform-publish',
    component: () => import('../views/PlatformPublish.vue'),
    meta: {
      title: '浏览器自动化服务',
      description: '连接并管理浏览器自动化服务，支持多平台发布、表单填充、信息采集等自动化任务'
    }
  },
  {
    path: '/product',
    name: 'product',
    component: () => import('../views/Product.vue'),
    meta: {
      title: '商品管理',
      description: '查看和管理商品列表'
    }
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router

