/**
 * @file test/skills.test.js
 * @module test/skills
 * @purpose The tests of the skill packs, the documentation texts, the sources and the MCP client.
 * @depends node:test, node:http, agent/skills, agent/docs, agent/sources, agent/mcp
 * @ai.tags test, skills, mcp
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';

import {
    parseFrontmatter, loadSkillPacks, skillsForRole, discoverSkills, readSkill, readSkillFile,
    buildSkillInstructions, filterSkillsByKeywords, defaultSkillsDir,
} from '../src/agent/skills.js';
import { documentationFor, documentationForRole, DOCUMENTATION } from '../src/agent/docs.js';
import { DOCUMENTATION_SOURCES, effectiveSources, sourceNames, sourcesForRole, sourcesBlock } from '../src/agent/sources.js';
import { connectMcp, connectMcpServers, mcpToolSpecs, parseRpcBody } from '../src/agent/mcp.js';
import { defaults } from '../src/config.js';

test('the frontmatter of a skill file is read', () => {
    const parsed = parseFrontmatter([
        '---',
        'name: demo',
        'description: >',
        '  a long description',
        '  over two lines',
        'command: npm run build',
        '---',
        '',
        'The body of the skill.',
    ].join('\n'));
    assert.equal(parsed.name, 'demo');
    assert.equal(parsed.description, 'a long description over two lines');
    assert.equal(parsed.metadata.command, 'npm run build');
    assert.match(parsed.body, /The body of the skill/);
});

test('a file without frontmatter is all body', () => {
    const parsed = parseFrontmatter('Just text.');
    assert.equal(parsed.name, '');
    assert.equal(parsed.body, 'Just text.');
});

test('the role packs are read from the directory of the config', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-skills-'));
    const dir = path.join(home, 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'coder.md'), 'Write the code well.');
    await writeFile(path.join(dir, 'shared.md'), 'Speak plainly.');
    await writeFile(path.join(dir, 'styler.md'), 'Write the styles well.');

    const packs = await loadSkillPacks({ dir });
    assert.deepEqual(packs.map((pack) => pack.name), ['coder', 'shared', 'styler']);

    const text = await skillsForRole({ dir, role: 'coder' });
    assert.match(text, /Write the code well/);
    assert.match(text, /Speak plainly/);
    assert.doesNotMatch(text, /Write the styles well/);
});

test('the home of the packs is the home of the CLI', () => {
    const home = path.join(path.sep, 'tmp', 'home');
    const env = { AI_WEBDEV_HOME: home };
    assert.equal(defaultSkillsDir(env), path.join(home, 'skills'));
});

test('the skill packs of the project are discovered and read', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-project-'));
    // The home of the test is empty, so the packs of the machine do not leak into the test.
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const pack = path.join(root, '.agents', 'skills', 'demo');
    await mkdir(pack, { recursive: true });
    await writeFile(path.join(pack, 'SKILL.md'), '---\nname: demo\ndescription: a demo pack\n---\n\nThe steps.');

    const skills = await discoverSkills(root, { env });
    // The pack of the package is always there; the copy of the project comes first.
    assert.ok(skills.some((skill) => skill.name === 'modern-web-guidance'));
    const own = skills.filter((skill) => skill.name === 'demo');
    assert.equal(own.length, 1);
    assert.equal(skills[0].name, 'demo');
    assert.match(buildSkillInstructions(own), /demo/);

    const one = await readSkill('demo', root, { env });
    assert.equal(one.name, 'demo');
    assert.match(one.body, /The steps/);
    assert.equal(await readSkill('missing', root, { env }), null);

    assert.equal(filterSkillsByKeywords(skills, ['demo']).length, 1);
    assert.equal(filterSkillsByKeywords(skills, ['absent']).length, 0);
});

test('a file of a skill pack is read by its path inside the pack', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pack-file-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pack-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const pack = path.join(root, '.agents', 'skills', 'demo');
    await mkdir(path.join(pack, 'references'), { recursive: true });
    await writeFile(path.join(pack, 'SKILL.md'), '---\nname: demo\ndescription: a demo pack\n---\n\nThe steps.');
    await writeFile(path.join(pack, 'references', 'guide.md'), 'The table of the flags.');

    const part = await readSkillFile('demo', 'references/guide.md', root, { env });
    assert.match(part.body, /The table of the flags/);
    assert.equal(await readSkillFile('demo', 'missing.md', root, { env }), null);
    // The file of the pack stays inside the pack.
    assert.equal(await readSkillFile('demo', '../secrets.md', root, { env }), null);
    assert.equal(await readSkillFile('demo', '/etc/passwd', root, { env }), null);
});

test('the pack of the file search comes with the package', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-search-pack-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-search-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const skills = await discoverSkills(root, { env });
    const pack = skills.find((skill) => skill.name === 'file-search');
    assert.ok(pack, 'the pack of the file search is not there');
    assert.match(pack.description, /searching codebases/i);

    // The references of the pack are files of the pack: the role reads them by their path.
    const guide = await readSkillFile('file-search', 'references/ripgrep-patterns.md', root, { env });
    assert.ok(guide, 'the reference of the pack is not readable');
    assert.match(guide.body, /rg/);
});

test('the documentation of a role comes from the config', () => {
    const config = structuredClone(defaults);
    const text = documentationForRole(config, 'coder');
    assert.match(text, /CSS grid/);
    assert.match(text, /Accessibility/);
    assert.equal(documentationFor([]), '');
    assert.ok(DOCUMENTATION.a11y.includes('focus-visible'));
});

test('the sources of a role come from the map, the config over the built-in one', () => {
    const config = structuredClone(defaults);
    const iconifier = sourcesForRole(config, 'iconifier');
    assert.deepEqual(iconifier.map((item) => item.name), ['phosphorIcons', 'lucideIcons', 'googleFonts']);
    assert.equal(iconifier[0].url, 'https://phosphoricons.com/');

    // The address of the config replaces the address of the built-in map.
    config.documentation.sources.mdnCss = 'https://example.com/mdn';
    assert.equal(sourcesForRole(config, 'planner')[0].url, 'https://example.com/mdn');
    assert.equal(effectiveSources(config).mdnCss, 'https://example.com/mdn');

    // A source of the user joins the map and the names.
    config.documentation.sources.teamGuide = 'https://example.com/guide';
    config.documentation.roles.coder = ['teamGuide'];
    assert.equal(sourceNames(config).length, Object.keys(DOCUMENTATION_SOURCES).length + 1);
    assert.deepEqual(sourcesForRole(config, 'coder'), [{ name: 'teamGuide', url: 'https://example.com/guide' }]);

    // A role without a source gets no block.
    assert.equal(sourcesBlock(config, 'learner'), '');
    assert.match(sourcesBlock(config, 'coder'), /- teamGuide: https:\/\/example\.com\/guide/);
});

test('the JSON-RPC answer is read from a body', () => {
    assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result, { ok: true });
    assert.deepEqual(parseRpcBody('data: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\n').result, { ok: 1 });
    assert.equal(parseRpcBody(''), null);
});

test('an MCP server over HTTP is connected and called', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const message = JSON.parse(body || '{}');
            seen.push(message.method);
            let result = {};
            if (message.method === 'initialize') result = { protocolVersion: '2025-06-18' };
            if (message.method === 'tools/list') {
                result = {
                    tools: [{ name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: {} } }],
                };
            }
            if (message.method === 'tools/call') result = { content: [{ type: 'text', text: 'echoed' }] };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, result }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const port = server.address().port;
        const connections = await connectMcpServers([{ name: 'demo', url: `http://127.0.0.1:${port}/mcp` }]);
        assert.equal(connections.length, 1);
        assert.equal(connections[0].error, undefined);
        assert.equal(connections[0].tools.length, 1);
        const answer = await connections[0].call('echo', { text: 'hi' });
        assert.equal(answer.content[0].text, 'echoed');
        assert.ok(seen.includes('initialize'));
        assert.ok(seen.includes('tools/list'));
        assert.ok(seen.includes('tools/call'));

        const specs = mcpToolSpecs(connections[0].tools, 'mcp_demo');
        assert.equal(specs[0].name, 'mcp_demo_echo');
    } finally {
        server.close();
    }
});

test('an MCP server that is not there does not throw', async () => {
    const connection = await connectMcp({ name: 'demo', url: 'http://127.0.0.1:1/mcp' });
    assert.ok(connection.error);
    assert.deepEqual(connection.tools, []);
});
