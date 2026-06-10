import type { SmartObjectConfig } from "../api/photoshop";

type ResizeMode = NonNullable<SmartObjectConfig["resize_mode"]>;

export interface PsdSmartObjectSlot {
  smart_object_name?: string;
  resize_mode?: ResizeMode;
  custom_options?: SmartObjectConfig["custom_options"];
  tile_size?: number;
  background_image_path?: string;
  [key: string]: any;
}

export interface PsdSmartObjectMappingInput {
  imagePaths: string[];
  configuredSmartObjects?: PsdSmartObjectSlot[];
  analyzedSmartObjects?: Array<{
    name?: string;
    path?: string;
    [key: string]: any;
  }>;
  defaultResizeMode?: ResizeMode;
}

export interface PsdSmartObjectMappingResult {
  smartObjects: SmartObjectConfig[];
  strategy: "configured-slots" | "configured-template-expanded-by-analysis" | "analyzed-psd-slots" | "image-count-slots";
  caseKey:
    | "single-image-single-slot"
    | "single-image-multiple-slots"
    | "multiple-images-single-slot"
    | "multiple-images-equal-slots"
    | "multiple-images-fewer-than-slots"
    | "multiple-images-more-than-slots";
  caseDescription: string;
  slotCount: number;
  imageCount: number;
  reusedLastImage: boolean;
  appendedImageSlots: number;
}

const DEFAULT_RESIZE_MODE: ResizeMode = "contain";
const IGNORE_SMART_OBJECT_MARKER = "ignore";

function normalizeImagePaths(imagePaths: string[]) {
  return imagePaths.map((item) => String(item || "").trim()).filter(Boolean);
}

function isProcessableAnalyzedSmartObject(item: any) {
  const name = String(item?.name || "").trim();
  return !name.toLowerCase().includes(IGNORE_SMART_OBJECT_MARKER);
}

function getAnalyzedSmartObjectIdentity(item: any) {
  const smartObject = item?.smart_object || {};
  const uniqueId = String(smartObject?.unique_id || "").trim();
  if (uniqueId) {
    return `unique:${uniqueId}`;
  }

  const path = String(item?.path || "").trim();
  const name = String(item?.name || "").trim();
  const bounds = item?.bounds || {};
  const position = item?.position || {};
  const size = item?.size || {};
  const x1 = bounds.x1 ?? bounds.left ?? position.left ?? position.x ?? "";
  const y1 = bounds.y1 ?? bounds.top ?? position.top ?? position.y ?? "";
  const x2 = bounds.x2 ?? bounds.right ?? position.right ?? "";
  const y2 = bounds.y2 ?? bounds.bottom ?? position.bottom ?? "";
  const width = size.width ?? item?.width ?? "";
  const height = size.height ?? item?.height ?? "";

  return [
    "geometry",
    path,
    name,
    String(x1),
    String(y1),
    String(x2),
    String(y2),
    String(width),
    String(height),
  ].join("|");
}

function dedupeAnalyzedSmartObjects(items: NonNullable<PsdSmartObjectMappingInput["analyzedSmartObjects"]>) {
  const result: NonNullable<PsdSmartObjectMappingInput["analyzedSmartObjects"]> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const identity = getAnalyzedSmartObjectIdentity(item);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(item);
  }
  return result;
}

function buildSlotsFromAnalysis(analyzedSmartObjects?: PsdSmartObjectMappingInput["analyzedSmartObjects"]) {
  if (!Array.isArray(analyzedSmartObjects)) {
    return [];
  }

  return dedupeAnalyzedSmartObjects(analyzedSmartObjects)
    .filter(isProcessableAnalyzedSmartObject)
    .map((item) => {
      const name = String(item?.name || "").trim();
      return name ? { smart_object_name: name } : {};
    });
}

function resolveSlotSource(input: {
  configuredSlots: PsdSmartObjectSlot[];
  analyzedSlots: PsdSmartObjectSlot[];
  imageCount: number;
}): {
  slots: PsdSmartObjectSlot[];
  strategy: PsdSmartObjectMappingResult["strategy"];
} {
  if (input.configuredSlots.length === 1 && input.analyzedSlots.length > 1) {
    const templateSlot = input.configuredSlots[0];
    return {
      slots: input.analyzedSlots.map((analyzedSlot) => ({
        ...templateSlot,
        ...analyzedSlot,
      })),
      strategy: "configured-template-expanded-by-analysis",
    };
  }

  if (input.configuredSlots.length > 0) {
    return {
      slots: input.configuredSlots,
      strategy: "configured-slots",
    };
  }

  if (input.analyzedSlots.length > 0) {
    return {
      slots: input.analyzedSlots,
      strategy: "analyzed-psd-slots",
    };
  }

  return {
    slots: Array.from({ length: input.imageCount }, () => ({})),
    strategy: "image-count-slots",
  };
}

