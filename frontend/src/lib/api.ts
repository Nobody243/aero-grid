const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE) ||
  'http://127.0.0.1:8000';

export interface CityState {
  buildings: number[][];
  nfz: number[][];
  targets: number[][];
  depot: number[];
  grid_size: number;
}

export interface GAParams {
  mutation_rate?: number;
  population_size?: number;
  seed?: number | null;
}

export type FlyHeuristic = 'octile' | 'manhattan' | 'euclidean';

export type Difficulty = 'easy' | 'medium' | 'hard';

async function jsonOrThrow(res: Response, label: string) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

export async function fetchCityRandom(seed: number = 7, difficulty: Difficulty = 'medium') {
  const url = `${API_BASE}/city/random?seed=${seed}&difficulty=${difficulty}`;
  return jsonOrThrow(await fetch(url), 'fetchCityRandom');
}

export async function validateCity(city: CityState) {
  return jsonOrThrow(
    await fetch(`${API_BASE}/city/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(city),
    }),
    'validateCity',
  );
}

export async function postWeather(conditions: { wind: number; visibility: number; rainfall: number }) {
  return jsonOrThrow(
    await fetch(`${API_BASE}/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conditions),
    }),
    'postWeather',
  );
}

export async function postWeatherCompare(conditions: { wind: number; visibility: number; rainfall: number }) {
  return jsonOrThrow(
    await fetch(`${API_BASE}/weather/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conditions),
    }),
    'postWeatherCompare',
  );
}

export async function fetchWeatherMetrics() {
  return jsonOrThrow(await fetch(`${API_BASE}/weather/metrics`), 'fetchWeatherMetrics');
}

export async function fetchWeatherTrainingData(n: number = 200) {
  return jsonOrThrow(
    await fetch(`${API_BASE}/weather/training-data?n=${n}`),
    'fetchWeatherTrainingData',
  );
}

export async function fetchOptimization(city: CityState, params: GAParams = {}) {
  return jsonOrThrow(
    await fetch(`${API_BASE}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, ...params }),
    }),
    'fetchOptimization',
  );
}

export async function fetchFlight(city: CityState, route: number[], heuristic: FlyHeuristic = 'octile') {
  return jsonOrThrow(
    await fetch(`${API_BASE}/fly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, route, heuristic }),
    }),
    'fetchFlight',
  );
}

// ── Q-Learning ──────────────────────────────────────────────────────────

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

export interface QTrainEpisode {
  episode: number;
  reward: number;
  steps: number;
  epsilon: number;
  reached_goal: boolean;
}

export interface QSnapshot {
  episode: number;
  q_table: number[][]; // max-Q per cell, shape [grid_size][grid_size]
}

export interface QLearningResult {
  episodes: QTrainEpisode[];
  snapshots: QSnapshot[];
  converged_at: number | null;
  final_q: number[][][]; // full Q, shape [grid_size][grid_size][8]
  final_path: number[][];
  final_path_length: number;
  astar_path: number[][];
  astar_path_length: number;
  astar_nodes_explored: number;
  hyperparameters: QHyperparameters;
  total_episodes: number;
  seed: number | null;
}

export interface QReplayResponse {
  path: number[][];
  path_length: number;
  success: boolean;
}

export async function trainQLearning(
  city: CityState,
  start: number[],
  goal: number[],
  hyperparameters: QHyperparameters = DEFAULT_Q_HYPERPARAMETERS,
  seed: number | null = null,
): Promise<QLearningResult> {
  return jsonOrThrow(
    await fetch(`${API_BASE}/learn/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, start, goal, hyperparameters, seed }),
    }),
    'trainQLearning',
  );
}

export async function replayQLearning(
  city: CityState,
  q_full: number[][][],
  start: number[],
  goal: number[],
): Promise<QReplayResponse> {
  return jsonOrThrow(
    await fetch(`${API_BASE}/learn/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, q_full, start, goal }),
    }),
    'replayQLearning',
  );
}

// Stub for Phase 4 — same shape as backend's /learn/generalize.
export interface QGeneralizeResponse {
  perturbed_city: CityState;
  added_buildings: number[][];
  qlearning_path: number[][];
  qlearning_path_length: number;
  qlearning_success: boolean;
  astar_path: number[][];
  astar_path_length: number;
  astar_nodes_explored: number;
}

export interface GeneralizeOptions {
  numPerturbations?: number;
  // When provided, overrides random off-path placement and uses these
  // exact cells (backend validates them). Used by manual-placement mode.
  manualCells?: number[][];
  seed?: number | null;
}

export async function generalizeQLearning(
  originalCity: CityState,
  q_full: number[][][],
  start: number[],
  goal: number[],
  trainedPath: number[][],
  options: GeneralizeOptions = {},
): Promise<QGeneralizeResponse> {
  return jsonOrThrow(
    await fetch(`${API_BASE}/learn/generalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original_city: originalCity,
        q_full,
        start,
        goal,
        trained_path: trainedPath,
        num_perturbations: options.numPerturbations ?? 3,
        manual_cells: options.manualCells ?? null,
        seed: options.seed ?? null,
      }),
    }),
    'generalizeQLearning',
  );
}
