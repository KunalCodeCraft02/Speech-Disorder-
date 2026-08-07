"""The streaming analysis endpoint. Wire contract (see also
services/gateway/src/services/dspClient.js, the Node-side counterpart):

  Node -> here   text frame   {"type": "init", "sessionId": ..., "calibration": {...} | null,
                                "disorderMode": "tachylalia" | "bradylalia", "demoMode": bool}
  Node -> here   binary frame  raw PCM16 mono audio, sample rate = settings.sample_rate
  Node -> here   text frame   {"type": "end"}                     -- requests a final summary
  here -> Node   text frame   {"type": "metrics", ...}             -- one per analysis window
  here -> Node   text frame   {"type": "summary", ...}             -- reply to "end"
  here -> Node   text frame   {"type": "error", "message": ...}    -- non-fatal, connection stays open

A malformed or unexpected message never closes the connection — only a
protocol-level failure (bad auth, an actual socket error) does. One bad
chunk must not take down an otherwise-healthy session.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.core.security import verify_websocket_token
from app.session.registry import registry

router = APIRouter()
logger = get_logger(__name__)


async def _send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})


@router.websocket("/ws/analyze/{session_id}")
async def analyze_ws(websocket: WebSocket, session_id: str) -> None:
    if not verify_websocket_token(websocket):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    logger.info("WS connected session_id=%s", session_id)

    pipeline = None

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            text = message.get("text")
            raw_bytes = message.get("bytes")

            if text is not None:
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    await _send_error(websocket, "invalid JSON control message")
                    continue

                msg_type = data.get("type")

                if msg_type == "init":
                    pipeline = registry.create(
                        session_id,
                        data.get("calibration"),
                        disorder_mode=data.get("disorderMode", "tachylalia"),
                        demo_mode=bool(data.get("demoMode", False)),
                    )
                    logger.info(
                        "Session initialized session_id=%s calibrated=%s disorderMode=%s demoMode=%s",
                        session_id,
                        bool(data.get("calibration")),
                        pipeline.disorder_mode.value,
                        pipeline.demo_mode,
                    )

                elif msg_type == "end":
                    if pipeline is None:
                        await _send_error(websocket, "session not initialized — send 'init' first")
                        continue
                    summary = pipeline.build_summary()
                    await websocket.send_json(summary)

                else:
                    await _send_error(websocket, f"unknown control message type: {msg_type!r}")

            elif raw_bytes is not None:
                if pipeline is None:
                    await _send_error(websocket, "received audio before init")
                    continue

                try:
                    frame = pipeline.process_chunk(raw_bytes)
                except Exception:
                    logger.exception("Chunk processing failed session_id=%s", session_id)
                    await _send_error(websocket, "internal analysis error processing this chunk")
                    continue

                if frame is not None:
                    await websocket.send_json(frame)

    except WebSocketDisconnect:
        pass
    finally:
        if pipeline is not None:
            registry.remove(session_id)
        logger.info("WS closed session_id=%s", session_id)
