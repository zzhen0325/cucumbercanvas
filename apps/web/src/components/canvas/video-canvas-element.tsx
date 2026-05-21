"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

type VideoCanvasElementProps = {
  src: string;
  width: number;
  height: number;
};

/**
 * Lightweight inline video player rendered inside Excalidraw embeddable elements.
 *
 * Behavior:
 * - Click anywhere on the surface to toggle play / pause
 * - Inline overlay controls keep playback inside the canvas container
 * - Muted by default so autoplay remains browser-safe when users start playback
 * - Stops event propagation so Excalidraw canvas interactions are not affected
 */
export function VideoCanvasElement({
  src,
  width,
  height,
}: VideoCanvasElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const progressLabel = useMemo(() => {
    if (!duration || !Number.isFinite(duration)) return null;
    return `${formatTime(progress)} / ${formatTime(duration)}`;
  }, [progress, duration]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.play().catch(() => {
      // Autoplay may be blocked by the browser; fail silently
    });
    setPlaying(true);
  }, [muted]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (playing) {
        pause();
      } else {
        play();
      }
    },
    [playing, play, pause],
  );

  const toggleMuted = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  }, [muted]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setProgress(video.currentTime || 0);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  // Prevent Excalidraw from capturing pointer/wheel events on the video area
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      style={{ width, height }}
      className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black"
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onPointerMove={stopPropagation}
      onWheel={stopPropagation}
      onClick={handleClick}
    >
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        poster=""
        className="h-full w-full object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-black/10 opacity-100 transition-opacity duration-200" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
          {playing ? (
            <Pause className="h-5 w-5 text-white" fill="white" />
          ) : (
            <Play className="h-5 w-5 text-white" fill="white" />
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/50 px-3 py-2 text-white backdrop-blur-sm">
        <button
          type="button"
          onClick={handleClick}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" fill="white" />
          )}
        </button>
        <button
          type="button"
          onClick={toggleMuted}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          {muted ? (
            <VolumeX className="h-3.5 w-3.5" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-150"
            style={{
              width:
                duration > 0
                  ? `${Math.min(100, (progress / duration) * 100)}%`
                  : "0%",
            }}
          />
        </div>
        {progressLabel && (
          <div className="min-w-17 text-right text-[10px] font-medium tabular-nums text-white/90">
            {progressLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
