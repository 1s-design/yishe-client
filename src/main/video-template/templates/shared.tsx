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

export const isLightPalette = (palette: Palette): boolean => {
  const hex = (palette?.background || "#000000").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 130;
};

export const isCyberPalette = (palette: Palette): boolean => {
  if (isLightPalette(palette)) return false;
  const bg = (palette?.background || "").toLowerCase();
  const accent = (palette?.accent || "").toLowerCase();
  return (
    bg === "#061018" ||
    bg === "#080318" ||
    bg === "#0a0f17" ||
    accent === "#51d0ff" ||
    accent === "#00f5d4" ||
    accent === "#63b8ff"
  );
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
  const safeFadeIn = Math.max(1, fadeIn);
  const safeFadeOut = Math.max(1, fadeOut);
  const enter = interpolate(frame, [start, start + safeFadeIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [end - safeFadeOut, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return Math.min(enter, exit);
};

export const GradientStage: React.FC<{
  palette: Palette;
  frame?: number;
  stageStyle?: string;
  children?: React.ReactNode;
}> = ({ palette, frame = 0, stageStyle, children }) => {
  const isLight = isLightPalette(palette);
  const driftA = Math.sin(frame / 48) * 6;
  const driftB = Math.cos(frame / 62) * 5;
  const shimmerX = ((frame * 1.4) % 180) - 40;
  const shimmerY = Math.sin(frame / 42) * 10;
  const pulse = 0.24 + ((Math.sin(frame / 56) + 1) / 2) * 0.12;
  const grainOffset = (frame * 0.8) % 120;

  // Determine effective style
  const effectiveStyle = stageStyle || (isLight ? "clean-studio" : undefined);

  // 1. Light mode / Clean Studio stage
  if (effectiveStyle === "clean-studio" || (isLight && effectiveStyle !== "aurora" && effectiveStyle !== "cyber-grid")) {
    // Detect warm/cream palette by accent hue for special warm treatment
    const isWarm = palette.background.startsWith("#fcf8") || palette.background.startsWith("#fcf9") || palette.background.startsWith("#faf9");
    const isNordic = palette.accent === "#059669" || palette.accent === "#10b981";
    const isVibrant = palette.accent === "#ff2a70" || palette.accent === "#e11d48";
    const sweepAngle = isWarm ? "160deg" : isNordic ? "145deg" : isVibrant ? "140deg" : "150deg";
    const midColor = isWarm ? palette.backgroundAlt : isNordic ? palette.backgroundAlt : palette.backgroundAlt;
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(${sweepAngle}, ${palette.background} 0%, ${midColor} 55%, ${palette.surface} 100%)`,
          overflow: "hidden",
        }}
      >
        {/* Primary accent glow blob */}
        <div
          style={{
            position: "absolute",
            inset: "-20% auto auto -10%",
            width: "65%",
            height: "65%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${alpha(palette.accent, isVibrant ? 0.18 : 0.12)} 0%, ${alpha(palette.glow, 0.05)} 48%, transparent 70%)`,
            filter: `blur(${isVibrant ? 60 : 70}px)`,
            transform: `translateY(${driftA}px)`,
          }}
        />
        {/* Secondary accent blob */}
        <div
          style={{
            position: "absolute",
            inset: "auto -10% -20% auto",
            width: "60%",
            height: "60%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${alpha(palette.accentAlt, isWarm ? 0.14 : 0.1)} 0%, transparent 65%)`,
            filter: `blur(${isWarm ? 60 : 80}px)`,
            transform: `translateY(${driftB}px)`,
          }}
        />
        {/* Subtle grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${alpha(palette.text, 0.024)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(palette.text, 0.024)} 1px, transparent 1px)`,
            backgroundSize: isNordic ? "70px 70px" : "80px 80px",
            opacity: 0.8,
            pointerEvents: "none",
          }}
        />
        {children}
      </AbsoluteFill>
    );
  }

  // 2. Aurora Fluid Mesh stage
  if (effectiveStyle === "aurora") {
    const waveX = Math.sin(frame / 36) * 40;
    const waveY = Math.cos(frame / 44) * 24;
    const rotAngle = (frame / 120) * 4;
    return (
      <AbsoluteFill
        style={{
          background: palette.background,
          overflow: "hidden",
        }}
      >
        {/* Main aurora blobs */}
        <div
          style={{
            position: "absolute",
            inset: "-30% -20% -30% -20%",
            background: `radial-gradient(ellipse at 30% 40%, ${alpha(palette.accent, 0.5)} 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, ${alpha(palette.accentAlt, 0.45)} 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, ${alpha(palette.glow, 0.4)} 0%, transparent 60%)`,
            filter: "blur(90px)",
            transform: `translateX(${waveX}px) translateY(${waveY}px) scale(1.1)`,
          }}
        />
        {/* Overlay shimmer layer */}
        <div
          style={{
            position: "absolute",
            inset: "-20% -20% -20% -20%",
            background: `radial-gradient(ellipse at 80% 20%, ${alpha(palette.glow, 0.3)} 0%, transparent 45%), radial-gradient(ellipse at 20% 80%, ${alpha(palette.accent, 0.25)} 0%, transparent 40%)`,
            filter: "blur(70px)",
            transform: `rotate(${rotAngle}deg)`,
          }}
        />
        {/* Noise texture overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `repeating-linear-gradient(0deg, ${alpha("#ffffff", 0.015)} 0px, ${alpha("#ffffff", 0.015)} 1px, transparent 1px, transparent 3px)`,
            opacity: 0.4,
            pointerEvents: "none",
          }}
        />
        {children}
      </AbsoluteFill>
    );
  }

  // 3. Cyber Grid stage — neon lines on dark
  if (effectiveStyle === "cyber-grid") {
    const scanlineOffset = (frame * 2) % 120;
    const gridPulse = 0.3 + Math.sin(frame / 30) * 0.15;
    const neonGlowX = Math.sin(frame / 40) * 30;
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${palette.background} 0%, ${palette.backgroundAlt} 60%, ${palette.surface} 100%)`,
          overflow: "hidden",
        }}
      >
        {/* Cyber perspective grid floor */}
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            left: "-20%",
            right: "-20%",
            height: "60%",
            backgroundImage: `linear-gradient(${alpha(palette.accent, 0.35)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(palette.accent, 0.35)} 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
            transform: "perspective(600px) rotateX(62deg)",
            opacity: gridPulse,
            maskImage: "linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 80%, transparent 100%)",
          }}
        />
        {/* Top grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${alpha(palette.accent, 0.08)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(palette.accent, 0.08)} 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
            opacity: 0.6,
            pointerEvents: "none",
          }}
        />
        {/* Neon accent glow */}
        <div
          style={{
            position: "absolute",
            top: "20%",
            left: "10%",
            width: "50%",
            height: "40%",
            background: `radial-gradient(ellipse, ${alpha(palette.glow, 0.4)} 0%, transparent 60%)`,
            filter: "blur(60px)",
            transform: `translateX(${neonGlowX}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "40%",
            right: "5%",
            width: "40%",
            height: "40%",
            background: `radial-gradient(ellipse, ${alpha(palette.accentAlt, 0.35)} 0%, transparent 55%)`,
            filter: "blur(50px)",
            transform: `translateX(${-neonGlowX * 0.6}px)`,
          }}
        />
        {/* Horizontal scan line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${scanlineOffset * 0.8}%`,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${alpha(palette.accent, 0.6)}, ${alpha(palette.glow, 0.8)}, ${alpha(palette.accent, 0.6)}, transparent)`,
            opacity: 0.5,
            pointerEvents: "none",
          }}
        />
        {/* Corner accent marks */}
        <div style={{ position: "absolute", top: 32, left: 32, width: 40, height: 2, background: palette.accent, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 32, left: 32, width: 2, height: 40, background: palette.accent, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 32, right: 32, width: 40, height: 2, background: palette.accentAlt, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 32, right: 32, width: 2, height: 40, background: palette.accentAlt, opacity: 0.7 }} />
        <div style={{ position: "absolute", bottom: 32, left: 32, width: 40, height: 2, background: palette.accentAlt, opacity: 0.7 }} />
        <div style={{ position: "absolute", bottom: 32, left: 32, width: 2, height: 40, background: palette.accentAlt, opacity: 0.7 }} />
        <div style={{ position: "absolute", bottom: 32, right: 32, width: 40, height: 2, background: palette.accent, opacity: 0.7 }} />
        <div style={{ position: "absolute", bottom: 32, right: 32, width: 2, height: 40, background: palette.accent, opacity: 0.7 }} />
        {children}
      </AbsoluteFill>
    );
  }

  // 4. Dark Cyber / Dramatic stage (default for dark palettes)
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
      {/* Floating gallery dust/gold particles */}
      {[...Array(12)].map((_, idx) => {
        const pX = (idx * 83 + frame * 0.35) % 100;
        const pY = (idx * 137 + Math.sin(frame / (28 + idx * 4)) * 36 + 100) % 100;
        const pAlpha = 0.12 + ((Math.sin(frame / (18 + idx * 3)) + 1) / 2) * 0.18;
        const pSize = 3 + (idx % 3) * 2.5;
        return (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: `${pX}%`,
              top: `${pY}%`,
              width: pSize,
              height: pSize,
              borderRadius: "50%",
              backgroundColor: palette.glow || palette.accent,
              opacity: pAlpha,
              filter: "blur(1px)",
              boxShadow: `0 0 10px ${palette.glow || palette.accent}`,
              pointerEvents: "none",
            }}
          />
        );
      })}
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
}> = ({ palette, radius = 28, padding = 28, children, style }) => {
  const frame = useCurrentFrame();
  const isLight = isLightPalette(palette);
  const showCyberCorners = isCyberPalette(palette);
  const topSweep = Math.sin(frame / 34) * 12;
  const diagonalSweep = ((frame * 1.1) % 180) - 46;
  const microGridOffset = (frame * 0.7) % 120;
  const cornerPulse = 0.56 + ((Math.sin(frame / 24) + 1) / 2) * 0.28;

  const frameBorder = isLight
    ? `1px solid ${alpha(palette.text, 0.08)}`
    : `1px solid ${alpha("#ffffff", 0.12)}`;
  const frameBg = isLight
    ? `linear-gradient(180deg, #ffffff 0%, ${alpha(palette.surface, 0.96)} 100%)`
    : `linear-gradient(180deg, ${alpha("#ffffff", 0.12)} 0%, ${alpha(palette.surface, 0.74)} 100%)`;
  const frameShadow = isLight
    ? `0 20px 48px ${alpha(palette.text, 0.07)}, 0 4px 12px ${alpha(palette.text, 0.03)}`
    : `0 28px 80px ${alpha("#000000", 0.34)}, inset 0 1px 0 ${alpha("#ffffff", 0.12)}`;

  return (
    <div
      style={{
        position: "relative",
        borderRadius: radius,
        overflow: "hidden",
        padding,
        border: frameBorder,
        background: frameBg,
        boxShadow: frameShadow,
        backdropFilter: "blur(20px)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: Math.max(0, radius - 1),
          border: isLight
            ? `1px solid rgba(255,255,255,0.7)`
            : `1px solid ${alpha("#ffffff", 0.06)}`,
          pointerEvents: "none",
        }}
      />
      {!isLight && (
        <>
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
        </>
      )}
      {showCyberCorners &&
        [
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
  const isLight = isLightPalette(palette);
  const pillBg = isLight
    ? alpha(palette.accent, 0.12)
    : light
      ? alpha("#ffffff", 0.16)
      : `linear-gradient(135deg, ${alpha(palette.accent, 0.95)} 0%, ${alpha(palette.accentAlt, 0.95)} 100%)`;
  const pillBorder = isLight
    ? `1px solid ${alpha(palette.accent, 0.28)}`
    : `1px solid ${alpha("#ffffff", light ? 0.18 : 0.1)}`;
  const pillColor = isLight ? palette.accent : light ? palette.text : "#0b1020";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px 10px 14px",
        borderRadius: 999,
        background: pillBg,
        border: pillBorder,
        boxShadow: isLight
          ? `0 4px 12px ${alpha(palette.accent, 0.12)}`
          : light
            ? `inset 0 1px 0 ${alpha("#ffffff", 0.12)}`
            : `0 14px 34px ${alpha(palette.accent, 0.24)}`,
        color: pillColor,
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
          background: isLight
            ? palette.accent
            : light
              ? alpha("#ffffff", 0.82)
              : alpha("#08111e", 0.76),
          boxShadow: isLight
            ? `0 0 10px ${alpha(palette.accent, 0.35)}`
            : light
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
  const isLight = isLightPalette(palette);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        fontSize: 21,
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: isLight ? palette.accent : alpha(palette.text, 0.7),
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 38,
          height: 2,
          background: isLight
            ? `linear-gradient(90deg, ${palette.accent} 0%, transparent 100%)`
            : `linear-gradient(90deg, ${alpha(palette.accentAlt, 0.78)} 0%, ${alpha("#ffffff", 0.06)} 100%)`,
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
}> = ({ media, palette, radius = 24, frame = 0, style }) => {
  // Smooth cinematic Ken-Burns push-in
  const zoom = 1 + Math.min(0.14, (frame / 150) * 0.14);
  const translateX = Math.sin(frame / 60) * 8;
  const translateY = Math.cos(frame / 70) * 6;
  const sheenProgress = ((frame * 1.8) % 200) - 50;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        background: `linear-gradient(135deg, ${alpha(palette.backgroundAlt, 0.95)} 0%, ${alpha(palette.surface, 0.95)} 100%)`,
        border: `2px solid ${alpha(palette.accent, 0.35)}`,
        boxShadow: `0 32px 90px ${alpha("#000000", 0.55)}, 0 8px 24px ${alpha(palette.glow, 0.15)}, inset 0 0 0 1px ${alpha("#ffffff", 0.12)}`,
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

      {/* Glass shimmer sweep effect */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${sheenProgress}%`,
          width: "45%",
          height: "100%",
          background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
          transform: "skewX(-25deg)",
          pointerEvents: "none",
        }}
      />

      {/* Gallery Piece Corner Label */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 16,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${alpha(palette.accent, 0.5)}`,
          color: palette.accent,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        ◆ ARTWORK
      </div>
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
                ? alpha(palette.accentAlt, 0.35)
                : isLightPalette(palette)
                  ? alpha(palette.text, 0.08)
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
  const isLight = isLightPalette(palette);
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
                ? alpha(palette.accentAlt, 0.35)
                : isLight
                  ? alpha(palette.text, 0.08)
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
                    : isLight
                      ? alpha(palette.text, 0.06)
                      : alpha("#ffffff", 0.08),
                  color: active ? "#ffffff" : palette.text,
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
  const isLight = isLightPalette(palette);

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
              background: isLight ? alpha(palette.text, 0.035) : alpha("#ffffff", 0.05),
              border: `1px solid ${isLight ? alpha(palette.text, 0.06) : alpha("#ffffff", 0.06)}`,
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
                background: isLight ? alpha(palette.text, 0.08) : alpha("#ffffff", 0.12),
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
