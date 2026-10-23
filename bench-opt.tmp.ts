import * as ort from 'onnxruntime-node';
import path from 'path';

const dir = '/Users/jackie/workspace/yishe-client/resources/ai-upscale-models';
const files = ['real-esrgan-x4plus.onnx', 'swin2sr-classical-x4.onnx', 'realesr-general-x4v3.onnx'];

async function bench(file: string, optLevel?: any) {
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(path.join(dir, file), {
    executionProviders: ['cpu'],
    ...(optLevel ? { graphOptimizationLevel: optLevel } : {}),
  } as any);
  const loadMs = Date.now() - t0;

  const size = 96;
  const arr = new Float32Array(3 * size * size).fill(0.5);
  const feeds: any = { [session.inputNames[0]]: new ort.Tensor('float32', arr, [1, 3, size, size]) };
  const t1 = Date.now();
  await session.run(feeds);
  const runMs = Date.now() - t1;
  console.log(`${file.padEnd(30)} opt=${optLevel || 'default'} load=${(loadMs/1000).toFixed(1)}s run=${(runMs/1000).toFixed(1)}s`);
}

async function main() {
  for (const f of files) {
    await bench(f, undefined);
    await bench(f, 'all');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
