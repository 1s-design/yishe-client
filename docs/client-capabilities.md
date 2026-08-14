# 衣设客户端 — 通用能力清单

> 本文档梳理客户端具备但服务端无法实现的通用能力，供 MCP Server 和工作流节点调用。
> 核心原则：**客户端拥有本地资源访问权限（文件系统、设备、登录态、本地应用），这是服务端永远无法替代的。**

---

## 一、本地文件系统

### 1.1 文件读写

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 读取文件 | 读取本地文件内容（文本/二进制） | `file_read(path, encoding?)` |
| 写入文件 | 写入内容到本地路径 | `file_write(path, content, options?)` |
| 删除文件 | 删除指定文件 | `file_delete(path)` |
| 复制/移动文件 | 文件复制或移动 | `file_copy(src, dest)` / `file_move(src, dest)` |
| 文件信息 | 获取文件大小/修改时间/类型等 | `file_stat(path)` |

### 1.2 目录操作

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 列出目录 | 遍历目录下的文件和子目录 | `dir_list(path, options?)` |
| 创建目录 | 递归创建目录 | `dir_create(path)` |
| 删除目录 | 递归删除目录 | `dir_delete(path)` |
| 查找文件 | 按模式/glob 搜索文件 | `file_find(pattern, dir?)` |

### 1.3 批量处理

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 批量重命名 | 按规则批量重命名文件 | `file_batch_rename(files, pattern)` |
| 批量复制/移动 | 批量操作 | `file_batch_copy(items)` |
| 目录同步 | 两个目录增量同步 | `dir_sync(src, dest, options?)` |
| 计算哈希 | 文件 MD5/SHA256 | `file_hash(path, algorithm)` |

### 1.4 文件监听

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 监听目录 | 监听文件新增/修改/删除事件 | `file_watch(path, events, callback)` |
| 停止监听 | 取消监听 | `file_unwatch(watcherId)` |

---

## 二、剪贴板

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 读取文本 | 读取剪贴板文本内容 | `clipboard_read_text()` |
| 写入文本 | 写入文本到剪贴板 | `clipboard_write_text(text)` |
| 读取图片 | 读取剪贴板图片（返回 base64/路径） | `clipboard_read_image()` |
| 写入图片 | 写入图片到剪贴板 | `clipboard_write_image(data)` |
| 读取文件列表 | 读取剪贴板中的文件路径 | `clipboard_read_files()` |
| 清空剪贴板 | 清空当前剪贴板 | `clipboard_clear()` |

---

## 三、系统通知与交互

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 系统通知 | 发送操作系统级通知 | `notify(title, body, options?)` |
| 通知权限检测 | 检查是否有通知权限 | `notify_check_permission()` |
| 请求通知权限 | 向用户请求通知权限 | `notify_request_permission()` |
| 对话框 | 显示原生消息框/确认框 | `dialog_show(message, options?)` |
| 文件选择框 | 唤起系统文件选择器 | `dialog_open_file(filters?)` |
| 目录选择框 | 唤起系统目录选择器 | `dialog_open_dir()` |
| 保存文件框 | 唤起保存文件对话框 | `dialog_save_file(defaultName?)` |

---

## 四、本地数据库 / 存储

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 读取 KV | 读取 electron-store 中的任意 key | `store_get(key)` |
| 写入 KV | 写入 electron-store | `store_set(key, value)` |
| 删除 KV | 删除指定 key | `store_delete(key)` |
| 列出所有 key | 列出存储的所有键 | `store_keys()` |
| 查询本地 SQLite | 执行本地数据库查询 | `db_query(sql, params?)` |
| 执行 SQL | 执行写操作 | `db_execute(sql, params?)` |

---

## 五、系统信息与环境

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 系统信息 | OS/CPU/内存/磁盘等 | `sys_info()` |
| 屏幕分辨率 | 显示器分辨率/缩放比 | `sys_screen_info()` |
| 本地 IP | 获取本机 IP 地址 | `sys_local_ip()` |
| MAC 地址 | 获取网卡 MAC | `sys_mac_address()` |
| 环境变量 | 读取环境变量 | `sys_env(key?)` |
| 工作目录 | 获取/设置客户端工作目录 | `sys_workspace_dir()` |

---

## 六、字体

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 枚举字体 | 获取系统安装的所有字体列表 | `font_list()` |
| 字体详情 | 获取字体详细信息（家族/样式/路径） | `font_detail(family)` |
| 安装字体 | 安装本地字体文件 | `font_install(path)` |
| 字体预览 | 生成字体预览图 | `font_preview(text, family, options?)` |

---

## 七、网络诊断

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| Ping | 检测目标可达性和延迟 | `net_ping(host, count?)` |
| HTTP 探测 | 检测 URL 可达性和状态码 | `net_http_check(url, options?)` |
| 端口检测 | 检测本地或远程端口是否开放 | `net_port_check(host, port)` |
| DNS 解析 | 解析域名对应 IP | `net_dns_resolve(host)` |
| 网速测试 | 粗略估算当前网速 | `net_speed_test()` |
| 本地服务发现 | 扫描本地运行的服务端口 | `net_local_services()` |

---

## 八、屏幕与媒体采集

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 屏幕截图 | 截取指定显示器全屏 | `screen_capture(displayId?)` |
| 区域截图 | 截取屏幕指定区域 | `screen_capture_area(x, y, w, h)` |
| 窗口截图 | 截取指定窗口 | `screen_capture_window(windowId)` |
| 屏幕录制 | 录制屏幕为视频文件 | `screen_record(options?)` |
| 停止录制 | 停止当前录制 | `screen_record_stop(recordingId)` |
| 摄像头快照 | 拍摄一张摄像头照片 | `camera_capture()` |
| 音频录制 | 录制麦克风音频 | `audio_record(duration, options?)` |
| 停止音频录制 | 停止录制 | `audio_record_stop(recordingId)` |
| 列出视频设备 | 枚举摄像头/麦克风 | `media_enumerate_devices()` |

