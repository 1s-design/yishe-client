/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { URL } from "url";
import { app } from "electron";

import aiService from "./legacy/ai-service.js";
import { applyLowpoly } from "./legacy/lowpoly.js";
import {
  buildServiceCatalog,
  listOperationsMeta,
  resolveOperationMeta,
} from "./legacy/api-catalog.js";
import {
  getExampleById,
  listExamples,
} from "./legacy/example-catalog.js";
import {
  getOperationDefinition,
  listOperationDefinitions,
  validateAndNormalizeOperationPlan,
} from "./legacy/operation-registry.js";
import { VARIATIONS_CONFIG } from "./legacy/variations-config.js";
import {
  getAllImageProcessorStatuses,
  getDefaultImageProcessorId,
  resolveImageProcessorRegistration,
} from "./legacy/processors/registry.js";

type WorkspaceResolver = () => string;
type ImageToolDirectoryKey = "uploads" | "output" | "template" | "temp";

let resolveWorkspaceDirectory: WorkspaceResolver = () => "";

const imageToolState = {
  status: "idle",
  currentTaskId: null,
  currentOperation: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastError: null,
  lastOutputPath: null,
};

const FLAT_EFFECT_TYPE_MAP: Record<
  string,
  { baseType: "effects"; effectType: string; defaults: Record<string, any> }
> = {
  grayscale: { baseType: "effects", effectType: "grayscale", defaults: { method: "Rec601Luma", intensity: 100 } },
  effect_grayscale: { baseType: "effects", effectType: "grayscale", defaults: { method: "Rec601Luma", intensity: 100 } },
  negate: { baseType: "effects", effectType: "negate", defaults: {} },
  effect_negate: { baseType: "effects", effectType: "negate", defaults: {} },
  sepia: { baseType: "effects", effectType: "sepia", defaults: { intensity: 80 } },
  effect_sepia: { baseType: "effects", effectType: "sepia", defaults: { intensity: 80 } },
  blur: { baseType: "effects", effectType: "blur", defaults: { radius: 5, sigma: 5 } },
  effect_blur: { baseType: "effects", effectType: "blur", defaults: { radius: 5, sigma: 5 } },
  gaussian_blur: { baseType: "effects", effectType: "gaussian-blur", defaults: { radius: 5 } },
  "gaussian-blur": { baseType: "effects", effectType: "gaussian-blur", defaults: { radius: 5 } },
  motion_blur: { baseType: "effects", effectType: "motion-blur", defaults: { radius: 10, angle: 0 } },
  "motion-blur": { baseType: "effects", effectType: "motion-blur", defaults: { radius: 10, angle: 0 } },
  sharpen: { baseType: "effects", effectType: "sharpen", defaults: { radius: 1, amount: 1 } },
  effect_sharpen: { baseType: "effects", effectType: "sharpen", defaults: { radius: 1, amount: 1 } },
  unsharp: { baseType: "effects", effectType: "unsharp", defaults: { radius: 1, amount: 1, threshold: 0.05 } },
  effect_unsharp: { baseType: "effects", effectType: "unsharp", defaults: { radius: 1, amount: 1, threshold: 0.05 } },
  charcoal: { baseType: "effects", effectType: "charcoal", defaults: { radius: 1, sigma: 0.5 } },
  effect_charcoal: { baseType: "effects", effectType: "charcoal", defaults: { radius: 1, sigma: 0.5 } },
  oil_painting: { baseType: "effects", effectType: "oil-painting", defaults: { radius: 3 } },
  "oil-painting": { baseType: "effects", effectType: "oil-painting", defaults: { radius: 3 } },
  sketch: { baseType: "effects", effectType: "sketch", defaults: { radius: 1, sigma: 0.5 } },
  effect_sketch: { baseType: "effects", effectType: "sketch", defaults: { radius: 1, sigma: 0.5 } },
  emboss: { baseType: "effects", effectType: "emboss", defaults: { radius: 1, sigma: 0.5 } },
  effect_emboss: { baseType: "effects", effectType: "emboss", defaults: { radius: 1, sigma: 0.5 } },
  edge: { baseType: "effects", effectType: "edge", defaults: { radius: 1 } },
  effect_edge: { baseType: "effects", effectType: "edge", defaults: { radius: 1 } },
  posterize: { baseType: "effects", effectType: "posterize", defaults: { levels: 4 } },
  pixelate: { baseType: "effects", effectType: "pixelate", defaults: { size: 10 } },
  mosaic: { baseType: "effects", effectType: "mosaic", defaults: { size: 10 } },
  brightness: { baseType: "effects", effectType: "brightness", defaults: { value: 0 } },
  contrast: { baseType: "effects", effectType: "contrast", defaults: { value: 0 } },
  saturation: { baseType: "effects", effectType: "saturation", defaults: { value: 0 } },
  hue: { baseType: "effects", effectType: "hue", defaults: { value: 0 } },
  colorize: { baseType: "effects", effectType: "colorize", defaults: { color: "#FF0000", intensity: 50 } },
  tint: { baseType: "effects", effectType: "tint", defaults: { color: "#FFD700", intensity: 50 } },
  noise: { baseType: "effects", effectType: "noise", defaults: { noiseType: "Uniform" } },
  despeckle: { baseType: "effects", effectType: "despeckle", defaults: {} },
  texture: { baseType: "effects", effectType: "texture", defaults: { textureType: "Canvas" } },
  lowpoly: { baseType: "effects", effectType: "lowpoly", defaults: { pointCount: 900, edgeBias: 0.65, edgeThreshold: 0.15, sampleScale: 1, colorSamples: 7, seed: 12345 } },
  low_poly: { baseType: "effects", effectType: "lowpoly", defaults: { pointCount: 900, edgeBias: 0.65, edgeThreshold: 0.15, sampleScale: 1, colorSamples: 7, seed: 12345 } },
  vignette: { baseType: "effects", effectType: "vignette", defaults: { radius: 100, sigma: 50 } },
  solarize: { baseType: "effects", effectType: "solarize", defaults: { threshold: 50 } },
  swirl: { baseType: "effects", effectType: "swirl", defaults: { degrees: 90 } },
  wave: { baseType: "effects", effectType: "wave", defaults: { amplitude: 25, wavelength: 150 } },
  implode: { baseType: "effects", effectType: "implode", defaults: { amount: 0.5 } },
  explode: { baseType: "effects", effectType: "explode", defaults: { amount: 0.5 } },
  spread: { baseType: "effects", effectType: "spread", defaults: { radius: 3 } },
  normalize: { baseType: "effects", effectType: "normalize", defaults: {} },
  equalize: { baseType: "effects", effectType: "equalize", defaults: {} },
  gamma: { baseType: "effects", effectType: "gamma", defaults: { value: 1 } },
  threshold: { baseType: "effects", effectType: "threshold", defaults: { value: 50 } },
  quantize: { baseType: "effects", effectType: "quantize", defaults: { colors: 256 } },
  "adaptive-blur": { baseType: "effects", effectType: "adaptive-blur", defaults: { radius: 5, sigma: 5 } },
  adaptive_blur: { baseType: "effects", effectType: "adaptive-blur", defaults: { radius: 5, sigma: 5 } },
  "adaptive-sharpen": { baseType: "effects", effectType: "adaptive-sharpen", defaults: { radius: 1, sigma: 1 } },
  adaptive_sharpen: { baseType: "effects", effectType: "adaptive-sharpen", defaults: { radius: 1, sigma: 1 } },
  morphology: { baseType: "effects", effectType: "morphology", defaults: { method: "Erode", kernel: "Disk", size: 3 } },
  colorspace: { baseType: "effects", effectType: "colorspace", defaults: { space: "RGB" } },
  "auto-level": { baseType: "effects", effectType: "auto-level", defaults: {} },
  auto_level: { baseType: "effects", effectType: "auto-level", defaults: {} },
  "auto-gamma": { baseType: "effects", effectType: "auto-gamma", defaults: {} },
  auto_gamma: { baseType: "effects", effectType: "auto-gamma", defaults: {} },
  "auto-contrast": { baseType: "effects", effectType: "auto-contrast", defaults: {} },
  auto_contrast: { baseType: "effects", effectType: "auto-contrast", defaults: {} },
  "color-matrix": { baseType: "effects", effectType: "color-matrix", defaults: {} },
  color_matrix: { baseType: "effects", effectType: "color-matrix", defaults: {} },
  distort: { baseType: "effects", effectType: "distort", defaults: {} },
  fx: { baseType: "effects", effectType: "fx", defaults: {} },
};

