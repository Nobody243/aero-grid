import { create } from 'zustand';

export interface CityData {
  buildings: number[][];
  nfz: number[][];
  targets: number[][];
  depot: number[];
  grid_size: number;
}

export interface WeatherResult {
  label: string;
  probabilities: Record<string, number>;
  accuracy: number;
}

export interface ModelPrediction {
  label: string;
  probabilities: Record<string, number>;
  accuracy: number;
}

export interface WeatherCompareResult {
  inputs: { wind: number; visibility: number; rainfall: number };
  predictions: Record<string, ModelPrediction>;
  majority_verdict: string;
  agreement: boolean;
  feature_importance: { wind: number; visibility: number; rainfall: number };
}

export interface ModelMetrics {
  accuracy: number;
  confusion_matrix: number[][];
  labels: string[];
  per_class: Record<
    string,
    { precision: number; recall: number; f1: number; support: number }
  >;
  train_size: number;
  test_size: number;
}

export interface WeatherMetrics {
  metrics: Record<string, ModelMetrics>;
  feature_importance: { wind: number; visibility: number; rainfall: number };
  labels: string[];
}

export interface WeatherTrainingPoint {
  wind: number;
  visibility: number;
  rainfall: number;
  label: number;
  label_name: string;
}

export interface GAHistory {
  generation: number;
  best_distance: number;
  route: number[];
}

export interface OptimizeResult {
  best_route: number[];
  best_distance: number;
  naive_distance: number;
  improvement_pct: number;
  history: GAHistory[];
  seed?: number | null;
}

export interface LegInfo {
  path: number[][];
  explored: number[][];
  path_length: number;
  nodes_explored: number;
  is_delivery: boolean;
}

export interface FlyResult {
  legs: LegInfo[];
}

export interface FlyComparisonResults {
  octile:    FlyResult;
  manhattan: FlyResult;
  euclidean: FlyResult;
}

// Frozen at "Start Flight" so /results never contradicts the verdict the user
// actually flew with, even if they go back and edit sliders post-mission.
export interface MissionSnapshot {
  weatherVerdict:   string;
  weatherConfidence: number;
  weatherAgreement: boolean;
  modelPredictions: Record<string, ModelPrediction>;
  launchedAt:       number;
}

export interface GAParams {
  mutation_rate: number;
  population_size: number;
  seed: number | null;
}

export type FlyHeuristic = 'octile' | 'manhattan' | 'euclidean';

// ── Q-Learning types ──────────────────────────────────────────────────

export interface QHyperparameters {
  alpha: number;
  gamma: number;
  epsilon_start: number;
  epsilon_end: number;
  epsilon_decay_episodes: number;
  max_episodes: number;
  max_steps_per_episode: number;
  shaping_coefficient: number;
}

export interface QLearningTrainEpisode {
  episode: number;
  reward: number;
  steps: number;
  epsilon: number;
  reached_goal: boolean;
}

export interface QLearningSnapshot {
  episode: number;
  q_table: number[][];
}

export interface QLearningResult {
  episodes: QLearningTrainEpisode[];
  snapshots: QLearningSnapshot[];
  converged_at: number | null;
  final_q: number[][][];
  final_path: number[][];
  final_path_length: number;
  astar_path: number[][];
  astar_path_length: number;
  astar_nodes_explored: number;
  hyperparameters: QHyperparameters;
  total_episodes: number;
  seed: number | null;
}

// Output of /learn/generalize — A* recomputes from scratch on a
// perturbed city, Q-Learning's pre-trained policy is queried at zero
// search cost.
export interface GeneralizationResult {
  perturbed_city: CityData;
  added_buildings: number[][];
  qlearning_path: number[][];
  qlearning_path_length: number;
  qlearning_success: boolean;
  astar_path: number[][];
  astar_path_length: number;
  astar_nodes_explored: number;
}

const DEFAULT_GA_PARAMS: GAParams = {
  mutation_rate: 0.05,
  population_size: 100,
  seed: null,
};

const DEFAULT_FLY_HEURISTIC: FlyHeuristic = 'octile';

export const DEFAULT_Q_HYPERPARAMETERS: QHyperparameters = {
  alpha: 0.15,
  gamma: 0.95,
  epsilon_start: 1.0,
  epsilon_end: 0.05,
  epsilon_decay_episodes: 500,
  max_episodes: 1000,
  max_steps_per_episode: 200,
  shaping_coefficient: 0.5,
};

// In-module dedup guard: addLog must drop a fire-twice on the same message
// inside this window. Catches React StrictMode dev double-invokes and any
// effect that runs twice on a single semantic event. 250 ms is long enough
// to swallow back-to-back renders, short enough that genuine repeated events
// (e.g. user moves the wind slider twice) still log separately.
const LOG_DEDUP_WINDOW_MS = 250;
let lastLogMessage: string | null = null;
let lastLogAt = 0;

interface AeroGridStore {
  cityData: CityData | null;
  weatherResult: WeatherResult | null;
  weatherCompareResult: WeatherCompareResult | null;
  weatherMetrics: WeatherMetrics | null;
  weatherTrainingData: WeatherTrainingPoint[] | null;
  optimizeResult: OptimizeResult | null;
  flyResult: FlyResult | null;
  flyComparisonResults: FlyComparisonResults | null;
  activeHeuristic: FlyHeuristic;
  gaParams: GAParams;
  flyHeuristic: FlyHeuristic;
  missionSnapshot: MissionSnapshot | null;
  logs: string[];

