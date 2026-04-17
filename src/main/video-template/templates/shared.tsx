import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type Palette = {
  background: string;
  backgroundAlt: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentAlt: string;
  glow: string;
};

export type MediaSource = {
  type: "image" | "video";
  src: string;
  poster?: string;
  alt?: string;
};

export type MetricItem = {
  label: string;
  value: string;
  detail?: string;
};

export type FeatureItem = {
  eyebrow?: string;
  title: string;
  text: string;
};

export const clamp01 = (value: number) => {
  return Math.max(0, Math.min(1, value));
};

export const mix = (from: number, to: number, progress: number) => {
  return from + (to - from) * clamp01(progress);
};

export const alpha = (hex: string, opacity: number) => {
  const cleaned = hex.replace("#", "");
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((char) => char + char)
          .join("")
      : cleaned.padEnd(6, "0").slice(0, 6);

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${clamp01(opacity)})`;
};

export const formatDurationLabel = ({
  fps,
  durationInFrames,
}: {
  fps: number;
  durationInFrames: number;
}) => {
  const seconds = durationInFrames / fps;
  if (seconds >= 60) {
    return `${(seconds / 60).toFixed(1)} min`;
  }

  return `${seconds.toFixed(0)} s`;
};

export const useEntrance = (delayFrames = 0, damping = 16, stiffness = 120) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: {
      damping,
      stiffness,
      mass: 0.8,
    },
  });
};

export const sceneWindow = ({
  frame,
  start,
  end,
  fadeIn = 16,
  fadeOut = 18,
}: {
  frame: number;
  start: number;
  end: number;
  fadeIn?: number;
  fadeOut?: number;
}) => {
  const enter = interpolate(frame, [start, start + fadeIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [end - fadeOut, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return Math.min(enter, exit);
};

export const GradientStage: React.FC<{
  palette: Palette;
  frame?: number;
  children?: React.ReactNode;
}> = ({ palette, frame = 0, children }) => {
  const driftA = Math.sin(frame / 48) * 6;
  const driftB = Math.cos(frame / 62) * 5;
  const shimmerX = ((frame * 1.4) % 180) - 40;
  const shimmerY = Math.sin(frame / 42) * 10;
  const pulse = 0.24 + ((Math.sin(frame / 56) + 1) / 2) * 0.12;
  const grainOffset = (frame * 0.8) % 120;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${palette.background} 0%, ${palette.backgroundAlt} 52%, ${palette.surface} 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-18% auto auto -12%",
          width: "58%",
          height: "58%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${alpha(palette.glow, 0.72)} 0%, ${alpha(palette.accent, 0.18)} 42%, transparent 72%)`,
          filter: "blur(40px)",
          transform: `translateY(${driftA}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "auto -8% -18% auto",
          width: "50%",
          height: "50%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${alpha(palette.accentAlt, 0.44)} 0%, transparent 66%)`,
          filter: "blur(56px)",
          transform: `translateY(${driftB}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-12% -8% auto auto",
          width: "48%",
          height: "32%",
          background: `linear-gradient(112deg, transparent 0%, ${alpha("#ffffff", 0.1)} 36%, transparent 72%)`,
          transform: `translate(${shimmerX}px, ${shimmerY}px) rotate(-9deg)`,
          opacity: pulse,
          filter: "blur(12px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${alpha("#ffffff", 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha("#ffffff", 0.05)} 1px, transparent 1px)`,
          backgroundSize: "96px 96px",
          maskImage:
            "radial-gradient(circle at center, rgba(0,0,0,0.95), rgba(0,0,0,0.4) 58%, transparent 100%)",
          opacity: 0.22,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(0deg, ${alpha("#ffffff", 0.028)} 0px, ${alpha("#ffffff", 0.028)} 1px, transparent 1px, transparent 4px), repeating-linear-gradient(90deg, ${alpha("#000000", 0.028)} 0px, ${alpha("#000000", 0.028)} 1px, transparent 1px, transparent 5px)`,
          backgroundPosition: `${grainOffset}px ${grainOffset / 2}px`,
          opacity: 0.22,
          mixBlendMode: "soft-light",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at center, transparent 42%, ${alpha(palette.background, 0.32)} 100%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${alpha("#ffffff", 0.06)} 0%, transparent 18%, transparent 72%, ${alpha("#000000", 0.22)} 100%)`,
          pointerEvents: "none",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

