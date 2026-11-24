/**
 * @file test/cli.test.js
 * @module test/cli
 * @purpose The tests of the CLI: the parsing of argv, the exit codes and the local
 *          commands that need no network.
 * @depends node:test, node:path, node:os, node:child_process, cli
 * @ai.tags test, cli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { EXIT, VALUE_FLAGS, parseArgv } from '../src/cli.js';
import { configOverrides, parseRoleSpecs, expandRoute, routeStages, requestedStages, splitKind, stopAfterStage, resumeCommand } from '../src/cli/run.js';
import { createRenderer, detectMode } from '../src/cli/renderer.js';
import { createInputChannel, readPipedInput } from '../src/cli/input.js';
import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';

function ttyOutput() {
    const chunks = [];
    const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done(); } });
    stream.isTTY = true;
    stream.columns = 100;
    stream.readText = () => chunks.join('');
    return stream;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'ai-webdev.js');

/**
 * Run the CLI in a child process with a home of its own.
 * @param {string[]} args
 * @param {{ home?: string, cwd?: string, env?: object }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function cli(args, { home, cwd, env = {} } = {}) {
    const targetHome = home ?? await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-cli-'));
    const work = cwd ?? targetHome;
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            [BIN, ...args],
            { cwd: work, env: { ...process.env, AI_WEBDEV_HOME: targetHome, ...env } },
            (error, stdout, stderr) => {
                resolve({ code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
            },
        );
    });
}

test('a leading kind token is the kind of the run, the flag wins over it', () => {
    assert.deepEqual(splitKind(['landing', 'собери страницу'], {}), { kind: 'landing', task: 'собери страницу' });
    assert.deepEqual(splitKind(['landing', 'задача'], { kind: 'site' }), { kind: 'site', task: 'задача' });
    assert.deepEqual(splitKind(['собери страницу'], {}), { kind: null, task: 'собери страницу' });
    assert.deepEqual(splitKind([], { kind: 'app' }), { kind: 'app', task: '' });
});

test('the argv is split into the command, the arguments and the flags', () => {
    const parsed = parseArgv(['run', 'make', 'a', 'landing', '--json']);
    assert.equal(parsed.command, 'run');
    assert.deepEqual(parsed.args, ['make', 'a', 'landing']);
    assert.equal(parsed.flags.json, true);
});

test('a flag that takes a value takes the next argument', () => {
    const parsed = parseArgv(['run', '--route', 'plan', 'task']);
    assert.equal(parsed.flags.route, 'plan');
    assert.deepEqual(parsed.args, ['task']);
});

test('a flag with an equals sign keeps its value', () => {
    const parsed = parseArgv(['run', '--route=plan,architect']);
    assert.equal(parsed.flags.route, 'plan,architect');
});

test('a flag that is given twice becomes a list', () => {
    const parsed = parseArgv(['run', '--role', 'coder=a:b', '--role', 'planner=c']);
    assert.deepEqual(parsed.flags.role, ['coder=a:b', 'planner=c']);
});

test('everything after the two dashes is the rest of the command', () => {
    const parsed = parseArgv(['jobs', 'run', '--', 'npm', 'run', 'build', '--watch']);
    assert.equal(parsed.command, 'jobs');
    assert.deepEqual(parsed.args, ['run']);
    assert.deepEqual(parsed.rest, ['npm', 'run', 'build', '--watch']);
});

test('a short flag is a flag without a value', () => {
    const parsed = parseArgv(['-v']);
    assert.equal(parsed.flags.v, true);
});

test('a flag without a value stays true when it needs one', () => {
    const parsed = parseArgv(['run', '--route']);
    assert.equal(parsed.flags.route, true);
    assert.ok(VALUE_FLAGS.has('route'));
});

test('the flags of the run become the overrides of the config', () => {
    const overrides = configOverrides({
        pace: '80',
        quality: '70',
        fidelity: '90',
        creativity: '10',
        kind: 'landing',
        approve: 'read',
        extract: 'off',
        'frontend-framework': 'react',
        'icon-set': 'lucide',
        platform: 'chromium',
        effort: 'high',
        summary: 'detailed',
        model: 'test/model',
        role: 'coder=other/model:high:max',
    });
    assert.equal(overrides.pace.speed, 80);
    assert.equal(overrides.pace.quality, 70);
    assert.equal(overrides.agent.fidelity, 90);
    assert.equal(overrides.agent.creativity, 10);
    assert.equal(overrides.agent.kind, 'landing');
    assert.equal(overrides.agent.approve, 'read');
    assert.equal(overrides.agent.extract, 'off');
    assert.equal(overrides.stack.frontendFramework, 'react');
    assert.equal(overrides.stack.iconSet, 'lucide');
    assert.equal(overrides.reasoning.effort, 'high');
    assert.equal(overrides.reasoning.summary, 'detailed');
    assert.equal(overrides.model, 'test/model');
    assert.deepEqual(overrides.roles.coder, { model: 'other/model', effort: 'high', maxEffort: 'max' });
});

test('the flags that are out of the range are a usage error', () => {
    assert.throws(() => configOverrides({ pace: 'abc' }), /--pace: целое 0\.\.100\./);
    assert.throws(() => configOverrides({ fidelity: '101' }), /--fidelity: целое 0\.\.100\./);
    assert.throws(() => configOverrides({ approve: 'maybe' }), /--approve: ask \| read \| write \| all\./);
    assert.throws(() => configOverrides({ extract: 'sometimes' }), /--extract: off \| auto \| always\./);
});

test('the essence of the task and the pictures of the task are flags of the run', () => {
    const overrides = configOverrides({ input: ['what-needs.md', 'notes.md'] });
    assert.deepEqual(overrides.inputs.extra, ['what-needs.md', 'notes.md']);
    assert.throws(() => configOverrides({ input: true }), /--input: нужно значение\./);
    assert.throws(() => configOverrides({ image: true }), /--image: нужно значение\./);
    assert.deepEqual(configOverrides({}), {});
});

test('the specs of the roles are parsed', () => {
    assert.deepEqual(parseRoleSpecs('coder=model:high:max'), [
        { name: 'coder', model: 'model', effort: 'high', maxEffort: 'max' },
    ]);
    // A family of models keeps its prefix: the colon of the family is not the separator.
    assert.deepEqual(parseRoleSpecs('coder=family:gpt:high'), [
        { name: 'coder', model: 'family:gpt', effort: 'high', maxEffort: '' },
    ]);
    assert.deepEqual(parseRoleSpecs('coder=family:gpt'), [
        { name: 'coder', model: 'family:gpt', effort: '', maxEffort: '' },
    ]);
    // A group of models keeps its prefix too.
    assert.deepEqual(parseRoleSpecs('iconifier=group:small'), [
        { name: 'iconifier', model: 'group:small', effort: '', maxEffort: '' },
    ]);
    assert.throws(() => parseRoleSpecs('coder'), /--role: ожидается роль=модель/);
});

test('the route of the flags adds the stages the route needs', () => {
    assert.deepEqual(expandRoute(['plan']), ['collect', 'plan']);
    assert.deepEqual(routeStages({ route: 'plan' }), ['collect', 'plan']);
    assert.equal(routeStages({}), null);
    assert.throws(() => expandRoute(['nowhere']), /--route: неизвестные стадии: nowhere\./);
});

test('the stages that were asked for are known apart from the ones they need', () => {
    assert.deepEqual(requestedStages({ route: 'review' }), ['review']);
    assert.deepEqual(requestedStages({ route: 'plan,review' }), ['plan', 'review']);
    assert.deepEqual(requestedStages({}), []);
    assert.deepEqual(requestedStages({ route: 'PLAN' }), ['plan']);
    assert.throws(() => requestedStages({ route: 'nowhere' }), /--route: неизвестные стадии: nowhere\./);
});

test('the stage of the pause is checked against the stages of the run', () => {
    const config = { stages: { plan: { enabled: true }, coding: { enabled: true }, audit: { enabled: false } } };

    assert.equal(stopAfterStage({}, null, config), null);
    assert.equal(stopAfterStage({ 'stop-after': 'plan' }, null, config), 'plan');
    // The name of the stage is not case sensitive.
    assert.equal(stopAfterStage({ 'stop-after': 'PLAN' }, null, config), 'plan');
    assert.equal(stopAfterStage({ 'stop-after': ' Plan ' }, null, config), 'plan');

    assert.throws(() => stopAfterStage({ 'stop-after': 'nowhere' }, null, config), /--stop-after: неизвестная стадия "nowhere"/);
    // A stage that is not in the route would never be reached.
    assert.throws(() => stopAfterStage({ 'stop-after': 'coding' }, ['plan'], config), /--stop-after: стадия "coding" не входит в этот прогон/);
    // A stage that is switched off would never be reached either.
    assert.throws(() => stopAfterStage({ 'stop-after': 'audit' }, null, config), /не входит в этот прогон/);
});

test('the version and the help are printed and the run ends with zero', async () => {
    const version = await cli(['--version']);
    assert.equal(version.code, EXIT.ok);
    assert.match(version.stdout, /\d+\.\d+\.\d+/);

    const help = await cli(['--help']);
    assert.equal(help.code, EXIT.ok);
    assert.match(help.stdout, /ai-webdev/);
    assert.match(help.stdout, /Usage:/);
});

test('a run without a task is a usage error', async () => {
    const result = await cli(['run']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /Укажите задачу/);
});

test('a resume without the id of the run is a usage error', async () => {
    const result = await cli(['run', '--resume']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /--resume: нужен идентификатор прогона\./);
});

test('the command of the continuation repeats what the run needs', () => {
    const command = resumeCommand({
        runId: '20261115-064700',
        flags: {
            config: '.webdev.config.json',
            input: ['what-needs.md'],
            image: ['landing.png'],
            kind: 'landing',
            model: 'moonshotai/kimi-k3.1-pro',
            effort: 'xhigh',
        },
    });
    assert.match(command, /ai-webdev run --resume 20261115-064700/);
    assert.match(command, /--config \.webdev\.config\.json/);
    assert.match(command, /--input what-needs\.md/);
    assert.match(command, /--image landing\.png/);
    assert.match(command, /--kind landing/);
    assert.match(command, /--model moonshotai\/kimi-k3\.1-pro/);
    assert.match(command, /--effort xhigh/);
    assert.equal(resumeCommand({ runId: '' }), '');
});

test('an unknown stage of the route is a usage error', async () => {
    const result = await cli(['run', 'task', '--route', 'nowhere']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /--route: неизвестные стадии: nowhere\./);
});

test('a flag out of the range is a usage error', async () => {
    const result = await cli(['run', 'task', '--pace', 'abc']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /--pace: целое 0\.\.100\./);
});

test('an unknown command is a task', async () => {
    const result = await cli(['make a landing', '--route', 'nowhere']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /--route: неизвестные стадии: nowhere\./);
});

test('the command of the skills lists the packs of the project and of the package', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-skills-cli-'));
    const pack = path.join(work, '.agents', 'skills', 'demo');
    await mkdir(pack, { recursive: true });
    await writeFile(path.join(pack, 'SKILL.md'), '---\nname: demo\ndescription: a demo pack\n---\n\nThe steps.');

    const listed = await cli(['skills', 'list'], { cwd: work });
    assert.equal(listed.code, EXIT.ok);
    assert.match(listed.stdout, /demo/);
    assert.match(listed.stdout, /modern-web-guidance/);

    const found = await cli(['skills', 'search', 'demo'], { cwd: work });
    assert.equal(found.code, EXIT.ok);
    assert.match(found.stdout, /demo/);

    const shown = await cli(['skills', 'show', 'demo'], { cwd: work });
    assert.equal(shown.code, EXIT.ok);
    assert.match(shown.stdout, /The steps/);

    const where = await cli(['skills', 'path', 'demo'], { cwd: work });
    assert.equal(where.code, EXIT.ok);
    assert.match(where.stdout, /demo/);
});

test('a skill pack of the project is removed and the pack of the package is not', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-skills-home-'));
    const work = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-skills-rm-'));
    const pack = path.join(work, '.agents', 'skills', 'demo');
    await mkdir(pack, { recursive: true });
    await writeFile(path.join(pack, 'SKILL.md'), '---\nname: demo\ndescription: a demo pack\n---\n\nThe steps.');

    const removed = await cli(['skills', 'rm', 'demo'], { home, cwd: work, env: { HOME: home } });
    assert.equal(removed.code, EXIT.ok);
    assert.equal(existsSync(path.join(pack, 'SKILL.md')), false);

    const builtin = await cli(['skills', 'rm', 'modern-web-guidance'], { home, cwd: work, env: { HOME: home } });
    assert.equal(builtin.code, EXIT.failure);
    assert.match(builtin.stdout, /встроен/);
});

test('the command of the stages lists the stages of the pipeline', async () => {
    const result = await cli(['stages']);
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /collect/);
    assert.match(result.stdout, /plan/);
    assert.match(result.stdout, /learn/);
});

test('the stages in json are one event per line', async () => {
    const result = await cli(['stages', '--json']);
    assert.equal(result.code, EXIT.ok);
    const event = JSON.parse(result.stdout.trim().split('\n')[0]);
    assert.equal(event.type, 'stages');
    assert.ok(event.stages.length >= 12);
});

test('the memory of the CLI keeps the records of the project', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-cli-'));
    const added = await cli(['memory', 'add', 'The project uses Vite', '--as', 'fact'], { home });
    assert.equal(added.code, EXIT.ok);
    assert.match(added.stdout, /Remembered #1/);

    const list = await cli(['memory', 'list'], { home });
    assert.equal(list.code, EXIT.ok);
    assert.match(list.stdout, /fact/);
    assert.match(list.stdout, /The project uses Vite/);

    const search = await cli(['memory', 'search', 'vite'], { home });
    assert.equal(search.code, EXIT.ok);
    assert.match(search.stdout, /The project uses Vite/);

    const missing = await cli(['memory', 'search', 'kubernetes'], { home });
    assert.equal(missing.code, EXIT.failure);

    const removed = await cli(['memory', 'rm', '1'], { home });
    assert.equal(removed.code, EXIT.ok);
    const empty = await cli(['memory', 'list'], { home });
    assert.match(empty.stdout, /The memory is empty\./);
});

test('the memory needs a text to remember', async () => {
    const result = await cli(['memory', 'add']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /Укажите текст/);
});

test('the list of the background jobs is empty in a fresh home', async () => {
    const result = await cli(['jobs', 'list']);
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /No background jobs\./);
});

test('the registry of the components is empty in a fresh home', async () => {
    const result = await cli(['component', 'list']);
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /Реестр пуст/);
});

test('the config command writes the home file once and shows it', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-cli-'));
    const init = await cli(['config', 'init'], { home });
    assert.equal(init.code, EXIT.ok);
    assert.match(init.stdout, /The configuration is written/);

    const again = await cli(['config', 'init'], { home });
    assert.match(again.stdout, /already there/);

    const where = await cli(['config', 'path'], { home });
    assert.match(where.stdout.trim(), /config\.json$/);

    const shown = await cli(['config', 'show'], { home });
    assert.equal(shown.code, EXIT.ok);
    const parsed = JSON.parse(shown.stdout.slice(shown.stdout.indexOf('{')));
    assert.ok(parsed.stages.learn);
});

test('the config command rejects an unknown subcommand', async () => {
    const result = await cli(['config', 'wat']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /config init \| show \| path/);
});

test('the renderer writes the events of the run', () => {
    const lines = [];
    const errors = [];
    const renderer = createRenderer({
        mode: 'plain',
        stdout: { write: (text) => lines.push(text) },
        stderr: { write: (text) => errors.push(text) },
    });
    renderer.plan({ summary: 'The plan', steps: [{ id: 's1', title: 'The first step', role: 'coder' }] });
    renderer.stages([{ name: 'plan', title: 'Plan the work' }]);
    renderer.files(['src/index.html']);
    renderer.warning('a warning');
    renderer.progress({ done: 1, total: 2 });
    const text = lines.join('');
    assert.match(text, /The plan/);
    assert.match(text, /The first step/);
    assert.match(text, /src\/index\.html/);
    assert.match(errors.join(''), /a warning/);
});

test('the renderer of json writes the events as json', () => {
    const lines = [];
    const renderer = createRenderer({ mode: 'json', stdout: { write: (text) => lines.push(text) } });
    renderer.stages([{ name: 'plan', title: 'Plan the work' }]);
    const event = JSON.parse(lines[0]);
    assert.equal(event.type, 'stages');
    assert.equal(event.stages[0].name, 'plan');
});

test('piped input reads the task/context with a byte limit and ignores TTY streams', async () => {
    const pipe = new PassThrough();
    const read = readPipedInput({ stdin: pipe, maxBytes: 32 });
    pipe.end('stdin task');
    assert.equal(await read, 'stdin task');

    const emptyOpenPipe = new PassThrough();
    assert.equal(await readPipedInput({ stdin: emptyOpenPipe }), '');
    emptyOpenPipe.destroy();

    const tty = new PassThrough();
    tty.isTTY = true;
    assert.equal(await readPipedInput({ stdin: tty }), '');
    const tooMuch = new PassThrough();
    const rejected = readPipedInput({ stdin: tooMuch, maxBytes: 2 });
    tooMuch.end('long');
    await assert.rejects(rejected, /stdin is larger than the limit/);
});

test('the interactive input channel separates steering, questions, and skip controls', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    const output = ttyOutput();
    const channel = createInputChannel({ stdin: input, output, interactive: true });
    input.write('make the header blue\n');
    assert.deepEqual(channel.takeSteering(), ['make the header blue']);

    channel.setLocation({ stage: 'styling', step: 'colors' });
    input.write('/skip\n');
    assert.ok(channel.takeCurrentSkip());
    input.write('/skip markup-1\n');
    assert.equal(channel.takePendingSkips({ namedOnly: true })[0].target, 'markup-1');
    input.write('/quit\n');
    assert.equal(channel.shouldQuit(), true);

    channel.close();
    assert.equal(createInputChannel({ stdin: new PassThrough(), interactive: false }), null);
});

test('the interactive status is updated from the active role and model settings', () => {
    const input = new PassThrough();
    input.isTTY = true;
    const output = ttyOutput();
    const channel = createInputChannel({ stdin: input, output, interactive: true });
    channel.setLocation({ stage: 'styling', role: 'styler', model: 'example/model', effort: 'medium', mode: 'style' });
    const text = output.readText();
    assert.match(text, /Styles/);
    assert.match(text, /styler/);
    assert.match(text, /example\/model/);
    assert.match(text, /reasoning medium/);
    assert.match(text, /style/);
    assert.ok(text.includes('\x1b[s'), 'status update saves the cursor while redrawing its own row');
    channel.close();
});

test('the renderer says what a tool call touches', () => {
    const lines = [];
    const errors = [];
    const renderer = createRenderer({
        mode: 'plain',
        stdout: { write: (text) => lines.push(text) },
        stderr: { write: (text) => errors.push(text) },
    });
    renderer.event({ type: 'role.tool', name: 'read_file', arguments: { path: 'src/main.js' } });
    renderer.event({ type: 'role.tool', name: 'write_file', arguments: { path: 'index.html', content: 'x'.repeat(300) } });
    renderer.event({ type: 'role.tool', name: 'run_command', arguments: { command: 'npm', args: ['run', 'build'] } });
    renderer.event({ type: 'role.tool.result', name: 'write_file', output: 'Записан index.html (9346 байт)' });
    const text = errors.join('');
    assert.match(text, /read_file src\/main\.js/);
    assert.match(text, /write_file index\.html/);
    assert.match(text, /run_command npm run build/);
    assert.match(text, /→ Записан index\.html/);
    // The content of the file is not a line of the log.
    assert.doesNotMatch(text, /x{100}/);
});

test('the renderer distinguishes a verified sub-agent output from an empty hand-over', () => {
    const lines = [];
    const renderer = createRenderer({
        mode: 'plain',
        stdout: { write: (text) => lines.push(text) },
        stderr: { write() {} },
    });
    renderer.event({ type: 'subagent.done', to: 'coder', turns: 8, ok: false, files: [] });
    renderer.event({ type: 'subagent.done', to: 'editor', turns: 4, ok: true, files: ['assets/badge.svg'] });
    assert.match(lines.join(''), /суб-агент роли coder не подтверждён/);
    assert.match(lines.join(''), /суб-агент роли editor закончил/);
    assert.match(lines.join(''), /assets\/badge\.svg/);
});

test('the renderer says that the run waits for a thinking model', () => {
    const lines = [];
    const errors = [];
    const renderer = createRenderer({
        mode: 'plain',
        stdout: { write: (text) => lines.push(text) },
        stderr: { write: (text) => errors.push(text) },
    });
    renderer.event({ type: 'request.wait', elapsedMs: 60_000 });
    renderer.event({ type: 'request.retry', attempt: 2, error: 'No data from the server' });
    const text = errors.join('');
    assert.match(text, /thinking \(60s\)/);
    assert.match(text, /retry 2/);
});

test('the renderer of json writes the wait as json', () => {
    const lines = [];
    const renderer = createRenderer({ mode: 'json', stdout: { write: (text) => lines.push(text) } });
    renderer.event({ type: 'request.wait', elapsedMs: 20_000 });
    const event = JSON.parse(lines[0]);
    assert.equal(event.type, 'wait');
    assert.equal(event.seconds, 20);
});

test('the thought of the model is one block, not a line per token', () => {
    const errors = [];
    const renderer = createRenderer({
        mode: 'plain',
        stdout: { write() {} },
        stderr: { write: (text) => errors.push(text) },
    });
    renderer.event({ type: 'reasoning.delta', text: 'The header ' });
    renderer.event({ type: 'reasoning.delta', text: 'must be blue.' });
    // Nothing is written while the pieces arrive: the log of the run has no wall of lines.
    assert.equal(errors.length, 0);
    renderer.event({ type: 'role.tool', name: 'read_file', arguments: { path: 'index.html' } });
    const text = errors.join('');
    assert.match(text, /thinking: The header must be blue\./);
    // The block is one line, not one line per token.
    assert.equal(text.split('\n').filter((line) => line.includes('thinking:')).length, 1);
});

test('the renderer of json carries every piece of the stream', () => {
    const lines = [];
    const renderer = createRenderer({ mode: 'json', stdout: { write: (text) => lines.push(text) } });
    renderer.event({ type: 'reasoning.delta', text: 'one' });
    renderer.event({ type: 'text.delta', text: 'two' });
    const events = lines.map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.type), ['reasoning.delta', 'text.delta']);
    assert.deepEqual(events.map((event) => event.text), ['one', 'two']);
});

test('the mode of the renderer follows the flags', () => {
    assert.equal(detectMode({ json: true, quiet: false }), 'json');
    assert.equal(detectMode({ json: false, quiet: true }), 'quiet');
    assert.equal(detectMode({ json: false, quiet: false }), 'plain');
});
