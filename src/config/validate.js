/**
 * Validation of the merged configuration against the enums and the
 * allow-lists of defaults. Every failure names the exact config path so the
 * CLI can print one actionable line.
 *
 * The messages are in Russian: the config is the part of the CLI a user edits
 * by hand, and the sibling packages speak Russian there.
 *
 * @ai.hint legacy-0.2
 */

import { ENUMS, HEADER_NAME, SUPPORT_ALIASES } from './constants.js';
import { defaults, ROLE_FIELDS } from './defaults.js';
import { isRecord } from './merge.js';
import { familyName, groupName } from '../model/refs.js';
import { KIND_EFFORT } from '../agent/pace.js';

/**
 * Check that a reference to a family or a group names one that exists.
 * @param {unknown} ref the reference: a model, `family:<name>` or `group:<name>`
 * @param {string} where the path of the reference
 * @param {(message: string) => never} fail
 * @param {object} config the merged config
 */
function checkModelRef(ref, where, fail, config) {
  const family = familyName(ref);
  if (family && !Object.hasOwn(config.modelFamilies ?? {}, family)) {
    fail(`${where}: семейство моделей "${family}" не найдено (modelFamilies)`);
  }
  const group = groupName(ref);
  if (group && !Object.hasOwn(config.modelGroups ?? {}, group)) {
    fail(`${where}: группа моделей "${group}" не найдена (modelGroups)`);
  }
}

/**
 * Validate the families of models: { "<name>": ["<model>", ...] }.
 * @param {unknown} families
 * @param {(message: string) => never} fail
 */
function validateModelFamilies(families, fail) {
  if (!isRecord(families)) fail('modelFamilies должен быть объектом');
  for (const [name, list] of Object.entries(families)) {
    if (!name.trim()) fail('modelFamilies: пустое имя семейства');
    if (!Array.isArray(list) || !list.length) fail(`modelFamilies.${name}: непустой массив моделей`);
    for (const item of list) {
      if (typeof item !== 'string' || !item.trim()) fail(`modelFamilies.${name}: непустая строка`);
    }
  }
}

/**
 * Validate the groups of models: { "<name>": ["<model>" | { model, maxContext }] }.
 * @param {unknown} groups
 * @param {(message: string) => never} fail
 */
function validateModelGroups(groups, fail) {
  if (!isRecord(groups)) fail('modelGroups должен быть объектом');
  for (const [name, list] of Object.entries(groups)) {
    if (!name.trim()) fail('modelGroups: пустое имя группы');
    if (!Array.isArray(list) || !list.length) fail(`modelGroups.${name}: непустой массив моделей`);
    for (const [index, item] of list.entries()) {
      const where = `modelGroups.${name}[${index}]`;
      if (typeof item === 'string') {
        if (!item.trim()) fail(`${where}: непустая строка`);
        continue;
      }
      if (!isRecord(item)) fail(`${where}: строка или объект`);
      for (const key of Object.keys(item)) {
        if (!['model', 'maxContext'].includes(key)) fail(`${where}.${key}: неизвестное поле`);
      }
      if (typeof item.model !== 'string' || !item.model.trim()) fail(`${where}.model: непустая строка`);
      if (item.maxContext != null && !(Number.isSafeInteger(item.maxContext) && item.maxContext > 0)) {
        fail(`${where}.maxContext: целое > 0`);
      }
    }
  }
}

/**
 * Validate the house of the run: the model of the house for the roles that have one.
 * @param {unknown} house
 * @param {(message: string) => never} fail
 * @param {object} config the merged config
 */
function validateHouse(house, fail, config) {
  const where = 'house';
  if (!isRecord(house)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(house)) {
    if (!['models', 'ranks'].includes(key)) fail(`${where}.${key}: неизвестное поле (допустимо: models | ranks)`);
  }
  const models = house.models;
  if (!isRecord(models)) fail(`${where}.models должен быть объектом`);
  for (const [role, model] of Object.entries(models)) {
    if (!role.trim()) fail(`${where}.models: пустое имя роли`);
    if (model === null) continue;
    if (typeof model !== 'string' || !model.trim()) fail(`${where}.models.${role}: непустая строка или null`);
    checkModelRef(model, `${where}.models.${role}`, fail, config);
  }
  const ranks = house.ranks;
  if (!isRecord(ranks)) fail(`${where}.ranks должен быть объектом`);
  for (const key of Object.keys(ranks)) {
    if (!['roles', 'stages'].includes(key)) fail(`${where}.ranks.${key}: неизвестное поле (допустимо: roles | stages)`);
  }
  // Лестница рангов принадлежит роли, но и стадия может иметь свою: у роли может быть
  // несколько стадий, и у каждой — своя лестница моделей.
  for (const part of ['roles', 'stages']) {
    const map = ranks[part];
    if (map === undefined) continue;
    if (!isRecord(map)) fail(`${where}.ranks.${part} должен быть объектом`);
    for (const [name, path] of Object.entries(map)) {
      if (!name.trim()) fail(`${where}.ranks.${part}: пустое имя`);
      const list = Array.isArray(path) ? path : [path];
      if (!list.length) fail(`${where}.ranks.${part}.${name}: непустой список рангов`);
      for (const rank of list) {
        if (!(Number.isSafeInteger(rank) && rank >= 0)) fail(`${where}.ranks.${part}.${name}: целое >= 0 или список целых`);
      }
    }
  }
}

