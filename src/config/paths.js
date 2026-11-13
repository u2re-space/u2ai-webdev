/**
 * Home directory and config file locations.
 *
 * The CLI keeps its state in ~/.ai-webdev (override with AI_WEBDEV_HOME);
 * the home config is config.json there, the skill packs live in
 * ~/.ai-webdev/skills, the component registry in ~/.ai-webdev/components
 * with its SQLite index ~/.ai-webdev/components.db, the long-term memory in
 * ~/.ai-webdev/memory.db and the background jobs in ~/.ai-webdev/jobs.
 *
 * @ai.hint legacy-0.2
 */

import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Agent home directory: AI_WEBDEV_HOME, or ~/.ai-webdev.
 * @param {object} [env]
 * @returns {string}
 */
export function defaultHome(env = process.env) {
  return env.AI_WEBDEV_HOME ? path.resolve(env.AI_WEBDEV_HOME) : path.join(os.homedir(), '.ai-webdev');
}

/**
 * Absolute path of the home config file.
 * @param {string} home
 * @returns {string}
 */
export function homeConfigFile(home) {
  return path.join(home, 'config.json');
}

/**
 * Absolute path of the home skill directory.
 * @param {string} home
 * @returns {string}
 */
export function homeSkillsDir(home) {
  return path.join(home, 'skills');
}

/**
 * Absolute path of the component registry directory.
 * @param {string} home
 * @returns {string}
 */
export function homeComponentsDir(home) {
  return path.join(home, 'components');
}

/**
 * Absolute path of the component registry index.
 * @param {string} home
 * @returns {string}
 */
export function homeComponentsDb(home) {
  return path.join(home, 'components.db');
}

/**
 * Absolute path of the long-term memory database.
 * @param {string} home
 * @returns {string}
 */
export function homeMemoryDb(home) {
  return path.join(home, 'memory.db');
}

/**
 * Absolute path of the directory with the background jobs.
 * @param {string} home
 * @returns {string}
 */
export function homeJobsDir(home) {
  return path.join(home, 'jobs');
}

/**
 * Resolve a --config argument to an absolute path.
 * @param {string|null|undefined} configPath
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function resolveConfigPath(configPath, cwd = process.cwd()) {
  if (!configPath || typeof configPath !== 'string' || !configPath.trim()) return null;
  return path.resolve(cwd, configPath.trim());
}

/**
 * Create the home directory when missing (best effort: a read-only home
 * must not break a run that works entirely from flags).
 * @param {string} home
 * @returns {Promise<void>}
 */
export async function ensureHomeDir(home) {
  try {
    await mkdir(home, { recursive: true });
  } catch { /* ignore */ }
}
