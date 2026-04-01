'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
// (ChevronLeft + perturbation-tab icons live in the combined lucide import below.)

import { CityCanvas, type EditTool } from '@/components/CityCanvas';
import { Scrubber } from '@/components/ui/Scrubber';
import { LegSelector } from '@/components/learn/LegSelector';
import { LiveMetricsDashboard } from '@/components/learn/LiveMetricsDashboard';
import { RewardCurve } from '@/components/learn/RewardCurve';
import { TrainingControls } from '@/components/learn/TrainingControls';
import { PanelShell, Section } from '@/components/phase-panels/WeatherPanel';

import { useAeroGridStore, type GeneralizationResult } from '@/lib/store';
import { trainQLearning, generalizeQLearning } from '@/lib/api';
import { ChevronLeft, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react';

const SNAPSHOT_DURATION_SEC = 0.3;      // 1x training: ~12 s across 40 snapshots
const REPLAY_STEP_DURATION_SEC = 0.05;  // 1x replay: ~50 ms per cell
// React state commits per rAF tick. The rAF runs at 60 Hz to keep frameRef
// accurate (and the canvas pulse smooth), but committing 60 Hz pulled the
// dual-canvas render tree over its budget in dev (StrictMode doubles every
// pass) and React's max-depth guard fired against the render-queue
// saturation. 3 → 20 Hz commits. shouldStop always commits so the
// "finished" frame is never dropped. 30 Hz wasn't enough in side-by-side
// mode; if 20 Hz also trips we look at heavier optimizations first
// (split heatmap useMemo done; CityCanvas setCoords value-eq done).
const TICK_THROTTLE = 3;
const TRAIL_LENGTH = 14;
const DUAL_CANVAS_SIZE = 440;
const CITY_CANVAS_NATIVE = 560;
const DUAL_CANVAS_SCALE = DUAL_CANVAS_SIZE / CITY_CANVAS_NATIVE;
const EASE = [0.22, 1, 0.36, 1] as const;
const MAX_MANUAL_PERTURBATIONS = 5;

type PlaybackMode = 'training' | 'side_by_side_replay' | 'generalization_replay';
type PerturbationMode = 'auto' | 'manual';

interface PlaybackState {
  mode: PlaybackMode;
  frame: number;        // CONTINUOUS — fractional for crossfade + drone interp
  totalFrames: number;
  playing: boolean;
  speed: number;
}

const INITIAL_PLAYBACK: PlaybackState = {
  mode: 'training',
  frame: 0,
  totalFrames: 0,
  playing: false,
  speed: 1,
};

export default function LearnPage() {
  const router = useRouter();

  // ── Store ───────────────────────────────────────────────────────────
  const cityData = useAeroGridStore((s) => s.cityData);
  const flyResult = useAeroGridStore((s) => s.flyResult);
  const optimizeResult = useAeroGridStore((s) => s.optimizeResult);
  const qLearningResult = useAeroGridStore((s) => s.qLearningResult);
  const qSelectedLeg = useAeroGridStore((s) => s.qSelectedLeg);
  const qHyperparameters = useAeroGridStore((s) => s.qHyperparameters);
  const qHasFinishedTraining = useAeroGridStore((s) => s.qHasFinishedTraining);
  const qGeneralizationResult = useAeroGridStore((s) => s.qGeneralizationResult);
  const setQLearningResult = useAeroGridStore((s) => s.setQLearningResult);
  const setQSelectedLeg = useAeroGridStore((s) => s.setQSelectedLeg);
  const setQHasFinishedTraining = useAeroGridStore((s) => s.setQHasFinishedTraining);
  const setQGeneralizationResult = useAeroGridStore((s) => s.setQGeneralizationResult);
  const resetQLearningForLegChange = useAeroGridStore((s) => s.resetQLearningForLegChange);

  // ── Local playback (single source of truth for ALL playback) ────────
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [fetchingTrain, setFetchingTrain] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [fetchingGeneralize, setFetchingGeneralize] = useState(false);
  const [generalizeError, setGeneralizeError] = useState<string | null>(null);
  const [perturbationMode, setPerturbationMode] = useState<PerturbationMode>('auto');
  const [manualCells, setManualCells] = useState<number[][]>([]);

  // ── Guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyResult || !cityData || !optimizeResult) {
      router.replace('/results');
    }
  }, [flyResult, cityData, optimizeResult, router]);

  // ── Auto-pick hardest leg on first entry ────────────────────────────
  const hasInitializedLegRef = useRef(false);
  useEffect(() => {
    if (hasInitializedLegRef.current || !flyResult) return;
    hasInitializedLegRef.current = true;
    if (qLearningResult) return;
    const hardestIdx = flyResult.legs.reduce(
      (best, leg, i, arr) => (leg.nodes_explored > arr[best].nodes_explored ? i : best),
      0,
    );
    setQSelectedLeg(hardestIdx);
  }, [flyResult, qLearningResult, setQSelectedLeg]);

  // ── Leg endpoints (depot → ordered targets → depot) ────────────────
  const legEndpoints = useMemo(() => {
    if (!cityData || !optimizeResult) return null;
    const ordered = optimizeResult.best_route.map((i) => cityData.targets[i]);
    const waypoints = [cityData.depot, ...ordered, cityData.depot];
    const idx = Math.max(0, Math.min(qSelectedLeg, waypoints.length - 2));
    return { start: waypoints[idx], goal: waypoints[idx + 1] };
  }, [cityData, optimizeResult, qSelectedLeg]);

  // ── Start training ──────────────────────────────────────────────────
  const handleStartTraining = useCallback(async () => {
    if (!cityData || !legEndpoints) return;
    setFetchingTrain(true);
    setTrainError(null);
    try {
      const r = await trainQLearning(
        cityData,
        legEndpoints.start,
        legEndpoints.goal,
        qHyperparameters,
        null,
      );
      setQLearningResult(r);
      setQHasFinishedTraining(false);
      // Clear any prior generalization — it was tied to the previous training run.
      setQGeneralizationResult(null);
      frameRef.current = 0;
      setPlayback({
        mode: 'training',
        frame: 0,
        totalFrames: r.snapshots.length,
        playing: true,
        speed: 1,
      });
    } catch (err) {
      setTrainError((err as Error).message);
    } finally {
      setFetchingTrain(false);
    }
  }, [cityData, legEndpoints, qHyperparameters, setQLearningResult, setQHasFinishedTraining, setQGeneralizationResult]);

  // ── Run / re-run generalization ─────────────────────────────────────
  const handleRunGeneralization = useCallback(
    async (seed: number | null = null) => {
      if (!cityData || !qLearningResult || !legEndpoints) return;
      // Manual mode is gated by the caller: the "Run" button is disabled
      // when no cells are placed.
      const manualPayload =
        perturbationMode === 'manual' && manualCells.length > 0
          ? manualCells
          : undefined;
      setFetchingGeneralize(true);
      setGeneralizeError(null);
      try {
        const r = await generalizeQLearning(
          cityData,
          qLearningResult.final_q,
          legEndpoints.start,
          legEndpoints.goal,
          qLearningResult.final_path,
          {
            numPerturbations: 3,
            manualCells: manualPayload,
            seed,
          },
        );
        setQGeneralizationResult(r);
        const total = Math.max(r.astar_path.length, r.qlearning_path.length);
        frameRef.current = 0;
        setPlayback({
          mode: 'generalization_replay',
          frame: 0,
          totalFrames: total,
          playing: false,
          speed: 1,
        });
      } catch (err) {
        setGeneralizeError((err as Error).message);
      } finally {
        setFetchingGeneralize(false);
      }
    },
    [cityData, qLearningResult, legEndpoints, setQGeneralizationResult, perturbationMode, manualCells],
  );

  // AUTO mode: re-roll perturbations with a fresh seed.
  // MANUAL mode: drop the current result and return to the placement UI
  // with cells preserved so the user can edit and re-run.
  const handleRetryGeneralization = useCallback(() => {
    if (perturbationMode === 'auto') {
      handleRunGeneralization(Date.now() % 100000);
      return;
    }
    setQGeneralizationResult(null);
    frameRef.current = 0;
    setPlayback({
      mode: 'generalization_replay',
      frame: 0,
      totalFrames: 0,
      playing: false,
      speed: 1,
    });
  }, [perturbationMode, handleRunGeneralization, setQGeneralizationResult]);

  // Mode toggle. Manual cells stay across toggles (user might want to
  // compare auto and manual on the same placements). The previous result
  // is cleared because it's tied to whichever mode produced it.
  const handlePerturbationModeChange = useCallback(
    (mode: PerturbationMode) => {
      setPerturbationMode(mode);
      if (qGeneralizationResult) {
        setQGeneralizationResult(null);
        frameRef.current = 0;
        setPlayback({
          mode: 'generalization_replay',
          frame: 0,
          totalFrames: 0,
          playing: false,
          speed: 1,
        });
      }
    },
    [qGeneralizationResult, setQGeneralizationResult],
  );

  // Cell-click handler for manual mode. Toggle semantics: click an
  // empty placeable cell to add, click a placed perturbation to remove.
  // Invalid cells (buildings, NFZ, depot, targets) are silently rejected.
  const handleManualCellClick = useCallback(
    (x: number, y: number) => {
      if (perturbationMode !== 'manual') return;
      if (qGeneralizationResult !== null) return;
      if (!cityData) return;

      const isInvalid =
        cityData.buildings.some((b) => b[0] === x && b[1] === y) ||
        cityData.nfz.some((n) => n[0] === x && n[1] === y) ||
        cityData.targets.some((t) => t[0] === x && t[1] === y) ||
        (cityData.depot[0] === x && cityData.depot[1] === y);
      if (isInvalid) return;

      setManualCells((prev) => {
        const existsIdx = prev.findIndex((c) => c[0] === x && c[1] === y);
        if (existsIdx >= 0) return prev.filter((_, i) => i !== existsIdx);
        if (prev.length >= MAX_MANUAL_PERTURBATIONS) return prev;
        return [...prev, [x, y]];
      });
    },
    [perturbationMode, qGeneralizationResult, cityData],
  );

  // ── rAF tick — drives continuous frame advancement ─────────────────
  // Anything the rAF reads must be a ref; anything React renders must be
  // state. `frame` is dual-purpose — read by the tick to compute the next
  // frame, read by React to position the scrubber/heatmap/drones — so we
  // maintain BOTH. The tick reads/writes frameRef directly and mirrors
  // into state for rendering. State changes never restart the rAF.
  const playingRef = useRef(playback.playing);
  const speedRef = useRef(playback.speed);
  const modeRef = useRef(playback.mode);
  const frameRef = useRef(playback.frame);
  const totalFramesRef = useRef(playback.totalFrames);
  useEffect(() => {
    playingRef.current = playback.playing;
    speedRef.current = playback.speed;
    modeRef.current = playback.mode;
    totalFramesRef.current = playback.totalFrames;
    // frameRef is intentionally NOT synced from state here. The tick is
    // the source of truth for `frame` during autoplay; user actions
    // (scrub, mode change, leg change, restart-from-end) write frameRef
    // explicitly. Syncing from state on every render would race the tick.
  });

  useEffect(() => {
    if (!playback.playing) return;
    let lastTime = performance.now();
    let animFrameId = 0;
    let tickCount = 0;

    const tick = (now: number) => {
      if (!playingRef.current) {
        animFrameId = requestAnimationFrame(tick);
        return;
      }
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const stepDur =
        modeRef.current === 'training' ? SNAPSHOT_DURATION_SEC : REPLAY_STEP_DURATION_SEC;
      const advance = (dt * speedRef.current) / stepDur;
      const total = totalFramesRef.current;
      let nextFrame = frameRef.current + advance;
      let shouldStop = false;
      if (nextFrame >= total - 1) {
        nextFrame = total - 1;
        shouldStop = true;
      }
      frameRef.current = nextFrame;

      // 60 Hz frameRef updates (above) keep the animation math accurate;
      // 30 Hz React commits keep the dual-canvas render tree inside its
      // dev-mode budget. shouldStop forces a commit so the terminal frame
      // is never dropped by the throttle.
      tickCount++;
      if (tickCount % TICK_THROTTLE === 0 || shouldStop) {
        setPlayback((prev) => ({
          ...prev,
          frame: nextFrame,
          playing: shouldStop ? false : prev.playing,
        }));
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, [playback.playing]);

  // Once the training-mode frame reaches the end, persist the "finished"
  // flag in the store. (Side-by-side mode reaching its end is just "drone
  // arrived"; it doesn't need a flag.)
  useEffect(() => {
    if (
      playback.mode === 'training'
      && playback.totalFrames > 0
      && playback.frame >= playback.totalFrames - 1
      && !qHasFinishedTraining
    ) {
      setQHasFinishedTraining(true);
    }
  }, [playback.frame, playback.mode, playback.totalFrames, qHasFinishedTraining, setQHasFinishedTraining]);

  // ── Leg switch — wipes playback completely ─────────────────────────
  const handleLegSelect = useCallback(
    (idx: number) => {
      setQSelectedLeg(idx);
      resetQLearningForLegChange();
      frameRef.current = 0;
      setPlayback(INITIAL_PLAYBACK);
      setTrainError(null);
      // Manual cells are leg-specific (drawn over the trained path of the
      // CURRENT leg) — clear them on leg switch.
      setManualCells([]);
      setGeneralizeError(null);
    },
    [setQSelectedLeg, resetQLearningForLegChange],
  );

  // ── Mode switch ─────────────────────────────────────────────────────
  const handleModeChange = useCallback(
    (newMode: PlaybackMode) => {
      if (newMode === playback.mode) return;
      if (!qLearningResult) return;
      if (newMode !== 'training' && !qHasFinishedTraining) return;

      if (newMode === 'side_by_side_replay') {
        frameRef.current = 0;
        setPlayback({
          mode: 'side_by_side_replay',
          frame: 0,
          totalFrames: Math.max(
            qLearningResult.astar_path.length,
            qLearningResult.final_path.length,
          ),
          playing: false,
          speed: 1,
        });
      } else if (newMode === 'generalization_replay') {
        // Preserve any prior generalization result so the user can swap
        // tabs without losing state. totalFrames is 0 in the CTA state
        // (no result yet) — that hides the scrubber, which is the right
        // affordance: nothing to scrub through until they run the test.
        frameRef.current = 0;
        if (qGeneralizationResult) {
          setPlayback({
            mode: 'generalization_replay',
            frame: 0,
            totalFrames: Math.max(
              qGeneralizationResult.astar_path.length,
              qGeneralizationResult.qlearning_path.length,
            ),
            playing: false,
            speed: 1,
          });
        } else {
          setPlayback({
            mode: 'generalization_replay',
            frame: 0,
            totalFrames: 0,
            playing: false,
            speed: 1,
          });
        }
      } else {
        // back to training — snap to last snapshot so the heatmap is
        // "the final policy", not a blank canvas mid-training.
        const last = qLearningResult.snapshots.length - 1;
        frameRef.current = last;
        setPlayback({
          mode: 'training',
          frame: last,
          totalFrames: qLearningResult.snapshots.length,
          playing: false,
          speed: 1,
        });
      }
    },
    [playback.mode, qLearningResult, qHasFinishedTraining, qGeneralizationResult],
  );

  // ── Scrub handlers ──────────────────────────────────────────────────
  // Both ref and state are updated. The ref so the rAF picks up the new
  // frame on its next tick; the state so React re-renders the visuals.
  const handleScrub = useCallback((frame: number) => {
    const clamped = Math.max(0, Math.min(totalFramesRef.current - 1, frame));
    frameRef.current = clamped;
    setPlayback((prev) => ({ ...prev, frame: clamped }));
  }, []);

  // Pause on drag start so autoplay doesn't fight the user.
  const handleScrubStart = useCallback(() => {
    setPlayback((prev) => (prev.playing ? { ...prev, playing: false } : prev));
  }, []);

  const handlePlayPause = useCallback(() => {
    // If we're paused at the very end, restart from the beginning.
    if (!playingRef.current && frameRef.current >= totalFramesRef.current - 1) {
      frameRef.current = 0;
      setPlayback((prev) => ({ ...prev, frame: 0, playing: true }));
      return;
    }
    setPlayback((prev) => ({ ...prev, playing: !prev.playing }));
  }, []);

  const handleSpeedChange = useCallback((s: number) => {
    setPlayback((prev) => ({ ...prev, speed: s }));
  }, []);

  // ── Heatmap, split by mode ─────────────────────────────────────────
  // The training branch crossfades and DOES depend on playback.frame.
  // The replay branch is frozen on the final snapshot and DOESN'T —
  // splitting them lets the replay-mode heatmap stay stable across
  // frames so downstream useMemos with `heatmap` in their deps don't
  // need to re-fire 60 fps just to receive the same reference back.
  const trainingHeatmap = useMemo(() => {
    if (!qLearningResult || playback.mode !== 'training') return undefined;
    const snapshots = qLearningResult.snapshots;
    if (snapshots.length === 0) return undefined;
    const cur = Math.max(0, Math.min(Math.floor(playback.frame), snapshots.length - 1));
    const nx = Math.min(cur + 1, snapshots.length - 1);
    const sub = Math.max(0, Math.min(1, playback.frame - cur));
    if (playback.speed >= 2 || cur === nx || sub === 0) return snapshots[cur].q_table;
    const a = snapshots[cur].q_table;
    const b = snapshots[nx].q_table;
    const out: number[][] = new Array(a.length);
    for (let x = 0; x < a.length; x++) {
      const ca = a[x];
      const cb = b[x];
      const col = new Array(ca.length);
      for (let y = 0; y < ca.length; y++) col[y] = ca[y] + (cb[y] - ca[y]) * sub;
      out[x] = col;
    }
    return out;
  }, [qLearningResult, playback.frame, playback.mode, playback.speed]);

  const replayHeatmap = useMemo(() => {
    if (!qLearningResult) return undefined;
    // Both replay modes show the final-snapshot heatmap. Generalization
    // intentionally reuses the ORIGINAL trained Q-table — the academic
    // point is "the policy didn't retrain, the agent is using what it
    // already learned."
    if (playback.mode !== 'side_by_side_replay' && playback.mode !== 'generalization_replay') {
      return undefined;
    }
    return qLearningResult.snapshots[qLearningResult.snapshots.length - 1]?.q_table;
  }, [qLearningResult, playback.mode]);

  const heatmap = playback.mode === 'training' ? trainingHeatmap : replayHeatmap;

  // ── Drone interpolation helper ──────────────────────────────────────
  const interpDronePos = useCallback(
    (path: number[][], frame: number): number[] | undefined => {
      if (!path || path.length === 0) return undefined;
      const cur = Math.max(0, Math.min(Math.floor(frame), path.length - 1));
      const nx = Math.min(cur + 1, path.length - 1);
      const sub = Math.max(0, Math.min(1, frame - cur));
      if (cur === nx) return path[cur];
      const a = path[cur];
      const b = path[nx];
      return [a[0] + (b[0] - a[0]) * sub, a[1] + (b[1] - a[1]) * sub];
    },
    [],
  );

  // ── Canvas props per mode ───────────────────────────────────────────
  const trainingCanvasProps = useMemo(() => {
    if (!cityData) return null;
    return {
      buildings: cityData.buildings,
      nfz: cityData.nfz,
      targets: cityData.targets,
      depot: cityData.depot,
      label: 'Q-LEARNING TRAINING',
      qTableHeatmap: heatmap,
      completedPaths:
        qHasFinishedTraining && qLearningResult && qLearningResult.final_path.length > 1
          ? [qLearningResult.final_path]
          : undefined,
    };
  }, [cityData, heatmap, qHasFinishedTraining, qLearningResult]);

  const astarCanvasProps = useMemo(() => {
    if (!cityData || !qLearningResult) return null;
    const path = qLearningResult.astar_path;
    const idx = Math.max(0, Math.min(Math.floor(playback.frame), path.length - 1));
    return {
      buildings: cityData.buildings,
      nfz: cityData.nfz,
      targets: cityData.targets,
      depot: cityData.depot,
      label: '',
      currentPath: path.slice(idx),
      dronePos: interpDronePos(path, playback.frame),
      droneTrail: path.slice(Math.max(0, idx - TRAIL_LENGTH), idx + 1),
    };
  }, [cityData, qLearningResult, playback.frame, interpDronePos]);

  const qReplayCanvasProps = useMemo(() => {
    if (!cityData || !qLearningResult) return null;
    const path = qLearningResult.final_path;
    const idx = Math.max(0, Math.min(Math.floor(playback.frame), path.length - 1));
    return {
      buildings: cityData.buildings,
      nfz: cityData.nfz,
      targets: cityData.targets,
      depot: cityData.depot,
      label: '',
      currentPath: path.slice(idx),
      dronePos: interpDronePos(path, playback.frame),
      droneTrail: path.slice(Math.max(0, idx - TRAIL_LENGTH), idx + 1),
      qTableHeatmap: heatmap,
    };
  }, [cityData, qLearningResult, playback.frame, heatmap, interpDronePos]);

  // ── Generalization canvas props ────────────────────────────────────
  // Both canvases use the PERTURBED city (with the 3 added buildings).
  // The added-buildings array is passed through to CityCanvas so it
  // can render those cells with an amber outline — the visual cue that
  // those cells didn't exist during training.
  const astarGenCanvasProps = useMemo(() => {
    if (!qGeneralizationResult) return null;
    const city = qGeneralizationResult.perturbed_city;
    const path = qGeneralizationResult.astar_path;
    const idx = Math.max(0, Math.min(Math.floor(playback.frame), path.length - 1));
    return {
      buildings: city.buildings,
      nfz: city.nfz,
      targets: city.targets,
      depot: city.depot,
      label: '',
      addedBuildings: qGeneralizationResult.added_buildings,
      currentPath: path.length > 0 ? path.slice(idx) : [],
      dronePos: path.length > 0 ? interpDronePos(path, playback.frame) : undefined,
      droneTrail: path.length > 0 ? path.slice(Math.max(0, idx - TRAIL_LENGTH), idx + 1) : undefined,
    };
  }, [qGeneralizationResult, playback.frame, interpDronePos]);

  const qGenCanvasProps = useMemo(() => {
    if (!qGeneralizationResult) return null;
    const city = qGeneralizationResult.perturbed_city;
    const path = qGeneralizationResult.qlearning_path;
    const idx = Math.max(0, Math.min(Math.floor(playback.frame), path.length - 1));
    return {
      buildings: city.buildings,
      nfz: city.nfz,
      targets: city.targets,
      depot: city.depot,
      label: '',
      addedBuildings: qGeneralizationResult.added_buildings,
      currentPath: path.length > 0 ? path.slice(idx) : [],
      dronePos: path.length > 0 ? interpDronePos(path, playback.frame) : undefined,
      droneTrail: path.length > 0 ? path.slice(Math.max(0, idx - TRAIL_LENGTH), idx + 1) : undefined,
      qTableHeatmap: heatmap,
    };
  }, [qGeneralizationResult, playback.frame, heatmap, interpDronePos]);

  // Single-canvas props for the GENERALIZATION CTA state — shows the
  // ORIGINAL trained city with the learned heatmap so the user sees
  // what's about to be tested before clicking the run button. In MANUAL
  // mode the canvas is also interactive: cells the user clicks become
  // placed perturbations (rendered amber-bordered via addedBuildings).
  const generalizationCtaCanvasProps = useMemo(() => {
    if (!cityData || !qLearningResult) return null;
    const isManual = perturbationMode === 'manual';
    return {
      buildings: cityData.buildings,
      nfz: cityData.nfz,
      targets: cityData.targets,
      depot: cityData.depot,
      label: isManual ? 'PLACE PERTURBATIONS' : 'TRAINED ENVIRONMENT',
      qTableHeatmap: heatmap,
      completedPaths:
        qLearningResult.final_path.length > 1 ? [qLearningResult.final_path] : undefined,
      editMode: isManual,
      activeTool: (isManual ? 'perturbation' : 'cursor') as EditTool,
      onCellClick: isManual ? handleManualCellClick : undefined,
      addedBuildings: isManual ? manualCells : undefined,
    };
  }, [cityData, qLearningResult, heatmap, perturbationMode, manualCells, handleManualCellClick]);

  // Episode number to display in the right-panel metrics.
  //  - Training mode: tracks the scrubber (live metrics evolve as the user
  //    scrubs through the training animation).
  //  - Replay mode: FROZEN at the last episode. Side-by-side is "watch the
  //    trained agent fly," so the metrics shouldn't whip back to ep 0 (initial
  //    state) the moment we switch tabs — that's the regression Phase 2.5
  //    introduced and the screenshot caught.
  const currentEpisode = useMemo(() => {
    if (!qLearningResult) return 0;
    if (playback.mode === 'training') {
      const idx = Math.max(
        0,
        Math.min(Math.floor(playback.frame), qLearningResult.snapshots.length - 1),
      );
      return qLearningResult.snapshots[idx]?.episode ?? 0;
    }
    const lastEp = qLearningResult.episodes[qLearningResult.episodes.length - 1];
    return lastEp?.episode ?? qLearningResult.total_episodes - 1;
  }, [qLearningResult, playback.frame, playback.mode]);

  const trainingControlState: 'idle' | 'fetching' | 'animating' | 'finished' =
    fetchingTrain
      ? 'fetching'
      : qHasFinishedTraining
        ? 'finished'
        : qLearningResult
          ? 'animating'
          : 'idle';

  // ── Scrubber ticks ──────────────────────────────────────────────────
  const scrubberTicks = useMemo(() => {
    if (!qLearningResult) return [];
    if (playback.mode === 'training' && qLearningResult.converged_at !== null) {
      const target = qLearningResult.converged_at;
      const idx = qLearningResult.snapshots.findIndex((s) => s.episode >= target);
      if (idx === -1) return [];
      return [{ frame: idx, label: `Converged @ ep ${target}` }];
    }
    if (playback.mode === 'side_by_side_replay') {
      const out: { frame: number; label: string }[] = [];
      const aLen = qLearningResult.astar_path.length;
      const qLen = qLearningResult.final_path.length;
      if (aLen > 0) out.push({ frame: aLen - 1, label: 'A* arrives' });
      if (qLen > 0 && qLen !== aLen) out.push({ frame: qLen - 1, label: 'Q-Learning arrives' });
      return out;
    }
    if (playback.mode === 'generalization_replay' && qGeneralizationResult) {
      const out: { frame: number; label: string }[] = [];
      const aLen = qGeneralizationResult.astar_path.length;
      const qLen = qGeneralizationResult.qlearning_path.length;
      if (aLen > 0) out.push({ frame: aLen - 1, label: 'A* arrives' });
      if (qLen > 0 && qLen !== aLen) out.push({ frame: qLen - 1, label: 'Q-Learning arrives' });
      return out;
    }
    return [];
  }, [qLearningResult, playback.mode, qGeneralizationResult]);

  const scrubberLabel = useCallback(
    (f: number) => {
      if (playback.mode === 'training') {
        if (!qLearningResult) return '';
        const idx = Math.max(
          0,
          Math.min(Math.floor(f), qLearningResult.snapshots.length - 1),
        );
        const ep = qLearningResult.snapshots[idx]?.episode ?? 0;
        return `Episode ${ep}`;
      }
      return `Step ${Math.floor(f)} / ${Math.max(0, playback.totalFrames - 1)}`;
    },
    [playback.mode, playback.totalFrames, qLearningResult],
  );

  if (!cityData || !flyResult || !optimizeResult) return null;

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-[calc(100vh-52px)] bg-[#06090f] overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#1c2d4a]">
        <div className="flex items-baseline gap-4">
          <button
            type="button"
            onClick={() => router.push('/results')}
            className="flex items-center gap-1 text-[10px] font-mono text-[#6b7fa3] hover:text-white tracking-[1.5px] uppercase transition-colors duration-150"
          >
            <ChevronLeft size={11} />
            Back to results
          </button>
          <h1 className="text-base font-mono font-bold text-white tracking-[3px] uppercase">
            RL Training
          </h1>
          <span className="text-[10px] font-mono text-[#3a4f6b] tracking-[1.5px]">
            Reinforcement learning, one leg at a time
          </span>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-[1fr_400px] min-h-0">
        <div className="flex flex-col min-h-0">
          <LegSelectorRow
            legs={flyResult.legs}
            selected={qSelectedLeg}
            onSelect={handleLegSelect}
            disabled={trainingControlState === 'animating' || trainingControlState === 'fetching'}
          />
          <ModeTabs
            mode={playback.mode}
            replayEnabled={qHasFinishedTraining && qLearningResult !== null}
            onChange={handleModeChange}
          />
          {playback.mode === 'generalization_replay' && qHasFinishedTraining && qLearningResult && (
            <PerturbationModeToggle
              mode={perturbationMode}
              onChange={handlePerturbationModeChange}
            />
          )}
          <div className="flex-1 flex items-center justify-center px-6 py-4 min-h-0 overflow-y-auto custom-scrollbar">
            <AnimatePresence mode="wait">
              {playback.mode === 'training' ? (
                <motion.div
                  key="training-canvas"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex items-center justify-center"
                >
                  {trainingCanvasProps && <CityCanvas {...trainingCanvasProps} />}
                </motion.div>
              ) : playback.mode === 'side_by_side_replay' ? (
                <motion.div
                  key="replay-canvas"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex items-center justify-center"
                >
                  {astarCanvasProps && qReplayCanvasProps && (
                    <div className="flex items-center gap-6">
                      <DualCanvasCell label="A* PATH" labelColor="#a0b4d0">
                        <CityCanvas {...astarCanvasProps} />
                      </DualCanvasCell>
                      <DualCanvasCell label="Q-LEARNING PATH" labelColor="#00ddb4">
                        <CityCanvas {...qReplayCanvasProps} />
                      </DualCanvasCell>
                    </div>
                  )}
                </motion.div>
              ) : qGeneralizationResult ? (
                <motion.div
                  key="generalization-canvas"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex items-center justify-center"
                >
                  {astarGenCanvasProps && qGenCanvasProps && (
                    <div className="flex items-center gap-6">
                      <DualCanvasCell label="A* (RECOMPUTED)" labelColor="#a0b4d0">
                        <CityCanvas {...astarGenCanvasProps} />
                      </DualCanvasCell>
                      <DualCanvasCell label="Q-LEARNING (LEARNED POLICY)" labelColor="#00ddb4">
                        <CityCanvas {...qGenCanvasProps} />
                      </DualCanvasCell>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="generalization-cta"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex flex-col items-center justify-center gap-4 py-3"
                >
                  {/* Toggle is now persistent above (sibling of the
                      AnimatePresence) so it stays visible while a
                      result is showing. Not rendered here anymore. */}
                  {generalizationCtaCanvasProps && (
                    <DualCanvasCell
                      label={perturbationMode === 'manual' ? 'PLACE PERTURBATIONS' : 'TRAINED ENVIRONMENT'}
                      labelColor={perturbationMode === 'manual' ? '#ffaa00' : '#a0b4d0'}
                    >
                      <CityCanvas {...generalizationCtaCanvasProps} />
                    </DualCanvasCell>
                  )}
                  <GeneralizationCta
                    mode={perturbationMode}
                    onRun={() => handleRunGeneralization(null)}
                    fetching={fetchingGeneralize}
                    error={generalizeError}
                    placedCount={manualCells.length}
                    onClear={() => setManualCells([])}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <PanelShell
          title="Q-Learning Lab"
          subtitle="Tabular agent learns this leg by trial and error, then we compare to A*."
          footer={
            <button
              type="button"
              onClick={() => router.push('/results')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] font-mono font-bold tracking-[2px] uppercase text-[10px] text-[#a0b4d0] transition-colors duration-150"
            >
              <ChevronLeft size={11} />
              Back to Results
            </button>
          }
        >
          <Section title="Training">
            <TrainingControls
              state={trainingControlState}
              currentEpisode={currentEpisode}
              totalEpisodes={
                qLearningResult?.hyperparameters.max_episodes ?? qHyperparameters.max_episodes
              }
              onStart={handleStartTraining}
              disabled={false}
            />
            {trainError && (
              <div className="mt-2 px-2 py-1.5 rounded-[2px] border border-[#e03535] bg-[rgba(224,53,53,0.05)] text-[#e03535] text-[10px] font-mono">
                {trainError}
              </div>
            )}
          </Section>

          {qLearningResult && (
            <Section title="Live metrics">
              <LiveMetricsDashboard
                episodes={qLearningResult.episodes}
                currentEpisode={currentEpisode}
                totalEpisodes={qLearningResult.hyperparameters.max_episodes}
                convergedAt={qLearningResult.converged_at}
                hasFinished={qHasFinishedTraining}
              />
            </Section>
          )}

          {qLearningResult && (
            <Section title="Reward over time">
              <RewardCurve
                episodes={qLearningResult.episodes}
                currentEpisode={currentEpisode}
                convergedAt={qLearningResult.converged_at}
                hasFinished={qHasFinishedTraining}
              />
            </Section>
          )}

          <Section title="Hyperparameters">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Hp label="α learning rate" value={qHyperparameters.alpha.toFixed(2)} />
              <Hp label="γ discount" value={qHyperparameters.gamma.toFixed(2)} />
              <Hp label="ε decay over" value={`${qHyperparameters.epsilon_decay_episodes} ep`} />
              <Hp label="Reward shaping" value="potential" />
            </div>
          </Section>

          {qHasFinishedTraining && qLearningResult && playback.mode !== 'generalization_replay' && (
            <Section title="Compare to A*">
              <ComparisonSummary
                astarLen={qLearningResult.astar_path_length}
                astarNodes={qLearningResult.astar_nodes_explored}
                qLen={qLearningResult.final_path_length}
                onSideBySide={() => handleModeChange('side_by_side_replay')}
                replayActive={playback.mode === 'side_by_side_replay'}
              />
            </Section>
          )}

          {qHasFinishedTraining && qLearningResult && playback.mode === 'generalization_replay' && qGeneralizationResult && (
            <Section title="Generalization result">
              <GeneralizationSummary
                originalAstarLen={qLearningResult.astar_path_length}
                originalQLen={qLearningResult.final_path_length}
                gen={qGeneralizationResult}
                mode={perturbationMode}
                onRetry={handleRetryGeneralization}
                onBackToReplay={() => handleModeChange('side_by_side_replay')}
                retrying={fetchingGeneralize}
              />
            </Section>
          )}
        </PanelShell>
      </section>

      {/* ── Bottom: unified scrubber ────────────────────────────────── */}
      <div className="border-t border-[#1c2d4a] bg-[#0b1120] px-8 py-4 min-h-[64px] flex items-center">
        {qLearningResult && playback.totalFrames > 0 ? (
          <Scrubber
            frame={playback.frame}
            totalFrames={playback.totalFrames}
            hasCompleted={qHasFinishedTraining}
            playing={playback.playing}
            onPlayPause={handlePlayPause}
            speed={playback.speed}
            speeds={[0.25, 0.5, 1, 2, 4]}
            onSpeedChange={handleSpeedChange}
            onScrub={handleScrub}
            onScrubStart={handleScrubStart}
            ticks={scrubberTicks}
            formatLabel={scrubberLabel}
          />
        ) : (
          <div className="w-full text-[9px] font-mono text-[#3a4f6b] tracking-[2px] uppercase text-center">
            Click &quot;Start Training&quot; to begin
          </div>
        )}
      </div>
    </div>
  );
}

// ── LegSelectorRow ────────────────────────────────────────────────────
// Dedicated row directly under the page header. The leg picker used to
// live in the header's right corner and users missed it — too far from
// the canvas where attention sits, and visually compact enough to read
// as a status pill rather than an interactive control. Giving it its
// own labeled row + live stats for the current selection makes the
// "this is what we're training on" affordance unmistakable.

const LegSelectorRow: React.FC<{
  legs: { nodes_explored: number; path_length: number }[];
  selected: number;
  onSelect: (idx: number) => void;
  disabled?: boolean;
}> = ({ legs, selected, onSelect, disabled }) => {
  const safeIdx = Math.max(0, Math.min(selected, legs.length - 1));
  const leg = legs[safeIdx];
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[#1c2d4a] bg-[#0b1120]">
      <div className="flex items-center gap-3">
        <span className="text-[8px] font-mono font-bold text-[#6b7fa3] tracking-[2px] uppercase">
          Leg to train
        </span>
        <LegSelector
          legs={legs}
          selected={selected}
          onSelect={onSelect}
          disabled={disabled}
        />
      </div>
      {leg && (
        <div className="text-[10px] font-mono text-[#6b7fa3] tracking-[1.5px] uppercase">
          <span className="text-[#3a4f6b]">Currently · </span>
          <span className="text-[#a0b4d0] tabular-nums">A* uses {leg.nodes_explored} nodes, path {leg.path_length.toFixed(1)}u</span>
        </div>
      )}
    </div>
  );
};

// ── ModeTabs ──────────────────────────────────────────────────────────

const ModeTabs: React.FC<{
  mode: PlaybackMode;
  replayEnabled: boolean;
  onChange: (mode: PlaybackMode) => void;
}> = ({ mode, replayEnabled, onChange }) => (
  <div className="flex gap-1 px-6 pt-4 border-b border-[#1c2d4a]">
    <Tab active={mode === 'training'} onClick={() => onChange('training')}>
      Training
    </Tab>
    <Tab
      active={mode === 'side_by_side_replay'}
      onClick={() => replayEnabled && onChange('side_by_side_replay')}
      disabled={!replayEnabled}
      title={!replayEnabled ? 'Complete training first' : undefined}
    >
      Side-by-Side Replay
    </Tab>
    <Tab
      active={mode === 'generalization_replay'}
      onClick={() => replayEnabled && onChange('generalization_replay')}
      disabled={!replayEnabled}
      title={!replayEnabled ? 'Complete training first' : undefined}
    >
      Generalization
    </Tab>
  </div>
);

const Tab: React.FC<
  React.PropsWithChildren<{
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
  }>
> = ({ active, onClick, disabled, title, children }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    title={title}
    disabled={disabled}
    className={[
      'relative px-4 py-2 text-[10px] font-mono font-bold tracking-[1.5px] uppercase transition-colors duration-150',
      disabled
        ? 'text-[#3a4f6b] cursor-not-allowed'
        : active
          ? 'text-[#00a8ff]'
          : 'text-[#6b7fa3] hover:text-[#a0b4d0]',
    ].join(' ')}
  >
    {children}
    {active && (
      <motion.div
        layoutId="learn-tab-underline"
        className="absolute left-2 right-2 -bottom-px h-[2px] bg-[#00a8ff]"
        transition={{ duration: 0.25, ease: EASE }}
      />
    )}
  </button>
);

// ── DualCanvasCell — scales CityCanvas to fit side-by-side layout ─────

const DualCanvasCell: React.FC<
  React.PropsWithChildren<{ label: string; labelColor: string }>
> = ({ label, labelColor, children }) => (
  <div className="flex flex-col items-center gap-2">
    <div
      className="text-[9px] font-mono font-bold tracking-[2px] uppercase"
      style={{ color: labelColor }}
    >
      {label}
    </div>
    <div
      className="overflow-hidden flex items-center justify-center"
      style={{ width: DUAL_CANVAS_SIZE, height: DUAL_CANVAS_SIZE }}
    >
      <div style={{ transform: `scale(${DUAL_CANVAS_SCALE})`, transformOrigin: 'center' }}>
        {children}
      </div>
    </div>
  </div>
);

// ── ComparisonSummary — table + CTA into side-by-side replay ─────────

const ComparisonSummary: React.FC<{
  astarLen: number;
  astarNodes: number;
  qLen: number;
  onSideBySide: () => void;
  replayActive: boolean;
}> = ({ astarLen, astarNodes, qLen, onSideBySide, replayActive }) => {
  const pctDelta = astarLen > 0 ? ((qLen - astarLen) / astarLen) * 100 : 0;
  const deltaText =
    qLen === 0 ? '—' : `${pctDelta >= 0 ? '+' : ''}${pctDelta.toFixed(1)}%`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-[10px] font-mono">
        <div />
        <div className="text-[8px] text-[#6b7fa3] tracking-[2px] uppercase text-right">A*</div>
        <div className="text-[8px] text-[#6b7fa3] tracking-[2px] uppercase text-right">Q-Learn</div>

        <CRow label="Path length" a={`${astarLen.toFixed(1)}u`} q={`${qLen.toFixed(1)}u`} />
        <CRow
          label="vs optimal"
          a={<span className="text-[#3a4f6b]">baseline</span>}
          q={<span className={pctDelta > 0 ? 'text-[#ffaa00]' : 'text-[#00d45a]'}>{deltaText}</span>}
        />
        <CRow
          label="Nodes seen"
          a={astarNodes.toString()}
          q={<span className="text-[#3a4f6b]">n/a</span>}
        />
        <CRow
          label="Map needed"
          a={<span className="text-[#a0b4d0]">yes</span>}
          q={<span className="text-[#00ddb4]">no · learned</span>}
        />
      </div>

      <button
        type="button"
        onClick={onSideBySide}
        disabled={replayActive}
        className={[
          'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[3px] border font-mono font-bold tracking-[1.5px] uppercase text-[10px] transition-colors duration-150',
          replayActive
            ? 'border-[#1c2d4a] text-[#3a4f6b] cursor-not-allowed'
            : 'border-[#00ddb4] text-[#00ddb4] bg-[rgba(0,221,180,0.06)] hover:bg-[rgba(0,221,180,0.18)]',
        ].join(' ')}
      >
        {replayActive ? 'Side-by-side active' : 'Watch them fly side by side'}
      </button>
    </div>
  );
};

const CRow: React.FC<{ label: string; a: React.ReactNode; q: React.ReactNode }> = ({ label, a, q }) => (
  <>
    <div className="text-[8px] text-[#6b7fa3] tracking-[2px] uppercase self-center">{label}</div>
    <div className="text-right tabular-nums text-[#a0b4d0]">{a}</div>
    <div className="text-right tabular-nums text-[#a0b4d0]">{q}</div>
  </>
);

const Hp: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-0.5">
    <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[1.5px] uppercase">{label}</div>
    <div className="text-[11px] font-mono font-bold text-[#a0b4d0]">{value}</div>
  </div>
);

// ── Perturbation mode toggle ──────────────────────────────────────────
// Renders as a thin sub-bar directly under the main ModeTabs while the
// Generalization tab is active. Always visible — toggling it clears any
// stale result and returns to the placement/ready state for the new mode.

const PerturbationModeToggle: React.FC<{
  mode: PerturbationMode;
  onChange: (mode: PerturbationMode) => void;
}> = ({ mode, onChange }) => (
  <div className="flex items-center justify-center gap-3 px-6 py-2 border-b border-[#1c2d4a] bg-[#0b1120]">
    <div className="text-[8px] font-mono text-[#3a4f6b] tracking-[2.5px] uppercase">
      Perturbation source
    </div>
    <div
      role="radiogroup"
      aria-label="Perturbation source"
      className="inline-flex p-0.5 rounded-[3px] border border-[#1c2d4a] bg-[#06090f]"
    >
      <ToggleSegment active={mode === 'auto'} onClick={() => onChange('auto')}>
        Auto · random off-path
      </ToggleSegment>
      <ToggleSegment active={mode === 'manual'} onClick={() => onChange('manual')}>
        Manual · place yourself
      </ToggleSegment>
    </div>
  </div>
);

const ToggleSegment: React.FC<
  React.PropsWithChildren<{ active: boolean; onClick: () => void }>
> = ({ active, onClick, children }) => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    onClick={onClick}
    className={[
      'px-3 py-1.5 rounded-[2px] text-[9px] font-mono font-bold tracking-[1.5px] uppercase transition-colors duration-150',
      active
        ? 'bg-[rgba(0,168,255,0.12)] text-[#00a8ff]'
        : 'text-[#6b7fa3] hover:text-[#a0b4d0]',
    ].join(' ')}
  >
    {children}
  </button>
);

// ── Generalization CTA (start state for the third tab) ────────────────

const GeneralizationCta: React.FC<{
  mode: PerturbationMode;
  onRun: () => void;
  fetching: boolean;
  error: string | null;
  placedCount: number;
  onClear: () => void;
}> = ({ mode, onRun, fetching, error, placedCount, onClear }) => {
  if (mode === 'manual') {
    const disabled = fetching || placedCount === 0;
    return (
      <div className="w-full max-w-[480px] space-y-3 px-1">
        <div className="space-y-2">
          <div className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase">
            Manual perturbation
          </div>
          <p className="text-[11px] font-mono text-[#6b7fa3] leading-relaxed">
            Click cells on the canvas to place obstacles. Drop them on the trained path to deliberately stress the learned policy — the agent must adapt using only what it learned during training.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[10px] font-mono">
              <span className={placedCount > 0 ? 'text-[#ffaa00] font-bold' : 'text-[#3a4f6b]'}>
                {placedCount}
              </span>
              <span className="text-[#3a4f6b]"> / {MAX_MANUAL_PERTURBATIONS}</span>
              <span className="text-[#3a4f6b] tracking-[1.5px] uppercase text-[8px] ml-2">placed</span>
            </span>
            <button
              type="button"
              onClick={onClear}
              disabled={placedCount === 0}
              className="text-[9px] font-mono text-[#6b7fa3] hover:text-[#a0b4d0] tracking-[1.5px] uppercase disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Clear
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[3px] border-[1.5px] border-[#00ddb4] bg-[rgba(0,221,180,0.10)] text-[#00ddb4] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:bg-[rgba(0,221,180,0.22)] hover:shadow-[0_0_20px_rgba(0,221,180,0.30)] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          {fetching ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Running with placed obstacles
            </>
          ) : placedCount === 0 ? (
            <>Place at least one obstacle</>
          ) : (
            <>
              <Play size={13} fill="currentColor" className="ml-0.5" />
              Run with placed obstacles
            </>
          )}
        </button>
        {error && (
          <div className="px-2 py-1.5 rounded-[2px] border border-[#e03535] bg-[rgba(224,53,53,0.05)] text-[#e03535] text-[10px] font-mono">
            {error}
          </div>
        )}
      </div>
    );
  }

  // AUTO mode
  return (
    <div className="w-full max-w-[480px] space-y-3 px-1">
      <div className="space-y-2">
        <div className="text-[10px] font-mono font-bold text-[#a0b4d0] tracking-[2px] uppercase">
          Generalization test
        </div>
        <p className="text-[11px] font-mono text-[#6b7fa3] leading-relaxed">
          Add 3 random obstacles to the city after training is complete. Watch both algorithms tackle the new environment:
        </p>
        <ul className="text-[11px] font-mono text-[#a0b4d0] leading-relaxed pl-3 space-y-1">
          <li>
            <span className="text-[#6b7fa3]">·</span> A* must recompute its path from scratch
          </li>
          <li>
            <span className="text-[#6b7fa3]">·</span> Q-Learning uses its already-trained policy
          </li>
        </ul>
        <p className="text-[10px] font-mono text-[#3a4f6b] leading-relaxed italic pt-1">
          Classical search recomputes per query. Learned policies generalize.
        </p>
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={fetching}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[3px] border-[1.5px] border-[#00ddb4] bg-[rgba(0,221,180,0.10)] text-[#00ddb4] font-mono font-bold tracking-[2px] uppercase text-[11px] hover:bg-[rgba(0,221,180,0.22)] hover:shadow-[0_0_20px_rgba(0,221,180,0.30)] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
      >
        {fetching ? (
          <>
            <Loader2 size={13} className="animate-spin" />
            Adding obstacles, recomputing paths
          </>
        ) : (
          <>
            <Play size={13} fill="currentColor" className="ml-0.5" />
            Run Generalization Test
          </>
        )}
      </button>

      {error && (
        <div className="px-2 py-1.5 rounded-[2px] border border-[#e03535] bg-[rgba(224,53,53,0.05)] text-[#e03535] text-[10px] font-mono">
          {error}
        </div>
      )}
    </div>
  );
};

// ── Generalization summary (right panel when test has run) ────────────

const GeneralizationSummary: React.FC<{
  originalAstarLen: number;
  originalQLen: number;
  gen: GeneralizationResult;
  mode: PerturbationMode;
  onRetry: () => void;
  onBackToReplay: () => void;
  retrying: boolean;
}> = ({ originalAstarLen, originalQLen, gen, mode, onRetry, onBackToReplay, retrying }) => {
  // Math: (perturbed_length - original_length) / original_length × 100.
  // "unchanged" is shown when the values match within rounding rather
  // than as "+0.0%" — that ambiguous display was getting read as a math
  // bug rather than a genuine result. In AUTO mode (perturbations placed
  // off the trained path) both deltas being unchanged is the expected
  // outcome, not a failure mode.
  const fmtDelta = (orig: number, now: number): string => {
    if (orig <= 0) return now.toFixed(1) + 'u';
    if (Math.abs(now - orig) < 0.05) return 'unchanged';
    const pct = ((now - orig) / orig) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-[#6b7fa3] leading-relaxed">
        Added {gen.added_buildings.length} obstacles placed off the trained path.
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-[10px] font-mono">
        <div />
        <div className="text-[8px] text-[#6b7fa3] tracking-[2px] uppercase text-right">A*</div>
        <div className="text-[8px] text-[#6b7fa3] tracking-[2px] uppercase text-right">Q-Learn</div>

        <CRow
          label="Path length"
          a={`${gen.astar_path_length.toFixed(1)}u`}
          q={gen.qlearning_success
            ? `${gen.qlearning_path_length.toFixed(1)}u`
            : <span className="text-[#ffaa00]">{gen.qlearning_path_length.toFixed(1)}u <span className="text-[#3a4f6b]">(partial)</span></span>}
        />
        <CRow
          label="vs original"
          a={<span className="text-[#a0b4d0]">{fmtDelta(originalAstarLen, gen.astar_path_length)}</span>}
          q={gen.qlearning_success
            ? <span className="text-[#a0b4d0]">{fmtDelta(originalQLen, gen.qlearning_path_length)}</span>
            : <span className="text-[#3a4f6b]">—</span>}
        />
        <CRow
          label="Compute"
          a={`${gen.astar_nodes_explored} nodes`}
          q={<span className="text-[#00ddb4]">policy lookup</span>}
        />
        <CRow
          label="Adaptation"
          a={<span className="text-[#a0b4d0]">re-search</span>}
          q={<span className="text-[#00ddb4]">transferred</span>}
        />
        <CRow
          label="Success"
          a={<span className="text-[#00d45a]">✓ reached</span>}
          q={gen.qlearning_success
            ? <span className="text-[#00d45a]">✓ reached</span>
            : <span className="text-[#e03535]">✗ failed</span>}
        />
      </div>

      {/* Academic-note callout — one per page, reserved for THIS beat. */}
      <div className="mt-2 px-3 py-2.5 rounded-[3px] border border-[rgba(0,168,255,0.30)] bg-[rgba(0,168,255,0.04)]">
        <div className="flex items-baseline gap-1.5 mb-1">
          <Sparkles size={9} className="text-[#00a8ff] translate-y-px" />
          <div className="text-[8px] font-mono font-bold text-[#00a8ff] tracking-[2px] uppercase">
            The trade-off
          </div>
        </div>
        <p className="text-[10px] font-mono text-[#a0b4d0] leading-relaxed italic">
          A* is optimal per query but stateless — every new environment requires a complete search.
        </p>
        <p className="text-[10px] font-mono text-[#a0b4d0] leading-relaxed italic mt-1.5">
          Q-Learning is sample-inefficient to train but produces policies that transfer to similar environments without retraining. This is what classical AI lacks and what reinforcement learning is for.
        </p>
      </div>

      {!gen.qlearning_success && (
        <div className="px-3 py-2.5 rounded-[3px] border border-[rgba(255,170,0,0.45)] bg-[rgba(255,170,0,0.05)]">
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[#ffaa00] translate-y-px">⚠</span>
            <div className="text-[8px] font-mono font-bold text-[#ffaa00] tracking-[2px] uppercase">
              Policy failed
            </div>
          </div>
          <p className="text-[10px] font-mono text-[#a0b4d0] leading-relaxed italic">
            The trained policy could not reach the goal on this perturbation. This is the limitation of learned policies: they degrade non-gracefully when the environment changes in regions the agent learned to depend on.
          </p>
          <p className="text-[10px] font-mono text-[#a0b4d0] leading-relaxed italic mt-1.5">
            A* succeeded because it re-searches the entire space. Q-Learning would need additional training on this new environment to adapt.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-[3px] border border-[#00ddb4] bg-[rgba(0,221,180,0.06)] hover:bg-[rgba(0,221,180,0.18)] disabled:opacity-50 disabled:cursor-not-allowed font-mono font-bold tracking-[1.5px] uppercase text-[10px] text-[#00ddb4] transition-colors duration-150"
        >
          {retrying ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          {retrying
            ? 'Re-rolling'
            : mode === 'manual'
              ? 'Edit placements'
              : 'New perturbations'}
        </button>
        <button
          type="button"
          onClick={onBackToReplay}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-[3px] border border-[#1c2d4a] bg-[#06090f] hover:border-[#3a4f6b] hover:bg-[#0f1730] font-mono font-bold tracking-[1.5px] uppercase text-[10px] text-[#a0b4d0] transition-colors duration-150"
        >
          ← Back to replay
        </button>
      </div>
    </div>
  );
};
