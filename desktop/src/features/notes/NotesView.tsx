/**
 * Notes tab: a simple notepad.
 *
 *   ┌──────── list ────────┐ ┌─────────────────── editor ───────────────────┐
 *   │ [🔍 Search notes   ] │ │ Title                         📌  🗑         │
 *   │ 📌 Exam plan    14:02 │ │ ──────────────────────────────────────────── │
 *   │    Read ch. 4 …       │ │ Free-form text…                              │
 *   │ Shopping       12 Oct │ │                                              │
 *   │    milk, eggs         │ │                                              │
 *   └───────────────────────┘ │ 132 words · 812 characters        Saved ✓   │
 *                             └──────────────────────────────────────────────┘
 *
 * Basic functions: create, edit with autosave, search (title and text), pin to
 * the top, and delete.
 *
 * Autosave: edits are written ~0.6 s after typing stops, when switching notes
 * and when leaving the tab. Saves run one after another through a promise
 * chain, so a new note is created exactly once even if the user keeps typing
 * while the first save is still in flight. A "New note" exists only locally
 * until it has a title or some text; empty notes are never stored.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage, type Note } from "../../api";
import { ConfirmDeleteButton, ErrorNotice } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { broadcastDataChanged } from "../../lib/desktopBridge";
import { useToast } from "../../state/toasts";

/** Delay between the last keystroke and the autosave. */
const AUTOSAVE_DELAY_MS = 600;

/** Delay between typing in the search box and querying the server. */
const SEARCH_DELAY_MS = 250;

