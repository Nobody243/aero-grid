"""
Multi-model weather classifier for drone flight safety.

Trains GaussianNB, LogisticRegression (scaled), and DecisionTreeClassifier
on backend/weather_data.csv. Persists artifacts to backend/models/ so the
server starts instantly on subsequent boots.
"""

from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import joblib

from sklearn.naive_bayes import GaussianNB
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)


LABELS = ["Safe to Fly", "Requires Altitude Drop", "Grounded"]
LABEL_COLORS = {
    "Safe to Fly":            (0, 200, 80),
    "Requires Altitude Drop": (255, 165, 0),
    "Grounded":               (220, 50, 50),
}
FEATURE_NAMES = ["wind", "visibility", "rainfall"]
MODEL_NAMES = ["naive_bayes", "logistic_regression", "decision_tree"]

BACKEND_DIR = Path(__file__).parent
MODELS_DIR = BACKEND_DIR / "models"
CSV_PATH = BACKEND_DIR / "weather_data.csv"

MODEL_FILES = {name: MODELS_DIR / f"{name}.joblib" for name in MODEL_NAMES}
METRICS_FILE = MODELS_DIR / "metrics.joblib"


# ── Synthetic fallback (kept so data_pipeline.py can fall back to it) ────────

def generate_dataset(n: int = 200, seed: int = 42):
    """Synthetic 3-feature dataset used only when Open-Meteo is unreachable."""
    rng = np.random.default_rng(seed)
    records, labels = [], []
    n_safe = n // 3
    records.append(np.column_stack([
        rng.uniform(0, 20, n_safe), rng.uniform(5, 10, n_safe), rng.uniform(0, 2, n_safe)
    ]))
    labels += [0] * n_safe
    n_alt = n // 3
    records.append(np.column_stack([
        rng.uniform(20, 45, n_alt), rng.uniform(2, 5, n_alt), rng.uniform(2, 8, n_alt)
    ]))
    labels += [1] * n_alt
    n_gnd = n - n_safe - n_alt
    records.append(np.column_stack([
        rng.uniform(45, 80, n_gnd), rng.uniform(0, 2, n_gnd), rng.uniform(8, 25, n_gnd)
    ]))
    labels += [2] * n_gnd
    return np.vstack(records), np.array(labels)


# ── Training internals ───────────────────────────────────────────────────────

def _build_models() -> Dict[str, object]:
    return {
        "naive_bayes": GaussianNB(),
        "logistic_regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=1000)),
        ]),
        "decision_tree": DecisionTreeClassifier(max_depth=6, random_state=42),
    }


def _per_class_metrics(y_true, y_pred) -> Dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=[0, 1, 2], zero_division=0
    )
    return {
        LABELS[i]: {
            "precision": round(float(precision[i]), 4),
            "recall":    round(float(recall[i]),    4),
            "f1":        round(float(f1[i]),        4),
            "support":   int(support[i]),
        }
        for i in range(3)
    }


def _train_all_models(df: pd.DataFrame):
    X = df[FEATURE_NAMES].to_numpy(dtype=float)
    y = df["label"].to_numpy(dtype=int)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    models = _build_models()
    metrics: Dict[str, Dict] = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        metrics[name] = {
            "accuracy":          round(float(accuracy_score(y_test, y_pred)), 4),
            "confusion_matrix":  confusion_matrix(y_test, y_pred, labels=[0, 1, 2]).tolist(),
            "labels":            LABELS,
            "per_class":         _per_class_metrics(y_test, y_pred),
            "train_size":        int(len(y_train)),
            "test_size":         int(len(y_test)),
        }

    dt: DecisionTreeClassifier = models["decision_tree"]
    importances = {
        FEATURE_NAMES[i]: round(float(dt.feature_importances_[i]), 4)
        for i in range(3)
    }
    return models, metrics, importances


# ── Public class ─────────────────────────────────────────────────────────────

class WeatherClassifier:
    def __init__(self, force_retrain: bool = False):
        self.models: Dict[str, object] = {}
        self.metrics: Dict[str, Dict] = {}
        self.feature_importance: Dict[str, float] = {}

        if not force_retrain and self._all_artifacts_exist():
            self._load_artifacts()
        else:
            self._train_and_persist()

    # ── Backwards-compatible surface (existing /weather endpoint depends on these) ──

    @property
    def accuracy(self) -> float:
        return self.metrics.get("naive_bayes", {}).get("accuracy", 0.0)

    @property
    def model(self):
        return self.models["naive_bayes"]

    def predict(self, wind_speed: float, visibility: float, rainfall: float) -> Tuple[str, Dict[str, float]]:
        """Primary prediction via NaiveBayes — unchanged signature."""
        features = np.array([[wind_speed, visibility, rainfall]], dtype=float)
        m = self.models["naive_bayes"]
        idx = int(m.predict(features)[0])
        probs_raw = m.predict_proba(features)[0]
        return LABELS[idx], {LABELS[i]: round(float(p), 3) for i, p in enumerate(probs_raw)}

    # ── New multi-model surface ────────────────────────────────────────────

    def predict_all(self, wind_speed: float, visibility: float, rainfall: float) -> Dict:
        features = np.array([[wind_speed, visibility, rainfall]], dtype=float)
        result: Dict[str, Dict] = {}
        for name, m in self.models.items():
            idx = int(m.predict(features)[0])
            probs_raw = m.predict_proba(features)[0]
            result[name] = {
                "label": LABELS[idx],
                "probabilities": {LABELS[i]: round(float(p), 3) for i, p in enumerate(probs_raw)},
                "accuracy": self.metrics[name]["accuracy"],
            }
        return result

    def get_metrics(self) -> Dict[str, Dict]:
        return self.metrics

    def get_feature_importance(self) -> Dict[str, float]:
        return self.feature_importance

    # ── Internals ──────────────────────────────────────────────────────────

    def _all_artifacts_exist(self) -> bool:
        return METRICS_FILE.exists() and all(p.exists() for p in MODEL_FILES.values())

    def _load_artifacts(self) -> None:
        self.models = {name: joblib.load(p) for name, p in MODEL_FILES.items()}
        bundle = joblib.load(METRICS_FILE)
        self.metrics = bundle["metrics"]
        self.feature_importance = bundle["feature_importance"]

    def _train_and_persist(self) -> None:
        if CSV_PATH.exists():
            df = pd.read_csv(CSV_PATH)
        else:
            # Fail-safe: synthetic data so the server still boots.
            X, y = generate_dataset(n=2000, seed=42)
            df = pd.DataFrame({
                "wind": X[:, 0], "visibility": X[:, 1], "rainfall": X[:, 2], "label": y,
            })

        self.models, self.metrics, self.feature_importance = _train_all_models(df)

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        for name, m in self.models.items():
            joblib.dump(m, MODEL_FILES[name])
        joblib.dump(
            {"metrics": self.metrics, "feature_importance": self.feature_importance},
            METRICS_FILE,
        )
