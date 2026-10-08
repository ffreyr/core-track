"""Pydantic v2 request/response schemas.

Naming convention per resource:

* ``<Resource>Create`` – body of ``POST``; required fields enforced.
* ``<Resource>Update`` – body of ``PATCH``; every field optional, only fields
  the client actually sends are applied (``exclude_unset``).
* ``<Resource>Read``   – response shape, built from ORM objects
  (``from_attributes=True``).

Input models use ``extra="forbid"`` so a typo in a field name is reported as a
422 instead of being silently ignored.

Money is accepted as a decimal with at most two fractional digits and emitted
in JSON as a plain number (e.g. ``149.9``) so JavaScript and Swift clients can
use it directly without string parsing.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, ClassVar, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, PlainSerializer, model_validator

from app.models import MAX_TASK_SPAN_DAYS, FinanceKind, TaskScope, TaskStatus

# ---------------------------------------------------------------------------
# Reusable field types
# ---------------------------------------------------------------------------

#: Monetary value serialised as a JSON number.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

#: Strictly positive input amount with at most 10 integer and 2 fractional digits.
PositiveAmount = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]

#: ``#RRGGBB`` color used to tint calendar chips.
HexColor = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]

#: Upper-case ISO-4217 currency code such as ``TRY`` or ``USD``.
CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]

#: Task priority: 0 = none, 1 = low, 2 = medium, 3 = high.
Priority = Annotated[int, Field(ge=0, le=3)]

TaskTitle = Annotated[str, Field(min_length=1, max_length=200)]
CategoryName = Annotated[str, Field(min_length=1, max_length=60)]
LongText = Annotated[str, Field(max_length=2000)]


class _InputModel(BaseModel):
    """Base for request bodies: trims strings and rejects unknown fields."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class _PatchModel(_InputModel):
    """Base for ``PATCH`` bodies.

    All fields on a patch model are optional so clients can send only what
    changed. However, sending an explicit ``null`` for a column that is
    ``NOT NULL`` in the database (e.g. ``title``) would crash on commit, so
    subclasses list such fields in :attr:`NON_NULLABLE` and this validator
    turns that mistake into a clean 422.
    """

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> Self:
        """Raise if a non-nullable field was explicitly sent as ``null``."""
        offending = sorted(
            name
            for name in self.model_fields_set & self.NON_NULLABLE
            if getattr(self, name) is None
        )
        if offending:
            raise ValueError(f"These fields cannot be null: {', '.join(offending)}")
        return self


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


class TaskCreate(_InputModel):
    """Payload for creating a task.

    ``end_date`` turns the task into a multi-day block (Google Calendar style)
    covering ``due_date`` through ``end_date`` inclusive. Omit it, or send the
    same day as ``due_date``, for a single-day task.
    """

    title: TaskTitle
    description: LongText | None = None
    scope: TaskScope = TaskScope.DAILY
    due_date: date
    end_date: date | None = None
    priority: Priority = 1
    color: HexColor | None = None
    status: TaskStatus = TaskStatus.TODO

    @model_validator(mode="after")
    def _validate_date_range(self) -> Self:
        """Enforce ``due_date <= end_date`` and the maximum span.

        An ``end_date`` equal to ``due_date`` is normalised to ``None`` so a
        single-day task always has exactly one representation.
        """
        if self.end_date is not None:
            if self.end_date < self.due_date:
                raise ValueError("end_date cannot be before due_date")
            if (self.end_date - self.due_date).days + 1 > MAX_TASK_SPAN_DAYS:
                raise ValueError(f"A task can span at most {MAX_TASK_SPAN_DAYS} days")
            if self.end_date == self.due_date:
                self.end_date = None
        return self


class TaskUpdate(_PatchModel):
    """Partial update for a task.

    Date semantics (mirroring how calendar apps behave):
        * Sending only ``due_date`` *moves* the task; a multi-day task keeps
          its length (``end_date`` shifts by the same number of days).
        * Sending ``end_date`` *resizes* the task; ``null`` makes it a
          single-day task again.
        * Sending both sets the range explicitly.
    The resulting range is validated in :func:`app.crud.update_task` because
    it depends on the task's current values.

    Status: send ``status`` (``todo`` / ``in_progress`` / ``done``). The
    legacy ``is_completed`` boolean is still accepted and is ignored when
    ``status`` is sent too. The server maintains ``completed_at``.
    """

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"title", "scope", "due_date", "priority", "is_completed", "status"}
    )

    title: TaskTitle | None = None
    description: LongText | None = None
    scope: TaskScope | None = None
    due_date: date | None = None
    end_date: date | None = None
    priority: Priority | None = None
    color: HexColor | None = None
    is_completed: bool | None = None
    status: TaskStatus | None = None


