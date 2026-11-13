#!/usr/bin/env node
/**
 * @file bin/ai-webdev.js
 * @module bin/ai-webdev
 * @purpose Process entry for the `ai-webdev` command. Forwards every argument to `cli.main`.
 * @depends cli
 * @usedBy package bin
 * @ai.tags cli
 * @ai.hint io
 */
import { main } from '../src/cli.js';

process.exitCode = await main(process.argv.slice(2));
