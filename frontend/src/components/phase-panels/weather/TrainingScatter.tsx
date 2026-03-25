'use client';

import React from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Cell,
  ReferenceDot,
} from 'recharts';
import type { WeatherTrainingPoint } from '@/lib/store';

const LABEL_FILL: Record<number, string> = {
  0: 'rgba(0, 212, 90, 0.55)',
  1: 'rgba(255, 170, 0, 0.55)',
  2: 'rgba(224, 53, 53, 0.55)',
};

interface TrainingScatterProps {
  data: WeatherTrainingPoint[];
  currentInput: { wind: number; visibility: number };
}

export const TrainingScatter: React.FC<TrainingScatterProps> = ({ data, currentInput }) => {
  return (
    <div className="space-y-1.5">
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, bottom: 18, left: 4 }}>
            <XAxis
              type="number"
              dataKey="wind"
              domain={[0, 80]}
              tick={{ fontSize: 8, fill: '#6b7fa3', fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#1c2d4a' }}
              tickLine={false}
              label={{
                value: 'WIND (km/h)',
                position: 'insideBottom',
                offset: -8,
                fontSize: 7,
                fill: '#3a4f6b',
                fontFamily: 'JetBrains Mono',
                letterSpacing: 2,
              }}
            />
            <YAxis
              type="number"
              dataKey="visibility"
              domain={[0, 10]}
              tick={{ fontSize: 8, fill: '#6b7fa3', fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#1c2d4a' }}
              tickLine={false}
              width={26}
              label={{
                value: 'VIS',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                fontSize: 7,
                fill: '#3a4f6b',
                fontFamily: 'JetBrains Mono',
                letterSpacing: 2,
              }}
            />
            <ZAxis range={[18, 18]} />
            <Tooltip cursor={{ stroke: '#1c2d4a', strokeDasharray: '2 2' }} content={<ScatterTooltip />} />
            <Scatter data={data} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={LABEL_FILL[d.label] ?? '#6b7fa3'} stroke="none" />
              ))}
            </Scatter>
            <ReferenceDot
              x={currentInput.wind}
              y={currentInput.visibility}
              shape={<CrosshairStar />}
              ifOverflow="extendDomain"
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <Legend />
      <p className="text-[10px] text-[#6b7fa3] leading-relaxed">
        200 real Open-Meteo records from Islamabad (2022-2023). The crosshair marks your current input.
      </p>
    </div>
  );
};

// ── Custom marker for the user input ────────────────────────────────────

const CrosshairStar: React.FC<{ cx?: number; cy?: number }> = ({ cx, cy }) => {
  if (cx == null || cy == null) return null;
  const r = 7;
  const arm = 11;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* pulsing halo */}
      <circle cx={cx} cy={cy} r={r + 4}>
        <animate attributeName="opacity" values="0.45;0.05;0.45" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="r" values={`${r + 2};${r + 7};${r + 2}`} dur="1.8s" repeatCount="indefinite" />
      </circle>
      {/* crosshair lines */}
      <line x1={cx - arm} y1={cy} x2={cx - r - 0.5} y2={cy} stroke="#ffffff" strokeWidth={1} opacity={0.85} />
      <line x1={cx + r + 0.5} y1={cy} x2={cx + arm} y2={cy} stroke="#ffffff" strokeWidth={1} opacity={0.85} />
      <line x1={cx} y1={cy - arm} x2={cx} y2={cy - r - 0.5} stroke="#ffffff" strokeWidth={1} opacity={0.85} />
      <line x1={cx} y1={cy + r + 0.5} x2={cx} y2={cy + arm} stroke="#ffffff" strokeWidth={1} opacity={0.85} />
      {/* central dot */}
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.10)" stroke="#ffffff" strokeWidth={1.25} />
      <circle cx={cx} cy={cy} r={2.5} fill="#ffffff" />
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth={0.5} />
    </g>
  );
};

// ── Custom tooltip ──────────────────────────────────────────────────────

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ payload?: WeatherTrainingPoint }>;
}

const ScatterTooltip: React.FC<TooltipPayload> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-[#06090f] border border-[#1c2d4a] rounded-[3px] px-2.5 py-1.5 font-mono text-[9px] space-y-0.5">
      <div className="text-[8px] tracking-[1.5px] uppercase" style={{ color: dotColor(p.label) }}>
        {p.label_name}
      </div>
      <div className="text-[#a0b4d0] tabular-nums">
        wind {p.wind.toFixed(1)} <span className="text-[#3a4f6b]">·</span> vis {p.visibility.toFixed(1)} <span className="text-[#3a4f6b]">·</span> rain {p.rainfall.toFixed(1)}
      </div>
    </div>
  );
};

const dotColor = (label: number): string => {
  if (label === 0) return '#00d45a';
  if (label === 1) return '#ffaa00';
  return '#e03535';
};

// ── Legend ──────────────────────────────────────────────────────────────

const Legend: React.FC = () => (
  <div className="flex items-center justify-center gap-4 text-[8px] font-mono tracking-[1.5px] uppercase text-[#6b7fa3]">
    <LegendDot color="#00d45a" label="Safe" />
    <LegendDot color="#ffaa00" label="Alt Drop" />
    <LegendDot color="#e03535" label="Grounded" />
    <span className="text-[#3a4f6b]">·</span>
    <div className="flex items-center gap-1.5">
      <svg width="10" height="10" viewBox="-5 -5 10 10">
        <line x1="-4" y1="0" x2="-2" y2="0" stroke="white" strokeWidth="1" />
        <line x1="2" y1="0" x2="4" y2="0" stroke="white" strokeWidth="1" />
        <line x1="0" y1="-4" x2="0" y2="-2" stroke="white" strokeWidth="1" />
        <line x1="0" y1="2" x2="0" y2="4" stroke="white" strokeWidth="1" />
        <circle cx="0" cy="0" r="1.5" fill="white" />
      </svg>
      <span className="text-[#a0b4d0]">Your input</span>
    </div>
  </div>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1.5">
    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
    <span>{label}</span>
  </div>
);
