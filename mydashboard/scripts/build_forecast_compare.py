#!/usr/bin/env python3
from typing import Optional
import json
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_json(path: Path) -> Optional[dict]:
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


def provider_placeholder(provider_id: str, provider_name: str, message: str) -> dict:
    return {
        "provider": {"id": provider_id, "name": provider_name},
        "status": {
            "ok": False,
            "partial": False,
            "stale": False,
            "hasHourly": False,
            "hasParts": False,
            "hasDaily": False,
            "message": message,
            "lastSuccess": None,
        },
        "updated": None,
        "location": {},
        "summary": {"text": None, "icon": None, "tempTrend": None},
        "hourly": [],
        "parts": [],
        "daily": [],
        "astronomy": {},
    }


def normalize_provider(data: Optional[dict], provider_id: str, provider_name: str) -> dict:
    if not data or not isinstance(data, dict):
        return provider_placeholder(provider_id, provider_name, "File provider mancante o non valido")

    data.setdefault("provider", {"id": provider_id, "name": provider_name})
    data.setdefault("status", {})
    status = data["status"]

    has_hourly = bool(data.get("hourly"))
    has_parts = bool(data.get("parts"))
    has_daily = bool(data.get("daily"))
    ok = bool(has_hourly or has_parts or has_daily)

    status.setdefault("ok", ok)
    status.setdefault("partial", not (has_hourly and has_parts and has_daily))
    status.setdefault("stale", False)
    status["hasHourly"] = has_hourly
    status["hasParts"] = has_parts
    status["hasDaily"] = has_daily
    status.setdefault("message", None)
    status.setdefault("lastSuccess", data.get("updated"))

    data.setdefault("updated", None)
    data.setdefault("location", {})
    data.setdefault("summary", {"text": None, "icon": None, "tempTrend": None})
    data.setdefault("hourly", [])
    data.setdefault("parts", [])
    data.setdefault("daily", [])
    data.setdefault("astronomy", {})
    return data


def main() -> int:
    try:
        cfg = load_config()
        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        pws_path = public_data_dir / "forecast-pws.json"
        wu_path = public_data_dir / "forecast-wu.json"
        out_path = public_data_dir / "forecast-compare.json"

        pws = normalize_provider(read_json(pws_path), "pws", "PWSWeather / Xweather")
        wu = normalize_provider(read_json(wu_path), "wu", "Weather Underground")

        compare = {
            "updated": now_iso(),
            "providers": [pws, wu],
            "compareStatus": {
                "hasAnyData": bool(pws["status"].get("ok") or wu["status"].get("ok")),
                "hasBothProviders": bool(pws["status"].get("ok") and wu["status"].get("ok")),
                "hasHourlyAny": bool(pws["status"].get("hasHourly") or wu["status"].get("hasHourly")),
                "hasHourlyBoth": bool(pws["status"].get("hasHourly") and wu["status"].get("hasHourly")),
                "hasDailyAny": bool(pws["status"].get("hasDaily") or wu["status"].get("hasDaily")),
                "hasDailyBoth": bool(pws["status"].get("hasDaily") and wu["status"].get("hasDaily")),
                "hasPartsAny": bool(pws["status"].get("hasParts") or wu["status"].get("hasParts")),
                "hasPartsBoth": bool(pws["status"].get("hasParts") and wu["status"].get("hasParts")),
            },
        }
        write_json(out_path, compare)
        print(f"OK scritto {out_path}")
        return 0
    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
