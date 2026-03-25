'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wind, Eye, Droplets, ArrowRight, CheckCircle2, AlertTriangle, XCircle, Loader2,
} from 'lucide-react';
import type {
  WeatherCompareResult,
  WeatherMetrics,
  WeatherTrainingPoint,
} from '@/lib/store';

import { AgreementChips, MODEL_SHORT } from './weather/AgreementChips';
import { ComparisonTable } from './weather/ComparisonTable';
import { ConfusionMatrix } from './weather/ConfusionMatrix';
import { TrainingScatter } from './weather/TrainingScatter';
import { FeatureImportance } from './weather/FeatureImportance';

export interface WeatherConditions {
  wind: number;
  visibility: number;
  rainfall: number;
}

interface WeatherPanelProps {
  conditions: WeatherConditions;
  onConditionsChange: (next: WeatherConditions) => void;
  compare: WeatherCompareResult | null;
  metrics: WeatherMetrics | null;
  trainingData: WeatherTrainingPoint[] | null;
  isFetching: boolean;
  onProceed: () => void;
  canProceed: boolean;
  readOnly?: boolean;
}

const PRESETS: Array<{ name: string; conditions: WeatherConditions }> = [
  { name: 'Clear Day', conditions: { wind: 8,  visibility: 9,   rainfall: 0.2  } },
  { name: 'Foggy',     conditions: { wind: 15, visibility: 1.5, rainfall: 2    } },
  { name: 'High Wind', conditions: { wind: 55, visibility: 6,   rainfall: 1    } },
  { name: 'Storm',     conditions: { wind: 65, visibility: 0.8, rainfall: 18   } },
];

type Tab = 'comparison' | 'matrix' | 'data';

