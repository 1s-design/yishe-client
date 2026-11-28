import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { CapabilityRegistry } from "./registry";
import { generateCosKey, uploadFileToCos } from "../cos";

type ImageTransformOp = "trim_png" | "svg_to_png" | "rotate";

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载源图片失败 (${res.status}): ${url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * 客户端本地图像轻量处理并直传 COS（替代服务端拉图处理再回传）：
 * - trim_png: PNG 去白边/透明边
 * - svg_to_png: SVG 转高分辨率透明 PNG
 * - rotate: 按 90/180/270 度旋转并回写指定 COS Key（或新 Key）
 */
export function registerImageTransformCapabilities(): void {
  CapabilityRegistry.register({
    namespace: "imageTransform",
    name: "run",
    description:
      "在客户端本地使用 sharp 执行 PNG 去白边、SVG 转 PNG 或图片旋转，并直接上传结果到 COS（不经过服务端中转）",
    category: "image",
    riskLevel: "low",
    parameters: {
      op: {
        type: "string",
        description: "操作类型：trim_png | svg_to_png | rotate",
        required: true,
      },
      sourceUrl: {
        type: "string",
        description: "源图片 URL",
        required: true,
      },
      targetKey: {
        type: "string",
        description: "目标 COS Object Key（可选；rotate 就地覆盖时必传）",
      },
      category: {
        type: "string",
        description: "未传 targetKey 时的 COS 分类目录（默认 sticker）",
      },
      filename: {
        type: "string",
        description: "未传 targetKey 时的文件名",
      },
      threshold: {
        type: "number",
        description: "trim_png 裁剪阈值（默认 10）",
      },
      width: {
        type: "number",
        description: "svg_to_png 输出宽度（默认 2048）",
      },
      height: {
        type: "number",
        description: "svg_to_png 输出高度（默认 2048）",
      },
      angle: {
        type: "number",
        description: "rotate 旋转角度（90 / 180 / 270）",
      },
      suffix: {
        type: "string",
        description: "rotate 输出格式后缀（png / jpg / jpeg / webp / avif）",
      },
    },
    handler: async (args) => {
      const op = String(args?.op || "").trim() as ImageTransformOp;
      const sourceUrl = String(args?.sourceUrl || "").trim();
      if (!sourceUrl) {
        return { success: false, error: "缺少源图片地址 sourceUrl" };
      }
      if (!["trim_png", "svg_to_png", "rotate"].includes(op)) {
        return { success: false, error: `不支持的图像处理操作: ${op}` };
      }

      const tmpDir = os.tmpdir();
      let tmpFile = "";
      try {
        const input = await downloadBuffer(sourceUrl);
        let outBuffer: Buffer;
        let outExt = "png";

        if (op === "trim_png") {
          const threshold = Number.isFinite(Number(args?.threshold))
            ? Number(args.threshold)
            : 10;
          outBuffer = await sharp(input, { limitInputPixels: false, failOn: "none" })
            .ensureAlpha()
            .trim({ threshold })
            .png()
            .toBuffer();
          outExt = "png";
        } else if (op === "svg_to_png") {
          const width = Math.max(64, Math.min(8192, Number(args?.width) || 2048));
          const height = Math.max(64, Math.min(8192, Number(args?.height) || 2048));
          outBuffer = await sharp(input, {
            limitInputPixels: false,
            failOn: "none",
            density: 300,
          })
            .resize(width, height, {
              fit: "contain",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
          outExt = "png";
        } else {
          const angle = ((Math.round(Number(args?.angle) || 0) % 360) + 360) % 360;
          if (![90, 180, 270].includes(angle)) {
            return { success: false, error: `不支持的旋转角度: ${args?.angle}` };
          }
          const suffix = String(args?.suffix || "png")
            .toLowerCase()
            .replace(/^\./, "");
          let pipeline = sharp(input, {
            limitInputPixels: false,
            failOn: "none",
          }).rotate(angle);
          if (suffix === "jpg" || suffix === "jpeg") {
            pipeline = pipeline.jpeg({ quality: 92 });
            outExt = suffix;
          } else if (suffix === "webp") {
            pipeline = pipeline.webp({ quality: 92 });
            outExt = "webp";
          } else if (suffix === "avif") {
            pipeline = pipeline.avif({ quality: 85 });
            outExt = "avif";
          } else {
            pipeline = pipeline.png();
            outExt = "png";
          }
          outBuffer = await pipeline.toBuffer();
        }

        const meta = await sharp(outBuffer, {
          limitInputPixels: false,
          failOn: "none",
        }).metadata();

        tmpFile = path.join(
          tmpDir,
          `yishe_img_transform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${outExt}`,
        );
        fs.writeFileSync(tmpFile, outBuffer);

        const explicitKey = String(args?.targetKey || "").trim().replace(/^\/+/, "");
        const category = String(args?.category || "sticker").trim() || "sticker";
        const filename =
          String(args?.filename || "").trim() ||
          `${op}_${Date.now()}.${outExt}`;
        const cosKey =
          explicitKey ||
          generateCosKey({
            category,
            filename,
          });

        const uploaded = await uploadFileToCos(tmpFile, cosKey);
        if (!uploaded?.success || !uploaded?.url) {
          return {
            success: false,
            error: uploaded?.error || "客户端直传 COS 失败",
          };
        }

        return {
          success: true,
          data: {
            url: uploaded.url,
            key: uploaded.key || cosKey,
            width: meta.width || 0,
            height: meta.height || 0,
            size: outBuffer.length,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      } finally {
        if (tmpFile) {
          try {
            fs.unlinkSync(tmpFile);
          } catch {}
        }
      }
    },
  });
}
