"""Data-access layer.

Every database read and write lives here so routers stay thin: routers handle
HTTP concerns (status codes, query parameters), this module handles queries
and business rules (completion timestamps, multi-day task ranges, money
aggregation, calendar bucketing). Functions take an explicit
:class:`~sqlalchemy.orm.Session` and commit their own writes.
"""

import calendar as pycalendar
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas
from app.models import (
    MAX_TASK_SPAN_DAYS,
    FinanceKind,
    FinancialLog,
    StudySession,
    TaskItem,
    TaskScope,
    TaskStatus,
    cents_to_decimal,
    utcnow,
)


class StudySessionError(ValueError):
    """Raised for invalid study-session operations (bad range, unknown task).

    Routers translate this into ``422 Unprocessable Content``.
    """


class TaskDateRangeError(ValueError):
    """Raised when an update would give a task an invalid date range.

    Routers translate this into ``422 Unprocessable Content``.
    """


# ===========================================================================
# Tasks
# ===========================================================================


def _apply_status(task: TaskItem, status: TaskStatus) -> None:
    """Move a task to ``status`` and keep the derived fields consistent.

    * ``is_completed`` always equals ``status == done``.
    * Reaching ``done`` stamps ``completed_at``; leaving ``done`` clears it.
    * Re-sending the current status is a no-op, so the original completion
      time is preserved if a client sends ``done`` twice.
    """
    if status == task.status:
        return
    task.status = status
    task.is_completed = status == TaskStatus.DONE
    task.completed_at = utcnow() if status == TaskStatus.DONE else None


def _apply_completion(task: TaskItem, is_completed: bool) -> None:
    """Legacy boolean API mapped onto the status workflow.

    ``True`` → ``done``. ``False`` reopens a *done* task to ``todo`` but
    leaves an ``in_progress`` task untouched (it is already not completed).
    """
    if is_completed:
        _apply_status(task, TaskStatus.DONE)
    elif task.status == TaskStatus.DONE:
        _apply_status(task, TaskStatus.TODO)


def _normalize_task_range(due_date: date, end_date: date | None) -> date | None:
    """Validate a task's date range and return the ``end_date`` to store.

    Rules:
        * ``end_date`` may not precede ``due_date``.
        * The span (inclusive) may not exceed :data:`MAX_TASK_SPAN_DAYS`.
        * ``end_date == due_date`` is stored as ``None`` (single-day task), so
          every task has exactly one canonical representation.

    Raises:
        TaskDateRangeError: If the range is invalid.
    """
    if end_date is None:
        return None
    if end_date < due_date:
        raise TaskDateRangeError("end_date cannot be before due_date")
    if (end_date - due_date).days + 1 > MAX_TASK_SPAN_DAYS:
        raise TaskDateRangeError(f"A task can span at most {MAX_TASK_SPAN_DAYS} days")
    return None if end_date == due_date else end_date


def list_tasks(
    db: Session,
    *,
    scope: TaskScope | None = None,
    start: date | None = None,
    end: date | None = None,
    completed: bool | None = None,
    status: TaskStatus | None = None,
) -> Sequence[TaskItem]:
    """Return tasks matching the optional filters.

    Date filtering uses *overlap* semantics: a task matches when any day of
    its ``[due_date, end_date]`` range falls inside ``[start, end]``. For
    single-day tasks this is identical to filtering on ``due_date``; for
    multi-day tasks it means a trip from Oct 30 to Nov 2 shows up in both
    the October and the November views.

    Args:
        db: Active session.
        scope: Only tasks with this scope.
        start: Only tasks that end on or after this date.
        end: Only tasks that start on or before this date.
        completed: ``True`` for done tasks, ``False`` for open tasks.
        status: Only tasks in this workflow status.

    Returns:
        Tasks ordered by start date, then priority (high first), then id.
    """
    stmt = select(TaskItem)
    if scope is not None:
        stmt = stmt.where(TaskItem.scope == scope)
    if start is not None:
        # Last day of the task = end_date, or due_date for single-day tasks.
        stmt = stmt.where(func.coalesce(TaskItem.end_date, TaskItem.due_date) >= start)
    if end is not None:
        stmt = stmt.where(TaskItem.due_date <= end)
    if completed is not None:
        stmt = stmt.where(TaskItem.is_completed == completed)
    if status is not None:
        stmt = stmt.where(TaskItem.status == status)
    stmt = stmt.order_by(TaskItem.due_date, TaskItem.priority.desc(), TaskItem.id)
    return db.scalars(stmt).all()


