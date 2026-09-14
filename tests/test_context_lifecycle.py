import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import database
from app.main import app, current_identity, save_team_context


class ContextLifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        path_patch = patch.object(database, "DATABASE_PATH", Path(temporary.name) / "relay.db")
        path_patch.start()
        self.addCleanup(path_patch.stop)
        database.initialize()
        self.old = self.save_record("Old database proposal")
        self.new = self.save_record("New database decision")
        self.overrides = app.dependency_overrides.copy()
        self.addCleanup(self.restore_overrides)
        app.dependency_overrides[current_identity] = lambda: {"team": {"id": database.DEMO_TEAM_ID}}
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def save_record(self, content, team_id=database.DEMO_TEAM_ID, author_id="john"):
        with database.connect() as db:
            return save_team_context(
                db, team_id=team_id, author_id=author_id, context_type="decision",
                title=content, content=content, status="active", source_type="manual",
                source_reference="original provenance", timestamp="2020-01-01T00:00:00+00:00",
            )

    def snapshot(self):
        with database.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM shared_context_records ORDER BY id")]

    def supersede(self, old_id, new_id):
        return self.client.post(f"/api/context/{old_id}/supersede", json={"superseded_by_record_id": new_id})

    def test_supersede_preserves_content_provenance_and_replacement(self):
        before = {row["id"]: row for row in self.snapshot()}
        response = self.supersede(self.old["id"], self.new["id"])
        self.assertEqual(response.status_code, 200)
        after = {row["id"]: row for row in self.snapshot()}
        updated = after[self.old["id"]]
        self.assertEqual(updated["status"], "superseded")
        self.assertEqual(updated["superseded_by_record_id"], self.new["id"])
        self.assertNotEqual(updated["updated_at"], before[self.old["id"]]["updated_at"])
        for key, value in before[self.old["id"]].items():
            if key not in {"status", "superseded_by_record_id", "updated_at"}:
                self.assertEqual(updated[key], value)
        self.assertEqual(after[self.new["id"]], before[self.new["id"]])
        self.assertEqual(response.json()["record"]["superseded_by_record_id"], self.new["id"])

    def test_missing_records_and_self_reference_leave_database_unchanged(self):
        before = self.snapshot()
        for old_id, new_id, status in [
            ("missing", self.new["id"], 404),
            (self.old["id"], "missing", 404),
            (self.old["id"], self.old["id"], 400),
        ]:
            with self.subTest(old_id=old_id, new_id=new_id):
                self.assertEqual(self.supersede(old_id, new_id).status_code, status)
                self.assertEqual(self.snapshot(), before)

    def test_cross_team_records_are_rejected_in_both_positions(self):
        with database.connect() as db:
            db.execute("INSERT INTO teams (id, name) VALUES ('other-team', 'Other Team')")
        foreign = self.save_record("Foreign decision", team_id="other-team", author_id=None)
        before = self.snapshot()
        for old_id, new_id in [(self.old["id"], foreign["id"]), (foreign["id"], self.new["id"])]:
            with self.subTest(old_id=old_id):
                self.assertEqual(self.supersede(old_id, new_id).status_code, 404)
                self.assertEqual(self.snapshot(), before)

    def test_failure_after_update_rolls_back(self):
        before = self.snapshot()
        with patch("app.main.record_from_row", side_effect=RuntimeError("serialization failed")):
            response = self.supersede(self.old["id"], self.new["id"])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.snapshot(), before)

    def test_authentication_is_required(self):
        app.dependency_overrides.pop(current_identity)
        before = self.snapshot()
        self.assertEqual(self.supersede(self.old["id"], self.new["id"]).status_code, 401)
        self.assertEqual(self.snapshot(), before)
