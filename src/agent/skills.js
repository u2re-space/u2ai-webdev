/**
 * @file src/agent/skills.js
 * @module agent/skills
 * @purpose The skill packs of the webdev: the markdown a user drops next to the config to teach
 *          a role something the model does not know.
 *
 *   Two kinds of packs live here.
 *
 *   The role packs are flat files: `coder.md` belongs to the coder, `shared.md` belongs to every
 *   role. Their text is appended to the instructions of the role, so it becomes part of the
 *   system prompt and not something the model can be talked out of.
 *
 *   The skill packs are directories with a `SKILL.md` inside, the way OpenClaw and the other
 *   agents of the family keep them: `.agents/skills/<name>/SKILL.md` in the project, or the same
 *   layout in the home. The model sees the list of them and reads one with the `read_skill`
 *   tool when the task calls for it.
 *
 *   The packs are read, never written: the webdev has no business changing the files a user
 *   keeps for this purpose.
 *
 * @depends node:path, node:fs/promises
 * @usedBy agent/tools, roles/index, stages/collect
 * @exports FRONTMATTER_RE, defaultSkillsDir, parseFrontmatter, loadSkillPacks, skillsForRole,
 *          listSkillPacks, discoverSkills, buildSkillInstructions, readSkill, readSkillFile,
 *          filterSkillsByKeywords,
 *          skillDirectoryGroups, skillDirectories, skillCatalog, removeSkillPack
 * @ai.tags skills, prompts
 * @ai.hint io
 */

import path from 'node:path';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { builtinSkillsDir } from './guidance.js';

/** The marker of the frontmatter of a skill file. */
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse the frontmatter of a skill file.
 *
 * The parser is deliberately small: a key, a value, and the two block scalars (`>` and `|`) the
 * skill files use for long descriptions. A file without frontmatter is all body.
 * @param {string} text
 * @returns {{ name: string, description: string, metadata: object, body: string }}
 * @exports
 * @ai.hint pure
 */