function describeMappingCase(imageCount: number, slotCount: number): {
  caseKey: PsdSmartObjectMappingResult["caseKey"];
  caseDescription: string;
} {
  if (imageCount === 1 && slotCount <= 1) {
    return {
      caseKey: "single-image-single-slot",
      caseDescription: "单图 + 单智能对象：一张素材图替换唯一槽位。",
    };
  }

  if (imageCount === 1 && slotCount > 1) {
    return {
      caseKey: "single-image-multiple-slots",
      caseDescription: "单图 + 多智能对象：同一张素材图复用到所有智能对象槽位。",
    };
  }

  if (imageCount > 1 && slotCount <= 1) {
    return {
      caseKey: "multiple-images-single-slot",
      caseDescription:
        "多图 + 单智能对象：第一张图替换已有槽位，其余图片追加为无名称槽位，交给 PS 服务按顺序匹配。",
    };
  }

  if (imageCount === slotCount) {
    return {
      caseKey: "multiple-images-equal-slots",
      caseDescription: "多图 + 多智能对象且数量相等：图片和槽位按顺序一一匹配。",
    };
  }

  if (imageCount < slotCount) {
    return {
      caseKey: "multiple-images-fewer-than-slots",
      caseDescription: "多图少于智能对象：前面的图片按顺序匹配，剩余槽位复用最后一张图。",
    };
  }

  return {
    caseKey: "multiple-images-more-than-slots",
    caseDescription: "多图多于智能对象：已有槽位按顺序匹配，额外图片追加为无名称槽位。",
  };
}

function applyImagesToSlots(input: {
  slots: PsdSmartObjectSlot[];
  imagePaths: string[];
  defaultResizeMode: ResizeMode;
}) {
  return input.slots.map((slot, index) => {
    const actualIndex = Math.min(index, input.imagePaths.length - 1);
    return {
      ...slot,
      image_path: input.imagePaths[actualIndex],
      resize_mode: slot.resize_mode || input.defaultResizeMode,
    };
  });
}

function appendExtraImageSlots(input: {
  smartObjects: SmartObjectConfig[];
  imagePaths: string[];
  slotCount: number;
  defaultResizeMode: ResizeMode;
}) {
  let appendedImageSlots = 0;
  if (input.imagePaths.length <= input.slotCount) {
    return appendedImageSlots;
  }

  for (let index = input.slotCount; index < input.imagePaths.length; index++) {
    input.smartObjects.push({
      image_path: input.imagePaths[index],
      resize_mode: input.defaultResizeMode,
    });
    appendedImageSlots += 1;
  }
  return appendedImageSlots;
}

/**
 * Build the Photoshop /processPsd smart_objects payload from input images and
 * optional PSD slot metadata.
 *
 * Mapping contract:
 * 1. Configured smart_objects are authoritative when present. Their order and
 *    smart_object_name fields define the intended PSD slots.
 * 2. One configured smart object can act as a template. If PSD analysis finds
 *    multiple smart objects, that one configured item is expanded across all
 *    analyzed slots. This covers "one image + many PSD smart objects" even
 *    when a template only saved one default smart_objects entry.
 * 3. When there is no configured slot list, analyzed PSD smart objects define
 *    the slots. This makes "one input image + many PSD smart objects" replace
 *    every processable smart object instead of only the first one.
 * 4. When neither configured slots nor PSD analysis are available, we fall back
 *    to one slot per image.
 * 5. Images are assigned by order. If there are fewer images than slots, the
 *    last image is reused for the remaining slots. If there are more images
 *    than slots, extra image-only slots are appended so no input image is
 *    silently dropped.
 * 6. Final smart object matching inside Photoshop still follows the PS service
 *    rules: smart_object_name exact match, then contains match, then remaining
 *    PSD smart objects by discovery order.
 * 7. Duplicate smart object names are allowed. Repeated smart_object_name values
 *    intentionally produce repeated slots; the PS service matches each slot to
 *    the next unused layer with that name.
 *
 * Situation guide:
 * - Single image + single slot:
 *   The one image replaces the one configured/analyzed/default slot.
 * - Single image + multiple slots:
 *   The one image is reused for every slot. This is the expected behavior for
 *   one artwork rendered into multiple mockup positions in the same PSD.
 * - Multiple images + equal slot count:
 *   Images and slots are paired by index.
 * - Multiple images + fewer images than slots:
 *   Images are paired by index until they run out, then the last image is
 *   reused. This keeps every declared PSD slot populated.
 * - Multiple images + more images than slots:
 *   Existing slots are filled first, then image-only slots are appended. The PS
 *   service will match those appended slots to remaining PSD smart objects by
 *   discovery order.
 */
export function buildPsdSmartObjectMappings(input: PsdSmartObjectMappingInput): PsdSmartObjectMappingResult {
  const imagePaths = normalizeImagePaths(input.imagePaths);
  if (!imagePaths.length) {
    throw new Error("缺少可用于替换智能对象的素材图片");
  }

  const configuredSlots = Array.isArray(input.configuredSmartObjects)
    ? input.configuredSmartObjects
    : [];
  const analyzedSlots = buildSlotsFromAnalysis(input.analyzedSmartObjects);
  const defaultResizeMode = input.defaultResizeMode || DEFAULT_RESIZE_MODE;
  const slotSource = resolveSlotSource({
    configuredSlots,
    analyzedSlots,
    imageCount: imagePaths.length,
  });
  const slotCount = slotSource.slots.length;
  const caseInfo = describeMappingCase(imagePaths.length, slotCount);
  const smartObjects = applyImagesToSlots({
    slots: slotSource.slots,
    imagePaths,
    defaultResizeMode,
  });
  const appendedImageSlots = appendExtraImageSlots({
    smartObjects,
    imagePaths,
    slotCount,
    defaultResizeMode,
  });

  return {
    smartObjects,
    strategy: slotSource.strategy,
    caseKey: caseInfo.caseKey,
    caseDescription: caseInfo.caseDescription,
    slotCount,
    imageCount: imagePaths.length,
    reusedLastImage: imagePaths.length < slotCount,
    appendedImageSlots,
  };
}
