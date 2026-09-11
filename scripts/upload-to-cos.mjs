#!/usr/bin/env node
/**
 * 腾讯云 COS 分片并发上传脚本 (专门用于 CI/CD 构建产物发布)
 *
 * 特性：
 * 1. 使用 cos-nodejs-sdk-v5 的 uploadFile，底层自动开启 Multipart 分片切片上传
 * 2. 支持分片并发传输、单片失败自动重试，绝不会像 putObject 单连接那样无限卡死
 * 3. 详细进度与瞬时速度实时汇报（节流输出，防止日志刷屏）
 * 4. 连通性预检与详尽的错误诊断提示（密钥、存储桶、网络各阶段清晰日志）
 * 5. 服务端零流量快速创建 latest.exe / latest.dmg 别名副本
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import COS from 'cos-nodejs-sdk-v5';

// 1. 读取并校验环境变量
const SECRET_ID = process.env.TENCENT_SECRET_ID || process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || process.env.COS_SECRET_KEY;
const BUCKET = process.env.TENCENT_COS_BUCKET || process.env.COS_BUCKET;
const REGION = process.env.TENCENT_COS_REGION || process.env.COS_REGION;
const REMOTE_PATH = (process.env.COS_REMOTE_PATH || 'yishe-client').replace(/^\/+|\/+$/g, '');

// 分片大小：跨洋网络推荐 2MB（丢包恢复极快），分片并发数：推荐 8 并发
const SLICE_SIZE = parseInt(process.env.COS_SLICE_SIZE, 10) || 2 * 1024 * 1024;
const ASYNC_LIMIT = parseInt(process.env.COS_ASYNC_LIMIT, 10) || 8;
const RETRY_LIMIT = 3;

function printHeader() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 腾讯云 COS 分片并发上传脚本 (yishe-client)');
  console.log('='.repeat(80));
}

function maskSecret(val) {
  if (!val) return '(未配置)';
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0s';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

// 检查环境变量完整性
function validateEnv() {
  console.log('\n[阶段 1/4] 📋 环境变量与基础配置检查...');
  const missing = [];
  if (!SECRET_ID) missing.push('TENCENT_SECRET_ID (或 COS_SECRET_ID)');
  if (!SECRET_KEY) missing.push('TENCENT_SECRET_KEY (或 COS_SECRET_KEY)');
  if (!BUCKET) missing.push('TENCENT_COS_BUCKET (或 COS_BUCKET)');
  if (!REGION) missing.push('TENCENT_COS_REGION (或 COS_REGION)');

  if (missing.length > 0) {
    console.error(`\n❌ [配置缺失] 缺少以下环境变量，无法上传到 COS:`);
    missing.forEach((item) => console.error(`   - ${item}`));
    console.error('\n👉 请在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置。');
    process.exit(1);
  }

  console.log(`  - 目标存储桶: ${BUCKET}`);
  console.log(`  - 存储桶所属地域: ${REGION}`);
  console.log(`  - Secret ID: ${maskSecret(SECRET_ID)}`);
  console.log(`  - Secret Key: ${maskSecret(SECRET_KEY)}`);
  console.log(`  - 远程上传根目录: /${REMOTE_PATH}/`);
  console.log(`  - 单个分片大小: ${formatBytes(SLICE_SIZE)} | 分片并发数: ${ASYNC_LIMIT}`);
  console.log('  ✅ 环境变量校验通过');
}

// 预检网络与 Bucket 连通性
async function probeConnectivity() {
  console.log('\n[阶段 2/4] 🌐 测试与腾讯云 COS Endpoint 的网络连通性...');
  const endpoint = `https://${BUCKET}.cos.${REGION}.myqcloud.com`;
  console.log(`  - 探测地址: ${endpoint}`);

  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = https.request(
      endpoint,
      { method: 'HEAD', timeout: 8000 },
      (res) => {
        const elapsed = Date.now() - startTime;
        console.log(`  - 响应状态码: HTTP ${res.statusCode} (耗时: ${elapsed}ms)`);
        if (res.statusCode === 403 || res.statusCode === 200) {
          console.log(`  ✅ COS Endpoint 网络通畅且存储桶存在 (HTTP ${res.statusCode})`);
          resolve(true);
        } else if (res.statusCode === 404) {
          console.warn(`  ⚠️ 连通探测返回 HTTP 404：腾讯云提示存储桶不存在！`);
          console.warn(`  👉 请重点核对：`);
          console.warn(`     1) BUCKET 是否漏填了 10 位 APPID 后缀 (格式如: yishe-storage-1257307499)`);
          console.warn(`     2) REGION 是否与 Bucket 真实地域匹配 (如 ap-beijing / ap-guangzhou)`);
          resolve(true);
        } else {
          console.warn(`  ⚠️ 响应状态码: HTTP ${res.statusCode}，仍将尝试上传`);
          resolve(true);
        }
      }
    );

    req.on('timeout', () => {
      req.destroy();
      console.error('  ❌ 连通性探测超时 (8 秒未收到任何响应)');
      console.error('  👉 可能原因: 1) Region 拼写错误; 2) 海外 Runner 到该 Bucket 地域路由被阻断');
      resolve(false);
    });

    req.on('error', (err) => {
      console.error(`  ❌ 连通性探测失败: ${err.message}`);
      if (err.code === 'ENOTFOUND') {
        console.error('  👉 DNS 解析失败，请仔细核对 BUCKET 和 REGION 名称是否拼写正确。');
      }
      resolve(false);
    });

    req.end();
  });
}

// 扫描查找待发布的产物文件
function discoverArtifacts() {
  console.log('\n[阶段 3/4] 🔍 扫描待发布的构建产物...');
  const searchDirs = [
    path.resolve('release/mac'),
    path.resolve('release/windows'),
    path.resolve('release'),
  ];

  // 严格精简发布清单：仅上传 3 个核心必要文件，彻底剔除无用的 zip (240MB+)、blockmap 与冗余清单
  const targetFilenames = [
    'latest.yml',        // Windows 客户端自动检测升级元数据清单 (300B)
    'yishe-client.exe',  // Windows 客户端安装程序 (198MB)
    'yishe-client.dmg',  // macOS 客户端安装程序 (246MB)
  ];

  const discovered = new Map();

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (targetFilenames.includes(entry.name) && !discovered.has(entry.name)) {
        const fullPath = path.join(dir, entry.name);
        const stats = fs.statSync(fullPath);
        if (stats.size > 0) {
          discovered.set(entry.name, {
            localPath: fullPath,
            size: stats.size,
            isLarge: stats.size > 10 * 1024 * 1024,
          });
        }
      }
    }
  }

  if (discovered.size === 0) {
    console.error('❌ 未在 release/ 目录中找到任何有效安装包或 yml 清单文件！');
    console.error('请确认构建或下载 artifact 步骤是否已成功输出安装包。');
    process.exit(1);
  }

  console.log(`  找到 ${discovered.size} 个待发布文件:`);
  for (const [name, info] of discovered.entries()) {
    console.log(`   - ${name.padEnd(28)} 大小: ${formatBytes(info.size).padStart(10)} (${info.localPath})`);
  }

  return discovered;
}

// 单文件上传执行器（含分片切片、实时节流进度、自动重试）
async function uploadSingleFile(cos, fileName, fileInfo) {
  const remoteKey = `${REMOTE_PATH}/${fileName}`;
  const totalSize = fileInfo.size;
  const isLarge = fileInfo.isLarge;

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`\n🔄 [${fileName}] 正在进行第 ${attempt}/${RETRY_LIMIT} 次重试...`);
      }

      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`📦 开始上传: ${fileName}`);
      console.log(`  - 本地路径: ${fileInfo.localPath}`);
      console.log(`  - 文件大小: ${formatBytes(totalSize)} ${isLarge ? `(已启用分片并发切片)` : `(普通上传)`}`);
      console.log(`  - 目标位置: cos://${BUCKET}/${remoteKey}`);
      console.log(`--------------------------------------------------------------------------------`);

      const startTime = Date.now();
      let lastLoggedPercent = -1;
      let lastLoggedTime = 0;

      const result = await new Promise((resolve, reject) => {
        cos.uploadFile(
          {
            Bucket: BUCKET,
            Region: REGION,
            Key: remoteKey,
            FilePath: fileInfo.localPath,
            SliceSize: SLICE_SIZE,
            AsyncLimit: ASYNC_LIMIT,
            onProgress: (progressData) => {
              const now = Date.now();
              const percent = progressData.percent;
              const loaded = progressData.loaded;
              const total = progressData.total || totalSize;
              const speed = progressData.speed || 0; // 字节/秒

              // 节流输出：进度增加超过 5% 或者距离上次输出超过 3.5 秒
              if (
                percent - lastLoggedPercent >= 0.05 ||
                now - lastLoggedTime >= 3500 ||
                percent === 1
              ) {
                lastLoggedPercent = percent;
                lastLoggedTime = now;

                const percentStr = (percent * 100).toFixed(1).padStart(5, ' ') + '%';
                const loadedStr = formatBytes(loaded).padStart(9, ' ');
                const totalStr = formatBytes(total).padStart(9, ' ');
                const speedStr = (formatBytes(speed) + '/s').padStart(11, ' ');
                const elapsedSec = (now - startTime) / 1000;
                const remainingSec = speed > 0 ? (total - loaded) / speed : 0;

                const timeStr = `已用: ${formatTime(elapsedSec).padEnd(6)} | 预估剩余: ${formatTime(remainingSec)}`;

                console.log(
                  `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ⏳ [${fileName}] ${percentStr} | ${loadedStr} / ${totalStr} | 速度: ${speedStr} | ${timeStr}`
                );
              }
            },
          },
          (err, data) => {
            if (err) return reject(err);
            resolve(data);
          }
        );
      });

      const totalElapsed = (Date.now() - startTime) / 1000;
      const avgSpeed = totalSize / Math.max(totalElapsed, 0.001);
      const publicUrl = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${remoteKey}`;

      console.log(`✅ [${fileName}] 上传成功! 耗时: ${formatTime(totalElapsed)} | 平均速度: ${formatBytes(avgSpeed)}/s`);
      console.log(`   Remote URL: ${publicUrl}`);

      return {
        fileName,
        size: totalSize,
        elapsed: totalElapsed,
        url: publicUrl,
        success: true,
      };
    } catch (error) {
      console.error(`\n❌ [${fileName}] 第 ${attempt} 次上传失败: ${error.message || error}`);
      if (error.statusCode) {
        console.error(`   HTTP Status: ${error.statusCode} | Error Code: ${error.code || 'N/A'}`);
        console.error(`   Request ID: ${error.requestId || 'N/A'}`);
      }

      // 常见问题诊断提示
      if (error.code === 'InvalidSecretId' || error.code === 'SignatureDoesNotMatch') {
        console.error('   👉 [诊断] 密钥 SecretId 或 SecretKey 无效，请重新核对 GitHub Secrets。');
        throw error; // 密钥错误不重试
      }
      if (error.code === 'NoSuchBucket') {
        console.error(`   👉 [诊断] 存储桶不存在。请检查 BUCKET "${BUCKET}" 是否拼写正确（是否带 appid）。`);
        throw error;
      }
      if (error.code === 'AccessDenied') {
        console.error('   👉 [诊断] 访问被拒绝。请确认该密钥拥有 COS 的写权限 (PutObject, MultipartUpload)。');
        throw error;
      }

      if (attempt >= RETRY_LIMIT) {
        throw error;
      }

      console.log('   等待 3 秒后重试分片上传...');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// 主执行函数
async function main() {
  printHeader();
  validateEnv();
  await probeConnectivity();

  const artifacts = discoverArtifacts();

  console.log('\n[阶段 4/4] 🚀 开始执行分片并发上传...');
  const cos = new COS({
    SecretId: SECRET_ID,
    SecretKey: SECRET_KEY,
    Timeout: 60000, // 60 秒 Socket 超时
  });

  const uploadResults = [];
  const overallStartTime = Date.now();

  // 按小文件优先、大文件在后的顺序上传
  const sortedFiles = Array.from(artifacts.entries()).sort((a, b) => a[1].size - b[1].size);

  for (const [fileName, fileInfo] of sortedFiles) {
    try {
      const res = await uploadSingleFile(cos, fileName, fileInfo);
      uploadResults.push(res);
    } catch (err) {
      console.error(`\n❌ 发布流程中断: 文件 ${fileName} 上传失败！`);
      process.exit(1);
    }
  }

  const allResults = uploadResults;
  const overallElapsed = (Date.now() - overallStartTime) / 1000;
  const totalUploadedBytes = uploadResults.reduce((acc, cur) => acc + (cur.size || 0), 0);

  // 汇总报表
  console.log('\n' + '='.repeat(80));
  console.log('🎉 腾讯云 COS 分片并发发布完成！报表如下：');
  console.log('='.repeat(80));
  console.log(
    '文件名'.padEnd(28) +
    '大小'.padStart(10) +
    '耗时'.padStart(10) +
    '状态'.padStart(8) +
    '   访问直链'
  );
  console.log('-'.repeat(80));

  for (const item of allResults) {
    console.log(
      item.fileName.padEnd(28) +
      formatBytes(item.size).padStart(10) +
      formatTime(item.elapsed).padStart(10) +
      (item.success ? '  ✅ 成功' : '  ❌ 失败') +
      '   ' + item.url
    );
  }

  console.log('-'.repeat(80));
  console.log(`总传输文件: ${uploadResults.length} 个 | 传输量: ${formatBytes(totalUploadedBytes)} | 总耗时: ${formatTime(overallElapsed)}`);
  console.log('='.repeat(80) + '\n');
}

main().catch((err) => {
  console.error('\n💥 发生未捕获异常:', err);
  process.exit(1);
});
