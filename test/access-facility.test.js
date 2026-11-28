/**
 * @file test/access-facility.test.js
 * @module test/access-facility
 * @purpose Tests of the access of the run as a facility of Code Mode.
 *
 *   The access is the door between the model and the machine. The program of Code Mode
 *   reaches it by name, and every call travels back to the parent — so the tests here are
 *   about two things: the program really gets the files and the commands of the project,
 *   and it writes through the same gate as the role does.
 *
 * @depends node:test, node:assert, agent/tools, access/facility, access/fs
 * @ai.tags test, code-mode, access, facility
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';

import { createToolset } from '../src/agent/tools.js';
import {
    accessFacilities,
    accessFacilityCatalog,
    accessFacilityDescriptions,
    ACCESS_FACILITY_NAMES,
} from '../src/access/facility.js';
import { createAccess } from '../src/access/index.js';

/**
 * A project in a temporary directory, with one file in it.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
async function scratch() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'access-facility-'));
    await writeFile(path.join(root, 'note.txt'), 'hello\n', 'utf8');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await writeFile(path.join(root, 'sub', 'deep.txt'), 'deep\n', 'utf8');
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('the catalogue of the access names every call and says what it takes', () => {
    const catalog = accessFacilityCatalog();
    assert.equal(catalog.length, ACCESS_FACILITY_NAMES.length);
    for (const name of ACCESS_FACILITY_NAMES) {
        const entry = catalog.find((item) => item.name === name);
        assert.ok(entry, `the catalogue names ${name}`);
        assert.equal(entry.facility, true);
        assert.ok(entry.summary.length, `${name} says what it does`);
    }
    // The descriptions travel beside the names: the model reads the catalogue and decides
    // by the description.
    const described = accessFacilityDescriptions();
    assert.equal(described['access.readFile'].summary, 'Read a text file of the project and answer with its text.');
    assert.ok(described['access.writeFile'].arguments.path);
});

test('the program of Code Mode reads the files of the project through the access', async () => {
    const { root, cleanup } = await scratch();
    try {
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const list = await library.call('access.listFiles', [{ path: '.' }]);
                const read = await library.call('access.readFile', [{ path: 'note.txt' }]);
                const deep = await library.call('access.readFile', [{ path: 'sub/deep.txt' }]);
                return { list, read, deep };
            `,
            purpose: 'the access reads the project',
        });
        assert.match(answer, /The program ran/);
        assert.match(answer, /note\.txt/);
        assert.match(answer, /sub\/deep\.txt/);
        assert.match(answer, /hello/);
        assert.match(answer, /deep/);
    } finally {
        await cleanup();
    }
});

test('the program of Code Mode writes through the gate of the role', async () => {
    const { root, cleanup } = await scratch();
    try {
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const write = await library.call('access.writeFile', [{ path: 'out.txt', content: 'from the program\\n' }]);
                return { write };
            `,
            purpose: 'the access writes the project',
        });
        assert.match(answer, /The program ran/);
        // The file is on the disk: the program wrote it, and it went through the gate.
        assert.equal(await readFile(path.join(root, 'out.txt'), 'utf8'), 'from the program\n');
    } finally {
        await cleanup();
    }
});

test('the program of Code Mode may not write where the role may not', async () => {
    const { root, cleanup } = await scratch();
    try {
        // The stage opened one directory for writing: the root is not writable.
        const tools = createToolset({ root, config: { tools: {} } });
        tools.setWriteDirs([path.join(root, 'sub')]);
        const answer = await tools.execute('code_mode', {
            code: `
                const write = await library.call('access.writeFile', [{ path: 'forbidden.txt', content: 'no' }]);
                return { write };
            `,
            purpose: 'the access refuses the write',
        });
        // The program failed, and the refusal names the reason.
        assert.match(answer, /did not run/);
        assert.match(answer, /forbidden\.txt/);
        // Nothing landed on the disk.
        await assert.rejects(() => readFile(path.join(root, 'forbidden.txt'), 'utf8'));
    } finally {
        await cleanup();
    }
});

test('the program of Code Mode carries the bytes of a file as base64', async () => {
    const { root, cleanup } = await scratch();
    try {
        // A file that is not text: the bytes of it must survive the trip.
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
        await writeFile(path.join(root, 'pic.png'), bytes);
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const read = await library.call('access.readBytes', [{ path: 'pic.png' }]);
                const back = library.bytes(read.bytes);
                return { size: read.size, first: back[0], fourth: back[3], last: back[6] };
            `,
            purpose: 'the access carries the bytes',
        });
        assert.match(answer, /The program ran/);
        assert.match(answer, /"size": 7/);
        assert.match(answer, /"first": 137/);
        assert.match(answer, /"fourth": 71/);
        assert.match(answer, /"last": 16/);
    } finally {
        await cleanup();
    }
});

test('the program of Code Mode writes the bytes of a file whole', async () => {
    const { root, cleanup } = await scratch();
    try {
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const payload = library.base64(Uint8Array.from([1, 2, 3, 250]));
                const write = await library.call('access.writeBytes', [{ path: 'raw.bin', bytes: payload }]);
                return { write };
            `,
            purpose: 'the access writes the bytes',
        });
        assert.match(answer, /The program ran/);
        const written = await readFile(path.join(root, 'raw.bin'));
        assert.deepEqual([...written], [1, 2, 3, 250]);
    } finally {
        await cleanup();
    }
});

test('the program of Code Mode runs a command of the project', async () => {
    const { root, cleanup } = await scratch();
    try {
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const out = await library.call('access.run', [{ command: 'node', args: ['-e', 'console.log(41 + 1)'] }]);
                return { out };
            `,
            purpose: 'the access runs a command',
        });
        assert.match(answer, /The program ran/);
        assert.match(answer, /42/);
    } finally {
        await cleanup();
    }
});

test('the access of the run refuses a path that leaves the project', async () => {
    const { root, cleanup } = await scratch();
    try {
        const access = accessFacilities({ root });
        // The rules of the paths are the rules of the access: a path may not leave the
        // root, and a secret is never touched.
        await assert.rejects(
            () => access['access.readFile']({ path: '../../etc/passwd' }),
            /outside|not accessible|PATH/i,
        );
        await assert.rejects(
            () => access['access.readFile']({ path: '.env' }),
            /secret|not accessible/i,
        );
    } finally {
        await cleanup();
    }
});

test('the access of the run is in the catalogue of the program, with what it takes', async () => {
    const { root, cleanup } = await scratch();
    try {
        const tools = createToolset({ root, config: { tools: {} } });
        const answer = await tools.execute('code_mode', {
            code: `
                const catalog = await library.catalog();
                const entry = catalog.find((item) => item.name === 'access.readFile');
                return { entry };
            `,
            purpose: 'the catalogue of the access',
        });
        assert.match(answer, /The program ran/);
        // The name alone is not enough: the model reads the catalogue and decides by the
        // description, so the description and the arguments travel with the name.
        assert.match(answer, /"facility": true/);
        assert.match(answer, /Read a text file of the project/);
    } finally {
        await cleanup();
    }
});

test('the access reads the bytes of a file through the same rules as the text', async () => {
    const { root, cleanup } = await scratch();
    try {
        const access = createAccess({ root });
        const read = await access.fs.readBytes('note.txt');
        assert.equal(Buffer.from(read.bytes).toString('utf8'), 'hello\n');
        assert.equal(read.size, 6);
        assert.equal(read.truncated, false);
        // The write of bytes is atomic and whole: a reader never sees half of a file.
        const written = await access.fs.writeBytes('bin.dat', Uint8Array.from([7, 8, 9]));
        assert.equal(written.bytes, 3);
        assert.deepEqual([...(await readFile(path.join(root, 'bin.dat')))], [7, 8, 9]);
    } finally {
        await cleanup();
    }
});