export function parseFrontmatter(text) {
    const source = String(text ?? '');
    const match = source.match(FRONTMATTER_RE);
    if (!match) return { name: '', description: '', metadata: {}, body: source };
    const lines = match[1].split(/\r?\n/);
    const metadata = {};
    let name = '';
    let description = '';
    for (let index = 0; index < lines.length; index += 1) {
        const pair = lines[index].match(/^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/);
        if (!pair) continue;
        const key = pair[1];
        let value = pair[2].trim();
        if (value === '>' || value === '|' || value === '>-' || value === '|-') {
            const fold = value[0] === '>';
            const parts = [];
            while (index + 1 < lines.length && (/^[ \t]/.test(lines[index + 1]) || lines[index + 1] === '')) {
                parts.push(lines[++index].replace(/^[ \t]+/, ''));
            }
            while (parts.length && parts[parts.length - 1] === '') parts.pop();
            value = fold ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n');
        } else {
            value = value.replace(/^["']|["']$/g, '');
        }
        if (key === 'name') name = value;
        else if (key === 'description') description = value;
        else metadata[key] = value;
    }
    return { name, description, metadata, body: match[2] ?? '' };
}

/**
 * The directory of the role packs: `~/.ai-webdev/skills`.
 * @param {object} [env]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function defaultSkillsDir(env = process.env) {
    const home = env.AI_WEBDEV_HOME
        || path.join(env.HOME || env.USERPROFILE || '', '.ai-webdev');
    return path.join(home, 'skills');
}

/**
 * The role packs of one directory: every `*.md` file.
 * @param {{ dir?: string|null, env?: object }} [options]
 * @returns {Promise<Array<{ name: string, content: string, bytes: number }>>}
 * @exports
 * @ai.hint io
 */
export async function loadSkillPacks({ dir = null, env = process.env } = {}) {
    const root = dir ? path.resolve(dir) : defaultSkillsDir(env);
    let entries = [];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const packs = [];
    for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const content = await readFile(path.join(root, entry), 'utf8').catch(() => null);
        if (content === null) continue;
        const parsed = parseFrontmatter(content);
        packs.push({
            name: entry.slice(0, -3),
            content: parsed.body.trim() || content.trim(),
            description: parsed.description,
            bytes: Buffer.byteLength(content, 'utf8'),
        });
    }
    return packs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The packs of one role: the pack named after the role and the shared ones.
 * @param {{ dir?: string|null, role?: string|null, env?: object }} [options]
 * @returns {Promise<Array<{ name: string, content: string, bytes: number }>>}
 * @exports
 * @ai.hint io
 */
export async function loadRolePacks({ dir = null, role = null, env = process.env } = {}) {
    const packs = await loadSkillPacks({ dir, env });
    if (!role) return packs;
    return packs.filter((pack) => pack.name === role || pack.name === 'shared' || pack.name === '_shared');
}

/**
 * The text of the packs of one role, ready to be appended to its instructions.
 * @param {{ dir?: string|null, role?: string|null, env?: object }} [options]
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function skillsForRole(options = {}) {
    const packs = await loadRolePacks(options);
    if (!packs.length) return '';
    return packs
        .map((pack) => `## Skill pack: ${pack.name}\n${pack.content.trim()}`)
        .join('\n\n');
}

/**
 * Every pack of the directory, with the sizes — for the `skills` command.
 * @param {{ dir?: string|null, env?: object }} [options]
 * @returns {Promise<Array<{ name: string, bytes: number }>>}
 * @exports
 * @ai.hint io
 */
export async function listSkillPacks({ dir = null, env = process.env } = {}) {
    return (await loadSkillPacks({ dir, env })).map((pack) => ({ name: pack.name, bytes: pack.bytes }));
}

/**
 * The directories of the skill packs with their kind: the project, the home or the package.
 * @param {string} root the project directory
 * @param {object} [env]
 * @returns {Array<{ dir: string, kind: string }>}
 * @exports
 * @ai.hint pure
 */
export function skillDirectoryGroups(root, env = process.env) {
    const home = env.HOME || env.USERPROFILE || '';
    return [
        { dir: path.join(root, '.agents', 'skills'), kind: 'project' },
        { dir: path.join(root, '.koda', 'skills'), kind: 'project' },
        { dir: path.join(root, '.claude', 'skills'), kind: 'project' },
        { dir: path.join(root, '.rules', 'skills'), kind: 'project' },
        { dir: path.join(home, '.agents', 'skills'), kind: 'home' },
        { dir: builtinSkillsDir(), kind: 'builtin' },
    ];
}

/**
 * The directories the skill packs may live in, in the order they are looked at.
 *
 * The packs that ship with the package come last: a copy of a pack in the project wins
 * over the one of the package, and the copy in the home wins over both.
 *
 * @param {string} root the project directory
 * @param {object} [env]
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function skillDirectories(root, env = process.env) {
    return skillDirectoryGroups(root, env).map((group) => group.dir);
}

/**
 * The catalog of the skill packs: every pack with its directory and its kind.
 *
 * The first pack of a name wins: the project answers before the home, the home before
 * the package.
 *
 * @param {string} root the project directory
 * @param {{ env?: object, extraDirs?: string[] }} [options]
 * @returns {Promise<Array<{ name: string, description: string, path: string, dir: string,
 *   kind: string, removable: boolean }>>}
 * @exports
 * @ai.hint io
 */
export async function skillCatalog(root, { env = process.env, extraDirs = [] } = {}) {
    const groups = [
        ...skillDirectoryGroups(root, env),
        ...extraDirs.map((dir) => ({ dir, kind: 'extra' })),
    ];
    const out = [];
    const seen = new Set();
    for (const group of groups) {
        for (const pack of await discoverInDir(group.dir)) {
            if (seen.has(pack.name)) continue;
            seen.add(pack.name);
            out.push({
                name: pack.name,
                description: pack.description,
                path: pack.path,
                dir: group.dir,
                kind: group.kind,
                removable: group.kind === 'project',
            });
        }
    }
    return out;
}

/**
 * Remove a skill pack of the project.
 *
 * Only the packs of the project may be removed: the pack of the package belongs to the
 * installation, and the pack of the home belongs to the user.
 *
 * @param {string} name the name of the pack
 * @param {string} root the project directory
 * @param {{ env?: object }} [options]
 * @returns {Promise<{ removed: boolean, path: string|null, reason: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function removeSkillPack(name, root, { env = process.env } = {}) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return { removed: false, path: null, reason: 'no-name' };
    if (!/^[\w.-]+$/.test(wanted)) return { removed: false, path: null, reason: 'bad-name' };

    for (const group of skillDirectoryGroups(root, env)) {
        if (group.kind !== 'project') continue;
        const dir = path.join(group.dir, wanted);
        const info = await stat(dir).catch(() => null);
        if (!info?.isDirectory()) continue;
        await rm(dir, { recursive: true, force: true });
        return { removed: true, path: dir, reason: null };
    }

    const catalog = await skillCatalog(root, { env });
    const found = catalog.find((pack) => pack.name === wanted);
    return { removed: false, path: null, reason: found ? (found.kind === 'builtin' ? 'builtin' : 'home') : 'not-found' };
}

/**
 * The skill packs of one directory: every subdirectory with a `SKILL.md` inside.
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, description: string, body: string, path: string, metadata: object }>>}
 * @exports
 * @ai.hint io
 */
export async function discoverInDir(dir) {
    const skills = [];
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return skills;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const file = path.join(dir, entry.name, 'SKILL.md');
        try {
            const raw = await readFile(file, 'utf8');
            const parsed = parseFrontmatter(raw);
            if (!parsed.body.trim()) continue;
            skills.push({
                name: parsed.name || entry.name,
                description: parsed.description || '',
                body: parsed.body.trim(),
                path: file,
                metadata: parsed.metadata,
            });
        } catch { /* the pack has no SKILL.md or it cannot be read: skip it */ }
    }
    return skills;
}

/**
 * Every skill pack the project may use, without the repeats.
 * @param {string} root the project directory
 * @param {{ extraDirs?: string[], env?: object }} [options]
 * @returns {Promise<Array<{ name: string, description: string, body: string, path: string, metadata: object }>>}
 * @exports
 * @ai.hint io
 */
export async function discoverSkills(root, { extraDirs = [], env = process.env } = {}) {
    const dirs = [...skillDirectories(root, env), ...extraDirs];
    const all = [];
    for (const dir of dirs) all.push(...await discoverInDir(dir));
    const seen = new Set();
    return all.filter((skill) => {
        if (seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
    });
}

/**
 * The list of the skill packs, ready to be put into the instructions of a role.
 * @param {Array<{ name: string, description: string, body: string, path: string }>} skills
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function buildSkillInstructions(skills = []) {
    const list = Array.isArray(skills) ? skills : [];
    if (!list.length) return '';
    const lines = [
        '# Available skills',
        '',
        'These skill packs are installed. Read one with the `read_skill` tool before you use',
        'what it describes; a pack may name the commands, the standards and the steps of a task.',
        'The CLIs of the house are not packs: `ai-image`, `ai-measure`, `ai-decompose` and',
        '`ai-memory` are tools — `call_ai_image`, `call_ai_measure`, `call_ai_decompose` and',
        '`call_ai_memory`.',
        '',
        ...list.map((skill) => `- **\`${skill.name}\`**: ${skill.description || 'no description'}`),
    ];
    return lines.join('\n');
}

/**
 * One skill pack by its name.
 * @param {string} name
 * @param {string} root the project directory
 * @param {{ extraDirs?: string[], env?: object }} [options]
 * @returns {Promise<{ name: string, description: string, body: string, path: string, metadata: object }|null>}
 * @exports
 * @ai.hint io
 */
export async function readSkill(name, root, { extraDirs = [], env = process.env } = {}) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return null;
    for (const dir of [...skillDirectories(root, env), ...extraDirs]) {
        const file = path.join(dir, wanted, 'SKILL.md');
        try {
            if (!await stat(file).then((info) => info.isFile()).catch(() => false)) continue;
            const raw = await readFile(file, 'utf8');
            const parsed = parseFrontmatter(raw);
            return {
                name: parsed.name || wanted,
                description: parsed.description,
                body: parsed.body.trim(),
                path: file,
                metadata: parsed.metadata,
            };
        } catch { /* try the next directory */ }
    }
    return null;
}

/**
 * One file of a skill pack.
 *
 * A pack is not one file: the references of a pack are files beside it, and the model reads
 * them by their path inside the pack. The file stays inside the pack: the path may not climb
 * out of it.
 *
 * @param {string} name the name of the pack
 * @param {string} file the path of the file inside the pack
 * @param {string} root the project directory
 * @param {{ extraDirs?: string[], env?: object }} [options]
 * @returns {Promise<{ name: string, path: string, body: string }|null>}
 * @exports
 * @ai.hint io
 */
export async function readSkillFile(name, file, root, { extraDirs = [], env = process.env } = {}) {
    const wanted = String(name ?? '').trim();
    const rel = String(file ?? '').trim().replace(/\\/g, '/');
    if (!wanted || !rel) return null;
    if (rel.startsWith('/') || rel.split('/').includes('..')) return null;
    for (const dir of [...skillDirectories(root, env), ...extraDirs]) {
        const base = path.join(dir, wanted);
        const target = path.join(base, rel);
        // The file of the pack lies inside the pack.
        if (!target.startsWith(base + path.sep)) continue;
        try {
            const raw = await readFile(target, 'utf8');
            return { name: wanted, path: target, body: raw };
        } catch { /* try the next directory */ }
    }
    return null;
}

/**
 * The packs whose name, description or body mentions one of the keywords.
 * @param {Array<{ name: string, description: string, body: string }>} skills
 * @param {string[]} keywords
 * @returns {Array<object>}
 * @exports
 * @ai.hint pure
 */
export function filterSkillsByKeywords(skills = [], keywords = []) {
    const wanted = (Array.isArray(keywords) ? keywords : []).map((item) => String(item).toLowerCase()).filter(Boolean);
    if (!wanted.length) return Array.isArray(skills) ? [...skills] : [];
    return (Array.isArray(skills) ? skills : []).filter((skill) => {
        const haystack = `${skill.name ?? ''} ${skill.description ?? ''} ${skill.body ?? ''}`.toLowerCase();
        return wanted.some((keyword) => haystack.includes(keyword));
    });
}
