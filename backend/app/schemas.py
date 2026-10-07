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

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

from app.models import FinanceKind, TaskScope

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
    """Payload for creating a task."""

    title: TaskTitle
    description: LongText | None = None
    scope: TaskScope = TaskScope.DAILY
    due_date: date
    priority: Priority = 1
    color: HexColor | None = None


class TaskUpdate(_PatchModel):
    """Partial update for a task.

    ``is_completed`` may be set here as well as via the dedicated toggle
    endpoint; either way the server maintains ``completed_at``.
    """

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"title", "scope", "due_date", "priority", "is_completed"}
    )

    title: TaskTitle | None = None
    description: LongText | None = None
    scope: TaskScope | None = None
    due_date: date | None = None
    priority: Priority | None = None
    color: HexColor | None = None
    is_completed: bool | None = None


class TaskRead(BaseModel):
    """A task as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    scope: TaskScope
    due_date: date
    priority: int
    color: str | None
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Financial logs
# ---------------------------------------------------------------------------


class FinanceCreate(_InputModel):
    """Payload for recording an income or expense."""

    kind: FinanceKind
    amount: PositiveAmount
    currency: CurrencyCode = "TRY"
    category: CategoryName
    description: LongText | None = None
    occurred_on: date


class FinanceUpdate(_PatchModel):
    """Partial update for a financial log."""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"kind", "amount", "currency", "category", "occurred_on"}
    )

    kind: FinanceKind | None = None
    amount: PositiveAmount | None = None
    currency: CurrencyCode | None = None
    category: CategoryName | None = None
    description: LongText | None = None
    occurred_on: date | None = None


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
    created_at: datetime
    updated_at: datetime


class CategoryBreakdown(BaseModel):
    """Total and entry count for one ``(category, kind)`` pair in a period."""

    category: str
    kind: FinanceKind
    total: Money
    count: int


class DailyNet(BaseModel):
    """Income, expense and net for a single day (one point of a chart series)."""

    date: date
    income: Money
    expense: Money
    net: Money


class FinanceSummary(BaseModel):
    """Monthly roll-up powering the finance tab.

    ``daily`` contains one entry for *every* day of the month, including days
    with no activity, so clients can plot it without filling gaps.
    """

    year: int
    month: int
    income_total: Money
    expense_total: Money
    net: Money
    entry_count: int
    by_category: list[CategoryBreakdown]
    daily: list[DailyNet]


# ---------------------------------------------------------------------------
# Calendar aggregation
# ---------------------------------------------------------------------------


class CalendarDay(BaseModel):
    """Everything the calendar grid needs to render one cell."""

    date: date
    tasks: list[TaskRead]
    finance: list[FinanceRead]
    income_total: Money
    expense_total: Money
    net: Money
    open_task_count: int
    completed_task_count: int


class CalendarTotals(BaseModel):
    """Totals across the whole requested range (e.g. a month header)."""

    income_total: Money
    expense_total: Money
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
# Misc
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Liveness probe payload, also useful for clients to check connectivity."""

    status: str
    app: str
    version: str
    server_time: datetime
