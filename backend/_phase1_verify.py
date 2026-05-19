"""Phase 1 verification: train/replay/generalize on 3 seeds.

Hits the running uvicorn (--reload picks up the new endpoints), so the
script doesn't import anything from main.py — it goes through HTTP exactly
the way the frontend will.

Run from the backend dir with the venv python:
    venv312/Scripts/python.exe _phase1_verify.py
"""

from __future__ import annotations

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def _post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def verify_one_seed(city_seed: int) -> dict:
    city = _get(f"/city/random?seed={city_seed}&difficulty=medium")
    start = city["depot"]
    goal = city["targets"][0]

    # -- /learn/train ----------------------------------------------------
    t0 = time.perf_counter()
    train = _post("/learn/train", {
        "city": city,
        "start": start,
        "goal": goal,
        "hyperparameters": {},
        "seed": 1,
    })
    train_secs = time.perf_counter() - t0

    n_episodes = len(train["episodes"])
    n_snapshots = len(train["snapshots"])
    q_len = train["final_path_length"]
    a_len = train["astar_path_length"]
    ratio = (q_len / a_len) if a_len > 0 else float("inf")

    first100 = sum(e["reward"] for e in train["episodes"][:100]) / 100
    last100 = sum(e["reward"] for e in train["episodes"][-100:]) / 100

    # -- /learn/replay ---------------------------------------------------
    q_full = train["final_q"]
    replay = _post("/learn/replay", {
        "city": city,
        "q_full": q_full,
        "start": start,
        "goal": goal,
    })
    replay_matches = (
        replay["path"] == train["final_path"]
        and replay["success"]
    )

    # -- /learn/generalize x 5 perturbation seeds ------------------------
    gen_successes = 0
    gen_lengths: list[float] = []
    for p_seed in range(1, 6):
        gen = _post("/learn/generalize", {
            "original_city": city,
            "q_full": q_full,
            "start": start,
            "goal": goal,
            "trained_path": train["final_path"],
            "num_perturbations": 3,
            "seed": p_seed,
        })
        if gen["qlearning_success"]:
            gen_successes += 1
            gen_lengths.append(gen["qlearning_path_length"])

    return {
        "city_seed": city_seed,
        "start": start,
        "goal": goal,
        "train_secs": round(train_secs, 2),
        "n_episodes": n_episodes,
        "n_snapshots": n_snapshots,
        "converged_at": train["converged_at"],
        "q_len": q_len,
        "a_len": a_len,
        "ratio": round(ratio, 3),
        "reward_first100_avg": round(first100, 1),
        "reward_last100_avg": round(last100, 1),
        "replay_matches": replay_matches,
        "generalize_successes_out_of_5": gen_successes,
        "generalize_avg_q_len": round(sum(gen_lengths) / len(gen_lengths), 2) if gen_lengths else None,
    }


if __name__ == "__main__":
    # Confirm endpoints exist
    docs = _get("/openapi.json")
    paths = list(docs["paths"].keys())
    print("Registered endpoints (filtered):")
    for p in sorted(paths):
        if p.startswith("/learn"):
            print(f"  {p}")
    print()

    rows = []
    for seed in (7, 11, 23):
        print(f"-- seed {seed} -------------------------------------------")
        r = verify_one_seed(seed)
        rows.append(r)
        for k, v in r.items():
            print(f"  {k}: {v}")
        print()

    # Aggregate
    print("-- Summary -------------------------------------------------")
    avg_ratio = sum(r["ratio"] for r in rows) / len(rows)
    total_gen = sum(r["generalize_successes_out_of_5"] for r in rows)
    print(f"  avg Q/A* path-length ratio: {avg_ratio:.3f}")
    print(f"  perturbation success: {total_gen}/15 across 3 cities x 5 seeds")
    print(f"  reward improved on all seeds: "
          f"{all(r['reward_last100_avg'] > r['reward_first100_avg'] for r in rows)}")
