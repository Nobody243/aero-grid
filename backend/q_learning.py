"""
Tabular Q-Learning agent for grid-based pathfinding.

Mirrors backend/astar.py in shape: takes (buildings, nfz) on construction
and exposes a train()-then-greedy_path() workflow. State space is (x, y)
cells on a 40x40 grid. Action space is the same 8-direction set used by
A*, with the same diagonal cost convention (sqrt(2) per diagonal step).

Reward is potential-based per Ng et al. 1999, which preserves the optimal
policy: the shaping term F(s, s') = gamma * Phi(s') - Phi(s) cancels out
over any cycle, so the agent has no incentive to take a suboptimal path
to harvest shaping bonuses.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

Point = Tuple[int, int]

# Same 8 directions as astar.DIRECTIONS, in the same index order.
DIRECTIONS: List[Tuple[int, int, float]] = [
    (0, 1, 1.0), (0, -1, 1.0), (1, 0, 1.0), (-1, 0, 1.0),
    (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)),
    (-1, 1, math.sqrt(2)), (-1, -1, math.sqrt(2)),
]


class QLearningAgent:
    def __init__(
        self,
        buildings: Set[Point],
        nfz: Set[Point],
        grid_size: int = 40,
        alpha: float = 0.15,
        gamma: float = 0.95,
        epsilon_start: float = 1.0,
        epsilon_end: float = 0.05,
        epsilon_decay_episodes: int = 500,
        max_episodes: int = 1000,
        max_steps_per_episode: int = 200,
        goal_reward: float = 100.0,
        step_penalty: float = -1.0,
        obstacle_penalty: float = -50.0,
        shaping_coefficient: float = 0.5,
        seed: Optional[int] = None,
    ):
        self.blocked: Set[Point] = buildings | nfz
        self.grid_size = grid_size
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon_start = epsilon_start
        self.epsilon_end = epsilon_end
        self.epsilon_decay_episodes = epsilon_decay_episodes
        self.max_episodes = max_episodes
        self.max_steps_per_episode = max_steps_per_episode
        self.goal_reward = goal_reward
        self.step_penalty = step_penalty
        self.obstacle_penalty = obstacle_penalty
        self.shaping_coefficient = shaping_coefficient

        # 12,800 floats for a 40x40 grid: trivial.
        self.Q = np.zeros((grid_size, grid_size, 8), dtype=np.float32)
        self.rng = np.random.default_rng(seed)

    # ── primitives ──────────────────────────────────────────────────────

    def _in_bounds(self, pos: Point) -> bool:
        return 0 <= pos[0] < self.grid_size and 0 <= pos[1] < self.grid_size

    def _is_blocked(self, pos: Point) -> bool:
        return pos in self.blocked

    def _potential(self, pos: Point, goal: Point) -> float:
        """Octile distance — same heuristic A* uses, so shaping nudges the
        agent toward the same metric the comparison is judged on."""
        dx = abs(pos[0] - goal[0])
        dy = abs(pos[1] - goal[1])
        return max(dx, dy) + (math.sqrt(2) - 1) * min(dx, dy)

    def _step(self, state: Point, action: int, goal: Point) -> Tuple[Point, float, bool]:
        dx, dy, action_cost = DIRECTIONS[action]
        next_state = (state[0] + dx, state[1] + dy)

        if not self._in_bounds(next_state) or self._is_blocked(next_state):
            # Stay in place; big penalty so the agent learns to avoid walls.
            return state, self.obstacle_penalty, False

        reward = self.step_penalty * action_cost

        # Potential-based shaping: F(s, s') = gamma * Phi(s') - Phi(s).
        # Phi is negative octile distance so closer-to-goal = higher Phi.
        phi_s = -self._potential(state, goal)
        phi_s_prime = -self._potential(next_state, goal)
        reward += self.shaping_coefficient * (self.gamma * phi_s_prime - phi_s)

        done = next_state == goal
        if done:
            reward += self.goal_reward
        return next_state, reward, done

    def _epsilon(self, episode: int) -> float:
        if episode >= self.epsilon_decay_episodes:
            return self.epsilon_end
        return self.epsilon_start + (self.epsilon_end - self.epsilon_start) * (
            episode / self.epsilon_decay_episodes
        )

    def _select_action(self, state: Point, episode: int) -> int:
        if self.rng.random() < self._epsilon(episode):
            return int(self.rng.integers(0, 8))
        return int(np.argmax(self.Q[state[0], state[1]]))

    # ── train ───────────────────────────────────────────────────────────

    def train(
        self,
        start: Point,
        goal: Point,
        snapshot_interval: int = 25,
        early_stop_window: int = 50,
        early_stop_threshold: float = 0.5,
    ) -> Dict:
        episodes_history: List[Dict] = []
        snapshots: List[Dict] = []
        recent_rewards: List[float] = []
        converged_at: Optional[int] = None

        for episode in range(self.max_episodes):
            state = start
            total_reward = 0.0
            steps = 0
            reached = False

            for _ in range(self.max_steps_per_episode):
                action = self._select_action(state, episode)
                next_state, reward, done = self._step(state, action, goal)

                # Q-learning update. Bootstrap = 0 on terminal transitions.
                if done:
                    td_target = reward
                else:
                    td_target = reward + self.gamma * float(
                        np.max(self.Q[next_state[0], next_state[1]])
                    )
                td_error = td_target - self.Q[state[0], state[1], action]
                self.Q[state[0], state[1], action] += self.alpha * td_error

                total_reward += reward
                steps += 1
                state = next_state
                if done:
                    reached = True
                    break

            episodes_history.append({
                "episode": episode,
                "reward": round(total_reward, 2),
                "steps": steps,
                "epsilon": round(self._epsilon(episode), 4),
                "reached_goal": reached,
            })

            recent_rewards.append(total_reward)
            if len(recent_rewards) > early_stop_window:
                recent_rewards.pop(0)

            if episode % snapshot_interval == 0 or episode == self.max_episodes - 1:
                # max-Q per cell, compact for transport. Greedy walking on
                # the receiving side reconstructs the policy.
                max_q = np.max(self.Q, axis=2)
                snapshots.append({"episode": episode, "q_table": max_q.tolist()})

            if converged_at is None and len(recent_rewards) == early_stop_window:
                avg = float(np.mean(recent_rewards))
                std = float(np.std(recent_rewards))
                if avg > 0 and std < early_stop_threshold * abs(avg):
                    converged_at = episode

        final_path = self.greedy_path(start, goal)
        final_path_length = self._path_length(final_path) if final_path else 0.0

        return {
            "episodes": episodes_history,
            "snapshots": snapshots,
            "converged_at": converged_at,
            # Full Q (grid x grid x 8) — needed by replay/generalize so they
            # walk the SAME policy the agent learned. Snapshots are max-Q
            # projections, which are lossy: max-V over neighbors disagrees
            # with argmax-Q over actions when action rewards differ (diagonal
            # cost sqrt(2) vs 1, plus per-step shaping). ~12.8 KB per train.
            "final_q": self.Q.tolist(),
            "final_path": [list(p) for p in final_path] if final_path else [],
            "final_path_length": round(final_path_length, 2),
            "hyperparameters": {
                "alpha": self.alpha,
                "gamma": self.gamma,
                "epsilon_start": self.epsilon_start,
                "epsilon_end": self.epsilon_end,
                "epsilon_decay_episodes": self.epsilon_decay_episodes,
                "max_episodes": self.max_episodes,
                "max_steps_per_episode": self.max_steps_per_episode,
                "shaping_coefficient": self.shaping_coefficient,
            },
            "total_episodes": len(episodes_history),
        }

    # ── greedy rollout ──────────────────────────────────────────────────

    def greedy_path(self, start: Point, goal: Point, max_steps: int = 400) -> Optional[List[Point]]:
        """Walk Q greedily from start. No-revisit rule prevents infinite
        loops when Q-values at some states are degenerate; if the agent
        runs out of unvisited neighbors, the policy failed."""
        path: List[Point] = [start]
        state = start
        visited: Set[Point] = {start}

        for _ in range(max_steps):
            if state == goal:
                return path
            q_values = self.Q[state[0], state[1]]
            action_order = np.argsort(q_values)[::-1]
            moved = False
            for action in action_order:
                dx, dy, _ = DIRECTIONS[int(action)]
                nb = (state[0] + dx, state[1] + dy)
                if not self._in_bounds(nb) or self._is_blocked(nb) or nb in visited:
                    continue
                state = nb
                visited.add(state)
                path.append(state)
                moved = True
                break
            if not moved:
                return None
        return path if state == goal else None

    def _path_length(self, path: List[Point]) -> float:
        total = 0.0
        for i in range(len(path) - 1):
            dx = abs(path[i + 1][0] - path[i][0])
            dy = abs(path[i + 1][1] - path[i][1])
            total += math.sqrt(2) if (dx and dy) else 1.0
        return total


# ── module-level helper, used by /learn/replay and /learn/generalize ────

def greedy_from_q_full(
    q_full: List[List[List[float]]],
    start: Point,
    goal: Point,
    blocked: Set[Point],
    grid_size: int,
    max_steps: int = 400,
) -> Optional[List[Point]]:
    """Walk a full Q-table (grid x grid x 8) greedily. Matches the agent's
    own greedy_path exactly: picks the action with highest Q(s, a) at each
    step, no-revisit fallback to second-best, returns None if cornered."""
    q = np.array(q_full, dtype=np.float32)
    path: List[Point] = [start]
    state = start
    visited: Set[Point] = {start}

    for _ in range(max_steps):
        if state == goal:
            return path
        q_values = q[state[0], state[1]]
        action_order = np.argsort(q_values)[::-1]
        moved = False
        for action_idx in action_order:
            dx, dy, _ = DIRECTIONS[int(action_idx)]
            nb = (state[0] + dx, state[1] + dy)
            if not (0 <= nb[0] < grid_size and 0 <= nb[1] < grid_size):
                continue
            if nb in blocked or nb in visited:
                continue
            state = nb
            visited.add(state)
            path.append(state)
            moved = True
            break
        if not moved:
            return None

    return path if state == goal else None


def path_length(path: List[Point]) -> float:
    total = 0.0
    for i in range(len(path) - 1):
        dx = abs(path[i + 1][0] - path[i][0])
        dy = abs(path[i + 1][1] - path[i][1])
        total += math.sqrt(2) if (dx and dy) else 1.0
    return total
