"""Calendar aggregation endpoint.

Mounted at ``/api/calendar``. This is the single call the calendar grid makes
to render a view: it returns one entry per day with that day's tasks,
financial logs and pre-computed totals.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.config import get_settings
from app.database import get_db

router = APIRouter(prefix="/calendar", tags=["calendar"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=schemas.CalendarResponse, summary="Calendar grid data")
def get_calendar(
    db: DbSession,
    start: Annotated[date, Query(description="First visible day (YYYY-MM-DD), inclusive")],
    end: Annotated[date, Query(description="Last visible day (YYYY-MM-DD), inclusive")],
) -> schemas.CalendarResponse:
    """Return tasks and financial logs grouped by day for ``[start, end]``.

    The client chooses the range to match its view — a 7-day week, a 42-cell
    month grid (including leading/trailing days of adjacent months), or any
    custom span — up to ``max_calendar_span_days``.

    Raises:
        HTTPException: 422 if ``end`` is before ``start`` or the range is
            longer than the configured maximum.
    """
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="'end' must be on or after 'start'",
        )

    max_span = get_settings().max_calendar_span_days
    span_days = (end - start).days + 1
    if span_days > max_span:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Range spans {span_days} days; the maximum is {max_span}",
        )

    return crud.build_calendar(db, start, end)