export const StageFrame: React.FC<{
  palette: Palette;
  radius?: number;
  padding?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ palette, radius = 34, padding = 28, children, style }) => {
  const frame = useCurrentFrame();
  const topSweep = Math.sin(frame / 34) * 12;
  const diagonalSweep = ((frame * 1.1) % 180) - 46;
  const microGridOffset = (frame * 0.7) % 120;
  const cornerPulse = 0.56 + ((Math.sin(frame / 24) + 1) / 2) * 0.28;

  return (
    <div
      style={{
        position: "relative",
        borderRadius: radius,
        overflow: "hidden",
        padding,
        border: `1px solid ${alpha("#ffffff", 0.12)}`,
        background: `linear-gradient(180deg, ${alpha("#ffffff", 0.12)} 0%, ${alpha(palette.surface, 0.74)} 100%)`,
        boxShadow: `0 28px 80px ${alpha("#000000", 0.34)}, inset 0 1px 0 ${alpha("#ffffff", 0.12)}`,
        backdropFilter: "blur(18px)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: Math.max(0, radius - 1),
          border: `1px solid ${alpha("#ffffff", 0.06)}`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(0deg, ${alpha("#ffffff", 0.022)} 0px, ${alpha("#ffffff", 0.022)} 1px, transparent 1px, transparent 6px), repeating-linear-gradient(90deg, ${alpha("#000000", 0.024)} 0px, ${alpha("#000000", 0.024)} 1px, transparent 1px, transparent 7px)`,
          backgroundPosition: `${microGridOffset}px ${microGridOffset / 2}px`,
          opacity: 0.22,
          mixBlendMode: "soft-light",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "6%",
          right: "14%",
          top: -42,
          height: 88,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha("#ffffff", 0.16)} 24%, ${alpha("#ffffff", 0.04)} 52%, transparent 100%)`,
          transform: `translateX(${topSweep}px) rotate(-6deg)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-18%",
          left: `${diagonalSweep}%`,
          width: "34%",
          height: "148%",
          background: `linear-gradient(90deg, transparent 0%, ${alpha("#ffffff", 0.14)} 50%, transparent 100%)`,
          transform: "rotate(16deg)",
          mixBlendMode: "screen",
          opacity: 0.2,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at top right, ${alpha(palette.accentAlt, 0.18)} 0%, transparent 34%), radial-gradient(circle at bottom left, ${alpha(palette.accent, 0.12)} 0%, transparent 30%)`,
          pointerEvents: "none",
        }}
      />
      {[
        { top: 14, left: 14, verticalOrigin: "top", horizontalOrigin: "left" },
        { top: 14, right: 14, verticalOrigin: "top", horizontalOrigin: "right" },
        { bottom: 14, left: 14, verticalOrigin: "bottom", horizontalOrigin: "left" },
        { bottom: 14, right: 14, verticalOrigin: "bottom", horizontalOrigin: "right" },
      ].map((corner, index) => (
        <div
          key={`frame-corner-${index}`}
          style={{
            position: "absolute",
            width: 26,
            height: 26,
            pointerEvents: "none",
            ...corner,
          }}
        >
          <div
            style={{
              position: "absolute",
              [corner.verticalOrigin]: 0,
              [corner.horizontalOrigin]: 0,
              width: 2,
              height: 24,
              borderRadius: 999,
              background: alpha(
                index % 2 === 0 ? palette.accent : palette.accentAlt,
                cornerPulse,
              ),
              boxShadow: `0 0 14px ${alpha(
                index % 2 === 0 ? palette.accent : palette.accentAlt,
                0.18,
              )}`,
            }}
          />
          <div
            style={{
              position: "absolute",
              [corner.verticalOrigin]: 0,
              [corner.horizontalOrigin]: 0,
              width: 24,
              height: 2,
              borderRadius: 999,
              background: alpha(
                index % 2 === 0 ? palette.accentAlt : palette.accent,
                cornerPulse,
              ),
              boxShadow: `0 0 14px ${alpha(
                index % 2 === 0 ? palette.accentAlt : palette.accent,
                0.18,
              )}`,
            }}
          />
        </div>
      ))}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gap: 0,
          height:
            typeof style?.height === "number" || typeof style?.height === "string"
              ? "100%"
              : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const TagPill: React.FC<{
  text: string;
  palette: Palette;
  light?: boolean;
}> = ({ text, palette, light = false }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px 10px 14px",
        borderRadius: 999,
        background: light
          ? alpha("#ffffff", 0.16)
          : `linear-gradient(135deg, ${alpha(palette.accent, 0.95)} 0%, ${alpha(palette.accentAlt, 0.95)} 100%)`,
        border: `1px solid ${alpha("#ffffff", light ? 0.18 : 0.1)}`,
        boxShadow: light
          ? `inset 0 1px 0 ${alpha("#ffffff", 0.12)}`
          : `0 14px 34px ${alpha(palette.accent, 0.24)}`,
        color: light ? palette.text : "#0b1020",
        fontWeight: 700,
        letterSpacing: "0.05em",
        fontSize: 20,
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: light
            ? alpha("#ffffff", 0.82)
            : alpha("#08111e", 0.76),
          boxShadow: light
            ? `0 0 14px ${alpha("#ffffff", 0.22)}`
            : `0 0 14px ${alpha("#08111e", 0.16)}`,
        }}
      />
      {text}
    </div>
  );
};

