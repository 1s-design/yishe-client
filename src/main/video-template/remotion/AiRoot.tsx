import { Composition } from "remotion";
import React from "react";
import type { ZodType } from "zod";
import { aiTemplateCatalog } from "../templates/ai-registry";

function resolveAiMetadata(
  template: (typeof aiTemplateCatalog)[number],
  props: Record<string, unknown>,
) {
  const config = (props.videoConfig || {}) as Record<string, unknown>;
  const meta = (config.meta || {}) as Record<string, unknown>;
  const scenes = Array.isArray(config.scenes) ? config.scenes : [];
  const targetFps = Number(meta.fps || props.fps || template.fps || 30);
  const orientation = String(meta.orientation || "portrait");
  const totalFrames = scenes.reduce((sum: number, scene) => {
    const duration = Number((scene as Record<string, unknown>)?.duration || 3);
    return (
      sum +
      Math.max(
        1,
        Math.round((Number.isFinite(duration) ? duration : 3) * targetFps),
      )
    );
  }, 0);
  const isLandscape = orientation === "landscape";
  const isSquare = orientation === "square";

  return {
    durationInFrames: Math.max(
      totalFrames || Number(props.durationInFrames || template.durationInFrames),
      30,
    ),
    fps: targetFps,
    width: Number(
      props.width || (isSquare ? 1080 : isLandscape ? 1920 : template.width),
    ),
    height: Number(
      props.height || (isSquare ? 1080 : isLandscape ? 1080 : template.height),
    ),
    props,
  };
}

export const AiRemotionRoot: React.FC = () => {
  return (
    <>
      {aiTemplateCatalog.map((template) => {
        const component = template.component as React.ComponentType<
          Record<string, unknown>
        >;
        const schema = template.schema as ZodType<Record<string, unknown>>;
        const defaultProps = template.defaultInputProps as Record<
          string,
          unknown
        >;

        return (
          <Composition
            key={template.id}
            id={template.compositionId}
            component={component}
            schema={schema}
            defaultProps={defaultProps}
            calculateMetadata={async ({ props }) =>
              resolveAiMetadata(template, props as Record<string, unknown>)
            }
          />
        );
      })}
    </>
  );
};
