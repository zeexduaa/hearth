/** Everything that needs attention, in one place: what ``hearth`` shows when run on its own. */

import { type LocalDate, daysBetween } from "./dates.js";
import type { Data } from "./model.js";
import * as bills from "./bills.js";
import * as inventory from "./inventory.js";
import * as tasks from "./tasks.js";

export interface Dashboard {
  today: LocalDate;
  overdueTasks: tasks.TaskStatus[];
  dueTasks: tasks.TaskStatus[];          // today and the coming days
  overdueBills: bills.BillStatus[];
  dueBills: bills.BillStatus[];
  warranties: inventory.WarrantyStatus[];
  shopping: inventory.ShoppingLine[];
  unusualBills: bills.Unusual[];
}

export function build(data: Data, today: LocalDate): Dashboard {
  const days = data.settings.lookaheadDays;
  const taskList = tasks.upcoming(data, today, days);
  const billList = bills.upcoming(data, today, days);
  return {
    today,
    overdueTasks: taskList.filter((t) => t.daysLeft < 0),
    dueTasks: taskList.filter((t) => t.daysLeft >= 0),
    overdueBills: billList.filter((b) => b.daysLeft < 0),
    dueBills: billList.filter((b) => b.daysLeft >= 0),
    warranties: inventory.warranties(data, today, data.settings.warrantyWarnDays, 7),
    shopping: inventory.shoppingList(data),
    // Only recent ones: an odd bill from last year isn't news.
    unusualBills: bills.unusual(data).filter((u) => daysBetween(u.payment.paid, today) <= 45),
  };
}

export function isQuiet(d: Dashboard): boolean {
  return !d.overdueTasks.length && !d.dueTasks.length && !d.overdueBills.length && !d.dueBills.length &&
    !d.warranties.length && !d.shopping.length && !d.unusualBills.length;
}
