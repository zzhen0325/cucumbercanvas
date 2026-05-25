import type { CanvasFill, CanvasStroke, CanvasEffect } from "./styles.js";

type CSSProperties = Record<string, string | number | undefined>;

/**
 * Resolve CanvasFill[] to React CSSProperties.
 * Uses DOM-native gradients/backgrounds — simpler than Skia paint system.
 */
export function resolveFillCSS(fills?: CanvasFill[]): CSSProperties {
  if (!fills || fills.length === 0) return {};

  const visibleFills = fills.filter((f) => {
    if ("opacity" in f && f.opacity !== undefined && f.opacity <= 0) return false;
    return true;
  });
  if (visibleFills.length === 0) return {};

  const backgrounds: string[] = [];

  for (const fill of visibleFills) {
    const opacity = "opacity" in fill ? fill.opacity : undefined;

    switch (fill.type) {
      case "solid": {
        const color = opacity !== undefined ? applyOpacity(fill.color, opacity) : fill.color;
        backgrounds.push(color);
        break;
      }
      case "linear_gradient": {
        const angle = fill.angle ?? 180;
        const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
        backgrounds.push(`linear-gradient(${angle}deg, ${stops})`);
        break;
      }
      case "radial_gradient": {
        const cx = fill.cx ?? 0.5;
        const cy = fill.cy ?? 0.5;
        const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
        backgrounds.push(`radial-gradient(circle at ${cx * 100}% ${cy * 100}%, ${stops})`);
        break;
      }
      case "image": {
        const mode = fill.mode ?? "fill";
        const sizeCss = mode === "fit" ? "contain" : mode === "crop" ? "cover" : mode === "tile" ? "auto" : "100% 100%";
        const repeatCss = mode === "tile" ? "repeat" : "no-repeat";
        backgrounds.push(`url("${fill.url}") ${repeatCss} center / ${sizeCss}`);
        break;
      }
    }
  }

  if (backgrounds.length === 0) return {};
  return { background: backgrounds.join(", ") };
}

/**
 * Resolve CanvasStroke to React CSSProperties.
 * Uses border + boxShadow for inside/outside stroke simulation.
 */
export function resolveStrokeCSS(stroke?: CanvasStroke): CSSProperties {
  if (!stroke) return {};

  const thickness =
    typeof stroke.thickness === "number"
      ? stroke.thickness
      : Math.max(...stroke.thickness);

  if (thickness <= 0) return {};

  const color = stroke.fill?.[0] && stroke.fill[0].type === "solid"
    ? stroke.fill[0].color
    : "transparent";

  const style: CSSProperties = {};

  switch (stroke.align) {
    case "inside":
      style.boxShadow = `inset 0 0 0 ${thickness}px ${color}`;
      break;
    case "outside":
      style.boxShadow = `0 0 0 ${thickness}px ${color}`;
      break;
    case "center":
    default:
      // Default: combine half-inside + half-outside, or just use border
      style.boxShadow = `inset 0 0 0 ${Math.ceil(thickness / 2)}px ${color}, 0 0 0 ${Math.floor(thickness / 2)}px ${color}`;
      break;
  }

  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    // Dash pattern can't be done purely with CSS border; approximate with outline trick
    // but since we're using boxShadow, dash is best-effort via SVG filter or just skip
  }

  return style;
}

/**
 * Resolve CanvasEffect[] to React CSSProperties.
 * Maps shadow → box-shadow, blur → filter: blur().
 */
export function resolveEffectCSS(effects?: CanvasEffect[]): CSSProperties {
  if (!effects || effects.length === 0) return {};

  const shadows: string[] = [];
  const filters: string[] = [];
  let backdropBlur: number | null = null;

  for (const effect of effects) {
    switch (effect.type) {
      case "shadow": {
        const inset = effect.inner ? "inset " : "";
        shadows.push(
          `${inset}${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${effect.spread}px ${effect.color}`,
        );
        break;
      }
      case "blur": {
        filters.push(`blur(${effect.radius}px)`);
        break;
      }
      case "background_blur": {
        backdropBlur = effect.radius;
        break;
      }
    }
  }

  const style: CSSProperties = {};
  if (shadows.length > 0) style.boxShadow = shadows.join(", ");
  if (filters.length > 0) style.filter = filters.join(" ");
  if (backdropBlur !== null) style.backdropFilter = `blur(${backdropBlur}px)`;

  return style;
}

/**
 * Resolve cornerRadius to React CSSProperties.
 */
export function resolveCornerRadiusCSS(
  radius?: number | [number, number, number, number],
): CSSProperties {
  if (radius === undefined) return {};
  if (typeof radius === "number") {
    return { borderRadius: `${radius}px` };
  }
  const [tl, tr, br, bl] = radius;
  return {
    borderRadius: `${tl}px ${tr}px ${br}px ${bl}px`,
  };
}

/**
 * Resolve padding value to CSS string.
 */
export function resolvePadding(
  padding?: number | [number, number] | [number, number, number, number],
): string | undefined {
  if (padding === undefined) return undefined;
  if (typeof padding === "number") return `${padding}px`;
  if (padding.length === 2) return `${padding[0]}px ${padding[1]}px`;
  return `${padding[0]}px ${padding[1]}px ${padding[2]}px ${padding[3]}px`;
}

function applyOpacity(hex: string, opacity: number): string {
  if (hex.startsWith("#") && hex.length === 7) {
    const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
      .toString(16)
      .padStart(2, "0");
    return hex + alpha;
  }
  return hex;
}
