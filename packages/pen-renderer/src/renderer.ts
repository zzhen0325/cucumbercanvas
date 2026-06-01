import {
  CANVAS_BACKGROUND_DARK,
  FRAME_LABEL_COLOR,
  FRAME_LABEL_FONT_SIZE,
  FRAME_LABEL_OFFSET_Y,
  MAX_ZOOM,
  MIN_ZOOM,
  getActivePageChildren,
  getAllChildren,
  getDefaultTheme,
  resolveNodeForCanvas,
  setRootChildrenProvider,
} from "@cucumber/pen-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import type { CanvasKit, Surface } from "canvaskit-wasm";
import {
  collectInstanceIds,
  collectReusableIds,
  flattenToRenderNodes,
  premeasureTextHeights,
  resolveRefs,
} from "./document-flattener.js";
import { SkiaNodeRenderer } from "./node-renderer.js";
import { parseColor } from "./paint-utils.js";
import { RenderNodeViewportIndex, SpatialIndex } from "./spatial-index.js";
import type {
  EditorLineOverlay,
  EditorOverlayState,
  EditorPenPreviewOverlay,
  EditorShapeOverlay,
  PenRendererOptions,
  RenderNode,
  RendererInteractionMode,
  ResizeHandleDirection,
  SelectionControlHit,
  TransformPreviewState,
  ViewportState,
} from "./types.js";
import {
  getViewportBounds,
  screenToScene,
  viewportMatrix,
  zoomToPoint as vpZoomToPoint,
} from "./viewport.js";

const DEFAULT_SELECTION_COLOR = "#37BFF9";
const FRAME_LABEL_FONT_FAMILY = "system-ui, sans-serif";
const FRAME_LABEL_FONT_WEIGHT = 400;
const FRAME_LABEL_SELECTED_FONT_WEIGHT = 600;
const FRAME_LABEL_HIT_PADDING_X = 4;
const FRAME_LABEL_HIT_PADDING_Y = 3;
const RENDER_CULL_MARGIN_PX = 256;
const SLOW_SYNC_THRESHOLD_MS = 18;
const SLOW_FRAME_THRESHOLD_MS = 24;
const FRAME_LABEL_CACHE_MAX = 256;
const VIEWPORT_INTERACTION_CACHE_PADDING_PX = 256;
const VIEWPORT_EPSILON = 0.001;
const RESIZE_HANDLES: ResizeHandleDirection[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];

type CanvasKitImage = NonNullable<ReturnType<CanvasKit["MakeImage"]>>;

type FrameLabelCacheEntry = {
  image: CanvasKitImage;
  bitmapWidth: number;
  bitmapHeight: number;
  lastUsed: number;
};

type InteractionBackgroundCacheEntry = {
  image: CanvasKitImage;
  key: string;
  width: number;
  height: number;
};

export type ViewportInteractionCacheSnapshot = {
  key: string;
  paddingX: number;
  paddingY: number;
  panX: number;
  panY: number;
  zoom: number;
};

type ViewportInteractionCacheEntry = ViewportInteractionCacheSnapshot & {
  image: CanvasKitImage;
  width: number;
  height: number;
};

/**
 * Standalone read-only renderer for Cucumber (.op) design files.
 * No React, no Zustand, no TanStack — just pure TypeScript + CanvasKit.
 *
 * @example
 * ```ts
 * import { loadCanvasKit, PenRenderer } from '@cucumber/pen-renderer'
 *
 * const ck = await loadCanvasKit('/canvaskit/')
 * const renderer = new PenRenderer(ck, { fontBasePath: '/fonts/' })
 * renderer.init(document.getElementById('canvas') as HTMLCanvasElement)
 * renderer.setDocument(myDocument)
 * renderer.zoomToFit()
 * ```
 */
export class PenRenderer {
  private ck: CanvasKit;
  private surface: Surface | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private nodeRenderer: SkiaNodeRenderer;
  private spatialIndex = new SpatialIndex();
  private viewportIndex = new RenderNodeViewportIndex();
  private renderNodes: RenderNode[] = [];
  private options: PenRendererOptions;
  private interactionMode: RendererInteractionMode = "idle";
  private transformPreview: TransformPreviewState | null = null;
  private transformPreviewIds = new Set<string>();
  private frameLabelCache = new Map<string, FrameLabelCacheEntry>();
  private frameLabelCacheTick = 0;
  private interactionBackgroundCache: InteractionBackgroundCacheEntry | null =
    null;
  private viewportInteractionCache: ViewportInteractionCacheEntry | null = null;
  private sceneSerial = 0;

  // Component/instance IDs for colored frame labels
  private reusableIds = new Set<string>();
  private instanceIds = new Set<string>();

  // Viewport
  private _zoom = 1;
  private _panX = 0;
  private _panY = 0;
  private dirty = true;
  private animFrameId = 0;

  // Document
  private document: PenDocument | null = null;
  private activePageId: string | null = null;

  // Editor overlays are drawn inside the same Skia render pass as canvas content.
  private editorOverlays: EditorOverlayState = {
    selectedIds: [],
    selectionColor: DEFAULT_SELECTION_COLOR,
    marquee: null,
    shapePreview: null,
    linePreview: null,
    penPreview: null,
  };

