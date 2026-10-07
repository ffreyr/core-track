"""Task endpoints: CRUD plus a completion toggle.

Mounted at ``/api/tasks``.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.models import TaskItem, TaskScope

router = APIRouter(prefix="/tasks", tags=["tasks"])

DbSession = Annotated[Session, Depends(get_db)]


def _get_task_or_404(db: Session, task_id: int) -> TaskItem:
    """Load a task or abort the request with ``404 Not Found``."""
    task = crud.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")
    return task


def _invalid_range(error: crud.TaskDateRangeError) -> HTTPException:
    """Translate a domain date-range error into a 422 response."""
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))


@router.get("", response_model=list[schemas.TaskRead], summary="List tasks")
def list_tasks(
    db: DbSession,
    scope: Annotated[TaskScope | None, Query(description="Filter by planning scope")] = None,
    start: Annotated[
        date | None, Query(description="Tasks overlapping on or after this day (YYYY-MM-DD)")
    ] = None,
    end: Annotated[
        date | None, Query(description="Tasks overlapping on or before this day (YYYY-MM-DD)")
    ] = None,
    completed: Annotated[bool | None, Query(description="true = done, false = open")] = None,
) -> list[TaskItem]:
    """Return tasks, optionally filtered by scope, date range and status.

    The date range uses overlap semantics: a multi-day task is included when
    any of its days fall inside ``[start, end]``.
    """
    return list(crud.list_tasks(db, scope=scope, start=start, end=end, completed=completed))


@router.post(
    "",
    response_model=schemas.TaskRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a task",
)
def create_task(payload: schemas.TaskCreate, db: DbSession) -> TaskItem:
    """Create a new open task on ``due_date`` (through ``end_date`` if given)."""
    try:
        return crud.create_task(db, payload)
    except crud.TaskDateRangeError as error:
        raise _invalid_range(error) from error


@router.get("/{task_id}", response_model=schemas.TaskRead, summary="Get a task")
def get_task(task_id: int, db: DbSession) -> TaskItem:
    """Return a single task by id."""
    return _get_task_or_404(db, task_id)


@router.patch("/{task_id}", response_model=schemas.TaskRead, summary="Update a task")
def update_task(task_id: int, payload: schemas.TaskUpdate, db: DbSession) -> TaskItem:
    """Partially update a task; only fields present in the body are changed.

    Sending only ``due_date`` moves the task and keeps a multi-day task's
    length; sending ``end_date`` resizes it (``null`` = single day).
    """
    task = _get_task_or_404(db, task_id)
    try:
        return crud.update_task(db, task, payload)
    except crud.TaskDateRangeError as error:
        raise _invalid_range(error) from error


@router.post(
    "/{task_id}/toggle",
    response_model=schemas.TaskRead,
    summary="Toggle task completion",
)
def toggle_task(task_id: int, db: DbSession) -> TaskItem:
    """Flip a task between open and completed (stamps/clears ``completed_at``)."""
    task = _get_task_or_404(db, task_id)
    return crud.toggle_task(db, task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a task",
)
def delete_task(task_id: int, db: DbSession) -> Response:
    """Permanently delete a task."""
    task = _get_task_or_404(db, task_id)
    crud.delete_task(db, task)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
