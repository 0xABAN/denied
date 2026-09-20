"""Every judgment and actual removal in Tiger; classification remains server-owned."""

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
from uuid import NAMESPACE_OID, uuid4, uuid5

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import AwareDatetime, Field

from .schemas import Batch, Decision, Host, Identifier, Judgments, StrictModel


class Claim(StrictModel):
    document_id: Identifier
    page_host: Host
    page_scheme: str
    decision: Decision
    text_hash: str
    issued_at: int
    judge_ms: int
    policy_version: str
    model_version: str
    ad_threshold: float
    safety_threshold: float


class Passage(StrictModel):
    receipt: str = Field(max_length=4096)
    text: str = Field(max_length=24000)


class Removal(StrictModel):
    document_id: Identifier
    target_id: Identifier
    revision: int = Field(ge=1)
    removed_text: str = Field(max_length=24000)
    text_truncated: bool
    date: AwareDatetime
    total_ms: int = Field(ge=0, le=86_400_000)
    passages: list[Passage] = Field(min_length=1, max_length=20)


def configured() -> bool:
    return bool(os.environ.get("PGHOST") or os.environ.get("TIGER_DATABASE_URL") or os.environ.get("TIMESCALE_SERVICE_URL"))


def schema_name() -> str:
    name = os.environ.get("DENIED_DB_SCHEMA", "denied")
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", name):
        raise ValueError("Invalid database schema name")
    return name


def table(name: str = "removals") -> sql.Identifier:
    return sql.Identifier(schema_name(), name)


def connect():
    """Prefer native PG_* settings; require TLS and bound connection/query time."""
    dsn = "" if os.environ.get("PGHOST") else os.environ.get("TIGER_DATABASE_URL") or os.environ.get("TIMESCALE_SERVICE_URL", "")
    sslmode = os.environ.get("PGSSLMODE", "require")
    if sslmode not in ("require", "verify-ca", "verify-full"):
        raise ValueError("Tiger connections require TLS")
    return psycopg.connect(dsn, sslmode=sslmode, connect_timeout=3,
                           options="-c statement_timeout=3000 -c timezone=UTC", row_factory=dict_row)


def initialize() -> None:
    with connect() as connection:
        connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema_name())))
        statement = Path(__file__).resolve().parents[1].joinpath("schema.sql").read_text()
        connection.execute(sql.SQL(statement).format(
            table=table(), judgments=table("judgments"), schema=sql.Literal(schema_name()),
        ))


def _signature(payload: bytes, key: str) -> str:
    return hmac.new(key.encode(), b"denied-removal-v1\0" + payload, hashlib.sha256).hexdigest()


def prepare_judgments(batch: Batch, judgments: Judgments, key: str, judge_ms: int,
                      ad_threshold: float, safety_threshold: float, model_version: str) -> list[dict]:
    """Prepare every passage for storage and attach removal receipts only to positives."""
    date = datetime.now(timezone.utc)
    batch_id = uuid4()
    rows = []
    for candidate, decision in zip(batch.candidates, judgments.results):
        rows.append({
            "batch_id": batch_id, "candidate_id": candidate.id, "document_id": batch.document_id,
            "target_id": candidate.id.rsplit(":", 1)[0], "revision": candidate.revision, "date": date,
            "page_host": batch.page_host, "page_scheme": batch.page_scheme,
            "text": candidate.text, "links": [link.model_dump() for link in candidate.links], "ad": candidate.ad.model_dump(),
            "ad_score": decision.ad_score, "unsafe_score": decision.unsafe_score,
            "violent_entity_score": decision.violent_entity_score,
            "decision": "remove" if decision.remove else "keep", "reasons": decision.reasons,
            "ad_threshold": ad_threshold, "safety_threshold": safety_threshold,
            "policy_version": judgments.policy_version, "model_version": model_version, "judge_ms": judge_ms,
        })
        if decision.remove:
            # issued_at is only an internal capability expiry marker, never a stored date field.
            claim = Claim(document_id=batch.document_id, page_host=batch.page_host, page_scheme=batch.page_scheme,
                          decision=decision.model_copy(deep=True), text_hash=hashlib.sha256(candidate.text.encode()).hexdigest(),
                          issued_at=int(date.timestamp()), judge_ms=judge_ms, policy_version=judgments.policy_version,
                          model_version=model_version, ad_threshold=ad_threshold, safety_threshold=safety_threshold)
            payload = claim.model_dump_json().encode()
            decision.receipt = base64.urlsafe_b64encode(payload).decode() + "." + _signature(payload, key)
    return rows


