// @ts-nocheck
import type {
  ImageOriginalSize,
  PaintTransform,
  PenFill,
} from "@cucumber/pen-types";
import { mapFigmaBlendMode } from "./figma-blend-mode.js";
import { figmaColorToHex } from "./figma-color-utils.js";
import type { FigmaMatrix, FigmaPaint } from "./figma-types.js";

const IMAGE_TRANSFORM_EPSILON = 0.000001;

/**
 * Convert Figma fillPaints (internal format) to PenFill[].
 */
export function mapFigmaFills(
  paints: FigmaPaint[] | undefined,
): PenFill[] | undefined {
  if (!paints || paints.length === 0) return undefined;
  const fills: PenFill[] = [];

  for (const paint of paints) {
    const mapped = mapSingleFill(paint);
    if (mapped) fills.push(mapped);
  }

  return fills.length > 0 ? fills : undefined;
}

function mapSingleFill(paint: FigmaPaint): PenFill | null {
  switch (paint.type) {
    case "SOLID": {
      if (!paint.color) return null;
      return {
        type: "solid",
        color: figmaColorToHex(paint.color),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    case "GRADIENT_LINEAR": {
      if (!paint.stops) return null;
      const transform = normalizePaintTransform(paint.transform);
      const line = paint.transform
        ? linearGradientFromTransform(paint.transform)
        : undefined;
      return {
        type: "linear_gradient",
        angle: line?.angle ?? 0,
        x1: line?.x1,
        y1: line?.y1,
        x2: line?.x2,
        y2: line?.y2,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    case "GRADIENT_RADIAL": {
      if (!paint.stops) return null;
      const transform = normalizePaintTransform(paint.transform);
      const radial = paint.transform
        ? radialGradientFromTransform(paint.transform)
        : undefined;
      return {
        type: "radial_gradient",
        cx: radial?.cx ?? 0.5,
        cy: radial?.cy ?? 0.5,
        radius: radial?.radius ?? 0.5,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    case "GRADIENT_ANGULAR": {
      if (!paint.stops) return null;
      const transform = normalizePaintTransform(paint.transform);
      const angular = paint.transform
        ? angularGradientFromTransform(paint.transform)
        : undefined;
      return {
        type: "angular_gradient",
        cx: angular?.cx ?? 0.5,
        cy: angular?.cy ?? 0.5,
        angle: angular?.angle ?? 0,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    case "GRADIENT_DIAMOND": {
      if (!paint.stops) return null;
      const transform = normalizePaintTransform(paint.transform);
      const diamond = paint.transform
        ? diamondGradientFromTransform(paint.transform)
        : undefined;
      return {
        type: "diamond_gradient",
        cx: diamond?.cx ?? 0.5,
        cy: diamond?.cy ?? 0.5,
        radius: diamond?.radius ?? 0.5,
        angle: diamond?.angle ?? 0,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    case "IMAGE": {
      // Image fills reference blobs or ZIP image files; we'll resolve them later
      let url = "";
      if (paint.image?.hash && paint.image.hash.length > 0) {
        url = `__hash:${Array.from(paint.image.hash)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")}`;
      } else if (paint.image?.dataBlob !== undefined) {
        url = `__blob:${paint.image.dataBlob}`;
      }
      return {
        type: "image",
        url,
        mode: mapScaleMode(paint.imageScaleMode),
        originalSize: normalizeOriginalSize(
          paint.originalImageWidth,
          paint.originalImageHeight,
        ),
        transform: normalizePaintTransform(paint.transform),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      };
    }

    default:
      return null;
  }
}

function paintLayerProps(paint: FigmaPaint): {
  visible?: boolean;
  blendMode?: ReturnType<typeof mapFigmaBlendMode>;
} {
  return {
    ...(paint.visible === false ? { visible: false } : {}),
    ...(mapFigmaBlendMode(paint.blendMode)
      ? { blendMode: mapFigmaBlendMode(paint.blendMode) }
      : {}),
  };
}

function gradientAngleFromTransform(m: FigmaMatrix): number {
  // Figma gradient direction is (m00, m10) in object space (default = horizontal).
  // atan2 gives the math-convention angle (0° = right, CCW).
  // Convert to CSS gradient convention (0° = bottom-to-top, 90° = left-to-right).
  return gradientAngleFromVector(m.m00, m.m10);
}

function gradientAngleFromVector(x: number, y: number): number {
  const mathAngle = Math.atan2(y, x) * (180 / Math.PI);
  return Math.round(90 - mathAngle);
}

function applyGradientTransform(m: FigmaMatrix, x: number, y: number): {
  x: number;
  y: number;
} {
  return {
    x: m.m00 * x + m.m01 * y + m.m02,
    y: m.m10 * x + m.m11 * y + m.m12,
  };
}

function linearGradientFromTransform(m: FigmaMatrix): {
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const start = applyGradientTransform(m, 0, 0.5);
  const end = applyGradientTransform(m, 1, 0.5);
  return {
    angle: gradientAngleFromVector(end.x - start.x, end.y - start.y),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
}

function radialGradientFromTransform(m: FigmaMatrix): {
  cx: number;
  cy: number;
  radius: number;
} {
  const center = applyGradientTransform(m, 0.5, 0.5);
  const edgeX = applyGradientTransform(m, 1, 0.5);
  const edgeY = applyGradientTransform(m, 0.5, 1);
  const rx = Math.hypot(edgeX.x - center.x, edgeX.y - center.y);
  const ry = Math.hypot(edgeY.x - center.x, edgeY.y - center.y);
  return {
    cx: center.x,
    cy: center.y,
    radius: Math.max(0.0001, (rx + ry) / 2),
  };
}

function angularGradientFromTransform(m: FigmaMatrix): {
  cx: number;
  cy: number;
  angle: number;
} {
  const center = applyGradientTransform(m, 0.5, 0.5);
  return {
    cx: center.x,
    cy: center.y,
    angle: gradientAngleFromTransform(m),
  };
}

function diamondGradientFromTransform(m: FigmaMatrix): {
  cx: number;
  cy: number;
  radius: number;
  angle: number;
} {
  const radial = radialGradientFromTransform(m);
  return {
    ...radial,
    angle: gradientAngleFromTransform(m),
  };
}

function normalizeOriginalSize(
  width?: number,
  height?: number,
): ImageOriginalSize | undefined {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return { width, height };
}

function normalizePaintTransform(
  transform?: FigmaMatrix,
): PaintTransform | undefined {
  if (!transform) return undefined;

  if (
    Math.abs(transform.m00 - 1) <= IMAGE_TRANSFORM_EPSILON &&
    Math.abs(transform.m01) <= IMAGE_TRANSFORM_EPSILON &&
    Math.abs(transform.m02) <= IMAGE_TRANSFORM_EPSILON &&
    Math.abs(transform.m10) <= IMAGE_TRANSFORM_EPSILON &&
    Math.abs(transform.m11 - 1) <= IMAGE_TRANSFORM_EPSILON &&
    Math.abs(transform.m12) <= IMAGE_TRANSFORM_EPSILON
  ) {
    return undefined;
  }

  return {
    m00: transform.m00,
    m01: transform.m01,
    m02: transform.m02,
    m10: transform.m10,
    m11: transform.m11,
    m12: transform.m12,
  };
}

function mapScaleMode(
  mode?: string,
): "stretch" | "fill" | "fit" | "tile" | "crop" {
  switch (mode) {
    case "CROP":
      return "crop";
    case "FIT":
      return "fit";
    case "STRETCH":
      return "stretch";
    case "TILE":
      return "tile";
    default:
      return "fill";
  }
}