/**
 * Validate an optional header map: token names, single-line string values.
 * @param {unknown} headers
 * @param {string} where
 * @param {(message: string) => never} fail
 */
function validateHeaders(headers, where, fail) {
  if (headers == null) return;
  if (!isRecord(headers)) fail(`${where} должен быть объектом`);
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) fail(`${where}.${name}: некорректное имя заголовка`);
    if (typeof value !== 'string' || /[\r\n]/.test(value)) fail(`${where}.${name}: строка без перевода строки`);
  }
}

/** Normalize + validate a backend `supports` map via the alias table. */
function validateSupports(supports, where, fail) {
  if (supports == null) return;
  if (!isRecord(supports)) fail(`${where} должен быть объектом`);
  for (const [rawKey, value] of Object.entries(supports)) {
    const key = SUPPORT_ALIASES[rawKey.toLowerCase()] ?? rawKey;
    if (!ENUMS.backendRoutes.includes(key)) fail(`${where}.${rawKey}: ${ENUMS.backendRoutes.join(' | ')}`);
    if (typeof value !== 'boolean') fail(`${where}.${rawKey}: true | false`);
  }
}

/**
 * Validate one backend list (backends).
 * @param {unknown} list
 * @param {string} where
 * @param {(message: string) => never} fail
 */
function validateBackendList(list, where, fail) {
  if (!Array.isArray(list)) fail(`${where} должен быть массивом`);
  for (const [index, item] of list.entries()) {
    if (!isRecord(item)) fail(`${where}[${index}] должен быть объектом`);
    const entry = `${where}[${index}]`;
    for (const key of Object.keys(item)) {
      if (!['baseURL', 'apiKey', 'env', 'headers', 'body', 'supports'].includes(key)) fail(`${entry}.${key}: неизвестное поле`);
    }
    if (typeof item.baseURL !== 'string' || !item.baseURL.trim()) fail(`${entry}.baseURL должен быть URL`);
    try { new URL(item.baseURL); } catch { fail(`${entry}.baseURL должен быть URL`); }
    if (item.apiKey != null && (typeof item.apiKey !== 'string' || /[\r\n]/.test(item.apiKey))) fail(`${entry}.apiKey: строка или null`);
    if (item.env != null && (typeof item.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(item.env))) fail(`${entry}.env: имя переменной или null`);
    validateHeaders(item.headers, `${entry}.headers`, fail);
    validateSupports(item.supports, `${entry}.supports`, fail);
  }
}

/** Validate per-model backend lists: { model: [{ baseURL, ... }] }. */
function validateModelBackends(map, fail) {
  if (!isRecord(map)) fail('modelsBackends должен быть объектом');
  for (const [model, list] of Object.entries(map)) {
    if (!model.trim()) fail('modelsBackends: ключ модели не должен быть пустым');
    if (!Array.isArray(list) || !list.length) fail(`modelsBackends.${model} должен быть непустым массивом`);
    for (const [index, item] of list.entries()) {
      const entry = `modelsBackends.${model}[${index}]`;
      if (!isRecord(item)) fail(`${entry} должен быть объектом`);
      for (const key of Object.keys(item)) {
        if (!['baseURL', 'apiKey', 'prefix', 'vendor', 'suffix', 'type'].includes(key)) fail(`${entry}.${key}: неизвестное поле`);
      }
      if (typeof item.baseURL !== 'string' || !item.baseURL.trim()) fail(`${entry}.baseURL должен быть URL`);
      try { new URL(item.baseURL); } catch { fail(`${entry}.baseURL должен быть URL`); }
      if (item.apiKey != null && (typeof item.apiKey !== 'string' || /[\r\n]/.test(item.apiKey))) fail(`${entry}.apiKey: строка или null`);
      if (item.type != null && !['auto', 'text'].includes(item.type)) fail(`${entry}.type: auto | text`);
    }
  }
}

