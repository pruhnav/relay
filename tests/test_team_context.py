import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import database
from app.main import (
    AGENT_INSTRUCTIONS,
    build_team_context_for_prompt,
    duplicate_response,
    get_context_record,
    list_context,
    related_records,
    save_team_context,
    search_team_context,
    team_context_for_agent,
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

    def test_superseded_highest_scoring_record_is_excluded(self):
        highest = self.save_authentication()
        with database.connect() as db:
            current = save_team_context(
                db, team_id=database.DEMO_TEAM_ID, author_id="mary", context_type="note",
                title="Implementation notes", content="OAuth endpoint details.", status="active",
                source_type="manual", source_reference="notes",
            )
        query = "Google Authentication"
        self.assertEqual(search_team_context(database.DEMO_TEAM_ID, query)[0]["id"], highest["id"])
        with database.connect() as db:
            db.execute("UPDATE shared_context_records SET status = 'superseded' WHERE id = ?", (highest["id"],))
        self.assertEqual([item["id"] for item in search_team_context(database.DEMO_TEAM_ID, query)], [current["id"]])

    def test_null_status_remains_eligible_for_primary_and_related_retrieval(self):
        legacy = self.save_authentication()
        current = self.save_authentication(status="active")
        old = self.save_authentication(status="superseded")
        with database.connect() as db:
            db.execute("UPDATE shared_context_records SET status = NULL WHERE id = ?", (legacy["id"],))
            linked = related_records(db, [{"id": "parent", "source_record_ids": [legacy["id"], current["id"], old["id"]]}])
        expected = {legacy["id"], current["id"]}
        self.assertEqual({item["id"] for item in linked}, expected)
        self.assertEqual({item["id"] for item in search_team_context(database.DEMO_TEAM_ID, "authentication")}, expected)

    def test_superseded_history_remains_accessible_without_following_replacement(self):
        old = self.save_authentication(status="superseded")
        with database.connect() as db:
            replacement = save_team_context(
                db, team_id=database.DEMO_TEAM_ID, author_id="mary", context_type="note",
                title="Pricing interviews", content="Customer pricing interview notes.", status="active",
                source_type="manual", source_reference="interviews",
            )
            db.execute("UPDATE shared_context_records SET superseded_by_record_id = ? WHERE id = ?", (replacement["id"], old["id"]))
            self.assertEqual(related_records(db, [{"id": "parent", "source_record_ids": [old["id"]]}]), [])
        self.assertEqual(search_team_context(database.DEMO_TEAM_ID, "authentication"), [])
        identity = {"team": {"id": database.DEMO_TEAM_ID}}
        history = list_context(q=None, type=None, artifact_type=None, identity=identity)["records"]
        self.assertIn(old["id"], {item["id"] for item in history})
        saved = get_context_record(old["id"], identity=identity)["record"]
        self.assertEqual(saved["status"], "superseded")
        self.assertEqual(saved["superseded_by_record_id"], replacement["id"])
        self.assertEqual(saved["content"], old["content"])

    def test_prompt_formatter_filters_direct_matches_and_related_records(self):
        current = self.save_authentication(status="active")
        legacy = {**current, "id": "legacy", "status": None}
        missing_status = {key: value for key, value in current.items() if key != "status"}
        missing_status["id"] = "missing-status"
        old = {**current, "id": "old-match", "status": "superseded", "content": "OBSOLETE_SECRET", "superseded_by_record_id": "unrequested-replacement"}
        old_related = {**old, "id": "old-related"}
        context = team_context_for_agent([old, current], [old_related, legacy, missing_status])
        self.assertEqual(
            [record["id"] for record in context["matched_shared_context_records"]],
            [current["id"], "legacy", "missing-status"],
        )
        self.assertNotIn("OBSOLETE_SECRET", str(context))
        self.assertEqual(team_context_for_agent([old], [old_related]), {"matched_shared_context_records": []})

    def test_prompt_builder_filters_preselected_records_without_retrieval(self):
        current = self.save_authentication()
        old = {**current, "id": "old", "status": "superseded", "content": "OBSOLETE_SECRET"}
        with database.connect() as db, patch("app.main.search_team_context") as search, patch("app.main.related_records") as related:
            context = build_team_context_for_prompt(
                database.DEMO_TEAM_ID, "authentication", db=db,
                matches=[old, current], related=[{**old, "id": "old-related"}],
            )
            search.assert_not_called()
            related.assert_not_called()
        self.assertEqual([record["id"] for record in context["matched_shared_context_records"]], [current["id"]])
        self.assertNotIn("OBSOLETE_SECRET", str(context))

    def test_oversized_prompt_fallback_excludes_superseded_metadata(self):
        current = self.save_authentication()
        old = {**current, "id": "old-match", "status": "superseded", "title": "OBSOLETE_METADATA"}
        with patch("app.main.MAX_CONTEXT_CHARS", 1):
            context = team_context_for_agent([old, current], [{**old, "id": "old-related"}])
        self.assertIn("note", context)
        self.assertEqual([record["id"] for record in context["matched_shared_context_records"]], [current["id"]])
        self.assertNotIn("content", context["matched_shared_context_records"][0])
        self.assertNotIn("OBSOLETE_METADATA", str(context))

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
