/**
 * Configuration fields taken from the environment.
 *
 * Precedence inside the CLI: defaults < config.json < --config file < env <
 * CLI overrides. This module only maps env names to config paths; merging is
 * the loader's job. `AI_WEBDEV_*` is the primary namespace; the plain
 * `OPENAI_*` / `AI_*` names are accepted for compatibility with the
 * monolith's user setup.
 *
 * @ai.hint legacy-0.2
 */

import { ENUMS } from './constants.js';

/**
 * Parse one env value as a bounded integer.
 * @param {string|undefined} raw
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function intInRange(raw, min, max) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * Parse one env value as a JSON array of backend entries; invalid input is ignored.
 * @param {string|undefined} raw
 * @returns {object[]|null}
 */
function backendList(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build a partial config object from environment variables.
 * @param {object} [env]
 * @returns {object}
 */
export function fromEnv(env = process.env) {
  const out = {};
  const set = (path, value) => {
    if (value === undefined || value === null || value === '') return;
    let owner = out;
    for (const step of path.slice(0, -1)) {
      owner[step] ??= {};
      owner = owner[step];
    }
    owner[path.at(-1)] = value;
  };

  // --- API -----------------------------------------------------------------
  set(['model'], env.AI_WEBDEV_MODEL ?? env.AI_MODEL ?? env.OPENAI_MODEL);
  set(['baseURL'], env.AI_WEBDEV_BASE_URL ?? env.OPENAI_BASE_URL);
  set(['apiKey'], env.AI_WEBDEV_API_KEY ?? env.OPENAI_API_KEY);
  set(['organization'], env.OPENAI_ORG_ID);
  set(['project'], env.OPENAI_PROJECT_ID);

  // --- reasoning ------------------------------------------------------------
  if (ENUMS.reasoningEfforts.includes(env.AI_WEBDEV_EFFORT)) set(['reasoning', 'effort'], env.AI_WEBDEV_EFFORT);

  // --- HTTP plumbing --------------------------------------------------------
  const retries = intInRange(env.AI_WEBDEV_RETRIES, 0, 10);
  if (retries != null) set(['retries'], retries);
  const timeoutMs = intInRange(env.AI_WEBDEV_TIMEOUT_MS, 5_000, 1_800_000);
  if (timeoutMs != null) set(['timeoutMs'], timeoutMs);
  const maxTurns = intInRange(env.AI_WEBDEV_MAX_TURNS, 1, 200);
  if (maxTurns != null) set(['limits', 'maxTurns'], maxTurns);

  // --- backends -------------------------------------------------------------
  const backends = backendList(env.AI_WEBDEV_BACKENDS);
  if (backends) set(['backends'], backends);

  // --- logging --------------------------------------------------------------
  // A directory turns the log of the API calls on: the records are the witness of a chain
  // that misbehaves.
  if (typeof env.AI_WEBDEV_LOG_DIR === 'string' && env.AI_WEBDEV_LOG_DIR.trim()) {
    set(['logging', 'enabled'], true);
    set(['logging', 'dir'], env.AI_WEBDEV_LOG_DIR.trim());
  }

  // --- the stack ------------------------------------------------------------
  if (ENUMS.frontendFrameworks.includes(env.AI_WEBDEV_FRAMEWORK)) set(['stack', 'frontendFramework'], env.AI_WEBDEV_FRAMEWORK);
  if (ENUMS.markupLanguages.includes(env.AI_WEBDEV_MARKUP)) set(['stack', 'markupLanguage'], env.AI_WEBDEV_MARKUP);
  if (ENUMS.styleLanguages.includes(env.AI_WEBDEV_STYLE)) set(['stack', 'styleLanguage'], env.AI_WEBDEV_STYLE);
  if (ENUMS.scriptLanguages.includes(env.AI_WEBDEV_SCRIPT)) set(['stack', 'scriptLanguage'], env.AI_WEBDEV_SCRIPT);
  if (ENUMS.iconSets.includes(env.AI_WEBDEV_ICON_SET)) set(['stack', 'iconSet'], env.AI_WEBDEV_ICON_SET);

  // --- generation ----------------------------------------------------------
  const fidelity = intInRange(env.AI_WEBDEV_FIDELITY, 0, 100);
  if (fidelity != null) set(['agent', 'fidelity'], fidelity);
  const creativity = intInRange(env.AI_WEBDEV_CREATIVITY, 0, 100);
  if (creativity != null) set(['agent', 'creativity'], creativity);
  if (ENUMS.generationKinds.includes(env.AI_WEBDEV_KIND)) set(['agent', 'kind'], env.AI_WEBDEV_KIND);

  // --- pace ----------------------------------------------------------------
  if (ENUMS.paceModes.includes(env.AI_WEBDEV_PACE)) set(['pace', 'mode'], env.AI_WEBDEV_PACE);
  const speed = intInRange(env.AI_WEBDEV_SPEED, 0, 100);
  if (speed != null) set(['pace', 'speed'], speed);
  const quality = intInRange(env.AI_WEBDEV_QUALITY, 0, 100);
  if (quality != null) set(['pace', 'quality'], quality);

  // --- stages ---------------------------------------------------------------
  for (const stage of ENUMS.stages) {
    const flag = env[`AI_WEBDEV_STAGE_${stage.toUpperCase()}`];
    if (flag === '0' || flag === 'false') set(['stages', stage, 'enabled'], false);
    else if (flag === '1' || flag === 'true') set(['stages', stage, 'enabled'], true);
  }

  // --- bridges --------------------------------------------------------------
  for (const bridge of ENUMS.bridges) {
    const flag = env[`AI_WEBDEV_BRIDGE_${bridge.toUpperCase()}`];
    if (flag === '0' || flag === 'false') set(['bridges', bridge, 'enabled'], false);
    else if (flag === '1' || flag === 'true') set(['bridges', bridge, 'enabled'], true);
  }

  return out;
}

/**
 * The config file named by the environment, if any.
 * @param {object} [env]
 * @returns {string|null}
 */
export function envConfigPath(env = process.env) {
  return env.AI_WEBDEV_CONFIG || null;
}
