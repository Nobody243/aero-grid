# Aero-Grid

**Autonomous Drone Routing & Delivery AI**

Aero-Grid is a full-stack visualization of four classical AI techniques cooperating to plan and execute a multi-stop delivery mission across a 40×40 city grid. A FastAPI backend exposes each algorithm as a stateless endpoint; a Next.js frontend renders every decision step in real time on an interactive canvas.

**Live Demo:** https://aerogrid-simulator-ag24303.vercel.app  
**API Backend:** https://aero-grid-backend.onrender.com

> ⚠️ The backend runs on Render's free plan. The first request after a period of inactivity may take ~30 seconds while the instance cold-starts.

---

## AI Modules

| Module | Algorithm | Role in the Mission |
|---|---|---|
| Weather | Naive Bayes classifier (+ 2 scikit-learn baselines) | Pre-flight go / no-go verdict from wind, visibility, and rainfall |
| Optimize | Genetic Algorithm (TSP) | Orders the delivery targets to minimize total tour distance |
| Fly | A\* search | Per-leg pathfinding around buildings and no-fly zones |
| Learn | Q-Learning | Trains a tabular policy, replays it, and stress-tests generalization under obstacle perturbation |

Each module is independently visualized: a Bayesian probability radar, a generational fitness curve with live chromosome reordering, an A\* explored-set sweep, and a Q-table heatmap with policy arrows.

---

## Tech Stack

**Backend**
- Python 3.12, FastAPI 0.136, Uvicorn
- scikit-learn 1.8, NumPy 2.4, pandas 3.0, joblib
- Pydantic v2 + `pydantic-settings` for environment config
- `slowapi` for per-endpoint rate limiting

**Frontend**
- Next.js 15 (App Router), React 19, TypeScript
- Vanilla CSS + CSS custom properties (no Tailwind in production)
- Framer Motion for page and component animations
- Recharts for analytics charts
- React Three Fiber / drei for the 3D landing scene
- Zustand for global mission state
- HTML Canvas for the live grid renderer

---

## Project Structure

```
aero-grid/
  backend/
    main.py                  FastAPI app, all route handlers, middleware
    config.py                pydantic-settings: reads ENVIRONMENT, ALLOWED_ORIGINS from env
    weather_classifier.py    Naive Bayes + 2 scikit-learn baselines (3-model ensemble)
    genetic_algorithm.py     GA with Order Crossover + tournament selection
    astar.py                 A* with octile / manhattan / euclidean heuristics
    q_learning.py            Tabular Q-Learning agent and greedy replay utilities
    data_pipeline.py         Generates weather_data.csv from rule-based synthesis
    models/                  Persisted scikit-learn models (joblib)
    requirements.txt
    .env.example             Template for local backend env vars
  frontend/
    src/
      app/                   Routes: /, /setup, /weather, /optimize, /fly, /learn, /results, /mission
      components/
        CityCanvas.tsx        40×40 interactive grid renderer (HTML Canvas)
        NavBar.tsx            Top navigation bar
        PhaseStepper.tsx      Mission phase progress indicator
        DecisionLog.tsx       Live log of AI decisions
        MissionStatusStrip.tsx Summary strip across the bottom
        ToolPalette.tsx       City editor tool switcher
        ValidationPanel.tsx   City reachability checker UI
        MobileGate.tsx        Mobile screen-size guard
        PageTransition.tsx    Framer Motion page wrapper
        landing/              Hero section components
        phase-panels/         WeatherPanel, OptimizePanel, FlyPanel
        learn/                Q-Learning UI components
        ui/                   Shared primitives (buttons, cards, etc.)
      lib/
        api.ts               Typed fetch client for every backend endpoint
        store.ts             Zustand mission store (single source of truth)
      hooks/                 Custom React hooks
    .env.example             Template: NEXT_PUBLIC_API_URL
    package.json
  render.yaml                Render deployment config (web service, env vars)
  .gitignore
```

---

## Local Development

### Prerequisites
- Python 3.12
- Node.js 20+, npm

### 1. Backend

```bash
cd backend
py -3.12 -m venv venv312
venv312\Scripts\activate          # Windows
# source venv312/bin/activate     # macOS / Linux
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Interactive API docs are available at `http://localhost:8000/docs` (disabled in production).

### 2. Frontend

```bash
cd frontend
npm install
```

Create a `.env.local` file (gitignored):

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`. The frontend reads `NEXT_PUBLIC_API_URL` as the backend base URL.

---

## Production Deployment

### Backend — Render

The backend is deployed via [`render.yaml`](render.yaml) as a Python web service on Render's free plan.

**Required environment variables (set in Render dashboard):**

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `ALLOWED_ORIGINS` | `https://aerogrid-simulator-ag24303.vercel.app` |

In production mode:
- API docs (`/docs`, `/redoc`, `/openapi.json`) are **disabled**
- Rate limiting is **enabled** (see limits below)

To add more allowed origins (e.g. preview deploys), set `ALLOWED_ORIGINS` to a comma-separated list:
```
https://aerogrid-simulator-ag24303.vercel.app,https://my-preview.vercel.app
```

### Frontend — Vercel

The frontend is deployed to Vercel under the project `aerogrid-simulator-ag24303`.

**Required environment variable (set in Vercel dashboard for Production & Preview):**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://aero-grid-backend.onrender.com` |

**Manual deploy via CLI** (from `frontend/` directory):
```bash
npx vercel --prod
```

> GitHub auto-deploy can be enabled in the Vercel dashboard under **Settings → Git** to trigger production builds on every push to `main`.

---

## API Reference

| Method | Endpoint | Rate Limit | Purpose |
|---|---|---|---|
| GET  | `/city/random`           | 30/min | Generate a random valid city (buildings, NFZs, targets, depot) |
| POST | `/city/validate`         | —      | Check connectivity and reachability of all targets from depot |
| POST | `/weather`               | 30/min | Naive Bayes flight condition classification |
| POST | `/weather/compare`       | —      | Run all 3 classifiers and return majority verdict |
| GET  | `/weather/metrics`       | —      | Per-model accuracy, confusion matrix, per-class scores |
| GET  | `/weather/training-data` | —      | Labeled training data sample for scatter plot visualization |
| POST | `/optimize`              | 10/min | Genetic Algorithm tour optimization with full generational history |
| POST | `/fly`                   | 10/min | A\* pathfinding per delivery leg with explored-set metadata |
| POST | `/learn/train`           | 10/min | Train a Q-Learning agent; returns Q-table + episode history |
| POST | `/learn/replay`          | 10/min | Greedy policy replay from a trained Q-table |
| POST | `/learn/generalize`      | 10/min | Stress-test policy on a perturbed city (auto or manual obstacles) |

---

## Design Notes

- **Stateless backend** — the city is passed with every request; the frontend (Zustand store) is the single source of truth.
- `/optimize` returns the full generational history so the frontend can animate convergence frame-by-frame.
- `/fly` returns explored cells per leg, enabling the search frontier to be visualized, not just the final path.
- `/learn/generalize` accepts manually-placed obstacle cells so the user can probe exactly the cells most likely to break the learned policy.
- CORS origins are dynamically configured via the `ALLOWED_ORIGINS` environment variable (comma-split list). The default fallback in development is `http://localhost:3000,http://127.0.0.1:3000`.
- Rate limiting (`slowapi`) is only active when `ENVIRONMENT=production`.

---

## License

Released for academic and educational use.