export const WeatherPanel: React.FC<WeatherPanelProps> = ({
  conditions,
  onConditionsChange,
  compare,
  metrics,
  trainingData,
  isFetching,
  onProceed,
  canProceed,
  readOnly = false,
}) => {
  const [tab, setTab] = useState<Tab>('comparison');

  const majority = compare?.majority_verdict ?? null;
  const isGrounded = majority === 'Grounded';
  const disagreeGrounded = isGrounded && compare && !compare.agreement;

  const ctaLabel = !compare
    ? 'Proceed to Optimization'
    : disagreeGrounded
      ? 'Manual review — Mission aborted'
      : isGrounded
        ? 'Mission Aborted'
        : 'Proceed to Optimization';

  return (
    <PanelShell
      title="Weather Assessment"
      subtitle="Three classifiers vote on whether the city is safe to fly."
      footer={
        <ProceedButton
          label={ctaLabel}
          enabled={canProceed && !readOnly && !isGrounded}
          tone={isGrounded ? 'danger' : 'primary'}
          onClick={onProceed}
        />
      }
    >
      <Section title="Conditions">
        <div className="space-y-5">
          <Slider label="Wind speed" Icon={Wind}    value={conditions.wind}       max={80} step={1}   unit="km/h" disabled={readOnly}
                  onChange={(v) => onConditionsChange({ ...conditions, wind: v })} />
          <Slider label="Visibility" Icon={Eye}     value={conditions.visibility} max={10} step={0.1} unit="km"   disabled={readOnly}
                  onChange={(v) => onConditionsChange({ ...conditions, visibility: v })} />
          <Slider label="Rainfall"   Icon={Droplets} value={conditions.rainfall}  max={25} step={0.1} unit="mm/h" disabled={readOnly}
                  onChange={(v) => onConditionsChange({ ...conditions, rainfall: v })} />
        </div>
      </Section>

      <Section title="Presets">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onConditionsChange(p.conditions)}
              disabled={readOnly}
              className="px-3 py-2 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[1.5px] uppercase text-left"
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Verdict">
        <Verdict compare={compare} isFetching={isFetching} />
      </Section>

      <Section title="Model analysis">
        <Tabs active={tab} onChange={setTab} />
        <div className="mt-4 min-h-[200px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {tab === 'comparison' && (
                compare
                  ? <ComparisonTable compare={compare} metrics={metrics} />
                  : <Placeholder text="Awaiting model predictions..." />
              )}
              {tab === 'matrix' && (
                metrics
                  ? <ConfusionMatrix metrics={metrics} />
                  : <Placeholder text="Loading test-set metrics..." />
              )}
              {tab === 'data' && (
                <div className="space-y-6">
                  {trainingData ? (
                    <TrainingScatter data={trainingData} currentInput={{ wind: conditions.wind, visibility: conditions.visibility }} />
                  ) : (
                    <Placeholder text="Loading training sample..." />
                  )}
                  {compare ? (
                    <FeatureImportance importance={compare.feature_importance} />
                  ) : (
                    <Placeholder text="Awaiting feature importance..." />
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Section>
    </PanelShell>
  );
};

// ── Verdict ─────────────────────────────────────────────────────────────

const Verdict: React.FC<{ compare: WeatherCompareResult | null; isFetching: boolean }> = ({
  compare,
  isFetching,
}) => {
  if (isFetching && !compare) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[#6b7fa3] font-mono">
        <Loader2 size={12} className="animate-spin" />
        <span>Classifying...</span>
      </div>
    );
  }
  if (!compare) {
    return <Placeholder text="No verdict yet." />;
  }

  const tone = tonalize(compare.majority_verdict);
  const Icon = tone.Icon;

  // Confidence = average of the probability-for-majority-label across models that voted with the majority.
  const agreers = Object.values(compare.predictions).filter(p => p.label === compare.majority_verdict);
  const avgConf = agreers.length
    ? agreers.reduce((acc, p) => acc + (p.probabilities[p.label] ?? 0), 0) / agreers.length
    : 0;

  const majorityModelKey = Object.entries(compare.predictions).find(([, p]) => p.label === compare.majority_verdict)?.[0] ?? 'naive_bayes';
  const majorityProbs = compare.predictions[majorityModelKey]?.probabilities ?? compare.predictions.naive_bayes.probabilities;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Icon size={18} style={{ color: tone.color }} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-mono font-bold uppercase tracking-[2px]" style={{ color: tone.color }}>
            {compare.majority_verdict}
          </div>
          <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase mt-0.5">
            Majority confidence {(avgConf * 100).toFixed(1)}% <span className="text-[#3a4f6b]">·</span> {agreers.length}/{Object.keys(compare.predictions).length} models
          </div>
        </div>
      </div>

      <AgreementChips compare={compare} />

      {!compare.agreement && (
        <div
          role="alert"
          className="px-3 py-2 rounded-[3px] border bg-[rgba(255,170,0,0.05)] border-[rgba(255,170,0,0.35)] flex items-start gap-2"
        >
          <AlertTriangle size={11} className="text-[#ffaa00] mt-px shrink-0" />
          <div className="text-[10px] text-[#a0b4d0] leading-relaxed">
            <span className="text-[#ffaa00] font-bold">Models disagree.</span>{' '}
            Verdict reflects the majority vote and falls back to the most-severe label on a tie.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {Object.entries(majorityProbs).map(([key, val]) => {
          const t = tonalize(key);
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex justify-between text-[9px] font-mono uppercase tracking-[1px]">
                <span className="text-[#6b7fa3]">{key}</span>
                <span style={{ color: t.color }}>{(val * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1 w-full bg-[#1c2d4a] rounded-full overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: `${val * 100}%` }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                  style={{ backgroundColor: t.color }}
                />
              </div>
            </div>
          );
        })}
        <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[1.5px] uppercase pt-1">
          Probability bars · {MODEL_SHORT[majorityModelKey] ?? majorityModelKey}
        </div>
      </div>
    </div>
  );
};

const tonalize = (label: string): { color: string; Icon: typeof CheckCircle2 } => {
  if (label === 'Safe to Fly') return { color: '#00d45a', Icon: CheckCircle2 };
  if (label === 'Requires Altitude Drop') return { color: '#ffaa00', Icon: AlertTriangle };
  return { color: '#e03535', Icon: XCircle };
};

// ── Tabs ────────────────────────────────────────────────────────────────

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'comparison', label: 'Comparison' },
  { id: 'matrix',     label: 'Matrix' },
  { id: 'data',       label: 'Data' },
];

const Tabs: React.FC<{ active: Tab; onChange: (t: Tab) => void }> = ({ active, onChange }) => (
  <div role="tablist" className="flex gap-0 border-b border-[#1c2d4a]">
    {TABS.map((t) => {
      const isActive = t.id === active;
      return (
        <button
          key={t.id}
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(t.id)}
          className={[
            'relative px-3 py-2 text-[10px] font-mono font-bold tracking-[1.5px] uppercase transition-colors duration-150',
            isActive ? 'text-[#00a8ff]' : 'text-[#6b7fa3] hover:text-[#a0b4d0]',
          ].join(' ')}
        >
          {t.label}
          {isActive && (
            <motion.div
              layoutId="weather-tab-underline"
              className="absolute left-2 right-2 -bottom-px h-[2px] bg-[#00a8ff]"
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
        </button>
      );
    })}
  </div>
);

// ── Placeholder ─────────────────────────────────────────────────────────

const Placeholder: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-2 text-[10px] text-[#6b7fa3] font-mono">
    <Loader2 size={11} className="animate-spin" />
    <span>{text}</span>
  </div>
);

// ── Shared exports (kept for OptimizePanel and FlyPanel) ────────────────

export const PanelShell: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, children, footer }) => (
  <aside className="w-full h-full flex flex-col border-l border-[#1c2d4a] bg-[#0b1120] overflow-hidden">
    <header className="px-6 py-4 border-b border-[#1c2d4a]">
      <h2 className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase">{title}</h2>
      <p className="text-[10px] text-[#6b7fa3] mt-1 leading-relaxed">{subtitle}</p>
    </header>
    <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 space-y-7">{children}</div>
    {footer && <div className="px-6 py-4 border-t border-[#1c2d4a]">{footer}</div>}
  </aside>
);

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="text-[8px] font-mono font-bold text-[#6b7fa3] tracking-[2px] uppercase">{title}</h3>
    {children}
  </section>
);

