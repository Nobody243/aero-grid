'use client';

import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';

interface LegSelectorProps {
  legs: { nodes_explored: number; path_length: number }[];
  selected: number;
  onSelect: (idx: number) => void;
  disabled?: boolean;
}

// Native <select> on purpose: it's a 9-item picker, accessibility and
// keyboard already perfect, and a custom dropdown would add nothing.
export const LegSelector: React.FC<LegSelectorProps> = ({
  legs,
  selected,
  onSelect,
  disabled = false,
}) => {
  const hardestIdx = useMemo(() => {
    if (legs.length === 0) return -1;
    return legs.reduce(
      (best, leg, i, arr) => (leg.nodes_explored > arr[best].nodes_explored ? i : best),
      0,
    );
  }, [legs]);

  return (
    <div className="relative inline-block">
      <select
        value={selected}
        onChange={(e) => onSelect(parseInt(e.target.value, 10))}
        disabled={disabled}
        aria-label="Select leg to train on"
        className="appearance-none bg-[#06090f] border border-[#1c2d4a] hover:border-[#3a4f6b] focus:border-[#00a8ff] focus:outline-none text-[#a0b4d0] text-[10px] font-mono font-bold uppercase tracking-[1.5px] py-2 pl-3 pr-9 rounded-[3px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 min-w-[280px]"
      >
        {legs.map((leg, i) => (
          <option key={i} value={i}>
            Leg {i + 1} · {leg.nodes_explored} nodes · {leg.path_length.toFixed(1)}u
            {i === hardestIdx ? '  ★ hardest' : ''}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={2}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#6b7fa3]"
      />
    </div>
  );
};
