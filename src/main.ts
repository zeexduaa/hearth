#!/usr/bin/env node
// The hearth command. Kept separate from cli.ts so that importing the CLI (in tests) has no side effects,
// and so the command works however it's started (directly, through npm's link, or Windows' .cmd shim).
import { run } from "./cli.js";
import { today } from "./dates.js";

// "hearth items | head" closes the pipe early: stop quietly instead of crashing.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

run(process.argv.slice(2), {
  today: () => today(),
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
  env: process.env,
}).then((code) => { process.exitCode = code; }, (err) => {
  process.stderr.write(`hearth: unexpected error: ${err?.stack ?? err}\n`);
  process.exitCode = 3;
});