  // ── Q-Learning state (Day 4) ────────────────────────────────────────
  // Playback frame/playing/mode live as LOCAL state on /learn (Phase 2.5
  // unified them under a single PlaybackState reducer). The store retains
  // only the data that needs to persist across navigations.
  qLearningResult: QLearningResult | null;
  qSelectedLeg: number;
  qHyperparameters: QHyperparameters;
  qHasFinishedTraining: boolean;
  qGeneralizationResult: GeneralizationResult | null;

  setQLearningResult: (data: QLearningResult | null) => void;
  setQSelectedLeg: (idx: number) => void;
  setQHyperparameters: (params: Partial<QHyperparameters>) => void;
  setQHasFinishedTraining: (done: boolean) => void;
  setQGeneralizationResult: (data: GeneralizationResult | null) => void;
  resetQLearningForLegChange: () => void;

  setCityData: (data: CityData | null) => void;
  setWeatherResult: (data: WeatherResult | null) => void;
  setWeatherCompareResult: (data: WeatherCompareResult | null) => void;
  setWeatherMetrics: (data: WeatherMetrics | null) => void;
  setWeatherTrainingData: (data: WeatherTrainingPoint[] | null) => void;
  setOptimizeResult: (data: OptimizeResult | null) => void;
  setFlyResult: (data: FlyResult | null) => void;
  setFlyComparisonResults: (data: FlyComparisonResults | null) => void;
  setActiveHeuristic: (h: FlyHeuristic) => void;
  setGAParams: (params: Partial<GAParams>) => void;
  setFlyHeuristic: (h: FlyHeuristic) => void;
  setMissionSnapshot: (snapshot: MissionSnapshot | null) => void;
  addLog: (log: string) => void;

  // Clears per-mission results so the next mission starts at the weather phase
  // instead of resuming the previous mission's fly state. Preserves cityData
  // (the user may want to replay the same city), model-level facts
  // (weatherMetrics, weatherTrainingData), and user-set knobs (heuristic,
  // gaParams, qHyperparameters). Called from /build's Start Mission and from
  // /results' Restart Mission + Return Home — anywhere "fresh start" applies.
  resetMissionState: () => void;
}

export const useAeroGridStore = create<AeroGridStore>((set) => ({
  cityData: null,
  weatherResult: null,
  weatherCompareResult: null,
  weatherMetrics: null,
  weatherTrainingData: null,
  optimizeResult: null,
  flyResult: null,
  flyComparisonResults: null,
  activeHeuristic: DEFAULT_FLY_HEURISTIC,
  gaParams: DEFAULT_GA_PARAMS,
  flyHeuristic: DEFAULT_FLY_HEURISTIC,
  missionSnapshot: null,
  logs: [],

  qLearningResult: null,
  qSelectedLeg: 0,
  qHyperparameters: DEFAULT_Q_HYPERPARAMETERS,
  qHasFinishedTraining: false,
  qGeneralizationResult: null,

  setQLearningResult: (qLearningResult) => set({ qLearningResult }),
  setQSelectedLeg: (qSelectedLeg) => set({ qSelectedLeg }),
  setQHyperparameters: (params) =>
    set((state) => ({ qHyperparameters: { ...state.qHyperparameters, ...params } })),
  setQHasFinishedTraining: (qHasFinishedTraining) => set({ qHasFinishedTraining }),
  setQGeneralizationResult: (qGeneralizationResult) => set({ qGeneralizationResult }),
  // Clears the per-leg training state AND any generalization result —
  // both are about the previously-selected leg.
  resetQLearningForLegChange: () => set({
    qLearningResult: null,
    qHasFinishedTraining: false,
    qGeneralizationResult: null,
  }),

  setCityData: (cityData) => set({ cityData }),
  setWeatherResult: (weatherResult) => set({ weatherResult }),
  setWeatherCompareResult: (weatherCompareResult) => set({ weatherCompareResult }),
  setWeatherMetrics: (weatherMetrics) => set({ weatherMetrics }),
  setWeatherTrainingData: (weatherTrainingData) => set({ weatherTrainingData }),
  setOptimizeResult: (optimizeResult) => set({ optimizeResult }),
  setFlyResult: (flyResult) => set({ flyResult }),
  setFlyComparisonResults: (flyComparisonResults) => set({ flyComparisonResults }),
  setActiveHeuristic: (activeHeuristic) => set({ activeHeuristic, flyHeuristic: activeHeuristic }),
  setGAParams: (params) =>
    set((state) => ({ gaParams: { ...state.gaParams, ...params } })),
  setFlyHeuristic: (flyHeuristic) => set({ flyHeuristic, activeHeuristic: flyHeuristic }),
  setMissionSnapshot: (missionSnapshot) => set({ missionSnapshot }),
  addLog: (log) => {
    const now = Date.now();
    if (log === lastLogMessage && now - lastLogAt < LOG_DEDUP_WINDOW_MS) return;
    lastLogMessage = log;
    lastLogAt = now;
    set((state) => ({
      logs: [
        ...state.logs,
        `[${new Date().toLocaleTimeString([], { hour12: false })}] ${log}`,
      ],
    }));
  },

  resetMissionState: () => {
    // Clear the dedup tracker so the first log of the next mission can't be
    // accidentally suppressed if it happens to match the final log of the prior one.
    lastLogMessage = null;
    lastLogAt = 0;
    set({
      weatherResult: null,
      weatherCompareResult: null,
      optimizeResult: null,
      flyResult: null,
      flyComparisonResults: null,
      missionSnapshot: null,
      logs: [],
      qLearningResult: null,
      qHasFinishedTraining: false,
      qGeneralizationResult: null,
      qSelectedLeg: 0,
      // Preserved: cityData (user may replay the same city), weatherMetrics +
      // weatherTrainingData (model-level facts), gaParams + qHyperparameters +
      // activeHeuristic/flyHeuristic (user-set knobs).
    });
  },
}));
