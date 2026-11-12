/**
 * Copies of receipts, manuals and warranty cards, kept in a folder next to the
 * data file so they don't get lost when the original is moved or deleted.
 *
 * Files are stored under a name made from the start of their SHA-256 hash and
 * a cleaned-up original name, so the same file attached twice is stored once
 * and odd names can't escape the folder.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, chmodSync } from "node:fs";
import { basename, join } from "node:path";
import type { LocalDate } from "./dates.js";
import { type Attachment, type Data, DataError, newId } from "./model.js";

export const MAX_BYTES = 50 * 1024 * 1024;

export function safeName(name: string): string {
  const cleaned = basename(name).normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

export function attach(data: Data, dir: string, source: string, today: LocalDate,
                       link: { item?: string; bill?: string; note?: string } = {}): Attachment {
  let size: number;
  try {
    const st = statSync(source);
    if (!st.isFile()) throw new DataError(`${source} isn't a file`);
    size = st.size;
  } catch (err) {
    if (err instanceof DataError) throw err;
    throw new DataError(`can't read ${source}`);
  }
  if (size > MAX_BYTES) throw new DataError(`${basename(source)} is ${(size / 1048576).toFixed(0)} MB; the limit is 50 MB`);
  const sha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
  const name = basename(source);
  const existing = data.attachments.find((a) => a.sha256 === sha256 && a.item === link.item && a.bill === link.bill);
  if (existing) return existing;
  const file = `${sha256.slice(0, 12)}-${safeName(name)}`;
  mkdirSync(dir, { recursive: true });
  const target = join(dir, file);
  if (!existsSync(target)) {
    copyFileSync(source, target);
    try { chmodSync(target, 0o600); } catch { /* not supported */ }
  }
  const attachment: Attachment = { id: newId(), file, name, sha256, size, added: today };
  if (link.item) attachment.item = link.item;
  if (link.bill) attachment.bill = link.bill;
  if (link.note) attachment.note = link.note;
  data.attachments.push(attachment);
  return attachment;
}

export function attachmentsOf(data: Data, ref: { item?: string; bill?: string }): Attachment[] {
  return data.attachments.filter((a) => (ref.item && a.item === ref.item) || (ref.bill && a.bill === ref.bill));
}

export function pathOf(dir: string, attachment: Attachment): string {
  return join(dir, attachment.file);
}

/** Forgets an attachment, deleting the stored copy if nothing else uses it. */
export function detach(data: Data, dir: string, attachment: Attachment): void {
  data.attachments.splice(data.attachments.indexOf(attachment), 1);
  if (!data.attachments.some((a) => a.file === attachment.file)) {
    try { unlinkSync(join(dir, attachment.file)); } catch { /* already gone */ }
  }
}

/** Attachments whose stored copy is missing or changed (for a health check). */
export function verify(data: Data, dir: string): { attachment: Attachment; problem: string }[] {
  const problems: { attachment: Attachment; problem: string }[] = [];
  for (const a of data.attachments) {
    const path = join(dir, a.file);
    if (!existsSync(path)) problems.push({ attachment: a, problem: "missing" });
    else if (createHash("sha256").update(readFileSync(path)).digest("hex") !== a.sha256) problems.push({ attachment: a, problem: "changed" });
  }
  return problems;
}
