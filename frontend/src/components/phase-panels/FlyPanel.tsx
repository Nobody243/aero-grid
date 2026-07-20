'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { PanelShell, Section, ProceedButton } from './WeatherPanel';
import { Skeleton } from '@/components/ui/Skeleton';
import type { FlyResult, FlyHeuristic, FlyComparisonResults } from '@/lib/store';

interface FlyPanelProps {
  result: FlyResult | null;
  comparison: FlyComparisonResults | null;
  isFetching: boolean;
  currentLegIdx: number;
  currentStepIdx: number;
  battery: number;
  completedLegCount: number;
  totalTargets: number;
  activeHeuristic: FlyHeuristic;
  onActiveHeuristicChange: (h: FlyHeuristic) => void;
  readOnly?: boolean;
  hasFinished: boolean;
  onJumpToResults: () => void;
}

const HEURISTIC_ORDER: FlyHeuristic[] = ['octile', 'manhattan', 'euclidean'];

const HEURISTIC_LABEL: Record<FlyHeuristic, string> = {
  octile:    'Octile',
  manhattan: 'Manhattan',
  euclidean: 'Euclidean',
};

interface Totals {
  nodes: number;
  path:  number;
}

const sumLegs = (r: FlyResult): Totals => ({
  nodes: r.legs.reduce((a, l) => a + l.nodes_explored, 0),
  path:  r.legs.reduce((a, l) => a + l.path_length,   0),
});

