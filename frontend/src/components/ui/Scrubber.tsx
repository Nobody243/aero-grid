'use client';

import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';

export interface ScrubberTick {
  frame: number;
  label: string;
}

export interface ScrubberProps {
  // `frame` may be fractional (e.g. /learn page uses 23.47 for crossfade
  // between snapshots). The display always shows floor(frame) via the
  // formatLabel hook.
  frame: number;
  totalFrames: number;
  hasCompleted: boolean;

  playing: boolean;
  onPlayPause: () => void;

  speed?: number;
  speeds?: number[];
  onSpeedChange?: (s: number) => void;

  // Called continuously during drag (no debounce) AND on track click.
  onScrub: (frame: number) => void;

  // Called once when the user starts a drag; the parent should set
  // `playing=false` so autoplay doesn't fight the user. Optional —
  // pages that don't have autoplay can omit it.
  onScrubStart?: () => void;

  ticks?: ScrubberTick[];

  formatLabel?: (frame: number, total: number) => string;
}

const DEFAULT_SPEEDS = [0.25, 0.5, 1, 2, 4];
const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1] as const;

export const Scrubber: React.FC<ScrubberProps> = ({
  frame,
  totalFrames,
  hasCompleted,
  playing,
  onPlayPause,
  speed,
  speeds = DEFAULT_SPEEDS,
  onSpeedChange,
  onScrub,
  onScrubStart,
  ticks,
  formatLabel,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // `dragging` is reactive (re-renders to swap the fill bar's transition
  // off during drag) and mirrors draggingRef.
  const [dragging, setDragging] = useState(false);
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);

  const max = Math.max(0, totalFrames - 1);
  const clampedFrame = Math.max(0, Math.min(max, frame));
  const pct = max > 0 ? (clampedFrame / max) * 100 : 0;
  const showSpeed = typeof speed === 'number' && speeds && onSpeedChange;

  // Frame from clientX. Keeps fractional precision for the /learn page;
  // pages that want integer frames (e.g. /fly) round inside onScrub.
  const frameFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || max <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = rect.width > 0 ? x / rect.width : 0;
      return ratio * max;
    },
    [max],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!hasCompleted) return;
      // Notify parent FIRST so autoplay pauses before any frame update
      // ricochets through their reducer.
      onScrubStart?.();
      const next = frameFromClientX(e.clientX);
      onScrub(next);
      draggingRef.current = true;
      setDragging(true);
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    },
    [hasCompleted, frameFromClientX, onScrub, onScrubStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !hasCompleted) return;
      onScrub(frameFromClientX(e.clientX));
    },
    [hasCompleted, frameFromClientX, onScrub],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    setDragging(false);
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasCompleted || max <= 0) return;
      let next = clampedFrame;
      const big = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft')      next = clampedFrame - big;
      else if (e.key === 'ArrowRight') next = clampedFrame + big;
      else if (e.key === 'Home')       next = 0;
      else if (e.key === 'End')        next = max;
      else return;
      e.preventDefault();
      onScrub(Math.max(0, Math.min(max, next)));
    },
    [clampedFrame, hasCompleted, max, onScrub],
  );

  const labelText = formatLabel ? formatLabel(clampedFrame, totalFrames) : `Frame ${clampedFrame} / ${max}`;

  return (
    <div className="w-full flex items-center gap-4 select-none">
      {/* Play / Pause */}
      <button
        type="button"
        onClick={onPlayPause}
        aria-label={playing ? 'Pause' : 'Play'}
        className="w-9 h-9 shrink-0 rounded-full bg-[rgba(0,168,255,0.10)] border border-[#00a8ff] text-[#00a8ff] flex items-center justify-center hover:bg-[rgba(0,168,255,0.22)] transition-colors duration-150"
      >
        {playing
          ? <Pause size={14} fill="currentColor" />
          : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>

      {/* Track + label */}
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={hasCompleted ? 0 : -1}
          aria-valuenow={clampedFrame}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-readonly={!hasCompleted}
          aria-label="Timeline scrubber"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
          className={[
            'relative h-4 flex items-center rounded-full focus:outline-none',
            hasCompleted ? 'cursor-pointer focus-visible:ring-1 focus-visible:ring-[#00a8ff]' : 'cursor-default',
          ].join(' ')}
        >
          {/* Track base */}
          <motion.div
            className="absolute inset-x-0 bg-[#1a2540] rounded-full"
            initial={false}
            animate={{ height: hasCompleted ? 8 : 4 }}
            transition={{ duration: 0.18, ease: EASE_OUT_QUART }}
            style={{ top: '50%', transform: 'translateY(-50%)' }}
          />
          {/* Filled portion — spring physics on width during autoplay/click,
              disabled while dragging so the bar tracks the cursor pixel-perfect. */}
          <motion.div
            className="absolute left-0 bg-[#00a8ff] rounded-full"
            initial={false}
            animate={{
              width: `${pct}%`,
              height: hasCompleted ? 8 : 4,
            }}
            transition={
              dragging
                ? { duration: 0 }
                : { type: 'spring', stiffness: 380, damping: 32, mass: 0.5 }
            }
            style={{ top: '50%', transform: 'translateY(-50%)' }}
          />

          {/* Tick marks (interactive mode only) */}
          {hasCompleted && ticks?.map((t, i) => {
            const tpct = max > 0 ? (t.frame / max) * 100 : 0;
            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredTick(i)}
                onMouseLeave={() => setHoveredTick(null)}
                className="absolute"
                style={{ left: `${tpct}%`, top: 0, bottom: 0, transform: 'translateX(-50%)' }}
                aria-label={t.label}
              >
                <div
                  className="absolute w-[2px] h-[6px] bg-[#00a8ff] opacity-40 rounded-[1px]"
                  style={{ top: 0, left: '50%', transform: 'translateX(-50%)' }}
                />
                {hoveredTick === i && (
                  <div
                    className="pointer-events-none absolute whitespace-nowrap px-2 py-1 rounded-[2px] bg-[#0b1120] border border-[#1c2d4a] text-[#a0b4d0] text-[9px] font-mono tracking-[1px] uppercase"
                    style={{ top: -30, left: '50%', transform: 'translateX(-50%)' }}
                  >
                    {t.label}
                  </div>
                )}
              </div>
            );
          })}

          {/* Thumb (fades in when interactive). Left position uses the same
              spring as the fill so they stay in lockstep. */}
          <motion.div
            className="absolute rounded-full bg-[#00a8ff] border-2 border-white pointer-events-none"
            initial={false}
            animate={{
              opacity: hasCompleted ? 1 : 0,
              boxShadow: hasCompleted
                ? (dragging ? '0 0 14px rgba(0,168,255,0.75)' : '0 0 10px rgba(0,168,255,0.55)')
                : '0 0 0 rgba(0,168,255,0)',
              left: `${pct}%`,
            }}
            transition={
              dragging
                ? { left: { duration: 0 }, opacity: { duration: 0.18 }, boxShadow: { duration: 0.12 } }
                : { type: 'spring', stiffness: 380, damping: 32, mass: 0.5 }
            }
            style={{
              width: 12,
              height: 12,
              top: '50%',
              translateX: '-50%',
              translateY: '-50%',
            }}
          />
        </div>

        <div className="text-[9px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase tabular-nums">
          {labelText}
        </div>
      </div>

      {/* Speed pills */}
      {showSpeed && (
        <div className="flex items-center gap-1 shrink-0">
          {speeds.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange?.(s)}
              className={[
                'px-2 py-0.5 rounded-[2px] text-[9px] font-mono font-bold border tracking-[1px] transition-colors duration-150',
                s === speed
                  ? 'border-[#00ddb4] text-[#00ddb4] bg-[rgba(0,221,180,0.06)]'
                  : 'border-[#1c2d4a] text-[#6b7fa3] hover:text-[#a0b4d0]',
              ].join(' ')}
            >
              {s}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