def get_task(db: Session, task_id: int) -> TaskItem | None:
    """Return the task with ``task_id`` or ``None`` if it does not exist."""
    return db.get(TaskItem, task_id)


def create_task(db: Session, payload: schemas.TaskCreate) -> TaskItem:
    """Insert a new task (``todo`` unless a status is given) and return it.

    Raises:
        TaskDateRangeError: If the date range is invalid (normally already
            caught by schema validation; re-checked here for direct callers).
    """
    data = payload.model_dump()
    data["end_date"] = _normalize_task_range(data["due_date"], data["end_date"])
    status = data.pop("status")
    task = TaskItem(**data, status=TaskStatus.TODO, is_completed=False)
    _apply_status(task, status)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, task: TaskItem, payload: schemas.TaskUpdate) -> TaskItem:
    """Apply a partial update to ``task``.

    Only fields the client explicitly sent are changed. Date handling follows
    calendar-app conventions:

    * ``due_date`` only → **move**: a multi-day task keeps its length, its
      ``end_date`` shifting by the same delta (what drag-and-drop needs).
    * ``end_date`` sent (with or without ``due_date``) → **set/resize** the
      range explicitly; ``null`` collapses it to a single day.

    The resulting range is validated *before* anything is modified, so a
    rejected update leaves the task untouched.

    Status: ``status`` is applied through :func:`_apply_status`; the legacy
    ``is_completed`` flag is honoured only when ``status`` is not sent.
    Either way ``is_completed`` and ``completed_at`` stay consistent.

    Raises:
        TaskDateRangeError: If the resulting date range is invalid.
    """
    changes = payload.model_dump(exclude_unset=True)
    is_completed = changes.pop("is_completed", None)
    status = changes.pop("status", None)

    new_due = changes.get("due_date", task.due_date)
    if "end_date" in changes:
        new_end = changes["end_date"]
    elif "due_date" in changes and task.end_date is not None:
        new_end = task.end_date + (new_due - task.due_date)
    else:
        new_end = task.end_date
    changes["due_date"] = new_due
    changes["end_date"] = _normalize_task_range(new_due, new_end)

    for field_name, value in changes.items():
        setattr(task, field_name, value)
    if status is not None:
        _apply_status(task, status)
    elif is_completed is not None:
        _apply_completion(task, is_completed)

    db.commit()
    db.refresh(task)
    return task


