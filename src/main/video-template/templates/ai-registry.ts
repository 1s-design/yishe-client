import type { ComponentType } from "react";
import type { z } from "zod";
import {
  AiUniversalComposition,
  AiVideoSchema,
} from "./ai-universal-composition";
import { aiUniversalTemplateMetadata } from "./ai-metadata";
import type { TemplateExample } from "./registry";

type RuntimeTemplateIntegrityCheck = {
  id: string;
  compositionId: string;
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      error?: { message: string };
    };
  };
  defaultInputProps: Record<string, unknown>;
  editableFields: string[];
  example: TemplateExample;
};

const assertAiTemplateCatalogIntegrity = <
  T extends RuntimeTemplateIntegrityCheck[],
>(
  templates: T,
): T => {
  const idSet = new Set<string>();
  const compositionIdSet = new Set<string>();

  for (const template of templates) {
    if (!template.id.trim()) {
      throw new Error("AI Template id 不能为空");
    }

    if (idSet.has(template.id)) {
      throw new Error(`检测到重复 AI 模板 id: ${template.id}`);
    }
    idSet.add(template.id);

    if (compositionIdSet.has(template.compositionId)) {
      throw new Error(`检测到重复 AI compositionId: ${template.compositionId}`);
    }
    compositionIdSet.add(template.compositionId);

    const schemaResult = template.schema.safeParse(template.defaultInputProps);
    if (!schemaResult.success) {
      const errorMessage = schemaResult.error?.message ?? "未知 schema 错误";
      throw new Error(
        `AI 模板 ${template.id} 的 defaultInputProps 未通过 schema 校验: ${errorMessage}`,
      );
    }

    const missingEditableFields = template.editableFields.filter(
      (field) => !(field in template.defaultInputProps),
    );
    if (missingEditableFields.length > 0) {
      throw new Error(
        `AI 模板 ${template.id} 缺少 editableFields 对应默认值: ${missingEditableFields.join(", ")}`,
      );
    }
  }

  return templates;
};

export const aiTemplateCatalog = assertAiTemplateCatalogIntegrity([
  {
    ...aiUniversalTemplateMetadata,
    component: AiUniversalComposition as unknown as ComponentType<
      Record<string, unknown>
    >,
    schema: AiVideoSchema as unknown as z.ZodType<Record<string, unknown>>,
  },
]);
