'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { RefreshCw, ChevronRight, Download, Map as MapIcon, Brain, X } from 'lucide-react';
import { CityCanvas } from '@/components/CityCanvas';
import {
  useAeroGridStore,
  type CityData,
  type FlyResult,
} from '@/lib/store';
import { useCountUp } from '@/hooks/useCountUp';

const EASE = [0.22, 1, 0.36, 1] as const;

// One orchestrator for the whole bento. Children that declare matching
// "hidden" / "visible" variants ride this stagger without each one needing
// its own delay prop, which made the old version brittle when cards moved.
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

export default function ResultsPage() {
  const router = useRouter();
  const cityData = useAeroGridStore((s) => s.cityData);
  const weatherResult = useAeroGridStore((s) => s.weatherResult);
  const weatherCompareResult = useAeroGridStore((s) => s.weatherCompareResult);
  const weatherMetrics = useAeroGridStore((s) => s.weatherMetrics);
  const missionSnapshot = useAeroGridStore((s) => s.missionSnapshot);
  const optimizeResult = useAeroGridStore((s) => s.optimizeResult);
  const flyResult = useAeroGridStore((s) => s.flyResult);
  const flyComparisonResults = useAeroGridStore((s) => s.flyComparisonResults);
  const activeHeuristic = useAeroGridStore((s) => s.activeHeuristic);
  const gaParams = useAeroGridStore((s) => s.gaParams);
  const logs = useAeroGridStore((s) => s.logs);
  const resetMissionState = useAeroGridStore((s) => s.resetMissionState);

  const [mapOpen, setMapOpen] = useState(false);
  // Set when the user is intentionally leaving /results (Restart Mission,
  // Return Home, Open RL Lab). Without this, the !flyResult guard below
  // races with intentional navigation and pushes the user to / first.
  const navigatingRef = useRef(false);

  useEffect(() => {
    if (navigatingRef.current) return;
    if (!flyResult) router.push('/');
  }, [flyResult, router]);

  // Esc closes the map; only registered while the modal is open so we
  // don't capture keys for an unmounted dialog.
  useEffect(() => {
    if (!mapOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMapOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapOpen]);

  const totals = useMemo(() => {
    if (!flyResult) return { nodes: 0, path: 0 };
    return {
      nodes: flyResult.legs.reduce((acc, l) => acc + l.nodes_explored, 0),
      path:  flyResult.legs.reduce((acc, l) => acc + l.path_length, 0),
    };
  }, [flyResult]);

  if (!flyResult || !optimizeResult || !weatherResult || !cityData) return null;

  const verdictLabel =
    missionSnapshot?.weatherVerdict
    ?? weatherCompareResult?.majority_verdict
    ?? weatherResult.label;
  const verdictConfidence =
    missionSnapshot?.weatherConfidence
    ?? weatherCompareResult?.predictions?.naive_bayes?.probabilities?.[weatherCompareResult.majority_verdict]
    ?? weatherResult.probabilities[weatherResult.label];
  const confidencePct = (verdictConfidence * 100).toFixed(0);

  const naiveDist = optimizeResult.naive_distance;
  const gaDist    = optimizeResult.best_distance;
  const gaPctOfNaive = (gaDist / naiveDist) * 100;
  const improvementPct = optimizeResult.improvement_pct;
  const gensRun = optimizeResult.history.length > 0
    ? optimizeResult.history[optimizeResult.history.length - 1].generation
    : 0;

  // Same headroom model as /mission. See FlyPanel's batteryBand.
  const finalBatteryPct = Math.max(0, 100 - 100 * 0.75);

  const handleExport = () => {
    const payload = {
      mission: {
        completedAt: new Date().toISOString(),
        launchedAt:  missionSnapshot ? new Date(missionSnapshot.launchedAt).toISOString() : null,
      },
      city: cityData,
      weather: {
        snapshot: missionSnapshot,
        metrics:  weatherMetrics,
      },
      optimization: {
        params: gaParams,
        result: optimizeResult,
      },
      flight: {
        activeHeuristic,
        comparison: flyComparisonResults,
        legs:       flyResult.legs,
      },
      decisionLog: logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aero-grid-mission-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-52px)] bg-[#06090f] flex flex-col items-center px-8 py-12 overflow-y-auto custom-scrollbar">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="text-center mb-12"
      >
        <h1 className="text-4xl md:text-5xl font-mono font-bold tracking-[8px] text-[#00d45a] mb-3 glow-green">
          MISSION COMPLETE
        </h1>
        <div className="text-[11px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">
          {cityData.targets.length} deliveries · {gensRun} generations · {flyResult.legs.length} flight legs
        </div>
      </motion.div>

      {/* ── Bento body ───────────────────────────────────────────────── */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full max-w-6xl space-y-4"
      >
        {/* Row 2 — top-level mission outcomes (4 × span-3) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard label="Mission status" value="SUCCESS" color="#00d45a" />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard
              label="Weather verdict"
              value={verdictLabel.toUpperCase()}
              color={verdictColor(verdictLabel)}
              caption="at mission launch"
            />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard
              label="Deliveries"
              value={`${cityData.targets.length} / ${cityData.targets.length}`}
              color="#00ddb4"
            />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard label="GA improvement" value={improvementPct} unit="%" color="#ffaa00" isNumeric />
          </motion.div>
        </div>

        {/* Row 3 — hero pairing: convergence + comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <motion.div variants={itemVariants} className="lg:col-span-8">
            <ConvergenceChart
              history={optimizeResult.history}
              gaDist={gaDist}
              naiveDist={naiveDist}
              improvementPct={improvementPct}
              gensRun={gensRun}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-4">
            <NaiveVsGaPanel
              naiveDist={naiveDist}
              gaDist={gaDist}
              gaPctOfNaive={gaPctOfNaive}
              improvementPct={improvementPct}
            />
          </motion.div>
        </div>

        {/* Row 4 — algorithm-detail metrics (4 × span-3) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard label="Flight distance" value={totals.path} unit=" units" color="#00a8ff" isNumeric />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard label="Nodes explored" value={totals.nodes} color="#a855f7" isNumeric />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard label="NB confidence" value={confidencePct} unit="%" color="#00a8ff" isNumeric />
          </motion.div>
          <motion.div variants={itemVariants} className="lg:col-span-3">
            <ResultCard
              label="Battery remaining"
              value={finalBatteryPct}
              unit="%"
              color="#00d45a"
              isNumeric
              caption="of planning budget"
            />
          </motion.div>
        </div>

        {/* Row 5 — decision log (full width) */}
        <motion.div variants={itemVariants}>
          <DecisionLogBlock logs={logs} />
        </motion.div>
      </motion.div>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="mt-12 flex flex-col items-center gap-3 z-20">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <button
            type="button"
            onClick={() => { navigatingRef.current = true; resetMissionState(); router.push('/mission'); }}
            className="flex items-center gap-2.5 px-6 py-3 rounded-[3px] border-[1.5px] border-[#00ddb4] bg-[rgba(0,221,180,0.10)] text-[#00ddb4] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:bg-[rgba(0,221,180,0.22)] hover:shadow-[0_0_20px_rgba(0,221,180,0.30)] transition-all duration-200"
          >
            <RefreshCw size={13} />
            Restart Mission
          </button>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="flex items-center gap-2.5 px-6 py-3 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] font-mono font-bold tracking-[2px] uppercase text-[11px] text-[#a0b4d0] transition-all duration-200"
          >
            <MapIcon size={13} />
            View City Map
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2.5 px-6 py-3 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] font-mono font-bold tracking-[2px] uppercase text-[11px] text-[#a0b4d0] transition-all duration-200"
          >
            <Download size={13} />
            Export Report
          </button>
          <button
            type="button"
            onClick={() => { navigatingRef.current = true; resetMissionState(); router.push('/'); }}
            className="flex items-center gap-2 px-6 py-3 text-[#6b7fa3] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:text-white transition-colors duration-200"
          >
            Return Home
            <ChevronRight size={13} />
          </button>
        </div>
        <p className="text-[10px] font-mono text-[#3a4f6b] tracking-[1px] leading-relaxed text-center max-w-[44ch]">
          Download a full mission summary for your records.
        </p>
      </div>

      {/* ── RL Lab CTA — Day 4 entry point ──────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.45, ease: EASE }}
        className="w-full max-w-6xl mt-10 mb-4"
      >
        <button
          type="button"
          onClick={() => { navigatingRef.current = true; router.push('/learn'); }}
          className="group w-full text-left bg-[#0b1120] border border-[#1c2d4a] hover:border-[#00a8ff] rounded-[4px] p-6 transition-colors duration-200 hover:bg-[#0e162a] hover:shadow-[0_0_24px_rgba(0,168,255,0.18)]"
        >
          <div className="grid grid-cols-[auto_1fr_auto] gap-5 items-center">
            <div className="w-11 h-11 rounded-[3px] border border-[#1c2d4a] group-hover:border-[#00a8ff] flex items-center justify-center text-[#6b7fa3] group-hover:text-[#00a8ff] transition-colors duration-200">
              <Brain size={20} strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase mb-1.5">
                Compare with Reinforcement Learning
              </div>
              <p className="text-[11px] font-mono text-[#6b7fa3] leading-relaxed max-w-[68ch]">
                Watch a Q-Learning agent learn one leg of your mission through trial and error, then see how it generalizes when the city changes. The academic comparison: classical search vs. learned policy.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[#6b7fa3] group-hover:text-[#00a8ff] font-mono font-bold tracking-[2px] uppercase text-[10px] transition-colors duration-200">
              Open RL Lab
              <ChevronRight size={13} className="transition-transform duration-200 group-hover:translate-x-1" />
            </div>
          </div>
        </button>
      </motion.div>

      {/* ── Modal: final map ────────────────────────────────────────── */}
      <CityMapModal
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        cityData={cityData}
        flyResult={flyResult}
      />
    </div>
  );
}

// ── Stat card (no own motion; parent stagger drives the reveal) ─────────

const ResultCard: React.FC<{
  label: string;
  value: string | number;
  unit?: string;
  color: string;
  isNumeric?: boolean;
  caption?: string;
}> = ({ label, value, unit = '', color, isNumeric = false, caption }) => {
  const numericVal = typeof value === 'number' ? value : parseFloat(value.toString()) || 0;
  const animatedValue = useCountUp(numericVal, 1500);
  return (
    <div className="bg-[#0b1120] border border-[#1c2d4a] rounded-[4px] p-5 h-full">
      <div className="text-[8px] font-mono font-bold text-[#6b7fa3] tracking-[2px] uppercase mb-3">
        {label}
      </div>
      <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color }}>
        {isNumeric ? Math.floor(animatedValue) : value}
        {unit && <span className="text-sm ml-1 opacity-50">{unit}</span>}
      </div>
      {caption && (
        <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[1.5px] uppercase mt-2">{caption}</div>
      )}
    </div>
  );
};

