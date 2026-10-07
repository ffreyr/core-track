/**
 * Create / edit dialog for a task.
 *
 * In create mode the date and scope are prefilled from where the user
 * clicked (a calendar cell, a Tasks-board lane). In edit mode every field is
 * editable, including completion, and the task can be deleted.
 */

import { useState, type FormEvent } from "react";

import { api, TASK_SCOPES, type IsoDate, type Task, type TaskPriority, type TaskScope } from "../../api";
import { ConfirmDeleteButton, Field, SegmentedControl } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { useApiAction } from "../../hooks/useApi";
import { PRIORITY_LABELS, SCOPE_META, TASK_COLOR_SWATCHES } from "../../lib/labels";

export interface TaskEditorProps {
  /** Existing task to edit; omit to create a new one. */
  task?: Task;
  /** Prefilled due date for new tasks. */
  defaultDate: IsoDate;
  /** Prefilled scope for new tasks. */
  defaultScope?: TaskScope;
  onClose: () => void;
}

const PRIORITIES: readonly TaskPriority[] = [0, 1, 2, 3];

export function TaskEditor({ task, defaultDate, defaultScope = "daily", onClose }: TaskEditorProps) {
  const run = useApiAction();
  const isEdit = task !== undefined;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [scope, setScope] = useState<TaskScope>(task?.scope ?? defaultScope);
  const [dueDate, setDueDate] = useState<IsoDate>(task?.due_date ?? defaultDate);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 1);
  const [color, setColor] = useState<string | null>(task?.color ?? null);
  const [isCompleted, setIsCompleted] = useState(task?.is_completed ?? false);
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  /** Validate locally, then create or update via the API. */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") {
      setTitleError("Give the task a title.");
      return;
    }
    if (!dueDate) {
      return;
    }
    setSaving(true);
    const fields = {
      title: trimmedTitle,
      description: description.trim() === "" ? null : description.trim(),
      scope,
      due_date: dueDate,
      priority,
      color,
    };
    const result = isEdit
      ? await run(() => api.tasks.update(task.id, { ...fields, is_completed: isCompleted }), { success: "Task saved" })
      : await run(() => api.tasks.create(fields), { success: "Task added" });
    setSaving(false);
    if (result.ok) {
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!task) {
      return;
    }
    setSaving(true);
    const result = await run(() => api.tasks.remove(task.id), { success: "Task deleted" });
    setSaving(false);
    if (result.ok) {
      onClose();
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit task" : "New task"}
      onClose={onClose}
      footer={
        <>
          {isEdit ? <ConfirmDeleteButton onConfirm={handleDelete} disabled={saving} /> : null}
          <span className="spacer" />
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="task-editor-form" className="button button--primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save" : "Add task"}
          </button>
        </>
      }
    >
      <form id="task-editor-form" className="form" onSubmit={handleSubmit}>
        <Field label="Title" htmlFor="task-title" error={titleError}>
          <input
            id="task-title"
            className="input"
            value={title}
            maxLength={200}
            autoFocus
            placeholder="What needs to be done?"
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(null);
            }}
          />
        </Field>

        <Field label="Scope" hint="The planning horizon this task belongs to.">
          <SegmentedControl
            label="Scope"
            value={scope}
            onChange={setScope}
            options={TASK_SCOPES.map((value) => ({ value, label: SCOPE_META[value].label }))}
          />
        </Field>

        <div className="form__row">
          <Field label="Due date" htmlFor="task-date">
            <input
              id="task-date"
              type="date"
              className="input"
              value={dueDate}
              required
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field label="Priority" htmlFor="task-priority">
            <select
              id="task-priority"
              className="input"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value) as TaskPriority)}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Color" hint="Tints the task chip on the calendar. Default uses the scope color.">
          <div className="swatches">
            <button
              type="button"
              className={color === null ? "swatch swatch--none is-selected" : "swatch swatch--none"}
              onClick={() => setColor(null)}
              title="Scope color"
              aria-label="Use scope color"
            />
            {TASK_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={color === swatch ? "swatch is-selected" : "swatch"}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
                aria-label={`Color ${swatch}`}
              />
            ))}
          </div>
        </Field>

        <Field label="Notes" htmlFor="task-description">
          <textarea
            id="task-description"
            className="input"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {isEdit ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={isCompleted} onChange={(event) => setIsCompleted(event.target.checked)} />
            Completed
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
