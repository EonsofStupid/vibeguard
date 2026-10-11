"""HTTP API + dashboard for VibeGuard. Thin layer over the public functions of the core modules."""
from .app import create_app

__all__ = ["create_app"]
