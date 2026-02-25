"""
Aero-Grid FastAPI Backend
Stateless REST endpoints — city is passed in, not stored on the server.
"""

from collections import Counter
from pathlib import Path

from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple
import random
import logging

import pandas as pd

from weather_classifier import WeatherClassifier, LABELS as WEATHER_LABELS
from genetic_algorithm import GeneticAlgorithm, total_distance
from astar import AStarPathfinder, build_city, GRID_SIZE
from q_learning import QLearningAgent, greedy_from_q_full, path_length as q_path_length
from config import settings
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App setup ────────────────────────────────────────────────────────────────

docs_url = None if settings.is_production else "/docs"
redoc_url = None if settings.is_production else "/redoc"
openapi_url = None if settings.is_production else "/openapi.json"

app = FastAPI(
    title="Aero-Grid API",
    version="2.0.0",
    docs_url=docs_url,
    redoc_url=redoc_url,
    openapi_url=openapi_url,
)

# Initialize slowapi rate limiting and set state.limiter
limiter = Limiter(key_func=get_remote_address, enabled=settings.is_production)
app.state.limiter = limiter

# Rate limit exception handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Custom validation exception handler
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "invalid_input", "details": exc.errors()},
    )

# Custom catch-all exception handler
@app.exception_handler(Exception)
async def catch_all_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Classifier is stateless after training — safe to share across requests.
classifier = WeatherClassifier()

# Lazy-load the training CSV once for the /weather/training-data endpoint.
WEATHER_CSV_PATH = Path(__file__).parent / "weather_data.csv"
_weather_df: Optional[pd.DataFrame] = None

def _weather_dataframe() -> pd.DataFrame:
    global _weather_df
    if _weather_df is None:
        if not WEATHER_CSV_PATH.exists():
            raise HTTPException(status_code=503, detail="weather_data.csv not generated — run data_pipeline.py")
        _weather_df = pd.read_csv(WEATHER_CSV_PATH)
    return _weather_df

# Higher number = more severe — used to break 3-way ties in majority_verdict.
_SEVERITY = {label: i for i, label in enumerate(WEATHER_LABELS)}

DIFFICULTY_BUILDING_COUNT = {"easy": 10, "medium": 15, "hard": 22}
DEFAULT_TARGET_COUNT = 8

# ── Models ───────────────────────────────────────────────────────────────────

class CityState(BaseModel):
    buildings: List[List[int]] = Field(max_length=500)
    nfz: List[List[int]] = Field(max_length=500)
    targets: List[List[int]] = Field(max_length=500)
    depot: List[int]
    grid_size: int = Field(40, ge=10, le=40)


class WeatherRequest(BaseModel):
    wind: float
    visibility: float
    rainfall: float


class WeatherResponse(BaseModel):
    label: str
    probabilities: dict
    accuracy: float


class ValidateResponse(BaseModel):
    valid: bool
    issues: List[str]
    unreachable_targets: List[int]


class OptimizeRequest(BaseModel):
    city: CityState
    mutation_rate: float = Field(0.05, ge=0.01, le=0.20)
    population_size: int = Field(100, ge=50, le=200)
    seed: Optional[int] = None


class OptimizeResponse(BaseModel):
    best_route: List[int]
    best_distance: float
    naive_distance: float
    improvement_pct: float
    history: List[dict]
    seed: Optional[int] = None


class FlyRequest(BaseModel):
    city: CityState
    route: List[int] = Field(max_length=50)
    heuristic: Literal["octile", "manhattan", "euclidean"] = "octile"


class LegInfo(BaseModel):
    path: List[List[int]]
    explored: List[List[int]]
    path_length: float
    nodes_explored: int
    is_delivery: bool


class FlyResponse(BaseModel):
    legs: List[LegInfo]


class QHyperparameters(BaseModel):
    alpha: float = Field(0.15, ge=0.01, le=1.0)
    gamma: float = Field(0.95, ge=0.5,  le=0.999)
    epsilon_start: float = Field(1.0,  ge=0.0, le=1.0)
    epsilon_end:   float = Field(0.05, ge=0.0, le=1.0)
    epsilon_decay_episodes: int = Field(500, ge=10,  le=5000)
    max_episodes:           int = Field(1000, ge=10, le=5000)
    max_steps_per_episode:  int = Field(200, ge=20,  le=2000)
    shaping_coefficient:    float = Field(0.5, ge=0.0, le=2.0)


class TrainRequest(BaseModel):
    city: CityState
    start: List[int] = Field(min_length=2, max_length=2)
    goal: List[int] = Field(min_length=2, max_length=2)
    hyperparameters: QHyperparameters = QHyperparameters()
    seed: Optional[int] = None


