"""In-memory registry of live SessionPipeline instances.

FastAPI/Starlette runs WebSocket handlers on a single asyncio event loop by
default, so a plain dict is safe here without additional locking — there is
never a context switch mid-mutation. If this service is ever run with
multiple worker processes, each process holds its own registry, which is
fine: the gateway pins one session to one DSP connection for its whole
lifetime (see architecture §10), so a session's state never needs to be
shared across processes.
"""

from __future__ import annotations

from app.pipeline.session_pipeline import SessionPipeline


class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionPipeline] = {}

    def create(
        self,
        session_id: str,
        calibration: dict | None,
        disorder_mode: str = "tachylalia",
        demo_mode: bool = False,
    ) -> SessionPipeline:
        pipeline = SessionPipeline(session_id, calibration, disorder_mode=disorder_mode, demo_mode=demo_mode)
        self._sessions[session_id] = pipeline
        return pipeline

    def get(self, session_id: str) -> SessionPipeline | None:
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def count(self) -> int:
        return len(self._sessions)


registry = SessionRegistry()
