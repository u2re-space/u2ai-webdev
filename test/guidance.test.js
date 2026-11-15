/**
 * @file test/guidance.test.js
 * @module test/guidance
 * @purpose The tests of the guides of the modern web platform: the index, the search, the read
 *          and the tool that gives them to the model.
 * @depends node:test, agent/guidance, agent/tools
 * @ai.tags test, guidance, skills
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
    GUIDANCE_SKILL, builtinSkillsDir, guidanceSkillDir, guidesDir, guideIndex,
    guidanceCategories, searchGuides, readGuide, guidanceSearchText, guidanceRetrieveText,
    guidanceCatalogText, savedOutputPath, runGuidanceCli,
} from '../src/agent/guidance.js';
import { createToolset } from '../src/agent/tools.js';

test('the pack of the guidance ships with the package', async () => {
    assert.equal(GUIDANCE_SKILL, 'modern-web-guidance');
    assert.match(builtinSkillsDir(), /skills$/);
    assert.equal(guidanceSkillDir(), `${builtinSkillsDir()}\\${GUIDANCE_SKILL}`.replace(/\//g, '\\'));
    assert.match(guidesDir(), /modern-web-guidance/);
});

test('the catalog holds the guides of the pack', async () => {
    const guides = await guideIndex();
    assert.ok(guides.length > 100, `the catalog holds ${guides.length} guides`);
    const categories = await guidanceCategories();
    assert.ok(categories.length > 5);
    assert.ok(categories.every((item) => item.count > 0));
    const dialog = guides.find((guide) => guide.id === 'dialog');
    assert.ok(dialog, 'the guide of the dialog is there');
    assert.ok(dialog.text.includes('<dialog>'));
});

test('the search finds the guides that fit the words of the query', async () => {
    const found = await searchGuides('light dismiss dialog', { limit: 5 });
    assert.ok(found.length);
    const ids = found.map((item) => item.id);
    assert.ok(ids.includes('light-dismiss-a-dialog') || ids.includes('dialog'), ids.join(', '));
    assert.ok(found[0].score > 0);

    const none = await searchGuides('', { limit: 5 });
    assert.deepEqual(none, []);
});

test('a guide is read by its id', async () => {
    const guide = await readGuide('light-dismiss-a-dialog');
    assert.ok(guide);
    assert.equal(guide.category, 'ui-behaviors');
    assert.match(guide.text, /closedby/);
    assert.equal(await readGuide('no-such-guide'), null);
    assert.equal(await readGuide(''), null);
});

test('the answer of the search names the ids of the guides', async () => {
    const answer = await guidanceSearchText('light dismiss dialog');
    assert.match(answer, /light-dismiss-a-dialog|dialog/);
    assert.match(answer, /ids/);

    const catalog = await guidanceCatalogText();
    assert.match(catalog, /ui-behaviors/);
    assert.match(catalog, /dialog/);
});

test('the answer of the retrieve holds the text of the guide', async () => {
    const answer = await guidanceRetrieveText(['light-dismiss-a-dialog']);
    assert.match(answer, /closedby/);
    assert.match(answer, /ui-behaviors/);
});

test('the tool gives the search and the retrieve to the model', async () => {
    const toolset = createToolset({ root: process.cwd(), config: { tools: {} } });
    const found = await toolset.execute('web_guidance', { query: 'light dismiss dialog', limit: 3 });
    assert.match(found, /light-dismiss-a-dialog|dialog/);
    const text = await toolset.execute('web_guidance', { ids: '["light-dismiss-a-dialog"]' });
    assert.match(text, /closedby/);
    const catalog = await toolset.execute('web_guidance', {});
    assert.match(catalog, /The guides of the pack/);
});

test('the words of the search may come as a list', async () => {
    const toolset = createToolset({ root: process.cwd(), config: { tools: {} } });
    const found = await toolset.execute('web_guidance', ['light dismiss dialog']);
    assert.match(found, /light-dismiss-a-dialog|dialog/);
    assert.doesNotMatch(found, /The guides of the pack/);
});

test('the CLI of the upstream is started without a line of quotes', async () => {
    let seen = null;
    const fake = (command, args) => {
        seen = { command, args };
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
            child.stdout.emit('data', 'ok');
            child.emit('close', 0);
        });
        return child;
    };

    const result = await runGuidanceCli(['search', 'dialog'], { spawn: fake });

    assert.equal(result.ok, true);
    // The arguments go one by one: a single line with quotes inside it is mangled by the
    // quoting of Node and by the rules of cmd.exe at the same time.
    assert.ok(!seen.args.some((item) => String(item).includes('"')), JSON.stringify(seen.args));
    if (process.platform === 'win32') {
        assert.equal(seen.command, 'cmd.exe');
        assert.deepEqual(seen.args.slice(0, 3), ['/d', '/c', 'npx']);
    }
});

test('the path of the file of the CLI is read out of its answer', () => {
    const answer = 'Output (12.1 KB, 220 lines) saved to C:\\Temp\\mwg-guide-1.md to prevent CLI stdout truncation.';
    assert.equal(savedOutputPath(answer), 'C:\\Temp\\mwg-guide-1.md');
    assert.equal(savedOutputPath('nothing here'), null);
});

test('the arguments of the CLI are checked before it starts', async () => {
    const refused = await runGuidanceCli(['retrieve', 'a & b'], { spawn: () => { throw new Error('must not start'); } });
    assert.equal(refused.ok, false);
    assert.match(refused.output, /not allowed/);
});

test('the CLI of the upstream answers and its notes are dropped', async () => {
    const fake = () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
            child.stdout.emit('data', '[{"id":"dialog","description":"a dialog"}]');
            child.stderr.emit('data', 'npm notice run npx\n');
            child.emit('close', 0);
        });
        return child;
    };
    const result = await runGuidanceCli(['search', 'dialog'], { spawn: fake });
    assert.equal(result.ok, true);
    assert.match(result.output, /"id":"dialog"/);
    assert.doesNotMatch(result.output, /npm notice/);
});
