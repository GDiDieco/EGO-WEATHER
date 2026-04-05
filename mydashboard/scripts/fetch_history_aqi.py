#!/usr/bin/env python3
from typing import Optional
import json
import sys
from datetime import datetime
from pathlib import Path

import pymysql

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_json_file(path: Path) -> Optional[dict]:
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def safe_float(v, digits=1):
    if v is None:
        return None
    try:
        return round(float(v), digits)
    except Exception:
        return None


def ts_to_iso_local(ts: int) -> str:
    return datetime.fromtimestamp(int(ts)).astimezone().isoformat(timespec="seconds")


def base_payload() -> dict:
    return {
        "provider": {"id": "weewx-history", "name": "WeeWX MariaDB"},
        "status": {"ok": False, "partial": False, "stale": False, "message": None, "lastSuccess": None},
        "updated": None,
        "metric": "aqi",
        "unit_system_input": "MIXED",
        "unit_system_output": "AQI",
        "ranges": {}
    }


def merge_stale(existing: Optional[dict], message: str) -> dict:
    if existing and isinstance(existing, dict):
        out = existing
        out.setdefault("status", {})
        out["status"].update({
            "ok": True,
            "stale": True,
            "message": message,
            "lastSuccess": out.get("updated") or out.get("status", {}).get("lastSuccess")
        })
        return out
    out = base_payload()
    out["status"].update({"ok": False, "stale": False, "message": message})
    return out


def get_conn(cfg: dict):
    db = cfg["history"]["db"]
    return pymysql.connect(
        host=db["host"],
        port=int(db.get("port", 3306)),
        user=db["user"],
        password=db["password"],
        database=db["name"],
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


# -----------------------------
# AQI helpers
# -----------------------------
def calc_subindex(c, breakpoints):
    if c is None:
        return None
    for bp_lo, bp_hi, i_lo, i_hi in breakpoints:
        if bp_lo <= c <= bp_hi:
            return round(((i_hi - i_lo) / (bp_hi - bp_lo)) * (c - bp_lo) + i_lo)
    # oltre il massimo breakpoint
    bp_lo, bp_hi, i_lo, i_hi = breakpoints[-1]
    if c > bp_hi:
        return round(((i_hi - i_lo) / (bp_hi - bp_lo)) * (c - bp_lo) + i_lo)
    return None


def pm25_aqi(pm25):
    if pm25 is None:
        return None
    c = float(pm25)
    breakpoints = [
        (0.0, 12.0, 0, 50),
        (12.1, 35.4, 51, 100),
        (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200),
        (150.5, 250.4, 201, 300),
        (250.5, 350.4, 301, 400),
        (350.5, 500.4, 401, 500),
    ]
    return calc_subindex(c, breakpoints)


def pm10_aqi(pm10):
    if pm10 is None:
        return None
    c = float(pm10)
    breakpoints = [
        (0, 54, 0, 50),
        (55, 154, 51, 100),
        (155, 254, 101, 150),
        (255, 354, 151, 200),
        (355, 424, 201, 300),
        (425, 504, 301, 400),
        (505, 604, 401, 500),
    ]
    return calc_subindex(c, breakpoints)


def overall_aqi(pm25, pm10):
    aqi25 = pm25_aqi(pm25)
    aqi10 = pm10_aqi(pm10)
    vals = [v for v in (aqi25, aqi10) if v is not None]
    return max(vals) if vals else None


# -----------------------------
# Queries
# -----------------------------
def fetch_24h(conn, table: str, hours: int):
    sql = f"""
        SELECT
            dateTime,
            pm1_0,
            pm2_5,
            pm10_0
        FROM {table}
        WHERE dateTime >= UNIX_TIMESTAMP() - (%s * 3600)
        ORDER BY dateTime ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (hours,))
        return cur.fetchall()


def fetch_7d(conn, table: str, days: int):
    sql = f"""
        SELECT
            FLOOR(dateTime / 3600) * 3600 AS bucket_ts,
            AVG(pm1_0) AS pm1_avg,
            AVG(pm2_5) AS pm25_avg,
            AVG(pm10_0) AS pm10_avg
        FROM {table}
        WHERE dateTime >= UNIX_TIMESTAMP() - (%s * 86400)
        GROUP BY FLOOR(dateTime / 3600)
        ORDER BY bucket_ts ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (days,))
        return cur.fetchall()


