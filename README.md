# Aero-Grid

**Autonomous Drone Routing & Delivery AI**

Aero-Grid is a full-stack visualization of four classical AI techniques cooperating to plan and execute a multi-stop delivery mission across a 40x40 city grid. A FastAPI backend exposes each algorithm as a stateless endpoint; a Next.js frontend renders every decision step in real time on an interactive canvas and a 3D scene.

---

## AI Modules

| Module | Algorithm | Role in the Mission |
|---|---|---|
| Weather | Naive Bayes classifier | Pre-flight go / no-go verdict from wind, visibility, and rainfall |
| Optimize | Genetic Algorithm (TSP) | Orders the delivery targets to minimize total tour distance |
| Fly | A\* search | Per-leg pathfinding around buildings and no-fly zones |
| Learn | Q-Learning | Trains a tabular policy and demonstrates generalization under perturbation |

Each module is independently visualized: a Bayesian probability radar, a generational fitness curve with live chromosome reordering, an A\* explored-set sweep, and a Q-table heatmap with policy arrows.

---

## Tech Stack

**Backend**
- Python 3.12+ (compatible up to 3.14), FastAPI, Uvicorn
- scikit-learn, NumPy, pandas, joblib
- Pydantic v2 (with `pydantic-settings` for environment configuration)
- Rate limiting with `slowapi`

**Frontend**
- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS v4, Framer Motion
- Recharts for analytics, React Three Fiber / drei for the 3D hero scene
- Zustand for global mission state
- HTML Canvas for the live grid renderer

---

## Project Structure

```
aero-grid/
  backend/
    main.py                  FastAPI app and route handlers
    weather_classifier.py    Naive Bayes implementation
    genetic_algorithm.py     GA with Order Crossover + tournament selection
    astar.py                 A* with octile / manhattan / euclidean heuristics
    q_learning.py            Tabular Q-Learning agent and replay utilities
    data_pipeline.py         Generates weather_data.csv from rule-based synthesis
    models/                  Persisted scikit-learn baselines (joblib)
    requirements.txt
  frontend/
    src/
      app/                   Routes: /, /setup, /weather, /optimize, /fly, /learn, /results, /mission, /build
      components/            CityCanvas, NavBar, DecisionLog, phase panels, UI primitives
      lib/api.ts             Typed client for every backend endpoint
      lib/store.ts           Zustand mission store
    package.json
```

---

## Getting Started

### Prerequisites
- Python 3.12
- Node.js 20 or newer
- npm

### 1. Backend

```bash
cd backend
py -3.12 -m venv venv312
venv312\Scripts\activate          # Windows
# source venv312/bin/activate     # macOS / Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API documentation is then available at `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend talks to the backend at `http://127.0.0.1:8000` by default; override with the `NEXT_PUBLIC_API_BASE` environment variable.

---

## API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET  | `/city/random`           | Generate a random valid city (buildings, no-fly zones, targets, depot) |
| POST | `/city/validate`         | Check connectivity and reachability of all targets |
| POST | `/weather`               | Naive Bayes classification of flight conditions |
| POST | `/weather/compare`       | Compare multiple classifiers on the same input |
| GET  | `/weather/metrics`       | Cached accuracy / precision / recall for each baseline |
| GET  | `/weather/training-data` | Returns the labeled training scatter for visualization |
| POST | `/optimize`              | Genetic Algorithm tour optimization with full generational history |
| POST | `/fly`                   | A\* legs across the chosen route with explored-set metadata |
| POST | `/learn/train`           | Train a Q-Learning agent and return the full Q-table |
| POST | `/learn/replay`          | Replay the greedy policy derived from a trained Q-table |
| POST | `/learn/generalize`      | Stress-test the learned policy against perturbed obstacles |

---

## Design Notes

- The backend is **stateless** — the city is passed in with every request, so the frontend owns the source of truth.
- `/optimize` returns the entire generational history so the frontend can animate convergence frame-by-frame.
- `/fly` returns explored cells per leg, enabling the visualization to show the search frontier, not just the final path.
- `/learn/generalize` accepts manually-placed obstacles so the user can probe exactly the cells most likely to break the learned policy.
- CORS origins are dynamically configured via `allowed_origins` and methods are strictly restricted to `["GET", "POST"]`.
- Rate limiting is implemented with `slowapi` (10/minute for `/optimize`, `/fly`, `/learn/train`, `/learn/replay`, `/learn/generalize`; 30/minute for `/city/random` and `/weather`).
- Interactive API documentation pages (`/docs`, `/redoc`) and schema JSON (`/openapi.json`) are disabled when the backend runs in `production` mode.

---

## Project Context

This repository is designed as a drone routing project and visualization system; it is not intended for commercial production deployment.

---

## License

Released for academic and educational use.
