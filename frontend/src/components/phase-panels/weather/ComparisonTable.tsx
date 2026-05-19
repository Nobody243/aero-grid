'use client';

import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import type { WeatherCompareResult, WeatherMetrics } from '@/lib/store';
import { MODEL_SHORT } from './AgreementChips';

const MODEL_TOOLTIPS: Record<string, string> = {
  naive_bayes:
    'Gaussian Naive Bayes — assumes the three features are conditionally independent given the class. Fast, interpretable, often the baseline.',
  logistic_regression:
    'Multinomial logistic regression with StandardScaler — learns linear decision boundaries in scaled feature space.',
  decision_tree:
    'Decision Tree (max depth 6) — recursive axis-aligned splits. Highly interpretable; can overfit small datasets.',
};

const ABBREV_LABEL = (label: string) => {
  if (label === 'Safe to Fly') return 'Safe to Fly';
  if (label === 'Requires Altitude Drop') return 'Alt Drop';
  return 'Grounded';
};

const VERDICT_COLOR = (label: string) => {
  if (label === 'Safe to Fly') return '#00d45a';
  if (label === 'Requires Altitude Drop') return '#ffaa00';
  return '#e03535';
};

interface ComparisonTableProps {
  compare: WeatherCompareResult;
  metrics: WeatherMetrics | null;
}

export const ComparisonTable: React.FC<ComparisonTableProps> = ({ compare, metrics }) => {
  const rows = Object.entries(compare.predictions);
  return (
    <div className="space-y-1">
      <Header />
      <ul className="space-y-px">
        {rows.map(([key, pred]) => {
          const agrees = pred.label === compare.majority_verdict;
          const confidence = pred.probabilities[pred.label] ?? 0;
          const testAcc = metrics?.metrics[key]?.accuracy ?? pred.accuracy;
          return (
            <li
              key={key}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2 py-2 rounded-[2px] transition-colors duration-150"
              style={{
                background: agrees ? 'transparent' : 'rgba(255,170,0,0.05)',
              }}
              title={MODEL_TOOLTIPS[key]}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {agrees ? (
                  <Check size={10} strokeWidth={2.5} className="text-[#00d45a] shrink-0" />
                ) : (
                  <AlertTriangle size={10} strokeWidth={2.5} className="text-[#ffaa00] shrink-0" />
                )}
                <span className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[1px] uppercase truncate">
                  {MODEL_SHORT[key] ?? key}
                </span>
              </div>

              <span
                className="text-[10px] font-mono font-bold tracking-[1px] tabular-nums whitespace-nowrap"
                style={{ color: VERDICT_COLOR(pred.label) }}
              >
                {ABBREV_LABEL(pred.label)}
              </span>

              <span className="text-[10px] font-mono font-bold text-white tabular-nums whitespace-nowrap min-w-[44px] text-right">
                {(confidence * 100).toFixed(1)}%
              </span>

              <span
                className="text-[9px] font-mono font-bold tabular-nums whitespace-nowrap min-w-[44px] text-right px-1.5 py-0.5 rounded-[2px] border border-[#243650] bg-[#06090f] text-[#00ddb4]"
                title={`Test-set accuracy on ${metrics?.metrics[key]?.test_size ?? '?'} held-out samples`}
              >
                {(testAcc * 100).toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const Header = () => (
  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2 pb-1 border-b border-[#1c2d4a]">
    <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">Model</span>
    <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">Verdict</span>
    <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase min-w-[44px] text-right">Conf</span>
    <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase min-w-[44px] text-right">Test</span>
  </div>
);
