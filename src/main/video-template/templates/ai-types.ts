import type { Palette } from "./shared";

/**
 * Palette configuration for AI-composed videos.
 * Use a preset name to pick from built-in palettes, optionally overriding individual colors,
 * or supply a fully custom palette object.
 */
export type PaletteConfig =
  | { preset: string; custom?: Partial<Palette> }
  | { custom: Palette };

/** Layer types the AI agent can compose into a scene. */
export type LayerType =
  | "eyebrow"
  | "headline"
  | "subtitle"
  | "text"
  | "badge-row"
  | "price"
  | "metrics"
  | "features"
  | "media"
  | "cta"
  | "quote"
  | "divider"
  | "progress-bar"
  | "bullet-list";

/** Base fields shared by every layer. */
interface LayerBase {
  /** Delay in frames before this layer begins its entrance animation. */
  delayFrames?: number;
}

/** Section eyebrow label with accent bar. */
export interface EyebrowLayer extends LayerBase {
  type: "eyebrow";
  text: string;
}

/** Large bold headline text. */
export interface HeadlineLayer extends LayerBase {
  type: "headline";
  text: string;
  /** Font size override (default ~60). */
  fontSize?: number;
}

/** Medium-weight subtitle below the headline. */
export interface SubtitleLayer extends LayerBase {
  type: "subtitle";
  text: string;
}

/** Body text block. */
export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  /** Optional max-width in px. */
  maxWidth?: number;
}

/** Row of tag / badge pills. */
export interface BadgeRowLayer extends LayerBase {
  type: "badge-row";
  badges: string[];
}

/** Price display with optional original price strikethrough. */
export interface PriceLayer extends LayerBase {
  type: "price";
  price: string;
  originalPrice?: string;
  label?: string;
}

/** Animated metric cards. */
export interface MetricsLayer extends LayerBase {
  type: "metrics";
  items: Array<{ label: string; value: string; detail?: string }>;
  /** Grid columns (1-4, default 2). */
  columns?: number;
}

/** Stacked feature cards. */
export interface FeaturesLayer extends LayerBase {
  type: "features";
  items: Array<{ eyebrow?: string; title: string; text: string }>;
}

/** Image or video media surface. */
export interface MediaLayer extends LayerBase {
  type: "media";
  media: { type: "image" | "video"; src: string; poster?: string; alt?: string };
  /** Width as CSS value (default "100%"). */
  width?: string;
  /** Height as CSS value (default "480px"). */
  height?: string;
}

/** Call-to-action button display. */
export interface CtaLayer extends LayerBase {
  type: "cta";
  text: string;
  subtext?: string;
}

/** Large italic quote with decorative quote marks. */
export interface QuoteLayer extends LayerBase {
  type: "quote";
  text: string;
  author?: string;
}

/** Thin horizontal divider line. */
export interface DividerLayer extends LayerBase {
  type: "divider";
}

/** Animated progress bar row. */
export interface ProgressBarLayer extends LayerBase {
  type: "progress-bar";
  items: Array<{ label: string; value: number; color?: string }>;
}

/** Bullet-point list. */
export interface BulletListLayer extends LayerBase {
  type: "bullet-list";
  items: string[];
}

/** Union of all layer types the AI can compose. */
export type SceneLayer =
  | EyebrowLayer
  | HeadlineLayer
  | SubtitleLayer
  | TextLayer
  | BadgeRowLayer
  | PriceLayer
  | MetricsLayer
  | FeaturesLayer
  | MediaLayer
  | CtaLayer
  | QuoteLayer
  | DividerLayer
  | ProgressBarLayer
  | BulletListLayer;

/** Scene background configuration. */
export type SceneBackground =
  | { type: "gradient" }
  | { type: "media"; media: { type: "image" | "video"; src: string; poster?: string; alt?: string }; opacity?: number };

/** Transition between scenes. */
export type SceneTransition = "cut" | "fade";

/** A single scene in the video timeline. */
export interface SceneConfig {
  /** Duration of this scene in seconds. */
  duration: number;
  /** Scene background. Defaults to gradient if omitted. */
  background?: SceneBackground;
  /** Ordered list of layers to render on top of the background. */
  layers: SceneLayer[];
  /** Transition used when entering this scene. Defaults to "fade". */
  transition?: SceneTransition;
}

/** Video orientation preset. */
export type VideoOrientation = "portrait" | "landscape" | "square";

/** Top-level video configuration that the AI agent generates. */
export interface VideoConfig {
  meta: {
    /** Video title (used for metadata only). */
    title: string;
    /** Orientation preset. Defaults to "portrait". */
    orientation?: VideoOrientation;
    /** Target FPS. Defaults to 30. */
    fps?: number;
  };
  /** Color palette for the entire video. */
  palette: PaletteConfig;
  /** Ordered list of scenes. */
  scenes: SceneConfig[];
}

/** Props that the Remotion AiUniversal composition receives. */
export interface AiVideoProps {
  videoConfig: VideoConfig;
}
