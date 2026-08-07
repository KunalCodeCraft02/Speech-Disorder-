import logging
import sys

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    root.handlers = [handler]

    # Quiet the access-log noise from uvicorn in production; keep it in dev.
    logging.getLogger("uvicorn.access").setLevel(
        logging.WARNING if settings.env == "production" else logging.INFO
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
