/**
 * @file src/agent/image-magick.js
 * @module agent/image-magick
 * @purpose The backends of the image work: the ImageMagick of the machine and the ImageMagick
 *          of the wasm.
 *
 *   The comparison of a page with the reference needs two things that the eye cannot do: the
 *   numbers of the difference and the picture of it. ImageMagick does both — `compare` counts
 *   the difference and writes it as a picture.
 *
 *   There are two backends and they speak the same language:
 *
 *   - the **native** one: the `magick` program of the machine. It is fast and it is on every
 *     desktop that has ImageMagick installed;
 *   - the **wasm** one: `@imagemagick/magick-wasm`, a dependency of the house that works
 *     everywhere, even where nothing is installed. It is the fallback of the fallback: it is
 *     loaded only when the machine has no ImageMagick.
 *
 *   Both backends answer the same question: given two pictures, brought to the same size,
 *   how much do they differ — and what does the difference look like.
 *
 * @depends node:path, node:os, node:fs/promises, node:module, agent/programs
 * @usedBy agent/image-compare, agent/tools
 * @exports magickCandidates, findMagick, parseMetric, nativeBackend, wasmBackend,
 *          resolveImageBackend, runMagick, METRICS
 * @ai.tags images, imagemagick, compare
 * @ai.hint io
 * @changed 2026-11-17 Сверка страницы с референсом: нативный ImageMagick и запасной wasm.
 * @changed 2026-11-21 `runMagick`: программа ImageMagick целиком в распоряжении роли, которая
 *                       работает с картинками.
 */

import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { runProgram } from './programs.js';

/** The metrics the house measures the difference by. */
export const METRICS = Object.freeze(['rmse', 'ssim', 'ncc', 'psnr']);

/** The names of the metrics as ImageMagick knows them. */
const METRIC_NAMES = Object.freeze({ rmse: 'RMSE', ssim: 'SSIM', ncc: 'NCC', psnr: 'PSNR' });

/**
 * The places the `magick` command may live: the PATH, then the folders of the install.
 *
 * The install of ImageMagick on Windows keeps its program in a folder that carries the
 * version in its name (`ImageMagick-7.1.2-Q16-HDRI`), so the folder is looked up by the mask.
 * @param {string|null} configured the executable of the configuration
 * @param {object} env
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function magickCandidates(configured = null, env = process.env) {
    const names = configured
        ? [path.basename(configured)]
        : process.platform === 'win32' ? ['magick.exe', 'magick.cmd'] : ['magick'];
    const result = configured ? [configured] : [];
    const push = (dir) => {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (!result.includes(candidate)) result.push(candidate);
        }
    };
    for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter)) {
        if (dir.trim()) push(dir.trim());
    }
    if (process.platform === 'win32') {
        const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
        for (const root of roots) {
            push(path.join(root, 'ImageMagick'));
            // The folder of the install carries the version: `ImageMagick-7.1.2-Q16-HDRI`.
            push(path.join(root, 'ImageMagick-7.1.2-Q16-HDRI'));
        }
    }
    if (process.platform === 'darwin') {
        push('/opt/homebrew/bin');
        push('/usr/local/bin');
    }
    return result;
}

/**
 * Find the ImageMagick of the machine.
 * @param {{ executable?: string|null, env?: object, exists?: Function }} [options]
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
export async function findMagick({ executable = null, env = process.env, exists = null } = {}) {
    const check = exists ?? (async (file) => stat(file).then((info) => info.isFile()).catch(() => false));
    for (const candidate of magickCandidates(executable, env)) {
        if (await check(candidate)) return candidate;
    }
    if (!executable && process.platform === 'win32') {
        // The folder of the install carries the version, so it is looked up by the mask.
        for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)) {
            const found = await findInstallByMask(root, check);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Look for the program of ImageMagick in the folders that carry the version in their name.
 * @param {string} root
 * @param {Function} check
 * @returns {Promise<string|null>}
 */
