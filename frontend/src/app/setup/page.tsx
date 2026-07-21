'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RefreshCcw, Rocket } from 'lucide-react';

import { CityCanvas, type EditTool } from '@/components/CityCanvas';
import { ToolPalette, TOOLS } from '@/components/ToolPalette';
import { ValidationPanel, type ValidationResult } from '@/components/ValidationPanel';
import { fetchCityRandom, validateCity, type CityState, type Difficulty } from '@/lib/api';
import { useAeroGridStore } from '@/lib/store';

const MAX_TARGETS = 12;
const MIN_TARGETS = 3;
const GRID_AREA = 40 * 40;
const VALIDATION_DEBOUNCE_MS = 400;

// ── helpers ─────────────────────────────────────────────────────────────

const hasCell = (arr: number[][], x: number, y: number) =>
  arr.some(([cx, cy]) => cx === x && cy === y);

const withoutCell = (arr: number[][], x: number, y: number) =>
  arr.filter(([cx, cy]) => !(cx === x && cy === y));

const addCellUnique = (arr: number[][], x: number, y: number) =>
  hasCell(arr, x, y) ? arr : [...arr, [x, y]];

const computeBlocked = (city: CityState): number[] => {
  const set = new Set<string>();
  city.buildings.forEach(([x, y]) => set.add(`${x},${y}`));
  city.nfz.forEach(([x, y]) => set.add(`${x},${y}`));
  return city.targets
    .map(([x, y], i) => (set.has(`${x},${y}`) ? i : -1))
    .filter((i) => i >= 0);
};

