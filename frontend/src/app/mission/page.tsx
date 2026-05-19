'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

import { CityCanvas } from '@/components/CityCanvas';
import { PhaseStepper, type Phase, type PhaseStatus } from '@/components/PhaseStepper';
import { MissionStatusStrip } from '@/components/MissionStatusStrip';
import { Scrubber } from '@/components/ui/Scrubber';
import { WeatherPanel, type WeatherConditions } from '@/components/phase-panels/WeatherPanel';
import { OptimizePanel } from '@/components/phase-panels/OptimizePanel';
import { FlyPanel } from '@/components/phase-panels/FlyPanel';

import { useAeroGridStore } from '@/lib/store';
import {
  postWeatherCompare,
  fetchWeatherMetrics,
  fetchWeatherTrainingData,
  fetchOptimization,
  fetchFlight,
  type FlyHeuristic,
} from '@/lib/api';

const WEATHER_DEBOUNCE_MS = 200;
const GA_FRAME_MS = 60;
const FLY_TICK_MS = 100;
const TRAIL_LENGTH = 24;

export default function MissionPage() {
  const router = useRouter();

  // ── store ────────────────────────────────────────────────────────────
  const cityData = useAeroGridStore((s) => s.cityData);
  const weatherResult = useAeroGridStore((s) => s.weatherResult);
  const weatherCompareResult = useAeroGridStore((s) => s.weatherCompareResult);
  const weatherMetrics = useAeroGridStore((s) => s.weatherMetrics);
  const weatherTrainingData = useAeroGridStore((s) => s.weatherTrainingData);
  const optimizeResult = useAeroGridStore((s) => s.optimizeResult);
  const flyResult = useAeroGridStore((s) => s.flyResult);
  const flyComparisonResults = useAeroGridStore((s) => s.flyComparisonResults);
  const activeHeuristic = useAeroGridStore((s) => s.activeHeuristic);
  const gaParams = useAeroGridStore((s) => s.gaParams);
  const setWeatherResult = useAeroGridStore((s) => s.setWeatherResult);
  const setWeatherCompareResult = useAeroGridStore((s) => s.setWeatherCompareResult);
  const setWeatherMetrics = useAeroGridStore((s) => s.setWeatherMetrics);
  const setWeatherTrainingData = useAeroGridStore((s) => s.setWeatherTrainingData);
  const setOptimizeResult = useAeroGridStore((s) => s.setOptimizeResult);
  const setFlyResult = useAeroGridStore((s) => s.setFlyResult);
  const setFlyComparisonResults = useAeroGridStore((s) => s.setFlyComparisonResults);
  const setActiveHeuristic = useAeroGridStore((s) => s.setActiveHeuristic);
  const setGAParams = useAeroGridStore((s) => s.setGAParams);
  const setMissionSnapshot = useAeroGridStore((s) => s.setMissionSnapshot);
  const addLog = useAeroGridStore((s) => s.addLog);

  // ── phase state ──────────────────────────────────────────────────────
  const [activePhase, setActivePhase] = useState<Phase>(() => {
    if (flyResult) return 'fly';
    if (optimizeResult) return 'optimize';
    return 'weather';
  });
  const [lockedPhases, setLockedPhases] = useState<Set<Phase>>(() => {
    const s = new Set<Phase>();
    if (optimizeResult) s.add('weather');
    if (flyResult) s.add('optimize');
    return s;
  });

  // ── weather phase state ──────────────────────────────────────────────
  const [conditions, setConditions] = useState<WeatherConditions>({ wind: 10, visibility: 8, rainfall: 0.5 });
  const [isWeatherFetching, setIsWeatherFetching] = useState(false);

  // ── optimize phase state ─────────────────────────────────────────────
  const [gaFrame, setGaFrame] = useState(0);
  const [gaPlaying, setGaPlaying] = useState(false);
  const [isOptimizeRunning, setIsOptimizeRunning] = useState(false);

  // ── fly phase state ──────────────────────────────────────────────────
  const [currentLegIdx, setCurrentLegIdx] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [flyPlaying, setFlyPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFlyFetching, setIsFlyFetching] = useState(false);
  const [hasFinishedFly, setHasFinishedFly] = useState(false);
  const flyRunIdRef = useRef(0);
  // Set true at the start of a scrubber jump so the leg-advance effect
  // doesn't log a spurious "Leg N complete" when stepIdx crosses a boundary
  // because of a direct jump (vs. natural autoplay increment).
  const isScrubbingRef = useRef(false);

  // ── guard: redirect to /build if no city ─────────────────────────────
  useEffect(() => {
    if (!cityData) router.replace('/build');
  }, [cityData, router]);

  // ── weather: debounced multi-model classify on every slider change ───
  useEffect(() => {
    if (!cityData) return;
    const t = setTimeout(async () => {
      setIsWeatherFetching(true);
      try {
        const r = await postWeatherCompare(conditions);
        setWeatherCompareResult(r);
        // Backwards-compat: keep weatherResult mirroring the NB prediction so
        // any consumer that still reads weatherResult.label stays working.
        if (r?.predictions?.naive_bayes) {
          setWeatherResult(r.predictions.naive_bayes);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsWeatherFetching(false);
      }
    }, WEATHER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [conditions, cityData, setWeatherCompareResult, setWeatherResult]);

  // One-shot fetches for static-ish ML metadata: metrics + training-data sample.
  useEffect(() => {
    if (!weatherMetrics) {
      fetchWeatherMetrics()
        .then(setWeatherMetrics)
        .catch((e) => console.error('fetchWeatherMetrics failed', e));
    }
    if (!weatherTrainingData) {
      fetchWeatherTrainingData(200)
        .then((d: { rows: typeof weatherTrainingData }) => setWeatherTrainingData(d.rows))
        .catch((e) => console.error('fetchWeatherTrainingData failed', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // log majority verdict on change
  useEffect(() => {
    if (weatherCompareResult) {
      const verdict = weatherCompareResult.majority_verdict;
      const ag = weatherCompareResult.agreement ? 'unanimous' : 'split';
      addLog(`[NB] Multi-model verdict: ${verdict} (${ag})`);
    }
  }, [weatherCompareResult?.majority_verdict, weatherCompareResult?.agreement]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── optimize: run GA when proceeding to this phase or on Re-run ──────
  const runOptimization = useCallback(async () => {
    if (!cityData) return;
    setIsOptimizeRunning(true);
    setGaPlaying(false);
    setGaFrame(0);
    try {
      const r = await fetchOptimization(cityData, gaParams);
      setOptimizeResult(r);
      addLog(`[GA] Optimization complete: ${r.improvement_pct.toFixed(1)}% improvement, ${r.history.length} gens`);
      setGaPlaying(true);
    } catch (err) {
      console.error(err);
      addLog('Error: GA failed');
    } finally {
      setIsOptimizeRunning(false);
    }
  }, [cityData, gaParams, setOptimizeResult, addLog]);

  // GA playback tick — one-shot run on phase entry / Re-run. No scrubbing;
  // the convergence chart itself is the timeline visualization. Re-run GA
  // replaces the need to rewind.
  useEffect(() => {
    if (activePhase !== 'optimize' || !optimizeResult || !gaPlaying) return;
    const interval = setInterval(() => {
      setGaFrame((prev) => {
        if (prev >= optimizeResult.history.length - 1) {
          setGaPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, GA_FRAME_MS);
    return () => clearInterval(interval);
  }, [activePhase, optimizeResult, gaPlaying]);

  // ── fly: run A* for ALL THREE heuristics in parallel, once on entry ──
  // We no longer re-fetch when the user switches heuristic mid-flight;
  // switching just swaps which cached comparison result mirrors into flyResult.
  const runFlightComparison = useCallback(async () => {
    if (!cityData || !optimizeResult) return;
    const myRun = ++flyRunIdRef.current;
    setIsFlyFetching(true);
    try {
      const [oct, man, euc] = await Promise.all([
        fetchFlight(cityData, optimizeResult.best_route, 'octile'),
        fetchFlight(cityData, optimizeResult.best_route, 'manhattan'),
        fetchFlight(cityData, optimizeResult.best_route, 'euclidean'),
      ]);
      if (myRun !== flyRunIdRef.current) return;
      const comparison = { octile: oct, manhattan: man, euclidean: euc };
      // Atomic swap: comparison + active result + animation reset + playing
      setFlyComparisonResults(comparison);
      setFlyResult(comparison[activeHeuristic]);
      setCurrentLegIdx(0);
      setCurrentStepIdx(0);
      setHasFinishedFly(false);
      setFlyPlaying(true);
      addLog(`[A*] Computed paths for 3 heuristics in parallel.`);
    } catch (err) {
      console.error(err);
      addLog('Error: A* failed');
    } finally {
      setIsFlyFetching(false);
    }
  }, [cityData, optimizeResult, activeHeuristic, setFlyComparisonResults, setFlyResult, addLog]);

  // Fetch on fly-phase entry. activeHeuristic intentionally excluded from
  // deps — switching heuristic must NOT refetch (the point of the parallel fetch).
  useEffect(() => {
    if (activePhase !== 'fly') return;
    runFlightComparison();
  }, [activePhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the active heuristic's cached result into flyResult so the canvas
  // and downstream UI read a single source. Clamp stepIdx if the new path is shorter.
  useEffect(() => {
    if (!flyComparisonResults) return;
    const next = flyComparisonResults[activeHeuristic];
    setFlyResult(next);
    const leg = next.legs[currentLegIdx];
    if (leg && currentStepIdx >= leg.path.length) {
      setCurrentStepIdx(Math.max(0, leg.path.length - 1));
    }
  }, [activeHeuristic, flyComparisonResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly animation tick
  useEffect(() => {
    if (activePhase !== 'fly' || !flyResult || !flyPlaying || hasFinishedFly) return;
    const interval = setInterval(() => {
      setCurrentStepIdx((prev) => prev + 1);
    }, FLY_TICK_MS / playbackSpeed);
    return () => clearInterval(interval);
  }, [activePhase, flyResult, flyPlaying, playbackSpeed, hasFinishedFly]);

  // Advance leg / finish mission when stepIdx walks off the end of a leg.
  // Gated by isScrubbingRef so a scrubber jump that lands at stepIdx ===
  // path.length doesn't spuriously log a leg-complete event.
  useEffect(() => {
    if (!flyResult) return;
    if (isScrubbingRef.current) {
      // Consume the scrub flag; subsequent natural ticks will log normally.
      isScrubbingRef.current = false;
      return;
    }
    const leg = flyResult.legs[currentLegIdx];
    if (!leg) return;
    if (currentStepIdx >= leg.path.length) {
      if (currentLegIdx < flyResult.legs.length - 1) {
        addLog(`[A*] Leg ${currentLegIdx + 1} complete · ${leg.nodes_explored} nodes · ${leg.path_length.toFixed(1)}u`);
        setCurrentLegIdx((p) => p + 1);
        setCurrentStepIdx(0);
      } else {
        setFlyPlaying(false);
        setHasFinishedFly(true);
        addLog('[A*] Mission complete. All targets reached.');
      }
    }
  }, [currentStepIdx, currentLegIdx, flyResult, addLog]);

  // Scrubber-derived state for /fly. globalFlyFrame and totalFlyFrames give
  // the Scrubber a flat 1-D timeline; ticks mark leg boundaries.
  const totalFlyFrames = useMemo(
    () => (flyResult ? flyResult.legs.reduce((a, l) => a + l.path.length, 0) : 0),
    [flyResult],
  );

  const globalFlyFrame = useMemo(() => {
    if (!flyResult) return 0;
    const before = flyResult.legs.slice(0, currentLegIdx).reduce((a, l) => a + l.path.length, 0);
    return before + currentStepIdx;
  }, [flyResult, currentLegIdx, currentStepIdx]);

  const flyTicks = useMemo(() => {
    if (!flyResult) return [];
    const out: { frame: number; label: string }[] = [];
    let acc = 0;
    flyResult.legs.forEach((leg, i) => {
      acc += leg.path.length;
      // Tick at the LAST step of each leg (i.e. arrival at target i+1).
      out.push({ frame: Math.max(0, acc - 1), label: `Leg ${i + 1} end` });
    });
    return out;
  }, [flyResult]);

  const handleFlyScrub = useCallback((globalFrame: number) => {
    if (!flyResult) return;
    // The Scrubber now emits fractional frames (Phase 2.5 made it continuous
    // so /learn could crossfade). /fly walks discrete leg.path[stepIdx], so
    // round at this boundary.
    const g = Math.round(globalFrame);
    let cumul = 0;
    let legIdx = 0;
    while (legIdx < flyResult.legs.length && cumul + flyResult.legs[legIdx].path.length <= g) {
      cumul += flyResult.legs[legIdx].path.length;
      legIdx++;
    }
    if (legIdx >= flyResult.legs.length) {
      legIdx = flyResult.legs.length - 1;
    }
    const leg = flyResult.legs[legIdx];
    const stepIdx = Math.max(0, Math.min(leg.path.length - 1, g - cumul));

    isScrubbingRef.current = true;
    setCurrentLegIdx(legIdx);
    setCurrentStepIdx(stepIdx);

    const lastLegIdx = flyResult.legs.length - 1;
    const lastStepIdx = Math.max(0, flyResult.legs[lastLegIdx].path.length - 1);
    if (legIdx < lastLegIdx || stepIdx < lastStepIdx) {
      setHasFinishedFly(false);
    }
  }, [flyResult]);

  // Intentionally NO auto-route to /results when fly finishes. The mission
  // stays on /mission so the user can replay, inspect each leg, and read the
  // ops console at their own pace. The "View results" footer button in
  // FlyPanel is the only way out, triggered manually.

  // ── derived view state ───────────────────────────────────────────────

  const phaseStatuses = useMemo<Record<Phase, PhaseStatus>>(() => {
    const status = (p: Phase): PhaseStatus => {
      if (p === activePhase) return 'active';
      if (lockedPhases.has(p)) return 'complete';
      return 'pending';
    };
    return { weather: status('weather'), optimize: status('optimize'), fly: status('fly') };
  }, [activePhase, lockedPhases]);

  const currentLeg = flyResult?.legs[currentLegIdx];

  // Battery model: planned with 25% headroom (DRAIN_COEFFICIENT = 0.75).
  // A successful mission lands at ~25% remaining, which reads as "delivered
  // with comfortable margin" rather than "we just barely made it on 0%".
  const battery = useMemo(() => {
    if (!flyResult) return 100;
    const total = flyResult.legs.reduce((acc, l) => acc + l.path_length, 0);
    if (total <= 0) return 100;
    const completedDist = flyResult.legs.slice(0, currentLegIdx).reduce((acc, l) => acc + l.path_length, 0);
    const legProgress = currentLeg ? (Math.min(currentStepIdx, currentLeg.path.length - 1) / Math.max(1, currentLeg.path.length - 1)) * currentLeg.path_length : 0;
    const drainedPct = ((completedDist + legProgress) / total) * 100;
    return Math.max(0, 100 - drainedPct * 0.75);
  }, [flyResult, currentLegIdx, currentStepIdx, currentLeg]);

  // Canvas-props derivation — single source of phase-specific overlays.
  const canvasProps = useMemo(() => {
    if (!cityData) return null;
    const base = {
      buildings: cityData.buildings,
      nfz: cityData.nfz,
      targets: cityData.targets,
      depot: cityData.depot,
      label: PHASE_LABELS[activePhase],
      weatherOverlay: activePhase === 'weather' ? conditions : undefined,
    };

    if (activePhase === 'optimize' && optimizeResult) {
      const frame = optimizeResult.history[Math.min(gaFrame, optimizeResult.history.length - 1)];
      const route = frame?.route.map((i) => cityData.targets[i]) ?? [];
      return { ...base, activeRoute: route };
    }

    if (activePhase === 'fly' && flyResult && currentLeg) {
      const completedPaths = flyResult.legs.slice(0, currentLegIdx).map((l) => l.path);
      const stepBounded = Math.min(currentStepIdx, currentLeg.path.length - 1);
      const dronePos = currentLeg.path[stepBounded];
      const droneTrail = currentLeg.path.slice(Math.max(0, stepBounded - TRAIL_LENGTH), stepBounded + 1);
      const currentPath = currentLeg.path.slice(stepBounded);
      // Accumulate explored cells across all completed legs + this leg up to current step,
      // so the canvas never blanks at a leg transition.
      const priorExplored = flyResult.legs.slice(0, currentLegIdx).flatMap((l) => l.explored);
      const currentExplored = currentLeg.explored.slice(
        0,
        Math.min(currentLeg.explored.length, stepBounded * 4 + 4),
      );
      const exploredCells = [...priorExplored, ...currentExplored];
      return {
        ...base,
        completedPaths,
        currentPath,
        exploredCells,
        dronePos,
        droneTrail,
        highlightTarget: currentLegIdx,
        batteryLevel: battery,
      };
    }

    return base;
  }, [activePhase, cityData, conditions, optimizeResult, gaFrame, flyResult, currentLeg, currentLegIdx, currentStepIdx, battery]);

  // ── interaction callbacks ────────────────────────────────────────────

  const handlePhaseSelect = (p: Phase) => {
    if (p === activePhase) return;
    if (!lockedPhases.has(p)) return; // can only revisit completed phases
    setActivePhase(p);
  };

  const handleProceedFromWeather = () => {
    // Gate on the multi-model majority. Fall back to single-model NB
    // result only if compare hasn't landed yet (it usually has).
    const verdict = weatherCompareResult?.majority_verdict ?? weatherResult?.label;
    if (!verdict || verdict === 'Grounded') return;
    setLockedPhases((prev) => new Set(prev).add('weather'));
    setActivePhase('optimize');
    if (!optimizeResult) runOptimization();
    else setGaPlaying(true);
  };

  const handleProceedFromOptimize = () => {
    if (!optimizeResult) return;
    setLockedPhases((prev) => new Set(prev).add('optimize'));
    setActivePhase('fly');

    // Freeze the verdict at launch. /results reads this snapshot so it
    // never contradicts what the user actually flew with.
    if (weatherCompareResult) {
      const agreers = Object.values(weatherCompareResult.predictions).filter(
        (p) => p.label === weatherCompareResult.majority_verdict,
      );
      const avgConf = agreers.length
        ? agreers.reduce((acc, p) => acc + (p.probabilities[p.label] ?? 0), 0) / agreers.length
        : 0;
      setMissionSnapshot({
        weatherVerdict:    weatherCompareResult.majority_verdict,
        weatherConfidence: avgConf,
        weatherAgreement:  weatherCompareResult.agreement,
        modelPredictions:  weatherCompareResult.predictions,
        launchedAt:        Date.now(),
      });
    }
  };

  const handleEndMission = () => {
    setWeatherResult(null);
    setOptimizeResult(null);
    setFlyResult(null);
    router.push('/build');
  };

  // handleSkipBack / handleSkipForward removed — Scrubber's keyboard handling
  // (←/→ step, Shift+←/→ jump 10, Home/End to extremes) plus its leg-boundary
  // ticks cover the same affordance with one consistent control surface.

  if (!cityData) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-52px)] bg-[#06090f] text-[#6b7fa3] text-[11px] font-mono tracking-[1.5px] uppercase">
        Redirecting to builder...
      </div>
    );
  }

  if (!canvasProps) return null;

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-[calc(100vh-52px)] bg-[#06090f] overflow-hidden">
      <PhaseStepper
        activePhase={activePhase}
        statuses={phaseStatuses}
        onSelect={handlePhaseSelect}
        onEndMission={handleEndMission}
      />

      <section className="grid grid-cols-[1fr_400px] min-h-0">
        {/* Canvas column — persistent across phases */}
        <div className="flex items-center justify-center relative px-8 py-6">
          <CityCanvas {...canvasProps} />

          {/* Playback scrubber — only meaningful during fly phase */}
          <AnimatePresence>
            {activePhase === 'fly' && flyResult && totalFlyFrames > 0 && (
              <motion.div
                key="playback"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[560px] bg-[rgba(11,17,32,0.92)] backdrop-blur-sm border border-[#1c2d4a] rounded-[4px] px-4 py-3"
              >
                <Scrubber
                  frame={globalFlyFrame}
                  totalFrames={totalFlyFrames}
                  hasCompleted={hasFinishedFly}
                  playing={flyPlaying}
                  onPlayPause={() => setFlyPlaying((p) => !p)}
                  speed={playbackSpeed}
                  speeds={[0.25, 0.5, 1, 2, 4]}
                  onSpeedChange={setPlaybackSpeed}
                  onScrub={handleFlyScrub}
                  ticks={flyTicks}
                  formatLabel={(f, t) => `Frame ${f} / ${Math.max(0, t - 1)}`}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right panel — swaps per phase */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activePhase}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="min-h-0"
          >
            {activePhase === 'weather' && (
              <WeatherPanel
                conditions={conditions}
                onConditionsChange={setConditions}
                compare={weatherCompareResult}
                metrics={weatherMetrics}
                trainingData={weatherTrainingData}
                isFetching={isWeatherFetching}
                canProceed={!!weatherCompareResult && weatherCompareResult.majority_verdict !== 'Grounded'}
                onProceed={handleProceedFromWeather}
                readOnly={lockedPhases.has('weather')}
              />
            )}
            {activePhase === 'optimize' && (
              <OptimizePanel
                result={optimizeResult}
                isRunning={isOptimizeRunning}
                frame={gaFrame}
                params={gaParams}
                onParamsChange={setGAParams}
                onReRun={runOptimization}
                onProceed={handleProceedFromOptimize}
                canProceed={!!optimizeResult && !isOptimizeRunning}
                readOnly={lockedPhases.has('optimize')}
              />
            )}
            {activePhase === 'fly' && (
              <FlyPanel
                result={flyResult}
                comparison={flyComparisonResults}
                isFetching={isFlyFetching}
                currentLegIdx={currentLegIdx}
                currentStepIdx={currentStepIdx}
                battery={battery}
                completedLegCount={Math.min(currentLegIdx, cityData.targets.length)}
                totalTargets={cityData.targets.length}
                activeHeuristic={activeHeuristic as FlyHeuristic}
                onActiveHeuristicChange={setActiveHeuristic}
                readOnly={false}
                hasFinished={hasFinishedFly}
                onJumpToResults={() => router.push('/results')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      <MissionStatusStrip
        weatherLabel={weatherCompareResult?.majority_verdict ?? weatherResult?.label ?? null}
        bestDistance={optimizeResult?.best_distance ?? null}
        naiveDistance={optimizeResult?.naive_distance ?? null}
        improvementPct={optimizeResult?.improvement_pct ?? null}
        activePhase={activePhase}
        currentLeg={activePhase === 'fly' && flyResult ? Math.min(currentLegIdx + 1, flyResult.legs.length) : null}
        totalLegs={activePhase === 'fly' && flyResult ? flyResult.legs.length : null}
        battery={activePhase === 'fly' && flyResult ? battery : null}
      />
    </div>
  );
}

const PHASE_LABELS: Record<Phase, string> = {
  weather:  'WEATHER ASSESSMENT — 40×40',
  optimize: 'ROUTE EVOLUTION — GENETIC ALGORITHM',
  fly:      'FLIGHT SIMULATION — LIVE',
};
