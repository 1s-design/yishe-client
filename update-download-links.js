#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 读取package.json获取当前版本
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

// 更新index.html中的下载链接
function updateDownloadLinks(version) {
  const indexPath = path.join('page', 'index.html');
  let content = fs.readFileSync(indexPath, 'utf8');
  
  // 更新Windows下载链接
  content = content.replace(
    /https:\/\/github\.com\/chan-max\/yishe-client\/releases\/latest\/download\/yishe-client\.exe/g,
    `https://github.com/chan-max/yishe-client/releases/download/v${version}/yishe-client-${version}.exe`
  );
  
  // 更新macOS下载链接
  content = content.replace(
    /https:\/\/github\.com\/chan-max\/yishe-client\/releases\/latest\/download\/yishe-client\.dmg/g,
    `https://github.com/chan-max/yishe-client/releases/download/v${version}/yishe-client-${version}.dmg`
  );
  
  // 更新LastEditTime
  const now = new Date();
  const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
  content = content.replace(
    /@LastEditTime: .*/,
    `@LastEditTime: ${formattedDate}`
  );
  
  fs.writeFileSync(indexPath, content, 'utf8');
  console.log(`✅ 已更新 ${indexPath} 中的下载链接到版本 v${version}`);
}

// 更新GitHub Actions部署配置
function updateDeployConfig(version) {
  const deployPath = path.join('.github', 'workflows', 'deploy-page.yml');
  let content = fs.readFileSync(deployPath, 'utf8');
  
  // 更新飞书通知中的版本信息
  content = content.replace(
    /版本: .*/,
    `版本: v${version}`
  );
  
  // 添加版本信息到部署消息
  const versionInfo = `版本: v${version}\n`;
  const messageIndex = content.indexOf('项目: ${{ github.repository }}');
  if (messageIndex !== -1) {
    content = content.replace(
      /项目: \${{ github\.repository }}/,
      `${versionInfo}项目: \${{ github.repository }}`
    );
  }
  
  fs.writeFileSync(deployPath, content, 'utf8');
  console.log(`✅ 已更新 ${deployPath} 中的版本信息到 v${version}`);
}

// 创建版本更新记录
function createVersionLog(version) {
  const logPath = 'VERSION_LOG.md';
  let logContent = '';
  
  if (fs.existsSync(logPath)) {
    logContent = fs.readFileSync(logPath, 'utf8');
  }
  
  const now = new Date();
  const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
  
  const newEntry = `## v${version} - ${formattedDate}

- 更新下载页面链接到版本 v${version}
- Windows: yishe-client-${version}.exe
- macOS: yishe-client-${version}.dmg

---

`;
  
  logContent = newEntry + logContent;
  fs.writeFileSync(logPath, logContent, 'utf8');
  console.log(`✅ 已创建版本更新记录到 ${logPath}`);
}

// 主函数
function main() {
  try {
    const version = getCurrentVersion();
    console.log(`🚀 开始更新下载链接到版本 v${version}...`);
    
    updateDownloadLinks(version);
    updateDeployConfig(version);
    createVersionLog(version);
    
    console.log(`\n🎉 所有文件已更新完成！`);
    console.log(`📦 当前版本: v${version}`);
    console.log(`📝 请确保在GitHub上创建对应的release: v${version}`);
    console.log(`🔗 Windows: https://github.com/chan-max/yishe-client/releases/download/v${version}/yishe-client-${version}.exe`);
    console.log(`🔗 macOS: https://github.com/chan-max/yishe-client/releases/download/v${version}/yishe-client-${version}.dmg`);
    
  } catch (error) {
    console.error('❌ 更新失败:', error.message);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { getCurrentVersion, updateDownloadLinks, updateDeployConfig, createVersionLog }; 