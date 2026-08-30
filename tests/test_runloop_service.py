import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.runloop_service import RunloopConfigurationError, RunloopServiceError, run_runloop_smoke_test


class FakeCommandResult:
    exit_code = 0

    async def stdout(self):
        return "hello from Runloop\n"


class FakeCommandClient:
    def __init__(self, error=None):
        self.error = error

    async def exec(self, command):
        if self.error:
            raise self.error
        self.command = command
        return FakeCommandResult()


class FakeDevbox:
    id = "devbox-test-123"

    def __init__(self, command_error=None, shutdown_error=None):
        self.cmd = FakeCommandClient(command_error)
        self.shutdown_error = shutdown_error
        self.shutdown_called = False

    async def shutdown(self):
        self.shutdown_called = True
        if self.shutdown_error:
            raise self.shutdown_error


class FakeDevboxManager:
    def __init__(self, devbox):
        self.devbox = devbox

    async def create(self):
        return self.devbox


class FakeRunloopClient:
    def __init__(self, devbox):
        self.devbox = FakeDevboxManager(devbox)


class RunloopServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_smoke_test_executes_command_and_returns_structured_output(self):
        devbox = FakeDevbox()
        with patch.dict(os.environ, {"RUNLOOP_API_KEY": "test-secret"}), patch(
            "app.runloop_service._new_client", return_value=FakeRunloopClient(devbox)
        ):
            result = await run_runloop_smoke_test()

        self.assertEqual(result, {
            "success": True,
            "devbox_id": "devbox-test-123",
            "command": 'echo "hello from Runloop"',
            "stdout": "hello from Runloop\n",
            "exit_code": 0,
            "cleaned_up": True,
        })
        self.assertTrue(devbox.shutdown_called)

    async def test_smoke_test_cleans_up_after_command_failure(self):
        devbox = FakeDevbox(command_error=RuntimeError("test-secret must not leak"))
        with patch.dict(os.environ, {"RUNLOOP_API_KEY": "test-secret"}), patch(
            "app.runloop_service._new_client", return_value=FakeRunloopClient(devbox)
        ):
            with self.assertRaisesRegex(RunloopServiceError, "command failed") as raised:
                await run_runloop_smoke_test()

        self.assertTrue(devbox.shutdown_called)
        self.assertNotIn("test-secret", str(raised.exception))

    async def test_smoke_test_requires_environment_api_key(self):
        with patch.dict(os.environ, {}, clear=True), patch("app.runloop_service._new_client") as factory:
            with self.assertRaises(RunloopConfigurationError):
                await run_runloop_smoke_test()

        factory.assert_not_called()


class RunloopEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_endpoint_returns_service_result(self):
        from app.main import runloop_test

        expected = {"success": True, "stdout": "hello from Runloop\n", "cleaned_up": True}
        with patch("app.main.run_runloop_smoke_test", new=AsyncMock(return_value=expected)):
            response = await runloop_test(identity={"user": {"id": "john"}})

        self.assertEqual(response, expected)

    async def test_endpoint_returns_sanitized_failure_result(self):
        from app.main import runloop_test

        with patch(
            "app.main.run_runloop_smoke_test",
            new=AsyncMock(side_effect=RunloopServiceError("Runloop command failed.")),
        ):
            response = await runloop_test(identity={"user": {"id": "john"}})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(json.loads(response.body), {"success": False, "error": "Runloop command failed."})


if __name__ == "__main__":
    unittest.main()