function configureImageTool(options: { getWorkspaceDirectory?: WorkspaceResolver }) {
  if (typeof options?.getWorkspaceDirectory === "function") {
    resolveWorkspaceDirectory = options.getWorkspaceDirectory;
  }
}

function createImageToolError(
  code: string,
  message: string,
  details: Record<string, any> = {},
) {
  const error = new Error(message) as Error & {
    code?: string;
    details?: Record<string, any>;
  };
  error.code = code;
  error.details = details;
  return error;
}

function getImageToolRootDirectory() {
  const configuredWorkspace = String(resolveWorkspaceDirectory?.() || "").trim();
  const baseDirectory =
    configuredWorkspace || path.join(app.getPath("userData"), "workspace");
  return path.join(baseDirectory, "image-tool");
}

function ensureImageToolDirectories() {
  const root = getImageToolRootDirectory();
  const directories = {
    root,
    uploads: path.join(root, "uploads"),
    output: path.join(root, "output"),
    template: path.join(root, "template"),
    temp: path.join(root, "temp"),
  };

  for (const dir of Object.values(directories)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return directories;
}

function generateFileName(prefix: string, extension = "") {
  const normalizedExtension = extension
    ? extension.startsWith(".")
      ? extension
      : `.${extension}`
    : "";
  return `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e9)}${normalizedExtension}`;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeInputImage(payload: Record<string, any> = {}) {
  const sourcePath =
    typeof payload.sourcePath === "string" && payload.sourcePath.trim()
      ? payload.sourcePath.trim()
      : "";
  const imageUrl =
    typeof payload.imageUrl === "string" && payload.imageUrl.trim()
      ? payload.imageUrl.trim()
      : "";
  const image =
    typeof payload.image === "string" && payload.image.trim()
      ? payload.image.trim()
      : "";
  const filename =
    typeof payload.filename === "string" && payload.filename.trim()
      ? payload.filename.trim()
      : "";

  return sourcePath || imageUrl || image || filename || "";
}

function updateImageToolState(patch: Record<string, any>) {
  Object.assign(imageToolState, patch);
}

function beginTask(operation: string) {
  const taskId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  updateImageToolState({
    status: "busy",
    currentTaskId: taskId,
    currentOperation: operation,
    lastStartedAt: new Date().toISOString(),
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: null,
  });
  return { taskId, startedAt: Date.now() };
}

function finishTask(task: { startedAt: number }, patch: Record<string, any> = {}) {
  updateImageToolState({
    status: "idle",
    currentTaskId: null,
    currentOperation: null,
    lastFinishedAt: new Date().toISOString(),
    lastDurationMs: Date.now() - task.startedAt,
    ...patch,
  });
}

function failTask(task: { startedAt: number }, error: any) {
  updateImageToolState({
    status: "error",
    currentTaskId: null,
    currentOperation: null,
    lastFinishedAt: new Date().toISOString(),
    lastDurationMs: Date.now() - task.startedAt,
    lastError: error?.message || String(error),
  });
}

async function resolveProcessorContext(requestedId?: string) {
  const normalizedId =
    typeof requestedId === "string" && requestedId.trim()
      ? requestedId.trim()
      : getDefaultImageProcessorId();
  const registration = resolveImageProcessorRegistration(normalizedId);
  return {
    id: registration.id,
    label: registration.label,
    processor: registration.processor,
  };
}

function getImageToolDirectories() {
  return ensureImageToolDirectories();
}

async function downloadFromUrl(url: string, targetDir: string) {
  return await new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        reject(new Error(`不支持的协议: ${urlObj.protocol}`));
        return;
      }

      const protocol = urlObj.protocol === "https:" ? https : http;
      const request = protocol.get(
        url,
        {
          timeout: 30_000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`下载失败: HTTP ${response.statusCode}`));
            return;
          }

          let extension = path.extname(urlObj.pathname);
          const mimeType = String(response.headers["content-type"] || "")
            .split(";")[0]
            .trim();
          const mimeToExtension: Record<string, string> = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/bmp": ".bmp",
            "image/webp": ".webp",
            "image/svg+xml": ".svg",
            "image/tiff": ".tiff",
            "image/x-icon": ".ico",
          };
          if (!extension) {
            extension = mimeToExtension[mimeType] || ".jpg";
          }
          if (!extension.startsWith(".")) {
            extension = `.${extension}`;
          }

          const filename = generateFileName("downloaded", extension);
          const filePath = path.join(targetDir, filename);
          const stream = fs.createWriteStream(filePath);
          response.pipe(stream);

          stream.on("finish", () => {
            stream.close();
            const stats = fs.statSync(filePath);
            resolve({
              filename,
              path: filePath,
              size: stats.size,
              originalUrl: url,
            });
          });

          stream.on("error", (error) => {
            fs.rmSync(filePath, { force: true });
            reject(error);
          });
        },
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy(new Error("下载超时"));
      });
    } catch (error: any) {
      reject(new Error(`无效的 URL: ${error?.message || "未知错误"}`));
    }
  });
}

