import { nanoid } from 'nanoid';
import type { PenNode, PathNode } from '@cucumber/pen-types';

export type BooleanOpType = 'union' | 'subtract' | 'intersect' | 'exclude';

// ---------------------------------------------------------------------------
// Paper.js scope — headless (no canvas needed)
// ---------------------------------------------------------------------------

interface PaperBoundsLike {
  center: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PaperPathItem {
  bounds: PaperBoundsLike;
  pathData: string;
  translate: (point: unknown) => void;
  rotate: (angle: number, center: unknown) => void;
  unite: (path: PaperPathItem) => PaperPathItem;
  subtract: (path: PaperPathItem) => PaperPathItem;
  intersect: (path: PaperPathItem) => PaperPathItem;
  exclude: (path: PaperPathItem) => PaperPathItem;
  remove: () => void;
}

interface PaperScope {
  setup: (size: unknown) => void;
  activate: () => void;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  CompoundPath: {
    create: (pathData: string) => PaperPathItem;
  };
}

interface PaperModule {
  PaperScope: new () => PaperScope;
  Point: new (x: number, y: number) => unknown;
}

let paperModule: PaperModule | null | undefined;
let scope: PaperScope | null = null;

/**
 * Inject a Paper.js module from ESM import (for browser/Next.js environments
 * where require('paper') is unavailable). Call once before executeBooleanOp.
 * Accepts the paper module object (which has PaperScope, Point, Size, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setPaperModule(mod: any): void {
  paperModule = mod as PaperModule;
}

function getPaperModule(): PaperModule | null {
  if (paperModule !== undefined) return paperModule;
  try {
    // Indirect require via globalThis to load paper.js at runtime without
    // triggering esbuild's direct-eval warning. The assignment to globalThis
    // happens once; subsequent calls read from the cached paperModule.
    const _r =
      ((globalThis as any)['require'] as ((mid: string) => unknown) | undefined) ??
      ((typeof (globalThis as any)['require'] !== 'undefined') ? (globalThis as any)['require'] : undefined);
    if (!_r) throw new Error('require not available');
    paperModule = _r('paper') as PaperModule;
  } catch {
    paperModule = null;
  }
  return paperModule;
}

function getScope(): PaperScope {
  const paper = getPaperModule();
  if (!paper) {
    throw new Error('paper runtime is unavailable');
  }
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

// ---------------------------------------------------------------------------
// Shape → SVG path string conversion
// ---------------------------------------------------------------------------

function sizeVal(v: number | string | undefined, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/\((\d+(?:\.\d+)?)\)/);
    if (m && m[1]) return parseFloat(m[1]);
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

function rectToPath(w: number, h: number, cr?: number | [number, number, number, number]): string {
  if (!cr || (typeof cr === 'number' && cr === 0)) {
    return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  }
  let [tl, tr, br, bl] = typeof cr === 'number' ? [cr, cr, cr, cr] : cr;
  const maxR = Math.min(w, h) / 2;
  tl = Math.min(tl, maxR);
  tr = Math.min(tr, maxR);
  br = Math.min(br, maxR);
  bl = Math.min(bl, maxR);
  return [
    `M ${tl} 0`,
    `L ${w - tr} 0`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${w} ${tr}` : '',
    `L ${w} ${h - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${w - br} ${h}` : '',
    `L ${bl} ${h}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 0 ${h - bl}` : '',
    `L 0 ${tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

function ellipseToPath(rx: number, ry: number): string {
  // 4-arc approximation of an ellipse centered at (rx, ry)
  return [
    `M ${rx * 2} ${ry}`,
    `A ${rx} ${ry} 0 0 1 ${rx} ${ry * 2}`,
    `A ${rx} ${ry} 0 0 1 0 ${ry}`,
    `A ${rx} ${ry} 0 0 1 ${rx} 0`,
    `A ${rx} ${ry} 0 0 1 ${rx * 2} ${ry}`,
    'Z',
  ].join(' ');
}

function polygonToPath(count: number, w: number, h: number): string {
  const raw: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    raw.push([Math.cos(angle), Math.sin(angle)]);
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [rx, ry] of raw) {
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  const rw = maxX - minX;
  const rh = maxY - minY;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const pt = raw[i]!;
    const px = ((pt[0] - minX) / rw) * w;
    const py = ((pt[1] - minY) / rh) * h;
    parts.push(i === 0 ? `M ${px} ${py}` : `L ${px} ${py}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Convert a shape node to an SVG path `d` string in local coordinates (origin at 0,0). */
function nodeToLocalPath(node: PenNode): string | null {
  switch (node.type) {
    case 'rectangle':
    case 'frame': {
      const w = sizeVal(node.width, 100);
      const h = sizeVal(node.height, 100);
      return rectToPath(w, h, node.cornerRadius);
    }
    case 'ellipse': {
      const w = sizeVal(node.width, 100);
      const h = sizeVal(node.height, 100);
      return ellipseToPath(w / 2, h / 2);
    }
    case 'polygon': {
      const w = sizeVal(node.width, 100);
      const h = sizeVal(node.height, 100);
      return polygonToPath(node.polygonCount || 6, w, h);
    }
    case 'path':
      return node.d;
    case 'line':
      return `M 0 0 L ${(node.x2 ?? (node.x ?? 0) + 100) - (node.x ?? 0)} ${(node.y2 ?? node.y ?? 0) - (node.y ?? 0)}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Boolean operation helpers
// ---------------------------------------------------------------------------

/** Types that can participate in boolean operations. */
const BOOLEAN_TYPES = new Set(['rectangle', 'ellipse', 'polygon', 'path', 'line', 'frame']);
const BOOLEAN_TYPE_LABELS = 'rectangles, ellipses, polygons, paths, lines, and frames';

export function getBooleanOpRejectionReason(nodes: PenNode[]): string | null {
  if (nodes.length < 2) {
    return 'Select at least two shape or path nodes before running a boolean operation.';
  }

  if (nodes.some((n) => !BOOLEAN_TYPES.has(n.type))) {
    return `Boolean operations support ${BOOLEAN_TYPE_LABELS}. Remove text, images, groups, or other unsupported selections before trying again.`;
  }

  return null;
}

export function canBooleanOp(nodes: PenNode[]): boolean {
  return getBooleanOpRejectionReason(nodes) === null;
}

/**
 * Create a Paper.js PathItem from a PenNode, positioned in absolute scene
 * coordinates (applying x, y, rotation).
 */
function nodeToPaperPath(node: PenNode): PaperPathItem | null {
  const d = nodeToLocalPath(node);
  if (!d) return null;

  const s = getScope();
  let item: PaperPathItem;
  try {
    item = s.CompoundPath.create(d);
  } catch {
    return null;
  }

  // Apply node transform: translate to (x, y), then rotate around center
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  item.translate(new s.Point(x, y));

  const rotation = node.rotation ?? 0;
  if (rotation !== 0) {
    // Rotate around the bounding-box center of the translated item
    item.rotate(rotation, item.bounds.center);
  }

  return item;
}

/**
 * Execute a boolean operation on the given PenNodes.
 * Returns a new PathNode with the result, or null on failure.
 */
export function executeBooleanOp(nodes: PenNode[], operation: BooleanOpType): PathNode | null {
  if (nodes.length < 2) return null;

  if (!getPaperModule()) return null;

  const paperPaths = nodes.map(nodeToPaperPath);
  if (paperPaths.some((p) => p === null)) return null;

  const paths = paperPaths as PaperPathItem[];

  // Accumulate: fold left with the boolean operation
  let result: PaperPathItem | null = paths[0]!;
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i]!;
    switch (operation) {
      case 'union':
        result = result!.unite(p);
        break;
      case 'subtract':
        result = result!.subtract(p);
        break;
      case 'intersect':
        result = result!.intersect(p);
        break;
      case 'exclude':
        result = result!.exclude(p);
        break;
    }
  }

  if (!result) return null;

  // Extract SVG path data
  const pathData = result.pathData;
  if (!pathData || pathData.trim().length === 0) return null;

  // Get bounding box for positioning
  const bounds = result.bounds;

  // Translate path so it starts at origin (0,0)
  const paper = getPaperModule();
  if (!paper) return null;
  result.translate(new paper.Point(-bounds.x, -bounds.y));
  const originPathData = result.pathData;

  // Clean up Paper.js items
  for (const p of paths) p.remove();
  result.remove();

  // Build the label
  const opLabels: Record<BooleanOpType, string> = {
    union: 'Union',
    subtract: 'Subtract',
    intersect: 'Intersect',
    exclude: 'Exclude',
  };

  // Inherit style from first operand
  const first = nodes[0]!;
  const fill = 'fill' in first ? first.fill : undefined;
  const stroke = 'stroke' in first ? first.stroke : undefined;
  const effects = 'effects' in first ? first.effects : undefined;
  const opacity = first.opacity;

  return {
    id: nanoid(),
    type: 'path',
    name: opLabels[operation],
    d: originPathData,
    x: bounds.x,
    y: bounds.y,
    width: Math.round(bounds.width * 100) / 100,
    height: Math.round(bounds.height * 100) / 100,
    fill,
    stroke,
    effects,
    opacity,
  };
}