class ReplayRequest(BaseModel):
    city: CityState
    # Full 3D Q-table from /learn/train.final_q. max-Q-per-cell projections
    # produce a different policy than what the agent actually learned, so
    # we ship the full action axis for replay correctness.
    q_full: List[List[List[float]]] = Field(max_length=100)
    start: List[int] = Field(min_length=2, max_length=2)
    goal: List[int] = Field(min_length=2, max_length=2)


class GeneralizeRequest(BaseModel):
    original_city: CityState
    q_full: List[List[List[float]]] = Field(max_length=100)
    start: List[int] = Field(min_length=2, max_length=2)
    goal: List[int] = Field(min_length=2, max_length=2)
    trained_path: List[List[int]]
    num_perturbations: int = Field(3, ge=0, le=20)
    # When provided, places these exact cells as new buildings (subject to
    # validity checks). Bypasses random off-path selection. This is how
    # the frontend's MANUAL placement mode passes user-chosen cells —
    # including cells ON the trained path, which deliberately stresses the
    # learned policy.
    manual_cells: Optional[List[List[int]]] = None
    seed: Optional[int] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _generate_targets(blocked, grid_size: int, seed: int, count: int = DEFAULT_TARGET_COUNT):
    """Sample non-blocked grid cells deterministically for delivery targets."""
    rng = random.Random(seed)
    targets: List[List[int]] = []
    seen = set()
    attempts = 0
    while len(targets) < count and attempts < 5000:
        attempts += 1
        p = (rng.randint(2, grid_size - 3), rng.randint(2, grid_size - 3))
        if p in blocked or p in seen:
            continue
        seen.add(p)
        targets.append([p[0], p[1]])
    return targets


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/city/random", response_model=CityState)
@limiter.limit("30/minute")
def get_random_city(
    request: Request,
    seed: int = Query(7, description="RNG seed for reproducible cities"),
    difficulty: Literal["easy", "medium", "hard"] = Query("medium"),
):
    """Generate a random city. Difficulty controls building density."""
    building_count = DIFFICULTY_BUILDING_COUNT[difficulty]
    buildings_set, nfz_set = build_city(seed=seed, building_count=building_count)
    blocked = buildings_set | nfz_set
    # Derive a target-sampling seed from the city seed so the whole city is reproducible.
    targets = _generate_targets(blocked, GRID_SIZE, seed * 13 + 1)
    return CityState(
        buildings=[list(b) for b in sorted(buildings_set)],
        nfz=[list(n) for n in sorted(nfz_set)],
        targets=targets,
        depot=[1, 1],
        grid_size=GRID_SIZE,
    )


@app.post("/city/validate", response_model=ValidateResponse)
def post_city_validate(city: CityState):
    """Check whether a city is playable: depot/targets unblocked and reachable."""
    buildings_set = {tuple(b) for b in city.buildings}
    nfz_set = {tuple(n) for n in city.nfz}
    blocked = buildings_set | nfz_set
    depot = tuple(city.depot)

    issues: List[str] = []
    unreachable: List[int] = []

    if depot in blocked:
        issues.append("Depot is blocked")

    for i, t in enumerate(city.targets):
        if tuple(t) in blocked:
            issues.append(f"Target {i} is blocked")

    if depot not in blocked:
        pathfinder = AStarPathfinder(buildings_set, nfz_set)
        for i, t in enumerate(city.targets):
            tt = tuple(t)
            if tt in blocked:
                continue
            path, _ = pathfinder.find_path(depot, tt)
            if path is None:
                unreachable.append(i)
                issues.append(f"Target {i} is unreachable from depot")

    return ValidateResponse(
        valid=len(issues) == 0,
        issues=issues,
        unreachable_targets=unreachable,
    )


@app.post("/weather", response_model=WeatherResponse)
@limiter.limit("30/minute")
def post_weather(req: WeatherRequest, request: Request):
    """Classify weather conditions using Gaussian Naive Bayes (backwards-compatible)."""
    label, probs = classifier.predict(req.wind, req.visibility, req.rainfall)
    return WeatherResponse(
        label=label,
        probabilities=probs,
        accuracy=round(classifier.accuracy, 4),
    )


@app.post("/weather/compare")
def post_weather_compare(req: WeatherRequest):
    """Run all 3 models on the same inputs and compute a majority verdict."""
    predictions = classifier.predict_all(req.wind, req.visibility, req.rainfall)
    labels_emitted = [p["label"] for p in predictions.values()]
    counts = Counter(labels_emitted).most_common()

    if len(counts) == 1:
        majority_verdict = counts[0][0]
        agreement = True
    elif counts[0][1] > counts[1][1]:
        majority_verdict = counts[0][0]
        agreement = False
    else:
        # 3-way tie: prefer the more conservative (higher-severity) label.
        majority_verdict = max(labels_emitted, key=lambda lbl: _SEVERITY[lbl])
        agreement = False

    return {
        "inputs": {
            "wind": req.wind,
            "visibility": req.visibility,
            "rainfall": req.rainfall,
        },
        "predictions": predictions,
        "majority_verdict": majority_verdict,
        "agreement": agreement,
        "feature_importance": classifier.get_feature_importance(),
    }


