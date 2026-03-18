'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  unreachable_targets: number[];
}

interface ValidationPanelProps {
  validation: ValidationResult | null;
  isValidating: boolean;
  className?: string;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  validation,
  isValidating,
  className = '',
}) => {
  // Loading state takes priority — never show "ready" while a re-validation is in flight.
  if (isValidating || validation === null) {
    return (
      <Shell tone="muted" className={className}>
        <Loader2 size={14} className="text-[#6b7fa3] animate-spin shrink-0" />
        <Header>Validating environment</Header>
        <Body>Running A* reachability from depot to every target...</Body>
      </Shell>
    );
  }

  if (validation.valid) {
    return (
      <Shell tone="ok" className={className} role="status">
        <CheckCircle2 size={14} className="text-[#00d45a] shrink-0" />
        <Header tone="ok">City ready</Header>
        <Body>All targets are reachable. You can deploy the mission.</Body>
      </Shell>
    );
  }

  return (
    <Shell tone="warn" className={className} role="alert">
      <AlertTriangle size={14} className="text-[#ffaa00] shrink-0" />
      <Header tone="warn">
        {validation.issues.length} issue{validation.issues.length === 1 ? '' : 's'} to resolve
      </Header>
      <div className="col-span-2 mt-2 max-h-24 overflow-y-auto custom-scrollbar">
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {validation.issues.map((issue) => (
              <motion.li
                key={issue}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="text-[10px] text-[#a0b4d0] leading-relaxed flex items-baseline gap-2"
              >
                <span className="text-[#ffaa00] opacity-60 text-[9px]">›</span>
                <span>{issue}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </Shell>
  );
};

// ── internal building blocks ─────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'muted';

const TONE_BG: Record<Tone, string> = {
  ok:    'bg-[rgba(0,212,90,0.05)]  border-[rgba(0,212,90,0.35)]',
  warn:  'bg-[rgba(255,170,0,0.05)] border-[rgba(255,170,0,0.35)]',
  muted: 'bg-[#0b1120]              border-[#1c2d4a]',
};

const Shell: React.FC<
  React.PropsWithChildren<{ tone: Tone; className?: string; role?: string }>
> = ({ tone, className, role, children }) => (
  <div
    role={role}
    className={[
      'grid grid-cols-[14px_1fr] items-start gap-x-3 gap-y-1',
      'px-4 py-3 rounded-[4px] border',
      TONE_BG[tone],
      className ?? '',
    ].join(' ')}
  >
    {children}
  </div>
);

const Header: React.FC<React.PropsWithChildren<{ tone?: Tone }>> = ({ tone = 'muted', children }) => {
  const color = tone === 'ok' ? 'text-[#00d45a]' : tone === 'warn' ? 'text-[#ffaa00]' : 'text-[#a0b4d0]';
  return (
    <div className={`text-[10px] font-mono font-bold uppercase tracking-[2px] leading-[14px] ${color}`}>
      {children}
    </div>
  );
};

const Body: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="col-start-2 text-[10px] text-[#6b7fa3] leading-relaxed">{children}</div>
);
