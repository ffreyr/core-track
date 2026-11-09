/**
 * Client for the `/api/notes` notepad endpoints.
 */

import { request } from "./http";
import type { Note, NoteCreate, NoteListParams, NoteUpdate } from "./types";

export const notesApi = {
  /** Notes, pinned first, then most recently edited. */
  list(params: NoteListParams = {}, signal?: AbortSignal): Promise<Note[]> {
    return request<Note[]>("GET", "/notes", { query: { ...params }, signal });
  },

  /** Create a note (needs a title or some text). */
  create(payload: NoteCreate): Promise<Note> {
    return request<Note>("POST", "/notes", { body: payload });
  },

  /** Edit a note; only the sent fields change. */
  update(id: number, patch: NoteUpdate): Promise<Note> {
    return request<Note>("PATCH", `/notes/${id}`, { body: patch });
  },

  /** Permanently delete a note. */
  remove(id: number): Promise<void> {
    return request<void>("DELETE", `/notes/${id}`);
  },
};