export const FlyPanel: React.FC<FlyPanelProps> = ({
  result,
  comparison,
  isFetching,
  currentLegIdx,
  currentStepIdx, // eslint-disable-line @typescript-eslint/no-unused-vars
  battery,
  completedLegCount,
  totalTargets,
  activeHeuristic,
  onActiveHeuristicChange,
  readOnly = false,
  hasFinished,
  onJumpToResults,
}) => {
  const currentLeg = result?.legs[currentLegIdx];
  const totalLegs = result?.legs.length ?? 0;

  return (
    <PanelShell
      title="Flight Operations"
      subtitle="A* pathfinder navigates each leg around obstacles. Three heuristics compared in parallel."
      footer={
        hasFinished ? (
          <ProceedButton label="View results" enabled={!readOnly} tone="primary" onClick={onJumpToResults} />
        ) : (
          <div className="text-[10px] font-mono text-[#3a4f6b] tracking-[2px] uppercase text-center">
            Mission in progress
          </div>
        )
      }
    >
      <Section title="Heuristic comparison">
        {comparison ? (
          <HeuristicComparisonBlock
            comparison={comparison}
            activeHeuristic={activeHeuristic}
            onActiveHeuristicChange={onActiveHeuristicChange}
            readOnly={readOnly}
          />
        ) : (
          <HeuristicComparisonSkeleton />
        )}
      </Section>

      <Section title="Current leg">
        {isFetching || !result || !currentLeg ? (
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">
            <Loader2 size={11} className="animate-spin" />
            Computing path
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Leg"        value={`${Math.min(currentLegIdx + 1, totalLegs)}/${totalLegs}`} color="#00a8ff" />
            <Stat label="Nodes exp"  value={currentLeg.nodes_explored.toString()}                     color="#00ddb4" />
            <Stat label="Path len"   value={currentLeg.path_length.toFixed(1)}                        color="#a0b4d0" />
          </div>
        )}
      </Section>

      <Section title="Battery">
        <BatteryDial pct={battery} />
      </Section>

      <Section title="Deliveries">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-[10px] font-mono text-[#6b7fa3]">
            <span className="text-[#00ddb4] font-bold">{completedLegCount}</span>
            <span className="text-[#3a4f6b]"> / {totalTargets}</span>
          </span>
          <span className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">complete</span>
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: Math.min(totalTargets, 20) }).map((_, i) => {
            const isDone = i < completedLegCount;
            const isActive = i === currentLegIdx && !isDone;
            return (
              <div
                key={i}
                className={[
                  'aspect-square rounded-[3px] border flex items-center justify-center text-[10px] font-mono font-bold transition-colors duration-200',
                  isDone
                    ? 'bg-[rgba(0,221,180,0.10)] border-[#00ddb4] text-[#00ddb4]'
                    : isActive
                      ? 'bg-[rgba(0,168,255,0.10)] border-[#00a8ff] text-[#00a8ff]'
                      : 'bg-transparent border-[#1c2d4a] text-[#3a4f6b]',
                ].join(' ')}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Ops console">
        <div className="bg-[#06090f] border border-[#1c2d4a] rounded-[3px] p-3 h-32 overflow-y-auto custom-scrollbar font-mono text-[10px] space-y-2">
          {!result || completedLegCount === 0 ? (
            <div className="text-[#3a4f6b]">— Awaiting first leg completion...</div>
          ) : (
            result.legs.slice(0, completedLegCount).map((leg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-baseline gap-2"
              >
                <span className="px-1 py-0.5 rounded-[2px] border border-[#243650] text-[#00a8ff] text-[8px] font-bold">A*</span>
                <span className="text-[#a0b4d0]">
                  Leg {i + 1} <span className="text-[#3a4f6b]">·</span>{' '}
                  {leg.nodes_explored} nodes <span className="text-[#3a4f6b]">·</span>{' '}
                  {leg.path_length.toFixed(1)}u
                </span>
              </motion.div>
            ))
          )}
        </div>
      </Section>
    </PanelShell>
  );
};

// ── Skeleton for the heuristic comparison while 3 parallel fetches run ──
// 4 rows × (label col + 3 heuristic cols). Matches the live block's geometry
// so the layout doesn't jump when data arrives.

const HeuristicComparisonSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="grid grid-cols-[42px_1fr_1fr_1fr] gap-1.5">
      {/* header row */}
      <div />
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />

      {/* nodes row */}
      <span className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase self-center">Nodes</span>
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />

      {/* path row */}
      <span className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase self-center">Path</span>
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />
      <Skeleton className="h-[30px]" />

      {/* active row */}
      <span className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase self-center">Active</span>
      <Skeleton className="h-[28px]" />
      <Skeleton className="h-[28px]" />
      <Skeleton className="h-[28px]" />
    </div>
    <div className="flex items-center gap-2 text-[9px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">
      <Loader2 size={10} className="animate-spin" />
      Computing 3 heuristics in parallel
    </div>
  </div>
);

// ── Heuristic comparison block (the academic showcase) ──────────────────

interface HeuristicComparisonBlockProps {
  comparison: FlyComparisonResults;
  activeHeuristic: FlyHeuristic;
  onActiveHeuristicChange: (h: FlyHeuristic) => void;
  readOnly?: boolean;
}

const HeuristicComparisonBlock: React.FC<HeuristicComparisonBlockProps> = ({
  comparison,
  activeHeuristic,
  onActiveHeuristicChange,
  readOnly = false,
}) => {
  const totals = useMemo(() => {
    return HEURISTIC_ORDER.reduce<Record<FlyHeuristic, Totals>>((acc, h) => {
      acc[h] = sumLegs(comparison[h]);
      return acc;
    }, {} as Record<FlyHeuristic, Totals>);
  }, [comparison]);

  const caption = useMemo(() => buildCaption(totals), [totals]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[42px_1fr_1fr_1fr] gap-1.5">
        {/* row 0: header row of heuristic names */}
        <div />
        {HEURISTIC_ORDER.map((h) => (
          <button
            key={`hdr-${h}`}
            type="button"
            onClick={() => !readOnly && onActiveHeuristicChange(h)}
            disabled={readOnly}
            aria-pressed={h === activeHeuristic}
            className={[
              'px-2 py-1.5 rounded-[3px] border text-[10px] font-mono font-bold tracking-[1.5px] uppercase transition-colors duration-150',
              h === activeHeuristic
                ? 'border-[#00a8ff] text-[#00a8ff] bg-[rgba(0,168,255,0.10)]'
                : 'border-[#1c2d4a] text-[#6b7fa3] hover:border-[#3a4f6b] hover:text-[#a0b4d0]',
            ].join(' ')}
          >
            {HEURISTIC_LABEL[h]}
          </button>
        ))}

        {/* nodes row */}
        <RowLabel>Nodes</RowLabel>
        {HEURISTIC_ORDER.map((h) => (
          <DataCell
            key={`nodes-${h}`}
            value={totals[h].nodes.toString()}
            isActive={h === activeHeuristic}
            color="#00ddb4"
          />
        ))}

        {/* path row */}
        <RowLabel>Path</RowLabel>
        {HEURISTIC_ORDER.map((h) => (
          <DataCell
            key={`path-${h}`}
            value={totals[h].path.toFixed(1)}
            isActive={h === activeHeuristic}
            color="#a0b4d0"
          />
        ))}

        {/* active row */}
        <RowLabel>Active</RowLabel>
        {HEURISTIC_ORDER.map((h) => (
          <ActiveDot key={`act-${h}`} isActive={h === activeHeuristic} />
        ))}
      </div>

      <p className="text-[10px] text-[#6b7fa3] leading-relaxed">{caption}</p>
    </div>
  );
};

const RowLabel: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase self-center pr-1">
    {children}
  </span>
);

