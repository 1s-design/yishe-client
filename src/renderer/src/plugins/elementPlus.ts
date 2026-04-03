import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'

import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import type { App } from 'vue'

export function setupElementPlus(app: App) {
  app.use(ElementPlus, {
    locale: zhCn
  })

  // 全局注册图标，方便在模板中直接使用 <ElIcon><HomeFilled /></ElIcon> 等
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }
}


