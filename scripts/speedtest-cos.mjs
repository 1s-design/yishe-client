#!/usr/bin/env node
/**
 * 测量到 COS 的实际上传速度
 * 用法：COS_SECRET_ID=xxx COS_SECRET_KEY=xxx COS_BUCKET=xxx COS_REGION=xxx node speedtest-cos.mjs
 */
import crypto from 'crypto';
import https from 'https';
import http from 'http';

const SECRET_ID = process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_SECRET_KEY;
const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;
const HOST = `${BUCKET}.cos.${REGION}.myqcloud.com`;

if (!SECRET_ID || !SECRET_KEY || !BUCKET || !REGION) {
  console.error('缺少环境变量 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION');
  process.exit(1);
}

function cosSign({ method, path: p, headers = {}, expires = 300 }) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now};${now + expires}`;
  const headerList = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  const httpString = `${method}\n${p}\n\n${Object.entries(headers).sort().map(([k,v])=>`${k.toLowerCase()}:${v}`).join('\n')}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signKey = crypto.createHmac('sha1', SECRET_KEY).update(keyTime).digest('hex');
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${SECRET_ID}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

function upload({ path: p, body, headers = {}, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const allHeaders = { host: HOST, ...headers, authorization: cosSign({ method: 'PUT', path: p, headers: { host: HOST, ...headers } }) };
    allHeaders['content-length'] = Buffer.byteLength(body);
    const start = Date.now();
    const req = https.request({ method: 'PUT', hostname: HOST, path: p, headers: allHeaders }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - start, body: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`TIMEOUT ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

console.log(`\n📡 测试上传到 COS: ${HOST}\n`);

// 1. 小文件 RTT 测试
const smallKey = `_speedtest/${Date.now()}-1KB.bin`;
const smallBody = Buffer.alloc(1024, 'x');
try {
  const r = await upload({ path: `/${smallKey}`, body: smallBody });
  console.log(`1KB 上传: ${r.ms}ms (HTTP ${r.status})`);
} catch (e) {
  console.log(`1KB 上传失败: ${e.message}`);
}

// 2. 1MB 测试
const mbKey = `_speedtest/${Date.now()}-1MB.bin`;
const mbBody = Buffer.alloc(1024 * 1024, 'y');
try {
  const r = await upload({ path: `/${mbKey}`, body: mbBody, timeoutMs: 60000 });
  const mb = (1024*1024 / (1024*1024));
  const mbps = (mb * 8) / (r.ms / 1000);
  console.log(`1MB 上传: ${r.ms}ms ≈ ${mbps.toFixed(1)} Mbps (${(mb).toFixed(2)} MB/s)`);
  // 预估 300MB 时间
  const est300 = (300 / (mb * 8 / (r.ms/1000) / 8)).toFixed(0);
  console.log(`   → 预估 300MB 上传耗时: ~${est300}s (${(est300/60).toFixed(1)} 分钟)`);
} catch (e) {
  console.log(`1MB 上传失败: ${e.message}`);
}

// 3. 清理
for (const k of [smallKey, mbKey]) {
  try {
    const allHeaders = { host: HOST, authorization: cosSign({ method: 'DELETE', path: `/${k}`, headers: { host: HOST } }) };
    await new Promise((resolve, reject) => {
      const req = https.request({ method: 'DELETE', hostname: HOST, path: `/${k}`, headers: allHeaders }, (res) => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve());
      });
      req.on('error', reject); req.end();
    });
  } catch {}
}
console.log('\n✅ 测试完成\n');
