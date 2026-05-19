'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WeatherMetrics, ModelMetrics } from '@/lib/store';
import { MODEL_SHORT } from './AgreementChips';

const SHORT_CLASS: string[] = ['Safe', 'Alt Drop', 'Grounded'];

interface ConfusionMatrixProps {
  metrics: WeatherMetrics;
  defaultModel?: string;
}

export const ConfusionMatrix: React.FC<ConfusionMatrixProps> = ({ metrics, defaultModel = 'naive_bayes' }) => {
  const modelKeys = Object.keys(metrics.metrics);
  const [active, setActive] = useState<string>(defaultModel);
  const current: ModelMetrics | undefined = metrics.metrics[active];

  return (
    <div className="space-y-4">
      <Selector keys={modelKeys} active={active} onSelect={setActive} />

      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            <Grid matrix={current.confusion_matrix} />
            <PerClass perClass={current.per_class} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── Selector ────────────────────────────────────────────────────────────

const Selector: React.FC<{ keys: string[]; active: string; onSelect: (k: string) => void }> = ({
  keys, active, onSelect,
}) => (
  <div className="grid grid-cols-3 gap-1.5">
    {keys.map((k) => {
      const isActive = k === active;
      return (
        <button
          key={k}
          type="button"
          onClick={() => onSelect(k)}
          className={[
            'px-2 py-1.5 rounded-[3px] border text-[9px] font-mono font-bold tracking-[1.5px] uppercase transition-colors duration-150',
            isActive
              ? 'border-[#00a8ff] text-[#00a8ff] bg-[rgba(0,168,255,0.10)]'
              : 'border-[#1c2d4a] text-[#6b7fa3] hover:border-[#3a4f6b] hover:text-[#a0b4d0]',
          ].join(' ')}
        >
          {MODEL_SHORT[k] ?? k}
        </button>
      );
    })}
  </div>
);

// ── 3×3 Grid ────────────────────────────────────────────────────────────

const Grid: React.FC<{ matrix: number[][] }> = ({ matrix }) => {
  // Row totals — used to compute per-row percentages and per-row max for opacity scaling
  const rowSums = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const rowMaxes = matrix.map((r) => Math.max(1, ...r));

  return (
    <div className="grid grid-cols-[36px_repeat(3,1fr)] gap-1 items-center">
      {/* corner spacer */}
      <div />
      {/* col headers: predicted */}
      {SHORT_CLASS.map((label, i) => (
        <div key={`col-${i}`} className="text-[8px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase text-center">
          {label}
        </div>
      ))}
      {/* axis caption below col headers */}
      <div />
      <div className="col-span-3 text-[7px] font-mono text-[#3a4f6b] tracking-[2px] uppercase text-center pb-1 -mt-0.5">
        Predicted
      </div>

      {matrix.map((row, i) => (
        <React.Fragment key={`row-${i}`}>
          <div className="text-[8px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase text-right pr-1">
            {SHORT_CLASS[i]}
          </div>
          {row.map((count, j) => {
            const isDiag = i === j;
            const rowSum = rowSums[i];
            const rowMax = rowMaxes[i];
            const pctOfRow = rowSum > 0 ? count / rowSum : 0;
            const intensity = count > 0 ? Math.max(0.12, count / rowMax) : 0;
            const color = isDiag ? `rgba(0, 221, 180, ${0.10 + intensity * 0.55})` : `rgba(224, 53, 53, ${0.08 + intensity * 0.55})`;
            const textColor = count === 0 ? '#3a4f6b' : isDiag ? '#00ddb4' : '#e03535';
            return (
              <div
                key={`c-${i}-${j}`}
                className="aspect-square flex flex-col items-center justify-center rounded-[2px] border border-[#1c2d4a]"
                style={{ backgroundColor: color }}
                title={`Actual: ${SHORT_CLASS[i]} · Predicted: ${SHORT_CLASS[j]} · ${count} samples (${(pctOfRow * 100).toFixed(1)}%)`}
              >
                <span className="text-[11px] font-mono font-bold tabular-nums leading-none" style={{ color: textColor }}>
                  {count}
                </span>
                {count > 0 && (
                  <span className="text-[7px] font-mono text-[#6b7fa3] mt-0.5 leading-none tabular-nums">
                    {(pctOfRow * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}

      {/* axis caption: actual */}
      <div className="col-span-4 text-[7px] font-mono text-[#3a4f6b] tracking-[2px] uppercase text-center pt-1">
        Rows: Actual
      </div>
    </div>
  );
};

// ── Per-class precision/recall/F1 ──────────────────────────────────────

const PerClass: React.FC<{ perClass: ModelMetrics['per_class'] }> = ({ perClass }) => {
  const classes = Object.keys(perClass);
  return (
    <div className="border-t border-[#1c2d4a] pt-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-1.5 items-baseline">
        {/* header */}
        <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">Class</span>
        <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase text-right min-w-[42px]">Prec</span>
        <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase text-right min-w-[42px]">Recall</span>
        <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase text-right min-w-[42px]">F1</span>

        {classes.map((cls, i) => {
          const m = perClass[cls];
          return (
            <React.Fragment key={cls}>
              <span className="text-[10px] font-mono text-[#a0b4d0]">{SHORT_CLASS[i]}</span>
              <Stat value={m.precision} />
              <Stat value={m.recall} />
              <Stat value={m.f1} />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const Stat: React.FC<{ value: number }> = ({ value }) => (
  <span className="text-[10px] font-mono font-bold text-white tabular-nums text-right">
    {value.toFixed(3)}
  </span>
);