/** Validate one stage section against the shape known for that stage. */
function validateStage(id, section, fail) {
  const where = `stages.${id}`;
  if (!isRecord(section)) fail(`${where} должен быть объектом`);
  if (typeof section.enabled !== 'boolean') fail(`${where}.enabled: true | false`);
  const known = defaults.stages[id] ?? {};
  for (const key of Object.keys(section)) {
    if (!(key in known)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(known).join(', ')})`);
  }
  if (!(Number.isSafeInteger(section.maxTurns) && section.maxTurns > 0)) fail(`${where}.maxTurns: целое > 0`);
  if (section.repair != null && typeof section.repair !== 'boolean') fail(`${where}.repair: true | false`);
  if (section.repairRounds != null && !(Number.isSafeInteger(section.repairRounds) && section.repairRounds >= 0)) {
    fail(`${where}.repairRounds: целое >= 0`);
  }
  if (section.checkStyles != null && typeof section.checkStyles !== 'boolean') {
    fail(`${where}.checkStyles: true | false`);
  }
  if (section.timeoutMs != null && !(Number.isSafeInteger(section.timeoutMs) && section.timeoutMs > 0)) {
    fail(`${where}.timeoutMs: целое > 0`);
  }
}

/**
 * Validate the `stack` section: the framework and the languages of the result.
 * @param {object} stack
 * @param {(message: string) => never} fail
 */
function validateStack(stack, fail) {
  const where = 'stack';
  if (!isRecord(stack)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(stack)) {
    if (!(key in defaults.stack)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.stack).join(', ')})`);
  }
  if (!ENUMS.frontendFrameworks.includes(stack.frontendFramework)) fail(`${where}.frontendFramework: ${ENUMS.frontendFrameworks.join(' | ')}`);
  if (!ENUMS.markupLanguages.includes(stack.markupLanguage)) fail(`${where}.markupLanguage: ${ENUMS.markupLanguages.join(' | ')}`);
  if (!ENUMS.styleLanguages.includes(stack.styleLanguage)) fail(`${where}.styleLanguage: ${ENUMS.styleLanguages.join(' | ')}`);
  if (!ENUMS.scriptLanguages.includes(stack.scriptLanguage)) fail(`${where}.scriptLanguage: ${ENUMS.scriptLanguages.join(' | ')}`);
  if (!ENUMS.iconSets.includes(stack.iconSet)) fail(`${where}.iconSet: ${ENUMS.iconSets.join(' | ')}`);
  if (![true, false, 'auto'].includes(stack.stateful)) {
    fail(`${where}.stateful: true | false | auto`);
  }
}

/**
 * Validate the `agent` section: the knobs of the generator.
 * @param {object} agent
 * @param {(message: string) => never} fail
 */
function validateAgent(agent, fail) {
  const where = 'agent';
  if (!isRecord(agent)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(agent)) {
    if (!(key in defaults.agent)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.agent).join(', ')})`);
  }
  for (const key of ['fidelity', 'creativity']) {
    if (!(Number.isSafeInteger(agent[key]) && agent[key] >= 0 && agent[key] <= 100)) fail(`${where}.${key}: целое 0..100`);
  }
  if (typeof agent.platform !== 'string' || !agent.platform.trim()) fail(`${where}.platform: непустая строка`);
  if (!ENUMS.generationKinds.includes(agent.kind)) fail(`${where}.kind: ${ENUMS.generationKinds.join(' | ')}`);
  if (!ENUMS.approvalLevels.includes(agent.approve)) fail(`${where}.approve: ${ENUMS.approvalLevels.join(' | ')}`);
  if (!ENUMS.extractModes.includes(agent.extract)) fail(`${where}.extract: ${ENUMS.extractModes.join(' | ')}`);
  for (const key of ['plannerMaxTurns', 'architectMaxTurns', 'coderMaxTurns']) {
    if (!(Number.isSafeInteger(agent[key]) && agent[key] > 0)) fail(`${where}.${key}: целое > 0`);
  }
}

/**
 * Validate the `pace` section: the speed and the quality dials.
 * @param {object} pace
 * @param {(message: string) => never} fail
 */
function validatePace(pace, fail) {
  const where = 'pace';
  if (!isRecord(pace)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(pace)) {
    if (!(key in defaults.pace)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.pace).join(', ')})`);
  }
  if (!ENUMS.paceModes.includes(pace.mode)) fail(`${where}.mode: ${ENUMS.paceModes.join(' | ')}`);
  for (const [key, value] of Object.entries(pace)) {
    if (key === 'mode') continue;
    if (!(Number.isSafeInteger(value) && value >= 0 && value <= 100)) fail(`${where}.${key}: целое 0..100`);
  }
}

/**
 * Validate the `memory` section: the permanent memory of the CLI.
 * @param {object} memory
 * @param {(message: string) => never} fail
 */
function validateMemory(memory, fail) {
  const where = 'memory';
  if (!isRecord(memory)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(memory)) {
    if (!(key in defaults.memory)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.memory).join(', ')})`);
  }
  if (memory.dbFile !== null && (typeof memory.dbFile !== 'string' || !memory.dbFile.trim())) fail(`${where}.dbFile: путь или null`);
  if (!ENUMS.memoryScopes.includes(memory.scope)) fail(`${where}.scope: ${ENUMS.memoryScopes.join(' | ')}`);
  if (!(Number.isSafeInteger(memory.limit) && memory.limit > 0)) fail(`${where}.limit: целое > 0`);
  for (const key of ['files', 'tasks']) {
    if (typeof memory[key] !== 'boolean') fail(`${where}.${key}: true | false`);
  }
  const program = memory.program;
  if (!isRecord(program)) fail(`${where}.program должен быть объектом`);
  for (const key of Object.keys(program)) {
    if (!['enabled', 'command', 'timeoutMs'].includes(key)) {
      fail(`${where}.program.${key}: неизвестное поле (допустимо: enabled | command | timeoutMs)`);
    }
  }
  if (typeof program.enabled !== 'boolean') fail(`${where}.program.enabled: true | false`);
  if (typeof program.command !== 'string' || !program.command.trim()) fail(`${where}.program.command: непустая строка`);
  if (!(Number.isSafeInteger(program.timeoutMs) && program.timeoutMs > 0)) fail(`${where}.program.timeoutMs: целое > 0`);
}

/**
 * Validate the `context` section: the context of a run.
 * @param {object} context
 * @param {(message: string) => never} fail
 */
function validateContext(context, fail) {
  const where = 'context';
  if (!isRecord(context)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(context)) {
    if (!(key in defaults.context)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.context).join(', ')})`);
  }
  for (const key of ['enabled', 'cache']) {
    if (typeof context[key] !== 'boolean') fail(`${where}.${key}: true | false`);
  }
  if (!(Number.isSafeInteger(context.maxBriefChars) && context.maxBriefChars > 0)) fail(`${where}.maxBriefChars: целое > 0`);
}