async function findInstallByMask(root, check) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^imagemagick/i.test(entry.name)) continue;
        for (const dir of [path.join(root, entry.name), path.join(root, entry.name, 'bin')]) {
            const candidate = path.join(dir, 'magick.exe');
            if (await check(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Read the number of a metric out of the answer of ImageMagick.
 *
 * The program prints the raw value and the normalized one in brackets: `41443 (0.63238)`.
 * The normalized value is the one the house reports — it is a number between 0 and 1.
 * @param {string} text
 * @returns {{ value: number, normalized: number }|null}
 * @exports
 * @ai.hint pure
 */
export function parseMetric(text) {
    const raw = String(text ?? '');
    const match = raw.match(/(-?[\d.]+(?:e[-+]?\d+)?)\s*\(\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*\)/i);
    if (match) {
        const value = Number(match[1]);
        const normalized = Number(match[2]);
        if (Number.isFinite(value) && Number.isFinite(normalized)) return { value, normalized };
    }
    const single = raw.match(/(-?[\d.]+(?:e[-+]?\d+)?)/i);
    if (single) {
        const value = Number(single[1]);
        if (Number.isFinite(value)) return { value, normalized: value };
    }
    return null;
}

/**
 * The backend of the native ImageMagick: the `magick` program of the machine.
 * @param {{ executable?: string|null, env?: object, cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ name: string, version: string, compare: Function }|null>}
 * @exports
 * @ai.hint io
 */
export async function nativeBackend({ executable = null, env = process.env, cwd = process.cwd(), timeoutMs = 30_000 } = {}) {
    const file = await findMagick({ executable, env });
    if (!file) return null;
    const version = await runProgram({ command: file, args: ['-version'], cwd, env, timeoutMs: 8_000 });
    if (!version.ok) return null;
    const text = `${version.stdout}\n${version.stderr}`;
    const line = text.split('\n').map((item) => item.trim()).find((item) => item.startsWith('Version:'));
    return {
        name: 'native',
        executable: file,
        version: line ? line.replace(/^Version:\s*/, '').split(' ')[0] : 'unknown',
        compare: (request) => nativeCompare({ executable: file, env, cwd, timeoutMs, ...request }),
        // The whole program is at the disposal of the role that works with the pictures:
        // the arguments are the arguments of ImageMagick, and the program does the work.
        run: (args = [], options = {}) => runProgram({
            command: file,
            args: (Array.isArray(args) ? args : []).map(String),
            cwd: options.cwd ?? cwd,
            env: options.env ?? env,
            timeoutMs: options.timeoutMs ?? timeoutMs,
        }),
    };
}

/**
 * Run ImageMagick on the pictures of the project.
 *
 * The program of the machine is the one that runs: the wasm of the house knows only the
 * comparison of two pictures, and the work of a role is wider than that.
 * @param {{ args?: string[], env?: object, cwd?: string, timeoutMs?: number, executable?: string|null }} [request]
 * @returns {Promise<{ ok: boolean, code: number|null, stdout: string, stderr: string,
 *   reason: string|null, version: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function runMagick({ args = [], env = process.env, cwd = process.cwd(), timeoutMs = 60_000, executable = null } = {}) {
    const file = await findMagick({ executable, env });
    if (!file) {
        return {
            ok: false,
            code: null,
            stdout: '',
            stderr: '',
            version: null,
            reason: 'ImageMagick не найден: поставьте ImageMagick на машину или укажите его в конфигурации.',
        };
    }
    const list = (Array.isArray(args) ? args : []).map(String);
    const result = await runProgram({ command: file, args: list, cwd, env, timeoutMs });
    return {
        ok: result.ok,
        code: result.code ?? null,
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        version: String(result.version ?? ''),
        reason: result.reason ?? null,
    };
}

/**
 * Compare two pictures with the native ImageMagick and write the difference as a picture.
 *
 * Both pictures are brought to the same size first: a difference between pictures of
 * different sizes is not a difference of the page, it is a difference of the sizes.
 * @param {{ executable: string, env: object, cwd: string, timeoutMs: number,
 *   referencePath: string, resultPath: string, width: number, height: number,
 *   workDir: string, diff?: boolean }} request
 * @returns {Promise<{ rmse: number|null, ssim: number|null, ncc: number|null, psnr: number|null,
 *   diffPath: string|null, warnings: string[] }>}
 */
async function nativeCompare({
    executable,
    env,
    cwd,
    timeoutMs,
    referencePath,
    resultPath,
    width,
    height,
    workDir,
    diff = false,
}) {
    const warnings = [];
    const size = `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`;
    const reference = path.join(workDir, 'reference.png');
    const result = path.join(workDir, 'result.png');
    for (const [source, target] of [[referencePath, reference], [resultPath, result]]) {
        // The `^` fills the box and the `-extent` cuts the rest: the picture keeps its
        // proportions and both of them show the same part of the page.
        const out = await runProgram({
            command: executable,
            args: [source, '-resize', `${size}^`, '-gravity', 'center', '-extent', size, target],
            cwd,
            env,
            timeoutMs,
        });
        if (!out.ok) {
            warnings.push(`ImageMagick не привёл картинку к размеру ${size}: ${out.reason ?? out.stderr?.slice(0, 200)}`);
            return { rmse: null, ssim: null, ncc: null, psnr: null, diffPath: null, warnings };
        }
    }
    const metrics = { rmse: null, ssim: null, ncc: null, psnr: null };
    for (const [name, metric] of Object.entries(METRIC_NAMES)) {
        const out = await runProgram({
            command: executable,
            args: ['compare', '-metric', metric, reference, result, 'null:'],
            cwd,
            env,
            timeoutMs,
        });
        const parsed = parseMetric(out.stderr || out.stdout);
        // The program answers with the code 1 when the pictures differ: that is not a failure.
        if (parsed) metrics[name] = parsed.normalized;
        else if (out.stderr) warnings.push(`Метрика ${metric} не прочитана: ${out.stderr.slice(0, 160)}`);
    }
    let diffPath = null;
    if (diff) {
        const target = path.join(workDir, 'difference.png');
        const out = await runProgram({
            command: executable,
            args: ['compare', reference, result, target],
            cwd,
            env,
            timeoutMs,
        });
        const written = await stat(target).then((info) => info.isFile()).catch(() => false);
        if (written) diffPath = target;
        else warnings.push(`Картинка различий не записана: ${out.reason ?? out.stderr?.slice(0, 200)}`);
    }
    return { ...metrics, diffPath, warnings };
}

/** The wasm of the house, loaded once. */
let wasmPromise = null;

/**
 * The backend of the wasm ImageMagick.
 *
 * The wasm is loaded lazily and only when the machine has no ImageMagick: it is a big file,
 * and it is slower than the program of the machine.
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ name: string, version: string, compare: Function }|null>}
 * @exports
 * @ai.hint io
 */
export async function wasmBackend({ cwd = process.cwd() } = {}) {
    if (!wasmPromise) {
        wasmPromise = loadWasm(cwd).catch(() => null);
    }
    return await wasmPromise;
}

/**
 * Load the wasm of ImageMagick and wrap it into the backend of the house.
 * @param {string} cwd
 * @returns {Promise<object|null>}
 */
async function loadWasm(cwd) {
    // The entry of the package is resolved through the condition of the import: the common
    // one is the bundle of UMD, and it cannot be imported as a module.
    let entry = null;
    let wasmUrl = null;
    try {
        entry = import.meta.resolve('@imagemagick/magick-wasm');
        wasmUrl = import.meta.resolve(process.arch === 'x64'
            ? '@imagemagick/magick-wasm/x64/magick.wasm'
            : '@imagemagick/magick-wasm/magick.wasm');
    } catch {
        try {
            const require = createRequire(path.join(cwd, 'noop.js'));
            const root = path.dirname(require.resolve('@imagemagick/magick-wasm/package.json'));
            entry = `file://${path.join(root, 'dist', 'index.js').replace(/\\/g, '/')}`;
            wasmUrl = `file://${require.resolve(process.arch === 'x64'
                ? '@imagemagick/magick-wasm/x64/magick.wasm'
                : '@imagemagick/magick-wasm/magick.wasm').replace(/\\/g, '/')}`;
        } catch {
            return null;
        }
    }
    let module = null;
    try {
        module = await import(entry);
    } catch {
        return null;
    }
    const init = process.arch === 'x64' ? module.initializeImageMagickx64 : module.initializeImageMagick;
    if (typeof init !== 'function') return null;
    let wasmBytes = null;
    try {
        wasmBytes = await readFile(new URL(wasmUrl));
    } catch {
        try {
            wasmBytes = await readFile(wasmUrl);
        } catch {
            return null;
        }
    }
    try {
        await init(wasmBytes);
    } catch {
        return null;
    }
    const { ImageMagick, Magick, MagickGeometry, MagickFormat, ErrorMetric, CompositeOperator } = module;
    return {
        name: 'wasm',
        executable: null,
        version: String(Magick.imageMagickVersion ?? 'wasm'),
        compare: (request) => wasmCompare({
            ImageMagick,
            MagickGeometry,
            MagickFormat,
            ErrorMetric,
            CompositeOperator,
            ...request,
        }),
    };
}

/**
 * Compare two pictures with the wasm ImageMagick and write the difference as a picture.
 * @param {{ ImageMagick: Function, MagickGeometry: Function, MagickFormat: object,
 *   ErrorMetric: object, ComposeOperator: object, referencePath: string, resultPath: string,
 *   width: number, height: number, workDir: string, diff?: boolean }} request
 * @returns {Promise<{ rmse: number|null, ssim: number|null, ncc: number|null, psnr: number|null,
 *   diffPath: string|null, warnings: string[] }>}
 */
async function wasmCompare({
    ImageMagick,
    MagickGeometry,
    MagickFormat,
    ErrorMetric,
    CompositeOperator,
    referencePath,
    resultPath,
    width,
    height,
    workDir,
    diff = false,
}) {
    const warnings = [];
    const formatOf = (file) => (/\.jpe?g$/i.test(file) ? MagickFormat.Jpeg : MagickFormat.Png);
    const geometry = new MagickGeometry(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    // The picture fills the box and the rest is cut: both pictures keep their proportions and
    // show the same part of the page.
    geometry.fillArea = true;
    geometry.ignoreAspectRatio = false;
    try {
        const referenceBytes = await readFile(referencePath);
        const resultBytes = await readFile(resultPath);
        const answer = ImageMagick.read(referenceBytes, formatOf(referencePath), (reference) => {
            reference.resize(geometry);
            return ImageMagick.read(resultBytes, formatOf(resultPath), (result) => {
                result.resize(geometry);
                const metrics = {
                    rmse: reference.compare(result, ErrorMetric.RootMeanSquared),
                    ssim: reference.compare(result, ErrorMetric.StructuralSimilarity),
                    ncc: reference.compare(result, ErrorMetric.NormalizedCrossCorrelation),
                    psnr: reference.compare(result, ErrorMetric.PeakSignalToNoiseRatio),
                };
                let difference = null;
                if (diff) {
                    difference = result.clone((copy) => {
                        copy.composite(reference, CompositeOperator.Difference);
                        return copy.write(MagickFormat.Png, (data) => data);
                    });
                }
                return { metrics, difference };
            });
        });
        let diffPath = null;
        if (answer?.difference) {
            diffPath = path.join(workDir, 'difference.png');
            await writeFile(diffPath, Buffer.from(answer.difference));
        }
        return {
            rmse: answer?.metrics?.rmse ?? null,
            ssim: answer?.metrics?.ssim ?? null,
            ncc: answer?.metrics?.ncc ?? null,
            psnr: answer?.metrics?.psnr ?? null,
            diffPath,
            warnings,
        };
    } catch (error) {
        warnings.push(`wasm ImageMagick не справился: ${error?.message ?? error}`);
        return { rmse: null, ssim: null, ncc: null, psnr: null, diffPath: null, warnings };
    }
}

/**
 * The backend of the image work: the program of the machine, or the wasm when the machine has
 * no program.
 * @param {{ env?: object, cwd?: string, prefer?: 'native'|'wasm'|null }} [options]
 * @returns {Promise<{ name: string, version: string, compare: Function }|null>}
 * @exports
 * @ai.hint io
 */
export async function resolveImageBackend({ env = process.env, cwd = process.cwd(), prefer = null } = {}) {
    if (prefer !== 'wasm') {
        const native = await nativeBackend({ env, cwd });
        if (native) return native;
    }
    if (prefer !== 'native') {
        const wasm = await wasmBackend({ cwd });
        if (wasm) return wasm;
    }
    return null;
}

/**
 * A directory of work for the comparison: the pictures of the comparison are written there.
 * @param {string} [prefix]
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function workDirectory(prefix = 'ai-webdev-compare-') {
    return await mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Remove a directory of work.
 * @param {string|null} dir
 * @returns {Promise<void>}
 * @exports
 * @ai.hint io
 */
export async function removeWorkDirectory(dir) {
    if (!dir) return;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
}
