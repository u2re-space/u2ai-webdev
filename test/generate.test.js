/**
 * @file test/generate.test.js
 * @module test/generate
 * @purpose The tests of the generator: the brief, the scaffold, the platform profile, the
 *          fidelity targets and the staging of the references.
 * @depends node:test, node:path, node:fs/promises, generate/brief, generate/scaffold,
 *          generate/platform, generate/fidelity, generate/references
 * @ai.tags test, generate
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';

import { buildGenerationBrief, writeGenerationManifest, readGenerationManifest, GENERATION_KINDS } from '../src/generate/brief.js';
import {
    filesForKind, filesForStack, npmPackageName, buildPackageManifest, stackText,
    recommendStack, planScaffoldMerge, preparedScaffoldFiles, writePreparedScaffold,
} from '../src/generate/scaffold.js';
import { resolvePlatform, platformInstructions, CHROMIUM_156 } from '../src/generate/platform.js';
import { effectiveFidelity, fidelityContract, clampPercent } from '../src/generate/fidelity.js';
import { stageReferences, stageOneReference, imageSize, resolveRefPath } from '../src/generate/references.js';

const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x02, 0x00, 0, 0, 0x03, 0x00, 0, 0, 0, 0x01, 0, 0, 0, 0,
]);

test('the brief carries the kind, the outputs and the targets', () => {
    const { task, instructions, manifest } = buildGenerationBrief({
        kind: 'landing',
        prompt: 'A page for a coffee shop.',
        name: 'Coffee Shop',
        fidelity: 90,
        creativity: 10,
        quality: 100,
        framework: 'vanilla',
    });

    assert.match(task, /Task: landing/);
    assert.match(task, /A page for a coffee shop/);
    assert.match(task, /Fidelity target: 90%/);
    assert.match(instructions, /Platform profile chromium/);
    assert.ok(instructions.includes('Do not use:'));

    assert.equal(manifest.kind, 'landing');
    assert.equal(manifest.fidelity, 90);
    assert.equal(manifest.creativity, 10);
    assert.equal(manifest.effectiveFidelity, 90);
    assert.equal(manifest.measured, null);
    assert.equal(manifest.method, 'unmeasured');
    assert.equal(manifest.platform, 'chromium');
    assert.ok(manifest.outputs.includes('index.html'));
});

test('the brief rejects an unknown kind', () => {
    assert.throws(() => buildGenerationBrief({ kind: 'blog' }), /landing\|site/);
});

test('the manifest is written and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-manifest-'));
    const { manifest } = buildGenerationBrief({ kind: 'site', prompt: 'x' });
    const file = await writeGenerationManifest(root, manifest);
    assert.match(file, /generation\.json$/);
    const read = await readGenerationManifest(root);
    assert.equal(read.kind, 'site');
    assert.equal(await readGenerationManifest(path.join(root, 'nothing')), null);
});

test('the files of a kind follow the stack', () => {
    assert.ok(filesForKind('landing').includes('index.html'));
    assert.ok(filesForKind('backend').includes('server.js'));

    const react = filesForStack({ kind: 'landing', framework: 'react', scriptLanguage: 'typescript', styleLanguage: 'scss' });
    assert.ok(react.includes('src/main.tsx'));
    assert.ok(react.includes('src/App.tsx'));
    assert.ok(react.includes('src/styles.scss'));

    const css = filesForStack({ kind: 'landing', framework: 'vanilla', styleLanguage: 'css' });
    assert.ok(css.includes('src/styles.css'));
});

test('the package name is legal', () => {
    assert.equal(npmPackageName('My App'), 'app');
    assert.equal(npmPackageName('my-app'), 'my-app');
});

test('the package manifest holds the dependencies of the stack', () => {
    const manifest = buildPackageManifest({
        kind: 'landing',
        name: 'site',
        framework: 'react',
        styleLanguage: 'scss',
        scriptLanguage: 'typescript',
    });
    assert.equal(manifest.name, 'site');
    assert.ok(manifest.dependencies.react);
    assert.ok(manifest.devDependencies.vite);
    assert.ok(manifest.devDependencies.sass);
    assert.ok(manifest.devDependencies.typescript);
    assert.equal(manifest.scripts.build, 'vite build');
});

test('the stack text names the framework and the platform', () => {
    const text = stackText('landing', CHROMIUM_156, [], { framework: 'react', scriptLanguage: 'typescript' });
    assert.match(text, /React/);
    assert.match(text, /TypeScript/);
    assert.match(text, /2026/);
});

test('the recommendations follow the words of the task', () => {
    const result = recommendStack({ kind: 'landing', prompt: 'A page with Tailwind and Phosphor icons.' });
    const names = result.libraries.filter((item) => item.include).map((item) => item.name);
    assert.ok(names.includes('tailwindcss'));
    assert.ok(names.includes('@phosphor-icons/core'));

    const backend = recommendStack({ kind: 'backend', prompt: 'A server with a router.' });
    assert.ok(backend.libraries.some((item) => item.name === 'fastify' && item.include));
});

test('the merge of the manifest keeps the existing keys', () => {
    const plan = planScaffoldMerge({
        existing: { name: 'old', scripts: { dev: 'vite' } },
        incoming: { name: 'new', scripts: { dev: 'vite --host', build: 'vite build' } },
    });
    assert.equal(plan.merged.name, 'old');
    assert.equal(plan.merged.scripts.dev, 'vite');
    assert.equal(plan.merged.scripts.build, 'vite build');
    assert.ok(plan.kept.includes('scripts'));
    assert.ok(plan.kept.includes('name'));
});

test('the scaffold writes only the files that are missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-scaffold-'));
    await writeFile(path.join(root, 'package.json'), '{"name":"mine"}\n');
    const files = preparedScaffoldFiles({
        kind: 'landing',
        platform: CHROMIUM_156,
        recommendations: { libraries: [] },
        name: 'app',
    });
    const result = await writePreparedScaffold(root, files);
    assert.ok(result.skipped.includes('package.json'));
    assert.ok(result.written.includes('vite.config.js'));
    assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), '{"name":"mine"}\n');
});

test('the platform profile is frozen and known', () => {
    assert.equal(resolvePlatform('chromium').id, 'chromium');
    assert.equal(resolvePlatform().id, 'chromium');
    assert.throws(() => resolvePlatform('firefox'), /Неизвестный профиль/);
    assert.match(platformInstructions(CHROMIUM_156), /Chromium 156/);
});

test('the fidelity scales with the quality and refuses a wrong percent', () => {
    assert.equal(effectiveFidelity(100, 100), 100);
    assert.equal(effectiveFidelity(100, 0), 60);
    assert.throws(() => clampPercent(101, 'fidelity'), /0\.\.100/);
    const contract = fidelityContract({ fidelity: 80, creativity: 20 });
    assert.equal(contract.measured, null);
});

test('a reference of the project keeps its own path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs-'));
    await mkdir(path.join(root, 'img'), { recursive: true });
    await writeFile(path.join(root, 'img', 'logo.png'), PNG);
    const result = await stageReferences({ images: ['img/logo.png'], root });
    assert.equal(result.warnings.length, 0);
    assert.equal(result.refs[0].rel, 'img/logo.png');
    assert.equal(result.refs[0].width, 512);
    assert.equal(result.refs[0].height, 768);
});

test('a reference from outside is staged into .ai/refs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs2-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-out-'));
    const file = path.join(outside, 'pic.png');
    await writeFile(file, PNG);
    const staged = await stageOneReference(file, { root });
    assert.match(staged.rel, /^\.ai\/refs\/[0-9a-f]{12}\.png$/);
    assert.equal(staged.bytes, PNG.length);
    assert.equal(resolveRefPath(file, root), null);
});

test('a broken reference is a warning, not a failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs3-'));
    const result = await stageReferences({ images: ['nothing.png'], root });
    assert.equal(result.refs.length, 0);
    assert.equal(result.warnings.length, 1);
});

test('the size of a picture is read from the header', () => {
    assert.deepEqual(imageSize(PNG, 'image/png'), { width: 512, height: 768 });
    assert.deepEqual(imageSize(Buffer.alloc(4), 'image/png'), { width: null, height: null });
});

test('the kinds of a generation are the known ones', () => {
    assert.deepEqual([...GENERATION_KINDS], ['landing', 'site', 'backend', 'app', 'component']);
});