/**
 * Validate the `map` section: the map of a run.
 * @param {object} map
 * @param {(message: string) => never} fail
 */
function validateMap(map, fail) {
  const where = 'map';
  if (!isRecord(map)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(map)) {
    if (!(key in defaults.map)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.map).join(', ')})`);
  }
  if (typeof map.enabled !== 'boolean') fail(`${where}.enabled: true | false`);
  for (const key of ['depth', 'maxFiles', 'maxFileBytes', 'maxLines']) {
    if (!(Number.isSafeInteger(map[key]) && map[key] > 0)) fail(`${where}.${key}: целое > 0`);
  }
}

/**
 * Validate the `components` section: the local registry.
 * @param {object} components
 * @param {(message: string) => never} fail
 */
function validateComponents(components, fail) {
  const where = 'components';
  if (!isRecord(components)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(components)) {
    if (!(key in defaults.components)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.components).join(', ')})`);
  }
  for (const key of ['dir', 'dbFile']) {
    if (components[key] !== null && (typeof components[key] !== 'string' || !components[key].trim())) fail(`${where}.${key}: путь или null`);
  }
  if (typeof components.vendorDir !== 'string' || !components.vendorDir.trim()) fail(`${where}.vendorDir: непустая строка`);
  if (typeof components.autoReuse !== 'boolean') fail(`${where}.autoReuse: true | false`);
}

/**
 * Validate the `bridges` section: the external CLIs.
 * @param {object} bridges
 * @param {(message: string) => never} fail
 */
function validateBridges(bridges, fail) {
  const where = 'bridges';
  if (!isRecord(bridges)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(bridges)) {
    if (!ENUMS.bridges.includes(key)) fail(`${where}.${key}: неизвестный мост (${ENUMS.bridges.join(' | ')})`);
  }
  for (const name of ENUMS.bridges) {
    const entry = bridges[name];
    const at = `${where}.${name}`;
    if (!isRecord(entry)) fail(`${at} должен быть объектом`);
    for (const key of Object.keys(entry)) {
      if (!['enabled', 'command', 'timeoutMs', 'log'].includes(key)) fail(`${at}.${key}: неизвестное поле`);
    }
    if (typeof entry.enabled !== 'boolean') fail(`${at}.enabled: true | false`);
    if (typeof entry.command !== 'string' || !entry.command.trim()) fail(`${at}.command: непустая строка`);
    if (!(Number.isSafeInteger(entry.timeoutMs) && entry.timeoutMs > 0)) fail(`${at}.timeoutMs: целое > 0`);
    if (typeof entry.log !== 'boolean') fail(`${at}.log: true | false`);
  }
}

/**
 * Validate the `pictures` section: the crops that are prepared and how.
 * @param {object} pictures
 * @param {(message: string) => never} fail
 */
function validatePictures(pictures, fail) {
  const where = 'pictures';
  if (!isRecord(pictures)) fail(`${where} должен быть объектом`);
  for (const key of Object.keys(pictures)) {
    if (!(key in defaults.pictures)) fail(`${where}.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.pictures).join(', ')})`);
  }
  if (typeof pictures.enabled !== 'boolean') fail(`${where}.enabled: true | false`);
  if (!Array.isArray(pictures.kinds) || !pictures.kinds.every((item) => typeof item === 'string')) {
    fail(`${where}.kinds: массив строк`);
  }
  if (typeof pictures.command !== 'string' || !pictures.command.trim()) fail(`${where}.command: непустая строка`);
  for (const [key, value] of Object.entries(pictures.commands ?? {})) {
    if (typeof value !== 'string' || !value.trim()) fail(`${where}.commands.${key}: непустая строка`);
  }
  for (const [key, value] of Object.entries(pictures.prompts ?? {})) {
    if (typeof value !== 'string') fail(`${where}.prompts.${key}: строка`);
  }
  if (typeof pictures.subject !== 'string') fail(`${where}.subject: строка`);
  for (const [key, value] of Object.entries(pictures.subjects ?? {})) {
    if (typeof value !== 'string') fail(`${where}.subjects.${key}: строка`);
  }
  if (typeof pictures.alphaMode !== 'string' || !pictures.alphaMode.trim()) fail(`${where}.alphaMode: непустая строка`);
  if (pictures.model !== null && (typeof pictures.model !== 'string' || !pictures.model.trim())) {
    fail(`${where}.model: непустая строка или null`);
  }
  if (pictures.models != null && (!Array.isArray(pictures.models)
    || !pictures.models.every((item) => typeof item === 'string' && item.trim()))) {
    fail(`${where}.models: массив непустых строк или null`);
  }
  if (pictures.quality != null && (typeof pictures.quality !== 'string' || !pictures.quality.trim())) {
    fail(`${where}.quality: непустая строка или null`);
  }
  if (typeof pictures.dir !== 'string' || !pictures.dir.trim()) fail(`${where}.dir: непустая строка`);
  if (typeof pictures.assetsDir !== 'string' || !pictures.assetsDir.trim()) fail(`${where}.assetsDir: непустая строка`);
  if (!(Number.isSafeInteger(pictures.max) && pictures.max > 0)) fail(`${where}.max: целое > 0`);
}

