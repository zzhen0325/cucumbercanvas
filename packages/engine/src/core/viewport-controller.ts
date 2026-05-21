import type { ViewportState } from '@cucumber/pen-types';
import { MIN_ZOOM, MAX_ZOOM } from './constants.js';

export interface ViewportControllerOptions {
  onChange?: (state: ViewportState) => void;
}

export class ViewportController {
  private _zoom = 1;
  private _panX = 0;
  private _panY = 0;
  private onChangeCb?: (state: ViewportState) => void;

  constructor(options?: ViewportControllerOptions) {
    this.onChangeCb = options?.onChange;
  }

  get zoom(): number {
    return this._zoom;
  }
  get panX(): number {
    return this._panX;
  }
  get panY(): number {
    return this._panY;
  }

  setViewport(zoom: number, panX: number, panY: number): void {
    this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this._panX = panX;
    this._panY = panY;
    this.onChangeCb?.({ zoom: this._zoom, panX: this._panX, panY: this._panY });
  }

  screenToScene(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this._panX) / this._zoom,
      y: (screenY - this._panY) / this._zoom,
    };
  }

  sceneToScreen(sceneX: number, sceneY: number): { x: number; y: number } {
    return {
      x: sceneX * this._zoom + this._panX,
      y: sceneY * this._zoom + this._panY,
    };
  }

  zoomToRect(
    x: number,
    y: number,
    w: number,
    h: number,
    containerW: number,
    containerH: number,
    padding = 0,
  ): void {
    if (w <= 0 || h <= 0) return;
    const scaleX = (containerW - padding * 2) / w;
    const scaleY = (containerH - padding * 2) / h;
    let zoom = Math.min(scaleX, scaleY, 1);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    this.setViewport(zoom, containerW / 2 - centerX * zoom, containerH / 2 - centerY * zoom);
  }

  getState(): ViewportState {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }
}
