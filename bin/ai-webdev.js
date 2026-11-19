#!/usr/bin/env node
/**
 * @file bin/ai-webdev.js
 * @module bin/ai-webdev
 * @purpose Process entry of the graphical ai-webdev command.
 * @depends tui/cli
 * @usedBy package bin
 * @ai.tags cli, tui
 * @ai.hint io
 */
import { mainTui } from '../src/tui/cli.js';

// A crash that happened outside the command keeps its own exit code: the command may
// have returned 0 before the process fell over.
process.exitCode = (await mainTui(process.argv.slice(2))) || process.exitCode || 0;
