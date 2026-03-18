'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  MousePointer2,
  Building2,
  Octagon,
  Crosshair,
  Home,
  Eraser,
  type LucideIcon,
} from 'lucide-react';
import type { EditTool } from './CityCanvas';

interface ToolDef {
  id: EditTool;
  label: string;
  shortcut: string;
  Icon: LucideIcon;
}

export const TOOLS: ToolDef[] = [
  { id: 'cursor',   label: 'VIEW',     shortcut: 'V', Icon: MousePointer2 },
  { id: 'building', label: 'BUILDING', shortcut: 'B', Icon: Building2 },
  { id: 'nfz',      label: 'NO-FLY',   shortcut: 'N', Icon: Octagon },
  { id: 'target',   label: 'TARGET',   shortcut: 'T', Icon: Crosshair },
  { id: 'depot',    label: 'DEPOT',    shortcut: 'D', Icon: Home },
  { id: 'erase',    label: 'ERASE',    shortcut: 'E', Icon: Eraser },
];

interface ToolPaletteProps {
  active: EditTool;
  onSelect: (tool: EditTool) => void;
  className?: string;
}

export const ToolPalette: React.FC<ToolPaletteProps> = ({ active, onSelect, className = '' }) => {
  return (
    <div
      className={`flex flex-col gap-2 p-3 bg-[#0b1120] border-r border-[#1c2d4a] ${className}`}
      role="toolbar"
      aria-label="City editing tools"
    >
      <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase pb-1 text-center select-none">
        Tools
      </div>
      {TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          isActive={active === tool.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

interface ToolButtonProps {
  tool: ToolDef;
  isActive: boolean;
  onSelect: (tool: EditTool) => void;
}

const ToolButton: React.FC<ToolButtonProps> = ({ tool, isActive, onSelect }) => {
  const { id, label, shortcut, Icon } = tool;
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={() => onSelect(id)}
        aria-label={`${label} tool (shortcut ${shortcut})`}
        aria-pressed={isActive}
        animate={{ scale: isActive ? 1 : 0.985 }}
        whileTap={{ scale: 0.92 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={[
          'flex flex-col items-center justify-center gap-1 w-12 h-14 rounded-[3px]',
          'transition-colors duration-200 select-none',
          isActive
            ? 'bg-[rgba(0,168,255,0.10)] border border-[#00a8ff] shadow-[0_0_12px_rgba(0,168,255,0.35)]'
            : 'bg-[#06090f] border border-[#1c2d4a] hover:border-[#3a4f6b] hover:bg-[#0f1730]',
        ].join(' ')}
      >
        <Icon
          size={16}
          strokeWidth={1.75}
          className={isActive ? 'text-[#00a8ff]' : 'text-[#6b7fa3] group-hover:text-[#a0b4d0]'}
        />
        <span
          className={[
            'text-[8px] font-mono font-bold tracking-[1px] leading-none',
            isActive ? 'text-[#00a8ff]' : 'text-[#3a4f6b] group-hover:text-[#6b7fa3]',
          ].join(' ')}
        >
          {label}
        </span>
      </motion.button>

      {/* Tooltip */}
      <div
        className={[
          'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-30',
          'whitespace-nowrap rounded-[3px] border border-[#243650] bg-[#06090f] px-2 py-1',
          'text-[9px] font-mono text-[#a0b4d0] opacity-0 group-hover:opacity-100',
          'transition-opacity duration-150',
        ].join(' ')}
      >
        {label.toLowerCase()}{' '}
        <span className="text-[#3a4f6b]">·</span>{' '}
        <span className="text-[#00ddb4]">{shortcut}</span>
      </div>
    </div>
  );
};
