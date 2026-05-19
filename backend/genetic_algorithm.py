"""
genetic_algorithm.py
Genetic Algorithm — Delivery Route Optimization (TSP)
Finds near-optimal ordering of 8 delivery targets to minimize total flight distance.
"""

import random
import math
from typing import List, Tuple, Optional


Point = Tuple[int, int]


def euclidean(a: Point, b: Point) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def total_distance(route: List[int], targets: List[Point], depot: Optional[Point] = None) -> float:
    """Total path length: (depot →) target[0] → ... → target[n-1] (→ depot)."""
    dist = 0.0
    n = len(route)
    if n == 0: return 0.0
    
    # Path between targets
    for i in range(n - 1):
        dist += euclidean(targets[route[i]], targets[route[i+1]])
    
    if depot:
        # Depot -> First target + Last target -> Depot
        dist += euclidean(depot, targets[route[0]])
        dist += euclidean(targets[route[-1]], depot)
    else:
        # Close the loop between targets (classic TSP)
        dist += euclidean(targets[route[-1]], targets[route[0]])
        
    return dist


def fitness(route: List[int], targets: List[Point], depot: Optional[Point] = None) -> float:
    return 1.0 / max(0.001, total_distance(route, targets, depot))


# ── Selection ────────────────────────────────────────────────────────────────

def tournament_select(population, targets, depot: Optional[Point] = None, k=5, rng=None) -> List[int]:
    r = rng if rng is not None else random
    contestants = r.sample(population, k)
    return max(contestants, key=lambda route: fitness(route, targets, depot))


# ── Crossover — Order Crossover (OX) ─────────────────────────────────────────

def order_crossover(parent1: List[int], parent2: List[int], rng=None) -> List[int]:
    r = rng if rng is not None else random
    n = len(parent1)
    a, b = sorted(r.sample(range(n), 2))
    child = [-1] * n
    child[a:b+1] = parent1[a:b+1]
    fill = [gene for gene in parent2 if gene not in child]
    idx = 0
    for i in range(n):
        if child[i] == -1:
            child[i] = fill[idx]
            idx += 1
    return child


# ── Mutation — Swap ───────────────────────────────────────────────────────────

def swap_mutate(route: List[int], prob: float = 0.05, rng=None) -> List[int]:
    r = rng if rng is not None else random
    route = route[:]
    if r.random() < prob:
        i, j = r.sample(range(len(route)), 2)
        route[i], route[j] = route[j], route[i]
    return route


# ── Main GA ───────────────────────────────────────────────────────────────────

class GeneticAlgorithm:
    def __init__(
        self,
        targets: List[Point],
        depot: Optional[Point] = None,
        population_size: int = 100,
        max_generations: int = 500,
        mutation_prob: float = 0.05,
        patience: int = 50,
        seed: Optional[int] = None,
        elite_size: int = 2,
    ):
        self.targets = targets
        self.depot = depot
        self.pop_size = population_size
        self.max_gen = max_generations
        self.mut_prob = mutation_prob
        self.patience = patience
        self.elite_size = elite_size
        self.n = len(targets)
        self.seed = seed
        self.rng = random.Random(seed)

        # history for visualization: list of (generation, best_distance, best_route)
        self.history: List[Tuple[int, float, List[int]]] = []

    def _init_population(self) -> List[List[int]]:
        base = list(range(self.n))
        return [self.rng.sample(base, self.n) for _ in range(self.pop_size)]

    def run(self) -> Tuple[List[int], float]:
        population = self._init_population()
        best_route = min(population, key=lambda r: total_distance(r, self.targets, self.depot))
        best_dist = total_distance(best_route, self.targets, self.depot)
        no_improve = 0

        self.history.append((0, round(best_dist, 2), best_route[:]))

        last_gen = 0
        for gen in range(1, self.max_gen + 1):
            last_gen = gen
            sorted_pop = sorted(population, key=lambda r: total_distance(r, self.targets, self.depot))
            new_pop = [sorted_pop[i][:] for i in range(min(self.elite_size, len(sorted_pop)))]

            while len(new_pop) < self.pop_size:
                p1 = tournament_select(population, self.targets, self.depot, rng=self.rng)
                p2 = tournament_select(population, self.targets, self.depot, rng=self.rng)
                child = order_crossover(p1, p2, rng=self.rng)
                child = swap_mutate(child, self.mut_prob, rng=self.rng)
                new_pop.append(child)

            population = new_pop
            gen_best = min(population, key=lambda r: total_distance(r, self.targets, self.depot))
            gen_dist = total_distance(gen_best, self.targets, self.depot)

            if gen_dist < best_dist:
                best_dist = gen_dist
                best_route = gen_best[:]
                no_improve = 0
            else:
                no_improve += 1

            self.history.append((gen, round(best_dist, 2), best_route[:]))

            if no_improve >= self.patience:
                break

        if not self.history or self.history[-1][0] != last_gen:
            self.history.append((last_gen, round(best_dist, 2), best_route[:]))

        return best_route, best_dist


if __name__ == "__main__":
    random.seed(0)
    # 8 random targets on a 40x40 grid
    targets = [(random.randint(2, 38), random.randint(2, 38)) for _ in range(8)]
    depot = (1, 1)
    print("Depot:", depot)
    print("Targets:", targets)

    ga = GeneticAlgorithm(targets, depot=depot)
    best, dist = ga.run()

    naive = list(range(8))
    naive_dist = total_distance(naive, targets, depot)
    print(f"\nNaive order distance : {naive_dist:.2f}")
    print(f"GA optimized distance: {dist:.2f}")
    print(f"Best route: {best}")
    improvement = (1 - dist / naive_dist) * 100
    print(f"Improvement: {improvement:.1f}%")
