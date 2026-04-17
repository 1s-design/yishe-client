import { Composition } from "remotion";
import React from "react";
import type { ZodType } from "zod";
import { templateCatalog } from "../templates/registry";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {templateCatalog.map((template) => {
        const component =
          template.component as React.ComponentType<Record<string, unknown>>;
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
              return {
                durationInFrames: Number(
                  safeProps.durationInFrames || template.durationInFrames || 240,
                ),
                fps: Number(safeProps.fps || template.fps || 30),
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
