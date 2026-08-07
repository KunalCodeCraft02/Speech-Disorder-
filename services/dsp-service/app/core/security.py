from fastapi import Header, HTTPException, WebSocket, status

from app.core.config import get_settings


def _extract_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    scheme, _, token = header_value.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


async def verify_service_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency for REST routes. The DSP service is only ever
    reachable from the gateway on a private network segment (see
    architecture §10) — the token is a defense-in-depth check, not the
    primary access control."""
    settings = get_settings()
    if not settings.dsp_service_token:
        return  # no token configured — development mode

    token = _extract_bearer(authorization)
    if token != settings.dsp_service_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing service token")


def verify_websocket_token(websocket: WebSocket) -> bool:
    """Same check for the WS endpoint, where FastAPI's Header() dependency
    injection isn't available before the connection is accepted."""
    settings = get_settings()
    if not settings.dsp_service_token:
        return True

    token = _extract_bearer(websocket.headers.get("authorization"))
    return token == settings.dsp_service_token