const DataCell: React.FC<{ value: string; isActive: boolean; color: string }> = ({ value, isActive, color }) => (
  <div
    className={[
      'px-2 py-1.5 rounded-[3px] border text-[10px] font-mono font-bold tabular-nums text-center transition-colors duration-150',
      isActive
        ? 'border-[#00a8ff] bg-[rgba(0,168,255,0.06)]'
        : 'border-[#1c2d4a] bg-[#06090f]',
    ].join(' ')}
    style={{ color }}
  >
    {value}
  </div>
);

const ActiveDot: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <div className={[
    'flex items-center justify-center py-1.5 rounded-[3px] border transition-colors duration-150',
    isActive ? 'border-[#00a8ff] bg-[rgba(0,168,255,0.06)]' : 'border-[#1c2d4a]',
  ].join(' ')}>
    <span
      className="w-2 h-2 rounded-full transition-colors duration-150"
      style={{ background: isActive ? '#00a8ff' : 'transparent', boxShadow: isActive ? '0 0 6px rgba(0,168,255,0.7)' : 'none', border: isActive ? 'none' : '1px solid #3a4f6b' }}
    />
  </div>
);

// Caption generator — describes the comparison empirically based on the actual numbers.
const buildCaption = (totals: Record<FlyHeuristic, Totals>): string => {
  const entries = HEURISTIC_ORDER.map((h) => ({ h, ...totals[h] }));
  const minNodes = Math.min(...entries.map((e) => e.nodes));
  const maxNodes = Math.max(...entries.map((e) => e.nodes));
  const ratio = minNodes > 0 ? maxNodes / minNodes : Infinity;
  const worst = entries.find((e) => e.nodes === maxNodes)!.h;
  const best  = entries.find((e) => e.nodes === minNodes)!.h;
  const allSamePath = entries.every((e) => Math.abs(e.path - entries[0].path) < 0.01);

  if (allSamePath && ratio > 1.1) {
    return `Same path lengths confirm admissibility; ${HEURISTIC_LABEL[worst]} explores ${ratio.toFixed(1)}× more nodes than ${HEURISTIC_LABEL[best]} for the same optimal solution.`;
  }
  if (allSamePath) {
    return `All three heuristics find the same optimal path and explore comparable numbers of nodes on this grid.`;
  }
  return `Path lengths differ slightly across heuristics — see how heuristic choice affects optimality on this grid topology.`;
};

// ── Building blocks (shared from prior version) ────────────────────────

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="space-y-1">
    <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</div>
    <div className="text-base font-mono font-bold leading-none tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);

// Battery is modelled with 25% planning headroom. Bands describe budget margin,
// not a doom timer — a healthy mission ends in the "Margin low" band, not "Critical".
const batteryBand = (pct: number): { color: string; label: string } => {
  if (pct > 70) return { color: '#00d45a', label: 'Within budget' };
  if (pct > 45) return { color: '#00ddb4', label: 'Margin acceptable' };
  if (pct > 22) return { color: '#ffaa00', label: 'Margin low' };
  return { color: '#e03535', label: 'Margin critical' };
};

const BatteryDial: React.FC<{ pct: number }> = ({ pct }) => {
  const { color, label } = batteryBand(pct);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#1c2d4a" strokeWidth="3" />
          <motion.circle
            cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 22}
            initial={false}
            animate={{ strokeDashoffset: 2 * Math.PI * 22 * (1 - pct / 100) }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            transform="rotate(-90 28 28)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold tabular-nums" style={{ color }}>
          {Math.round(pct)}%
        </div>
      </div>
      <div className="flex-1 space-y-1">
        <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">Power budget</div>
        <div className="text-[11px] font-mono font-bold" style={{ color }}>{label}</div>
      </div>
    </div>
  );
};
