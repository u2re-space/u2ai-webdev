/**
 * @file test/config.test.js
 * @module test/config
 * @purpose The tests of the configuration: the defaults, the merge of the sources, the
 *          validation with its Russian messages and the loader of the home.
 * @depends node:test, node:path, node:fs/promises, config
 * @ai.tags test, config
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';

import {
    ENUMS,
    defaults,
    cloneDefaults,
    defaultConfigText,
    validateConfig,
    loadConfig,
    ensureConfigFile,
    redactConfig,
    homeConfigFile,
    defaultHome,
} from '../src/config/index.js';
import { deepMerge, getPath, setPath, isRecord } from '../src/config/merge.js';
import { readConfigFile, writeConfigFile, expandPlaceholders, mergeSources } from '../src/config/parser.js';
import { fromEnv, envConfigPath } from '../src/config/env.js';

const HOME_ENV = { AI_WEBDEV_HOME: path.join(os.tmpdir(), 'ai-webdev-config-test') };

/**
 * A temp home for one test.
 * @returns {Promise<string>}
 */
async function tempHome() {
    return mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
}

test('the defaults hold every stage of the pipeline, including learn', () => {
    for (const stage of ENUMS.stages) {
        assert.ok(defaults.stages[stage], `the stage ${stage} is missing in the defaults`);
        assert.equal(defaults.stages[stage].enabled, true);
        assert.ok(defaults.stages[stage].maxTurns > 0);
    }
    assert.ok(defaults.stages.learn, 'the stage learn must be in the defaults');
});

test('the defaults of the policy of the run are whole', () => {
    assert.equal(defaults.agent.approve, 'write');
    assert.equal(defaults.agent.extract, 'auto');
    assert.ok(ENUMS.approvalLevels.includes(defaults.agent.approve));
    assert.ok(ENUMS.extractModes.includes(defaults.agent.extract));
    assert.equal(defaults.agent.fidelity, 70);
    assert.equal(defaults.agent.creativity, 30);
    assert.equal(defaults.agent.kind, 'app');
    assert.equal(defaults.agent.platform, 'chromium');
});

test('the defaults pass the validation', () => {
    assert.doesNotThrow(() => validateConfig(cloneDefaults()));
});

test('the validation names the exact path of the wrong value', () => {
    const config = cloneDefaults();
    config.agent.approve = 'maybe';
    assert.throws(() => validateConfig(config), /Конфигурация: agent\.approve: ask \| read \| write \| all/);

    const extract = cloneDefaults();
    extract.agent.extract = 'sometimes';
    assert.throws(() => validateConfig(extract), /Конфигурация: agent\.extract: off \| auto \| always/);

    const pace = cloneDefaults();
    pace.pace.speed = 101;
    assert.throws(() => validateConfig(pace), /Конфигурация: pace\.speed: целое 0\.\.100/);

    const fidelity = cloneDefaults();
    fidelity.agent.fidelity = -1;
    assert.throws(() => validateConfig(fidelity), /Конфигурация: agent\.fidelity: целое 0\.\.100/);

    const kind = cloneDefaults();
    kind.agent.kind = 'portfolio';
    assert.throws(() => validateConfig(kind), /Конфигурация: agent\.kind: landing \| site \| backend \| app \| component/);
});

test('the validation rejects an unknown stage and an unknown field', () => {
    const stage = cloneDefaults();
    stage.stages.deploy = { enabled: true, maxTurns: 4 };
    assert.throws(() => validateConfig(stage), /Конфигурация: stages\.deploy: неизвестная стадия/);

    const field = cloneDefaults();
    field.stages.plan.unknown = 1;
    assert.throws(() => validateConfig(field), /Конфигурация: stages\.plan\.unknown: неизвестное поле/);

    const section = cloneDefaults();
    section.stack.colors = 'red';
    assert.throws(() => validateConfig(section), /Конфигурация: stack\.colors: неизвестное поле/);
});

test('the check of the styles and the markup is a switch of the review', () => {
    const config = cloneDefaults();
    assert.equal(config.stages.review.checkStyles, true);
    config.stages.review.checkStyles = false;
    assert.doesNotThrow(() => validateConfig(config));

    const wrong = cloneDefaults();
    wrong.stages.review.checkStyles = 'yes';
    assert.throws(() => validateConfig(wrong), /Конфигурация: stages\.review\.checkStyles: true \| false/);
});

test('a request may stay silent for fifteen minutes', () => {
    // A thinking model works for minutes without a word. A short timeout does not make
    // the model faster: it throws the reasoning away and asks again.
    const config = cloneDefaults();
    assert.equal(config.timeoutMs, 900_000);
    assert.doesNotThrow(() => validateConfig(config));

    // The ceiling of the config is half an hour.
    const long = cloneDefaults();
    long.timeoutMs = 1_800_000;
    assert.doesNotThrow(() => validateConfig(long));
    long.timeoutMs = 1_800_001;
    assert.throws(() => validateConfig(long), /timeoutMs: 5000\.\.1800000/);
});