export const SectionEyebrow: React.FC<{
  text: string;
  palette: Palette;
}> = ({ text, palette }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        fontSize: 21,
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: alpha(palette.text, 0.7),
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 38,
          height: 1,
          background: `linear-gradient(90deg, ${alpha(palette.accentAlt, 0.78)} 0%, ${alpha("#ffffff", 0.06)} 100%)`,
        }}
      />
      {text}
    </div>
  );
};

export const MediaSurface: React.FC<{
  media: MediaSource;
  palette: Palette;
  radius?: number;
  frame?: number;
  style?: React.CSSProperties;
}> = ({ media, palette, radius = 36, frame = 0, style }) => {
  const zoom = mix(1.08, 1, frame / 60);
  const translateX = Math.sin(frame / 34) * 10;
  const translateY = Math.cos(frame / 41) * 6;
  const sheenX = ((frame * 1.8) % 170) - 40;
  const focusX = 52 + Math.sin(frame / 22) * 18;
  const scanOffset = (frame * 1.15) % 110;
  const focusPulse = 0.08 + ((Math.sin(frame / 18) + 1) / 2) * 0.08;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        background: `linear-gradient(135deg, ${alpha(palette.backgroundAlt, 0.92)} 0%, ${alpha(palette.surface, 0.92)} 100%)`,
        border: `1px solid ${alpha("#ffffff", 0.16)}`,
        boxShadow: `0 26px 72px ${alpha("#000000", 0.36)}, inset 0 1px 0 ${alpha("#ffffff", 0.1)}`,
        ...style,
      }}
    >
      {media.src ? (
        media.type === "video" ? (
          <OffthreadVideo
            src={media.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoom}) translate(${translateX}px, ${translateY}px)`,
            }}
          />
        ) : (
          <Img
            src={media.src}
            alt={media.alt}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoom}) translate(${translateX}px, ${translateY}px)`,
            }}
          />
        )
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
            alignItems: "center",
            justifyContent: "center",
            color: "#08111e",
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          Upload Media
        </AbsoluteFill>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${alpha("#ffffff", 0.18)} 0%, transparent 24%, transparent 70%, ${alpha("#000000", 0.38)} 100%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(135deg, ${alpha("#ffffff", 0.022)} 0px, ${alpha("#ffffff", 0.022)} 1px, transparent 1px, transparent 10px)`,
          backgroundPosition: `${scanOffset}px ${scanOffset / 2}px`,
          opacity: 0.22,
          mixBlendMode: "soft-light",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-18%",
          left: `${sheenX}%`,
          width: "42%",
          height: "140%",
          background: `linear-gradient(90deg, transparent 0%, ${alpha("#ffffff", 0.18)} 52%, transparent 100%)`,
          transform: "rotate(12deg)",
          mixBlendMode: "screen",
          opacity: 0.42,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at ${focusX}% 20%, ${alpha(
            "#ffffff",
            0.16 + focusPulse,
          )} 0%, transparent 24%)`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: Math.max(0, radius - 1),
          border: `1px solid ${alpha("#ffffff", 0.08)}`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at top right, ${alpha("#ffffff", 0.16)} 0%, transparent 26%), radial-gradient(circle at center, transparent 48%, ${alpha("#000000", 0.16)} 100%)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

