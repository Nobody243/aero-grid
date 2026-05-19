'use client';

import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import type { WeatherCompareResult } from '@/lib/store';

export const MODEL_SHORT: Record<string, string> = {
  naive_bayes:         'Naive Bayes',
  logistic_regression: 'Logistic',
  decision_tree:       'Decision Tree',
};

interface AgreementChipsProps {
  compare: WeatherCompareResult;
}

export const AgreementChips: React.FC<AgreementChipsProps> = ({ compare }) => {
  const entries = Object.entries(compare.predictions);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([key, pred]) => {
        const agrees = pred.label === compare.majority_verdict;
        const Icon = agrees ? Check : AlertTriangle;
        const color = agrees ? '#00d45a' : '#ffaa00';
        return (
          <div
            key={key}
            className="flex items-center gap-1.5 px-2 py-1 rounded-[2px] border bg-[#06090f]"
            style={{ borderColor: agrees ? 'rgba(0,212,90,0.3)' : 'rgba(255,170,0,0.4)' }}
            title={`${MODEL_SHORT[key] ?? key} predicts "${pred.label}" (${(pred.probabilities[pred.label] * 100).toFixed(1)}%)`}
          >
            <Icon size={10} strokeWidth={2.5} style={{ color }} />
            <span className="text-[9px] font-mono font-bold tracking-[1.5px] uppercase text-[#a0b4d0]">
              {MODEL_SHORT[key] ?? key}
            </span>
          </div>
        );
      })}
    </div>
  );
};
