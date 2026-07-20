'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { HeroText } from '@/components/landing/HeroText';

// 3D scene is client-only and heavy. We render an empty dark div while it
// loads; the text-column stagger reveal covers the perceived delay. EK choice:
// absence over decoration.
const CityScene3D = dynamic(() => import('@/components/landing/CityScene3D'), {
  ssr: false,
  loading: () => <SceneFallback />,
});

export default function HeroPage() {
  return (
    <div className="relative h-[calc(100vh-52px)] bg-[#06090f] overflow-hidden">
      <div className="h-full grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-h-[480px]"
          // Soft spotlight behind the canvas — pulls the scene forward without
          // adding a 3D postprocessing pass. Pure CSS, no perf cost.
          style={{
            background:
              'radial-gradient(ellipse 60% 70% at 30% 50%, rgba(20, 28, 46, 0.6) 0%, rgba(6, 9, 15, 1) 70%)',
          }}
        >
          <Suspense fallback={<SceneFallback />}>
            <CityScene3D />
          </Suspense>
        </motion.div>

        <div className="flex items-center justify-start px-10 lg:px-16">
          <HeroText />
        </div>
      </div>

      {/* One honest line at the bottom edge — no fake telemetry. */}
      <div className="absolute bottom-6 right-10 font-mono text-[9px] text-[#3a4f6b] tracking-[2.5px] uppercase pointer-events-none">
        Autonomous Drone Routing & Delivery
      </div>
    </div>
  );
}

// Dark placeholder during dynamic-import. No 2D flash, no shimmer.
const SceneFallback: React.FC = () => <div className="absolute inset-0 bg-[#06090f]" />;
