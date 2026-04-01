'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAeroGridStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';

export const DecisionLog: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const logs = useAeroGridStore((state) => state.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="fixed right-0 top-20 bottom-6 z-40 flex items-start pointer-events-none">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="pointer-events-auto bg-[#0b1120] border border-[#243650] border-r-0 p-2 rounded-l-md text-[#00a8ff] hover:bg-[#1c2d4a] transition-colors shadow-lg flex items-center justify-center min-h-[100px]"
      >
        {!isOpen ? (
          <div className="flex flex-col items-center gap-4">
            <ChevronLeft size={16} />
            <span className="font-mono text-[9px] font-bold tracking-[1.5px] uppercase [writing-mode:vertical-lr] rotate-180">
              Decision Log
            </span>
          </div>
        ) : (
          <ChevronRight size={16} />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="pointer-events-auto w-[260px] h-full bg-[rgba(4,8,16,0.95)] backdrop-blur-[8px] border-l border-y border-[#243650] shadow-2xl flex flex-col"
          >
            <div className="p-3 border-b border-[#243650] flex items-center justify-between bg-[rgba(11,17,32,0.3)]">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-[#00a8ff]" />
                <span className="font-mono text-[10px] font-bold text-white tracking-[1.5px] uppercase">
                  Log Console
                </span>
              </div>
              <span className="text-[8px] font-mono text-[#6b7fa3]">ENTRIES: {logs.length}</span>
            </div>

            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-3 font-mono text-[9px] space-y-3 custom-scrollbar"
            >
              {logs.length === 0 ? (
                <div className="text-[#3a4f6b] italic py-4 text-center">Awaiting mission data...</div>
              ) : (
                logs.map((log, idx) => {
                  const parts = log.split('] ');
                  const timestamp = parts[0].replace('[', '') + ']';
                  const message = parts.slice(1).join('] ');
                  
                  // Color coding & Pills
                  let pillColor = 'border-[#00a8ff] text-[#00a8ff] bg-[rgba(0,168,255,0.06)]';
                  let moduleTag = 'NB';
                  
                  if (message.includes('[NB]')) {
                    pillColor = 'border-[#a855f7] text-[#a855f7] bg-[rgba(168,85,247,0.06)]';
                    moduleTag = 'NB';
                  } else if (message.includes('[GA]')) {
                    pillColor = 'border-[#ffaa00] text-[#ffaa00] bg-[rgba(255,170,0,0.06)]';
                    moduleTag = 'GA';
                  } else if (message.includes('[A*]')) {
                    pillColor = 'border-[#00a8ff] text-[#00a8ff] bg-[rgba(0,168,255,0.06)]';
                    moduleTag = 'A*';
                  }
                  
                  const cleanMessage = message.replace(/\[(NB|GA|A\*)\]\s*/, '');

                  return (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex flex-col gap-1.5 border-b border-[#1c2d4a]/50 pb-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-1.5 py-0.5 rounded-[2px] border text-[8px] font-bold ${pillColor}`}>
                          {moduleTag}
                        </span>
                        <span className="text-[#3a4f6b] text-[8px]">{timestamp}</span>
                      </div>
                      <span className="text-[#a0b4d0] leading-relaxed">{cleanMessage}</span>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
