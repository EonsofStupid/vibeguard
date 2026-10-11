"""Observed connection checks. Results are scoped to one server process."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel

class VoyageCheck(BaseModel):
    status: Literal['untested', 'passed', 'failed'] = 'untested'
    checked_at: datetime | None = None
    model: str | None = None
    dimensions: int | None = None
    error: str | None = None
