#!/usr/bin/env python3
from typing import Optional
import json
import sys
from datetime import datetime
from pathlib import Path

import pymysql

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


# -----------------------------
# Helpers
# -----------------------------
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


def f_to_c(v):
    if v is None:
        return None
    return round((float(v) - 32.0) * 5.0 / 9.0, 1)


def ts_to_iso_local(ts: int) -> str:
    return datetime.fromtimestamp(int(ts)).astimezone().isoformat(timespec="seconds")


def base_payload() -> dict:
    return {
        "provider": {
            "id": "weewx-history",
            "name": "WeeWX MariaDB"
        },
        "status": {
            "ok": False,
            "partial": False,
            "stale": False,
            "message": None,
            "lastSuccess": None
        },
        "updated": None,
        "metric": "temperature",
        "unit_system_input": "US",
        "unit_system_output": "METRIC",
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
    out["status"].update({
        "ok": False,
        "stale": False,
        "message": message
    })
    return out


# -----------------------------
# DB
# -----------------------------
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
# Queries
# -----------------------------
def fetch_24h(conn, table: str, hours: int):
    sql = f"""
        SELECT
            dateTime,
            outTemp,
            appTemp,
            heatindex,
            windchill,
            outHumidity
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
            AVG(outTemp) AS outTemp_avg,
            MIN(outTemp) AS outTemp_min,
            MAX(outTemp) AS outTemp_max,
            AVG(appTemp) AS appTemp_avg,
            AVG(outHumidity) AS humidity_avg
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
            AVG(outTemp) AS outTemp_avg,
            MIN(outTemp) AS outTemp_min,
            MAX(outTemp) AS outTemp_max,
            AVG(appTemp) AS appTemp_avg,
            AVG(outHumidity) AS humidity_avg
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
            AVG(outTemp) AS outTemp_avg,
            MIN(outTemp) AS outTemp_min,
            MAX(outTemp) AS outTemp_max,
            AVG(appTemp) AS appTemp_avg,
            AVG(outHumidity) AS humidity_avg
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
            AVG(outTemp) AS outTemp_avg,
            MIN(outTemp) AS outTemp_min,
            MAX(outTemp) AS outTemp_max,
            AVG(appTemp) AS appTemp_avg,
            AVG(outHumidity) AS humidity_avg
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
def build_range_24h(rows):
    points = []
    for r in rows:
        points.append({
            "ts": int(r["dateTime"]),
            "time": ts_to_iso_local(r["dateTime"]),
            "temp_c": f_to_c(r["outTemp"]),
            "app_temp_c": f_to_c(r["appTemp"]),
            "heat_index_c": f_to_c(r["heatindex"]),
            "wind_chill_c": f_to_c(r["windchill"]),
            "humidity_pct": safe_float(r["outHumidity"], 0),
        })
    return {"points": points}


def build_range_7d(rows):
    points = []
    for r in rows:
        points.append({
            "ts": int(r["bucket_ts"]),
            "time": ts_to_iso_local(r["bucket_ts"]),
            "temp_avg_c": f_to_c(r["outTemp_avg"]),
            "temp_min_c": f_to_c(r["outTemp_min"]),
            "temp_max_c": f_to_c(r["outTemp_max"]),
            "app_temp_avg_c": f_to_c(r["appTemp_avg"]),
            "humidity_avg_pct": safe_float(r["humidity_avg"], 0),
        })
    return {"points": points}


def build_range_30d(rows):
    points = []
    for r in rows:
        points.append({
            "day": r["day_key"],
            "ts": int(r["bucket_ts"]),
            "time": ts_to_iso_local(r["bucket_ts"]),
            "temp_avg_c": f_to_c(r["outTemp_avg"]),
            "temp_min_c": f_to_c(r["outTemp_min"]),
            "temp_max_c": f_to_c(r["outTemp_max"]),
            "app_temp_avg_c": f_to_c(r["appTemp_avg"]),
            "humidity_avg_pct": safe_float(r["humidity_avg"], 0),
        })
    return {"points": points}

def build_range_1y(rows):
    points = []
    for r in rows:
        points.append({
            "day": r["day_key"],
            "ts": int(r["bucket_ts"]),
            "time": ts_to_iso_local(r["bucket_ts"]),
            "temp_avg_c": f_to_c(r["outTemp_avg"]),
            "temp_min_c": f_to_c(r["outTemp_min"]),
            "temp_max_c": f_to_c(r["outTemp_max"]),
            "app_temp_avg_c": f_to_c(r["appTemp_avg"]),
            "humidity_avg_pct": safe_float(r["humidity_avg"], 0),
        })
    return {"points": points}


def build_range_5y(rows):
    points = []
    for r in rows:
        points.append({
            "day": r["month_key"],
            "ts": int(r["bucket_ts"]),
            "time": ts_to_iso_local(r["bucket_ts"]),
            "temp_avg_c": f_to_c(r["outTemp_avg"]),
            "temp_min_c": f_to_c(r["outTemp_min"]),
            "temp_max_c": f_to_c(r["outTemp_max"]),
            "app_temp_avg_c": f_to_c(r["appTemp_avg"]),
            "humidity_avg_pct": safe_float(r["humidity_avg"], 0),
        })
    return {"points": points}

# -----------------------------
# Main
# -----------------------------
def main() -> int:
    output_path = None
    try:
        cfg = load_config()

        if not cfg.get("history", {}).get("enabled", True):
            print("history disabled")
            return 0

        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "history-temperature.json"

        db_cfg = cfg["history"]["db"]
        table = db_cfg.get("table", "archive")

        ranges_cfg = cfg["history"].get("ranges", {})
        hours_24h = int(ranges_cfg.get("temperature_24h_hours", 24))
        days_7d = int(ranges_cfg.get("temperature_7d_days", 7))
        days_30d = int(ranges_cfg.get("temperature_30d_days", 30))
        days_1y = int(ranges_cfg.get("temperature_1y_days", 365))
        years_5y = int(ranges_cfg.get("temperature_5y_years", 5))
        
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
            "24h": build_range_24h(rows_24h),
            "7d": build_range_7d(rows_7d),
            "30d": build_range_30d(rows_30d),
            "1y": build_range_1y(rows_1y),
            "5y": build_range_5y(rows_5y),
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
                public_data_dir = Path(cfg["paths"]["public_data_dir"])
                output_path = public_data_dir / "history-temperature.json"
            except Exception:
                output_path = Path("history-temperature.json")

        previous = read_json_file(output_path)
        fallback = merge_stale(previous, f"Aggiornamento storico temperatura fallito: {e}")
        write_json(output_path, fallback)
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
