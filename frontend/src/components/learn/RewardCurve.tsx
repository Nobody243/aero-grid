'use client';

import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { QLearningTrainEpisode } from '@/lib/store';

interface RewardCurveProps {
  episodes: QLearningTrainEpisode[];
  currentEpisode: number;
  convergedAt: number | null;
  hasFinished: boolean;
}

const BASELINE_WINDOW = 50;

export const RewardCurve: React.FC<RewardCurveProps> = ({
  episodes,
  currentEpisode,
  convergedAt,
  hasFinished,
}) => {
  // Baseline: average reward of the FIRST BASELINE_WINDOW episodes.
  // Computed once across the whole history so the dashed line is stable
  // as the curve fills in.
  const baseline = useMemo(() => {
    if (episodes.length < BASELINE_WINDOW) return null;
    const window = episodes.slice(0, BASELINE_WINDOW);
    return window.reduce((acc, e) => acc + e.reward, 0) / window.length;
  }, [episodes]);

  const data = useMemo(
    () => episodes.slice(0, Math.max(2, Math.min(episodes.length, currentEpisode + 1))),
    [episodes, currentEpisode],
  );

  const showConvergence =
    convergedAt !== null && (hasFinished || currentEpisode >= convergedAt);

  return (
    <div className="h-[140px] bg-[#06090f] border border-[#1c2d4a] rounded-[3px] p-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="reward-curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00ddb4" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#00ddb4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="2 2" vertical={false} />
          <XAxis dataKey="episode" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0b1120',
              border: '1px solid #1c2d4a',
              borderRadius: '3px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
              padding: '4px 8px',
            }}
            labelStyle={{ color: '#6b7fa3', fontSize: '9px', letterSpacing: '1px' }}
            itemStyle={{ color: '#00ddb4' }}
            labelFormatter={(v) => `EP ${v}`}
            formatter={(v: number) => [v.toFixed(1), 'REWARD']}
          />
          {baseline !== null && (
            <ReferenceLine
              y={baseline}
              stroke="#e03535"
              strokeOpacity={0.6}
              strokeDasharray="3 3"
              label={{
                value: `BASELINE ${baseline.toFixed(0)}`,
                position: 'insideTopLeft',
                fontSize: 8,
                fill: 'rgba(224,53,53,0.7)',
                fontFamily: 'JetBrains Mono',
                letterSpacing: 1,
              }}
            />
          )}
          {showConvergence && (
            <ReferenceLine
              x={convergedAt as number}
              stroke="#00a8ff"
              strokeOpacity={0.55}
              strokeDasharray="3 3"
              label={{
                value: `CONV ${convergedAt}`,
                position: 'insideTopRight',
                fontSize: 8,
                fill: 'rgba(0,168,255,0.8)',
                fontFamily: 'JetBrains Mono',
                letterSpacing: 1,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="reward"
            stroke="#00ddb4"
            strokeWidth={1.5}
            fill="url(#reward-curve-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
