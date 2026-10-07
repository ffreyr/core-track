"""Data-access layer.

Every database read and write lives here so routers stay thin: routers handle
HTTP concerns (status codes, query parameters), this module handles queries
and business rules (completion timestamps, money aggregation, calendar
bucketing). Functions take an explicit :class:`~sqlalchemy.orm.Session` and
commit their own writes.
"""

import calendar as pycalendar
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas
from app.models import (
    FinanceKind,
    FinancialLog,
    TaskItem,
    TaskScope,
    cents_to_decimal,
    utcnow,
)

# ===========================================================================
# Tasks
# ===========================================================================


def _apply_completion(task: TaskItem, is_completed: bool) -> None:
    """Set a task's completion flag and keep ``completed_at`` consistent.

    * Completing an open task stamps ``completed_at`` with the current time.
    * Reopening a completed task clears ``completed_at``.
    * Re-sending the current state is a no-op, so the original completion
      time is preserved if a client PATCHes ``is_completed=true`` twice.
    """
    if is_completed == task.is_completed:
        return
    task.is_completed = is_completed
    task.completed_at = utcnow() if is_completed else None


def list_tasks(
    db: Session,
    *,
    scope: TaskScope | None = None,
    start: date | None = None,
    end: date | None = None,
    completed: bool | None = None,
) -> Sequence[TaskItem]:
    """Return tasks matching the optional filters.

    Args:
        db: Active session.
        scope: Only tasks with this scope.
        start: Only tasks due on or after this date.
        end: Only tasks due on or before this date.
        completed: ``True`` for done tasks, ``False`` for open tasks.

    Returns:
        Tasks ordered by due date, then priority (high first), then id, which
        is the order the calendar cell and list views display them in.
    """
    stmt = select(TaskItem)
    if scope is not None:
        stmt = stmt.where(TaskItem.scope == scope)
    if start is not None:
        stmt = stmt.where(TaskItem.due_date >= start)
    if end is not None:
        stmt = stmt.where(TaskItem.due_date <= end)
    if completed is not None:
        stmt = stmt.where(TaskItem.is_completed == completed)
    stmt = stmt.order_by(TaskItem.due_date, TaskItem.priority.desc(), TaskItem.id)
    return db.scalars(stmt).all()


def get_task(db: Session, task_id: int) -> TaskItem | None:
    """Return the task with ``task_id`` or ``None`` if it does not exist."""
    return db.get(TaskItem, task_id)


def create_task(db: Session, payload: schemas.TaskCreate) -> TaskItem:
    """Insert a new (open) task and return it with generated fields populated."""
    task = TaskItem(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, task: TaskItem, payload: schemas.TaskUpdate) -> TaskItem:
    """Apply a partial update to ``task``.

    Only fields the client explicitly sent are changed. ``is_completed`` is
    routed through :func:`_apply_completion` so ``completed_at`` stays correct.
    """
    changes = payload.model_dump(exclude_unset=True)
    is_completed = changes.pop("is_completed", None)

    for field_name, value in changes.items():
        setattr(task, field_name, value)
    if is_completed is not None:
        _apply_completion(task, is_completed)

    db.commit()
    db.refresh(task)
    return task


def toggle_task(db: Session, task: TaskItem) -> TaskItem:
    """Flip a task between open and completed (the calendar checkbox action)."""
    _apply_completion(task, not task.is_completed)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task: TaskItem) -> None:
    """Permanently remove ``task``."""
    db.delete(task)
    db.commit()


# ===========================================================================
# Financial logs
# ===========================================================================


