import React from 'react';
import { Monitor } from 'lucide-react';

// Pure-CSS gate: Tailwind's `lg` breakpoint is 1024px, so `lg:hidden` keeps
// this element rendered below that width and removes it above. The browser
// re-evaluates media queries on resize automatically, so no JS state or
// resize listener is needed, which also avoids any SSR/CSR flash.
//
// pointer-events-auto on the root ensures clicks are intercepted; the parent
// `<main>` underneath stays unclickable while the gate is up.
export const MobileGate: React.FC = () => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Desktop required"
    className="lg:hidden fixed inset-0 z-[9999] bg-[#06090f] pointer-events-auto flex flex-col items-center justify-center px-8 text-center"
  >
    <div className="flex items-center justify-center w-14 h-14 rounded-[3px] border border-[#1c2d4a] mb-10">
      <Monitor size={22} strokeWidth={1.5} className="text-[#6b7fa3]" />
    </div>

    <div className="text-[10px] font-mono text-[#3a4f6b] tracking-[5px] uppercase mb-6">
      <span className="text-[#00a8ff]">AERO</span><span className="text-[#00ddb4]">-GRID</span>
    </div>

    <h2 className="text-lg font-mono font-bold text-white tracking-[0.5px] leading-tight mb-4 max-w-[26ch]">
      Designed for desktop.
    </h2>

    <p className="text-[12px] font-mono text-[#6b7fa3] leading-relaxed max-w-[40ch]">
      Please open Aero-Grid on a screen at least 1024 pixels wide.
    </p>

    <p className="mt-10 text-[9px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">
      Current viewport too narrow
    </p>
  </div>
);
