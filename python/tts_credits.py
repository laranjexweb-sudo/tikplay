"""Atomic credit wallet debits for paid, admin-managed chat voice synthesis."""
import math
import os
from pathlib import Path
import sqlite3
import uuid
from contextlib import contextmanager


@contextmanager
def _connect():
    path = os.environ.get("DB_PATH") or str(Path(__file__).resolve().parents[1] / "node" / "data.db")
    conn = sqlite3.connect(path, timeout=5)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def cost_for(model_id, character_count):
    if character_count <= 0:
        return None, "EMPTY_TEXT"
    try:
        with _connect() as conn:
            row = conn.execute("""SELECT credits_per_150_chars FROM additional_voice_models
                WHERE model_id=? AND enabled=1""", (model_id,)).fetchone()
        rate = int(row[0]) if row else 0
        if rate <= 0:
            return None, "COST_NOT_CONFIGURED"
        return max(1, math.ceil(character_count * rate / 150)), "OK"
    except sqlite3.OperationalError:
        return None, "NOT_AVAILABLE"


def charge(tenant_id, model_id, character_count):
    """Debit rounded whole TikCoins using each model's tariff per 150 characters."""
    cost, code = cost_for(model_id, character_count)
    if code != "OK":
        return None, code
    request_id = str(uuid.uuid4())
    try:
        with _connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("INSERT OR IGNORE INTO tts_credit_wallets(tenant_id,balance) VALUES(?,0)", (tenant_id,))
            row = conn.execute("SELECT balance FROM tts_credit_wallets WHERE tenant_id=?", (tenant_id,)).fetchone()
            balance = int(row[0]) if row else 0
            if balance < cost:
                return None, "INSUFFICIENT_CREDITS"
            updated = conn.execute("""UPDATE tts_credit_wallets SET balance=balance-?,updated_at=CURRENT_TIMESTAMP
                WHERE tenant_id=? AND balance>=?""", (cost, tenant_id, cost)).rowcount
            if not updated:
                return None, "INSUFFICIENT_CREDITS"
            conn.execute("""INSERT INTO tts_credit_ledger(tenant_id,amount,kind,idempotency_key,model_id,unit_count,reference_id)
                VALUES(?,?,'usage',?,?,?,?)""", (tenant_id, -cost, f"tts:{request_id}", model_id, character_count, request_id))
        return cost, "CHARGED"
    except sqlite3.OperationalError:
        return None, "NOT_AVAILABLE"