/**
 * Стадии и роли, что ушли из системы.
 *
 * Фаз письма было шесть, а стадия письма одна. Конфиг пользователя написан под
 * прошлую систему, и ронять прогон из-за него — значит наказывать за то, что
 * система изменилась.
 * @type {ReadonlySet<string>}
 */
const GONE_STAGES = new Set([
    'markup', 'pre-coding', 'pre-styling', 'styling', 'animation', 'coding',
    // Стадии графики слились в одну: `vector`, `pictures` и `assets` ушли.
    'vector', 'pictures', 'assets',
]);

/**
 * Убрать из конфига то, чего больше нет в системе.
 *
 * Молча уходят: стадии, роли и усилия, что называют того, чего нет. Остальное —
 * опечатка пользователя, и о ней по-прежнему говорит проверка.
 *
 * @param {object} config
 * @returns {{ config: object, dropped: string[] }}
 * @exports
 * @ai.hint pure
 */
export function dropGoneFromConfig(config = {}) {
    const c = config && typeof config === 'object' ? config : {};
    const dropped = [];

    // Стадии: `markup`, `pre-coding`, `pre-styling`, `styling`, `animation`, `coding`.
    if (isRecord(c.stages)) {
        const stages = { ...c.stages };
        for (const name of Object.keys(stages)) {
            if (ENUMS.stages.includes(name)) continue;
            if (!GONE_STAGES.has(name)) continue;
            delete stages[name];
            dropped.push(`stages.${name}`);
        }
        c.stages = stages;
    }

    // Роли: те же имена в профиле усилий и в профиле рангов.
    if (isRecord(c.reasoning) && isRecord(c.reasoning.stageEffort)) {
        const profile = { ...c.reasoning.stageEffort };
        for (const name of Object.keys(profile)) {
            if (GONE_STAGES.has(name)) {
                delete profile[name];
                dropped.push(`reasoning.stageEffort.${name}`);
            }
        }
        c.reasoning = { ...c.reasoning, stageEffort: profile };
    }

    if (isRecord(c.house) && isRecord(c.house.ranks) && isRecord(c.house.ranks.stages)) {
        const stages = { ...c.house.ranks.stages };
        for (const name of Object.keys(stages)) {
            if (GONE_STAGES.has(name)) {
                delete stages[name];
                dropped.push(`house.ranks.stages.${name}`);
            }
        }
        c.house = { ...c.house, ranks: { ...c.house.ranks, stages } };
    }

    return { config: c, dropped };
}

/**
 * Throw when any merged value is outside the accepted enums and ranges.
 * @param {object} config
 * @returns {void}
 */
