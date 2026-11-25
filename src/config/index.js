/**
 * Configuration loader of the webdev CLI.
 *
 * Precedence: defaults < ~/.ai-webdev/config.json < --config file <
 * AI_WEBDEV_* environment < CLI overrides. After the merge, placeholders
 * are expanded, the first usable backend is promoted to primary, the config
 * is validated, and the home paths are attached.
 *
 * @ai.hint legacy-0.2
 */

import { fromEnv, envConfigPath } from './env.js';
import { isRecord } from './merge.js';
import { ENUMS, KiB } from './constants.js';
import { defaults, cloneDefaults, defaultConfigText } from './defaults.js';
import { readConfigFile, writeConfigFile, expandPlaceholders, mergeSources } from './parser.js';
import {
  defaultHome, homeConfigFile, homeSkillsDir, homeComponentsDir, homeComponentsDb,
  homeMemoryDb, homeJobsDir, resolveConfigPath, ensureHomeDir,
} from './paths.js';
import { validateConfig, dropGoneFromConfig } from './validate.js';
import { resolveModelRef } from '../model/refs.js';

export {
  ENUMS, defaults, cloneDefaults, defaultConfigText, validateConfig,
  defaultHome, homeConfigFile, homeSkillsDir, homeComponentsDir, homeComponentsDb,
  homeMemoryDb, homeJobsDir, resolveConfigPath, ensureHomeDir,
};

/**
 * Pick the primary backend: the first entry with a URL that also has a key
 * (inline, named env, or none when the whole list is keyless).
 * @param {object[]} backends
 * @param {object} env
 * @returns {{ primary: object|null, apiKey: string|null }}
 */
function pickPrimary(backends, env) {
  const keyOf = (item) => {
    if (typeof item?.apiKey === 'string' && item.apiKey.trim()) return item.apiKey.trim();
    if (typeof item?.env === 'string' && item.env) {
      const value = env[item.env];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  const withURL = backends.filter((item) => isRecord(item) && typeof item.baseURL === 'string' && item.baseURL.trim());
  const primary = withURL.find((item) => keyOf(item)) ?? withURL[0] ?? null;
  return { primary, apiKey: primary ? keyOf(primary) : null };
}

/**
 * Resolve the effective configuration.
 * @param {{ configPath?: string|null, overrides?: object, env?: object, cwd?: string, ensureHome?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function loadConfig({ configPath = null, overrides = {}, env = process.env, cwd = process.cwd(), ensureHome = true, warn = null } = {}) {
  const home = defaultHome(env);
  const homeConfig = await readConfigFile(homeConfigFile(home), { optional: true });
  const explicitPath = resolveConfigPath(configPath ?? envConfigPath(env), cwd);
  const fileConfig = explicitPath ? await readConfigFile(explicitPath) : {};

  let config = mergeSources(homeConfig, fileConfig, fromEnv(env), overrides);
  // Стадии и роли, что ушли из системы, молча выпадают: конфиг написан под прошлую
  // систему, и ронять прогон из-за него — значит наказывать за то, что система
  // изменилась.
  const { config: migrated, dropped } = dropGoneFromConfig(config);
  config = migrated;
  if (dropped.length) {
    for (const name of dropped) warn?.(`Конфигурация: убрано то, чего больше нет: ${name}.`);
  }
  config = await expandPlaceholders(config, {
    env,
    root: cwd,
    maxBytes: Number.isSafeInteger(config.limits?.maxFileReadBytes) ? config.limits.maxFileReadBytes : 256 * KiB,
  });

  const { primary, apiKey } = pickPrimary(Array.isArray(config.backends) ? config.backends : [], env);
  if (primary) {
    config.baseURL = primary.baseURL;
    if (apiKey) config.apiKey = apiKey;
  }

  config.home = home;
  config.configFiles = [homeConfigFile(home), ...(explicitPath ? [explicitPath] : [])];

  validateConfig(config);
  // The model of the run may name a family of models: the cheapest member of the family
  // that takes the effort of the run answers.
  config.model = resolveModelRef(config.model, config, { effort: config.reasoning?.effort ?? null }) ?? config.model;
  if (ensureHome) await ensureHomeDir(home);

  // The paths of the registry point at the home unless the config names its own.
  config.components = {
    ...config.components,
    dir: config.components.dir ?? homeComponentsDir(home),
    dbFile: config.components.dbFile ?? homeComponentsDb(home),
  };
  return config;
}

/**
 * Seed the home config file when it does not exist yet.
 * @param {object} [env]
 * @returns {Promise<{ created: boolean, file: string }>}
 */
export async function ensureConfigFile(env = process.env) {
  const home = defaultHome(env);
  const file = homeConfigFile(home);
  try {
    await readConfigFile(file, { optional: false });
    return { created: false, file };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeConfigFile(file, JSON.parse(defaultConfigText()));
  return { created: true, file };
}

/**
 * A copy of the config with secrets shortened, safe to print.
 * @param {object} config
 * @returns {object}
 */
export function redactConfig(config) {
  const short = (value) => (typeof value === 'string' && value.length > 6 ? `${value.slice(0, 3)}…${value.slice(-2)}` : value ? '…' : null);
  const out = structuredClone(config);
  if (out.apiKey) out.apiKey = short(out.apiKey);
  if (Array.isArray(out.backends)) {
    for (const item of out.backends) if (item && typeof item === 'object' && item.apiKey) item.apiKey = short(item.apiKey);
  }
  return out;
}
