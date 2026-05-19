'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1] as const;

// Unified fade across routes. Keyed by pathname so each page mounts under a
// fresh motion.div and AnimatePresence runs the exit + enter sequence in
// order ("mode='wait'"). Zustand state lives outside the React tree, so any
// data populated on one page is read on the next without re-fetching.
export const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
        exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE_OUT_QUART } }}
        className="h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
