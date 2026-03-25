'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface FeatureImportanceProps {
  importance: { wind: number; visibility: number; rainfall: number };
}

const FEATURE_LABEL: Record<string, string> = {
  wind:       'Wind',
  visibility: 'Visibility',
  rainfall:   'Rainfall',
};

export const FeatureImportance: React.FC<FeatureImportanceProps> = ({ importance }) => {
  // Sort descending so the dominant feature reads first.
  const entries = (['wind', 'visibility', 'rainfall'] as const)
    .map((key) => ({ key, value: importance[key] }))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(0.001, ...entries.map((e) => e.value));

  return (
    <div className="space-y-2.5">
      {entries.map((e, i) => {
        const pct = (e.value / max) * 100;
        return (
          <div key={e.key} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">
                {FEATURE_LABEL[e.key]}
              </span>
              <span className="text-[10px] font-mono font-bold text-[#00ddb4] tabular-nums">
                {(e.value * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-[#06090f] rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{
                  delay: 0.08 * i,
                  duration: 0.55,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="h-full rounded-full bg-[#00ddb4]"
              />
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-[#6b7fa3] leading-relaxed pt-1">
        Decision Tree feature importances. Higher values mean the feature drove more of the splits.
      </p>
    </div>
  );
};
