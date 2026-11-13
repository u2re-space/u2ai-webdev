/**
 * @file test/component.test.js
 * @module test/component
 * @purpose The tests of the components: the contract, the names of the element, the manifest of
 *          the custom elements, the registry and the installation into a project.
 * @depends node:test, node:path, node:fs/promises, generate/component, registry, cli/install,
 *          cli/component
 * @ai.tags test, component, registry
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import {
    COMPONENT_CONTRACT_PATH,
    RESERVED_TAGS,
    componentTagName,
    componentClassName,
    componentPackageName,
    normalizeComponentContract,
    parseComponentContract,
    renderComponentContract,
    customElementsManifest,
    renderComponentReadme,
    draftComponentContract,
    contractBriefLines,
} from '../src/generate/component.js';
import { openRegistry } from '../src/registry.js';
import { saveDependency, fileSpecifier, splitSpec, installCommand } from '../src/cli/install.js';
import { componentCommand } from '../src/cli/component.js';

/**
 * A project with a component contract and a package manifest.
 * @returns {Promise<string>} the root of the project
 */
async function makeProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-comp-'));
    await mkdir(path.join(root, '.ai'), { recursive: true });
    await writeFile(path.join(root, COMPONENT_CONTRACT_PATH), `${JSON.stringify({
        tag: 'ui-calendar',
        name: '@acme/ui-calendar',
        version: '1.2.0',
        summary: 'A calendar of the month.',
        framework: 'vanilla',
        attrs: [{ name: 'value', type: 'string', default: '2026-01-01' }],
        props: [{ name: 'selected', type: 'string' }],
        events: [{ name: 'change', detail: 'string', bubbles: true }],
        slots: [{ name: 'footer' }],
        parts: [{ name: 'header' }],
        states: [{ name: 'busy' }],
        cssVars: [{ name: '--radius', default: '8px' }],
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
        name: '@acme/ui-calendar',
        type: 'module',
        dependencies: { vite: '*' },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(root, 'index.js'), 'export const x = 1;\n', 'utf8');
    return root;
}

test('the names of a component follow the rules of a custom element', () => {
    assert.equal(componentTagName('calendar'), 'ai-calendar');
    assert.equal(componentTagName('ui-calendar'), 'ui-calendar');
    assert.equal(componentTagName('@acme/ui-cal'), 'ui-cal');
    assert.equal(componentTagName('html'), 'ai-html');
    assert.ok(RESERVED_TAGS.includes('slot'));

    assert.equal(componentClassName('ui-calendar'), 'UiCalendar');
    assert.equal(componentPackageName({ name: '@acme/ui-calendar' }), '@acme/ui-calendar');
    assert.equal(componentPackageName({ tag: 'ui-calendar' }), '@ai/ui-calendar');
});

test('the contract is normalized into the full shape', () => {
    const contract = normalizeComponentContract({ tag: 'card', attrs: 'header' });
    assert.equal(contract.schemaVersion, '1');
    assert.equal(contract.tag, 'ai-card');
    assert.equal(contract.className, 'AiCard');
    assert.equal(contract.version, '0.1.0');
    assert.equal(contract.framework, 'vanilla');
    assert.deepEqual(contract.attrs, [{ name: 'header' }]);
    assert.deepEqual(contract.deps, []);
});

test('a broken contract names the file', () => {
    assert.throws(() => parseComponentContract('{', '.ai/component.json'), /component\.json.*некорректный JSON/);
    assert.throws(() => parseComponentContract('[]', '.ai/component.json'), /ожидался объект/);
    const parsed = parseComponentContract('{"tag":"ui-cal"}');
    assert.equal(parsed.tag, 'ui-cal');
});

test('the contract is written back in the same shape', () => {
    const text = renderComponentContract({ tag: 'ui-cal', version: '2.0.0' });
    assert.equal(JSON.parse(text).tag, 'ui-cal');
    assert.ok(text.endsWith('\n'));
});

test('the manifest of the custom elements carries the names of the contract', () => {
    const manifest = customElementsManifest({
        tag: 'ui-calendar',
        className: 'UiCalendar',
        attrs: [{ name: 'value', type: 'string', default: '2026-01-01' }],
        props: [{ name: 'selected', type: 'string' }],
        events: [{ name: 'change', detail: 'string' }],
        parts: [{ name: 'header' }],
        cssVars: [{ name: '--radius', default: '8px' }],
    });
    const declaration = manifest.modules[0].declarations[0];
    assert.equal(manifest.schemaVersion, '1.0.0');
    assert.equal(declaration.tagName, 'ui-calendar');
    assert.equal(declaration.customElement, true);
    assert.equal(declaration.attributes[0].name, 'value');
    assert.equal(declaration.members[0].name, 'selected');
    assert.equal(declaration.events[0].name, 'change');
    assert.equal(declaration.cssParts[0].name, 'header');
    assert.equal(declaration.cssProperties[0].name, '--radius');
    assert.equal(manifest.modules[0].exports[0].name, 'ui-calendar');
});

test('the README of a component lists the API', () => {
    const readme = renderComponentReadme({
        tag: 'ui-calendar',
        name: '@acme/ui-calendar',
        summary: 'A calendar.',
        attrs: [{ name: 'value', type: 'string' }],
        parts: [{ name: 'header' }],
        states: [{ name: 'busy' }],
    });
    assert.match(readme, /# `ui-calendar`/);
    assert.match(readme, /## Attributes/);
    assert.match(readme, /`value`/);
    assert.match(readme, /::part\(header\)/);
    assert.match(readme, /state\(busy\)/);
    assert.match(readme, /ai-webdev install ui-calendar/);
});

test('the draft of a contract keeps the version of the spec', () => {
    const draft = draftComponentContract({ name: 'ui-calendar@1.2.0', prompt: 'A calendar' });
    assert.equal(draft.tag, 'ui-calendar');
    assert.equal(draft.version, '1.2.0');
    assert.equal(draft.summary, 'A calendar');
    const lines = contractBriefLines(draft);
    assert.match(lines[0], /ui-calendar/);
});

test('the registry publishes, finds and removes a component', async () => {
    const source = await makeProject();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-reg-'));
    const registry = openRegistry({ file: ':memory:', dir });
    try {
        const published = await registry.publish({ sourceRoot: source, tags: 'calendar, date' });
        assert.equal(published.tag, 'ui-calendar');
        assert.equal(published.version, '1.2.0');
        assert.ok(published.files.includes('package.json'));
        assert.ok(published.files.includes(COMPONENT_CONTRACT_PATH));
        assert.equal(published.replaced, false);

        const found = registry.get('ui-calendar');
        assert.equal(found.name, '@acme/ui-calendar');
        assert.deepEqual(found.tags, ['calendar', 'date']);

        const again = await registry.publish({ sourceRoot: source });
        assert.equal(again.replaced, true);

        const hits = registry.search('calendar');
        assert.equal(hits.length, 1);

        const byTag = registry.search('ui-calendar');
        assert.equal(byTag.length, 1);

        const listed = registry.list();
        assert.equal(listed.length, 1);

        const versions = registry.versions('ui-calendar');
        assert.deepEqual(versions, ['1.2.0']);

        const removed = registry.remove('ui-calendar');
        assert.deepEqual(removed.removed, ['ui-calendar@1.2.0']);
        assert.equal(registry.get('ui-calendar'), null);
    } finally {
        registry.close();
    }
});

test('a project without a contract cannot be published', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-reg2-'));
    const registry = openRegistry({ file: ':memory:', dir });
    try {
        await assert.rejects(() => registry.publish({ sourceRoot: root }), /component\.json/);
    } finally {
        registry.close();
    }
});

test('the dependency of a local component is a file: specifier', () => {
    assert.equal(fileSpecifier('vendor/components', 'ui-calendar'), 'file:./vendor/components/ui-calendar');
    assert.equal(fileSpecifier('vendor\\components', 'ui-calendar'), 'file:./vendor/components/ui-calendar');

    const manifest = { dependencies: { vite: '*' }, devDependencies: { sass: '*' } };
    saveDependency({ manifest, name: '@acme/ui-calendar', specifier: 'file:./vendor/components/ui-calendar' });
    assert.equal(manifest.dependencies['@acme/ui-calendar'], 'file:./vendor/components/ui-calendar');
    assert.equal(manifest.dependencies.vite, '*');
    assert.equal(manifest.devDependencies.sass, '*');

    saveDependency({ manifest, name: '@acme/ui-calendar', specifier: 'file:./x', dev: true });
    assert.equal(manifest.dependencies['@acme/ui-calendar'], undefined);
    assert.equal(manifest.devDependencies['@acme/ui-calendar'], 'file:./x');
});

test('the spec of a component splits into a tag and a version', () => {
    assert.deepEqual(splitSpec('ui-calendar@1.2.0'), { tag: 'ui-calendar', version: '1.2.0' });
    assert.deepEqual(splitSpec('ui-calendar'), { tag: 'ui-calendar', version: null });
});

test('the install copies the component into the project and registers it', async () => {
    const source = await makeProject();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-reg3-'));
    const dbFile = path.join(dir, 'components.db');
    const registry = openRegistry({ file: dbFile, dir });
    await registry.publish({ sourceRoot: source });
    registry.close();

    const target = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-target-'));
    await writeFile(path.join(target, 'package.json'), `${JSON.stringify({ name: 'app', type: 'module' }, null, 2)}\n`, 'utf8');

    const lines = [];
    const code = await installCommand({
        config: { components: { dir, dbFile, vendorDir: 'vendor/components' } },
        cwd: target,
        args: ['ui-calendar'],
        flags: {},
        write: (text) => lines.push(text),
    });

    assert.equal(code, 0);
    const installed = await readFile(path.join(target, 'vendor', 'components', 'ui-calendar', 'package.json'), 'utf8');
    assert.match(installed, /ui-calendar/);
    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies['@acme/ui-calendar'], 'file:./vendor/components/ui-calendar');
    assert.ok(lines.join('').includes('ui-calendar@1.2.0'));
});

test('the install refuses a project without a manifest', async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-nomanifest-'));
    await assert.rejects(() => installCommand({
        config: { components: { dir: ':memory:', dbFile: ':memory:', vendorDir: 'vendor/components' } },
        cwd: target,
        args: ['ui-calendar'],
        flags: {},
        write: () => {},
    }), /package\.json/);
});

test('the command of the registry lists and shows the components', async () => {
    const source = await makeProject();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-reg4-'));
    const dbFile = path.join(dir, 'components.db');
    const registry = openRegistry({ file: dbFile, dir });
    await registry.publish({ sourceRoot: source });
    registry.close();

    const lines = [];
    const config = { components: { dir, dbFile, vendorDir: 'vendor/components' } };
    const code = await componentCommand({ config, cwd: source, args: ['list'], flags: {}, write: (text) => lines.push(text) });
    assert.equal(code, 0);
    assert.match(lines.join(''), /ui-calendar@1\.2\.0/);

    lines.length = 0;
    const showCode = await componentCommand({ config, cwd: source, args: ['show', 'ui-calendar'], flags: {}, write: (text) => lines.push(text) });
    assert.equal(showCode, 0);
    assert.match(lines.join(''), /ui-calendar/);
});
