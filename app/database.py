"""SQLite persistence for the shared team-memory demo."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(__file__).resolve().parent / "team_memory.db"
SHARED_CONTEXT_JSON = Path(__file__).resolve().parent / "data" / "data.json"

DEMO_TEAM_ID = "team-northstar"
DEMO_TEAM_NAME = "Northstar Consulting"
# These are intentionally demo-only credentials. Passwords are never returned from the API.
DEMO_USERS = (
    ("john", "John", "john@northstar.consulting", "Northstar-John-2026!", "admin"),
    ("mary", "Mary", "mary@northstar.consulting", "Northstar-Mary-2026!", "member"),
    ("bob", "Bob", "bob@northstar.consulting", "Northstar-Bob-2026!", "member"),
)

USER_NAME_TO_ID = {name: user_id for user_id, name, *_ in DEMO_USERS}

DEFAULT_TEAM_SYSTEM_PROMPT = (
    "Help Northstar Consulting users with careful, useful research and delivery guidance. "
    "Follow the team-managed tools, skills, documents, and templates when they are relevant."
)


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Create a portable, salted PBKDF2 hash without adding a demo dependency."""
    actual_salt = salt or secrets.token_bytes(16)
    iterations = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), actual_salt, iterations)
    return f"pbkdf2_sha256${iterations}${actual_salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hash_password(password, bytes.fromhex(salt_hex)).split("$", 3)[3]
        return hmac.compare_digest(candidate, digest_hex)
    except (TypeError, ValueError):
        return False


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def normalize_source_user_id(value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    stripped = value.strip()
    return USER_NAME_TO_ID.get(stripped, stripped.lower())


def load_shared_context_json() -> list[dict[str, Any]]:
    if not SHARED_CONTEXT_JSON.exists():
        return []
    with SHARED_CONTEXT_JSON.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError(f"{SHARED_CONTEXT_JSON} must contain a JSON array of shared-context records.")
    records: list[dict[str, Any]] = []
    for row in payload:
        source_record_ids = row.get("source_record_ids") or []
        records.append(
            {
                "id": row["id"],
                "team_id": DEMO_TEAM_ID,
                "type": row["type"],
                "content": row["content"],
                "source_user_id": normalize_source_user_id(row.get("source_user_id")),
                "artifact_type": row.get("artifact_type") or None,
                "source_record_ids_json": json.dumps(source_record_ids),
                "created_at": row["created_at"],
            }
        )
    return records


def seed_shared_context(db: sqlite3.Connection) -> None:
    """Load canonical shared-context records from JSON when the table is empty."""
    if db.execute("SELECT 1 FROM shared_context_records WHERE team_id = ? LIMIT 1", (DEMO_TEAM_ID,)).fetchone():
        return
    records = load_shared_context_json()
    if not records:
        return
    db.executemany(
        """INSERT INTO shared_context_records
           (id, team_id, type, content, source_user_id, artifact_type, source_record_ids_json, created_at)
           VALUES (:id, :team_id, :type, :content, :source_user_id, :artifact_type, :source_record_ids_json, :created_at)""",
        records,
    )


def migrate_legacy_schema(db: sqlite3.Connection) -> None:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "context_items" in tables or "artifacts" in tables:
        db.executescript(
            """
            DROP TABLE IF EXISTS activity_events;
            DROP TABLE IF EXISTS artifacts;
            DROP TABLE IF EXISTS context_items;
            """
        )
        tables -= {"activity_events", "artifacts", "context_items"}
    if "activity_events" in tables:
        columns = {row[1] for row in db.execute("PRAGMA table_info(activity_events)")}
        if "record_id" not in columns:
            db.execute("DROP TABLE activity_events")


def initialize() -> None:
    """Create the schema and a stable consulting-team demo dataset once."""
    with connect() as db:
        migrate_legacy_schema(db)
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT,
                role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member'))
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                user_id TEXT NOT NULL REFERENCES users(id),
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id),
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shared_context_records (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                type TEXT NOT NULL CHECK(type IN ('chat', 'artifact')),
                content TEXT NOT NULL,
                source_user_id TEXT REFERENCES users(id),
                artifact_type TEXT,
                source_record_ids_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_sessions (
                team_id TEXT NOT NULL REFERENCES teams(id),
                user_id TEXT NOT NULL REFERENCES users(id),
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (team_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS activity_events (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                record_id TEXT NOT NULL REFERENCES shared_context_records(id),
                action TEXT NOT NULL,
                summary TEXT NOT NULL,
                occurred_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS authentication_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                team_id TEXT NOT NULL REFERENCES teams(id),
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT
            );
            CREATE TABLE IF NOT EXISTS agent_configurations (
                team_id TEXT PRIMARY KEY REFERENCES teams(id),
                system_prompt TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS agent_configuration_entries (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                kind TEXT NOT NULL CHECK(kind IN ('tool', 'mcp_server', 'skill', 'markdown', 'prompt_template')),
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS shared_context_team_time ON shared_context_records(team_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS shared_context_team_type ON shared_context_records(team_id, type, created_at DESC);
            CREATE INDEX IF NOT EXISTS activity_team_time ON activity_events(team_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS messages_conversation_keyset ON messages(conversation_id, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS auth_sessions_active ON authentication_sessions(id, expires_at, revoked_at);
            CREATE INDEX IF NOT EXISTS agent_config_entries_team ON agent_configuration_entries(team_id, updated_at DESC);
            """
        )

        user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        if "password_hash" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "role" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")

        db.execute("INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)", (DEMO_TEAM_ID, DEMO_TEAM_NAME))
        db.execute("UPDATE teams SET name = ? WHERE id = ?", (DEMO_TEAM_NAME, DEMO_TEAM_ID))
        for user_id, name, email, password, role in DEMO_USERS:
            db.execute(
                """INSERT INTO users (id, team_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, name = excluded.name,
                       email = excluded.email, password_hash = excluded.password_hash, role = excluded.role""",
                (user_id, DEMO_TEAM_ID, name, email, hash_password(password), role),
            )

        existing_user_ids = {row["id"] for row in db.execute("SELECT id FROM users WHERE team_id = ?", (DEMO_TEAM_ID,))}
        remaps = (("person-a", "john"), ("person-b", "mary"))
        for old_id, new_id in remaps:
            if old_id in existing_user_ids:
                db.execute("UPDATE conversations SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("UPDATE shared_context_records SET source_user_id = ? WHERE source_user_id = ?", (new_id, old_id))
                db.execute("UPDATE user_sessions SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("UPDATE authentication_sessions SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("DELETE FROM users WHERE id = ?", (old_id,))
                existing_user_ids.remove(old_id)
                existing_user_ids.add(new_id)

        allowed_ids = tuple(user[0] for user in DEMO_USERS)
        markers = ", ".join("?" for _ in allowed_ids)
        db.execute(f"DELETE FROM users WHERE team_id = ? AND id NOT IN ({markers})", (DEMO_TEAM_ID, *allowed_ids))

        db.execute(
            """INSERT OR IGNORE INTO agent_configurations (team_id, system_prompt, updated_at, updated_by)
               VALUES (?, ?, ?, ?)""",
            (DEMO_TEAM_ID, DEFAULT_TEAM_SYSTEM_PROMPT, "2026-08-29T00:00:00Z", "john"),
        )

        seed_shared_context(db)
        db.commit()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None