// ── page ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const setCityDataStore = useAeroGridStore((s) => s.setCityData);
  const resetMissionState = useAeroGridStore((s) => s.resetMissionState);
  const addLog = useAeroGridStore((s) => s.addLog);

  const [city, setCity] = useState<CityState | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [seed, setSeed] = useState<number>(7);
  const [activeTool, setActiveTool] = useState<EditTool>('cursor');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [maxTargetsHit, setMaxTargetsHit] = useState(false);
  const maxFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── fetch random city on mount and on difficulty/seed change ─────────
  // Cancellation guard: React StrictMode (Next.js dev default) mounts the
  // component, runs the effect, simulates an unmount, then re-mounts and runs
  // the effect again. Two in-flight fetches both completing was producing
  // duplicate "Generated …" log entries with whatever network-variance gap
  // separated their responses (often seconds, not the dedup window's ms).
  //
  // The fix is the React-canonical async-effect pattern: a per-run flag set
  // true in cleanup. The first effect's fetch resolves into a closure whose
  // `cancelled` was flipped by cleanup, so it short-circuits before the
  // commit. Only the most-recent effect run touches state or emits a log.

  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    setValidation(null);

    (async () => {
      try {
        const data = (await fetchCityRandom(seed, difficulty)) as CityState;
        if (cancelled) return;
        setCity(data);
        addLog(`Generated ${difficulty} city (seed ${seed}): ${data.buildings.length} buildings, ${data.targets.length} targets`);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        addLog(`Error: Failed to generate ${difficulty} city`);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();

    return () => { cancelled = true; };
  }, [seed, difficulty, addLog]);

  // ── keyboard shortcuts ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t?.isContentEditable ?? false)) return;
      const map: Record<string, EditTool> = {
        v: 'cursor', b: 'building', n: 'nfz', t: 'target', d: 'depot', e: 'erase',
      };
      const tool = map[e.key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        setActiveTool(tool);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── debounced validation on every edit ───────────────────────────────

  useEffect(() => {
    if (!city || isFetching) return;
    const t = setTimeout(async () => {
      setIsValidating(true);
      try {
        const v = (await validateCity(city)) as ValidationResult;
        setValidation(v);
      } catch (err) {
        console.error(err);
        setValidation({
          valid: false,
          issues: ['Validation request failed — backend unreachable?'],
          unreachable_targets: [],
        });
      } finally {
        setIsValidating(false);
      }
    }, VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [city, isFetching]);

  // ── flash "max targets reached" on overcap clicks ────────────────────

  const flashMaxTargets = () => {
    setMaxTargetsHit(true);
    if (maxFlashTimerRef.current) clearTimeout(maxFlashTimerRef.current);
    maxFlashTimerRef.current = setTimeout(() => setMaxTargetsHit(false), 1400);
  };

  // ── cell-edit handler ────────────────────────────────────────────────

  const handleCellClick = useCallback(
    (x: number, y: number, button: 0 | 2) => {
      const tool: EditTool = button === 2 ? 'erase' : activeTool;
      setCity((prev) => {
        if (!prev) return prev;
        const isDepotCell = prev.depot[0] === x && prev.depot[1] === y;

        switch (tool) {
          case 'cursor':
            return prev;

          case 'building':
            return {
              ...prev,
              buildings: addCellUnique(prev.buildings, x, y),
              nfz: withoutCell(prev.nfz, x, y),
            };

          case 'nfz':
            return {
              ...prev,
              nfz: addCellUnique(prev.nfz, x, y),
              buildings: withoutCell(prev.buildings, x, y),
            };

          case 'target': {
            if (hasCell(prev.targets, x, y)) return prev;
            if (prev.targets.length >= MAX_TARGETS) {
              flashMaxTargets();
              return prev;
            }
            return { ...prev, targets: [...prev.targets, [x, y]] };
          }

          case 'depot':
            return { ...prev, depot: [x, y] };

          case 'erase': {
            const next = {
              ...prev,
              buildings: withoutCell(prev.buildings, x, y),
              nfz: withoutCell(prev.nfz, x, y),
              targets: withoutCell(prev.targets, x, y),
            };
            // The depot is anchored: it can be moved with the depot tool but never deleted.
            if (isDepotCell) return next;
            return next;
          }

          default:
            return prev;
        }
      });
    },
    [activeTool],
  );

  // ── derived state ────────────────────────────────────────────────────

  const blockedTargets = useMemo(() => (city ? computeBlocked(city) : []), [city]);
  const unreachableTargets = validation?.unreachable_targets ?? [];

  const stats = useMemo(() => {
    if (!city) return { buildings: 0, nfz: 0, targets: 0, nfzPct: 0 };
    return {
      buildings: city.buildings.length,
      nfz: city.nfz.length,
      targets: city.targets.length,
      nfzPct: (city.nfz.length / GRID_AREA) * 100,
    };
  }, [city]);

  const meetsTargetMinimum = stats.targets >= MIN_TARGETS;
  const canStart = !!city && !!validation && validation.valid && meetsTargetMinimum && !isValidating;

  // ── CTAs ─────────────────────────────────────────────────────────────

  const handleStartMission = () => {
    if (!city || !canStart) return;
    // Wipe prior mission results before locking in the new city. Without this,
    // a stale optimizeResult.route from a previous mission with a different
    // target count would be sent to /fly and rejected with "Route index N out
    // of range", and /mission would jump straight to the fly phase.
    resetMissionState();
    setCityDataStore(city);
    addLog(`Mission city locked in: ${stats.buildings} bld, ${stats.nfz} nfz, ${stats.targets} targets`);
    router.push('/mission');
  };

  const handleRandomize = () => {
    setSeed(Date.now() % 100000);
  };

  // ── render ───────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col h-[calc(100vh-52px)] bg-[#06090f] overflow-hidden"
    >
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#1c2d4a]">
        <div className="flex items-baseline gap-4">
          <h1 className="text-base font-mono font-bold text-white tracking-[3px] uppercase">
            Environment Builder
          </h1>
          <span className="text-[10px] font-mono text-[#3a4f6b] tracking-[1.5px]">
            Design the operational area before deployment
          </span>
        </div>

        <div className="flex items-center gap-3">
          <DifficultySelect value={difficulty} onChange={setDifficulty} disabled={isFetching} />
          <button
            type="button"
            onClick={handleRandomize}
            disabled={isFetching}
            className="flex items-center gap-2 px-3.5 py-2 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[1.5px] uppercase"
          >
            <RefreshCcw size={11} className={isFetching ? 'animate-spin' : ''} />
            Randomize
          </button>
        </div>
      </header>

      {/* ── Main: palette + canvas ─────────────────────────────────── */}
      <section className="flex flex-1 min-h-0">
        <ToolPalette active={activeTool} onSelect={setActiveTool} />

        <div className="flex-1 flex items-center justify-center px-10 py-8 relative">
          <AnimatePresence mode="wait">
            {isFetching && !city ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <CitySkeleton />
              </motion.div>
            ) : city ? (
              <motion.div
                key="canvas"
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <CityCanvas
                  buildings={city.buildings}
                  nfz={city.nfz}
                  targets={city.targets}
                  depot={city.depot}
                  editMode
                  activeTool={activeTool}
                  onCellClick={handleCellClick}
                  unreachableTargets={unreachableTargets}
                  blockedTargets={blockedTargets}
                  disabled={isFetching}
                  label="ENVIRONMENT BUILDER — 40×40"
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Right-side help column: only shown when we have a city */}
          {city && !isFetching && (
            <aside className="absolute top-1/2 -translate-y-1/2 right-10 w-[180px] flex flex-col gap-6 select-none">
              <ActiveToolHint tool={activeTool} />
              <ShortcutLegend />
            </aside>
          )}

          {/* Transient toast: max targets reached */}
          <AnimatePresence>
            {maxTargetsHit && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute top-6 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-[3px] border border-[#ffaa00] bg-[rgba(255,170,0,0.08)] text-[#ffaa00] text-[10px] font-mono font-bold uppercase tracking-[2px]"
                role="status"
              >
                Maximum {MAX_TARGETS} targets
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Bottom strip: stats + validation + CTA ─────────────────── */}
      <footer className="border-t border-[#1c2d4a] bg-[#0b1120]">
        <div className="grid grid-cols-[auto_1fr_auto] items-stretch gap-6 px-8 py-5">
          <StatsBadges
            buildings={stats.buildings}
            nfzPct={stats.nfzPct}
            targets={stats.targets}
            targetsValid={meetsTargetMinimum}
          />

          <ValidationPanel
            validation={meetsTargetMinimum ? validation : { valid: false, issues: [`Need at least ${MIN_TARGETS} targets (currently ${stats.targets}).`], unreachable_targets: [] }}
            isValidating={isValidating}
          />

          <StartMissionButton onClick={handleStartMission} enabled={canStart} />
        </div>
      </footer>
    </motion.div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

const DifficultySelect: React.FC<{
  value: Difficulty;
  onChange: (v: Difficulty) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Difficulty)}
      disabled={disabled}
      className="appearance-none bg-[#06090f] border border-[#1c2d4a] hover:border-[#3a4f6b] focus:border-[#00a8ff] focus:outline-none text-[#a0b4d0] text-[10px] font-mono font-bold uppercase tracking-[1.5px] py-2 pl-3 pr-8 rounded-[3px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
      aria-label="Difficulty"
    >
      <option value="easy">Easy · 10 bldgs</option>
      <option value="medium">Medium · 15 bldgs</option>
      <option value="hard">Hard · 22 bldgs</option>
    </select>
    <ChevronDown
      size={12}
      strokeWidth={2}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#6b7fa3]"
    />
  </div>
);

const StatsBadges: React.FC<{
  buildings: number;
  nfzPct: number;
  targets: number;
  targetsValid: boolean;
}> = ({ buildings, nfzPct, targets, targetsValid }) => (
  <div className="flex items-center gap-4">
    <Stat label="Targets" value={`${targets} / ${MAX_TARGETS}`} accent={targetsValid ? '#00ddb4' : '#ffaa00'} />
    <Stat label="No-Fly" value={`${nfzPct.toFixed(1)}%`} accent="#e03535" />
    <Stat label="Buildings" value={buildings.toString()} accent="#00a8ff" />
  </div>
);

const Stat: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div className="flex flex-col gap-1 min-w-[88px]">
    <span className="text-[8px] font-mono text-[#6b7fa3] tracking-[2px] uppercase">{label}</span>
    <span className="text-base font-mono font-bold leading-none" style={{ color: accent }}>
      {value}
    </span>
  </div>
);

const StartMissionButton: React.FC<{ onClick: () => void; enabled: boolean }> = ({ onClick, enabled }) => (
  <motion.button
    type="button"
    onClick={onClick}
    disabled={!enabled}
    whileTap={enabled ? { scale: 0.97 } : undefined}
    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    className={[
      'flex items-center gap-2.5 self-center px-6 py-3 rounded-[3px] border-[1.5px]',
      'text-[11px] font-mono font-bold tracking-[2px] uppercase transition-all duration-200',
      enabled
        ? 'bg-[rgba(0,168,255,0.10)] border-[#00a8ff] text-[#00a8ff] hover:bg-[rgba(0,168,255,0.22)] hover:shadow-[0_0_20px_rgba(0,168,255,0.30)]'
        : 'bg-transparent border-[#1c2d4a] text-[#3a4f6b] cursor-not-allowed',
    ].join(' ')}
  >
    <Rocket size={13} strokeWidth={2} />
    Start Mission
  </motion.button>
);

const ActiveToolHint: React.FC<{ tool: EditTool }> = ({ tool }) => {
  const meta = TOOLS.find((t) => t.id === tool);
  if (!meta) return null;
  const hints: Record<EditTool, string> = {
    cursor:       'Hover to inspect cells. Pick a tool from the left to start editing.',
    building:     'Click or drag to paint buildings. Right-click any cell to erase.',
    nfz:          'Paint no-fly cells where the drone cannot enter. Drag to fill regions.',
    target:       'Click empty cells to place delivery targets. Maximum 12, minimum 3.',
    depot:        'Click anywhere to relocate the depot. There is only one.',
    erase:        'Click or drag to clear cells. The depot is anchored and cannot be deleted.',
    // Not exposed on the /setup palette; only /learn uses this tool. Keeps
    // the Record<EditTool> exhaustive.
    perturbation: 'Click cells to place generalization-test perturbations.',
  };
  return (
    <div className="space-y-2">
      <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">Active tool</div>
      <div className="text-xs font-mono font-bold text-[#00a8ff] tracking-[2px] uppercase">{meta.label}</div>
      <p className="text-[11px] text-[#6b7fa3] leading-relaxed">{hints[tool]}</p>
    </div>
  );
};

const ShortcutLegend: React.FC = () => (
  <div className="space-y-2">
    <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[2px] uppercase">Shortcuts</div>
    <ul className="space-y-1.5">
      {TOOLS.map((t) => (
        <li key={t.id} className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-[#6b7fa3]">{t.label.toLowerCase()}</span>
          <kbd className="px-1.5 py-0.5 rounded-[2px] border border-[#243650] bg-[#06090f] text-[#a0b4d0] text-[9px]">
            {t.shortcut}
          </kbd>
        </li>
      ))}
      <li className="flex items-center justify-between text-[10px] font-mono pt-1 mt-1 border-t border-[#1c2d4a]">
        <span className="text-[#6b7fa3]">erase</span>
        <kbd className="px-1.5 py-0.5 rounded-[2px] border border-[#243650] bg-[#06090f] text-[#a0b4d0] text-[9px]">
          right-click
        </kbd>
      </li>
    </ul>
  </div>
);

// ── Skeleton ───────────────────────────────────────────────────────────

const CitySkeleton: React.FC = () => (
  <div
    className="relative overflow-hidden"
    style={{ width: 560, height: 560 }}
  >
    <div className="scanlines" />
    <div className="hud-corner hud-corner-tl" />
    <div className="hud-corner hud-corner-tr" />
    <div className="hud-corner hud-corner-bl" />
    <div className="hud-corner hud-corner-br" />
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 text-[9px] font-mono font-bold text-[#00ddb4] opacity-50 tracking-[3px] uppercase">
      Building environment...
    </div>
    <div
      className="absolute inset-0 bg-[#040810]"
      style={{
        backgroundImage:
          'linear-gradient(to right, #0d1625 1px, transparent 1px), linear-gradient(to bottom, #0d1625 1px, transparent 1px)',
        backgroundSize: '14px 14px',
      }}
    />
    <motion.div
      className="absolute inset-0"
      initial={{ x: '-100%' }}
      animate={{ x: '100%' }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, rgba(0,168,255,0.06) 45%, rgba(0,168,255,0.12) 50%, rgba(0,168,255,0.06) 55%, transparent 100%)',
      }}
    />
  </div>
);

