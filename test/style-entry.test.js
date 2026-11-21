/**
 * @file test/style-entry.test.js
 * @module test/style-entry
 * @purpose The tests of the style contract: one stylesheet, one name, one language.
 * @depends node:test, stages/style-entry
 * @ai.tags test, stages, styles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { styleFiles, styleEntry, styleLanguage, styleEntryOf, stylesOf } from '../src/stages/style-entry.js';

test('the styles of the project are the files of the step of the styler', () => {
    const plan = {
        steps: [
            { id: 'markup', role: 'markup', files: ['index.html'] },
            { id: 'styles', role: 'styler', files: ['src/styles.scss', 'src/_tokens.scss'] },
        ],
    };
    assert.deepEqual(styleFiles(plan), ['src/styles.scss', 'src/_tokens.scss']);
    // The partial is not the entry point: the page is painted by the file that is called.
    assert.equal(styleEntry(styleFiles(plan)), 'src/styles.scss');
});

test('the language of the styles follows the file', () => {
    assert.equal(styleLanguage('src/styles.scss'), 'scss');
    assert.equal(styleLanguage('src/styles.sass'), 'scss');
    assert.equal(styleLanguage('src/styles.css'), 'css');
    assert.equal(styleLanguage('src/styles.less'), 'less');
    // A file that is not named takes the language of the house.
    assert.equal(styleLanguage(null, 'scss'), 'scss');
    assert.equal(styleLanguage(null, 'nonsense'), 'scss');
});

test('the plan names the stylesheet of the project', () => {
    const contract = styleEntryOf({
        plan: { steps: [{ id: 'styles', role: 'styler', files: ['src/styles.scss'] }] },
        architecture: { modules: [{ name: 'styles', path: 'src/styles.scss' }] },
    });
    assert.equal(contract.source, 'src/styles.scss');
    assert.equal(contract.link, 'src/styles.css');
    assert.equal(contract.language, 'scss');
    assert.equal(contract.from, 'plan');
});

test('without a plan the architecture names the stylesheet', () => {
    const contract = styleEntryOf({
        plan: { steps: [] },
        architecture: { modules: [{ name: 'styles', path: 'src/styles/main.scss' }] },
    });
    assert.equal(contract.source, 'src/styles/main.scss');
    assert.equal(contract.from, 'architecture');
});

test('a project without a stylesheet keeps the name of the house', () => {
    const contract = styleEntryOf({ plan: null, architecture: null, config: { stack: { styleLanguage: 'scss' } } });
    assert.equal(contract.source, 'src/styles.scss');
    assert.equal(contract.link, 'src/styles.css');
    assert.equal(contract.from, 'house');
});

test('a plain css project loads the file it has', () => {
    const contract = styleEntryOf({
        plan: { steps: [{ id: 'styles', role: 'styler', files: ['src/styles.css'] }] },
        architecture: null,
    });
    // There is nothing to compile: the page loads the file itself.
    assert.equal(contract.source, 'src/styles.css');
    assert.equal(contract.link, 'src/styles.css');
    assert.equal(contract.language, 'css');
});

test('the contract of the architecture is kept, and a missing one is counted again', async () => {
    const plan = { steps: [{ id: 'styles', role: 'styler', files: ['src/styles.scss'] }] };
    const stored = { source: 'src/styles.scss', link: 'src/styles.css', language: 'scss', from: 'plan' };
    assert.equal((await stylesOf({ plan, architecture: { styles: stored } })).source, 'src/styles.scss');
    // A run that started before the contract existed: the styles are counted from the plan.
    assert.equal((await stylesOf({ plan, architecture: { modules: [] } })).source, 'src/styles.scss');
});

test('the contract of the styles knows how the styles reach the page', async () => {
    const plan = { steps: [{ id: 'styles', role: 'styler', files: ['src/styles.scss'] }] };
    // A project without a manifest: the page loads the compiled css.
    const linked = await stylesOf({ plan, architecture: null, config: null, root: null });
    assert.equal(linked.wiring, 'linked');
    assert.equal(linked.source, 'src/styles.scss');
    assert.equal(linked.link, 'src/styles.css');
    // The script of the project comes from the plan, and the import is relative to it.
    const withScript = await stylesOf({
        plan: {
            steps: [
                { id: 'styles', role: 'styler', files: ['styles/main.scss'] },
                { id: 'behavior', role: 'coder', files: ['scripts/main.js'] },
            ],
        },
        architecture: null,
        config: null,
        root: null,
    });
    assert.equal(withScript.script, 'scripts/main.js');
    assert.equal(withScript.import, '../styles/main.scss');
});

test('a project with a bundler is bundled, and a project without a manifest is not', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-wiring-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '^7' } }), 'utf8');
    const plan = { steps: [{ id: 'styles', role: 'styler', files: ['src/styles.scss'] }] };
    const bundled = await stylesOf({ plan, architecture: null, config: null, root });
    assert.equal(bundled.wiring, 'bundled');

    // The manifest is there, and the bundler is not: the page loads the compiled css.
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'plain' }), 'utf8');
    const plain = await stylesOf({ plan, architecture: null, config: null, root });
    assert.equal(plain.wiring, 'linked');
});
