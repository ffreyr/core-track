"""Study timer endpoints: start/stop the running session, a session log and
per-day / per-subject summaries.

Mounted at ``/api/study``. The timer state lives on the server, so a running
session survives app restarts and is shared by every client (desktop window,
desktop widget, and later the iPhone app).
"""

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.models import StudySession

router = APIRouter(prefix="/study", tags=["study"])

DbSession = Annotated[Session, Depends(get_db)]

#: Longest range the summary endpoint aggregates.
MAX_SUMMARY_DAYS = 366


def _invalid(error: crud.StudySessionError) -> HTTPException:
    """Translate a domain error into a 422 response."""
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))


def _get_or_404(db: Session, session_id: int) -> StudySession:
    """Load a session or abort with ``404 Not Found``."""
    session = crud.get_study_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Study session {session_id} not found")
    return session


@router.get("/active", response_model=schemas.StudySessionRead | None, summary="Running session")
def active_session(db: DbSession) -> StudySession | None:
    """Return the running session, or ``null`` when the timer is idle."""
    return crud.get_active_study_session(db)


@router.post(
    "/start",
    response_model=schemas.StudySessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Start the timer",
)
def start(payload: schemas.StudyStart, db: DbSession) -> StudySession:
    """Start a session now. A session that is still running is stopped first."""
    try:
        return crud.start_study_session(db, payload)
    except crud.StudySessionError as error:
        raise _invalid(error) from error


@router.post("/stop", response_model=schemas.StudySessionRead, summary="Stop the timer")
def stop(db: DbSession) -> StudySession:
    """Stop the running session now and return it with its duration."""
    session = crud.stop_study_session(db)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No study session is running")
    return session


@router.get("/sessions", response_model=list[schemas.StudySessionRead], summary="List sessions")
def list_sessions(
    db: DbSession,
    start: Annotated[datetime | None, Query(description="Started at or after (ISO datetime with offset)")] = None,
    end: Annotated[datetime | None, Query(description="Started before (ISO datetime with offset)")] = None,
    task_id: Annotated[int | None, Query(description="Only sessions linked to this task")] = None,
) -> list[StudySession]:
    """Return sessions (running included), newest first."""
    return list(crud.list_study_sessions(db, start=start, end=end, task_id=task_id))


@router.post(
    "/sessions",
    response_model=schemas.StudySessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Log a past session",
)
def create_session(payload: schemas.StudySessionCreate, db: DbSession) -> StudySession:
    """Record a completed session by hand."""
    try:
        return crud.create_study_session(db, payload)
    except crud.StudySessionError as error:
        raise _invalid(error) from error


@router.patch("/sessions/{session_id}", response_model=schemas.StudySessionRead, summary="Edit a session")
def update_session(session_id: int, payload: schemas.StudySessionUpdate, db: DbSession) -> StudySession:
    """Partially update a session; the resulting time range is validated."""
    session = _get_or_404(db, session_id)
    try:
        return crud.update_study_session(db, session, payload)
    except crud.StudySessionError as error:
        raise _invalid(error) from error


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a session",
)
def delete_session(session_id: int, db: DbSession) -> Response:
    """Permanently delete a session."""
    crud.delete_study_session(db, _get_or_404(db, session_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/summary", response_model=schemas.StudySummary, summary="Study totals")
def summary(
    db: DbSession,
    start: Annotated[date, Query(description="First local day (YYYY-MM-DD)")],
    end: Annotated[date, Query(description="Last local day (YYYY-MM-DD)")],
    tz: Annotated[str, Query(max_length=64, description="IANA time zone, e.g. Europe/Istanbul")] = "UTC",
) -> schemas.StudySummary:
    """Completed study time per local day and per subject, plus the running session."""
    if (end - start).days + 1 > MAX_SUMMARY_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Range can span at most {MAX_SUMMARY_DAYS} days",
        )
    try:
        return crud.study_summary(db, start, end, tz)
    except crud.StudySessionError as error:
        raise _invalid(error) from error
