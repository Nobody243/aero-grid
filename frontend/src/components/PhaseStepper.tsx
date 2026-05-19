'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CloudRain, GitBranch, Navigation, Check, LogOut, ChevronDown } from 'lucide-react';

export type Phase = 'weather' | 'optimize' | 'fly';
export type PhaseStatus = 'pending' | 'active' | 'complete';

interface PhaseStepperProps {
  activePhase: Phase;
  statuses: Record<Phase, PhaseStatus>;
  onSelect: (phase: Phase) => void;
  onEndMission: () => void;
}

const PHASES: { id: Phase; label: string; Icon: typeof CloudRain }[] = [
  { id: 'weather',  label: 'Weather',  Icon: CloudRain  },
  { id: 'optimize', label: 'Optimize', Icon: GitBranch  },
  { id: 'fly',      label: 'Fly',      Icon: Navigation },
];

export const PhaseStepper: React.FC<PhaseStepperProps> = ({
  activePhase,
  statuses,
  onSelect,
  onEndMission,
}) => {
  return (
    <div className="flex items-center justify-between px-8 py-4 border-b border-[#1c2d4a]">
      <ol className="flex items-center gap-3">
        {PHASES.map((p, i) => (
          <React.Fragment key={p.id}>
            <PhasePill
              phase={p.id}
              label={p.label}
              Icon={p.Icon}
              status={statuses[p.id]}
              onSelect={onSelect}
            />
            {i < PHASES.length - 1 && (
              <Connector
                done={statuses[PHASES[i].id] === 'complete'}
                next={statuses[PHASES[i + 1].id]}
              />
            )}
          </React.Fragment>
        ))}
      </ol>

      <button
        type="button"
        onClick={onEndMission}
        className="flex items-center gap-2 px-3.5 py-2 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] transition-colors duration-150 text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[1.5px] uppercase"
      >
        <LogOut size={11} />
        End Mission
        <ChevronDown size={11} className="text-[#6b7fa3]" />
      </button>
    </div>
  );
};

// ── PhasePill ───────────────────────────────────────────────────────────

interface PhasePillProps {
  phase: Phase;
  label: string;
  Icon: typeof CloudRain;
  status: PhaseStatus;
  onSelect: (phase: Phase) => void;
}

const PhasePill: React.FC<PhasePillProps> = ({ phase, label, Icon, status, onSelect }) => {
  const isActive = status === 'active';
  const isComplete = status === 'complete';
  const isClickable = isComplete; // revisit complete phases; pending+active aren't clickable

  const handleClick = () => {
    if (isClickable) onSelect(phase);
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={!isClickable}
        aria-current={isActive ? 'step' : undefined}
        className={[
          'relative flex items-center gap-2.5 px-4 py-2 rounded-[3px] border transition-colors duration-200',
          'text-[10px] font-mono font-bold tracking-[2px] uppercase select-none',
          isActive
            ? 'border-[#00a8ff] text-[#00a8ff]'
            : isComplete
              ? 'border-[#00ddb4] text-[#00ddb4] cursor-pointer hover:bg-[rgba(0,221,180,0.06)]'
              : 'border-[#1c2d4a] text-[#3a4f6b] cursor-not-allowed',
        ].join(' ')}
      >
        {/* Active highlight — animates between pills via shared layoutId */}
        {isActive && (
          <motion.div
            layoutId="phase-active-highlight"
            className="absolute inset-0 -z-10 rounded-[3px] bg-[rgba(0,168,255,0.10)] shadow-[0_0_12px_rgba(0,168,255,0.30)]"
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          />
        )}

        {isComplete ? (
          <Check size={12} strokeWidth={2.5} className="shrink-0" />
        ) : (
          <Icon size={12} strokeWidth={2} className="shrink-0" />
        )}
        <span>{label}</span>
      </button>
    </li>
  );
};

// ── Connector ───────────────────────────────────────────────────────────

const Connector: React.FC<{ done: boolean; next: PhaseStatus }> = ({ done, next }) => {
  const color = done ? '#00ddb4' : next === 'active' ? '#1c2d4a' : '#1c2d4a';
  return (
    <li aria-hidden className="flex-shrink-0">
      <div
        className="h-px w-12 transition-colors duration-300"
        style={{ backgroundColor: color }}
      />
    </li>
  );
};
