# yishe-electron

An Electron application with Vue and TypeScript

## 开发调试

### 浏览器调试

#### Windows
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\work"
```

#### macOS
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/Users/jackie/work"
```

### 应用图标生成
```bash
npx electron-icon-builder --input=resources/icon.png --output=build
```

## 开发环境配置

### 推荐的IDE设置
- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## 项目设置

### 安装依赖
```bash
$ npm install
```

### 开发环境运行
```bash
$ npm run dev
```

### 构建应用
```bash
# Windows版本
$ npm run build:win

# macOS版本
$ npm run build:mac

# Linux版本
$ npm run build:linux
```