// ── Convergence chart ────────────────────────────────────────────────────

const ConvergenceChart: React.FC<{
  history: { generation: number; best_distance: number }[];
  gaDist: number;
  naiveDist: number;
  improvementPct: number;
  gensRun: number;
}> = ({ history, gaDist, naiveDist, improvementPct, gensRun }) => (
  <section className="h-full bg-[#0b1120] border border-[#1c2d4a] rounded-[4px] p-6 flex flex-col min-h-[420px]">
    <div className="mb-4">
      <h3 className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase mb-1.5">
        GA Convergence
      </h3>
      <p className="text-[10px] text-[#6b7fa3] leading-relaxed">
        Best distance per generation across {gensRun} generations, converged to {gaDist.toFixed(1)} units ({improvementPct.toFixed(1)}% improvement over naive ordering).
      </p>
    </div>
    <div className="flex-1 min-h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="2 2" vertical={false} />
          <XAxis
            dataKey="generation"
            stroke="#3a4f6b"
            tick={{ fontSize: 9, fill: '#6b7fa3', fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={{ stroke: '#1c2d4a' }}
            label={{ value: 'GENERATION', position: 'insideBottom', offset: -2, fontSize: 8, fill: '#3a4f6b', fontFamily: 'JetBrains Mono', letterSpacing: 2 }}
          />
          <YAxis
            // Explicit domain keeps the dashed naive reference visible at the top
            // and lets the GA line drop to the bottom — the whole point of the chart.
            domain={[Math.floor(gaDist * 0.95), Math.ceil(naiveDist * 1.05)]}
            stroke="#3a4f6b"
            tick={{ fontSize: 9, fill: '#6b7fa3', fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={{ stroke: '#1c2d4a' }}
            width={42}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#06090f',
              border: '1px solid #1c2d4a',
              borderRadius: '3px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
              padding: '6px 10px',
            }}
            labelStyle={{ color: '#6b7fa3', fontSize: '9px', letterSpacing: '1px' }}
            itemStyle={{ color: '#00ddb4' }}
            labelFormatter={(v) => `GEN ${v}`}
            formatter={(v: number) => [v.toFixed(2), 'BEST DIST']}
          />
          <ReferenceLine
            y={naiveDist}
            stroke="#e03535"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{
              value: `NAIVE ${naiveDist.toFixed(1)}`,
              position: 'insideTopRight',
              fontSize: 8,
              fill: 'rgba(224,53,53,0.7)',
              fontFamily: 'JetBrains Mono',
              letterSpacing: 1,
            }}
          />
          <Line
            type="monotone"
            dataKey="best_distance"
            stroke="#00ddb4"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>
);

// ── Naive vs GA comparison ───────────────────────────────────────────────

const NaiveVsGaPanel: React.FC<{
  naiveDist: number;
  gaDist: number;
  gaPctOfNaive: number;
  improvementPct: number;
}> = ({ naiveDist, gaDist, gaPctOfNaive, improvementPct }) => (
  <section className="h-full bg-[#0b1120] border border-[#1c2d4a] rounded-[4px] p-6 flex flex-col min-h-[420px]">
    <h3 className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase mb-1.5">
      Route Comparison
    </h3>
    <p className="text-[10px] text-[#6b7fa3] leading-relaxed mb-6">
      Genetic Algorithm reduced total flight distance by {improvementPct.toFixed(1)}% over naive sequential ordering.
    </p>

    <div className="flex-1 space-y-5">
      <ComparisonRow
        label="Naive route"
        valueText={`${naiveDist.toFixed(1)}`}
        unit="units"
        widthPct={100}
        barColor="rgba(224, 53, 53, 0.55)"
        textColor="#e03535"
      />
      <ComparisonRow
        label="Optimized route"
        valueText={`${gaDist.toFixed(1)}`}
        unit="units"
        widthPct={gaPctOfNaive}
        barColor="#00ddb4"
        textColor="#00ddb4"
        callout={`−${improvementPct.toFixed(1)}%`}
        calloutColor="#00d45a"
      />
    </div>
  </section>
);

const ComparisonRow: React.FC<{
  label: string;
  valueText: string;
  unit: string;
  widthPct: number;
  barColor: string;
  textColor: string;
  callout?: string;
  calloutColor?: string;
}> = ({ label, valueText, unit, widthPct, barColor, textColor, callout, calloutColor }) => (
  <div>
    <div className="flex items-baseline justify-between mb-2">
      <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-mono font-bold tabular-nums" style={{ color: textColor }}>
          {valueText}
          <span className="text-xs opacity-50 ml-1">{unit}</span>
        </span>
        {callout && (
          <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: calloutColor }}>
            {callout}
          </span>
        )}
      </div>
    </div>
    <div className="h-2 w-full bg-[#06090f] rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${widthPct}%` }}
        transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
        className="h-full rounded-full"
        style={{ backgroundColor: barColor }}
      />
    </div>
  </div>
);

