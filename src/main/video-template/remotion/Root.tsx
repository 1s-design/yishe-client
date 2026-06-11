import { Composition } from "remotion";
import React from "react";
import type { ZodType } from "zod";
import { templateCatalog } from "../templates/registry";
import {
  AiUniversalComposition,
  AiVideoSchema,
} from "../templates/ai-universal-composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* AI Universal Composition — accepts dynamic SceneGraph from AI agent */}
      <Composition
        id="AiUniversal"
        component={
          AiUniversalComposition as unknown as React.ComponentType<
            Record<string, unknown>
          >
        }
        schema={AiVideoSchema as ZodType<Record<string, unknown>>}
        defaultProps={{
          videoConfig: {
            meta: { title: "AI Video" },
            palette: { preset: "noirGold" },
            scenes: [
              { duration: 5, layers: [{ type: "headline", text: "AI Video" }] },
            ],
          },
        }}
        calculateMetadata={async ({ props }) => {
          const safeProps = props as Record<string, unknown>;
          const config = (safeProps.videoConfig || {}) as Record<
            string,
            unknown
          >;
          const meta = (config.meta || {}) as Record<string, unknown>;
          const scenes = Array.isArray(config.scenes) ? config.scenes : [];
          const targetFps = Number(meta.fps || 30);
          const orientation = String(meta.orientation || "portrait");
          const totalFrames = scenes.reduce(
            (sum: number, s: Record<string, unknown>) => {
              const dur = Number(s.duration || 3);
              return sum + Math.max(1, Math.round(dur * targetFps));
            },
            0,
          );
          const isLandscape = orientation === "landscape";
          const isSquare = orientation === "square";
          return {
            durationInFrames: Math.max(totalFrames, 30),
            fps: targetFps,
            width: isSquare ? 1080 : isLandscape ? 1920 : 1080,
            height: isSquare ? 1080 : isLandscape ? 1080 : 1920,
          };
        }}
      />

      {templateCatalog.map((template) => {
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
            calculateMetadata={async ({ props }) => {
              const safeProps = props as Record<string, unknown>;
              const fps = Number(safeProps.fps || template.fps || 30);
              const imageItems = Array.isArray(safeProps.images)
                ? safeProps.images
                : typeof safeProps.images === "string"
                  ? (() => {
                      try {
                        const parsed = JSON.parse(safeProps.images);
                        return Array.isArray(parsed) ? parsed : [];
                      } catch {
                        return [];
                      }
                    })()
                  : [];
              const imageDurationInFrames = imageItems.length
                ? imageItems.reduce((sum, item) => {
                    const durationSeconds = Number(
                      (item as Record<string, unknown>)?.durationSeconds || 3,
                    );
                    return (
                      sum +
                      Math.max(
                        1,
                        Math.round(
                          (Number.isFinite(durationSeconds)
                            ? durationSeconds
                            : 3) * fps,
                        ),
                      )
                    );
                  }, 0)
                : 0;
              return {
                durationInFrames: Number(
                  imageDurationInFrames ||
                    safeProps.durationInFrames ||
                    template.durationInFrames ||
                    240,
                ),
                fps,
                width: Number(safeProps.width || template.width || 1080),
                height: Number(safeProps.height || template.height || 1920),
                props: safeProps,
              };
            }}
          />
        );
      })}
    </>
  );
};
