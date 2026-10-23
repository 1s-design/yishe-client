/**
 * 超分模型文件定位
 *
 * 模型随客户端打包（resources/ai-upscale-models），用户装完即可离线使用，无需下载。
 * 仅在随包文件缺失时，才回退到 userData 缓存 / 联网下载（兜底）。
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import { getUpscaleModel } from './models';

const RESOURCE_SUBDIR = path.join('resources', 'ai-upscale-models');

let cachedUserDir: string | null = null;

export function getUserModelDir(): string {
  if (cachedUserDir) return cachedUserDir;
  const dir = path.join(app.getPath('userData'), 'ai-upscale-models');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  cachedUserDir = dir;
  return dir;
}

/** 随包模型所在目录的候选路径（覆盖开发态与安装态） */
function getBundledDirs(): string[] {
  const dirs: string[] = [];
  if (app.isPackaged) {
    dirs.push(path.join(process.resourcesPath, RESOURCE_SUBDIR));
    dirs.push(path.join(process.resourcesPath, 'app.asar.unpacked', RESOURCE_SUBDIR));
  }
  dirs.push(path.join(app.getAppPath(), RESOURCE_SUBDIR));
  dirs.push(path.resolve(__dirname, '../../..', RESOURCE_SUBDIR));
  return dirs;
}

/**
 * 返回模型目录路径（包含 config.json / preprocessor_config.json / onnx/model.onnx）：
 * 优先随包目录，其次 userData 缓存，最后联网下载。
 */
export async function ensureModel(modelId: string): Promise<string> {
  const model = getUpscaleModel(modelId);
  const fileName = model.file;

  for (const dir of getBundledDirs()) {
    // 模型目录：{dir}/{modelId}/，onnx 软链到 {dir}/{fileName}
    const modelDir = path.join(dir, modelId);
    const onnxPath = path.join(modelDir, 'onnx', 'model.onnx');
    if (fs.existsSync(onnxPath) && fs.statSync(onnxPath).size > 0) {
      return modelDir;
    }
    // 兼容旧平铺结构：{dir}/{fileName}
    const flatPath = path.join(dir, fileName);
    if (fs.existsSync(flatPath) && fs.statSync(flatPath).size > 0) {
      return dir;
    }
  }

  const cached = path.join(getUserModelDir(), fileName);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
    return getUserModelDir();
  }

  if (!model.url) {
    throw new Error(`模型文件缺失且无下载地址: ${fileName}`);
  }
  await downloadFile(model.url, cached);
  return getUserModelDir();
}

/** 模型是否已随包提供（用于状态展示） */
export function isModelBundled(modelId: string): boolean {
  const fileName = getUpscaleModel(modelId).file;
  return getBundledDirs().some((dir) => {
    const candidate = path.join(dir, fileName);
    return fs.existsSync(candidate) && fs.statSync(candidate).size > 0;
  });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const tempPath = `${destPath}.downloading`;
    const fileStream = fs.createWriteStream(tempPath);

    const request = client.get(url, { headers: { 'User-Agent': 'yishe-client/1.0' } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fileStream.close();
        fs.unlink(tempPath, () => {});
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        fileStream.close();
        fs.unlink(tempPath, () => {});
        reject(new Error(`模型下载失败，HTTP ${response.statusCode}: ${url}`));
        return;
      }
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => {
          fs.renameSync(tempPath, destPath);
          resolve();
        });
      });
    });

    request.on('error', (err) => {
      fileStream.close();
      fs.unlink(tempPath, () => {});
      reject(err);
    });
    fileStream.on('error', (err) => {
      fs.unlink(tempPath, () => {});
      reject(err);
    });
  });
}
