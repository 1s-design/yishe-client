import "./assets/main.less";
import "./assets/element-theme.css";

import { createApp } from "vue";
import App from "./App.vue";
import { setupElementPlus } from "./plugins/elementPlus";

const app = createApp(App);

// 全局注册 Element Plus，UI 统一使用 Element Plus 组件
setupElementPlus(app);

app.mount("#app");
