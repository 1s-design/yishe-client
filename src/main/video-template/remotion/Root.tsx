import { Composition } from "remotion";
import React from "react";
import type { ZodType } from "zod";
import { templateCatalog } from "../templates/registry";

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
