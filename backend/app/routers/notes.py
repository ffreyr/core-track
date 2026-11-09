"""Notepad endpoints: create, list/search, edit, pin and delete notes.

Mounted at ``/api/notes``.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.models import Note

router = APIRouter(prefix="/notes", tags=["notes"])

DbSession = Annotated[Session, Depends(get_db)]


def _get_or_404(db: Session, note_id: int) -> Note:
    """Load a note or abort with ``404 Not Found``."""
    note = crud.get_note(db, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Note {note_id} not found")
    return note


@router.get("", response_model=list[schemas.NoteRead], summary="List notes")
def list_notes(
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200, description="Text to search for in title or body")] = None,
    pinned: Annotated[bool | None, Query(description="Only pinned / only unpinned notes")] = None,
) -> list[Note]:
    """Return notes, pinned first, then most recently edited."""
    return list(crud.list_notes(db, q=q.strip() if q else None, pinned=pinned))


@router.post("", response_model=schemas.NoteRead, status_code=status.HTTP_201_CREATED, summary="Create a note")
def create_note(payload: schemas.NoteCreate, db: DbSession) -> Note:
    """Create a note. It needs a title or some text."""
    return crud.create_note(db, payload)


@router.get("/{note_id}", response_model=schemas.NoteRead, summary="Get a note")
def get_note(note_id: int, db: DbSession) -> Note:
    """Return one note."""
    return _get_or_404(db, note_id)


@router.patch("/{note_id}", response_model=schemas.NoteRead, summary="Edit a note")
def update_note(note_id: int, payload: schemas.NoteUpdate, db: DbSession) -> Note:
    """Partially update a note (title, body, pinned)."""
    return crud.update_note(db, _get_or_404(db, note_id), payload)


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a note",
)
def delete_note(note_id: int, db: DbSession) -> Response:
    """Permanently delete a note."""
    crud.delete_note(db, _get_or_404(db, note_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