test('the validation of the profile of the stages names the role', () => {
    const level = cloneDefaults();
    level.reasoning.stageEffort.markup = 'turbo';
    assert.throws(() => validateConfig(level), /Конфигурация: reasoning\.stageEffort\.markup: none \| minimal \| low \| medium \| high \| xhigh \| max/);

    const role = cloneDefaults();
    role.reasoning.stageEffort.sculptor = 'high';
    assert.throws(() => validateConfig(role), /Конфигурация: reasoning\.stageEffort\.sculptor: неизвестная роль/);

    // The profile may be turned off: every role keeps the effort of the run.
    const off = cloneDefaults();
    off.reasoning.stageEffort = null;
    assert.doesNotThrow(() => validateConfig(off));
});

test('the validation of the bridges names the bridge', () => {
    const config = cloneDefaults();
    config.bridges.decompose.enabled = 'yes';
    assert.throws(() => validateConfig(config), /Конфигурация: bridges\.decompose\.enabled: true \| false/);

    const unknown = cloneDefaults();
    unknown.bridges.sketch = { enabled: true, command: 'x', timeoutMs: 1000 };
    assert.throws(() => validateConfig(unknown), /Конфигурация: bridges\.sketch: неизвестный мост/);
});

test('the paths of the inputs may be a list of candidates', () => {
    const config = cloneDefaults();
    config.inputs.measurements = ['sheet.json', 'measurements/measurements.json'];
    assert.doesNotThrow(() => validateConfig(config));

    const empty = cloneDefaults();
    empty.inputs.measurements = [];
    assert.throws(() => validateConfig(empty), /Конфигурация: inputs\.measurements: непустая строка или список непустых строк/);

    const broken = cloneDefaults();
    broken.inputs.palette = ['palette.json', ''];
    assert.throws(() => validateConfig(broken), /Конфигурация: inputs\.palette: непустая строка или список непустых строк/);
});

test('the merge keeps the fields of the default that the user did not touch', () => {
    const merged = mergeSources({ stack: { frontendFramework: 'react' } });
    assert.equal(merged.stack.frontendFramework, 'react');
    assert.equal(merged.stack.markupLanguage, defaults.stack.markupLanguage);
    assert.equal(merged.agent.approve, defaults.agent.approve);
    assert.deepEqual(merged.stages.learn, defaults.stages.learn);
});

test('the merge replaces the arrays instead of joining them', () => {
    const merged = mergeSources({ backends: [{ baseURL: 'https://example.test/v1' }] });
    assert.equal(merged.backends.length, 1);
    assert.equal(merged.backends[0].baseURL, 'https://example.test/v1');
});

test('the deep merge does not touch its arguments', () => {
    const base = { agent: { fidelity: 70, creativity: 30 } };
    const extra = { agent: { fidelity: 10 } };
    const merged = deepMerge(base, extra);
    assert.equal(merged.agent.fidelity, 10);
    assert.equal(merged.agent.creativity, 30);
    assert.equal(base.agent.fidelity, 70);
    assert.equal(extra.agent.fidelity, 10);
});

test('the paths of the config are read and written', () => {
    const tree = {};
    assert.equal(setPath(tree, ['agent', 'fidelity'], 50), false);
    assert.equal(getPath(tree, ['agent', 'fidelity']), 50);
    assert.equal(setPath(tree, ['agent', 'fidelity'], 60), true);
    assert.equal(getPath(tree, ['agent', 'fidelity']), 60);
    assert.equal(isRecord(tree.agent), true);
    assert.equal(isRecord([]), false);
});

test('the environment gives the fields of the config', () => {
    const env = {
        AI_WEBDEV_MODEL: 'test/model',
        AI_WEBDEV_EFFORT: 'high',
        AI_WEBDEV_FRAMEWORK: 'react',
        AI_WEBDEV_FIDELITY: '80',
        AI_WEBDEV_KIND: 'landing',
        AI_WEBDEV_STAGE_VECTOR: '0',
        AI_WEBDEV_BRIDGE_IMAGE: 'false',
    };
    const config = fromEnv(env);
    assert.equal(config.model, 'test/model');
    assert.equal(config.reasoning.effort, 'high');
    assert.equal(config.stack.frontendFramework, 'react');
    assert.equal(config.agent.fidelity, 80);
    assert.equal(config.agent.kind, 'landing');
    assert.equal(config.stages.vector.enabled, false);
    assert.equal(config.bridges.image.enabled, false);
    assert.equal(envConfigPath({ AI_WEBDEV_CONFIG: 'x.json' }), 'x.json');
});

test('the environment ignores the values that are out of the range', () => {
    const config = fromEnv({ AI_WEBDEV_FIDELITY: '500', AI_WEBDEV_EFFORT: 'turbo' });
    assert.equal(config.agent, undefined);
    assert.equal(config.reasoning, undefined);
});

