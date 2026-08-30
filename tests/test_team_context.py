import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import database
from app.main import (
    AGENT_INSTRUCTIONS,
    build_team_context_for_prompt,
    duplicate_response,
    save_team_context,
    search_team_context,
)


class TeamContextTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path_patch = patch.object(database, "DATABASE_PATH", Path(self.temp_dir.name) / "relay.db")
        self.path_patch.start()
        database.initialize()
        with database.connect() as db:
            db.execute("DELETE FROM activity_events")
            db.execute("DELETE FROM shared_context_records")

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def save_authentication(self, status="complete"):
        with database.connect() as db:
            record = save_team_context(
                db,
                team_id=database.DEMO_TEAM_ID,
                author_id="john",
                context_type="feature",
                title="Google Authentication",
                content="Backend OAuth login is implemented at /auth/google.",
                status=status,
                source_type="commit",
                source_reference="abc123",
            )
            db.commit()
        return record

    def test_save_team_context_persists_structured_provenance(self):
        record = self.save_authentication()

        with database.connect() as db:
            saved = db.execute("SELECT * FROM shared_context_records WHERE id = ?", (record["id"],)).fetchone()

        self.assertEqual(saved["team_id"], database.DEMO_TEAM_ID)
        self.assertEqual(saved["source_user_id"], "john")
        self.assertEqual(saved["context_type"], "feature")
        self.assertEqual(saved["title"], "Google Authentication")
        self.assertEqual(saved["status"], "complete")
        self.assertEqual(saved["source_type"], "commit")
        self.assertEqual(saved["source_reference"], "abc123")
        self.assertTrue(saved["updated_at"])

    def test_search_team_context_returns_relevant_context(self):
        self.save_authentication()

        matches = search_team_context(database.DEMO_TEAM_ID, "Where should I implement login?")

        self.assertEqual([record["title"] for record in matches], ["Google Authentication"])

    def test_search_team_context_excludes_unrelated_and_other_team_context(self):
        self.save_authentication()
        with database.connect() as db:
            save_team_context(db, team_id=database.DEMO_TEAM_ID, author_id="mary", context_type="research",
                              title="Pricing interviews", content="Customer pricing interview notes.", status="active",
                              source_type="manual", source_reference="interviews")
            db.execute("INSERT INTO teams (id, name) VALUES ('other-team', 'Other Team')")
            db.execute("INSERT INTO users (id, team_id, name, email, role) VALUES ('other', 'other-team', 'Other', 'other@example.com', 'member')")
            save_team_context(db, team_id="other-team", author_id="other", context_type="feature",
                              title="Authentication rewrite", content="Authentication is complete.", status="complete",
                              source_type="manual", source_reference="other team")
            db.commit()

        matches = search_team_context(database.DEMO_TEAM_ID, "authentication login")

        self.assertEqual([record["title"] for record in matches], ["Google Authentication"])

    def test_chat_prompt_context_includes_relevant_shared_context(self):
        self.save_authentication()

        context = build_team_context_for_prompt(database.DEMO_TEAM_ID, "Help me build login")

        serialized = str(context)
        self.assertIn("Google Authentication", serialized)
        self.assertIn("John", serialized)
        self.assertIn("complete", serialized)

    def test_duplicate_work_awareness_reports_owner_and_status(self):
        self.save_authentication(status="in_progress")
        matches = search_team_context(database.DEMO_TEAM_ID, "Start authentication work")

        response = duplicate_response(matches, [])

        self.assertIn("John", response)
        self.assertIn("in progress", response)
        self.assertIn("before starting overlapping work", response)
        self.assertIn("Use shared team context when responding", AGENT_INSTRUCTIONS)


if __name__ == "__main__":
    unittest.main()