  constructor(ck: CanvasKit, options?: PenRendererOptions) {
    this.ck = ck;
    this.options = options ?? {};
    this.nodeRenderer = new SkiaNodeRenderer(ck, {
      fontBasePath: this.options.fontBasePath,
      googleFontsCssUrl: this.options.googleFontsCssUrl,
    });
    if (this.options.iconLookup) {
      this.nodeRenderer.setIconLookup(this.options.iconLookup);
    }
    if (this.options.devicePixelRatio !== undefined) {
      this.nodeRenderer.devicePixelRatio = this.options.devicePixelRatio;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(canvas: HTMLCanvasElement) {
    this.canvasEl = canvas;
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;

    this.surface = this.createSurface(canvas, "init");
    if (!this.surface) {
      console.error("PenRenderer: Failed to create surface");
      return;
    }

    this.nodeRenderer.init();
    this.nodeRenderer.setRedrawCallback(() => {
      this.clearViewportInteractionCache("asset_loaded");
      this.markDirty();
    });
    (
      this.nodeRenderer as unknown as {
        textRenderer: { _onFontLoaded?: () => void };
      }
    ).textRenderer._onFontLoaded = () => this.markDirty();

    // Pre-load default fonts
    const defaultFonts = this.options.defaultFonts ?? ["Inter", "Noto Sans SC"];
    for (const font of defaultFonts) {
      this.nodeRenderer.fontManager
        .ensureFont(font)
        .then(() => this.markDirty());
    }

    // Wire up root children provider for layout engine fill-width fallback
    setRootChildrenProvider(() => this.document?.children ?? []);

    this.startRenderLoop();
  }

  dispose() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.nodeRenderer.dispose();
    this.clearFrameLabelCache();
    this.clearInteractionBackgroundCache("dispose");
    this.clearViewportInteractionCache("dispose");
    this.surface?.delete();
    this.surface = null;
  }

  resize(width: number, height: number) {
    if (!this.canvasEl) return;
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    this.canvasEl.width = width * dpr;
    this.canvasEl.height = height * dpr;
    this.surface?.delete();
    this.surface = this.createSurface(this.canvasEl, "resize");
    if (!this.surface) {
      console.error("PenRenderer: Failed to recreate surface", {
        height: this.canvasEl.height,
        width: this.canvasEl.width,
      });
      return;
    }
    this.clearInteractionBackgroundCache("resize");
    this.clearViewportInteractionCache("resize");
    this.markDirty();
  }

  private createSurface(
    canvas: HTMLCanvasElement,
    reason: "init" | "resize",
  ): Surface | null {
    let surface: Surface | null = null;
    let mode: "webgl" | "software" | null = null;
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const context = {
      clientHeight: canvas.clientHeight,
      clientWidth: canvas.clientWidth,
      dpr,
      height: canvas.height,
      reason,
      width: canvas.width,
    };

    try {
      surface = this.ck.MakeWebGLCanvasSurface(canvas);
      if (surface) mode = "webgl";
    } catch (error) {
      console.warn("[pen-renderer] WebGL surface creation failed", {
        ...context,
        error,
      });
    }

    if (!surface) {
      surface = this.ck.MakeSWCanvasSurface(canvas);
      if (surface) mode = "software";
    }

    if (surface && mode === "webgl") {
      console.info("[pen-renderer] Skia surface created", {
        ...context,
        mode,
      });
    } else if (surface && mode === "software") {
      console.warn(
        "[pen-renderer] Skia surface created with software fallback",
        {
          ...context,
          mode,
        },
      );
    }

    return surface;
  }

  // ---------------------------------------------------------------------------
  // Document
  // ---------------------------------------------------------------------------

  setDocument(doc: PenDocument, activePageId?: string | null) {
    this.document = doc;
    this.activePageId =
      activePageId ?? doc.activePageId ?? doc.pages?.[0]?.id ?? null;
    this.syncFromDocument();
  }

  setDocumentAndPage(doc: PenDocument, activePageId: string) {
    this.setDocument(doc, activePageId);
  }

  getDocument(): PenDocument | null {
    return this.document;
  }

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------

  setPage(pageId: string) {
    if (this.activePageId === pageId) return;
    this.activePageId = pageId;
    this.syncFromDocument();
  }

  getPageIds(): string[] {
    return this.document?.pages?.map((p) => p.id) ?? [];
  }

  getActivePageId(): string | null {
    return this.activePageId;
  }

  // ---------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------

  setViewport(zoom: number, panX: number, panY: number) {
    const previousZoom = this._zoom;
    this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this._panX = panX;
    this._panY = panY;
    if (Math.abs(previousZoom - this._zoom) > VIEWPORT_EPSILON) {
      this.clearInteractionBackgroundCache("viewport_zoom");
      this.clearViewportInteractionCache("viewport_zoom");
    }
    this.markDirty();
  }

  getViewport(): ViewportState {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setBackgroundColor(color: string) {
    this.options.backgroundColor = color;
    this.clearInteractionBackgroundCache("background");
    this.clearViewportInteractionCache("background");
    this.markDirty();
  }

  zoomToFit(padding = 64) {
    if (!this.canvasEl || this.renderNodes.length === 0) return;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const rn of this.renderNodes) {
      if (rn.clipRect) continue;
      minX = Math.min(minX, rn.absX);
      minY = Math.min(minY, rn.absY);
      maxX = Math.max(maxX, rn.absX + rn.absW);
      maxY = Math.max(maxY, rn.absY + rn.absH);
    }
    if (!Number.isFinite(minX)) return;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const canvasW = this.canvasEl.clientWidth;
    const canvasH = this.canvasEl.clientHeight;
    const zoom = Math.min(
      (canvasW - padding * 2) / contentW,
      (canvasH - padding * 2) / contentH,
      2,
    );
    const panX = (canvasW - contentW * zoom) / 2 - minX * zoom;
    const panY = (canvasH - contentH * zoom) / 2 - minY * zoom;
    this.setViewport(zoom, panX, panY);
  }

  zoomToPoint(screenX: number, screenY: number, newZoom: number) {
    if (!this.canvasEl) return;
    const rect = this.canvasEl.getBoundingClientRect();
    const vp = vpZoomToPoint(
      { zoom: this._zoom, panX: this._panX, panY: this._panY },
      screenX,
      screenY,
      rect,
      newZoom,
    );
    this.setViewport(vp.zoom, vp.panX, vp.panY);
  }

  pan(dx: number, dy: number) {
    this.setViewport(this._zoom, this._panX + dx, this._panY + dy);
  }

  setInteractionMode(mode: RendererInteractionMode) {
    this.interactionMode = mode;
    this.nodeRenderer.interactionMode = mode;
    if (mode === "idle") {
      this.clearInteractionBackgroundCache("interaction_idle");
      this.clearViewportInteractionCache("interaction_idle");
    }
    this.markDirty();
  }

  setTransformPreview(preview: TransformPreviewState | null) {
    this.transformPreview = preview;
    this.transformPreviewIds = this.collectTransformPreviewIds(preview);
    this.setInteractionMode(preview ? "transform" : "idle");
  }

  clearTransformPreview() {
    this.setTransformPreview(null);
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  setThemeVariant(variant: Record<string, string>) {
    this.options.themeVariant = variant;
    this.syncFromDocument();
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  hitTest(screenX: number, screenY: number): PenNode | null {
    if (!this.canvasEl) return null;
    const rect = this.canvasEl.getBoundingClientRect();
    const scene = screenToScene(screenX, screenY, rect, {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
    });
    const labelHit = this.hitTestFrameLabel(scene.x, scene.y);
    if (labelHit) {
      console.info("[pen-renderer] frame-label.hit", {
        nodeId: labelHit.id,
        nodeName: labelHit.name,
      });
      return labelHit;
    }
    const hits = this.spatialIndex.hitTest(scene.x, scene.y);
    return hits[0]?.node ?? null;
  }

  getNodeBounds(
    nodeId: string,
  ): { x: number; y: number; w: number; h: number } | null {
    const rn = this.spatialIndex.get(nodeId);
    if (!rn) return null;
    return { x: rn.absX, y: rn.absY, w: rn.absW, h: rn.absH };
  }

  setEditorOverlays(overlays: Partial<EditorOverlayState>) {
    this.editorOverlays = {
      ...this.editorOverlays,
      ...overlays,
      selectedIds: overlays.selectedIds ?? this.editorOverlays.selectedIds,
      selectionColor:
        overlays.selectionColor ?? this.editorOverlays.selectionColor,
    };
    this.markDirty();
  }

  hitTestSelectionControl(
    screenX: number,
    screenY: number,
  ): SelectionControlHit | null {
    if (!this.canvasEl) return null;
    const rect = this.canvasEl.getBoundingClientRect();
    const scene = screenToScene(screenX, screenY, rect, {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
    });
    const selected = this.getSelectedOverlayRenderNodes();
    for (let i = selected.length - 1; i >= 0; i--) {
      const rn = selected[i];
      if (!rn) continue;
      const rotateHit = this.hitTestRotateHandle(rn, scene.x, scene.y);
      if (rotateHit) return { type: "rotate", nodeId: rn.node.id };
      const resizeHit = this.hitTestResizeHandle(rn, scene.x, scene.y);
      if (resizeHit)
        return { type: "resize", nodeId: rn.node.id, handle: resizeHit };
    }
    return null;
  }

  hitTestRect(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): PenNode[] {
    return this.spatialIndex
      .searchRect(
        bounds.x,
        bounds.y,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
      )
      .map((rn) => rn.node);
  }

  // ---------------------------------------------------------------------------
  // Internal: Document sync
  // ---------------------------------------------------------------------------

  private syncFromDocument() {
    if (!this.document) return;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const pageChildren = getActivePageChildren(
      this.document,
      this.activePageId,
    );
    const allNodes = getAllChildren(this.document);

    // Collect reusable/instance IDs
    this.reusableIds.clear();
    this.instanceIds.clear();
    collectReusableIds(pageChildren, this.reusableIds);
    collectInstanceIds(pageChildren, this.instanceIds);

    // Resolve refs
    const resolved = resolveRefs(pageChildren, allNodes);

    // Resolve design variables
    const variables = this.document.variables ?? {};
    const themes = this.document.themes;
    const activeTheme = this.options.themeVariant ?? getDefaultTheme(themes);
    const variableResolved = resolved.map((n) =>
      resolveNodeForCanvas(n, variables, activeTheme),
    );

    // Pre-measure text heights
    const measured = premeasureTextHeights(variableResolved);

    this.renderNodes = flattenToRenderNodes(measured);
    this.sceneSerial += 1;
    this.clearInteractionBackgroundCache("document_sync");
    this.clearViewportInteractionCache("document_sync");
    this.spatialIndex.rebuild(this.renderNodes);
    this.viewportIndex.rebuild(this.renderNodes);
    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    if (elapsed > SLOW_SYNC_THRESHOLD_MS) {
      console.info("[pen-renderer] renderer.sync.slow", {
        durationMs: Math.round(elapsed),
        renderNodeCount: this.renderNodes.length,
        activePageId: this.activePageId,
      });
    }
    this.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private markDirty() {
    this.dirty = true;
  }

  private startRenderLoop() {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      if (!this.dirty || !this.surface) return;
      this.dirty = false;
      this.render();
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  render() {
    if (!this.surface || !this.canvasEl) return;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const canvas = this.surface.getCanvas();
    const ck = this.ck;
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    // Clear
    const bgColor = this.options.backgroundColor ?? CANVAS_BACKGROUND_DARK;
    canvas.clear(parseColor(ck, bgColor));

    const visibleRenderNodes = this.getVisibleRenderNodes();
    const usedViewportInteractionCache = this.drawViewportInteractionCache(
      canvas,
      visibleRenderNodes,
      dpr,
    );
    if (usedViewportInteractionCache) {
      this.drawViewportDecorations(canvas, visibleRenderNodes, dpr);
      this.surface.flush();
      const elapsed =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        startedAt;
      if (elapsed > SLOW_FRAME_THRESHOLD_MS) {
        console.info("[pen-renderer] renderer.frame.slow", {
          durationMs: Math.round(elapsed),
          total: this.renderNodes.length,
          rendered: 0,
          visible: visibleRenderNodes.length,
          culled: Math.max(
            0,
            this.renderNodes.length - visibleRenderNodes.length,
          ),
          imageCount: 0,
          pathCache: this.nodeRenderer.getPathCacheSnapshot(),
          cachedViewportNodeCount: visibleRenderNodes.length,
          zoom: Number(this._zoom.toFixed(3)),
          interactionMode: this.interactionMode,
        });
      }
      return;
    }

    const transformPreviewNodes =
      this.transformPreview && this.interactionMode === "transform"
        ? visibleRenderNodes.filter((rn) =>
            this.transformPreviewIds.has(rn.node.id),
          )
        : [];
    const useInteractionBackgroundCache =
      transformPreviewNodes.length > 0 &&
      !visibleRenderNodes.some((rn) => Boolean(rn.opacityGroup));
    let drewInteractionBackgroundCache = false;
    let interactionBackgroundNodeCount = 0;

    if (useInteractionBackgroundCache) {
      const backgroundNodes = visibleRenderNodes.filter(
        (rn) => !this.transformPreviewIds.has(rn.node.id),
      );
      interactionBackgroundNodeCount = backgroundNodes.length;
      drewInteractionBackgroundCache = this.drawInteractionBackgroundCache(
        canvas,
        backgroundNodes,
        dpr,
      );
    }

    const nodesToDraw = drewInteractionBackgroundCache
      ? transformPreviewNodes
      : visibleRenderNodes;

    // Apply viewport transform
    canvas.save();
    canvas.scale(dpr, dpr);
    canvas.concat(
      viewportMatrix({ zoom: this._zoom, panX: this._panX, panY: this._panY }),
    );

    // Pass current zoom to renderer
    this.nodeRenderer.zoom = this._zoom;
    this.nodeRenderer.devicePixelRatio = dpr;

    // Draw visible render nodes only. Image-heavy canvases should not pay the
    // cost of sampling offscreen rasters while users pan, zoom, or drag.
    this.nodeRenderer.drawRenderNodes(canvas, nodesToDraw);

    this.drawEditorOverlays(canvas);
    this.drawFrameLabels(canvas, visibleRenderNodes);

    canvas.restore();
    this.surface.flush();
    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    if (elapsed > SLOW_FRAME_THRESHOLD_MS) {
      console.info("[pen-renderer] renderer.frame.slow", {
        durationMs: Math.round(elapsed),
        total: this.renderNodes.length,
        rendered: nodesToDraw.length,
        visible: visibleRenderNodes.length,
        culled: Math.max(
          0,
          this.renderNodes.length - visibleRenderNodes.length,
        ),
        imageCount: countImageRenderNodes(nodesToDraw),
        pathCache: this.nodeRenderer.getPathCacheSnapshot(),
        cachedBackgroundNodeCount: drewInteractionBackgroundCache
          ? interactionBackgroundNodeCount
          : 0,
        zoom: Number(this._zoom.toFixed(3)),
        interactionMode: this.interactionMode,
      });
    }
  }

  /** Simple frame label drawing for read-only renderer. */
  private drawFrameLabel(
    canvas: ReturnType<Surface["getCanvas"]>,
    name: string,
    x: number,
    y: number,
    selected: boolean,
  ) {
    const ck = this.ck;
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const bounds = getFrameLabelBounds(name, x, y, this._zoom, dpr);
    const cacheEntry = this.getFrameLabelCacheEntry(name, selected, dpr);
    if (cacheEntry) {
      const paint = new ck.Paint();
      paint.setAntiAlias(true);
      canvas.drawImageRect(
        cacheEntry.image,
        ck.LTRBRect(0, 0, cacheEntry.bitmapWidth, cacheEntry.bitmapHeight),
        ck.LTRBRect(bounds.left, bounds.top, bounds.right, bounds.bottom),
        paint,
      );
      paint.delete();
    }
  }

  private getFrameLabelCacheEntry(
    name: string,
    selected: boolean,
    dpr: number,
  ): FrameLabelCacheEntry | null {
    const key = getFrameLabelCacheKey(name, this._zoom, dpr, selected);
    const cached = this.frameLabelCache.get(key);
    if (cached) {
      cached.lastUsed = ++this.frameLabelCacheTick;
      return cached;
    }

    const ck = this.ck;
    const zoomBucket = getFrameLabelZoomBucket(this._zoom);
    const bounds = getFrameLabelBounds(name, 0, 0, zoomBucket, dpr);
    const { fontSize, scale } = bounds;

    // Use Canvas 2D to rasterize the label text once per zoom bucket.
    const tmp = document.createElement("canvas");
    tmp.width = bounds.bitmapWidth;
    tmp.height = bounds.bitmapHeight;
    const ctx = tmp.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    const fontWeight = selected
      ? FRAME_LABEL_SELECTED_FONT_WEIGHT
      : FRAME_LABEL_FONT_WEIGHT;
    ctx.font = `${fontWeight} ${fontSize}px ${FRAME_LABEL_FONT_FAMILY}`;
    ctx.fillStyle = FRAME_LABEL_COLOR;
    ctx.textBaseline = "top";
    ctx.fillText(name, 0, 0);

    const imageData = ctx.getImageData(
      0,
      0,
      bounds.bitmapWidth,
      bounds.bitmapHeight,
    );
    const image = ck.MakeImage(
      {
        width: bounds.bitmapWidth,
        height: bounds.bitmapHeight,
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
      },
      imageData.data,
      bounds.bitmapWidth * 4,
    );
    if (!image) return null;

    const entry = {
      image,
      bitmapWidth: bounds.bitmapWidth,
      bitmapHeight: bounds.bitmapHeight,
      lastUsed: ++this.frameLabelCacheTick,
    };
    this.frameLabelCache.set(key, entry);
    this.evictFrameLabelCacheIfNeeded();
    return entry;
  }

  private evictFrameLabelCacheIfNeeded() {
    if (this.frameLabelCache.size <= FRAME_LABEL_CACHE_MAX) return;
    let oldestKey: string | null = null;
    let oldestTick = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.frameLabelCache) {
      if (entry.lastUsed < oldestTick) {
        oldestTick = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) return;
    const oldest = this.frameLabelCache.get(oldestKey);
    oldest?.image.delete();
    this.frameLabelCache.delete(oldestKey);
  }

  private clearFrameLabelCache() {
    for (const entry of this.frameLabelCache.values()) {
      entry.image.delete();
    }
    this.frameLabelCache.clear();
  }

  private drawFrameLabels(
    canvas: ReturnType<Surface["getCanvas"]>,
    visibleRenderNodes: RenderNode[],
  ) {
    // Draw frame labels for root frames + reusable + instances
    for (const rn of visibleRenderNodes) {
      if (!rn.node.name) continue;
      if (!this.shouldDrawFrameLabel(rn)) continue;
      this.drawFrameLabel(
        canvas,
        rn.node.name,
        rn.absX,
        rn.absY,
        this.editorOverlays.selectedIds.includes(rn.node.id),
      );
    }
  }

  private drawViewportDecorations(
    canvas: ReturnType<Surface["getCanvas"]>,
    visibleRenderNodes: RenderNode[],
    dpr: number,
  ) {
    canvas.save();
    canvas.scale(dpr, dpr);
    canvas.concat(
      viewportMatrix({ zoom: this._zoom, panX: this._panX, panY: this._panY }),
    );
    this.nodeRenderer.zoom = this._zoom;
    this.nodeRenderer.devicePixelRatio = dpr;
    this.drawEditorOverlays(canvas);
    this.drawFrameLabels(canvas, visibleRenderNodes);
    canvas.restore();
  }

  private clearInteractionBackgroundCache(reason: string) {
    if (!this.interactionBackgroundCache) return;
    this.interactionBackgroundCache.image.delete();
    this.interactionBackgroundCache = null;
    console.info("[pen-renderer] renderer.interaction-cache.cleared", {
      reason,
    });
  }

  private clearViewportInteractionCache(reason: string) {
    if (!this.viewportInteractionCache) return;
    this.viewportInteractionCache.image.delete();
    this.viewportInteractionCache = null;
    console.info("[pen-renderer] renderer.viewport-cache.cleared", {
      reason,
    });
  }

  private getViewportInteractionCacheKey(dpr: number) {
    const canvas = this.canvasEl;
    if (!canvas) return null;
    return [
      this.sceneSerial,
      canvas.width,
      canvas.height,
      Number(dpr.toFixed(3)),
      Number(this._zoom.toFixed(4)),
    ].join("|");
  }

  private drawViewportInteractionCache(
    canvas: ReturnType<Surface["getCanvas"]>,
    visibleRenderNodes: RenderNode[],
    dpr: number,
  ): boolean {
    if (this.interactionMode !== "viewport" || this.transformPreview) {
      return false;
    }
    const cache = this.ensureViewportInteractionCache(dpr);
    if (!cache) return false;

    const offset = getViewportInteractionCacheDrawOffset(cache, {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
      dpr,
    });
    if (!offset) {
      this.clearViewportInteractionCache("pan_outside_padding");
      return false;
    }

    const paint = new this.ck.Paint();
    paint.setAntiAlias(false);
    canvas.drawImage(cache.image, offset.x, offset.y, paint);
    paint.delete();

    if (visibleRenderNodes.length > 0 && offset.reused) {
      return true;
    }
    return true;
  }

  private ensureViewportInteractionCache(
    dpr: number,
  ): ViewportInteractionCacheEntry | null {
    const canvas = this.canvasEl;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
    const key = this.getViewportInteractionCacheKey(dpr);
    if (!key) return null;
    if (
      this.viewportInteractionCache &&
      isViewportInteractionCacheReusable(this.viewportInteractionCache, {
        key,
        zoom: this._zoom,
        panX: this._panX,
        panY: this._panY,
      })
    ) {
      return this.viewportInteractionCache;
    }

    this.clearViewportInteractionCache("cache_miss");

    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const paddingX = Math.ceil(VIEWPORT_INTERACTION_CACHE_PADDING_PX * dpr);
    const paddingY = Math.ceil(VIEWPORT_INTERACTION_CACHE_PADDING_PX * dpr);
    const surfaceWidth = canvas.width + paddingX * 2;
    const surfaceHeight = canvas.height + paddingY * 2;
    const surface = this.ck.MakeSurface(surfaceWidth, surfaceHeight);
    if (!surface) {
      console.warn("[pen-renderer] renderer.viewport-cache.failed", {
        reason: "surface_unavailable",
        width: surfaceWidth,
        height: surfaceHeight,
      });
      return null;
    }

    const cacheViewport = {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
    };
    const paddingCssX = paddingX / dpr;
    const paddingCssY = paddingY / dpr;
    const cacheNodes = this.getVisibleRenderNodesForViewport(
      cacheViewport,
      RENDER_CULL_MARGIN_PX + Math.max(paddingCssX, paddingCssY),
    );
    const offscreen = surface.getCanvas();
    offscreen.clear(this.ck.TRANSPARENT);
    offscreen.save();
    offscreen.scale(dpr, dpr);
    offscreen.translate(paddingCssX, paddingCssY);
    offscreen.concat(viewportMatrix(cacheViewport));
    this.nodeRenderer.zoom = this._zoom;
    this.nodeRenderer.devicePixelRatio = dpr;
    this.nodeRenderer.drawRenderNodes(offscreen, cacheNodes);
    offscreen.restore();
    surface.flush();

    const image = surface.makeImageSnapshot();
    surface.delete();
    const entry = {
      image,
      key,
      width: surfaceWidth,
      height: surfaceHeight,
      paddingX: paddingCssX,
      paddingY: paddingCssY,
      panX: this._panX,
      panY: this._panY,
      zoom: this._zoom,
    };
    this.viewportInteractionCache = entry;

    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    console.info("[pen-renderer] renderer.viewport-cache.built", {
      durationMs: Math.round(elapsed),
      nodeCount: cacheNodes.length,
      width: entry.width,
      height: entry.height,
      paddingX: Math.round(entry.paddingX),
      paddingY: Math.round(entry.paddingY),
      zoom: Number(this._zoom.toFixed(3)),
    });
    return entry;
  }

  private getInteractionBackgroundCacheKey(dpr: number) {
    const canvas = this.canvasEl;
    if (!canvas || this.transformPreviewIds.size === 0) return null;
    const previewIds = Array.from(this.transformPreviewIds).sort().join(",");
    return [
      this.sceneSerial,
      canvas.width,
      canvas.height,
      Number(dpr.toFixed(3)),
      Number(this._zoom.toFixed(4)),
      Number(this._panX.toFixed(2)),
      Number(this._panY.toFixed(2)),
      previewIds,
    ].join("|");
  }

  private drawInteractionBackgroundCache(
    canvas: ReturnType<Surface["getCanvas"]>,
    backgroundNodes: RenderNode[],
    dpr: number,
  ): boolean {
    const cache = this.ensureInteractionBackgroundCache(backgroundNodes, dpr);
    if (!cache) return false;

    const paint = new this.ck.Paint();
    paint.setAntiAlias(false);
    canvas.drawImage(cache.image, 0, 0, paint);
    paint.delete();
    return true;
  }

  private ensureInteractionBackgroundCache(
    backgroundNodes: RenderNode[],
    dpr: number,
  ): InteractionBackgroundCacheEntry | null {
    const canvas = this.canvasEl;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
    const key = this.getInteractionBackgroundCacheKey(dpr);
    if (!key) return null;
    if (this.interactionBackgroundCache?.key === key) {
      return this.interactionBackgroundCache;
    }

    this.clearInteractionBackgroundCache("cache_miss");

    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const surface = this.ck.MakeSurface(canvas.width, canvas.height);
    if (!surface) {
      console.warn("[pen-renderer] renderer.interaction-cache.failed", {
        reason: "surface_unavailable",
        width: canvas.width,
        height: canvas.height,
      });
      return null;
    }

    const offscreen = surface.getCanvas();
    offscreen.clear(this.ck.TRANSPARENT);
    offscreen.save();
    offscreen.scale(dpr, dpr);
    offscreen.concat(
      viewportMatrix({ zoom: this._zoom, panX: this._panX, panY: this._panY }),
    );
    this.nodeRenderer.drawRenderNodes(offscreen, backgroundNodes);
    offscreen.restore();
    surface.flush();

    const image = surface.makeImageSnapshot();
    surface.delete();
    const entry = {
      image,
      key,
      width: canvas.width,
      height: canvas.height,
    };
    this.interactionBackgroundCache = entry;

    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    console.info("[pen-renderer] renderer.interaction-cache.built", {
      durationMs: Math.round(elapsed),
      nodeCount: backgroundNodes.length,
      width: entry.width,
      height: entry.height,
      zoom: Number(this._zoom.toFixed(3)),
    });
    return entry;
  }

  private shouldDrawFrameLabel(rn: RenderNode): boolean {
    if (!rn.node.name) return false;
    const isRootFrame = rn.node.type === "frame" && !rn.clipRect;
    const isReusable = this.reusableIds.has(rn.node.id);
    const isInstance = this.instanceIds.has(rn.node.id);
    return isRootFrame || isReusable || isInstance;
  }

  private hitTestFrameLabel(sceneX: number, sceneY: number): PenNode | null {
    const dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    for (let i = this.renderNodes.length - 1; i >= 0; i--) {
      const rn = this.renderNodes[i];
      if (!rn || !this.shouldDrawFrameLabel(rn)) continue;
      if (("locked" in rn.node ? rn.node.locked : undefined) === true) continue;
      if (("visible" in rn.node ? rn.node.visible : undefined) === false)
        continue;

      const bounds = getFrameLabelBounds(
        rn.node.name ?? "",
        rn.absX,
        rn.absY,
        this._zoom,
        dpr,
      );
      if (isFrameLabelPointHit(sceneX, sceneY, bounds, this._zoom)) {
        return rn.node;
      }
    }

    return null;
  }

  private getSelectedOverlayRenderNodes(): RenderNode[] {
    const nodes: RenderNode[] = [];
    for (const id of this.editorOverlays.selectedIds) {
      const rn = this.spatialIndex.get(id);
      if (rn) nodes.push(this.applyTransformPreviewToRenderNode(rn));
    }
    return nodes;
  }

  private getVisibleRenderNodes(): RenderNode[] {
    return this.getVisibleRenderNodesForViewport(
      { zoom: this._zoom, panX: this._panX, panY: this._panY },
      RENDER_CULL_MARGIN_PX,
    );
  }

  private getVisibleRenderNodesForViewport(
    viewport: ViewportState,
    marginPx: number,
  ): RenderNode[] {
    if (!this.canvasEl || this.renderNodes.length === 0)
      return this.renderNodes;

    const margin = marginPx / Math.max(viewport.zoom, MIN_ZOOM);
    const bounds = getViewportBounds(
      viewport,
      this.canvasEl.clientWidth,
      this.canvasEl.clientHeight,
      margin,
    );
    if (!this.transformPreview) {
      return this.viewportIndex.search(bounds);
    }
    const visible = this.viewportIndex
      .search(bounds)
      .map((rn) =>
        this.transformPreviewIds.has(rn.node.id)
          ? applyTransformPreviewToRenderNode(
              rn,
              this.transformPreview as TransformPreviewState,
              this.transformPreviewIds,
            )
          : rn,
      )
      .filter((rn) => isRenderNodeInBounds(rn, bounds));
    const visibleIds = new Set(visible.map((rn) => rn.node.id));
    for (const nodeId of this.transformPreviewIds) {
      if (visibleIds.has(nodeId)) continue;
      const rn = this.viewportIndex.get(nodeId);
      if (!rn) continue;
      const previewed = applyTransformPreviewToRenderNode(
        rn,
        this.transformPreview,
        this.transformPreviewIds,
      );
      if (!isRenderNodeInBounds(previewed, bounds)) continue;
      visible.push(previewed);
      visibleIds.add(nodeId);
    }
    visible.sort(
      (a, b) =>
        this.viewportIndex.getOrder(a.node.id) -
        this.viewportIndex.getOrder(b.node.id),
    );
    return visible;
  }

  private collectTransformPreviewIds(
    preview: TransformPreviewState | null,
  ): Set<string> {
    const ids = new Set<string>();
    if (!preview || !this.document) return ids;

    const roots = preview.kind === "move" ? preview.nodeIds : [preview.nodeId];
    const rootSet = new Set(roots);
    const visit = (nodes: PenNode[], includeDescendants: boolean) => {
      for (const node of nodes) {
        const include = includeDescendants || rootSet.has(node.id);
        if (include) ids.add(node.id);
        if ("children" in node && Array.isArray(node.children)) {
          visit(node.children as PenNode[], include);
        }
      }
    };
    visit(getActivePageChildren(this.document, this.activePageId), false);
    for (const id of roots) ids.add(id);
    return ids;
  }

  private applyTransformPreviewToRenderNode(rn: RenderNode): RenderNode {
    const preview = this.transformPreview;
    if (!preview || !this.transformPreviewIds.has(rn.node.id)) return rn;

    return applyTransformPreviewToRenderNode(
      rn,
      preview,
      this.transformPreviewIds,
    );
  }

  private drawEditorOverlays(canvas: ReturnType<Surface["getCanvas"]>) {
    this.drawShapePreviewOverlay(
      canvas,
      this.editorOverlays.shapePreview ?? null,
    );
    this.drawLinePreviewOverlay(
      canvas,
      this.editorOverlays.linePreview ?? null,
    );

    for (const rn of this.getSelectedOverlayRenderNodes()) {
      this.drawSelectionOverlay(canvas, rn);
    }

    const marquee = this.editorOverlays.marquee;
    if (marquee && marquee.width > 0 && marquee.height > 0) {
      this.drawMarqueeOverlay(
        canvas,
        marquee.x,
        marquee.y,
        marquee.width,
        marquee.height,
      );
    }

    if (this.editorOverlays.penPreview) {
      this.drawPenPreviewOverlay(canvas, this.editorOverlays.penPreview);
    }
  }

  private drawSelectionOverlay(
    canvas: ReturnType<Surface["getCanvas"]>,
    rn: RenderNode,
  ) {
    const ck = this.ck;
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;
    const invZoom = 1 / this._zoom;
    const strokeWidth = 1.5 * invZoom;
    const handleSize = 6 * invZoom;
    const halfHandle = handleSize / 2;
    const rotation = "rotation" in rn.node ? (rn.node.rotation ?? 0) : 0;
    const centerX = rn.absX + rn.absW / 2;
    const centerY = rn.absY + rn.absH / 2;

    canvas.save();
    if (rotation) {
      canvas.rotate(rotation, centerX, centerY);
    }

    const strokePaint = new ck.Paint();
    strokePaint.setStyle(ck.PaintStyle.Stroke);
    strokePaint.setAntiAlias(true);
    strokePaint.setStrokeWidth(strokeWidth);
    strokePaint.setColor(parseColor(ck, color));
    canvas.drawRect(
      ck.LTRBRect(rn.absX, rn.absY, rn.absX + rn.absW, rn.absY + rn.absH),
      strokePaint,
    );

    const handleFill = new ck.Paint();
    handleFill.setStyle(ck.PaintStyle.Fill);
    handleFill.setAntiAlias(true);
    handleFill.setColor(parseColor(ck, "#ffffff"));

    const handleStroke = new ck.Paint();
    handleStroke.setStyle(ck.PaintStyle.Stroke);
    handleStroke.setAntiAlias(true);
    handleStroke.setStrokeWidth(1 * invZoom);
    handleStroke.setColor(parseColor(ck, color));

    for (const handle of RESIZE_HANDLES) {
      const point = getResizeHandlePoint(
        handle,
        rn.absX,
        rn.absY,
        rn.absW,
        rn.absH,
      );
      const rect = ck.LTRBRect(
        point.x - halfHandle,
        point.y - halfHandle,
        point.x + halfHandle,
        point.y + halfHandle,
      );
      canvas.drawRect(rect, handleFill);
      canvas.drawRect(rect, handleStroke);
    }

    const rotatePoint = getRotateHandlePoint(
      rn.absX,
      rn.absY,
      rn.absW,
      this._zoom,
    );
    canvas.drawLine(
      rn.absX + rn.absW / 2,
      rn.absY,
      rotatePoint.x,
      rotatePoint.y,
      strokePaint,
    );
    canvas.drawCircle(rotatePoint.x, rotatePoint.y, 5 * invZoom, handleFill);
    canvas.drawCircle(rotatePoint.x, rotatePoint.y, 5 * invZoom, handleStroke);

    strokePaint.delete();
    handleFill.delete();
    handleStroke.delete();
    canvas.restore();
  }

  private drawMarqueeOverlay(
    canvas: ReturnType<Surface["getCanvas"]>,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const ck = this.ck;
    const left = Math.min(x, x + width);
    const top = Math.min(y, y + height);
    const right = Math.max(x, x + width);
    const bottom = Math.max(y, y + height);
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;

    const fillPaint = new ck.Paint();
    fillPaint.setStyle(ck.PaintStyle.Fill);
    fillPaint.setColor(parseColor(ck, "rgba(55, 191, 249, 0.08)"));
    canvas.drawRect(ck.LTRBRect(left, top, right, bottom), fillPaint);
    fillPaint.delete();

    const strokePaint = new ck.Paint();
    strokePaint.setStyle(ck.PaintStyle.Stroke);
    strokePaint.setAntiAlias(true);
    strokePaint.setStrokeWidth(1 / this._zoom);
    strokePaint.setColor(parseColor(ck, color));
    canvas.drawRect(ck.LTRBRect(left, top, right, bottom), strokePaint);
    strokePaint.delete();
  }

  private drawShapePreviewOverlay(
    canvas: ReturnType<Surface["getCanvas"]>,
    preview: EditorShapeOverlay | null,
  ) {
    if (!preview || preview.bounds.width <= 0 || preview.bounds.height <= 0)
      return;
    const ck = this.ck;
    const { x, y, width, height } = preview.bounds;
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;

    const fillPaint = new ck.Paint();
    fillPaint.setStyle(ck.PaintStyle.Fill);
    fillPaint.setAntiAlias(true);
    const fillColor = parseColor(ck, preview.fillColor);
    fillColor[3] = (fillColor[3] ?? 1) * 0.72;
    fillPaint.setColor(fillColor);

    const strokePaint = new ck.Paint();
    strokePaint.setStyle(ck.PaintStyle.Stroke);
    strokePaint.setAntiAlias(true);
    strokePaint.setStrokeWidth(1.5 / this._zoom);
    strokePaint.setColor(parseColor(ck, color));
    const dash = ck.PathEffect.MakeDash([5 / this._zoom, 3 / this._zoom], 0);
    if (dash) strokePaint.setPathEffect(dash);

    if (preview.type === "ellipse") {
      canvas.drawOval(ck.LTRBRect(x, y, x + width, y + height), fillPaint);
      canvas.drawOval(ck.LTRBRect(x, y, x + width, y + height), strokePaint);
    } else if (preview.type === "polygon") {
      const path = this.buildPolygonPath(x, y, width, height, 3);
      canvas.drawPath(path, fillPaint);
      canvas.drawPath(path, strokePaint);
      path.delete();
    } else {
      const radius = Math.min(8, width / 2, height / 2);
      const rect = ck.RRectXY(
        ck.LTRBRect(x, y, x + width, y + height),
        radius,
        radius,
      );
      canvas.drawRRect(rect, fillPaint);
      canvas.drawRRect(rect, strokePaint);
    }

    fillPaint.delete();
    strokePaint.delete();
  }

  private drawLinePreviewOverlay(
    canvas: ReturnType<Surface["getCanvas"]>,
    preview: EditorLineOverlay | null,
  ) {
    if (!preview) return;
    const dx = preview.end.x - preview.start.x;
    const dy = preview.end.y - preview.start.y;
    if (Math.hypot(dx, dy) <= 0) return;

    const ck = this.ck;
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;
    const invZoom = 1 / this._zoom;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setAntiAlias(true);
    paint.setStrokeWidth(2 * invZoom);
    paint.setStrokeCap(ck.StrokeCap.Round);
    paint.setColor(parseColor(ck, color));
    const dash = ck.PathEffect.MakeDash([5 * invZoom, 4 * invZoom], 0);
    if (dash) paint.setPathEffect(dash);

    canvas.drawLine(
      preview.start.x,
      preview.start.y,
      preview.end.x,
      preview.end.y,
      paint,
    );

    if (preview.arrow) {
      const angle = Math.atan2(dy, dx);
      const size = 10 * invZoom;
      const left = {
        x: preview.end.x - Math.cos(angle - Math.PI / 6) * size,
        y: preview.end.y - Math.sin(angle - Math.PI / 6) * size,
      };
      const right = {
        x: preview.end.x - Math.cos(angle + Math.PI / 6) * size,
        y: preview.end.y - Math.sin(angle + Math.PI / 6) * size,
      };
      canvas.drawLine(preview.end.x, preview.end.y, left.x, left.y, paint);
      canvas.drawLine(preview.end.x, preview.end.y, right.x, right.y, paint);
    }

    paint.delete();
  }

  private drawPenPreviewOverlay(
    canvas: ReturnType<Surface["getCanvas"]>,
    preview: EditorPenPreviewOverlay,
  ) {
    const { points, cursorPos, isDraggingHandle } = preview;
    if (points.length === 0) return;
    const ck = this.ck;
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;
    const invZoom = 1 / this._zoom;

    if (points.length > 1) {
      const path = this.buildPenPath(points, false);
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setAntiAlias(true);
      paint.setStrokeWidth(1.5 * invZoom);
      paint.setStrokeCap(ck.StrokeCap.Round);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
      paint.setColor(parseColor(ck, color));
      canvas.drawPath(path, paint);
      paint.delete();
      path.delete();
    }

    const last = points[points.length - 1];
    if (last && cursorPos && !isDraggingHandle) {
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setAntiAlias(true);
      paint.setStrokeWidth(1 * invZoom);
      paint.setColor(parseColor(ck, "rgba(55, 191, 249, 0.75)"));
      const dash = ck.PathEffect.MakeDash([4 * invZoom, 4 * invZoom], 0);
      if (dash) paint.setPathEffect(dash);
      canvas.drawLine(last.x, last.y, cursorPos.x, cursorPos.y, paint);
      paint.delete();
    }

    this.drawPenAnchors(canvas, points);
  }

  private drawPenAnchors(
    canvas: ReturnType<Surface["getCanvas"]>,
    points: EditorPenPreviewOverlay["points"],
  ) {
    const ck = this.ck;
    const color = this.editorOverlays.selectionColor ?? DEFAULT_SELECTION_COLOR;
    const invZoom = 1 / this._zoom;

    const linePaint = new ck.Paint();
    linePaint.setStyle(ck.PaintStyle.Stroke);
    linePaint.setAntiAlias(true);
    linePaint.setStrokeWidth(1 * invZoom);
    linePaint.setColor(parseColor(ck, "rgba(17, 24, 39, 0.45)"));

    const handleFill = new ck.Paint();
    handleFill.setStyle(ck.PaintStyle.Fill);
    handleFill.setAntiAlias(true);
    handleFill.setColor(parseColor(ck, color));

    const whiteFill = new ck.Paint();
    whiteFill.setStyle(ck.PaintStyle.Fill);
    whiteFill.setAntiAlias(true);
    whiteFill.setColor(parseColor(ck, "#ffffff"));

    const strokePaint = new ck.Paint();
    strokePaint.setStyle(ck.PaintStyle.Stroke);
    strokePaint.setAntiAlias(true);
    strokePaint.setStrokeWidth(1.5 * invZoom);
    strokePaint.setColor(parseColor(ck, color));

    const handleStroke = new ck.Paint();
    handleStroke.setStyle(ck.PaintStyle.Stroke);
    handleStroke.setAntiAlias(true);
    handleStroke.setStrokeWidth(1 * invZoom);
    handleStroke.setColor(parseColor(ck, "#ffffff"));

    for (const point of points) {
      if (point.handleIn) {
        const hx = point.x + point.handleIn.x;
        const hy = point.y + point.handleIn.y;
        canvas.drawLine(point.x, point.y, hx, hy, linePaint);
        canvas.drawCircle(hx, hy, 3 * invZoom, handleFill);
        canvas.drawCircle(hx, hy, 3 * invZoom, handleStroke);
      }
      if (point.handleOut) {
        const hx = point.x + point.handleOut.x;
        const hy = point.y + point.handleOut.y;
        canvas.drawLine(point.x, point.y, hx, hy, linePaint);
        canvas.drawCircle(hx, hy, 3 * invZoom, handleFill);
        canvas.drawCircle(hx, hy, 3 * invZoom, handleStroke);
      }
    }

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      canvas.drawCircle(
        point.x,
        point.y,
        (i === 0 ? 4.5 : 3.5) * invZoom,
        whiteFill,
      );
      canvas.drawCircle(
        point.x,
        point.y,
        (i === 0 ? 4.5 : 3.5) * invZoom,
        strokePaint,
      );
    }

    linePaint.delete();
    handleFill.delete();
    whiteFill.delete();
    strokePaint.delete();
    handleStroke.delete();
  }

  private buildPenPath(
    points: EditorPenPreviewOverlay["points"],
    closed: boolean,
  ) {
    const path = new this.ck.Path();
    const first = points[0];
    if (!first) return path;
    path.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      if (!prev.handleOut && !curr.handleIn) {
        path.lineTo(curr.x, curr.y);
      } else {
        path.cubicTo(
          prev.x + (prev.handleOut?.x ?? 0),
          prev.y + (prev.handleOut?.y ?? 0),
          curr.x + (curr.handleIn?.x ?? 0),
          curr.y + (curr.handleIn?.y ?? 0),
          curr.x,
          curr.y,
        );
      }
    }
    if (closed && points.length > 1) path.close();
    return path;
  }

  private buildPolygonPath(
    x: number,
    y: number,
    width: number,
    height: number,
    count: number,
  ) {
    const points = Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const rawW = Math.max(maxX - minX, 1);
    const rawH = Math.max(maxY - minY, 1);
    const path = new this.ck.Path();
    points.forEach((point, index) => {
      const px = x + ((point.x - minX) / rawW) * width;
      const py = y + ((point.y - minY) / rawH) * height;
      if (index === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    });
    path.close();
    return path;
  }

  private hitTestResizeHandle(
    rn: RenderNode,
    sceneX: number,
    sceneY: number,
  ): ResizeHandleDirection | null {
    const local = this.toUnrotatedSelectionPoint(rn, sceneX, sceneY);
    const hitRadius = 8 / this._zoom;
    for (const handle of RESIZE_HANDLES) {
      const point = getResizeHandlePoint(
        handle,
        rn.absX,
        rn.absY,
        rn.absW,
        rn.absH,
      );
      if (
        Math.abs(local.x - point.x) <= hitRadius &&
        Math.abs(local.y - point.y) <= hitRadius
      ) {
        return handle;
      }
    }
    return null;
  }

  private hitTestRotateHandle(
    rn: RenderNode,
    sceneX: number,
    sceneY: number,
  ): boolean {
    const local = this.toUnrotatedSelectionPoint(rn, sceneX, sceneY);
    const point = getRotateHandlePoint(rn.absX, rn.absY, rn.absW, this._zoom);
    return Math.hypot(local.x - point.x, local.y - point.y) <= 10 / this._zoom;
  }

  private toUnrotatedSelectionPoint(
    rn: RenderNode,
    sceneX: number,
    sceneY: number,
  ) {
    const rotation = "rotation" in rn.node ? (rn.node.rotation ?? 0) : 0;
    if (!rotation) return { x: sceneX, y: sceneY };
    const centerX = rn.absX + rn.absW / 2;
    const centerY = rn.absY + rn.absH / 2;
    const rad = (-rotation * Math.PI) / 180;
    const dx = sceneX - centerX;
    const dy = sceneY - centerY;
    return {
      x: centerX + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: centerY + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  }
}

function translateRenderNode(
  rn: RenderNode,
  dx: number,
  dy: number,
): RenderNode {
  const nextNode = {
    ...rn.node,
    x: (rn.node.x ?? 0) + dx,
    y: (rn.node.y ?? 0) + dy,
  } as PenNode & {
    x2?: number;
    y2?: number;
  };
  if (nextNode.type === "line") {
    if (typeof nextNode.x2 === "number") nextNode.x2 += dx;
    if (typeof nextNode.y2 === "number") nextNode.y2 += dy;
  }
  return {
    ...rn,
    node: nextNode,
    absX: rn.absX + dx,
    absY: rn.absY + dy,
    clipRect: translateClipRect(rn.clipRect, dx, dy),
  };
}

function resizeRenderNode(
  rn: RenderNode,
  bounds: { x: number; y: number; width: number; height: number },
): RenderNode {
  return {
    ...rn,
    node: {
      ...rn.node,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } as PenNode,
    absX: bounds.x,
    absY: bounds.y,
    absW: bounds.width,
    absH: bounds.height,
  };
}

function rotateRenderNode(rn: RenderNode, rotation: number): RenderNode {
  return {
    ...rn,
    node: {
      ...rn.node,
      rotation,
    } as PenNode,
  };
}

function translateClipRect(
  clipRect: RenderNode["clipRect"],
  dx: number,
  dy: number,
): RenderNode["clipRect"] {
  if (!clipRect) return undefined;
  return {
    ...clipRect,
    x: clipRect.x + dx,
    y: clipRect.y + dy,
    maskShape: clipRect.maskShape
      ? {
          ...clipRect.maskShape,
          absX: clipRect.maskShape.absX + dx,
          absY: clipRect.maskShape.absY + dy,
        }
      : undefined,
  };
}

export function applyTransformPreviewToRenderNodes(
  renderNodes: RenderNode[],
  preview: TransformPreviewState,
  previewIds: ReadonlySet<string>,
): RenderNode[] {
  return renderNodes.map((rn) =>
    applyTransformPreviewToRenderNode(rn, preview, previewIds),
  );
}

function applyTransformPreviewToRenderNode(
  rn: RenderNode,
  preview: TransformPreviewState,
  previewIds: ReadonlySet<string>,
): RenderNode {
  if (!previewIds.has(rn.node.id)) return rn;
  if (preview.kind === "move") {
    return translateRenderNode(rn, preview.dx, preview.dy);
  }
  if (preview.kind === "resize" && rn.node.id === preview.nodeId) {
    return resizeRenderNode(rn, preview.bounds);
  }
  if (preview.kind === "rotate" && rn.node.id === preview.nodeId) {
    return rotateRenderNode(rn, preview.rotation);
  }
  return rn;
}

export function isViewportInteractionCacheReusable(
  cache: ViewportInteractionCacheSnapshot,
  viewport: { key: string; zoom: number; panX: number; panY: number },
): boolean {
  if (cache.key !== viewport.key) return false;
  if (Math.abs(cache.zoom - viewport.zoom) > VIEWPORT_EPSILON) return false;
  return (
    Math.abs(viewport.panX - cache.panX) <= cache.paddingX &&
    Math.abs(viewport.panY - cache.panY) <= cache.paddingY
  );
}

export function getViewportInteractionCacheDrawOffset(
  cache: ViewportInteractionCacheSnapshot,
  viewport: { zoom: number; panX: number; panY: number; dpr: number },
): { x: number; y: number; reused: boolean } | null {
  if (Math.abs(cache.zoom - viewport.zoom) > VIEWPORT_EPSILON) return null;
  const dx = viewport.panX - cache.panX;
  const dy = viewport.panY - cache.panY;
  if (Math.abs(dx) > cache.paddingX || Math.abs(dy) > cache.paddingY) {
    return null;
  }
  const dpr = Math.max(viewport.dpr, 1);
  return {
    x: (dx - cache.paddingX) * dpr,
    y: (dy - cache.paddingY) * dpr,
    reused: Math.abs(dx) > VIEWPORT_EPSILON || Math.abs(dy) > VIEWPORT_EPSILON,
  };
}

export function filterRenderNodesToViewport(
  renderNodes: RenderNode[],
  bounds: { left: number; top: number; right: number; bottom: number },
): RenderNode[] {
  return renderNodes.filter((rn) => isRenderNodeInBounds(rn, bounds));
}

export function filterRenderNodesToViewportWithTransformPreview(
  renderNodes: RenderNode[],
  bounds: { left: number; top: number; right: number; bottom: number },
  preview: TransformPreviewState,
  previewIds: ReadonlySet<string>,
): RenderNode[] {
  const visible: RenderNode[] = [];
  for (const rn of renderNodes) {
    const next = applyTransformPreviewToRenderNode(rn, preview, previewIds);
    if (isRenderNodeInBounds(next, bounds)) {
      visible.push(next);
    }
  }
  return visible;
}

function isRenderNodeInBounds(
  rn: RenderNode,
  bounds: { left: number; top: number; right: number; bottom: number },
): boolean {
  const left = rn.clipRect ? Math.max(rn.absX, rn.clipRect.x) : rn.absX;
  const top = rn.clipRect ? Math.max(rn.absY, rn.clipRect.y) : rn.absY;
  const right = rn.clipRect
    ? Math.min(rn.absX + rn.absW, rn.clipRect.x + rn.clipRect.w)
    : rn.absX + rn.absW;
  const bottom = rn.clipRect
    ? Math.min(rn.absY + rn.absH, rn.clipRect.y + rn.clipRect.h)
    : rn.absY + rn.absH;

  return !(
    right < bounds.left ||
    left > bounds.right ||
    bottom < bounds.top ||
    top > bounds.bottom
  );
}

function countImageRenderNodes(renderNodes: RenderNode[]): number {
  let count = 0;
  for (const rn of renderNodes) {
    if (rn.node.type === "image") count += 1;
    const fills = "fill" in rn.node ? rn.node.fill : undefined;
    if (Array.isArray(fills) && fills.some((fill) => fill.type === "image")) {
      count += 1;
    }
  }
  return count;
}

function getResizeHandlePoint(
  handle: ResizeHandleDirection,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const points: Record<ResizeHandleDirection, { x: number; y: number }> = {
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
    nw: { x, y },
  };
  return points[handle];
}

export interface FrameLabelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  bitmapWidth: number;
  bitmapHeight: number;
  fontSize: number;
  scale: number;
}

export function getFrameLabelBounds(
  name: string,
  x: number,
  y: number,
  zoom: number,
  dpr = 1,
): FrameLabelBounds {
  const safeZoom = Math.max(zoom, MIN_ZOOM);
  const safeDpr = Math.max(dpr, 1);
  const fontSize = FRAME_LABEL_FONT_SIZE / safeZoom;
  const offsetY = FRAME_LABEL_OFFSET_Y / safeZoom;
  const scale = Math.max(Math.min(safeZoom * safeDpr, 4), 0.01);
  const estimatedTextWidth = estimateFrameLabelTextWidth(name, fontSize);
  const bitmapWidth = Math.ceil(estimatedTextWidth * scale) + 4;
  const bitmapHeight = Math.ceil(fontSize * 1.4 * scale) + 4;
  const renderWidth = bitmapWidth / scale;
  const renderHeight = bitmapHeight / scale;
  const bottom = y - offsetY;

  return {
    left: x,
    top: bottom - renderHeight,
    right: x + renderWidth,
    bottom,
    bitmapWidth,
    bitmapHeight,
    fontSize,
    scale,
  };
}

export function isFrameLabelPointHit(
  sceneX: number,
  sceneY: number,
  bounds: FrameLabelBounds,
  zoom: number,
): boolean {
  const safeZoom = Math.max(zoom, MIN_ZOOM);
  const padX = FRAME_LABEL_HIT_PADDING_X / safeZoom;
  const padY = FRAME_LABEL_HIT_PADDING_Y / safeZoom;

  return (
    sceneX >= bounds.left - padX &&
    sceneX <= bounds.right + padX &&
    sceneY >= bounds.top - padY &&
    sceneY <= bounds.bottom + padY
  );
}

function estimateFrameLabelTextWidth(name: string, fontSize: number): number {
  if (!name) return fontSize;

  const units = Array.from(name).reduce((sum, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return sum + (codePoint > 0xff ? 1 : 0.62);
  }, 0);

  return Math.max(fontSize, units * fontSize);
}

function getFrameLabelZoomBucket(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.round(zoom * 20) / 20);
}

function getFrameLabelCacheKey(
  name: string,
  zoom: number,
  dpr: number,
  selected: boolean,
): string {
  const zoomBucket = getFrameLabelZoomBucket(zoom);
  const dprBucket = Math.round(Math.max(dpr, 1) * 100) / 100;
  return `${name}\u0001${zoomBucket}\u0001${dprBucket}\u0001${selected ? "1" : "0"}`;
}

function getRotateHandlePoint(x: number, y: number, w: number, zoom: number) {
  return {
    x: x + w / 2,
    y: y - 28 / zoom,
  };
}