@app.get("/weather/metrics")
def get_weather_metrics():
    """Return per-model test metrics (accuracy, confusion matrix, per-class scores)."""
    return {
        "metrics": classifier.get_metrics(),
        "feature_importance": classifier.get_feature_importance(),
        "labels": WEATHER_LABELS,
    }


@app.get("/weather/training-data")
def get_weather_training_data(n: int = Query(200, ge=1, le=5000)):
    """Return N random rows from weather_data.csv for the frontend scatter plot."""
    df = _weather_dataframe()
    sample = df.sample(n=min(n, len(df)), random_state=42)
    rows = [
        {
            "wind": float(r.wind),
            "visibility": float(r.visibility),
            "rainfall": float(r.rainfall),
            "label": int(r.label),
            "label_name": WEATHER_LABELS[int(r.label)],
        }
        for r in sample.itertuples(index=False)
    ]
    return {"count": len(rows), "total_rows": len(df), "rows": rows}


@app.post("/optimize", response_model=OptimizeResponse)
@limiter.limit("10/minute")
def post_optimize(req: OptimizeRequest, request: Request):
    """Run Genetic Algorithm to optimize delivery route over the provided city."""
    targets_tuples = [tuple(t) for t in req.city.targets]
    depot_tuple = tuple(req.city.depot)

    if not targets_tuples:
        raise HTTPException(status_code=400, detail="City has no targets to optimize")

    ga = GeneticAlgorithm(
        targets_tuples,
        depot=depot_tuple,
        population_size=req.population_size,
        max_generations=500,
        mutation_prob=req.mutation_rate,
        patience=50,
        seed=req.seed,
    )
    best_route, best_dist = ga.run()
    naive_dist = total_distance(list(range(len(targets_tuples))), targets_tuples, depot_tuple)
    improvement = (1 - best_dist / naive_dist) * 100 if naive_dist > 0 else 0.0

    history = [
        {"generation": gen, "best_distance": dist, "route": route}
        for gen, dist, route in ga.history
    ]

    return OptimizeResponse(
        best_route=best_route,
        best_distance=round(best_dist, 2),
        naive_distance=round(naive_dist, 2),
        improvement_pct=round(improvement, 1),
        history=history,
        seed=req.seed,
    )


@app.post("/fly", response_model=FlyResponse)
@limiter.limit("10/minute")
def post_fly(req: FlyRequest, request: Request):
    """Run A* pathfinding for each leg of the delivery route over the provided city."""
    buildings_set = {tuple(b) for b in req.city.buildings}
    nfz_set = {tuple(n) for n in req.city.nfz}
    targets_tuples = [tuple(t) for t in req.city.targets]
    depot_tuple = tuple(req.city.depot)

    for idx in req.route:
        if idx < 0 or idx >= len(targets_tuples):
            raise HTTPException(
                status_code=400,
                detail=f"Route index {idx} out of range (city has {len(targets_tuples)} targets)",
            )

    pathfinder = AStarPathfinder(buildings_set, nfz_set, heuristic=req.heuristic)

    ordered = [targets_tuples[i] for i in req.route]
    waypoints = [depot_tuple] + ordered + [depot_tuple]

    legs: List[LegInfo] = []
    for i in range(len(waypoints) - 1):
        start = waypoints[i]
        end = waypoints[i + 1]
        path, info = pathfinder.find_path(start, end)
        is_delivery = i < len(ordered)
        legs.append(LegInfo(
            path=[list(p) for p in (path or [])],
            explored=[list(e) for e in info.get("explored", [])],
            path_length=info.get("path_length", 0.0),
            nodes_explored=info.get("nodes_explored", 0),
            is_delivery=is_delivery,
        ))

    return FlyResponse(legs=legs)


@app.post("/learn/train")
@limiter.limit("10/minute")
def post_learn_train(req: TrainRequest, request: Request):
    """Train a tabular Q-Learning agent for one leg (start -> goal) on the
    given city. Returns full episode history, Q-table snapshots, the
    final greedy path, and A*'s solution to the same problem so the
    frontend can compare quality side by side."""
    buildings = {tuple(b) for b in req.city.buildings}
    nfz = {tuple(n) for n in req.city.nfz}

    agent = QLearningAgent(
        buildings=buildings,
        nfz=nfz,
        grid_size=req.city.grid_size,
        alpha=req.hyperparameters.alpha,
        gamma=req.hyperparameters.gamma,
        epsilon_start=req.hyperparameters.epsilon_start,
        epsilon_end=req.hyperparameters.epsilon_end,
        epsilon_decay_episodes=req.hyperparameters.epsilon_decay_episodes,
        max_episodes=req.hyperparameters.max_episodes,
        max_steps_per_episode=req.hyperparameters.max_steps_per_episode,
        shaping_coefficient=req.hyperparameters.shaping_coefficient,
        seed=req.seed,
    )

    history = agent.train(tuple(req.start), tuple(req.goal))

    astar = AStarPathfinder(buildings=buildings, no_fly_zones=nfz)
    astar_path, astar_info = astar.find_path(tuple(req.start), tuple(req.goal))

    return {
        **history,
        "astar_path": [list(p) for p in astar_path] if astar_path else [],
        "astar_path_length": astar_info.get("path_length", 0.0),
        "astar_nodes_explored": astar_info.get("nodes_explored", 0),
        "seed": req.seed,
    }


