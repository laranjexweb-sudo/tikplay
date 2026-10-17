"""Low-volume, privacy-safe provider usage metering for admin cost summaries."""
import os
from pathlib import Path
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import closing


def _path():
    return os.environ.get("DB_PATH") or str(Path(__file__).resolve().parents[1] / "node" / "data.db")


def record(provider, model, resource, unit, quantity, status, duration_ms=None,
           tenant_id=None, actual_cost_usd=None, provider_request_id=None, request_id=None):
    """Persist only dimensions and usage metadata; never accepts text, prompts, or credentials."""
    if status not in ("success", "failed", "timeout"):
        status = "failed"
    try:
        quantity = max(0.0, float(quantity))
        duration_ms = max(0, min(3600000, int(duration_ms))) if duration_ms is not None else None
        actual = float(actual_cost_usd) if actual_cost_usd is not None else None
        if actual is not None and actual < 0:
            actual = None
    except (TypeError, ValueError, OverflowError):
        return False
    provider = str(provider or "").strip().lower()[:40]
    resource = str(resource or "").strip().lower()[:80]
    model = str(model or "").strip()[:120]
    if not provider or not resource or unit not in ("request", "character", "token"):
        return False
    now = datetime.now(timezone.utc).isoformat()
    rid = str(request_id or uuid.uuid4())[:80]
    try:
        with closing(sqlite3.connect(_path(), timeout=5)) as conn, conn:
            conn.execute("PRAGMA busy_timeout=5000")
            rate = conn.execute("""SELECT * FROM api_cost_rates WHERE provider=? AND resource=?
                AND (model=? OR model='') AND effective_from<=?
                AND (effective_until IS NULL OR effective_until>?)
                ORDER BY CASE WHEN model=? THEN 0 ELSE 1 END,effective_from DESC,id DESC LIMIT 1""",
                (provider, resource, model, now, now, model)).fetchone()
            # rate columns: id, provider, model, resource, unit, unit_price, currency,
            # usd_brl, effective_from, effective_until, actor_id
            source, usd, brl, rate_id, fx = "unknown", None, None, None, None
            if actual is not None:
                source, usd = "actual", actual
                if rate and rate[7] and rate[7] > 0:
                    fx, rate_id, brl = rate[7], rate[0], actual * rate[7]
            elif rate:
                unit_key = {"request": "request", "character": "character", "token": "1000_tokens"}[unit]
                if rate[4] == unit_key or (unit == "character" and rate[4] == "1000_characters"):
                    divisor = 1000 if rate[4] in ("1000_characters", "1000_tokens") else 1
                    amount = quantity / divisor * rate[5]
                    source, rate_id, fx = "estimated", rate[0], rate[7]
                    if rate[6] == "USD":
                        usd = amount
                        brl = amount * fx if fx else None
                    else:
                        brl = amount
                        usd = amount / fx if fx else None
            conn.execute("""INSERT OR IGNORE INTO api_cost_usage
                (id,request_id,provider_request_id,tenant_id,provider,model,resource,unit,quantity,status,duration_ms,
                 cost_source,cost_usd,cost_brl,rate_id,fx_usd_brl,occurred_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4()), rid, str(provider_request_id or "")[:120] or None,
                 int(tenant_id) if tenant_id is not None else None, provider, model, resource, unit, quantity,
                 status, duration_ms, source, usd, brl, rate_id, fx, now))
        return True
    except (sqlite3.Error, OSError, ValueError, TypeError):
        return False
