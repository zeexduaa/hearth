/**
 * Recurring upkeep and chores.
 *
 * Two kinds of timing:
 *
 * - fixed: due on the calendar whether or not it was done last time (bins out
 *   every Tuesday, pay the cleaner on the 1st). Missing a few weeks doesn't
 *   stack them up: doing it once takes care of everything due so far.
 * - after-done: due one period after it was last done (replace the furnace
 *   filter 3 months after the last change, even if that was late).
 *
 * A task can be shared out: with rotate on, its assignees take turns, and the
 * next turn goes to whoever follows the person who did it last.
 */

import { type LocalDate, type Recurrence, after, compare, daysBetween, nextOnOrAfter, addDays, validateRecurrence } from "./dates.js";
import { type Completion, type Data, type Member, type Task, DataError, newId, pick } from "./model.js";
import { type Money, totals } from "./money.js";

export interface TaskInput {
  name: string;
  recurrence: Recurrence;
  mode?: "fixed" | "after-done";
  start: LocalDate;
  item?: string;
  assignees?: string[];
  rotate?: boolean;
  notes?: string;
}

export function addTask(data: Data, input: TaskInput, today: LocalDate): Task {
  const name = input.name.trim();
  if (!name) throw new DataError("give the task a name");
  if (data.tasks.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new DataError(`there's already a task called ${name}`);
  }
  const task: Task = {
    id: newId(), name, recurrence: validateRecurrence(input.recurrence), mode: input.mode ?? "after-done",
    start: input.start, assignees: input.assignees ?? [], rotate: input.rotate ?? false, history: [], created: today,
  };
  if (input.item) task.item = input.item;
  if (input.notes) task.notes = input.notes;
  data.tasks.push(task);
  return task;
}

export function findTask(data: Data, query: string): Task {
  return pick(data.tasks, query, "task");
}

function lastCompletion(task: Task): Completion | undefined {
  return [...task.history].sort((a, b) => compare(a.due ?? a.date, b.due ?? b.date) || compare(a.date, b.date)).at(-1);
}

/** The date the task is next due. */
export function nextDue(task: Task): LocalDate {
  const last = lastCompletion(task);
  if (task.mode === "after-done") return last ? after(task.recurrence, last.date) : task.start;
  // Calendar dates from before the task was added weren't missed: hearth didn't know about them.
  if (!last) return nextOnOrAfter(task.recurrence, task.start, compare(task.created, task.start) > 0 ? task.created : task.start);
  return nextOnOrAfter(task.recurrence, task.start, addDays(last.due ?? last.date, 1));
}

/** Fixed tasks: the latest due date on or before ``date`` (what doing it now takes care of). */
function latestDueBy(task: Task, date: LocalDate): LocalDate | undefined {
  let due = nextDue(task);
  if (compare(due, date) > 0) return undefined;
  for (;;) {
    const next = nextOnOrAfter(task.recurrence, task.start, addDays(due, 1));
    if (compare(next, date) > 0) return due;
    due = next;
  }
}

/** Whose turn it is (undefined if nobody is assigned). */
export function turn(task: Task): string | undefined {
  if (!task.assignees.length) return undefined;
  if (!task.rotate) return task.assignees[0];
  const lastBy = [...task.history].reverse().find((c) => !c.skipped && c.by && task.assignees.includes(c.by))?.by;
  if (!lastBy) return task.assignees[0];
  return task.assignees[(task.assignees.indexOf(lastBy) + 1) % task.assignees.length];
}

export interface CompleteOptions {
  by?: string;
  cost?: Money;
  note?: string;
  skipped?: boolean;
}

/** Records the task as done (or skipped) on ``date``. Returns the completion and the new due date. */
export function complete(task: Task, date: LocalDate, options: CompleteOptions = {}): { completion: Completion; next: LocalDate } {
  const completion: Completion = { date };
  if (task.mode === "fixed") {
    // Done on time or late: it takes care of every due date so far. Done early: the next one.
    completion.due = latestDueBy(task, date) ?? nextDue(task);
  }
  const by = options.by ?? (options.skipped ? undefined : turn(task));
  if (by) completion.by = by;
  if (options.cost) {
    if (options.cost.cents < 0) throw new DataError("a cost can't be negative");
    completion.cost = options.cost;
  }
  if (options.note) completion.note = options.note;
  if (options.skipped) completion.skipped = true;
  task.history.push(completion);
  return { completion, next: nextDue(task) };
}

export function undoComplete(task: Task): Completion {
  const last = task.history.pop();
  if (!last) throw new DataError(`${task.name} has nothing recorded`);
  return last;
}

export interface TaskStatus {
  task: Task;
  due: LocalDate;
  daysLeft: number;          // negative: overdue by that many days
  assignee?: string;
}

/** Tasks due within ``days`` (overdue ones first), skipping paused ones. */
export function upcoming(data: Data, today: LocalDate, days: number): TaskStatus[] {
  return data.tasks.filter((t) => !t.paused)
    .map((task) => {
      const due = nextDue(task);
      const status: TaskStatus = { task, due, daysLeft: daysBetween(today, due) };
      const who = turn(task);
      if (who) status.assignee = who;
      return status;
    })
    .filter((s) => s.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.task.name.localeCompare(b.task.name));
}

/** What upkeep has cost, per currency, since ``from``. */
export function costs(task: Task, from?: LocalDate): Money[] {
  return totals(task.history.filter((c) => !from || compare(c.date, from) >= 0).map((c) => c.cost));
}

// -- household members -------------------------------------------------------------------------------------------

export function addMember(data: Data, name: string): Member {
  const clean = name.trim();
  if (!clean || clean.length > 40) throw new DataError("give the person a name (up to 40 characters)");
  if (data.members.some((m) => m.name.toLowerCase() === clean.toLowerCase())) throw new DataError(`${clean} is already in the household`);
  const member = { id: newId(), name: clean };
  data.members.push(member);
  return member;
}

export function findMember(data: Data, query: string): Member {
  return pick(data.members, query, "household member");
}

export function memberName(data: Data, id: string | undefined): string | undefined {
  return id ? data.members.find((m) => m.id === id)?.name : undefined;
}

/** Done in the last ``days`` days, per member, for a fair-share view. */
export function choreCounts(data: Data, today: LocalDate, days: number): { member: Member; done: number }[] {
  const since = addDays(today, -days + 1);
  return data.members.map((member) => ({
    member,
    done: data.tasks.reduce((n, t) => n + t.history.filter((c) => c.by === member.id && !c.skipped && compare(c.date, since) >= 0).length, 0),
  })).sort((a, b) => b.done - a.done || a.member.name.localeCompare(b.member.name));
}
