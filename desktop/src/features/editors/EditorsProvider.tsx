/**
 * App-wide access to the task and finance editors.
 *
 * Any component can call `useEditors().openTask(...)` without owning modal
 * state itself; the provider renders at most one editor at a time at the
 * root of the tree.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { FinanceKind, FinanceLog, IsoDate, Task, TaskScope } from "../../api";
import { toIsoDate, today } from "../../lib/dates";
import { FinanceEditor } from "./FinanceEditor";
import { TaskEditor } from "./TaskEditor";

/** Arguments for opening the task editor. */
export interface OpenTaskOptions {
  task?: Task;
  date?: IsoDate;
  scope?: TaskScope;
}

/** Arguments for opening the finance editor. */
export interface OpenFinanceOptions {
  log?: FinanceLog;
  date?: IsoDate;
  kind?: FinanceKind;
}

/**
 * `seq` increments on every open request and is used as the React key, so
 * re-opening while an editor is already showing always remounts it with the
 * new defaults (e.g. double-clicking another day while "New task" is open).
 */
type EditorState =
  | { type: "none"; seq: number }
  | { type: "task"; seq: number; options: OpenTaskOptions }
  | { type: "finance"; seq: number; options: OpenFinanceOptions };

interface EditorsContextValue {
  openTask: (options?: OpenTaskOptions) => void;
  openFinance: (options?: OpenFinanceOptions) => void;
}

const EditorsContext = createContext<EditorsContextValue | null>(null);

export function EditorsProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<EditorState>({ type: "none", seq: 0 });

  const openTask = useCallback(
    (options: OpenTaskOptions = {}) => setEditor((current) => ({ type: "task", seq: current.seq + 1, options })),
    [],
  );
  const openFinance = useCallback(
    (options: OpenFinanceOptions = {}) => setEditor((current) => ({ type: "finance", seq: current.seq + 1, options })),
    [],
  );
  const close = useCallback(() => setEditor((current) => ({ type: "none", seq: current.seq })), []);

  const value = useMemo(() => ({ openTask, openFinance }), [openTask, openFinance]);
  const fallbackDate = toIsoDate(today());

  return (
    <EditorsContext.Provider value={value}>
      {children}
      {/* A fresh `key` per open request remounts the editor so form state never leaks between items. */}
      {editor.type === "task" ? (
        <TaskEditor
          key={editor.seq}
          task={editor.options.task}
          defaultDate={editor.options.date ?? fallbackDate}
          defaultScope={editor.options.scope}
          onClose={close}
        />
      ) : null}
      {editor.type === "finance" ? (
        <FinanceEditor
          key={editor.seq}
          log={editor.options.log}
          defaultDate={editor.options.date ?? fallbackDate}
          defaultKind={editor.options.kind}
          onClose={close}
        />
      ) : null}
    </EditorsContext.Provider>
  );
}

/** Open task/finance editors from anywhere inside {@link EditorsProvider}. */
export function useEditors(): EditorsContextValue {
  const context = useContext(EditorsContext);
  if (!context) {
    throw new Error("useEditors must be used inside <EditorsProvider>");
  }
  return context;
}