export const ProceedButton: React.FC<{
  label: string;
  enabled: boolean;
  tone: 'primary' | 'danger';
  onClick: () => void;
}> = ({ label, enabled, tone, onClick }) => {
  const palette =
    tone === 'danger'
      ? {
          on:  'bg-[rgba(224,53,53,0.10)] border-[#e03535] text-[#e03535] cursor-not-allowed',
          off: 'bg-transparent border-[#1c2d4a] text-[#3a4f6b] cursor-not-allowed',
        }
      : {
          on:  'bg-[rgba(0,168,255,0.10)] border-[#00a8ff] text-[#00a8ff] hover:bg-[rgba(0,168,255,0.22)] hover:shadow-[0_0_20px_rgba(0,168,255,0.30)]',
          off: 'bg-transparent border-[#1c2d4a] text-[#3a4f6b] cursor-not-allowed',
        };

  return (
    <motion.button
      type="button"
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      whileTap={enabled ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={[
        'w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[3px] border-[1.5px]',
        'text-[11px] font-mono font-bold tracking-[2px] uppercase transition-all duration-200',
        enabled ? palette.on : palette.off,
      ].join(' ')}
    >
      {label}
      {enabled && tone === 'primary' && <ArrowRight size={13} strokeWidth={2} />}
    </motion.button>
  );
};

// ── Slider ──────────────────────────────────────────────────────────────

const Slider: React.FC<{
  label: string;
  Icon: typeof Wind;
  value: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ label, Icon, value, max, step, unit, disabled, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between">
      <div className="flex items-center gap-2 text-[9px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">
        <Icon size={11} strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-mono font-bold text-white tabular-nums">{value}</span>
        <span className="text-[8px] font-mono text-[#3a4f6b] uppercase tracking-[1px]">{unit}</span>
      </div>
    </div>
    <input
      type="range"
      min={0}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-[#1c2d4a] rounded-lg appearance-none cursor-pointer accent-[#00a8ff] disabled:cursor-not-allowed disabled:opacity-50"
    />
  </div>
);
