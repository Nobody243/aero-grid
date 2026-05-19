"""
data_pipeline.py — Standalone script to fetch historical weather from
Open-Meteo Archive API for Islamabad, label each hour for drone-flight
safety, and write backend/weather_data.csv.

Run:  python data_pipeline.py
"""

import sys
from pathlib import Path

import requests
import pandas as pd

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Islamabad
LAT = 33.6844
LON = 73.0479

START_DATE = "2022-01-01"
END_DATE = "2023-12-31"

# Open-Meteo Archive (ERA5) does not expose `visibility` for this region —
# every hour is returned as null. We pull the variables that are populated
# (wind, precip, RH, temperature, dew-point) and derive a meteorologically
# plausible visibility from RH + dew-point spread + precipitation.
HOURLY_VARS = [
    "wind_speed_10m",
    "precipitation",
    "relative_humidity_2m",
    "temperature_2m",
    "dew_point_2m",
]


def derive_visibility_km(precip_mm: float, rh_pct: float, temp_c: float, dew_c: float) -> float:
    """Aviation-style visibility proxy driven by real Open-Meteo variables.

    Dew-point spread (T - Td) is the dominant fog signal: small spread = saturated
    air = fog. Precipitation lowers visibility further. High RH adds haze.
    """
    spread = max(0.0, temp_c - dew_c)
    base = min(10.0, 1.0 + spread * 1.5)               # 0 spread -> 1km, 6+ spread -> 10km
    precip_penalty = min(8.0, max(0.0, precip_mm) * 0.7)
    rh_penalty = max(0.0, (rh_pct - 80.0) * 0.15)      # haze kicks in above 80% RH
    return max(0.2, base - precip_penalty - rh_penalty)

OUT_CSV = Path(__file__).parent / "weather_data.csv"

LABEL_NAMES = {0: "Safe to Fly", 1: "Requires Altitude Drop", 2: "Grounded"}


def label_row(wind_kmh: float, vis_km: float, rain_mm: float) -> int:
    """Threshold-based label matching the original synthetic generator."""
    if wind_kmh >= 45 or vis_km < 2 or rain_mm >= 8:
        return 2  # Grounded
    if wind_kmh >= 20 or vis_km < 5 or rain_mm >= 2:
        return 1  # Requires Altitude Drop
    return 0  # Safe to Fly


def fetch_from_openmeteo() -> pd.DataFrame:
    params = {
        "latitude": LAT,
        "longitude": LON,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "Asia/Karachi",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
    }
    print(f"GET {ARCHIVE_URL}")
    print(f"  location: {LAT},{LON}  range: {START_DATE} ->{END_DATE}")
    r = requests.get(ARCHIVE_URL, params=params, timeout=90)
    r.raise_for_status()
    payload = r.json()

    hourly = payload.get("hourly")
    if not hourly:
        raise RuntimeError(f"Open-Meteo response missing 'hourly': {payload}")

    times = hourly["time"]
    wind = hourly["wind_speed_10m"]
    rain = hourly["precipitation"]
    rh = hourly["relative_humidity_2m"]
    temp = hourly["temperature_2m"]
    dew = hourly["dew_point_2m"]

    rows = []
    for w, p, h_rh, t, d in zip(wind, rain, rh, temp, dew):
        if any(x is None for x in (w, p, h_rh, t, d)):
            continue
        wind_kmh = float(w)
        rain_mm = float(p)
        vis_km = derive_visibility_km(rain_mm, float(h_rh), float(t), float(d))
        rows.append({
            "wind": round(wind_kmh, 2),
            "visibility": round(vis_km, 3),
            "rainfall": round(rain_mm, 3),
            "label": label_row(wind_kmh, vis_km, rain_mm),
        })

    if not rows:
        raise RuntimeError("Open-Meteo returned an empty dataset after cleaning nulls")

    print(f"  hours received: {len(times)}, usable rows: {len(rows)}")
    return pd.DataFrame(rows)


def fallback_synthetic() -> pd.DataFrame:
    """Fallback path — invoked only when the Open-Meteo API call fails."""
    print("Falling back to synthetic generator from weather_classifier.generate_dataset",
          file=sys.stderr)
    from weather_classifier import generate_dataset  # local import to keep fallback explicit
    X, y = generate_dataset(n=2000, seed=42)
    return pd.DataFrame({
        "wind": X[:, 0].round(2),
        "visibility": X[:, 1].round(3),
        "rainfall": X[:, 2].round(3),
        "label": y,
    })


def main() -> int:
    try:
        df = fetch_from_openmeteo()
        source = "open-meteo archive"
    except Exception as e:  # network, parse, schema — all bubble here
        print(f"ERROR: Open-Meteo request failed ->{type(e).__name__}: {e}",
              file=sys.stderr)
        df = fallback_synthetic()
        source = "synthetic fallback"

    df.to_csv(OUT_CSV, index=False)

    print(f"\nSource     : {source}")
    print(f"Rows       : {len(df)}")
    print(f"Output     : {OUT_CSV}")
    print("\nClass distribution:")
    dist = df["label"].value_counts().sort_index()
    for lbl, count in dist.items():
        pct = 100 * count / len(df)
        print(f"  {lbl} ({LABEL_NAMES[lbl]:<22}): {count:>6}  ({pct:5.2f}%)")

    print("\nFirst 5 rows:")
    print(df.head(5).to_string(index=False))
    print("\nLast 5 rows:")
    print(df.tail(5).to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