async function resolveInputPath(
  inputImage: string,
  directories: ReturnType<typeof ensureImageToolDirectories>,
) {
  if (!inputImage) {
    throw createImageToolError(
      "MISSING_INPUT_IMAGE",
      "缺少必要参数: sourcePath / imageUrl / image / filename",
    );
  }

  if (isValidHttpUrl(inputImage)) {
    const downloadedFileInfo = await downloadFromUrl(inputImage, directories.temp);
    return {
      actualFilename: downloadedFileInfo.filename,
      inputPath: downloadedFileInfo.path,
      downloadedFileInfo,
    };
  }

  if (path.isAbsolute(inputImage)) {
    if (!fs.existsSync(inputImage)) {
      throw createImageToolError("FILE_NOT_FOUND", "文件不存在", { inputImage });
    }
    return {
      actualFilename: path.basename(inputImage),
      inputPath: inputImage,
      downloadedFileInfo: null,
    };
  }

  const candidates = [
    path.join(directories.uploads, inputImage),
    path.join(directories.template, inputImage),
    path.join(directories.temp, inputImage),
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw createImageToolError("FILE_NOT_FOUND", "文件不存在", {
      inputImage,
      candidates,
    });
  }

  return {
    actualFilename: path.basename(existing),
    inputPath: existing,
    downloadedFileInfo: null,
  };
}

function cleanupDownloadedInputFile(imagePathInfo: any) {
  const filePath = imagePathInfo?.downloadedFileInfo?.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(`清理下载的临时源图失败: ${filePath}`, error);
  }
}

function resolveValidatedOperationPlan(
  operations: Array<Record<string, any>>,
  contextLabel = "操作链",
) {
  const validation = validateAndNormalizeOperationPlan(operations);
  if (!validation.ok) {
    throw createImageToolError("INVALID_OPERATION_PLAN", `${contextLabel}校验失败`, {
      errors: validation.errors,
      operationCount: Array.isArray(operations) ? operations.length : 0,
    });
  }

  return validation.operations.map((operation: any) => ({
    type: operation.type,
    params: operation.params || {},
  }));
}

