'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Plane, Check } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

const STEPS = [
  { name: 'BUILD',   path: '/build'   },
  { name: 'MISSION', path: '/mission' },
  { name: 'RESULTS', path: '/results' },
];

export const NavBar: React.FC = () => {
  const pathname = usePathname();
  // Resolve current step by prefix match so dashboard sub-views still highlight correctly.
  const currentStepIndex = STEPS.findIndex(step => pathname === step.path || pathname.startsWith(step.path + '/'));
  const isHome = pathname === '/';

  if (isHome) return null;

  return (
    <nav className="fixed top-0 left-0 right-0 h-[52px] bg-[rgba(11,17,32,0.95)] backdrop-blur-[8px] border-b border-[#243650] flex items-center justify-between px-6 z-50">
      {/* Left: Branding */}
      <Link href="/" className="flex items-center gap-2 group">
        <Plane size={18} className="text-[#00a8ff] glow-blue" />
        <div className="font-mono font-bold text-[15px] tracking-[3px]">
          <span className="text-[#00a8ff] glow-blue">AERO</span>
          <span className="text-[#00ddb4]">-GRID</span>
        </div>
      </Link>

      {/* Center: Mission Progress */}
      <div className="hidden md:flex items-center">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentStepIndex;
          const isActive = idx === currentStepIndex;
          const isFuture = idx > currentStepIndex;
          
          return (
            <React.Fragment key={step.name}>
              <div className="flex flex-col items-center gap-1.5 min-w-[70px]">
                <div 
                  className={`w-[28px] h-[28px] rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 relative ${
                    isDone 
                      ? 'bg-[rgba(0,221,180,0.12)] border-[1.5px] border-[#00ddb4] text-[#00ddb4]' 
                      : isActive 
                        ? 'bg-[rgba(0,168,255,0.18)] border-[1.5px] border-[#00a8ff] text-[#00a8ff] shadow-[0_0_10px_rgba(0,168,255,0.35)]' 
                        : 'bg-transparent border-[1.5px] border-[#1c2d4a] text-[#6b7fa3]'
                  }`}
                >
                  {isDone ? <Check size={14} strokeWidth={3} /> : idx + 1}
                  {isActive && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-[1.5px] border-[#00a8ff]"
                      initial={{ scale: 1, opacity: 0.8 }}
                      animate={{ scale: 1.4, opacity: 0 }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </div>
                <span 
                  className={`text-[8px] tracking-[1.5px] font-bold transition-colors ${
                    isDone ? 'text-[#00ddb4]' : isActive ? 'text-[#00a8ff]' : 'text-[#6b7fa3]'
                  }`}
                >
                  {step.name}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`w-[24px] h-[1.5px] mb-[13px] ${isDone ? 'bg-[#00ddb4]' : 'bg-[#1c2d4a]'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: Project Info */}
      <div className="flex items-center gap-3">
        <div className="px-[10px] py-[4px] border border-[#243650] rounded-[4px] text-[10px] font-mono font-bold text-[#6b7fa3] tracking-[1px]">
          Aero-Grid
        </div>
      </div>
    </nav>
  );
};
