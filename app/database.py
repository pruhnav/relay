"""Small SQLite persistence layer for the shared team-memory demo."""

from __future__ import annotations

import json
import hashlib
import hmac
import secrets
import sqlite3
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(__file__).resolve().parent / "team_memory.db"

DEMO_TEAM_ID = "team-northstar"
DEMO_TEAM_NAME = "Northstar Consulting"
# These are intentionally demo-only credentials. Passwords are never returned from the API.
DEMO_USERS = (
    ("john", "John", "john@northstar.consulting", "Northstar-John-2026!", "admin"),
    ("mary", "Mary", "mary@northstar.consulting", "Northstar-Mary-2026!", "member"),
    ("bob", "Bob", "bob@northstar.consulting", "Northstar-Bob-2026!", "member"),
)

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


def initialize() -> None:
    """Create the schema and a stable consulting-team demo dataset once."""
    with connect() as db:
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
            CREATE TABLE IF NOT EXISTS context_items (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                author_id TEXT NOT NULL REFERENCES users(id),
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                files_json TEXT NOT NULL DEFAULT '[]',
                endpoint TEXT,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL REFERENCES teams(id),
                context_item_id TEXT NOT NULL REFERENCES context_items(id),
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT,
                url TEXT,
                files_json TEXT NOT NULL DEFAULT '[]',
                commit_sha TEXT,
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
                context_item_id TEXT NOT NULL REFERENCES context_items(id),
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
            CREATE INDEX IF NOT EXISTS context_team_updated ON context_items(team_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS activity_team_time ON activity_events(team_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS messages_conversation_keyset ON messages(conversation_id, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS artifacts_context ON artifacts(context_item_id);
            CREATE INDEX IF NOT EXISTS auth_sessions_active ON authentication_sessions(id, expires_at, revoked_at);
            CREATE INDEX IF NOT EXISTS agent_config_entries_team ON agent_configuration_entries(team_id, updated_at DESC);
            """
        )

        # Keep development data forward-compatible when a previous local run created v1.0 tables.
        existing_columns = {row[1] for row in db.execute("PRAGMA table_info(context_items)")}
        for column, definition in (
            ("related_commit", "TEXT"),
            ("source_type", "TEXT NOT NULL DEFAULT 'manual'"),
            ("source_reference", "TEXT NOT NULL DEFAULT ''"),
            ("artifact_ids_json", "TEXT NOT NULL DEFAULT '[]'"),
        ):
            if column not in existing_columns:
                db.execute(f"ALTER TABLE context_items ADD COLUMN {column} {definition}")

        user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        if "password_hash" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "role" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")

        db.execute("INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)", (DEMO_TEAM_ID, DEMO_TEAM_NAME))
        db.execute("UPDATE teams SET name = ? WHERE id = ?", (DEMO_TEAM_NAME, DEMO_TEAM_ID))
        # Insert the canonical users before remapping foreign keys from the former demo IDs.
        for user_id, name, email, password, role in DEMO_USERS:
            db.execute(
                """INSERT INTO users (id, team_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, name = excluded.name,
                       email = excluded.email, password_hash = excluded.password_hash, role = excluded.role""",
                (user_id, DEMO_TEAM_ID, name, email, hash_password(password), role),
            )

        # Migrate the earlier Person A / Person B local demo into the named team accounts.
        # This preserves existing sample conversations and artifacts while making the roster exact.
        existing_user_ids = {row["id"] for row in db.execute("SELECT id FROM users WHERE team_id = ?", (DEMO_TEAM_ID,))}
        remaps = (("person-a", "john"), ("person-b", "mary"))
        for old_id, new_id in remaps:
            if old_id in existing_user_ids:
                db.execute("UPDATE conversations SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("UPDATE context_items SET author_id = ? WHERE author_id = ?", (new_id, old_id))
                db.execute("UPDATE user_sessions SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("UPDATE authentication_sessions SET user_id = ? WHERE user_id = ?", (new_id, old_id))
                db.execute("DELETE FROM users WHERE id = ?", (old_id,))
                existing_user_ids.remove(old_id)
                existing_user_ids.add(new_id)

        # Ensure no legacy demo identities remain visible in the single demo team.
        allowed_ids = tuple(user[0] for user in DEMO_USERS)
        markers = ", ".join("?" for _ in allowed_ids)
        db.execute(f"DELETE FROM users WHERE team_id = ? AND id NOT IN ({markers})", (DEMO_TEAM_ID, *allowed_ids))

        # Team configuration is deliberately independent from a browser session. Every completion
        # reads this shared record and its entries from SQLite, so an administrator's save affects
        # John, Mary, Bob, and future team members on their next request.
        db.execute(
            """INSERT OR IGNORE INTO agent_configurations (team_id, system_prompt, updated_at, updated_by)
               VALUES (?, ?, ?, ?)""",
            (DEMO_TEAM_ID, DEFAULT_TEAM_SYSTEM_PROMPT, "2026-08-29T00:00:00Z", "john"),
        )

        if db.execute("SELECT 1 FROM conversations WHERE team_id = ?", (DEMO_TEAM_ID,)).fetchone():
            db.execute("UPDATE activity_events SET summary = REPLACE(summary, 'Person A', 'John') WHERE team_id = ?", (DEMO_TEAM_ID,))
            db.commit()
            return

        db.executemany(
            "INSERT INTO conversations (id, team_id, user_id, title, created_at) VALUES (?, ?, ?, ?, ?)",
            [
                ("conversation-john", DEMO_TEAM_ID, "john", "Authentication work", "2026-08-27T15:10:00Z"),
                ("conversation-mary", DEMO_TEAM_ID, "mary", "Client portal research", "2026-08-28T09:00:00Z"),
            ],
        )
        item = (
            "google-authentication",
            DEMO_TEAM_ID,
            "john",
            "feature",
            "Google Authentication",
            "Backend Google OAuth authentication flow is implemented for the client portal. Frontend teams can begin integration using the documented callback route.",
            "complete",
            json.dumps(["app/auth.py", "app/routes.py", "docs/google-oauth-handoff.md"]),
            "/auth/google",
            "Commit abc123 · John implementation handoff",
            "2026-08-27T15:20:00Z",
            "2026-08-27T16:42:00Z",
        )
        db.execute(
            """INSERT INTO context_items
            (id, team_id, author_id, type, title, description, status, files_json, endpoint, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            item,
        )
        db.execute(
            """INSERT INTO artifacts
            (id, team_id, context_item_id, kind, title, content, url, files_json, commit_sha, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("artifact-google-auth-handoff", DEMO_TEAM_ID, "google-authentication", "implementation",
             "Google OAuth backend handoff", "Google OAuth backend flow, callback route, and integration notes.", None,
             json.dumps(["app/auth.py", "app/routes.py", "docs/google-oauth-handoff.md"]), "abc123", "2026-08-27T16:42:00Z"),
        )
        db.execute("UPDATE context_items SET related_commit = ?, source_type = ?, source_reference = ?, artifact_ids_json = ? WHERE id = ?",
                   ("abc123", "agent_task", "Google authentication implementation handoff", json.dumps(["artifact-google-auth-handoff"]), "google-authentication"))
        db.execute(
            """INSERT INTO activity_events (id, team_id, context_item_id, action, summary, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            ("activity-google-auth-complete", DEMO_TEAM_ID, "google-authentication", "completed",
             "John completed Google Authentication and shared its implementation handoff.", "2026-08-27T16:42:00Z"),
        )
        db.commit()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None