test('a config file with an unknown section is rejected in Russian', async () => {
    const home = await tempHome();
    const file = path.join(home, 'config.json');
    await writeFile(file, JSON.stringify({ webdev: {} }), 'utf8');
    await assert.rejects(() => readConfigFile(file), /Конфигурация .*: неизвестный раздел "webdev"\./);
});

test('a config file with a broken JSON is rejected in Russian', async () => {
    const home = await tempHome();
    const file = path.join(home, 'config.json');
    await writeFile(file, '{ nope', 'utf8');
    await assert.rejects(() => readConfigFile(file), /некорректный JSON/);
});

test('the placeholders of the config are expanded', async () => {
    const home = await tempHome();
    const file = path.join(home, 'note.txt');
    await writeFile(file, 'the note', 'utf8');
    const expanded = await expandPlaceholders(
        { model: '{{env:AI_TEST_MODEL}}', instructions: '{{file:' + file + '}}' },
        { env: { AI_TEST_MODEL: 'from/env' }, root: home },
    );
    assert.equal(expanded.model, 'from/env');
    assert.equal(expanded.instructions, 'the note');
});

test('the loader merges the home, the file, the environment and the overrides', async () => {
    const home = await tempHome();
    await writeFile(homeConfigFile(home), JSON.stringify({ stack: { frontendFramework: 'vue' } }), 'utf8');

    const file = path.join(home, 'other.json');
    await writeFile(file, JSON.stringify({ stack: { iconSet: 'lucide' } }), 'utf8');

    const config = await loadConfig({
        env: { ...HOME_ENV, AI_WEBDEV_HOME: home, AI_WEBDEV_CREATIVITY: '55' },
        cwd: home,
        configPath: file,
        overrides: { agent: { fidelity: 90 } },
    });

    assert.equal(config.stack.frontendFramework, 'vue');
    assert.equal(config.stack.iconSet, 'lucide');
    assert.equal(config.agent.creativity, 55);
    assert.equal(config.agent.fidelity, 90);
    assert.equal(config.home, home);
    assert.ok(config.components.dir.startsWith(home));
    assert.ok(config.components.dbFile.startsWith(home));
});

test('the loader promotes the first backend that has a key', async () => {
    const home = await tempHome();
    const config = await loadConfig({
        env: {
            AI_WEBDEV_HOME: home,
            AI_WEBDEV_BACKENDS: JSON.stringify([
                { baseURL: 'https://first.test/v1', env: 'FIRST_KEY' },
                { baseURL: 'https://second.test/v1', env: 'SECOND_KEY' },
            ]),
            FIRST_KEY: 'first-key',
            SECOND_KEY: 'second-key',
        },
        cwd: home,
    });
    assert.equal(config.baseURL, 'https://first.test/v1');
    assert.equal(config.apiKey, 'first-key');
});

test('the loader reports a broken config in Russian', async () => {
    const home = await tempHome();
    const file = path.join(home, 'broken.json');
    await writeFile(file, JSON.stringify({ agent: { approve: 'maybe' } }), 'utf8');
    await assert.rejects(
        () => loadConfig({ env: { AI_WEBDEV_HOME: home }, cwd: home, configPath: file }),
        /Конфигурация: agent\.approve/,
    );
});

test('the home config is seeded once', async () => {
    const home = await tempHome();
    const first = await ensureConfigFile({ AI_WEBDEV_HOME: home });
    assert.equal(first.created, true);
    const second = await ensureConfigFile({ AI_WEBDEV_HOME: home });
    assert.equal(second.created, false);
    const text = await readConfigFile(homeConfigFile(home));
    assert.equal(text.model, defaults.model);
    assert.ok(text.stages.learn);
});

test('the starter config is a valid JSON of the known sections', () => {
    const starter = JSON.parse(defaultConfigText());
    for (const key of Object.keys(starter)) assert.ok(key in defaults, `the unknown section ${key}`);
    assert.ok(starter.bridges.decompose);
});

test('the home of the CLI is the one of the environment', () => {
    const home = defaultHome({ AI_WEBDEV_HOME: 'C:/tmp/ai-webdev' });
    assert.equal(home, path.resolve('C:/tmp/ai-webdev'));
    assert.match(defaultHome({}), /ai-webdev$/);
});

test('the secret of the config is shortened before it is printed', () => {
    const config = cloneDefaults();
    config.apiKey = 'super-secret-key';
    const short = redactConfig(config);
    assert.notEqual(short.apiKey, 'super-secret-key');
    assert.match(short.apiKey, /…/);
});

test('the config file is written as pretty JSON', async () => {
    const home = await tempHome();
    const file = path.join(home, 'nested', 'config.json');
    await writeConfigFile(file, { model: 'x' });
    const text = await readConfigFile(file);
    assert.deepEqual(text, { model: 'x' });
    await mkdir(path.join(home, 'nested'), { recursive: true });
});
