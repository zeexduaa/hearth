#!/usr/bin/env node
// The hearth command. Kept separate from cli.ts so that importing the CLI (in tests) has no side effects.
import { VERSION } from "./version.js";

process.stdout.write(`hearth ${VERSION}\n`);