def fetch_30d(conn, table: str, days: int):
    sql = f"""
        SELECT
            FROM_UNIXTIME(dateTime, '%%Y-%%m-%%d') AS day_key,
            MIN(dateTime) AS bucket_ts,
            AVG(pm1_0) AS pm1_avg,
            AVG(pm2_5) AS pm25_avg,
            AVG(pm10_0) AS pm10_avg
        FROM {table}
        WHERE dateTime >= UNIX_TIMESTAMP() - (%s * 86400)
        GROUP BY FROM_UNIXTIME(dateTime, '%%Y-%%m-%%d')
        ORDER BY bucket_ts ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (days,))
        return cur.fetchall()


def fetch_1y(conn, table: str, days: int):
    sql = f"""
        SELECT
            FROM_UNIXTIME(dateTime, '%%Y-%%m-%%d') AS day_key,
            MIN(dateTime) AS bucket_ts,
            AVG(pm1_0) AS pm1_avg,
            AVG(pm2_5) AS pm25_avg,
            AVG(pm10_0) AS pm10_avg
        FROM {table}
        WHERE dateTime >= UNIX_TIMESTAMP() - (%s * 86400)
        GROUP BY FROM_UNIXTIME(dateTime, '%%Y-%%m-%%d')
        ORDER BY bucket_ts ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (days,))
        return cur.fetchall()


def fetch_5y(conn, table: str, years: int):
    sql = f"""
        SELECT
            FROM_UNIXTIME(dateTime, '%%Y-%%m') AS month_key,
            MIN(dateTime) AS bucket_ts,
            AVG(pm1_0) AS pm1_avg,
            AVG(pm2_5) AS pm25_avg,
            AVG(pm10_0) AS pm10_avg
        FROM {table}
        WHERE dateTime >= UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL %s YEAR))
        GROUP BY FROM_UNIXTIME(dateTime, '%%Y-%%m')
        ORDER BY bucket_ts ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (years,))
        return cur.fetchall()


# -----------------------------
# Builders
# -----------------------------
def build_24h(rows):
    points = []
    for r in rows:
        pm1 = safe_float(r["pm1_0"], 1)
        pm25 = safe_float(r["pm2_5"], 1)
        pm10 = safe_float(r["pm10_0"], 1)
        points.append({
            "ts": int(r["dateTime"]),
            "time": ts_to_iso_local(r["dateTime"]),
            "pm1": pm1,
            "pm25": pm25,
            "pm10": pm10,
            "aqi": overall_aqi(pm25, pm10),
        })
    return {"points": points}


def build_agg(rows, label_key=None):
    points = []
    for r in rows:
        pm1 = safe_float(r["pm1_avg"], 1)
        pm25 = safe_float(r["pm25_avg"], 1)
        pm10 = safe_float(r["pm10_avg"], 1)
        item = {
            "ts": int(r["bucket_ts"]),
            "time": ts_to_iso_local(r["bucket_ts"]),
            "pm1": pm1,
            "pm25": pm25,
            "pm10": pm10,
            "aqi": overall_aqi(pm25, pm10),
        }
        if label_key:
            item["day"] = r[label_key]
        points.append(item)
    return {"points": points}


# -----------------------------
# Main
# -----------------------------
def main() -> int:
    output_path = None
    try:
        cfg = load_config()
        if not cfg.get("history", {}).get("enabled", True):
            return 0

        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "history-aqi.json"

        table = cfg["history"]["db"].get("table", "archive")
        ranges_cfg = cfg["history"].get("ranges", {})

        hours_24h = int(ranges_cfg.get("aqi_24h_hours", 24))
        days_7d = int(ranges_cfg.get("aqi_7d_days", 7))
        days_30d = int(ranges_cfg.get("aqi_30d_days", 30))
        days_1y = int(ranges_cfg.get("aqi_1y_days", 365))
        years_5y = int(ranges_cfg.get("aqi_5y_years", 5))

        conn = get_conn(cfg)
        try:
            rows_24h = fetch_24h(conn, table, hours_24h)
            rows_7d = fetch_7d(conn, table, days_7d)
            rows_30d = fetch_30d(conn, table, days_30d)
            rows_1y = fetch_1y(conn, table, days_1y)
            rows_5y = fetch_5y(conn, table, years_5y)
        finally:
            conn.close()

        payload = base_payload()
        payload["updated"] = now_iso()
        payload["ranges"] = {
            "24h": build_24h(rows_24h),
            "7d": build_agg(rows_7d),
            "30d": build_agg(rows_30d, label_key="day_key"),
            "1y": build_agg(rows_1y, label_key="day_key"),
            "5y": build_agg(rows_5y, label_key="month_key"),
        }
        payload["status"].update({
            "ok": True,
            "partial": False,
            "stale": False,
            "message": None,
            "lastSuccess": payload["updated"],
        })

        write_json(output_path, payload)
        print(f"OK scritto {output_path}")
        return 0

    except Exception as e:
        if output_path is None:
            try:
                cfg = load_config()
                output_path = Path(cfg["paths"]["public_data_dir"]) / "history-aqi.json"
            except Exception:
                output_path = Path("history-aqi.json")

        previous = read_json_file(output_path)
        fallback = merge_stale(previous, f"Aggiornamento storico AQI fallito: {e}")
        write_json(output_path, fallback)
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
