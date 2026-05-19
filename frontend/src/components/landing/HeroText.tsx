'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const EASE = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

const ALGORITHMS = ['Naive Bayes', 'Genetic Algorithm', 'A* Search'] as const;

export const HeroText: React.FC = () => (
  <motion.div
    variants={container}
    initial="hidden"
    animate="visible"
    className="flex flex-col items-start max-w-[460px] gap-8"
  >
    {/* Hairline sweep — one quiet flourish above the wordmark. */}
    <motion.div
      initial={{ scaleX: 0, opacity: 0 }}
      animate={{ scaleX: 1, opacity: 1 }}
      transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
      className="h-px w-20 origin-left bg-[#00ddb4]"
      aria-hidden
    />

    {/* Eyebrow */}
    <motion.div
      variants={item}
      className="text-[10px] font-mono text-[#3a4f6b] tracking-[3px] uppercase"
    >
      Mission Control <span className="text-[#1c2d4a]">·</span> Autonomous Operations
    </motion.div>

    {/* Wordmark — the one place loudness is allowed. Single solid color;
        the cyan accent is reserved for the CTA + hairline sweep. */}
    <motion.h1
      variants={item}
      className="font-mono font-bold text-[#f3f6fa] leading-[0.92] tracking-[-0.04em]"
      style={{ fontSize: 'clamp(2.75rem, 6.5vw, 4.5rem)' }}
    >
      AERO-GRID
    </motion.h1>

    {/* Tagline */}
    <motion.div
      variants={item}
      className="text-[15px] font-mono text-[#a0b4d0] tracking-wide -mt-3"
    >
      Drone routing engine
    </motion.div>

    {/* Paragraph — single bound, max ~60ch */}
    <motion.p
      variants={item}
      className="text-[13px] font-mono text-[#6b7fa3] leading-[1.7] max-w-[44ch]"
    >
      Three classifiers vote, a genetic algorithm finds the order, A* plots each leg.
      Watch the whole pipeline run on a city you build.
    </motion.p>

    {/* CTA */}
    <motion.div variants={item}>
      <Link
        href="/build"
        className="group inline-flex items-center gap-3 px-6 py-3.5 rounded-[3px] border border-[#00a8ff] text-[#00a8ff] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:border-[#5acaff] hover:text-[#5acaff] transition-colors duration-200"
      >
        Initialize Mission
        <ArrowRight size={14} strokeWidth={2} className="transition-transform duration-200 group-hover:translate-x-1" />
      </Link>
    </motion.div>

    {/* Algorithm chips — no icons, just tiny diamond + name */}
    <motion.div variants={item} className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2">
      {ALGORITHMS.map((name) => (
        <span
          key={name}
          className="flex items-center gap-2 text-[9px] font-mono text-[#3a4f6b] tracking-[2.5px] uppercase"
        >
          <span className="text-[#243650]" aria-hidden>&#9670;</span>
          {name}
        </span>
      ))}
    </motion.div>
  </motion.div>
);
