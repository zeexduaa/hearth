import { test } from "node:test";
import assert from "node:assert/strict";
import * as tasks from "../src/tasks.js";
import { parseRecurrence } from "../src/dates.js";
import { emptyData } from "../src/model.js";
import { parseMoney } from "../src/money.js";

const TODAY = "2026-11-12";

test("after-done tasks are due one period after they were last done", () => {
  const data = emptyData("Home");
  const filter = tasks.addTask(data, { name: "Replace furnace filter", recurrence: parseRecurrence("every 3 months"), start: "2026-09-01" }, TODAY);
  assert.equal(tasks.nextDue(filter), "2026-09-01");
  assert.equal(tasks.complete(filter, "2026-10-20", { cost: parseMoney("24.99", "USD") }).next, "2027-01-20");   // done late: counts from then
  assert.deepEqual(tasks.costs(filter), [{ currency: "USD", cents: 2499 }]);
  assert.throws(() => tasks.addTask(data, { name: "replace FURNACE filter", recurrence: parseRecurrence("monthly"), start: TODAY }, TODAY),
    /already a task/);
});

test("fixed tasks follow the calendar; missed weeks don't stack up", () => {
  const data = emptyData("Home");
  const bins = tasks.addTask(data, { name: "Bins out", recurrence: parseRecurrence("weekly"), start: "2026-11-03", mode: "fixed" }, TODAY);
  assert.equal(tasks.nextDue(bins), "2026-11-03");
  // Missed the 3rd and the 10th; doing it on the 12th takes care of both.
  assert.equal(tasks.complete(bins, "2026-11-12").next, "2026-11-17");
  // Done early (on the 15th) it takes care of the 17th.
  const { completion, next } = tasks.complete(bins, "2026-11-15");
  assert.equal(completion.due, "2026-11-17");
  assert.equal(next, "2026-11-24");
  tasks.undoComplete(bins);
  assert.equal(tasks.nextDue(bins), "2026-11-17");
});

test("chores rotate among the household", () => {
  const data = emptyData("Home");
  const [ali, sara, omar] = ["Ali", "Sara", "Omar"].map((n) => tasks.addMember(data, n));
  const dishes = tasks.addTask(data, { name: "Dishes", recurrence: parseRecurrence("daily"), start: "2026-11-10", mode: "fixed",
                                       assignees: [ali!.id, sara!.id, omar!.id], rotate: true }, TODAY);
  const turns: string[] = [];
  for (const day of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
    turns.push(tasks.memberName(data, tasks.turn(dishes))!);
    tasks.complete(dishes, day);
  }
  assert.deepEqual(turns, ["Ali", "Sara", "Omar", "Ali"]);
  // Someone swaps in: the next turn follows whoever did it.
  tasks.complete(dishes, "2026-11-14", { by: omar!.id });
  assert.equal(tasks.memberName(data, tasks.turn(dishes)), "Ali");
  // Skipping a day doesn't use up anyone's turn.
  tasks.complete(dishes, "2026-11-15", { skipped: true });
  assert.equal(tasks.memberName(data, tasks.turn(dishes)), "Ali");
  assert.deepEqual(tasks.choreCounts(data, "2026-11-15", 7).map((c) => [c.member.name, c.done]), [["Ali", 2], ["Omar", 2], ["Sara", 1]]);
  assert.throws(() => tasks.addMember(data, "ali"), /already in the household/);
});

test("upcoming lists overdue first and leaves paused tasks out", () => {
  const data = emptyData("Home");
  tasks.addTask(data, { name: "Smoke alarm test", recurrence: parseRecurrence("monthly"), start: "2026-11-01", mode: "fixed" }, TODAY);
  tasks.addTask(data, { name: "Clean gutters", recurrence: parseRecurrence("yearly in november"), start: "2026-11-20", mode: "fixed" }, TODAY);
  tasks.addTask(data, { name: "Descale kettle", recurrence: parseRecurrence("every 2 months"), start: "2027-01-01" }, TODAY);
  const paused = tasks.addTask(data, { name: "Water garden", recurrence: parseRecurrence("daily"), start: "2026-11-01" }, TODAY);
  paused.paused = true;
  assert.deepEqual(tasks.upcoming(data, TODAY, 14).map((s) => [s.task.name, s.daysLeft]), [["Smoke alarm test", -11], ["Clean gutters", 8]]);
});