@app.post("/learn/replay")
@limiter.limit("10/minute")
def post_learn_replay(req: ReplayRequest, request: Request):
    """Greedy walk of the trained policy on the given city. Used both for
    'show me the agent flying the leg' and for the head-to-head map."""
    buildings = {tuple(b) for b in req.city.buildings}
    nfz = {tuple(n) for n in req.city.nfz}
    blocked = buildings | nfz

    path = greedy_from_q_full(
        req.q_full,
        tuple(req.start),
        tuple(req.goal),
        blocked,
        req.city.grid_size,
    )

    return {
        "path": [list(p) for p in path] if path else [],
        "path_length": round(q_path_length(path), 2) if path else 0.0,
        "success": path is not None and path[-1] == tuple(req.goal),
    }


@app.post("/learn/generalize")
@limiter.limit("10/minute")
def post_learn_generalize(req: GeneralizeRequest, request: Request):
    """Test a trained Q-table on a PERTURBED version of the training city.
    Perturbations are added in cells NOT on the trained path (so the demo
    reliably has a chance of succeeding) but the agent must still steer
    around them using only what it learned. A* is recomputed from scratch
    on the perturbed city for the obvious comparison."""
    import random
    rng = random.Random(req.seed if req.seed is not None else 42)

    original_buildings = {tuple(b) for b in req.original_city.buildings}
    nfz = {tuple(n) for n in req.original_city.nfz}
    trained_path_cells = {tuple(p) for p in req.trained_path}
    target_cells = {tuple(t) for t in req.original_city.targets}
    depot_cell = tuple(req.original_city.depot)
    grid_size = req.original_city.grid_size

    new_buildings: List[Tuple[int, int]]
    if req.manual_cells:
        # MANUAL placement: trust the cells the user clicked, but defend
        # against invalid placements (out-of-bounds, on existing
        # obstacles/targets/depot). NOTE: we deliberately DO NOT filter
        # against trained_path_cells — the academic point of manual
        # placement is to let the user block the trained path on purpose.
        new_buildings = []
        for c in req.manual_cells:
            if len(c) < 2:
                continue
            cell = (int(c[0]), int(c[1]))
            if not (0 <= cell[0] < grid_size and 0 <= cell[1] < grid_size):
                continue
            if (cell in original_buildings or cell in nfz
                    or cell in target_cells or cell == depot_cell):
                continue
            new_buildings.append(cell)
    else:
        # AUTO placement: random cells that are off-path and not on any
        # existing fixture. Keeps the demo's success rate high.
        candidates: List[Tuple[int, int]] = []
        for x in range(grid_size):
            for y in range(grid_size):
                c = (x, y)
                if (c not in original_buildings and c not in nfz
                        and c not in trained_path_cells
                        and c not in target_cells and c != depot_cell):
                    candidates.append(c)
        rng.shuffle(candidates)
        new_buildings = candidates[: req.num_perturbations]
    perturbed_buildings = original_buildings | set(new_buildings)
    blocked = perturbed_buildings | nfz

    q_path = greedy_from_q_full(
        req.q_full,
        tuple(req.start),
        tuple(req.goal),
        blocked,
        grid_size,
    )

    astar = AStarPathfinder(buildings=perturbed_buildings, no_fly_zones=nfz)
    astar_path, astar_info = astar.find_path(tuple(req.start), tuple(req.goal))

    return {
        "perturbed_city": {
            **req.original_city.model_dump(),
            "buildings": [list(b) for b in sorted(perturbed_buildings)],
        },
        "added_buildings": [list(b) for b in new_buildings],
        "qlearning_path": [list(p) for p in q_path] if q_path else [],
        "qlearning_path_length": round(q_path_length(q_path), 2) if q_path else 0.0,
        "qlearning_success": q_path is not None and q_path[-1] == tuple(req.goal),
        "astar_path": [list(p) for p in astar_path] if astar_path else [],
        "astar_path_length": astar_info.get("path_length", 0.0),
        "astar_nodes_explored": astar_info.get("nodes_explored", 0),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
