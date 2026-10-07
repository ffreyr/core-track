"""Financial log endpoints: CRUD, the paid/pending toggle and the monthly
cash-flow summary for the finance tab.

Mounted at ``/api/finance``.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.models import FinanceKind, FinancialLog

router = APIRouter(prefix="/finance", tags=["finance"])

DbSession = Annotated[Session, Depends(get_db)]


def _get_log_or_404(db: Session, log_id: int) -> FinancialLog:
    """Load a financial log or abort the request with ``404 Not Found``."""
    log = crud.get_finance_log(db, log_id)
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Financial log {log_id} not found"
        )
    return log


# NOTE: ``/summary`` is declared before ``/{log_id}`` so the literal path wins
# route matching instead of being parsed (and rejected) as an integer id.
@router.get("/summary", response_model=schemas.FinanceSummary, summary="Monthly cash-flow summary")
def monthly_summary(
    db: DbSession,
    year: Annotated[int, Query(ge=1970, le=9999, description="Four-digit year")],
    month: Annotated[int, Query(ge=1, le=12, description="Month number 1-12")],
) -> schemas.FinanceSummary:
    """Return expected income, paid and pending expenses, the remaining budget,
    a category breakdown, a daily series and the month's unpaid entries."""
    return crud.monthly_finance_summary(db, year, month)


@router.get("", response_model=list[schemas.FinanceRead], summary="List financial logs")
def list_logs(
    db: DbSession,
    start: Annotated[date | None, Query(description="On or after (YYYY-MM-DD)")] = None,
    end: Annotated[date | None, Query(description="On or before (YYYY-MM-DD)")] = None,
    kind: Annotated[FinanceKind | None, Query(description="income or expense")] = None,
    category: Annotated[str | None, Query(max_length=60, description="Exact category")] = None,
    is_paid: Annotated[bool | None, Query(description="true = settled, false = pending")] = None,
) -> list[FinancialLog]:
    """Return financial logs, optionally filtered by date range, kind, category and status."""
    return list(
        crud.list_finance_logs(db, start=start, end=end, kind=kind, category=category, is_paid=is_paid)
    )


@router.post(
    "",
    response_model=schemas.FinanceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record income or expense",
)
def create_log(payload: schemas.FinanceCreate, db: DbSession) -> FinancialLog:
    """Record a new income or expense entry (``is_paid=false`` plans a future one)."""
    return crud.create_finance_log(db, payload)


@router.get("/{log_id}", response_model=schemas.FinanceRead, summary="Get a financial log")
def get_log(log_id: int, db: DbSession) -> FinancialLog:
    """Return a single financial log by id."""
    return _get_log_or_404(db, log_id)


@router.patch("/{log_id}", response_model=schemas.FinanceRead, summary="Update a financial log")
def update_log(log_id: int, payload: schemas.FinanceUpdate, db: DbSession) -> FinancialLog:
    """Partially update a financial log; only fields present in the body are changed."""
    log = _get_log_or_404(db, log_id)
    return crud.update_finance_log(db, log, payload)


@router.post(
    "/{log_id}/toggle-paid",
    response_model=schemas.FinanceRead,
    summary="Toggle paid / pending",
)
def toggle_paid(log_id: int, db: DbSession) -> FinancialLog:
    """Flip an entry between paid and pending (the finance tab's quick checkbox)."""
    log = _get_log_or_404(db, log_id)
    return crud.toggle_finance_paid(db, log)


@router.delete(
    "/{log_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a financial log",
)
def delete_log(log_id: int, db: DbSession) -> Response:
    """Permanently delete a financial log."""
    log = _get_log_or_404(db, log_id)
    crud.delete_finance_log(db, log)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
