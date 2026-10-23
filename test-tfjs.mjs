import { env, AutoProcessor, Swin2SRForImageSuperResolution, RawImage } from '@xenova/transformers';
import fs from 'fs';
import https from 'https';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '.';
env.useFS = true;

const modelPath = 'test-models/realesr-general-x4v3';
const testImg = '/tmp/test-input.jpg';

if (!fs.existsSync(testImg)) {
  await new Promise((resolve, reject) => {
    const fetch = (url) => https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { fetch(res.headers.location); return; }
      res.pipe(fs.createWriteStream(testImg)).on('finish', resolve);
    }).on('error', reject);
    fetch('https://1s-1257307499.cos.ap-beijing.myqcloud.com/qiubiaoqing/_______________________/6820da099c11fgVg.jpeg');
  });
}

console.log('加载 processor...');
const processor = await AutoProcessor.from_pretrained(modelPath);
console.log('加载 model...');
const model = await Swin2SRForImageSuperResolution.from_pretrained(modelPath, { quantized: false });

const image = await RawImage.read(testImg);
console.log('输入尺寸:', image.width, 'x', image.height);

const inputs = await processor(image);
console.log('输入 tensor dims:', inputs.pixel_values.dims);
console.log('model session inputs:', model.session.inputNames);

// Real-ESRGAN 的 onnx 输入名是 'input'，不是 'pixel_values'，做映射
const feeds = {};
for (const name of model.session.inputNames) {
  feeds[name] = inputs.pixel_values;
}

const t0 = Date.now();
const outputs = await model(feeds);
console.log('推理耗时:', Date.now() - t0, 'ms');
console.log('model outputs keys:', Object.keys(outputs));

// 输出名可能是 'output' 或 'reconstruction'
const outputKey = model.session.outputNames[0];
const recon = outputs[outputKey];
console.log('输出 tensor dims:', recon.dims);

const out = recon.squeeze().clamp_(0, 1).mul_(255).round_().to('uint8');
let outImg = RawImage.fromTensor(out);
console.log('输出尺寸(含pad):', outImg.width, 'x', outImg.height);

// 裁回原图放大后的尺寸（去掉 padding 多出来的部分）
const targetW = image.width * 4;
const targetH = image.height * 4;
if (outImg.width !== targetW || outImg.height !== targetH) {
  outImg = await outImg.crop([0, 0, targetW, targetH]);
  console.log('裁回尺寸:', outImg.width, 'x', outImg.height);
}

await outImg.save('/tmp/test-tfjs-output.png');
console.log('已保存到 /tmp/test-tfjs-output.png');
process.exit(0);