---

## 九、打印

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 列出打印机 | 获取系统打印机列表 | `printer_list()` |
| 打印文件 | 打印指定文件（图片/PDF） | `print_file(path, options?)` |
| 打印图片 | 打印图片并设置尺寸 | `print_image(path, options?)` |
| 打印机状态 | 获取打印机状态/墨水/纸张 | `printer_status(printerId)` |

---

## 十、浏览器（已有能力增强）

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| Cookie 读取 | 读取指定域名的 Cookie | `browser_get_cookies(domain)` |
| Cookie 写入 | 设置 Cookie | `browser_set_cookie(cookie)` |
| LocalStorage | 读取页面 localStorage | `browser_get_storage(url, key)` |
| SessionStorage | 读取 sessionStorage | `browser_get_session_storage(url, key)` |
| 导出 HAR | 导出页面网络请求为 HAR | `browser_export_har(url)` |
| Lighthouse | 运行页面性能检测 | `browser_lighthouse(url, categories?)` |
| 多 Profile | 列出/创建/切换浏览器身份 | `browser_profiles(action, ...)` |
| PDF 导出 | 将网页导出为 PDF | `browser_print_to_pdf(url, options?)` |
| 设置 UA | 设置自定义 User-Agent | `browser_set_ua(ua)` |
| 设置视口 | 设置浏览器窗口尺寸 | `browser_set_viewport(w, h)` |
| 拦截请求 | 设置网络请求拦截规则 | `browser_intercept(pattern, handler)` |

---

## 十一、应用生命周期

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 重启应用 | 重启客户端 | `app_restart()` |
| 检查更新 | 手动触发更新检查 | `app_check_update()` |
| 应用版本 | 获取当前版本号 | `app_version()` |
| 打开外部链接 | 用系统默认浏览器打开 | `app_open_external(url)` |
| 打开本地文件 | 用系统默认程序打开 | `app_open_path(path)` |
| 显示在 Finder/资源管理器 | 在文件管理器中高亮显示 | `app_show_in_folder(path)` |
| 退出应用 | 退出客户端 | `app_quit()` |

---

## 十二、图片处理（已有，补充分发能力）

| 能力 | 说明 | 方法签名 |
|------|------|----------|
| 图片信息 | 获取图片尺寸/格式/EXIF | `image_info(path)` |
| 格式转换 | 图片格式互转（png/webp/jpg/avif等） | `image_convert(src, format, quality?)` |
| 批量处理 | 对目录下多张图执行相同操作 | `image_batch_process(dir, operations)` |
| 图片压缩 | 有损/无损压缩 | `image_compress(path, quality, options?)` |
| 生成缩略图 | 生成指定尺寸缩略图 | `image_thumbnail(path, w, h, options?)` |

---

## 架构建议

```
┌─────────────────────────────────────────────────┐
│              外部调用方                           │
│   MCP Server (:3210)  │  Workflow Nodes │ Agent  │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│            Client Capability Registry            │
│  (统一注册/发现/路由/鉴权)                         │
├─────────────────────────────────────────────────┤
│ filesystem │ clipboard │ notify │ store │ sysinfo│
│ font       │ network   │ screen │ print │ browser│
│ image      │ app       │ media  │ db    │        │
└─────────────────────────────────────────────────┘
```

### 设计原则

1. **能力注册制** — 每个能力注册为独立 capability，声明 name/schema/权限级别
2. **统一暴露** — 注册后自动暴露到 MCP + REST + WebSocket
3. **权限分级** — 读取类（低风险）/ 写入类（中风险）/ 系统类（高风险，需用户确认）
4. **沙箱隔离** — 敏感操作（文件删除/系统命令）支持白名单限制
5. **能力发现** — 运行时动态发现可用能力，支持能力查询接口

### 接口规范

```typescript
interface ClientCapability {
  name: string;              // 唯一标识，如 "file_read"
  namespace: string;         // 命名空间，如 "filesystem"
  description: string;       // 人类可读描述
  inputSchema: JSONSchema;   // Zod → JSON Schema
  riskLevel: 'read' | 'write' | 'system';
  handler: (args: any) => Promise<CapabilityResult>;
}

interface CapabilityResult {
  success: boolean;
  data?: any;
  error?: string;
}
```

---

## 实现优先级

| 优先级 | 类别 | 理由 |
|--------|------|------|
| P0 | 文件系统 + 剪贴板 | 几乎所有工作流的基础依赖 |
| P0 | 系统通知 + 对话框 | 工作流状态反馈的标准方式 |
| P1 | 系统信息 + 存储读取 | Agent 决策需要知道环境上下文 |
| P1 | 浏览器 Cookie/Storage | 让 AI 能利用已有的登录态 |
| P1 | 应用生命周期 | 基础控制能力 |
| P2 | 屏幕截图/录制 | 视觉类工作流的核心输入 |
| P2 | 字体枚举 | 设计类工作流的前置条件 |
| P2 | 网络诊断 | 排障/健康检查场景 |
| P3 | 打印 | 特定场景（标签/合同打印） |
| P3 | 摄像头/麦克风 | 多媒体采集，安全敏感 |
| P3 | 本地数据库查询 | 需要定义可查询范围 |

