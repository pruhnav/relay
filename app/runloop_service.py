"""Minimal Runloop connectivity service, isolated from Relay's chat flow."""

from __future__ import annotations

import os
from typing import Any

from runloop_api_client import AsyncRunloopSDK


RUNLOOP_TEST_COMMAND = 'echo "hello from Runloop"'


class RunloopConfigurationError(RuntimeError):
    """Raised when Relay is not configured to contact Runloop."""


class RunloopServiceError(RuntimeError):
    """Raised with a safe message when a Runloop operation fails."""


def _new_client(api_key: str) -> AsyncRunloopSDK:
    return AsyncRunloopSDK(bearer_token=api_key)


async def run_runloop_smoke_test() -> dict[str, Any]:
    """Create a Devbox, run one harmless command, and always shut it down."""
    api_key = os.getenv("RUNLOOP_API_KEY", "").strip()
    if not api_key:
        raise RunloopConfigurationError("RUNLOOP_API_KEY is not configured.")

    client = _new_client(api_key)
    devbox = None
    command_result = None
    operation_error: RunloopServiceError | None = None
    cleanup_error = False

    try:
        devbox = await client.devbox.create()
        execution = await devbox.cmd.exec(command=RUNLOOP_TEST_COMMAND)
        command_result = {
            "success": execution.exit_code == 0,
            "devbox_id": devbox.id,
            "command": RUNLOOP_TEST_COMMAND,
            "stdout": await execution.stdout(),
            "exit_code": execution.exit_code,
            "cleaned_up": False,
        }
    except Exception:
        operation_error = RunloopServiceError(
            "Runloop Devbox creation failed." if devbox is None else "Runloop command failed."
        )
    finally:
        if devbox is not None:
            try:
                await devbox.shutdown()
            except Exception:
                cleanup_error = True

    if operation_error is not None:
        raise operation_error from None
    if cleanup_error:
        raise RunloopServiceError("Runloop Devbox cleanup failed.")
    if command_result is None:
        raise RunloopServiceError("Runloop test did not return a command result.")
    command_result["cleaned_up"] = True
    return command_result
