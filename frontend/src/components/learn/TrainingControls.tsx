'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';

interface TrainingControlsProps {
  state: 'idle' | 'fetching' | 'animating' | 'finished';
  currentEpisode: number;
  totalEpisodes: number;
  onStart: () => void;
  disabled?: boolean;
}

export const TrainingControls: React.FC<TrainingControlsProps> = ({
  state,
  currentEpisode,
  totalEpisodes,
  onStart,
  disabled = false,
}) => {
  if (state === 'idle') {
    return (
      <motion.button
        type="button"
        onClick={onStart}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[3px] border-[1.5px] border-[#00a8ff] bg-[rgba(0,168,255,0.10)] text-[#00a8ff] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:bg-[rgba(0,168,255,0.22)] hover:shadow-[0_0_20px_rgba(0,168,255,0.30)] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
      >
        <Play size={13} fill="currentColor" className="ml-0.5" />
        Start Training
      </motion.button>
    );
  }

  if (state === 'fetching') {
    return (
      <div className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] text-[#6b7fa3] font-mono font-bold tracking-[2px] uppercase text-[11px]">
        <Loader2 size={12} className="animate-spin" />
        Training in background
      </div>
    );
  }

  if (state === 'animating') {
    const pct = totalEpisodes > 0 ? (currentEpisode / (totalEpisodes - 1)) * 100 : 0;
    return (
      <div className="w-full space-y-2">
        <div className="flex items-baseline justify-between text-[9px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">
          <span>Replaying training</span>
          <span className="tabular-nums text-[#a0b4d0]">
            Episode {currentEpisode} / {Math.max(0, totalEpisodes - 1)}
          </span>
        </div>
        <div className="h-1.5 w-full bg-[#1a2540] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#00a8ff]"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>
    );
  }

  // 'finished' — controls collapse; scrubber + comparison panel take over.
  return null;
};