def toggle_task(db: Session, task: TaskItem) -> TaskItem:
    """The checkbox action: ``done`` → ``todo``; ``todo``/``in_progress`` → ``done``."""
    _apply_status(task, TaskStatus.TODO if task.status == TaskStatus.DONE else TaskStatus.DONE)
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
    is_paid: bool | None = None,
) -> Sequence[FinancialLog]:
    """Return financial logs matching the optional filters.

    Args:
        db: Active session.
        start: Only entries on or after this date.
        end: Only entries on or before this date.
        kind: Only income or only expense entries.
        category: Exact (case-sensitive) category match.
        is_paid: ``True`` for settled entries, ``False`` for pending ones.

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
    if is_paid is not None:
        stmt = stmt.where(FinancialLog.is_paid == is_paid)
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


def toggle_finance_paid(db: Session, log: FinancialLog) -> FinancialLog:
    """Flip a financial log between paid and pending (the quick checkbox)."""
    log.is_paid = not log.is_paid
    db.commit()
    db.refresh(log)
    return log


def delete_finance_log(db: Session, log: FinancialLog) -> None:
    """Permanently remove ``log``."""
    db.delete(log)
    db.commit()


@dataclass
class _MoneySplit:
    """Paid/pending cent totals for one bucket of entries."""

    paid: int = 0
    pending: int = 0

    def add(self, cents: int, is_paid: bool) -> None:
        """Accumulate ``cents`` into the paid or pending side."""
        if is_paid:
            self.paid += cents
        else:
            self.pending += cents

    @property
    def total(self) -> int:
        """Paid plus pending."""
        return self.paid + self.pending


def monthly_finance_summary(db: Session, year: int, month: int) -> schemas.FinanceSummary:
    """Aggregate one calendar month into a forward-looking cash-flow summary.

    Two grouped SQL queries do the heavy lifting (sums are exact because
    amounts are stored as integer cents):

    1. ``GROUP BY category, kind, is_paid`` → per-category paid/pending
       breakdown and the month's grand totals.
    2. ``GROUP BY occurred_on, kind, is_paid`` → per-day series.

    A third query fetches the month's unpaid entries for the "upcoming
    payments" list. The daily series is expanded to include every day of the
    month, with zeros for quiet days, so charts can consume it directly.

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

    # -- 1. Per-category totals, split by paid/pending ---------------------
    category_rows = db.execute(
        select(
            FinancialLog.category,
            FinancialLog.kind,
            FinancialLog.is_paid,
            func.sum(FinancialLog.amount_cents),
            func.count(FinancialLog.id),
        )
        .where(in_month)
        .group_by(FinancialLog.category, FinancialLog.kind, FinancialLog.is_paid)
    ).all()

    income = _MoneySplit()
    expense = _MoneySplit()
    entry_count = 0
    # (category, kind) -> [split, count]; merged across the is_paid groups.
    per_category: dict[tuple[str, FinanceKind], tuple[_MoneySplit, list[int]]] = {}
    for category, kind, is_paid, total_cents, count in category_rows:
        entry_count += count
        (income if kind == FinanceKind.INCOME else expense).add(total_cents, is_paid)
        split, counter = per_category.setdefault((category, kind), (_MoneySplit(), [0]))
        split.add(total_cents, is_paid)
        counter[0] += count

    # Order: income before expense, then largest total first, then by name.
    ordered_categories = sorted(
        per_category.items(),
        key=lambda item: (item[0][1] != FinanceKind.INCOME, -item[1][0].total, item[0][0]),
    )
    by_category = [
        schemas.CategoryBreakdown(
            category=category,
            kind=kind,
            total=cents_to_decimal(split.total),
            paid_total=cents_to_decimal(split.paid),
            pending_total=cents_to_decimal(split.pending),
            count=counter[0],
        )
        for (category, kind), (split, counter) in ordered_categories
    ]

    # -- 2. Per-day series --------------------------------------------------
    daily_splits: dict[date, dict[FinanceKind, _MoneySplit]] = {
        first_day + timedelta(days=offset): {FinanceKind.INCOME: _MoneySplit(), FinanceKind.EXPENSE: _MoneySplit()}
        for offset in range(days_in_month)
    }
    day_rows = db.execute(
        select(
            FinancialLog.occurred_on,
            FinancialLog.kind,
            FinancialLog.is_paid,
            func.sum(FinancialLog.amount_cents),
        )
        .where(in_month)
        .group_by(FinancialLog.occurred_on, FinancialLog.kind, FinancialLog.is_paid)
    ).all()
    for occurred_on, kind, is_paid, total_cents in day_rows:
        daily_splits[occurred_on][kind].add(total_cents, is_paid)

    daily = [
        schemas.DailyNet(
            date=day,
            income=cents_to_decimal(splits[FinanceKind.INCOME].total),
            expense=cents_to_decimal(splits[FinanceKind.EXPENSE].total),
            net=cents_to_decimal(splits[FinanceKind.INCOME].total - splits[FinanceKind.EXPENSE].total),
            income_pending=cents_to_decimal(splits[FinanceKind.INCOME].pending),
            expense_pending=cents_to_decimal(splits[FinanceKind.EXPENSE].pending),
        )
        for day, splits in daily_splits.items()
    ]

    # -- 3. Unpaid entries (the "still to pay / still to receive" list) -----
    pending_logs = list_finance_logs(db, start=first_day, end=last_day, is_paid=False)

    net_cents = income.total - expense.total
    return schemas.FinanceSummary(
        year=year,
        month=month,
        income_total=cents_to_decimal(income.total),
        income_received=cents_to_decimal(income.paid),
        income_pending=cents_to_decimal(income.pending),
        expense_total=cents_to_decimal(expense.total),
        expense_paid=cents_to_decimal(expense.paid),
        expense_pending=cents_to_decimal(expense.pending),
        net=cents_to_decimal(net_cents),
        # received income − paid − pending: expected (not yet received)
        # income is deliberately left out until it actually arrives.
        remaining_budget=cents_to_decimal(income.paid - expense.paid - expense.pending),
        cash_balance=cents_to_decimal(income.paid - expense.paid),
        entry_count=entry_count,
        pending_count=len(pending_logs),
        by_category=by_category,
        daily=daily,
        pending=[schemas.FinanceRead.model_validate(log) for log in pending_logs],
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
    pending_expense_cents: int = 0

    @property
    def completed_count(self) -> int:
        """Number of completed tasks in this bucket."""
        return sum(1 for task in self.tasks if task.is_completed)


def _calendar_task_order(task: TaskItem) -> tuple[bool, date, int, int, int]:
    """Sort key for tasks inside one calendar day.

    Multi-day tasks come first, ordered by earliest start, then longest span,
    then id. Because this order is identical on every day a task covers,
    clients can assign each multi-day task a stable "lane" and draw it as one
    continuous bar. Single-day tasks follow, highest priority first.
    """
    if task.is_multi_day:
        return (False, task.due_date, -task.span_days, 0, task.id)
    return (True, date.min, 0, -task.priority, task.id)


def build_calendar(db: Session, start: date, end: date) -> schemas.CalendarResponse:
    """Group tasks and financial logs by day for the calendar grid.

    Algorithm:
        1. Pre-create an empty bucket for every day in ``[start, end]`` so the
           response always has one entry per day.
        2. Fetch all tasks overlapping the range and all financial logs inside
           it, with exactly two queries (no per-day N+1 queries).
        3. Inject each task into the bucket of *every* day it covers, clipped
           to the visible range (a trip starting before ``start`` still shows
           on the first visible days). Drop each financial log into its day,
           accumulating money in cents.
        4. Sort each day's tasks with :func:`_calendar_task_order`, convert
           buckets to response models, and compute range totals (each task
           counted once, however many days it spans).

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

    tasks = list_tasks(db, start=start, end=end)
    for task in tasks:
        first_visible = max(task.due_date, start)
        last_visible = min(task.last_date, end)
        for offset in range((last_visible - first_visible).days + 1):
            buckets[first_visible + timedelta(days=offset)].tasks.append(task)

    total_income = total_expense = total_pending = 0
    for log in list_finance_logs(db, start=start, end=end):
        bucket = buckets[log.occurred_on]
        bucket.finance.append(log)
        if log.kind == FinanceKind.INCOME:
            bucket.income_cents += log.amount_cents
            total_income += log.amount_cents
        else:
            bucket.expense_cents += log.amount_cents
            total_expense += log.amount_cents
            if not log.is_paid:
                bucket.pending_expense_cents += log.amount_cents
                total_pending += log.amount_cents

    # Serialise each task once and reuse it for every day it appears on.
    task_models = {task.id: schemas.TaskRead.model_validate(task) for task in tasks}

    days: list[schemas.CalendarDay] = []
    for day, bucket in buckets.items():
        bucket.tasks.sort(key=_calendar_task_order)
        completed = bucket.completed_count
        days.append(
            schemas.CalendarDay(
                date=day,
                tasks=[task_models[task.id] for task in bucket.tasks],
                finance=[schemas.FinanceRead.model_validate(log) for log in bucket.finance],
                income_total=cents_to_decimal(bucket.income_cents),
                expense_total=cents_to_decimal(bucket.expense_cents),
                pending_expense_total=cents_to_decimal(bucket.pending_expense_cents),
                net=cents_to_decimal(bucket.income_cents - bucket.expense_cents),
                open_task_count=len(bucket.tasks) - completed,
                completed_task_count=completed,
            )
        )

    completed_tasks = sum(1 for task in tasks if task.is_completed)
    return schemas.CalendarResponse(
        start=start,
        end=end,
        days=days,
        totals=schemas.CalendarTotals(
            income_total=cents_to_decimal(total_income),
            expense_total=cents_to_decimal(total_expense),
            pending_expense_total=cents_to_decimal(total_pending),
            net=cents_to_decimal(total_income - total_expense),
            task_count=len(tasks),
            open_task_count=len(tasks) - completed_tasks,
            completed_task_count=completed_tasks,
        ),
    )


# ===========================================================================
# Study sessions (timer)
# ===========================================================================

#: Longest allowed session, matching the schema validation.
_MAX_SESSION = timedelta(hours=schemas.MAX_STUDY_SESSION_HOURS)


def _check_task_exists(db: Session, task_id: int | None) -> None:
    """Raise :class:`StudySessionError` if ``task_id`` does not refer to a task."""
    if task_id is not None and db.get(TaskItem, task_id) is None:
        raise StudySessionError(f"Task {task_id} does not exist")


def _check_session_range(started_at: datetime, ended_at: datetime | None) -> None:
    """Validate a session's time range (end after start, at most 24 hours)."""
    if ended_at is None:
        return
    if ended_at <= started_at:
        raise StudySessionError("ended_at must be after started_at")
    if ended_at - started_at > _MAX_SESSION:
        raise StudySessionError(f"A session can last at most {schemas.MAX_STUDY_SESSION_HOURS} hours")


def get_active_study_session(db: Session) -> StudySession | None:
    """Return the running session (``ended_at IS NULL``), if any."""
    return db.scalars(
        select(StudySession).where(StudySession.ended_at.is_(None)).order_by(StudySession.started_at.desc())
    ).first()


def _close(session: StudySession, now: datetime) -> None:
    """Stop a running session at ``now``, capped at the 24-hour maximum.

    A session left running far too long (e.g. a forgotten timer over a
    weekend) is closed at ``started_at + 24h`` rather than recording an
    impossible duration. A stop within the same second as the start is
    bumped to one second so ``ended_at > started_at`` always holds.
    """
    end = min(now, session.started_at + _MAX_SESSION)
    if end <= session.started_at:
        end = session.started_at + timedelta(seconds=1)
    session.ended_at = end


def start_study_session(db: Session, payload: schemas.StudyStart) -> StudySession:
    """Start a new session now, stopping any running one first.

    Raises:
        StudySessionError: If ``task_id`` refers to a missing task.
    """
    _check_task_exists(db, payload.task_id)
    now = utcnow()
    running = get_active_study_session(db)
    if running is not None:
        _close(running, now)
    session = StudySession(**payload.model_dump(), started_at=now)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def stop_study_session(db: Session) -> StudySession | None:
    """Stop the running session now. Returns ``None`` if nothing was running."""
    running = get_active_study_session(db)
    if running is None:
        return None
    _close(running, utcnow())
    db.commit()
    db.refresh(running)
    return running


def list_study_sessions(
    db: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    task_id: int | None = None,
) -> Sequence[StudySession]:
    """Sessions that *started* in ``[start, end)``, newest first.

    Args:
        db: Active session.
        start: Inclusive lower bound on ``started_at`` (timezone-aware).
        end: Exclusive upper bound on ``started_at`` (timezone-aware).
        task_id: Only sessions linked to this task.
    """
    stmt = select(StudySession)
    if start is not None:
        stmt = stmt.where(StudySession.started_at >= start)
    if end is not None:
        stmt = stmt.where(StudySession.started_at < end)
    if task_id is not None:
        stmt = stmt.where(StudySession.task_id == task_id)
    return db.scalars(stmt.order_by(StudySession.started_at.desc(), StudySession.id.desc())).unique().all()


def get_study_session(db: Session, session_id: int) -> StudySession | None:
    """Return a session by id, or ``None``."""
    return db.get(StudySession, session_id)


def create_study_session(db: Session, payload: schemas.StudySessionCreate) -> StudySession:
    """Log a completed session by hand (e.g. study done away from the computer).

    Raises:
        StudySessionError: If ``task_id`` refers to a missing task.
    """
    _check_task_exists(db, payload.task_id)
    session = StudySession(**payload.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def update_study_session(
    db: Session, session: StudySession, payload: schemas.StudySessionUpdate
) -> StudySession:
    """Apply a partial update, validating the resulting time range first.

    Raises:
        StudySessionError: For an invalid range, an end time on a running
            session that is in the future, or a missing task.
    """
    changes = payload.model_dump(exclude_unset=True)
    if "task_id" in changes:
        _check_task_exists(db, changes["task_id"])
    started_at = changes.get("started_at", session.started_at)
    ended_at = changes.get("ended_at", session.ended_at)
    if ended_at is None and started_at > utcnow():
        raise StudySessionError("A running session cannot start in the future")
    if ended_at is not None and ended_at > utcnow() + timedelta(minutes=1):
        raise StudySessionError("ended_at cannot be in the future")
    _check_session_range(started_at, ended_at)
    for field_name, value in changes.items():
        setattr(session, field_name, value)
    db.commit()
    db.refresh(session)
    return session


def delete_study_session(db: Session, session: StudySession) -> None:
    """Permanently remove a session."""
    db.delete(session)
    db.commit()


def study_summary(db: Session, start: date, end: date, tz_name: str) -> schemas.StudySummary:
    """Totals per local day and per subject for ``[start, end]`` in ``tz_name``.

    The range's local midnights are converted to UTC for the query; each
    completed session is credited to the local day it started on. The running
    session is excluded from the totals and returned as ``active`` so the
    client can tick its elapsed time live.

    Raises:
        StudySessionError: For an unknown time zone or an inverted range.
    """
    try:
        tz = ZoneInfo(tz_name)
    except (KeyError, ValueError) as error:
        raise StudySessionError(f"Unknown time zone: {tz_name}") from error
    if end < start:
        raise StudySessionError("'end' must be on or after 'start'")

    range_start = datetime.combine(start, time.min, tzinfo=tz).astimezone(UTC)
    range_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    sessions = list_study_sessions(db, start=range_start, end=range_end)

    day_seconds = {start + timedelta(days=offset): [0, 0] for offset in range((end - start).days + 1)}
    subject_seconds: dict[str, list[int]] = {}
    for session in sessions:
        seconds = session.duration_seconds
        if seconds is None:
            continue  # Running: reported separately as `active`.
        local_day = session.started_at.astimezone(tz).date()
        if local_day in day_seconds:
            day_seconds[local_day][0] += seconds
            day_seconds[local_day][1] += 1
        bucket = subject_seconds.setdefault(session.subject, [0, 0])
        bucket[0] += seconds
        bucket[1] += 1

    active = get_active_study_session(db)
    return schemas.StudySummary(
        start=start,
        end=end,
        tz=tz_name,
        total_seconds=sum(value[0] for value in day_seconds.values()),
        session_count=sum(value[1] for value in day_seconds.values()),
        days=[schemas.StudyDay(date=day, seconds=v[0], session_count=v[1]) for day, v in day_seconds.items()],
        by_subject=[
            schemas.StudySubjectTotal(subject=subject, seconds=v[0], session_count=v[1])
            for subject, v in sorted(subject_seconds.items(), key=lambda item: (-item[1][0], item[0]))
        ],
        active=schemas.StudySessionRead.model_validate(active) if active is not None else None,
    )