export function validateConfig(config) {
  const fail = (message) => { throw new Error(`Конфигурация: ${message}`); };
  const c = config;

  if (typeof c.model !== 'string' || !c.model.trim()) fail('укажите model (или AI_WEBDEV_MODEL / --model).');
  checkModelRef(c.model, 'model', fail, c);
  if (typeof c.baseURL !== 'string' || !c.baseURL.trim()) fail('baseURL должен быть URL.');
  try { new URL(c.baseURL); } catch { fail('baseURL должен быть URL.'); }
  if (c.apiKey !== null && (typeof c.apiKey !== 'string' || /[\r\n]/.test(c.apiKey))) fail('apiKey: строка или null.');

  if (!isRecord(c.models)) fail('models должен быть объектом');
  for (const [modelId, profile] of Object.entries(c.models)) {
    if (!isRecord(profile)) fail(`models.${modelId} должен быть объектом`);
    for (const key of Object.keys(profile)) {
      if (!['window', 'maxOutput', 'ceiling', 'schemaChannel'].includes(key)) fail(`models.${modelId}.${key}: неизвестное поле`);
    }
    if (profile.window != null && !(Number.isSafeInteger(profile.window) && profile.window > 0)) fail(`models.${modelId}.window: целое > 0`);
    if (profile.maxOutput != null && !(Number.isSafeInteger(profile.maxOutput) && profile.maxOutput > 0)) fail(`models.${modelId}.maxOutput: целое > 0`);
    if (profile.ceiling != null && !ENUMS.reasoningEfforts.includes(profile.ceiling)) fail(`models.${modelId}.ceiling: ${ENUMS.reasoningEfforts.join(' | ')}`);
    if (profile.schemaChannel != null && !['auto', 'tool', 'format'].includes(profile.schemaChannel)) fail(`models.${modelId}.schemaChannel: auto | tool | format`);
  }

  validateModelFamilies(c.modelFamilies, fail);
  validateModelGroups(c.modelGroups, fail);
  validateHouse(c.house, fail, c);

  if (!isRecord(c.reasoning)) fail('reasoning должен быть объектом');
  for (const key of Object.keys(c.reasoning)) if (!(key in defaults.reasoning)) fail(`reasoning.${key}: неизвестное поле`);
  if (c.reasoning.effort !== null && !ENUMS.reasoningEfforts.includes(c.reasoning.effort)) fail(`reasoning.effort: ${ENUMS.reasoningEfforts.join(' | ')}`);
  if (c.reasoning.summary !== null && !ENUMS.reasoningSummaries.includes(c.reasoning.summary)) fail(`reasoning.summary: ${ENUMS.reasoningSummaries.join(' | ')}`);
  if (c.reasoning.mode !== null && c.reasoning.mode !== undefined && !ENUMS.reasoningModes.includes(c.reasoning.mode)) fail(`reasoning.mode: ${ENUMS.reasoningModes.join(' | ')}`);
  const stageEffort = c.reasoning.stageEffort;
  if (stageEffort !== null && stageEffort !== undefined) {
    if (!isRecord(stageEffort)) fail('reasoning.stageEffort: объект или null');
    // Профиль знает и роли, и стадии: у роли может быть несколько стадий, и у каждой
    // своя планка усилия.
    const known = new Set([
      ...Object.keys(defaults.roles).filter((name) => name !== 'default'),
      ...ENUMS.stages,
    ]);
    for (const [name, level] of Object.entries(stageEffort)) {
      if (!known.has(name) && !isRecord(c.customRoles?.[name])) fail(`reasoning.stageEffort.${name}: неизвестная роль или стадия`);
      if (!ENUMS.reasoningEfforts.includes(level)) fail(`reasoning.stageEffort.${name}: ${ENUMS.reasoningEfforts.join(' | ')}`);
    }
  }
  const kindEffort = c.reasoning.kindEffort;
  if (kindEffort !== null && kindEffort !== undefined) {
    if (!isRecord(kindEffort)) fail('reasoning.kindEffort: объект или null');
    // Профиль знает виды файлов: работа идёт по файлам, и вид говорит, сколько мысли
    // она требует.
    const known = new Set(Object.keys(KIND_EFFORT));
    for (const [name, level] of Object.entries(kindEffort)) {
      if (!known.has(name)) fail(`reasoning.kindEffort.${name}: неизвестный вид файла`);
      if (!ENUMS.reasoningEfforts.includes(level)) fail(`reasoning.kindEffort.${name}: ${ENUMS.reasoningEfforts.join(' | ')}`);
    }
  }
  if (c.verbosity !== null && !['low', 'medium', 'high'].includes(c.verbosity)) fail('verbosity: low | medium | high');
  if (c.temperature !== null && !(Number.isFinite(c.temperature) && c.temperature >= 0 && c.temperature <= 2)) fail('temperature: 0..2');
  if (c.maxOutputTokens !== null && !(Number.isSafeInteger(c.maxOutputTokens) && c.maxOutputTokens >= 16)) fail('maxOutputTokens ≥ 16');
  if (typeof c.store !== 'boolean') fail('store: true | false');
  if (!['auto', 'disabled'].includes(c.truncation)) fail('truncation: auto | disabled');
  if (!Number.isSafeInteger(c.retries) || c.retries < 0 || c.retries > 10) fail('retries: 0..10');
  if (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 5_000 || c.timeoutMs > 1_800_000) fail('timeoutMs: 5000..1800000');

  validateBackendList(c.backends, 'backends', fail);
  validateModelBackends(c.modelsBackends, fail);
  if (!isRecord(c.fallback)) fail('fallback должен быть объектом');
  if (typeof c.fallback.enabled !== 'boolean') fail('fallback.enabled: true | false');

  for (const [key, value] of Object.entries(c.limits)) {
    if (!(key in defaults.limits)) fail(`неизвестный лимит limits.${key}`);
    if (!(Number.isSafeInteger(value) && value > 0)) fail(`limits.${key}: положительное целое`);
  }

  if (!isRecord(c.logging)) fail('logging должен быть объектом');
  for (const key of Object.keys(c.logging)) if (!(key in defaults.logging)) fail(`logging.${key}: неизвестное поле`);
  if (typeof c.logging.enabled !== 'boolean') fail('logging.enabled: true | false');
  if (typeof c.logging.dir !== 'string' || !c.logging.dir.trim()) fail('logging.dir: непустая строка');

  for (const [key, value] of Object.entries(c.tools)) {
    if (!(key in defaults.tools) || typeof value !== 'boolean') fail(`tools.${key}: true | false (известные: ${Object.keys(defaults.tools).join(', ')})`);
  }

  if (!isRecord(c.browser)) fail('browser должен быть объектом');
  for (const key of Object.keys(c.browser)) {
    if (!(key in defaults.browser)) fail(`browser.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.browser).join(', ')})`);
  }
  if (!['auto', 'ego', 'chrome'].includes(c.browser.engine)) fail('browser.engine: auto | ego | chrome');
  if (c.browser.executable !== null && (typeof c.browser.executable !== 'string' || !c.browser.executable.trim())) {
    fail('browser.executable: непустая строка или null');
  }
  if (!Number.isSafeInteger(c.browser.timeoutMs) || c.browser.timeoutMs < 1000) fail('browser.timeoutMs: целое от 1000');
  if (!isRecord(c.browser.viewport)) fail('browser.viewport должен быть объектом');
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(c.browser.viewport[key]) || c.browser.viewport[key] < 100) fail(`browser.viewport.${key}: целое от 100`);
  }
  if (!['off', 'auto', 'always'].includes(c.browser.stylingVision)) fail('browser.stylingVision: off | auto | always');
  if (!Number.isSafeInteger(c.browser.stylingVisionRounds) || c.browser.stylingVisionRounds < 0) {
    fail('browser.stylingVisionRounds: целое от 0');
  }
  if (c.browser.url !== null && typeof c.browser.url !== 'string') fail('browser.url: непустая строка');
  if (c.browser.url && !/^https?:\/\//i.test(c.browser.url.trim())) fail('browser.url: адрес с http:// или https://');
  if (!['off', 'auto', 'always'].includes(c.browser.devServer)) fail('browser.devServer: off | auto | always');
  if (!Number.isSafeInteger(c.browser.devTimeoutMs) || c.browser.devTimeoutMs < 1000) fail('browser.devTimeoutMs: целое от 1000');
  if (!['off', 'auto', 'always'].includes(c.browser.compare)) fail('browser.compare: off | auto | always');
  if (!Array.isArray(c.browser.compareDprs) || !c.browser.compareDprs.length) {
    fail('browser.compareDprs: непустой массив чисел');
  } else if (c.browser.compareDprs.some((item) => !Number.isFinite(Number(item)) || Number(item) <= 0)) {
    fail('browser.compareDprs: только положительные числа');
  }
  if (typeof c.browser.compareAtDesignWidth !== 'boolean') fail('browser.compareAtDesignWidth: true | false');
  if (!['off', 'auto', 'always', 'on'].includes(c.browser.devtools)) fail('browser.devtools: off | auto | always');
  if (c.browser.devtoolsPackage != null && (typeof c.browser.devtoolsPackage !== 'string' || !c.browser.devtoolsPackage.trim())) {
    fail('browser.devtoolsPackage: непустая строка или null');
  }
  if (c.browser.devtoolsCommand != null && (typeof c.browser.devtoolsCommand !== 'string' || !c.browser.devtoolsCommand.trim())) {
    fail('browser.devtoolsCommand: непустая строка или null');
  }
  if (c.browser.devtoolsArgs != null && !Array.isArray(c.browser.devtoolsArgs)) fail('browser.devtoolsArgs: массив строк или null');
  if (c.browser.devtoolsTools != null && !Array.isArray(c.browser.devtoolsTools)) fail('browser.devtoolsTools: массив строк или null');
  if (!Number.isSafeInteger(c.browser.devtoolsTimeoutMs) || c.browser.devtoolsTimeoutMs < 1000) fail('browser.devtoolsTimeoutMs: целое от 1000');

  validateStack(c.stack, fail);
  validateAgent(c.agent, fail);
  validatePace(c.pace, fail);

  if (!isRecord(c.stages)) fail('stages должен быть объектом');
  for (const key of Object.keys(c.stages)) {
    if (!ENUMS.stages.includes(key)) fail(`stages.${key}: неизвестная стадия (${ENUMS.stages.join(' | ')})`);
  }
  for (const id of ENUMS.stages) validateStage(id, c.stages[id], fail);

  if (!isRecord(c.output)) fail('output должен быть объектом');
  for (const key of ['dir', 'work']) {
    if (typeof c.output[key] !== 'string' || !c.output[key].trim()) fail(`output.${key}: непустая строка`);
  }

  if (!isRecord(c.inputs)) fail('inputs должен быть объектом');
  for (const key of Object.keys(c.inputs)) {
    if (!(key in defaults.inputs)) fail(`inputs.${key}: неизвестное поле (допустимо: ${Object.keys(defaults.inputs).join(', ')})`);
  }
  for (const key of ['designMd', 'measurements', 'palette', 'tokens']) {
    const value = c.inputs[key];
    const list = Array.isArray(value) ? value : [value];
    if (!list.length || list.some((item) => typeof item !== 'string' || !item.trim())) {
      fail(`inputs.${key}: непустая строка или список непустых строк`);
    }
  }
  if (typeof c.inputs.projectInstructions !== 'boolean') fail('inputs.projectInstructions: true | false');
  const extra = c.inputs.extra ?? [];
  if (!Array.isArray(extra)) fail('inputs.extra: список строк');
  if (extra.some((item) => typeof item !== 'string' || !item.trim())) fail('inputs.extra: список непустых строк');
  const reference = c.inputs.reference ?? null;
  if (reference !== null && typeof reference !== 'string' && !Array.isArray(reference)) {
    fail('inputs.reference: null | строка | список строк');
  }
  if (Array.isArray(reference) && reference.some((item) => typeof item !== 'string' || !item.trim())) {
    fail('inputs.reference: список непустых строк');
  }

  validateMemory(c.memory, fail);
  validateContext(c.context, fail);
  validateMap(c.map, fail);
  validateComponents(c.components, fail);
  validateBridges(c.bridges, fail);
  validatePictures(c.pictures, fail);

  if (!isRecord(c.roles)) fail('roles должен быть объектом');
  for (const [name, role] of Object.entries(c.roles)) {
    if (!name.trim()) fail('roles: пустое имя роли');
    if (!isRecord(role)) fail(`roles.${name} должен быть объектом`);
    for (const key of Object.keys(role)) {
      if (!ROLE_FIELDS.includes(key)) fail(`roles.${name}.${key}: неизвестное поле`);
    }
    if (role.model != null && (typeof role.model !== 'string' || !role.model.trim())) fail(`roles.${name}.model: строка или null`);
    checkModelRef(role.model, `roles.${name}.model`, fail, c);
    if (role.effort != null && !ENUMS.reasoningEfforts.includes(role.effort)) fail(`roles.${name}.effort: ${ENUMS.reasoningEfforts.join(' | ')}`);
    if (role.maxEffort != null && !ENUMS.reasoningEfforts.includes(role.maxEffort)) fail(`roles.${name}.maxEffort: ${ENUMS.reasoningEfforts.join(' | ')}`);
    if (role.context != null && !(ENUMS.contextWords.includes(role.context) || (Number.isSafeInteger(role.context) && role.context > 0))) fail(`roles.${name}.context: ${ENUMS.contextWords.join(' | ')} или байты`);
    if (role.tools != null && !Array.isArray(role.tools)) fail(`roles.${name}.tools: массив имён или null`);
    if (role.instructions != null && typeof role.instructions !== 'string') fail(`roles.${name}.instructions: строка или null`);
  }

  if (!isRecord(c.customRoles)) fail('customRoles должен быть объектом');
  if (!isRecord(c.documentation)) fail('documentation должен быть объектом');
  for (const key of Object.keys(c.documentation)) {
    if (!['sources', 'roles'].includes(key)) fail(`неизвестный параметр documentation.${key}`);
  }
  if (!isRecord(c.documentation.sources)) fail('documentation.sources должен быть объектом');
  for (const [name, url] of Object.entries(c.documentation.sources)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) fail(`documentation.sources.${name}: некорректное имя`);
    if (typeof url !== 'string' || !url.trim()) fail(`documentation.sources.${name}: URL должен быть непустой строкой`);
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      fail(`documentation.sources.${name}: некорректный HTTP(S) URL`);
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      fail(`documentation.sources.${name}: разрешены только HTTP(S) URL`);
    }
  }
  if (!isRecord(c.documentation.roles)) fail('documentation.roles должен быть объектом');
  for (const [name, list] of Object.entries(c.documentation.roles)) {
    if (!Array.isArray(list)) fail(`documentation.roles.${name}: массив имён источников`);
    for (const item of list) {
      if (typeof item !== 'string' || !item.trim()) fail(`documentation.roles.${name}: имя источника должно быть строкой`);
      // A name of a role is either a standard of the package or a source of the map.
      if (!ENUMS.documentationSources.includes(item) && !Object.hasOwn(c.documentation.sources, item)) {
        fail(`documentation.roles.${name}: неизвестный источник "${item}" (встроенные стандарты: ${ENUMS.documentationSources.join(', ')}; свой источник добавьте в documentation.sources)`);
      }
    }
  }

  if (!isRecord(c.mcp)) fail('mcp должен быть объектом');
  for (const key of Object.keys(c.mcp)) if (!(key in defaults.mcp)) fail(`mcp.${key}: неизвестное поле`);
  if (!Array.isArray(c.mcp.servers)) fail('mcp.servers: массив серверов');
  c.mcp.servers.forEach((server, index) => {
    if (!isRecord(server)) fail(`mcp.servers[${index}]: объект`);
    if (server.name != null && (typeof server.name !== 'string' || !server.name.trim())) fail(`mcp.servers[${index}].name: непустая строка или null`);
    if (server.url != null && (typeof server.url !== 'string' || !server.url.trim())) fail(`mcp.servers[${index}].url: непустая строка или null`);
    if (server.command != null && (typeof server.command !== 'string' || !server.command.trim())) fail(`mcp.servers[${index}].command: непустая строка или null`);
    if (!server.url && !server.command) fail(`mcp.servers[${index}]: нужен url или command`);
    if (server.args != null && !Array.isArray(server.args)) fail(`mcp.servers[${index}].args: массив строк или null`);
  });
  if (c.skills != null) {
    if (!isRecord(c.skills)) fail('skills должен быть объектом');
    if (c.skills.dir !== null && (typeof c.skills.dir !== 'string' || !c.skills.dir.trim())) fail('skills.dir: путь или null');
  }
}
