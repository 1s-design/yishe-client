import sharp from 'sharp';
import { upscaleImage } from '/Users/jackie/workspace/yishe-client/src/main/image-tool/ai-upscale/inference.ts';
import { getSession } from '/Users/jackie/workspace/yishe-client/src/main/image-tool/ai-upscale/inference.ts';
import { getUpscaleModel } from '/Users/jackie/workspace/yishe-client/src/main/image-tool/ai-upscale/models.ts';
import { getModelPath } from '/Users/jackie/workspace/yishe-client/src/main/image-tool/ai-upscale/model-cache.ts';
import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';

// 下载测试图
const TEST_URL = 'https://1s-1257307499.cos.ap-beijing.myqcloud.com/qiubiaoqing/_______________________/6820da099c11fgVg.jpeg';
const INPUT = '/tmp/swin-test-input.jpg';
const OUTPUT = '/tmp/swin-test-output.png';

if (!fs.existsSync(INPUT)) {
  console.log('Downloading test image...');
  await new Promise<void>((resolve, reject) => {
    fetch(TEST_URL).then(r => r.arrayBuffer()).then(buf => {
      fs.writeFileSync(INPUT, Buffer.from(buf));
      resolve();
    }).catch(reject);
  });
}

const img = await sharp(INPUT).metadata();
console.log(`Input: ${img.width}x${img.height}`);

// 用模型路径绝对定位（随包分发）
const MODEL_BASE = '/Users/jackie/workspace/yishe-client/resources/ai-upscale-models';

// 测试 4 个 Swin2SR 模型
const SWIN_MODELS = [
  'swin2sr-lightweight-x2',
  'swin2sr-classical-x4',
  'swin2sr-realworld-x4',
  'swin2sr-compressed-x4',
];

for (const mid of SWIN_MODELS) {
  const model = getUpscaleModel(mid);
  const modelPath = path.join(MODEL_BASE, model.file);
  if (!fs.existsSync(modelPath)) {
    console.log(`SKIP ${mid}: model file not found at ${modelPath}`);
    continue;
  }
  console.log(`\n==== ${mid} (align=${model.align}, tileSize=${model.tileSize}) ====`);
  const t0 = Date.now();
  try {
    const session = await getSession(modelPath);
    const outPath = `/tmp/swin-${mid}-out.png`;
    await upscaleImage(session, model, INPUT, outPath);
    const outMeta = await sharp(outPath).metadata();
    const t1 = Date.now();
    console.log(`✅ PASS: ${outMeta.width}x${outMeta.height}, ${Math.round((t1-t0)/1000)}s`);
  } catch (e: any) {
    console.log(`❌ FAIL: ${e.message?.slice(0, 100)}`);
  }
}

// 也验证 real-esrgan 模型没被改坏
const OTHER_MODELS = [
  'realesr-general-x4v3',
  'real-esrgan-x4plus',
  'real-cugan-2x',
];
console.log('\n==== Non-Swin2SR regression ====');
for (const mid of OTHER_MODELS) {
  const model = getUpscaleModel(mid);
  const modelPath = path.join(MODEL_BASE, model.file);
  if (!fs.existsSync(modelPath)) continue;
  const t0 = Date.now();
  try {
    const session = await getSession(modelPath);
    const outPath = `/tmp/test-${mid}-out.png`;
    await upscaleImage(session, model, INPUT, outPath);
    const outMeta = await sharp(outPath).metadata();
    const t1 = Date.now();
    console.log(`✅ ${mid}: ${outMeta.width}x${outMeta.height}, ${Math.round((t1-t0)/1000)}s`);
  } catch (e: any) {
    console.log(`❌ ${mid}: ${e.message?.slice(0, 100)}`);
  }
}