function normalizeOperation(type: string, params: Record<string, any> = {}) {
  if (typeof type !== "string" || !type.trim()) {
    return { type, params };
  }

  if (type === "filter" || type === "effects") {
    throw new Error(
      'INVALID_OPERATION: legacy type "filter"/"effects" is no longer supported, please use "filter-xxx" or "effects-xxx".',
    );
  }

  if (type.includes(":")) {
    const [group, sub] = type.split(":");
    if ((group === "effects" || group === "effect") && sub) {
      return normalizeOperation(`effects-${sub}`, params);
    }
    if (group === "filter" && sub) {
      return normalizeOperation(`filter-${sub}`, params);
    }
  }

  const mappedEffect = FLAT_EFFECT_TYPE_MAP[type];
  if (mappedEffect) {
    return {
      type: mappedEffect.baseType,
      params: {
        ...mappedEffect.defaults,
        ...params,
        effectType: mappedEffect.effectType,
      },
    };
  }

  const definition = getOperationDefinition(type);
  if (!definition) {
    return { type, params };
  }

  if (definition.category === "basic") {
    return { type: definition.type, params };
  }

  if (definition.category === "effect") {
    return {
      type: "effects",
      params: {
        ...params,
        effectType: definition.type,
      },
    };
  }

  if (definition.category === "filter") {
    const defaultIntensity = definition.params?.intensity?.default ?? 1;
    return {
      type: "filter",
      params: {
        ...params,
        filterType:
          definition.filterType || definition.type.replace(/^filter-/, ""),
        intensity:
          params.intensity !== undefined
            ? parseFloat(params.intensity) || defaultIntensity
            : defaultIntensity,
      },
    };
  }

  return { type: definition.type, params };
}

function resolveWatermarkImagePath(
  filename: string,
  directories: ReturnType<typeof ensureImageToolDirectories>,
) {
  if (!filename || typeof filename !== "string") {
    return null;
  }
  return filename.includes("/") || filename.includes("\\")
    ? filename
    : path.join(directories.uploads, filename);
}

function ensureFiniteDimension(value: any, fieldName: string, operationType: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw createImageToolError(
      "INVALID_OPERATION_PARAM",
      `${operationType} 的 ${fieldName} 必须是大于 0 的数值`,
      { operationType, fieldName, value },
    );
  }

  return number;
}

function preflightOperationPlan(options: {
  imageInfo?: Record<string, any> | null;
  operations: Array<Record<string, any>>;
  directories: ReturnType<typeof ensureImageToolDirectories>;
  prompt?: string | null;
}) {
  const { imageInfo, operations, directories, prompt } = options;

  if (!Array.isArray(operations) || operations.length === 0) {
    throw createImageToolError("INVALID_OPERATION_PLAN", "AI 未生成有效的操作链", {
      prompt,
    });
  }

  if (operations.length > 12) {
    throw createImageToolError("INVALID_OPERATION_PLAN", "操作链过长，已拒绝执行", {
      prompt,
      operationCount: operations.length,
      maxAllowed: 12,
    });
  }

  const imageWidth = Number(imageInfo?.width);
  const imageHeight = Number(imageInfo?.height);
  const hasImageSize =
    Number.isFinite(imageWidth) &&
    imageWidth > 0 &&
    Number.isFinite(imageHeight) &&
    imageHeight > 0;

  operations.forEach((operation, index) => {
    const operationType = String(operation?.type || "").trim();
    const params = operation?.params || {};
    const normalized = normalizeOperation(operationType, params);
    const normalizedType = normalized.type;
    const normalizedParams = normalized.params || {};
    const definition = getOperationDefinition(operationType) || getOperationDefinition(normalizedType);

    if (!definition && !["filter", "effects"].includes(normalizedType)) {
      throw createImageToolError("INVALID_OPERATION_PLAN", `存在不支持的操作类型: ${operationType}`, {
        operationIndex: index,
        operationType,
      });
    }

    if (normalizedType === "crop") {
      const width = ensureFiniteDimension(normalizedParams.width, "width", normalizedType);
      const height = ensureFiniteDimension(normalizedParams.height, "height", normalizedType);
      if (hasImageSize && normalizedParams.maintainAspectRatio !== true) {
        const x = Number(normalizedParams.x || 0);
        const y = Number(normalizedParams.y || 0);
        if (x < 0 || y < 0 || x + width > imageWidth || y + height > imageHeight) {
          throw createImageToolError("INVALID_OPERATION_PARAM", "crop 参数超出原图范围", {
            operationIndex: index,
            operationType,
            imageSize: { width: imageWidth, height: imageHeight },
            params: normalizedParams,
          });
        }
      }
    }

    if (normalizedType === "shapeCrop") {
      ensureFiniteDimension(normalizedParams.width, "width", normalizedType);
      ensureFiniteDimension(normalizedParams.height, "height", normalizedType);
    }

    if (normalizedType === "watermark") {
      if (normalizedParams.type === "image") {
        const watermarkImagePath = resolveWatermarkImagePath(
          normalizedParams.watermarkImageFilename,
          directories,
        );
        if (!watermarkImagePath) {
          throw createImageToolError(
            "MISSING_REQUIRED_RESOURCE",
            "图片水印缺少 watermarkImageFilename",
            { operationIndex: index, operationType },
          );
        }
        if (!fs.existsSync(watermarkImagePath)) {
          throw createImageToolError("MISSING_REQUIRED_RESOURCE", "图片水印文件不存在", {
            operationIndex: index,
            operationType,
            watermarkImageFilename: normalizedParams.watermarkImageFilename,
          });
        }
      }

      if ((normalizedParams.type || "text") === "text" && !String(normalizedParams.text || "").trim()) {
        throw createImageToolError("INVALID_OPERATION_PARAM", "文字水印缺少 text 内容", {
          operationIndex: index,
          operationType,
        });
      }
    }

    if (normalizedType === "effects" && normalizedParams.effectType === "color-matrix") {
      if (!Array.isArray(normalizedParams.matrix) || normalizedParams.matrix.length !== 25) {
        throw createImageToolError(
          "INVALID_OPERATION_PARAM",
          "color-matrix 需要 25 个数字组成的 5x5 矩阵",
          {
            operationIndex: index,
            operationType,
            matrixLength: Array.isArray(normalizedParams.matrix)
              ? normalizedParams.matrix.length
              : null,
          },
        );
      }
    }

    if (normalizedType === "effects" && normalizedParams.effectType === "distort") {
      if (
        !Array.isArray(normalizedParams.points) ||
        normalizedParams.points.length < 8 ||
        normalizedParams.points.length % 2 !== 0
      ) {
        throw createImageToolError(
          "INVALID_OPERATION_PARAM",
          "distort.points 必须是长度不少于 8 的偶数数组",
          {
            operationIndex: index,
            operationType,
            pointsLength: Array.isArray(normalizedParams.points)
              ? normalizedParams.points.length
              : null,
          },
        );
      }
    }
  });
}

