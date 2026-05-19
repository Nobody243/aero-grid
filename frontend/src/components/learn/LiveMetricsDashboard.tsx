'use client';

import React, { useMemo } from 'react';
import type { QLearningTrainEpisode } from '@/lib/store';

interface LiveMetricsDashboardProps {
  episodes: QLearningTrainEpisode[];   // full history from training
  currentEpisode: number;              // episode index up to which we've animated
  totalEpisodes: number;               // hyperparameters.max_episodes
  convergedAt: number | null;          // null while training still running
  hasFinished: boolean;
}

const ROLLING_WINDOW = 50;

export const LiveMetricsDashboard: React.FC<LiveMetricsDashboardProps> = ({
  episodes,
  currentEpisode,
  totalEpisodes,
  convergedAt,
  hasFinished,
}) => {
  const current = episodes[Math.min(currentEpisode, episodes.length - 1)];

  // Rolling stats over the last ROLLING_WINDOW episodes the user has SEEN.
  // We slice up to currentEpisode (inclusive) so the dashboard reflects the
  // training story at the scrubbed-to moment, not the final result.
  const { avgReward, bestReward } = useMemo(() => {
    if (!episodes.length || currentEpisode < 0) return { avgReward: 0, bestReward: 0 };
    const upto = Math.min(currentEpisode + 1, episodes.length);
    const lo = Math.max(0, upto - ROLLING_WINDOW);
    const window = episodes.slice(lo, upto);
    const sum = window.reduce((acc, e) => acc + e.reward, 0);
    const best = episodes.slice(0, upto).reduce(
      (m, e) => (e.reward > m ? e.reward : m),
      -Infinity,
    );
    return {
      avgReward: window.length > 0 ? sum / window.length : 0,
      bestReward: best === -Infinity ? 0 : best,
    };
  }, [episodes, currentEpisode]);

  const convergenceText =
    convergedAt !== null && (hasFinished || currentEpisode >= convergedAt)
      ? `@ ${convergedAt}`
      : 'pending';
  const convergenceColor =
    convergedAt !== null && (hasFinished || currentEpisode >= convergedAt)
      ? '#00ddb4'
      : '#3a4f6b';

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-5">
      <Stat label="Episode"        value={`${current?.episode ?? 0} / ${totalEpisodes - 1}`} color="#00a8ff" />
      <Stat label="Epsilon"        value={current ? current.epsilon.toFixed(2) : '—'}        color="#a0b4d0" />
      <Stat label="Avg reward (50)" value={avgReward.toFixed(1)}                              color="#a0b4d0" />

      <Stat label="Steps"          value={current ? current.steps.toString() : '—'}          color="#a0b4d0" />
      <Stat label="Best reward"    value={bestReward !== 0 ? `+${bestReward.toFixed(1)}` : '—'} color="#00ddb4" />
      <Stat label="Convergence"    value={convergenceText}                                    color={convergenceColor} />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="space-y-1">
    <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</div>
    <div className="text-[15px] font-mono font-bold leading-none tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);