// ── Decision log block ──────────────────────────────────────────────────

const DecisionLogBlock: React.FC<{ logs: string[] }> = ({ logs }) => (
  <div>
    <div className="flex items-baseline justify-between mb-4">
      <h3 className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase">
        Mission decision log
      </h3>
      <span className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">
        {logs.length} entries
      </span>
    </div>
    <div className="bg-[#0b1120] border border-[#1c2d4a] rounded-[4px] p-6 max-h-72 overflow-y-auto custom-scrollbar">
      {logs.length === 0 ? (
        <div className="text-[#3a4f6b] text-[11px] font-mono italic text-center py-8">
          No decisions logged
        </div>
      ) : (
        <ul className="space-y-3">
          {logs.map((entry, i) => {
            const parts = entry.split('] ');
            const timestamp = parts[0].replace('[', '');
            const message = parts.slice(1).join('] ');
            const tagMatch = message.match(/^\[(NB|GA|A\*)\]\s*/);
            const tag = tagMatch?.[1] ?? null;
            const cleanMsg = tag ? message.replace(/^\[[^\]]+\]\s*/, '') : message;
            const tagColor =
              tag === 'NB' ? '#a855f7' :
              tag === 'GA' ? '#ffaa00' :
              tag === 'A*' ? '#00a8ff' :
              '#6b7fa3';

            return (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.04, duration: 0.25, ease: EASE }}
                className="grid grid-cols-[42px_60px_1fr] items-baseline gap-3 text-[11px] font-mono"
              >
                {tag ? (
                  <span
                    className="px-1.5 py-0.5 rounded-[2px] border text-[8px] font-bold tracking-[1px] text-center"
                    style={{ color: tagColor, borderColor: tagColor }}
                  >
                    {tag}
                  </span>
                ) : (
                  <span className="text-[8px] text-[#3a4f6b]">—</span>
                )}
                <span className="text-[#3a4f6b] text-[9px] tabular-nums">{timestamp}</span>
                <span className="text-[#a0b4d0] leading-relaxed">{cleanMsg}</span>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  </div>
);

// ── City map modal (hand-rolled — shadcn not installed) ─────────────────

const CityMapModal: React.FC<{
  open: boolean;
  onClose: () => void;
  cityData: CityData;
  flyResult: FlyResult;
}> = ({ open, onClose, cityData, flyResult }) => {
  const completedPaths = useMemo(() => flyResult.legs.map((l) => l.path), [flyResult]);
  const lastLeg = flyResult.legs[flyResult.legs.length - 1];
  const dronePos = lastLeg?.path[lastLeg.path.length - 1];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9000] bg-[#06090f]/85 flex items-center justify-center p-6"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Final mission map"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="relative bg-[#0b1120] border border-[#1c2d4a] rounded-[4px] p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close map"
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-[3px] border border-[#1c2d4a] text-[#6b7fa3] hover:text-white hover:border-[#3a4f6b] hover:bg-[#0f1730] transition-colors duration-150"
            >
              <X size={13} />
            </button>

            <div className="mb-5 pr-10">
              <h3 className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase">
                Final mission map
              </h3>
              <p className="text-[10px] text-[#6b7fa3] mt-1 leading-relaxed">
                {flyResult.legs.length} flight legs, {cityData.targets.length} deliveries completed. Click outside or press Esc to close.
              </p>
            </div>

            <CityCanvas
              buildings={cityData.buildings}
              nfz={cityData.nfz}
              targets={cityData.targets}
              depot={cityData.depot}
              completedPaths={completedPaths}
              dronePos={dronePos}
              // highlightTarget set past the end so every target renders as
              // "completed" (faded) and none pulse as active — a static frame.
              highlightTarget={cityData.targets.length}
              label="MISSION MAP — FINAL STATE"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ── helpers ──────────────────────────────────────────────────────────────

const verdictColor = (label: string): string => {
  if (label.includes('Safe')) return '#00d45a';
  if (label.includes('Drop')) return '#ffaa00';
  return '#e03535';
};