async function executeOperation(
  imageProcessor: any,
  type: string,
  params: Record<string, any>,
  currentInputPath: string,
  outputPath: string,
  directories: ReturnType<typeof ensureImageToolDirectories>,
) {
  let command;
  let finalOutputPath = outputPath;

  switch (type) {
    case "resize":
      command = await imageProcessor.resize(currentInputPath, outputPath, {
        width: parseInt(params.width),
        height: parseInt(params.height),
        quality: params.quality || 90,
        maintainAspectRatio: params.maintainAspectRatio !== false,
      });
      break;
    case "crop":
      command = await imageProcessor.crop(currentInputPath, outputPath, {
        x: Number.isFinite(parseInt(params.x)) ? parseInt(params.x) : 0,
        y: Number.isFinite(parseInt(params.y)) ? parseInt(params.y) : 0,
        width: parseInt(params.width),
        height: parseInt(params.height),
      });
      break;
    case "shapeCrop": {
      const shapeOutputPath = outputPath.replace(/\.[^.]+$/, ".png");
      command = await imageProcessor.shapeCrop(currentInputPath, shapeOutputPath, {
        shape: params.shape,
        x: params.x !== undefined ? parseInt(params.x) : null,
        y: params.y !== undefined ? parseInt(params.y) : null,
        width: parseInt(params.width) || 200,
        height: parseInt(params.height) || 200,
        backgroundColor: params.backgroundColor || "transparent",
      });
      finalOutputPath = shapeOutputPath;
      break;
    }
    case "rotate":
      command = await imageProcessor.rotate(currentInputPath, outputPath, {
        degrees: parseFloat(params.degrees) || 0,
        backgroundColor: params.backgroundColor || "#000000",
      });
      break;
    case "convert": {
      const convertOutputPath = outputPath.replace(
        /\.[^.]+$/,
        `.${params.format || "jpg"}`,
      );
      command = await imageProcessor.convert(currentInputPath, convertOutputPath, {
        format: params.format || "jpg",
        quality: params.quality || 90,
      });
      finalOutputPath = convertOutputPath;
      break;
    }
    case "watermark":
      command = await imageProcessor.watermark(currentInputPath, outputPath, {
        type: params.type || "text",
        text: params.text || "",
        fontSize: parseInt(params.fontSize) || 24,
        fontFamily: params.fontFamily || "Microsoft YaHei",
        color: params.color || "#FFFFFF",
        strokeColor: params.strokeColor || "",
        strokeWidth: parseInt(params.strokeWidth) || 0,
        watermarkImage: params.watermarkImageFilename
          ? resolveWatermarkImagePath(params.watermarkImageFilename, directories)
          : null,
        watermarkScale:
          params.watermarkScale !== undefined
            ? parseFloat(params.watermarkScale)
            : 1,
        position: params.position || "bottom-right",
        x: params.x !== undefined ? parseInt(params.x) : null,
        y: params.y !== undefined ? parseInt(params.y) : null,
        marginX: params.marginX !== undefined ? parseInt(params.marginX) : 10,
        marginY: params.marginY !== undefined ? parseInt(params.marginY) : 10,
        opacity: params.opacity !== undefined ? parseFloat(params.opacity) : 1,
        angle: params.angle !== undefined ? parseFloat(params.angle) : 0,
        repeat: params.repeat === true,
        tileSize:
          params.tileSize !== undefined && params.tileSize !== null
            ? parseInt(params.tileSize)
            : null,
      });
      break;
    case "adjust":
      command = await imageProcessor.adjust(currentInputPath, outputPath, {
        brightness: parseFloat(params.brightness) || 0,
        contrast: parseFloat(params.contrast) || 0,
        saturation: parseFloat(params.saturation) || 0,
      });
      break;
    case "trim":
      command = await imageProcessor.trim(currentInputPath, outputPath, {
        fuzz: params.fuzz !== undefined ? parseFloat(params.fuzz) : 0,
        backgroundColor: params.backgroundColor,
      });
      break;
    case "extent":
      command = await imageProcessor.extent(currentInputPath, outputPath, {
        width: parseInt(params.width),
        height: parseInt(params.height),
        x: parseInt(params.x) || 0,
        y: parseInt(params.y) || 0,
        backgroundColor: params.backgroundColor || "white",
        gravity: params.gravity,
      });
      break;
    case "flip":
      command = await imageProcessor.flip(currentInputPath, outputPath);
      break;
    case "flop":
      command = await imageProcessor.flop(currentInputPath, outputPath);
      break;
    case "transpose":
      command = await imageProcessor.transpose(currentInputPath, outputPath);
      break;
    case "transverse":
      command = await imageProcessor.transverse(currentInputPath, outputPath);
      break;
    case "filter":
      command = await imageProcessor.applyFilter(currentInputPath, outputPath, {
        filterType: params.filterType,
        intensity:
          params.intensity !== undefined ? parseFloat(params.intensity) || 1 : 1,
      });
      break;
    case "effects": {
      let effectsArray = [];
      if (Array.isArray(params.effects) && params.effects.length > 0) {
        effectsArray = params.effects.map((effect: any) => {
          const { effectType, type: effectName, ...rest } = effect;
          return {
            type: effectType || effectName,
            ...rest,
          };
        });
      } else {
        const effect: Record<string, any> = {
          type: params.effectType || params.type,
        };
        Object.keys(params).forEach((key) => {
          if (key === "effectType" || key === "type") return;
          effect[key] = params[key];
        });
        effectsArray = [effect];
      }

      const hasLowpoly = effectsArray.some((effect: any) => {
        const effectType = String(effect?.type || "").toLowerCase();
        return ["lowpoly", "low-poly", "low_poly"].includes(effectType);
      });

      if (hasLowpoly) {
        if (effectsArray.length > 1) {
          throw new Error("lowpoly 当前仅支持单独使用（请将 lowpoly 放在单独的操作步骤中）");
        }
        command = await applyLowpoly(currentInputPath, outputPath, effectsArray[0] || {});
      } else {
        command = await imageProcessor.applyEffects(
          currentInputPath,
          outputPath,
          effectsArray,
        );
      }
      break;
    }
    default:
      throw new Error(`不支持的操作类型: ${type}`);
  }

  return { command, outputPath: finalOutputPath };
}