class TaskRead(BaseModel):
    """A task as returned by the API.

    ``end_date`` is ``null`` for single-day tasks; ``span_days`` is always
    present (1 for single-day tasks) so clients can size calendar bars
    without date arithmetic.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    scope: TaskScope
    due_date: date
    end_date: date | None
    span_days: int
    priority: int
    color: str | None
    status: TaskStatus
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Financial logs
# ---------------------------------------------------------------------------


class FinanceCreate(_InputModel):
    """Payload for recording an income or expense.

    Set ``is_paid`` to ``false`` to plan a future payment (or expected
    income); it then appears as "pending" until marked paid.
    """

    kind: FinanceKind
    amount: PositiveAmount
    currency: CurrencyCode = "TRY"
    category: CategoryName
    description: LongText | None = None
    occurred_on: date
    is_paid: bool = True


class FinanceUpdate(_PatchModel):
    """Partial update for a financial log."""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"kind", "amount", "currency", "category", "occurred_on", "is_paid"}
    )

    kind: FinanceKind | None = None
    amount: PositiveAmount | None = None
    currency: CurrencyCode | None = None
    category: CategoryName | None = None
    description: LongText | None = None
    occurred_on: date | None = None
    is_paid: bool | None = None


class FinanceRead(BaseModel):
    """A financial log as returned by the API (``amount`` in major units)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: FinanceKind
    amount: Money
    currency: str
    category: str
    description: str | None
    occurred_on: date
    is_paid: bool
    created_at: datetime
    updated_at: datetime


class CategoryBreakdown(BaseModel):
    """Totals for one ``(category, kind)`` pair in a period.

    ``total`` = ``paid_total`` + ``pending_total``.
    """

    category: str
    kind: FinanceKind
    total: Money
    paid_total: Money
    pending_total: Money
    count: int


class DailyNet(BaseModel):
    """Income, expense and net for a single day (one point of a chart series).

    ``income``/``expense`` include pending entries; the ``*_pending`` fields
    show how much of each is still planned rather than settled.
    """

    date: date
    income: Money
    expense: Money
    net: Money
    income_pending: Money
    expense_pending: Money


class FinanceSummary(BaseModel):
    """Monthly cash-flow roll-up powering the finance tab.

    Totals, all for the requested month:

    * ``income_total``      – all expected income (received + pending).
    * ``income_received``   – income already received.
    * ``income_pending``    – income still expected.
    * ``expense_total``     – all expenses (paid + pending).
    * ``expense_paid``      – expenses already paid.
    * ``expense_pending``   – planned expenses not yet paid.
    * ``remaining_budget``  – ``income_received − expense_paid − expense_pending``:
      what is left of the income actually received once every known
      obligation is covered. Expected (pending) income is not counted until
      it is marked received. The headline figure of the cash-flow view.
    * ``cash_balance``      – ``income_received − expense_paid``: money that
      has actually moved so far this month.

    ``daily`` contains one entry for *every* day of the month, including days
    with no activity, so clients can plot it without filling gaps.
    ``pending`` lists the month's unpaid entries in date order, ready for an
    "upcoming payments" checklist.
    """

    year: int
    month: int
    income_total: Money
    income_received: Money
    income_pending: Money
    expense_total: Money
    expense_paid: Money
    expense_pending: Money
    net: Money
    remaining_budget: Money
    cash_balance: Money
    entry_count: int
    pending_count: int
    by_category: list[CategoryBreakdown]
    daily: list[DailyNet]
    pending: list[FinanceRead]


# ---------------------------------------------------------------------------
# Calendar aggregation
# ---------------------------------------------------------------------------


