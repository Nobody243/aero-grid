'use client';

import React from 'react';
import type { Phase } from './PhaseStepper';

interface MissionStatusStripProps {
  weatherLabel: string | null;        // "Safe to Fly" | "Requires Altitude Drop" | "Grounded" | null
  bestDistance: number | null;
  naiveDistance: number | null;
  improvementPct: number | null;
  activePhase: Phase;
  currentLeg: number | null;          // 1-indexed; null if not flying
  totalLegs: number | null;
  battery: number | null;             // 0-100
}

const WEATHER_DOT_COLORS: Record<string, string> = {
  'Safe to Fly':            '#00d45a',
  'Requires Altitude Drop': '#ffaa00',
  'Grounded':               '#e03535',
};

export const MissionStatusStrip: React.FC<MissionStatusStripProps> = ({
  weatherLabel,
  bestDistance,
  naiveDistance,
  improvementPct,
  activePhase,
  currentLeg,
  totalLegs,
  battery,
}) => {
  return (
    <div className="grid grid-cols-4 border-t border-[#1c2d4a] bg-[#0b1120]">
      <Segment label="Weather">
        {weatherLabel ? (
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: WEATHER_DOT_COLORS[weatherLabel] ?? '#6b7fa3' }}
            />
            <span style={{ color: WEATHER_DOT_COLORS[weatherLabel] ?? '#a0b4d0' }} className="text-[11px] font-mono font-bold uppercase tracking-[1.5px]">
              {weatherLabel}
            </span>
          </div>
        ) : (
          <Pending />
        )}
      </Segment>

      <Segment label="Route">
        {bestDistance !== null && naiveDistance !== null && improvementPct !== null ? (
          <div className="text-[11px] font-mono text-[#a0b4d0]">
            <span className="font-bold text-white">{bestDistance.toFixed(1)}</span>
            <span className="text-[#3a4f6b]"> / {naiveDistance.toFixed(1)} </span>
            <span className="text-[#00d45a] font-bold">−{improvementPct.toFixed(1)}%</span>
          </div>
        ) : (
          <Pending />
        )}
      </Segment>

      <Segment label="Phase">
        <div className="text-[11px] font-mono font-bold text-[#a0b4d0] uppercase tracking-[1.5px]">
          {activePhase}
          {activePhase === 'fly' && currentLeg !== null && totalLegs !== null && (
            <span className="text-[#6b7fa3] font-normal"> · leg {currentLeg}/{totalLegs}</span>
          )}
        </div>
      </Segment>

      <Segment label="Battery">
        {battery !== null ? (
          <BatteryReadout pct={battery} />
        ) : (
          <Pending />
        )}
      </Segment>
    </div>
  );
};

// ── Inner pieces ────────────────────────────────────────────────────────

const Segment: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div className="px-6 py-3 border-r border-[#1c2d4a] last:border-r-0 flex flex-col gap-1">
    <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</div>
    <div className="leading-none min-h-[14px]">{children}</div>
  </div>
);

const Pending: React.FC = () => (
  <span className="text-[11px] font-mono text-[#3a4f6b] tracking-[1px] uppercase">— Pending</span>
);

const BatteryReadout: React.FC<{ pct: number }> = ({ pct }) => {
  // Bands match the FlyPanel's BatteryDial. Mission planning carries 25%
  // headroom so the bottom band is "Margin critical", not "empty".
  const color = pct > 70 ? '#00d45a' : pct > 45 ? '#00ddb4' : pct > 22 ? '#ffaa00' : '#e03535';
  return (
    <div className="flex items-center gap-3">
      <div className="text-[11px] font-mono font-bold" style={{ color }}>
        {Math.round(pct)}%
      </div>
      <div className="flex-1 h-1 bg-[#1c2d4a] rounded-full overflow-hidden min-w-[60px] max-w-[120px]">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};