def _insert_statement(name: str, row: dict) -> sql.Composed:
    return sql.SQL("INSERT INTO {table} ({columns}) VALUES ({values}) ON CONFLICT DO NOTHING").format(
        table=table(name), columns=sql.SQL(",").join(map(sql.Identifier, row)),
        values=sql.SQL(",").join(sql.Placeholder(column) for column in row),
    )


def insert_judgments(rows: list[dict]) -> None:
    with connect() as connection, connection.cursor() as cursor:
        cursor.executemany(_insert_statement("judgments", rows[0]),
                           ({**row, "links": Jsonb(row["links"]), "ad": Jsonb(row["ad"])} for row in rows))


def removal_row(item: Removal, key: str) -> dict:
    """Authenticate passages and bind them to one target/revision; the database deduplicates retries."""
    claims = []
    seen = set()
    for passage in item.passages:
        encoded, signature = passage.receipt.rsplit(".", 1)
        payload = base64.b64decode(encoded, altchars=b"-_", validate=True)
        if not hmac.compare_digest(signature.encode(), _signature(payload, key).encode()):
            raise ValueError("Invalid receipt")
        claim = Claim.model_validate_json(payload)
        age = datetime.now(timezone.utc).timestamp() - claim.issued_at
        target = claim.decision.id.rsplit(":", 1)[0]
        if (not 0 <= age <= 900 or not claim.decision.remove or
                claim.document_id != item.document_id or target != item.target_id or claim.decision.revision != item.revision or
                hashlib.sha256(passage.text.encode()).hexdigest() != claim.text_hash or passage.text not in item.removed_text or
                claim.decision.id in seen):
            raise ValueError("Receipt does not match removal")
        if claims and (claim.page_host, claim.page_scheme) != (claims[0].page_host, claims[0].page_scheme):
            raise ValueError("Mixed page contexts")
        seen.add(claim.decision.id)
        claims.append(claim)

    # The browser supplies the removed text/times; it cannot supply or change model scores.
    row = item.model_dump(exclude={"passages"})
    row.update(
        event_id=uuid5(NAMESPACE_OID, json.dumps([item.document_id, item.target_id, item.revision])),
        page_host=claims[0].page_host, page_scheme=claims[0].page_scheme,
        reasons=sorted({reason for claim in claims for reason in claim.decision.reasons}),
        judge_ms=max(claim.judge_ms for claim in claims),
        classifications=[{
            **claim.decision.model_dump(exclude={"receipt", "remove"}), "text": passage.text,
            "ad_threshold": claim.ad_threshold, "safety_threshold": claim.safety_threshold,
        } for claim, passage in zip(claims, item.passages)],
    )
    return row


def insert(row: dict) -> None:
    values = {**row, "classifications": Jsonb(row["classifications"])}
    with connect() as connection:
        connection.execute(_insert_statement("removals", values), values)


def recent(limit: int) -> list[dict]:
    with connect() as connection:
        return connection.execute(sql.SQL("SELECT * FROM {} ORDER BY date DESC LIMIT %s").format(table()), (limit,)).fetchall()


def recent_judgments(limit: int, decision: str | None) -> list[dict]:
    with connect() as connection:
        return connection.execute(sql.SQL("""
            SELECT * FROM {} WHERE (%s::text IS NULL OR decision = %s)
            ORDER BY date DESC LIMIT %s
        """).format(table("judgments")), (decision, decision, limit)).fetchall()


def metrics() -> dict:
    with connect() as connection:
        counts = connection.execute(sql.SQL("""
            SELECT count(*) AS total_removals,
                   count(*) FILTER (WHERE 'advertising' = ANY(reasons)) AS advertising,
                   count(*) FILTER (WHERE 'unsafe_content' = ANY(reasons)) AS unsafe_content,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY judge_ms) AS median_judge_ms,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS median_total_ms
            FROM {}
        """).format(table())).fetchone()
        counts.update(connection.execute(sql.SQL("""
            SELECT count(*) AS total_judgments,
                   count(*) FILTER (WHERE decision = 'keep') AS kept,
                   count(*) FILTER (WHERE decision = 'remove') AS flagged
            FROM {}
        """).format(table("judgments"))).fetchone())
        return counts