class CalendarDay(BaseModel):
    """Everything the calendar grid needs to render one cell.

    Multi-day tasks appear in the ``tasks`` list of *every* day they cover,
    always before single-day tasks and in a stable order (earliest start,
    then longest span, then id), so clients can stack them into consistent
    horizontal lanes.
    """

    date: date
    tasks: list[TaskRead]
    finance: list[FinanceRead]
    income_total: Money
    expense_total: Money
    pending_expense_total: Money
    net: Money
    open_task_count: int
    completed_task_count: int


class CalendarTotals(BaseModel):
    """Totals across the whole requested range (e.g. a month header).

    Task counts count each task once, even if it spans several days.
    """

    income_total: Money
    expense_total: Money
    pending_expense_total: Money
    net: Money
    task_count: int
    open_task_count: int
    completed_task_count: int


class CalendarResponse(BaseModel):
    """Response of ``GET /api/calendar``.

    ``days`` is ordered chronologically and contains exactly one entry per day
    from ``start`` to ``end`` inclusive.
    """

    start: date
    end: date
    days: list[CalendarDay]
    totals: CalendarTotals


# ---------------------------------------------------------------------------
# Study sessions (timer)
# ---------------------------------------------------------------------------

#: Subject / label of a study session, e.g. "Mathematics".
StudySubject = Annotated[str, Field(min_length=1, max_length=80)]

#: Optional Pomodoro target in minutes.
PlannedMinutes = Annotated[int, Field(ge=1, le=600)]

#: Longest allowed session.
MAX_STUDY_SESSION_HOURS = 24


class StudyStart(_InputModel):
    """Body of ``POST /api/study/start``.

    Starting a session stops any session that is still running.
    ``planned_minutes`` turns the session into a countdown (Pomodoro).
    """

    subject: StudySubject = "Study"
    task_id: int | None = None
    planned_minutes: PlannedMinutes | None = None
    note: LongText | None = None


class StudySessionCreate(_InputModel):
    """Body of ``POST /api/study/sessions``: log a past session by hand.

    Timestamps must include a timezone offset (e.g. ``2026-10-08T14:00:00+03:00``).
    """

    subject: StudySubject
    task_id: int | None = None
    started_at: AwareDatetime
    ended_at: AwareDatetime
    note: LongText | None = None

    @model_validator(mode="after")
    def _validate_range(self) -> Self:
        """``ended_at`` after ``started_at``, at most 24 hours apart."""
        if self.ended_at <= self.started_at:
            raise ValueError("ended_at must be after started_at")
        if (self.ended_at - self.started_at).total_seconds() > MAX_STUDY_SESSION_HOURS * 3600:
            raise ValueError(f"A session can last at most {MAX_STUDY_SESSION_HOURS} hours")
        return self


class StudySessionUpdate(_PatchModel):
    """Partial update of a session (subject, task link, times, note).

    ``ended_at`` cannot be cleared (use ``POST /api/study/start`` to run a new
    session). The resulting time range is validated in :mod:`app.crud`.
    """

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset({"subject", "started_at", "ended_at"})

    subject: StudySubject | None = None
    task_id: int | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    planned_minutes: PlannedMinutes | None = None
    note: LongText | None = None


class StudySessionRead(BaseModel):
    """A study session as returned by the API.

    ``duration_seconds`` is ``null`` while the session is running; clients
    compute the live elapsed time from ``started_at``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    task_id: int | None
    task_title: str | None
    started_at: datetime
    ended_at: datetime | None
    is_running: bool
    duration_seconds: int | None
    planned_minutes: int | None
    note: str | None
    created_at: datetime
    updated_at: datetime


class StudyDay(BaseModel):
    """Completed study time on one local calendar day."""

    date: date
    seconds: int
    session_count: int


class StudySubjectTotal(BaseModel):
    """Completed study time for one subject within the summary range."""

    subject: str
    seconds: int
    session_count: int


class StudySummary(BaseModel):
    """Study totals for a range of local days (``GET /api/study/summary``).

    Sessions count toward the local day (in ``tz``) on which they *started*.
    Only completed sessions are summed; the running session, if any, is
    returned in ``active`` so clients can add its live elapsed time.
    ``days`` contains every day of the range, zero-filled.
    """

    start: date
    end: date
    tz: str
    total_seconds: int
    session_count: int
    days: list[StudyDay]
    by_subject: list[StudySubjectTotal]
    active: StudySessionRead | None


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Liveness probe payload, also useful for clients to check connectivity."""

    status: str
    app: str
    version: str
    server_time: datetime