async function executeOperationsChain(
  imageProcessor: any,
  inputPath: string,
  actualFilename: string,
  operations: Array<Record<string, any>>,
  outputDir: string,
  directories: ReturnType<typeof ensureImageToolDirectories>,
  outputPrefix = "processed_",
) {
  let currentInputPath = inputPath;
  const commands: string[] = [];
  const tempFiles: string[] = [];
  const normalizedOperations = resolveValidatedOperationPlan(operations);

  try {
    for (let index = 0; index < normalizedOperations.length; index += 1) {
      const operation = normalizedOperations[index];
      const normalized = normalizeOperation(operation.type, operation.params || {});
      let outputPath;

      if (index === normalizedOperations.length - 1) {
        const baseName = path.parse(actualFilename).name;
        const extension = normalized.params?.format
          ? `.${normalized.params.format}`
          : path.extname(actualFilename) || ".jpg";
        outputPath = path.join(
          outputDir,
          `${outputPrefix}${Date.now()}_${baseName}${extension}`,
        );
      } else {
        outputPath = path.join(
          outputDir,
          `temp_${Date.now()}_${index}.${path.extname(currentInputPath).slice(1) || "jpg"}`,
        );
        tempFiles.push(outputPath);
      }

      const result = await executeOperation(
        imageProcessor,
        normalized.type,
        normalized.params,
        currentInputPath,
        outputPath,
        directories,
      );
      commands.push(result.command);

      if (index > 0 && currentInputPath !== inputPath && fs.existsSync(currentInputPath)) {
        try {
          fs.unlinkSync(currentInputPath);
        } catch {}
      }

      currentInputPath = result.outputPath;
    }

    for (const tempFile of tempFiles) {
      if (fs.existsSync(tempFile) && tempFile !== currentInputPath) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }

    return {
      outputPath: currentInputPath,
      outputFilename: path.basename(currentInputPath),
      commands,
    };
  } catch (error) {
    for (const tempFile of tempFiles) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
    throw error;
  }
}

