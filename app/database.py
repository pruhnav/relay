"""Small SQLite persistence layer for the shared team-memory demo."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(__file__).resolve().parent / "team_memory.db"


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
                email TEXT NOT NULL
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
            CREATE INDEX IF NOT EXISTS context_team_updated ON context_items(team_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS activity_team_time ON activity_events(team_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS artifacts_context ON artifacts(context_item_id);
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

        if db.execute("SELECT 1 FROM teams WHERE id = ?", ("team-northstar",)).fetchone():
            return

        db.execute("INSERT INTO teams (id, name) VALUES (?, ?)", ("team-northstar", "Northstar Consulting"))
        db.executemany(
            "INSERT INTO users (id, team_id, name, email) VALUES (?, ?, ?, ?)",
            [
                ("person-a", "team-northstar", "Person A", "person.a@northstar.consulting"),
                ("person-b", "team-northstar", "Person B", "person.b@northstar.consulting"),
            ],
        )
        db.executemany(
            "INSERT INTO conversations (id, team_id, user_id, title, created_at) VALUES (?, ?, ?, ?, ?)",
            [
                ("conversation-a", "team-northstar", "person-a", "Authentication work", "2026-08-27T15:10:00Z"),
                ("conversation-b", "team-northstar", "person-b", "Client portal research", "2026-08-28T09:00:00Z"),
            ],
        )
        item = (
            "google-authentication",
            "team-northstar",
            "person-a",
            "feature",
            "Google Authentication",
            "Backend Google OAuth authentication flow is implemented for the client portal. Frontend teams can begin integration using the documented callback route.",
            "complete",
            json.dumps(["app/auth.py", "app/routes.py", "docs/google-oauth-handoff.md"]),
            "/auth/google",
            "Commit abc123 · Person A implementation handoff",
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
            ("artifact-google-auth-handoff", "team-northstar", "google-authentication", "implementation",
             "Google OAuth backend handoff", "Google OAuth backend flow, callback route, and integration notes.", None,
             json.dumps(["app/auth.py", "app/routes.py", "docs/google-oauth-handoff.md"]), "abc123", "2026-08-27T16:42:00Z"),
        )
        db.execute("UPDATE context_items SET related_commit = ?, source_type = ?, source_reference = ?, artifact_ids_json = ? WHERE id = ?",
                   ("abc123", "agent_task", "Google authentication implementation handoff", json.dumps(["artifact-google-auth-handoff"]), "google-authentication"))
        db.execute(
            """INSERT INTO activity_events (id, team_id, context_item_id, action, summary, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            ("activity-google-auth-complete", "team-northstar", "google-authentication", "completed",
             "Person A completed Google Authentication and shared its implementation handoff.", "2026-08-27T16:42:00Z"),
        )
        db.commit()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None