def list_finance_logs(
    db: Session,
    *,
    start: date | None = None,
    end: date | None = None,
    kind: FinanceKind | None = None,
    category: str | None = None,
) -> Sequence[FinancialLog]:
    """Return financial logs matching the optional filters.

    Args:
        db: Active session.
        start: Only entries on or after this date.
        end: Only entries on or before this date.
        kind: Only income or only expense entries.
        category: Exact (case-sensitive) category match.

    Returns:
        Entries ordered chronologically, then by id (insertion order).
    """
    stmt = select(FinancialLog)
    if start is not None:
        stmt = stmt.where(FinancialLog.occurred_on >= start)
    if end is not None:
        stmt = stmt.where(FinancialLog.occurred_on <= end)
    if kind is not None:
        stmt = stmt.where(FinancialLog.kind == kind)
    if category is not None:
        stmt = stmt.where(FinancialLog.category == category)
    stmt = stmt.order_by(FinancialLog.occurred_on, FinancialLog.id)
    return db.scalars(stmt).all()


def get_finance_log(db: Session, log_id: int) -> FinancialLog | None:
    """Return the financial log with ``log_id`` or ``None`` if it does not exist."""
    return db.get(FinancialLog, log_id)


def create_finance_log(db: Session, payload: schemas.FinanceCreate) -> FinancialLog:
    """Insert a new financial log.

    ``amount`` from the payload is assigned through the model's ``amount``
    property, which converts it to integer cents for storage.
    """
    log = FinancialLog(**payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def update_finance_log(
    db: Session, log: FinancialLog, payload: schemas.FinanceUpdate
) -> FinancialLog:
    """Apply a partial update to ``log`` (only explicitly sent fields change)."""
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(log, field_name, value)
    db.commit()
    db.refresh(log)
    return log


def delete_finance_log(db: Session, log: FinancialLog) -> None:
    """Permanently remove ``log``."""
    db.delete(log)
    db.commit()


def monthly_finance_summary(db: Session, year: int, month: int) -> schemas.FinanceSummary:
    """Aggregate one calendar month of financial activity.

    Two grouped SQL queries do the heavy lifting (sums are exact because
    amounts are stored as integer cents):

    1. ``GROUP BY category, kind`` → per-category breakdown and grand totals.
    2. ``GROUP BY occurred_on, kind`` → per-day income/expense series.

    The daily series is then expanded to include every day of the month, with
    zeros for quiet days, so charts and the calendar can consume it directly.

    Args:
        db: Active session.
        year: Four-digit year.
        month: Month number, 1–12.

    Returns:
        A fully populated :class:`~app.schemas.FinanceSummary`.
    """
    days_in_month = pycalendar.monthrange(year, month)[1]
    first_day = date(year, month, 1)
    last_day = date(year, month, days_in_month)
    in_month = FinancialLog.occurred_on.between(first_day, last_day)

    # -- 1. Per-category totals -------------------------------------------
    category_total = func.sum(FinancialLog.amount_cents)
    category_rows = db.execute(
        select(
            FinancialLog.category,
            FinancialLog.kind,
            category_total,
            func.count(FinancialLog.id),
        )
        .where(in_month)
        .group_by(FinancialLog.category, FinancialLog.kind)
        .order_by(FinancialLog.kind, category_total.desc(), FinancialLog.category)
    ).all()

    income_cents = 0
    expense_cents = 0
    entry_count = 0
    by_category: list[schemas.CategoryBreakdown] = []
    for category, kind, total_cents, count in category_rows:
        entry_count += count
        if kind == FinanceKind.INCOME:
            income_cents += total_cents
        else:
            expense_cents += total_cents
        by_category.append(
            schemas.CategoryBreakdown(
                category=category,
                kind=kind,
                total=cents_to_decimal(total_cents),
                count=count,
            )
        )

    # -- 2. Per-day series --------------------------------------------------
    # Start every day of the month at zero, then fill in the grouped sums.
    daily_cents: dict[date, dict[FinanceKind, int]] = {
        first_day + timedelta(days=offset): {FinanceKind.INCOME: 0, FinanceKind.EXPENSE: 0}
        for offset in range(days_in_month)
    }
    day_rows = db.execute(
        select(FinancialLog.occurred_on, FinancialLog.kind, func.sum(FinancialLog.amount_cents))
        .where(in_month)
        .group_by(FinancialLog.occurred_on, FinancialLog.kind)
    ).all()
    for occurred_on, kind, total_cents in day_rows:
        daily_cents[occurred_on][kind] = total_cents

    daily = [
        schemas.DailyNet(
            date=day,
            income=cents_to_decimal(sums[FinanceKind.INCOME]),
            expense=cents_to_decimal(sums[FinanceKind.EXPENSE]),
            net=cents_to_decimal(sums[FinanceKind.INCOME] - sums[FinanceKind.EXPENSE]),
        )
        for day, sums in daily_cents.items()
    ]

    return schemas.FinanceSummary(
        year=year,
        month=month,
        income_total=cents_to_decimal(income_cents),
        expense_total=cents_to_decimal(expense_cents),
        net=cents_to_decimal(income_cents - expense_cents),
        entry_count=entry_count,
        by_category=by_category,
        daily=daily,
    )


# ===========================================================================
# Calendar aggregation
# ===========================================================================


@dataclass
class _DayBucket:
    """Mutable accumulator for one calendar day while building the response."""

    tasks: list[TaskItem] = field(default_factory=list)
    finance: list[FinancialLog] = field(default_factory=list)
    income_cents: int = 0
    expense_cents: int = 0

    @property
    def completed_count(self) -> int:
        """Number of completed tasks in this bucket."""
        return sum(1 for task in self.tasks if task.is_completed)


def build_calendar(db: Session, start: date, end: date) -> schemas.CalendarResponse:
    """Group tasks and financial logs by day for the calendar grid.

    Algorithm:
        1. Pre-create an empty bucket for every day in ``[start, end]`` so the
           response always has one entry per day (the client grid can map
           cells to ``days[i]`` without gap handling).
        2. Fetch all tasks and all financial logs in the range with exactly
           two queries (no per-day N+1 queries).
        3. Drop each row into its day's bucket, accumulating money in cents.
        4. Convert buckets to response models and compute range totals.

    The caller (router) is responsible for validating that ``end >= start``
    and that the span is within the configured limit.

    Args:
        db: Active session.
        start: First day of the range (inclusive).
        end: Last day of the range (inclusive).

    Returns:
        A :class:`~app.schemas.CalendarResponse` ordered chronologically.
    """
    span_days = (end - start).days + 1
    buckets: dict[date, _DayBucket] = {
        start + timedelta(days=offset): _DayBucket() for offset in range(span_days)
    }

    for task in list_tasks(db, start=start, end=end):
        buckets[task.due_date].tasks.append(task)

    for log in list_finance_logs(db, start=start, end=end):
        bucket = buckets[log.occurred_on]
        bucket.finance.append(log)
        if log.kind == FinanceKind.INCOME:
            bucket.income_cents += log.amount_cents
        else:
            bucket.expense_cents += log.amount_cents

    days: list[schemas.CalendarDay] = []
    total_income = total_expense = total_tasks = total_completed = 0
    for day, bucket in buckets.items():
        completed = bucket.completed_count
        days.append(
            schemas.CalendarDay(
                date=day,
                tasks=[schemas.TaskRead.model_validate(t) for t in bucket.tasks],
                finance=[schemas.FinanceRead.model_validate(f) for f in bucket.finance],
                income_total=cents_to_decimal(bucket.income_cents),
                expense_total=cents_to_decimal(bucket.expense_cents),
                net=cents_to_decimal(bucket.income_cents - bucket.expense_cents),
                open_task_count=len(bucket.tasks) - completed,
                completed_task_count=completed,
            )
        )
        total_income += bucket.income_cents
        total_expense += bucket.expense_cents
        total_tasks += len(bucket.tasks)
        total_completed += completed

    return schemas.CalendarResponse(
        start=start,
        end=end,
        days=days,
        totals=schemas.CalendarTotals(
            income_total=cents_to_decimal(total_income),
            expense_total=cents_to_decimal(total_expense),
            net=cents_to_decimal(total_income - total_expense),
            task_count=total_tasks,
            open_task_count=total_tasks - total_completed,
            completed_task_count=total_completed,
        ),
    )