export const MetricGrid: React.FC<{
  items: MetricItem[];
  palette: Palette;
  columns?: number;
}> = ({ items, palette, columns = 2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const safeColumns = Math.max(1, Math.min(4, columns));
  const activeMetricIndex =
    items.length > 0 ? Math.floor(frame / 42) % items.length : 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))`,
        gap: 18,
      }}
    >
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 4),
          fps,
          config: { damping: 16, stiffness: 118, mass: 0.82 },
        });
        const active = index === activeMetricIndex;

        return (
          <StageFrame
            key={`${item.label}-${index}`}
            palette={palette}
            radius={24}
            padding={22}
            style={{
              transform: `translateY(${mix(24, 0, reveal)}px) scale(${
                active ? 1.02 : mix(0.96, 1, reveal)
              })`,
              opacity: mix(0.4, 1, reveal),
              borderColor: active
                ? alpha(palette.accentAlt, 0.24)
                : alpha("#ffffff", 0.12),
            }}
          >
            <div
              style={{
                fontSize: 18,
                color: active
                  ? alpha(palette.accentAlt, 0.92)
                  : alpha(palette.text, 0.64),
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                marginBottom: 12,
                fontWeight: active ? 800 : 700,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: palette.text,
                marginBottom: item.detail ? 8 : 0,
                fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
                fontVariantNumeric: "tabular-nums",
                transform: `translateY(${mix(12, 0, reveal)}px)`,
              }}
            >
              {item.value}
            </div>
            {item.detail ? (
              <div
                style={{
                  fontSize: 18,
                  color: alpha(palette.text, active ? 0.82 : 0.74),
                  lineHeight: 1.5,
                }}
              >
                {item.detail}
              </div>
            ) : null}
          </StageFrame>
        );
      })}
    </div>
  );
};

export const FeatureStack: React.FC<{
  items: FeatureItem[];
  palette: Palette;
}> = ({ items, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activeIndex = items.length > 0 ? Math.floor(frame / 48) % items.length : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 5),
          fps,
          config: { damping: 16, stiffness: 112, mass: 0.84 },
        });
        const active = index === activeIndex;

        return (
          <StageFrame
            key={`${item.title}-${index}`}
            palette={palette}
            radius={26}
            padding={24}
            style={{
              transform: `translateY(${mix(26, 0, reveal)}px) scale(${
                active ? 1.015 : mix(0.97, 1, reveal)
              })`,
              opacity: mix(0.42, 1, reveal),
              borderColor: active
                ? alpha(palette.accentAlt, 0.26)
                : alpha("#ffffff", 0.12),
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              {item.eyebrow ? (
                <div
                  style={{
                    fontSize: 18,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: alpha(palette.accentAlt, active ? 0.98 : 0.92),
                    fontWeight: 700,
                  }}
                >
                  {item.eyebrow}
                </div>
              ) : <div />}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: active
                    ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                    : alpha("#ffffff", 0.08),
                  color: active ? "#08111e" : palette.text,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  boxShadow: active
                    ? `0 0 18px ${alpha(palette.accent, 0.2)}`
                    : "none",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </div>
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: palette.text,
                marginBottom: 10,
                lineHeight: 1.15,
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                fontSize: 20,
                lineHeight: 1.55,
                color: alpha(palette.text, active ? 0.84 : 0.78),
              }}
            >
              {item.text}
            </div>
          </StageFrame>
        );
      })}
    </div>
  );
};

export const ProgressBarRow: React.FC<{
  items: Array<{ label: string; value: number; color?: string }>;
  palette: Palette;
}> = ({ items, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 4),
          fps,
          config: { damping: 15, stiffness: 120, mass: 0.84 },
        });

        return (
          <div
            key={`${item.label}-${index}`}
            style={{
              display: "grid",
              gap: 10,
              padding: "10px 12px 12px",
              borderRadius: 20,
              background: alpha("#ffffff", 0.05),
              border: `1px solid ${alpha("#ffffff", 0.06)}`,
              transform: `translateY(${mix(18, 0, reveal)}px)`,
              opacity: mix(0.4, 1, reveal),
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: palette.text,
                fontSize: 20,
              }}
            >
              <span>{item.label}</span>
              <span>{Math.round(item.value)}%</span>
            </div>
            <div
              style={{
                height: 12,
                borderRadius: 999,
                background: alpha("#ffffff", 0.12),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${clamp01(item.value / 100) * reveal * 100}%`,
                  borderRadius: 999,
                  background: item.color
                    ? item.color
                    : `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                  boxShadow: `0 0 16px ${alpha(item.color || palette.accent, 0.28)}`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const FooterNote: React.FC<{
  left: string;
  right: string;
  palette: Palette;
}> = ({ left, right, palette }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 48,
        bottom: 32,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: alpha(palette.text, 0.66),
        fontSize: 18,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        paddingTop: 14,
        borderTop: `1px solid ${alpha("#ffffff", 0.08)}`,
      }}
    >
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
};