function buildResultFileRecord(filePath: string) {
  const stats = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

async function getImageToolStatus() {
  const directories = ensureImageToolDirectories();
  return {
    success: true,
    ...imageToolState,
    workspaceRoot: directories.root,
    directories,
    processors: await getAllImageProcessorStatuses(),
    defaultProcessorId: getDefaultImageProcessorId(),
    imageMagickDir: process.env.YISHE_IMAGEMAGICK_DIR || "",
    ai: aiService.getPublicConfigSummary?.() || {
      enabled: false,
      available: false,
    },
  };
}

async function getImageInfo(payload: Record<string, any> = {}) {
  const task = beginTask("identify");
  const directories = ensureImageToolDirectories();

  try {
    const imagePathInfo = await resolveInputPath(
      normalizeInputImage(payload),
      directories,
    );
    try {
      const processorContext = await resolveProcessorContext(payload.engine);
      const info = await processorContext.processor.identify(imagePathInfo.inputPath);
      finishTask(task);
      return {
        success: true,
        info,
        engine: {
          id: processorContext.id,
          label: processorContext.label,
        },
        input: {
          source: imagePathInfo.downloadedFileInfo ? "url" : "local",
          original: imagePathInfo.downloadedFileInfo
            ? imagePathInfo.downloadedFileInfo.originalUrl
            : imagePathInfo.actualFilename,
          path: imagePathInfo.inputPath,
        },
      };
    } finally {
      cleanupDownloadedInputFile(imagePathInfo);
    }
  } catch (error: any) {
    failTask(task, error);
    throw error;
  }
}

async function processImage(payload: Record<string, any> = {}) {
  const task = beginTask("process");
  const directories = ensureImageToolDirectories();

  try {
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    if (operations.length === 0) {
      throw createImageToolError("INVALID_OPERATION_PLAN", "operations 必须是非空数组");
    }
    const imagePathInfo = await resolveInputPath(
      normalizeInputImage(payload),
      directories,
    );
    try {
      const processorContext = await resolveProcessorContext(payload.engine);
      const imageInfo = await processorContext.processor.identify(imagePathInfo.inputPath);
      preflightOperationPlan({
        imageInfo,
        operations,
        directories,
      });
      const result = await executeOperationsChain(
        processorContext.processor,
        imagePathInfo.inputPath,
        imagePathInfo.actualFilename,
        operations,
        directories.output,
        directories,
        payload.outputPrefix || "processed_",
      );
      finishTask(task, { lastOutputPath: result.outputPath });
      return {
        success: true,
        durationMs: imageToolState.lastDurationMs,
        outputFile: result.outputFilename,
        localPath: result.outputPath,
        commands: result.commands,
        engine: {
          id: processorContext.id,
          label: processorContext.label,
        },
      };
    } finally {
      cleanupDownloadedInputFile(imagePathInfo);
    }
  } catch (error: any) {
    failTask(task, error);
    throw error;
  }
}

async function processImageWithPrompt(payload: Record<string, any> = {}) {
  const task = beginTask("processWithPrompt");
  const directories = ensureImageToolDirectories();

  try {
    const prompt = String(payload.prompt || "").trim();
    if (!prompt) {
      throw createImageToolError("MISSING_PROMPT", "缺少必要参数: prompt");
    }
    if (!aiService.isAvailable?.()) {
      throw createImageToolError("AI_SERVICE_UNAVAILABLE", "AI服务不可用，请检查配置或设置环境变量");
    }
    const imagePathInfo = await resolveInputPath(
      normalizeInputImage(payload),
      directories,
    );
    try {
      const processorContext = await resolveProcessorContext(payload.engine);
      const imageInfo = await processorContext.processor.identify(imagePathInfo.inputPath);
      const aiResult = await aiService.convertPromptToOperations(prompt, imageInfo);
      preflightOperationPlan({
        prompt,
        imageInfo,
        operations: aiResult.operations,
        directories,
      });
      const result = await executeOperationsChain(
        processorContext.processor,
        imagePathInfo.inputPath,
        imagePathInfo.actualFilename,
        aiResult.operations,
        directories.output,
        directories,
        payload.outputPrefix || "ai_processed_",
      );
      finishTask(task, { lastOutputPath: result.outputPath });
      return {
        success: true,
        outputFile: result.outputFilename,
        localPath: result.outputPath,
        operations: aiResult.operations,
        command: aiResult.command,
        executedCommands: result.commands,
      };
    } finally {
      cleanupDownloadedInputFile(imagePathInfo);
    }
  } catch (error: any) {
    failTask(task, error);
    throw error;
  }
}

async function generateImageVariations(payload: Record<string, any> = {}) {
  const task = beginTask("variations");
  const directories = ensureImageToolDirectories();

  try {
    const imagePathInfo = await resolveInputPath(
      normalizeInputImage(payload),
      directories,
    );
    try {
      const processorContext = await resolveProcessorContext(payload.engine);
      const imageInfo = await processorContext.processor.identify(imagePathInfo.inputPath);
      const results = [];
      let successCount = 0;
      let failCount = 0;
      for (const variation of VARIATIONS_CONFIG) {
        try {
          const safeName = variation.name
            .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
            .substring(0, 20);
          const result = await executeOperationsChain(
            processorContext.processor,
            imagePathInfo.inputPath,
            imagePathInfo.actualFilename,
            variation.operations,
            directories.output,
            directories,
            `variation_${safeName}_`,
          );
          results.push({
            success: true,
            name: variation.name,
            description: variation.description,
            outputFile: result.outputFilename,
            localPath: result.outputPath,
            commands: result.commands,
            imageInfo,
          });
          successCount += 1;
        } catch (error: any) {
          results.push({
            success: false,
            name: variation.name,
            description: variation.description,
            error: error?.message || String(error),
          });
          failCount += 1;
        }
      }
      finishTask(task, {
        lastOutputPath: results.find((item) => item.success)?.localPath || null,
      });
      return { success: true, successCount, failCount, results };
    } finally {
      cleanupDownloadedInputFile(imagePathInfo);
    }
  } catch (error: any) {
    failTask(task, error);
    throw error;
  }
}

async function listImageToolFiles(payload: Record<string, any> = {}) {
  const directories = ensureImageToolDirectories();
  const directoryKey = String(payload.directory || "output") as ImageToolDirectoryKey;
  if (!["uploads", "output", "template", "temp"].includes(directoryKey)) {
    throw createImageToolError("INVALID_DIRECTORY", "目录参数无效");
  }
  const entries = fs
    .readdirSync(directories[directoryKey], { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => buildResultFileRecord(path.join(directories[directoryKey], entry.name)))
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  return {
    success: true,
    directory: directoryKey,
    path: directories[directoryKey],
    total: entries.length,
    files: entries,
  };
}

async function deleteImageToolFile(payload: Record<string, any> = {}) {
  const directories = ensureImageToolDirectories();
  const directoryKey = String(payload.directory || "output") as ImageToolDirectoryKey;
  const fileName = String(payload.fileName || "").trim();
  if (!["uploads", "output", "template", "temp"].includes(directoryKey)) {
    throw createImageToolError("INVALID_DIRECTORY", "目录参数无效");
  }
  if (!fileName) {
    throw createImageToolError("MISSING_FILENAME", "缺少必要参数: fileName");
  }
  const targetPath = path.join(directories[directoryKey], fileName);
  if (!fs.existsSync(targetPath)) {
    throw createImageToolError("FILE_NOT_FOUND", "文件不存在", { targetPath });
  }
  fs.rmSync(targetPath, { force: true });
  return { success: true, fileName, path: targetPath };
}

async function clearImageToolFiles(payload: Record<string, any> = {}) {
  const directories = ensureImageToolDirectories();
  const directoryKey = String(payload.directory || "output") as ImageToolDirectoryKey;
  if (!["uploads", "output", "template", "temp"].includes(directoryKey)) {
    throw createImageToolError("INVALID_DIRECTORY", "目录参数无效");
  }
  let removedCount = 0;
  for (const entry of fs.readdirSync(directories[directoryKey], { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.rmSync(path.join(directories[directoryKey], entry.name), { force: true });
    removedCount += 1;
  }
  return { success: true, directory: directoryKey, removedCount };
}

async function saveImageToolInput(payload: Record<string, any> = {}) {
  const directories = ensureImageToolDirectories();
  const sourcePath = String(payload.sourcePath || "").trim();
  if (!sourcePath) {
    throw createImageToolError("MISSING_SOURCE_PATH", "缺少必要参数: sourcePath");
  }
  if (!path.isAbsolute(sourcePath) || !fs.existsSync(sourcePath)) {
    throw createImageToolError("FILE_NOT_FOUND", "sourcePath 不存在", { sourcePath });
  }
  const fileName =
    String(payload.fileName || "").trim() || `${Date.now()}_${path.basename(sourcePath)}`;
  const targetPath = path.join(directories.uploads, fileName);
  fs.copyFileSync(sourcePath, targetPath);
  return { success: true, fileName, path: targetPath };
}

async function getImageToolCatalog() {
  return { success: true, catalog: buildServiceCatalog() };
}

async function getImageToolOperations() {
  return {
    success: true,
    total: listOperationsMeta().length,
    operations: listOperationsMeta(),
  };
}

async function getImageToolOperationSchemas() {
  return {
    success: true,
    operations: listOperationDefinitions().map((operation: any) => ({
      type: operation.apiType,
      category: operation.category,
      description: operation.description,
      aliases: operation.aliases || [],
      requiredParams: operation.requiredParams || [],
      jsonSchemaParams: operation.jsonSchemaParams || null,
    })),
  };
}

async function getImageToolOperationDetail(type: string) {
  const operation = resolveOperationMeta(type);
  if (!operation) {
    throw createImageToolError("OPERATION_NOT_FOUND", "未找到对应操作", { type });
  }
  return { success: true, operation };
}

async function getImageToolExamples() {
  return { success: true, examples: listExamples() };
}

async function getImageToolExampleById(id: string) {
  const example = getExampleById(id);
  if (!example) {
    throw createImageToolError("EXAMPLE_NOT_FOUND", "未找到对应示例", { id });
  }
  return { success: true, example };
}

async function getImageToolVariationsConfig() {
  return {
    success: true,
    variations: VARIATIONS_CONFIG.map((variation: any, index: number) => ({
      ...variation,
      index,
    })),
  };
}

export {
  aiService,
  applyLowpoly,
  beginTask,
  buildServiceCatalog,
  clearImageToolFiles,
  configureImageTool,
  createImageToolError,
  deleteImageToolFile,
  ensureImageToolDirectories,
  failTask,
  finishTask,
  generateFileName,
  getAllImageProcessorStatuses,
  getDefaultImageProcessorId,
  getExampleById,
  generateImageVariations,
  getImageInfo,
  getImageToolCatalog,
  getImageToolDirectories,
  getImageToolExampleById,
  getImageToolExamples,
  getImageToolOperationDetail,
  getImageToolOperationSchemas,
  getImageToolOperations,
  getOperationDefinition,
  getImageToolRootDirectory,
  getImageToolStatus,
  getImageToolVariationsConfig,
  imageToolState,
  isValidHttpUrl,
  listImageToolFiles,
  listExamples,
  listOperationDefinitions,
  listOperationsMeta,
  normalizeInputImage,
  processImage,
  processImageWithPrompt,
  resolveOperationMeta,
  resolveProcessorContext,
  saveImageToolInput,
  updateImageToolState,
  validateAndNormalizeOperationPlan,
  VARIATIONS_CONFIG,
};
