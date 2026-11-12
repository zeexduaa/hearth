/**
 * The data file and the folder of attached files beside it.
 *
 * Saves are atomic: write a temporary file, flush it, rename it over the old one.
 * The previous version is kept as ``<file>.bak``, and on Unix the file is private
 * to its owner. Older formats are upgraded step by step on load, and files from a
 * newer hearth are refused rather than damaged.
 */

import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
         unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type Data, DataError, DEFAULT_SETTINGS, FORMAT, VERSION, emptyData } from "./model.js";

export function defaultPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.HEARTH_FILE) return env.HEARTH_FILE;
  const base = platform === "win32" ? env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    : platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "hearth", "hearth.json");
}

/** Where attachments of the data file at ``path`` are kept. */
export function filesDir(path: string): string {
  return join(dirname(path), `${basename(path).replace(/\.json$/i, "")}-files`);
}

const MIGRATIONS: Record<number, (doc: any) => any> = {};

export function load(path: string): Data {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new DataError(`no data file at ${path}; start with: hearth init`);
    throw new DataError(`can't read ${path}: ${err?.message ?? err}`);
  }
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new DataError(`${path} isn't valid JSON (damaged?); the previous version is in ${path}.bak`);
  }
  return parse(doc, path);
}

export function parse(doc: any, path = "the data file"): Data {
  if (!doc || typeof doc !== "object" || doc.format !== FORMAT || !Number.isInteger(doc.version)) {
    throw new DataError(`${path} isn't a hearth data file`);
  }
  if (doc.version > VERSION) throw new DataError(`${path} was written by a newer hearth (format ${doc.version}); please upgrade`);
  while (doc.version < VERSION) {
    const step = MIGRATIONS[doc.version];
    if (!step) throw new DataError(`can't upgrade ${path} from format ${doc.version}`);
    doc = step(doc);
    doc.version += 1;
  }
  const fail = (what: string) => { throw new DataError(`${path} is damaged: ${what}`); };
  for (const key of ["members", "items", "tasks", "bills", "attachments"]) {
    doc[key] ??= [];
    if (!Array.isArray(doc[key])) fail(`${key} isn't a list`);
  }
  doc.settings = { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) };
  doc.home = typeof doc.home === "string" ? doc.home : "Home";
  for (const i of doc.items) {
    if (typeof i?.id !== "string" || typeof i?.name !== "string") fail("an item has no id or name");
    i.tags ??= [];
    if (typeof i.quantity !== "number") i.quantity = 1;
  }
  for (const t of doc.tasks) {
    if (typeof t?.id !== "string" || !t?.recurrence?.unit || !t?.start) fail(`task ${t?.name ?? "?"} is incomplete`);
    t.history ??= [];
    t.assignees ??= [];
  }
  for (const b of doc.bills) {
    if (typeof b?.id !== "string" || !b?.recurrence?.unit || !b?.start) fail(`bill ${b?.name ?? "?"} is incomplete`);
    b.payments ??= [];
  }
  return doc as Data;
}

export function create(path: string, home: string, currency?: string, overwrite = false): Data {
  if (existsSync(path) && !overwrite) throw new DataError(`there's already a data file at ${path}`);
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency)) throw new DataError("the currency is a 3-letter code like USD, EUR or PKR");
  const data = emptyData(home, currency);
  save(path, data);
  return data;
}

export function save(path: string, data: Data): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(data, null, 1) + "\n");
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try { unlinkSync(tmp); } catch { /* gone */ }
    throw err;
  }
  closeSync(fd);
  try {
    if (existsSync(path)) {
      copyFileSync(path, `${path}.bak`);
      try { chmodSync(`${path}.bak`, 0o600); } catch { /* not supported */ }
    }
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* gone */ }
    throw err;
  }
  if (process.platform !== "win32") {
    try {
      const d = openSync(dir, "r");
      try { fsyncSync(d); } finally { closeSync(d); }
    } catch { /* not allowed here; the rename is still atomic */ }
  }
}
