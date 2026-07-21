'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCcw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { PanelShell, Section, ProceedButton } from './WeatherPanel';
import { Skeleton } from '@/components/ui/Skeleton';
import type { OptimizeResult, GAParams } from '@/lib/store';

interface OptimizePanelProps {
  result: OptimizeResult | null;
  isRunning: boolean;
  frame: number;                     // current animation frame index into history[]
  params: GAParams;
  onParamsChange: (next: Partial<GAParams>) => void;
  onReRun: () => void;
  onProceed: () => void;
  canProceed: boolean;
  readOnly?: boolean;
}

export const OptimizePanel: React.FC<OptimizePanelProps> = ({
  result,
  isRunning,
  frame,
  params,
  onParamsChange,
  onReRun,
  onProceed,
  canProceed,
  readOnly = false,
}) => {
  const currentFrame = result ? result.history[Math.min(frame, result.history.length - 1)] : null;

  return (
    <PanelShell
      title="Route Optimization"
      subtitle="Genetic Algorithm searches the target permutation space for the shortest delivery tour."
      footer={
        <ProceedButton
          label="Start Flight"
          enabled={canProceed && !readOnly}
          tone="primary"
          onClick={onProceed}
        />
      }
    >
      <Section title="Convergence">
        {result ? (
          <>
            <StatsRow
              currentFrame={currentFrame}
              improvement={result.improvement_pct}
            />
            <div className="h-32 mt-3 bg-[#06090f] border border-[#1c2d4a] rounded-[3px] p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.history.slice(0, Math.max(2, frame + 1))}>
                  <XAxis dataKey="generation" hide />
                  <YAxis domain={['auto', 'auto']} hide />
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
                    labelFormatter={(v) => `GEN ${v}`}
                    formatter={(v: number) => [v.toFixed(2), 'BEST']}
                  />
                  <Area
                    type="monotone"
                    dataKey="best_distance"
                    stroke="#00ddb4"
                    strokeWidth={1.5}
                    fill="rgba(0,221,180,0.10)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <ConvergenceSkeleton isRunning={isRunning} />
        )}
      </Section>

      <Section title="Current best route">
        {currentFrame ? (
          <div className="flex flex-wrap gap-1.5">
            {currentFrame.route.map((targetIdx, i) => (
              <motion.div
                key={`${i}-${targetIdx}`}
                layout
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="w-7 h-7 rounded-[3px] flex items-center justify-center bg-[#06090f] border border-[#243650] text-[11px] font-mono font-bold text-[#00a8ff]"
              >
                {targetIdx + 1}
              </motion.div>
            ))}
          </div>
        ) : isRunning ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="w-7 h-7" />
            ))}
          </div>
        ) : (
          <div className="text-[10px] font-mono text-[#3a4f6b] tracking-[1.5px] uppercase">— waiting for run</div>
        )}
      </Section>

      <Section title="GA parameters">
        <div className="space-y-4">
          <ParamSlider
            label="Mutation rate"
            value={params.mutation_rate}
            min={0.01}
            max={0.2}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            disabled={readOnly || isRunning}
            onChange={(v) => onParamsChange({ mutation_rate: v })}
          />
          <ParamSlider
            label="Population"
            value={params.population_size}
            min={50}
            max={200}
            step={10}
            format={(v) => `${v}`}
            disabled={readOnly || isRunning}
            onChange={(v) => onParamsChange({ population_size: Math.round(v) })}
          />

          {/* Real GA configuration. "Patience" was a hardcoded fake (the GA has
              no early-termination param) and has been removed for honesty. */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <Readonly label="Selection" value="Tournament" />
            <Readonly label="Crossover" value="Order (OX)" />
            <Readonly label="Elitism" value="Top 2" />
          </div>

          <button
            type="button"
            onClick={onReRun}
            disabled={readOnly || isRunning}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[1.5px] uppercase"
          >
            <RefreshCcw size={11} className={isRunning ? 'animate-spin' : ''} />
            {isRunning ? 'Running...' : 'Re-run GA'}
          </button>
        </div>
      </Section>
    </PanelShell>
  );
};

// ── Stats row ───────────────────────────────────────────────────────────

const StatsRow: React.FC<{
  currentFrame: { generation: number; best_distance: number } | null;
  improvement: number | null;
}> = ({ currentFrame, improvement }) => (
  <div className="grid grid-cols-3 gap-4">
    <Stat label="Generation"   value={currentFrame ? currentFrame.generation.toString() : '—'} color="#00a8ff" />
    <Stat label="Best dist"    value={currentFrame ? currentFrame.best_distance.toFixed(1) : '—'} color="#00ddb4" />
    <Stat label="vs Naive"     value={improvement !== null ? `−${improvement.toFixed(1)}%` : '—'} color="#00d45a" />
  </div>
);

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="space-y-1">
    <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</div>
    <div className="text-base font-mono font-bold leading-none tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);

const Readonly: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-0.5">
    <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[1.5px] uppercase">{label}</div>
    <div className="text-[10px] font-mono font-bold text-[#a0b4d0]">{value}</div>
  </div>
);

// ── Param slider ────────────────────────────────────────────────────────

const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, format, disabled, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between">
      <div className="text-[9px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">{label}</div>
      <div className="text-[12px] font-mono font-bold text-white tabular-nums">{format(value)}</div>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-[#1c2d4a] rounded-lg appearance-none cursor-pointer accent-[#00a8ff] disabled:cursor-not-allowed disabled:opacity-50"
    />
  </div>
);

// ── Skeleton for the convergence section while the GA runs ──────────────
// Stats row → 3 tabular rectangles. Chart → one tall rectangle. Shimmer
// reassures the user data is on the way without the visual noise of a spinner.

const ConvergenceSkeleton: React.FC<{ isRunning: boolean }> = ({ isRunning }) => (
  <>
    <div className="grid grid-cols-3 gap-4">
      {(['Generation', 'Best dist', 'vs Naive'] as const).map((label) => (
        <div key={label} className="space-y-1">
          <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
    <div className="h-32 mt-3 bg-[#06090f] border border-[#1c2d4a] rounded-[3px] p-2">
      <Skeleton className="h-full w-full" rounded="rounded-[2px]" />
    </div>
    {!isRunning && (
      <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase mt-2">
        — waiting for run
      </div>
    )}
  </>
);