/** The note being edited. `id` is `null` until a new note is first saved. */
interface Draft {
  /** Stable local identity for this editing session (survives the first save). */
  key: string;
  id: number | null;
  title: string;
  body: string;
  is_pinned: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

let draftCounter = 0;

/** Build a draft for an existing note, or an empty one for a new note. */
function makeDraft(note?: Note): Draft {
  draftCounter += 1;
  return {
    key: note ? `note-${note.id}` : `new-${draftCounter}`,
    id: note?.id ?? null,
    title: note?.title ?? "",
    body: note?.body ?? "",
    is_pinned: note?.is_pinned ?? false,
  };
}

/** `true` when a draft has nothing worth saving. */
function isBlank(title: string, body: string): boolean {
  return title.trim() === "" && body.trim() === "";
}

/** Title shown in the list: the title, else the first line of text. */
function displayTitle(title: string, body: string): string {
  if (title.trim()) {
    return title.trim();
  }
  const firstLine = body.split("\n").find((line) => line.trim() !== "");
  return firstLine ? firstLine.trim() : "New note";
}

/** One-line preview of the text (skips the line already used as the title). */
function preview(title: string, body: string): string {
  let text = body;
  if (!title.trim()) {
    const lines = body.split("\n");
    const index = lines.findIndex((line) => line.trim() !== "");
    text = index >= 0 ? lines.slice(index + 1).join(" ") : "";
  }
  return text.replace(/\s+/g, " ").trim();
}

/** "14:02" for today, "12 Oct" this year, "12 Oct 2025" otherwise. */
function formatEdited(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Word count for the footer. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Remembered selection: a note id or nothing. */
function sanitizeSelected(stored: unknown): number | null {
  return typeof stored === "number" && Number.isInteger(stored) ? stored : null;
}

export function NotesView() {
  const toast = useToast();
  const run = useApiAction();

  // ---- Search (debounced) --------------------------------------------------
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const notes = useApiQuery((signal) => api.notes.list(query ? { q: query } : {}, signal), [query]);

  // ---- Editor state --------------------------------------------------------
  const [rememberedId, setRememberedId] = useLocalStorage<number | null>("coretrack.notes.selected", null, sanitizeSelected);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  /** `true` while the current draft has edits that are not saved yet. */
  const dirtyRef = useRef(false);
  /** Serialises saves so they never overlap. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** Server ids of drafts created in this session, by draft key. */
  const createdIdsRef = useRef(new Map<string, number>());
  /** Draft keys deleted while a save may still be queued. */
  const deletedKeysRef = useRef(new Set<string>());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const reloadNotes = notes.reload;

  /**
   * Write the current draft's unsaved edits (if any) to the server.
   * Returns a promise that settles once every queued save is done.
   */
  const flush = useCallback((): Promise<void> => {
    const snapshot = draftRef.current;
    if (!dirtyRef.current || snapshot === null) {
      return chainRef.current;
    }
    dirtyRef.current = false;
    const { key } = snapshot;

    chainRef.current = chainRef.current.then(async () => {
      if (deletedKeysRef.current.has(key)) {
        return;
      }
      // Save the newest text if the user is still on this note.
      const current = draftRef.current?.key === key ? draftRef.current : snapshot;
      const id = current.id ?? createdIdsRef.current.get(key) ?? null;
      const isCurrent = () => draftRef.current?.key === key;

      if (id === null && isBlank(current.title, current.body)) {
        return; // Nothing to store yet.
      }
      if (isCurrent()) {
        setSaveState("saving");
      }
      try {
        const saved =
          id === null
            ? await api.notes.create({ title: current.title, body: current.body, is_pinned: current.is_pinned })
            : await api.notes.update(id, { title: current.title, body: current.body });
        createdIdsRef.current.set(key, saved.id);
        if (isCurrent()) {
          setDraft((previous) => (previous && previous.key === key ? { ...previous, id: saved.id } : previous));
          setRememberedId(saved.id);
          setSaveState("saved");
          setLastSavedAt(saved.updated_at);
        }
        reloadNotes();
        broadcastDataChanged();
      } catch (error) {
        // Keep the edit pending so the next change (or switch) retries it.
        if (isCurrent()) {
          dirtyRef.current = true;
          setSaveState("error");
        }
        toast.error(`Couldn't save the note: ${errorMessage(error)}`);
      }
    });
    return chainRef.current;
  }, [reloadNotes, setRememberedId, toast]);

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (!dirtyRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft?.title, draft?.body, flush]);

  // Save pending edits when leaving the tab.
  useEffect(() => () => void flush(), [flush]);

  /** Switch the editor to `next` after saving the current note. */
  const openDraft = useCallback(
    (next: Draft) => {
      void flush();
      dirtyRef.current = false;
      setDraft(next);
      setSaveState("idle");
      setLastSavedAt(null);
      setRememberedId(next.id);
    },
    [flush, setRememberedId],
  );

  // First load only: reopen the remembered note, else the first one. (Later
  // the editor may be empty on purpose, e.g. right after a delete while the
  // list still holds the deleted note.)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !notes.data) {
      return;
    }
    initializedRef.current = true;
    const initial = notes.data.find((note) => note.id === rememberedId) ?? notes.data[0];
    if (initial) {
      setDraft(makeDraft(initial));
      setLastSavedAt(initial.updated_at);
    }
  }, [notes.data, rememberedId]);

  const startNewNote = useCallback(() => {
    openDraft(makeDraft());
    setSearch("");
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [openDraft]);

  /** Edit a field of the current draft (marks it dirty for autosave). */
  const edit = (patch: Partial<Pick<Draft, "title" | "body">>) => {
    dirtyRef.current = true;
    setSaveState("idle");
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const togglePin = async () => {
    if (!draft) {
      return;
    }
    const pinned = !draft.is_pinned;
    setDraft({ ...draft, is_pinned: pinned });
    const id = draft.id ?? createdIdsRef.current.get(draft.key) ?? null;
    if (id === null) {
      return; // Sent with the first save.
    }
    await flush();
    const result = await run(() => api.notes.update(id, { is_pinned: pinned }), {
      success: pinned ? "Pinned to the top" : "Unpinned",
    });
    if (!result.ok) {
      setDraft((previous) => (previous && previous.key === draft.key ? { ...previous, is_pinned: !pinned } : previous));
    }
  };

  const deleteCurrent = async () => {
    if (!draft) {
      return;
    }
    const { key } = draft;
    dirtyRef.current = false;
    deletedKeysRef.current.add(key);
    await chainRef.current;
    const id = draft.id ?? createdIdsRef.current.get(key) ?? null;
    if (id !== null) {
      const result = await run(() => api.notes.remove(id), { success: "Note deleted" });
      if (!result.ok) {
        deletedKeysRef.current.delete(key);
        return;
      }
    }
    // Move to the next note in the list (or the previous one at the end).
    const list = (notes.data ?? []).filter((note) => note.id !== id);
    const index = (notes.data ?? []).findIndex((note) => note.id === id);
    const next = list[Math.min(Math.max(index, 0), list.length - 1)];
    setDraft(next ? makeDraft(next) : null);
    setLastSavedAt(next?.updated_at ?? null);
    setRememberedId(next?.id ?? null);
    setSaveState("idle");
  };

  // ---- List ---------------------------------------------------------------
  // Show the draft's live title/text in its list row, and a row for an
  // unsaved new note at the top.
  const rows = useMemo(() => {
    const list = notes.data ?? [];
    const draftId = draft ? (draft.id ?? createdIdsRef.current.get(draft.key) ?? null) : null;
    const mapped = list.map((note) =>
      draft && note.id === draftId
        ? { ...note, title: draft.title, body: draft.body, is_pinned: draft.is_pinned, isDraft: true }
        : { ...note, isDraft: false },
    );
    if (draft && draftId === null) {
      const now = new Date().toISOString();
      return [
        { id: -1, title: draft.title, body: draft.body, is_pinned: draft.is_pinned, created_at: now, updated_at: now, isDraft: true },
        ...mapped,
      ];
    }
    return mapped;
  }, [notes.data, draft]);

  // Cmd/Ctrl+K focuses search; Cmd/Ctrl+Option+N starts a new note.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (mod && event.altKey && event.code === "KeyN") {
        event.preventDefault();
        startNewNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNewNote]);

  const total = notes.data?.length ?? 0;
  const statusLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Not saved"
        : saveState === "saved"
          ? "Saved"
          : lastSavedAt
            ? `Edited ${formatEdited(lastSavedAt)}`
            : draft && draft.id === null
              ? "Not saved yet"
              : "";

  return (
    <div className="notes-view">
      <header className="toolbar" data-tauri-drag-region>
        <div className="toolbar__group">
          <h1 className="toolbar__title" data-tauri-drag-region>
            Notes
          </h1>
          <span className="toolbar__subtitle" data-tauri-drag-region>
            {notes.data ? `${total} ${query ? "found" : total === 1 ? "note" : "notes"}` : ""}
          </span>
        </div>
        <div className="toolbar__group">
          <button type="button" className="button button--primary" onClick={startNewNote} title="New note (⌥⌘N)">
            <Icon name="plus" size={14} />
            New note
          </button>
        </div>
      </header>

      {notes.error ? <ErrorNotice error={notes.error} onRetry={notes.reload} /> : null}

      <div className="notes-layout">
        <aside className="notes-list" aria-label="Notes">
          <label className="notes-search">
            <Icon name="search" size={15} />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search notes  ⌘K"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearch("");
                }
              }}
            />
          </label>

          <ul className="notes-list__items">
            {rows.map((row) => {
              const selected = draft !== null && row.isDraft;
              const text = preview(row.title, row.body);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className={selected ? "note-row is-selected" : "note-row"}
                    onClick={() => {
                      if (!selected && row.id > 0) {
                        const note = notes.data?.find((item) => item.id === row.id);
                        if (note) {
                          openDraft(makeDraft(note));
                          setLastSavedAt(note.updated_at);
                        }
                      }
                    }}
                  >
                    <span className="note-row__top">
                      {row.is_pinned ? <Icon name="pin" size={12} className="note-row__pin" /> : null}
                      <span className="note-row__title">{displayTitle(row.title, row.body)}</span>
                      <span className="note-row__date">{row.id > 0 ? formatEdited(row.updated_at) : "Draft"}</span>
                    </span>
                    <span className="note-row__preview">{text || "No additional text"}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {notes.data && rows.length === 0 ? (
            <p className="notes-list__empty">{query ? `No notes match “${query}”.` : "No notes yet."}</p>
          ) : null}
        </aside>

        <section className="note-editor" aria-label="Note editor">
          {draft ? (
            <>
              <div className="note-editor__head">
                <input
                  ref={titleInputRef}
                  className="note-editor__title"
                  placeholder="Title"
                  maxLength={200}
                  value={draft.title}
                  onChange={(event) => edit({ title: event.target.value })}
                  onKeyDown={(event) => {
                    // Enter moves to the text, like most note apps.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      document.getElementById("note-body")?.focus();
                    }
                  }}
                />
                <button
                  type="button"
                  className={draft.is_pinned ? "icon-button is-active" : "icon-button"}
                  onClick={() => void togglePin()}
                  title={draft.is_pinned ? "Unpin" : "Pin to the top"}
                  aria-pressed={draft.is_pinned}
                >
                  <Icon name="pin" size={16} />
                </button>
                <ConfirmDeleteButton onConfirm={() => void deleteCurrent()} />
              </div>

              <textarea
                id="note-body"
                className="note-editor__body"
                placeholder="Start writing…"
                maxLength={100_000}
                value={draft.body}
                onChange={(event) => edit({ body: event.target.value })}
                spellCheck
              />

              <footer className="note-editor__foot">
                <span>
                  {countWords(draft.body)} words · {draft.body.length} characters
                </span>
                <span className={`note-editor__status note-editor__status--${saveState}`}>{statusLabel}</span>
              </footer>
            </>
          ) : (
            <div className="note-editor__empty">
              <Icon name="note" size={36} />
              <p>{notes.data && notes.data.length === 0 && !query ? "Write your first note." : "Select a note or create a new one."}</p>
              <button type="button" className="button button--primary" onClick={startNewNote}>
                <Icon name="plus" size={14} />
                New note
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
