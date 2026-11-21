/**
 * @file src/generate/scaffold.js
 * @module generate/scaffold
 * @purpose The stack of a generated project: the files, the `package.json`, the recommendations of
 *          the libraries, and the safe merge of a scaffold into a project that already has files.
 *
 *   The merge is the delicate part: a generated skeleton must not overwrite what the project
 *   already has. The rule is simple and absolute — a file is written only when it is missing,
 *   and `package.json` only gains the keys it does not have.
 *
 * @depends node:path, node:fs/promises, config/constants
 * @usedBy generate/brief, stages/setup
 * @exports GENERATION_KINDS, FRAMEWORKS, filesForKind, filesForStack, npmPackageName,
 *          buildPackageManifest, SCAFFOLD_VERSIONS, scaffoldVersion, stackText, recommendStack,
 *          kindRules, renderGenerationTask, preparedScaffoldFiles, writePreparedScaffold,
 *          planScaffoldMerge
 * @ai.tags generate, scaffold, stack
 * @ai.hint pure
 * @ai.hint legacy-0.2
 */

import path from 'node:path';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { ENUMS } from '../config/constants.js';
import { writeFileAtomic } from '../shared/house.js';

/** The kinds of a generation task. */
export const GENERATION_KINDS = Object.freeze([...ENUMS.generationKinds]);

/** The frameworks the scaffold knows: the packages, the plugins and the default script language. */
export const FRAMEWORKS = Object.freeze({
    vanilla: { libs: [], plugins: [], defaultScript: 'javascript', entry: 'index.html' },
    react: { libs: ['react', 'react-dom'], plugins: ['@vitejs/plugin-react'], defaultScript: 'javascript', entry: 'index.html' },
    vue: { libs: ['vue'], plugins: ['@vitejs/plugin-vue'], defaultScript: 'javascript', entry: 'index.html' },
    svelte: { libs: ['svelte'], plugins: ['@sveltejs/vite-plugin-svelte'], defaultScript: 'javascript', entry: 'index.html' },
    next: { libs: ['next', 'react', 'react-dom'], plugins: [], defaultScript: 'typescript', entry: 'app/page.tsx' },
    astro: { libs: ['astro'], plugins: ['@astrojs/react'], defaultScript: 'typescript', entry: 'src/pages/index.astro' },
    vite: { libs: [], plugins: [], defaultScript: 'javascript', entry: 'index.html' },
    // The fest-live reactive stack: @fest-lib/lure over core/dom/object/uniform/style-lib.
    lure: {
        libs: ['@fest-lib/core', '@fest-lib/dom', '@fest-lib/object', '@fest-lib/uniform', '@fest-lib/style-lib', '@fest-lib/lure'],
        plugins: [], defaultScript: 'typescript', entry: 'index.html',
    },
    // The backend-first sibling: @fest-lib/ssre renders HTML on the server (Fastify by default).
    ssre: {
        libs: ['@fest-lib/ssre', 'fastify'],
        plugins: [], defaultScript: 'typescript', entry: 'server.ts',
    },
});

/** The files of a kind, before the stack changes them. */
const WEB_FILES = Object.freeze(['package.json', 'vite.config.js', 'index.html']);
const WEB_TAIL = Object.freeze(['src/main.js', 'src/styles.scss', 'README.md']);

/**
 * The files a kind asks for when they are missing.
 * @param {string|null} kind
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function filesForKind(kind) {
    if (kind === 'landing') return [...WEB_FILES, ...WEB_TAIL];
    if (kind === 'site') return [...WEB_FILES, 'about.html', ...WEB_TAIL];
    if (kind === 'app') return [...WEB_FILES, ...WEB_TAIL, 'server.js'];
    if (kind === 'backend') return ['package.json', 'server.js', 'README.md'];
    if (kind === 'component') return ['package.json', 'vite.config.js', 'index.html', 'src/component.js', 'src/styles.scss', 'README.md'];
    return [];
}

/**
 * The files of a kind after the stack decided the extensions.
 * @param {{ kind: string|null, framework?: string|null, scriptLanguage?: string|null,
 *   styleLanguage?: string|null, markup?: string|null }} request
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function filesForStack({ kind, framework = null, scriptLanguage = null, styleLanguage = null, markup = null } = {}) {
    const files = [...filesForKind(kind)];
    if (!files.length) return files;

    const fw = framework ?? 'vanilla';
    const style = styleLanguage ?? 'scss';
    const script = scriptLanguage ?? FRAMEWORKS[fw]?.defaultScript ?? 'javascript';

    if (kind === 'backend') return files;

    const ext = script === 'typescript' ? (fw === 'react' ? 'tsx' : 'ts') : (fw === 'react' ? 'jsx' : 'js');
    const styleExt = style === 'scss' ? 'scss' : style === 'less' ? 'less' : 'css';

    const index = files.indexOf('src/main.js');
    if (index !== -1) files[index] = `src/main.${ext}`;

    const styles = files.indexOf('src/styles.scss');
    if (styles !== -1) files[styles] = `src/styles.${styleExt}`;

    if (fw === 'ssre') {
        // The server renders the HTML; the scaffold drops the static page and the client
        // entry and names the server entry after the script language instead.
        const without = files.filter((file) => !['index.html', 'src/main.js', 'vite.config.js'].includes(file));
        const server = without.indexOf('server.js');
        if (server !== -1) without[server] = script === 'typescript' ? 'server.ts' : 'server.js';
        return without;
    }

    if (fw === 'react') {
        const at = index === -1 ? files.length : index + 1;
        files.splice(at, 0, `src/App.${ext}`);
    }
    if (fw === 'vue') {
        const at = index === -1 ? files.length : index;
        files.splice(at, 0, 'src/App.vue');
    }
    if (fw === 'svelte') {
        const at = index === -1 ? files.length : index;
        files.splice(at, 0, 'src/App.svelte');
    }
    if (fw === 'next' || fw === 'astro') {
        // These frameworks own the entry point and the router of the project.
        return files.filter((file) => !['index.html', 'src/main.js', 'src/styles.scss'].includes(file));
    }

    const mark = markup ?? 'html';
    if (mark === 'jsx' || mark === 'tsx') {
        const html = files.indexOf('index.html');
        if (html !== -1) files[html] = `index.${mark}`;
    }
    if (mark === 'vue' || mark === 'svelte') {
        const html = files.indexOf('index.html');
        if (html !== -1) files[html] = `index.${mark}`;
    }

    return files;
}

/**
 * A legal npm name, or `app`.
 * @param {string} basename
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function npmPackageName(basename) {
    const name = String(basename ?? '').trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214) return name;
    return 'app';
}

/**
 * The versions the scaffold puts into the manifest.
 *
 * A version of `*` is not a version: npm would take the newest one of the registry, and the
 * newest one changes under the feet of the project. The versions of the tools of the stack
 * are pinned to a known-good range, so the install of the project is repeatable.
 * @type {Record<string, string>}
 * @exports
 * @ai.hint pure
 */
export const SCAFFOLD_VERSIONS = Object.freeze({
    vite: '^7.0.0',
    sass: '^1.80.0',
    less: '^4.2.0',
    typescript: '^5.6.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    vue: '^3.5.0',
    svelte: '^5.0.0',
    next: '^15.0.0',
    astro: '^5.0.0',
    '@vitejs/plugin-react': '^4.3.0',
    '@vitejs/plugin-vue': '^5.2.0',
    '@vitejs/plugin-svelte': '^5.0.0',
    '@sveltejs/vite-plugin-svelte': '^5.0.0',
    tsx: '^4.19.0',
    // The fest-live stack; the versions are the ones published on npm (checked 2026-11).
    '@fest-lib/core': '^0.1.40',
    '@fest-lib/dom': '^0.1.63',
    '@fest-lib/object': '^0.1.53',
    '@fest-lib/uniform': '^0.1.41',
    '@fest-lib/style-lib': '^0.1.36',
    '@fest-lib/lure': '^0.1.92',
    '@fest-lib/ssre': '^0.1.21',
});

/**
 * The version of a package of the scaffold.
 *
 * A package the catalogue does not know keeps the version of the manifest: an unknown
 * package is pinned by the one who asked for it.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function scaffoldVersion(name, fallback = '*') {
    return SCAFFOLD_VERSIONS[String(name ?? '')] ?? fallback;
}

/**
 * The `package.json` of a new project.
 *
 * The versions are the pinned ones of the stack: the installer of the project decides the
 * real ones and pins them.
 * @param {{ kind: string|null, name: string, framework?: string|null, styleLanguage?: string|null,
 *   scriptLanguage?: string|null, libraries?: object[] }} request
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function buildPackageManifest({
    kind,
    name,
    framework = null,
    styleLanguage = null,
    scriptLanguage = null,
    libraries = [],
} = {}) {
    const web = kind === 'landing' || kind === 'site' || kind === 'app';
    const fw = framework ?? 'vanilla';
    const style = styleLanguage ?? 'scss';
    const script = scriptLanguage ?? FRAMEWORKS[fw]?.defaultScript ?? 'javascript';

    const scripts = web
        ? { dev: 'vite', build: 'vite build', preview: 'vite preview' }
        : { start: 'node server.js' };
    if (script === 'typescript') scripts.typecheck = 'tsc --noEmit';
    if (fw === 'ssre') {
        // The server runs straight from the source: tsx for TypeScript, node for JavaScript.
        scripts.start = script === 'typescript' ? 'tsx server.ts' : 'node server.js';
        scripts.dev = scripts.start;
    }

    const dependencies = {};
    const devDependencies = {};

    const definition = FRAMEWORKS[fw];
    if (definition) {
        for (const lib of definition.libs) dependencies[lib] = scaffoldVersion(lib);
        for (const plugin of definition.plugins) devDependencies[plugin] = scaffoldVersion(plugin);
    }
    if (web) devDependencies.vite = scaffoldVersion('vite');
    if (web && style === 'scss') devDependencies.sass = scaffoldVersion('sass');
    if (web && style === 'less') devDependencies.less = scaffoldVersion('less');
    if (script === 'typescript') devDependencies.typescript = scaffoldVersion('typescript');
    if (fw === 'ssre' && script === 'typescript') devDependencies.tsx = scaffoldVersion('tsx');

    for (const library of libraries) {
        if (!library?.include || !library?.name) continue;
        const bucket = library.kind === 'tool' || library.kind === 'css' ? devDependencies : dependencies;
        if (!(library.name in dependencies) && !(library.name in devDependencies)) {
            bucket[library.name] = scaffoldVersion(library.name);
        }
    }

    const manifest = {
        name: npmPackageName(name),
        private: true,
        type: 'module',
        engines: { node: '>=26' },
        scripts,
    };
    if (Object.keys(dependencies).length) manifest.dependencies = dependencies;
    if (Object.keys(devDependencies).length) manifest.devDependencies = devDependencies;
    return manifest;
}

/**
 * The stack of the project in one paragraph, for the model and for the manifest.
 * @param {string|null} kind
 * @param {object} platform the profile of the browser
 * @param {{ name: string, include: boolean }[]} [libraries]
 * @param {{ framework?: string|null, scriptLanguage?: string|null, styleLanguage?: string|null,
 *   markupLanguage?: string|null }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function stackText(kind, platform, libraries = [], options = {}) {
    const included = new Set(libraries.filter((item) => item.include).map((item) => item.name));
    const { framework = null, scriptLanguage = null, styleLanguage = null, markupLanguage = null } = options;
    const fw = framework ?? 'vanilla';
    const style = styleLanguage ?? 'scss';
    const script = scriptLanguage ?? FRAMEWORKS[fw]?.defaultScript ?? 'javascript';
    const mark = markupLanguage ?? 'html';
    const styleName = style === 'scss' ? 'SCSS' : style === 'less' ? 'Less' : 'CSS';

    const parts = [];
    if (fw === 'ssre') {
        parts.push(`Node.js 26, ESM, @fest-lib/ssre over Fastify, bind 127.0.0.1, port PORT or 3000.${script === 'typescript' ? ' The server runs straight from TypeScript through tsx.' : ''}`);
    } else if (kind === 'backend') {
        parts.push(`Node.js 26, ESM, server.js on node:http, bind 127.0.0.1, port PORT or 3000.${included.has('fastify') ? ' The server uses fastify.' : ' No dependency unless a recommendation includes one.'}`);
    } else {
        parts.push(`Node.js 26, ESM, Vite, ${styleName}, ECMAScript ${platform?.ecma?.edition ?? 2026} (${platform?.id ?? 'chromium'}, experimental flags off).${kind === 'app' ? ' server.js serves dist/ after vite build.' : ' No Node server.'}`);
    }

    if (fw === 'react') parts.push('The interface is React JSX/TSX components with the Vite plugin.');
    else if (fw === 'vue') parts.push('The interface is Vue single-file components (.vue) with the Vite plugin.');
    else if (fw === 'svelte') parts.push('The interface is Svelte components (.svelte) with the Vite plugin.');
    else if (fw === 'next') parts.push('The interface is Next.js: the file system is the router, the server components are the default.');
    else if (fw === 'astro') parts.push('The interface is Astro: the pages are .astro files under src/pages, the islands are the interactive parts.');
    else if (fw === 'lure') parts.push('The interface is @fest-lib/lure: the DOM is built with the factories E/H/M/Q/T/C and the reactive refs of @fest-lib/object; the styles are plain CSS through @fest-lib/style-lib. Read the fest-lib skill before the first component.');
    else if (fw === 'ssre') parts.push('The interface is @fest-lib/ssre: the HTML is rendered on the server with E/H/M over a hub of @fest-lib/object refs, Fastify serves the pages, the live updates go over the channel (SSE by default). Read the fest-lib skill before the first page.');

    if (script === 'typescript') parts.push('The modules are TypeScript.');
    if (mark === 'jsx' || mark === 'tsx') parts.push('The markup is written inside the components, not in a separate template.');
    if (included.has('tailwindcss')) parts.push('The styles are Tailwind utility classes.');
    if (included.has('@phosphor-icons/core')) parts.push('The icons are Phosphor.');
    if (included.has('lucide-static')) parts.push('The icons are Lucide.');

    return parts.join(' ');
}

/** The packages the catalogue knows, with their kind and their documentation. */
const KNOWN = Object.freeze({
    vite: { kind: 'tool', docs: 'https://vite.dev/guide/' },
    sass: { kind: 'tool', docs: 'https://sass-lang.com/documentation/' },
    less: { kind: 'css', docs: 'https://lesscss.org/' },
    typescript: { kind: 'tool', docs: 'https://www.typescriptlang.org/docs/' },
    react: { kind: 'runtime', docs: 'https://react.dev/' },
    'react-dom': { kind: 'runtime', docs: 'https://react.dev/' },
    '@vitejs/plugin-react': { kind: 'tool', docs: 'https://github.com/vitejs/vite/tree/main/packages/plugin-react' },
    vue: { kind: 'runtime', docs: 'https://vuejs.org/' },
    '@vitejs/plugin-vue': { kind: 'tool', docs: 'https://github.com/vitejs/vite-plugin-vue' },
    svelte: { kind: 'runtime', docs: 'https://svelte.dev/' },
    '@sveltejs/vite-plugin-svelte': { kind: 'tool', docs: 'https://github.com/sveltejs/vite-plugin-svelte' },
    next: { kind: 'runtime', docs: 'https://nextjs.org/' },
    astro: { kind: 'runtime', docs: 'https://astro.build/' },
    '@astrojs/react': { kind: 'tool', docs: 'https://docs.astro.build/en/guides/framework-components/' },
    tailwindcss: { kind: 'css', docs: 'https://tailwindcss.com/docs' },
    '@tailwindcss/vite': { kind: 'tool', docs: 'https://tailwindcss.com/docs/installation/using-vite' },
    bootstrap: { kind: 'css', docs: 'https://getbootstrap.com/docs/' },
    bulma: { kind: 'css', docs: 'https://bulma.io/documentation/' },
    'open-props': { kind: 'css', docs: 'https://open-props.style/' },
    '@phosphor-icons/core': { kind: 'icons', docs: 'https://phosphoricons.com/' },
    'lucide-static': { kind: 'icons', docs: 'https://lucide.dev/icons/' },
    heroicons: { kind: 'icons', docs: 'https://heroicons.com/' },
    fastify: { kind: 'runtime', docs: 'https://fastify.dev/docs/latest/' },
    '@fastify/static': { kind: 'runtime', docs: 'https://github.com/fastify/fastify-static' },
    '@fastify/cors': { kind: 'runtime', docs: 'https://github.com/fastify/fastify-cors' },
    express: { kind: 'runtime', docs: 'https://expressjs.com/' },
    hono: { kind: 'runtime', docs: 'https://hono.dev/docs/' },
    '@fest-lib/core': { kind: 'runtime', docs: 'https://github.com/fest-live/core.ts' },
    '@fest-lib/dom': { kind: 'runtime', docs: 'https://github.com/fest-live/dom.ts' },
    '@fest-lib/object': { kind: 'runtime', docs: 'https://github.com/fest-live/object.ts' },
    '@fest-lib/uniform': { kind: 'runtime', docs: 'https://github.com/fest-live/uniform.ts' },
    '@fest-lib/style-lib': { kind: 'runtime', docs: 'https://github.com/fest-live/style.ts' },
    '@fest-lib/lure': { kind: 'runtime', docs: 'https://github.com/fest-live/lur.e' },
    '@fest-lib/ssre': { kind: 'runtime', docs: 'https://github.com/fest-live/ssr.e' },
    '@fest-lib/icon': { kind: 'icons', docs: 'https://github.com/fest-live/icon.ts' },
    '@fest-lib/image': { kind: 'runtime', docs: 'https://github.com/fest-live/image.ts' },
});

/** The packs of the stylesheets, matched by the words of the task. */
const CSS_PACKS = Object.freeze([
    { test: /tailwind/i, names: ['tailwindcss', '@tailwindcss/vite'] },
    { test: /bootstrap/i, names: ['bootstrap'] },
    { test: /bulma/i, names: ['bulma'] },
    { test: /open\s*props/i, names: ['open-props'] },
]);

/** The icon sets, matched by the words of the task. */
const ICON_PACKS = Object.freeze([
    { test: /phosphor/i, name: '@phosphor-icons/core' },
    { test: /lucide/i, name: 'lucide-static' },
    { test: /heroicons?/i, name: 'heroicons' },
]);

/** The servers, matched by the words of the task. */
const SERVERS = Object.freeze([
    { test: /\bfastify\b/i, name: 'fastify' },
    { test: /\bexpress\b/i, name: 'express' },
    { test: /\bhono\b/i, name: 'hono' },
]);

/** The fest-live stack, matched by the words of the task: lure on the client, ssre on the server. */
const FEST_PACKS = Object.freeze([
    { test: /\blure\b/i, name: '@fest-lib/lure' },
    { test: /\bssre\b/i, name: '@fest-lib/ssre' },
    { test: /\bfest[-\s]?lib\b|\bfest\.live\b/i, name: '@fest-lib/lure' },
]);

/**
 * One catalogue row as a library entry.
 * @param {string} name
 * @param {string} reason
 * @param {boolean} include
 * @returns {object}
 * @ai.hint pure
 */
function library(name, reason, include) {
    const known = KNOWN[name] ?? { kind: 'runtime', docs: null };
    return { name, kind: known.kind, reason, docs: known.docs, include };
}

/**
 * Recommend the libraries of a task. No network, no guessing beyond the words of the task.
 * @param {{ kind: string|null, prompt?: string, references?: object }} request
 * @returns {{ libraries: object[], templates: object[], bases: object[] }}
 * @exports
 * @ai.hint pure
 */
export function recommendStack({ kind, prompt = '', references = {} } = {}) {
    const images = references.images ?? [];
    const files = references.files ?? [];
    const templates = references.templates ?? [];
    const examples = references.examples ?? [];
    const hay = [prompt, ...images, ...files, ...templates, ...examples].join('\n');

    const libraries = [];
    const seen = new Set();
    const add = (name, reason, include) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        libraries.push(library(name, reason, include));
    };

    for (const match of String(prompt).matchAll(/https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[a-z0-9-~][\w.-]*\/)?[a-z0-9-._~]+)/gi)) {
        add(match[1], 'Named on npm.', true);
    }
    for (const pack of CSS_PACKS) {
        if (pack.test.test(hay)) for (const name of pack.names) add(name, 'Matched the design name.', true);
    }
    const icon = ICON_PACKS.find((pack) => pack.test.test(hay));
    if (icon) add(icon.name, 'Matched the icon set of the design.', true);
    for (const pack of FEST_PACKS) {
        if (pack.test.test(hay)) add(pack.name, 'Named the fest-live stack.', true);
    }

    if (kind === 'backend') {
        const server = SERVERS.find((pack) => pack.test.test(hay));
        if (server) add(server.name, 'Named server library.', true);
        else if (/\b(router|routes?|validation|middleware)\b/i.test(hay)) add('fastify', 'The task needs a router or a validation.', true);
    }

    const bases = [{ name: kind === 'backend' ? 'node-http' : 'vite', reason: 'the default skeleton of the kind' }];
    const reuse = [];
    return { libraries, templates, bases, reuse };
}

/**
 * The rules of one kind for the model.
 * @param {string|null} kind
 * @param {{ libraries: object[] }} recommendations
 * @param {{ framework?: string|null, markup?: string|null }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function kindRules(kind, recommendations = { libraries: [] }, options = {}) {
    const included = new Set((recommendations.libraries ?? []).filter((item) => item.include).map((item) => item.name));
    const { framework = null, markup = null } = options;
    const fw = framework ?? 'vanilla';
    const web = kind === 'landing' || kind === 'site' || kind === 'app';

    const lines = [];
    if (kind === 'backend' || fw === 'ssre') {
        lines.push('Node.js 26, ESM. Bind 127.0.0.1. The port comes from PORT or 3000.');
        if (fw === 'ssre') {
            lines.push('The pages are rendered by @fest-lib/ssre: a hub of refs, renderPage or the Fastify plugin ssrePlugin, the live updates over the channel (SSE by default). Read the fest-lib skill before the first page.');
            lines.push('The markup is written with the factories E/H/M as TypeScript modules; there is no index.html and no vite build.');
        } else {
            lines.push(included.has('fastify') ? 'Use fastify and the packages marked include.' : 'Use node:http. Do not add a server library unless the recommendation includes one.');
        }
    } else if (web) {
        if (fw === 'react') lines.push('Vite, React JSX/TSX, ESM, Node.js 26.');
        else if (fw === 'vue') lines.push('Vite, Vue single-file components, ESM, Node.js 26.');
        else if (fw === 'svelte') lines.push('Vite, Svelte components, ESM, Node.js 26.');
        else if (fw === 'next') lines.push('Next.js, the App Router, TypeScript, Node.js 26.');
        else if (fw === 'astro') lines.push('Astro, the pages under src/pages, TypeScript, Node.js 26.');
        else if (fw === 'lure') lines.push('Vite, @fest-lib/lure (the factories E/H/M/Q/T/C, the refs of @fest-lib/object), TypeScript, ESM, Node.js 26. The styles are plain CSS or @fest-lib/style-lib; read the fest-lib skill before the first component.');
        else if (fw === 'ssre') lines.push('Node.js 26, @fest-lib/ssre over Fastify, TypeScript, ESM. The pages are rendered on the server over a hub of refs; read the fest-lib skill before the first page.');
        else lines.push('Vite, SCSS, ESM, Node.js 26.');
        lines.push(kind === 'app' ? 'server.js serves dist/ after vite build.' : 'No Node server.');
        lines.push('vite.config.js is already written with the build targets of the platform profile. Do not plan a step to create it.');
        lines.push('Do not run npm run dev or npm run preview inside a step: they do not exit. Verify with npm run build and read the built files.');
        lines.push('Load the fonts from Google Fonts and the icons from a CDN, or download them with download_font and download_icons when the task needs local files.');
        lines.push('The page has a canvas: the element with the class `page` inside the `body`. The markup writes it, the styles give it the width of the design (the token `--real-page-width`) and scale it into the window.');
    } else if (kind === 'component') {
        lines.push('A component is a reusable package, not a page. The public entry is index.js, and the demo page is only a host.');
        lines.push('The public API is the contract in .ai/component.json. Implement exactly that API.');
    } else {
        lines.push('Choose the files the request needs.');
    }
    lines.push('Read .rules/ and .skills/ and follow them. Do not overwrite them.');
    lines.push('Add absent package.json keys only. Keep the existing scripts and the existing versions.');
    lines.push('Every step must create or change a named file.');
    lines.push('Use at most 4 steps. Group the markup, the styles and the modules of one block into one step.');
    if (markup === 'jsx' || markup === 'tsx') lines.push('The markup lives inside the components.');
    return lines.join('\n');
}

/**
 * The task of the run: what to build, in the stack of the project.
 * @param {{ kind: string|null, prompt?: string, platform?: object, recommendations?: object,
 *   name?: string, framework?: string|null, scriptLanguage?: string|null,
 *   styleLanguage?: string|null, markup?: string|null }} request
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function renderGenerationTask({
    kind,
    prompt = '',
    platform = {},
    recommendations = { libraries: [] },
    name = 'app',
    framework = null,
    scriptLanguage = null,
    styleLanguage = null,
    markup = null,
} = {}) {
    const stack = stackText(kind, platform, recommendations.libraries ?? [], {
        framework,
        scriptLanguage,
        styleLanguage,
        markupLanguage: markup,
    });
    const outputs = filesForStack({ kind, framework, scriptLanguage, styleLanguage, markup });
    const libraries = (recommendations.libraries ?? []).filter((item) => item.include).map((item) => item.name);

    return [
        `# Task: ${kind ?? 'web'}`,
        '',
        stack,
        '',
        `The project is named ${npmPackageName(name)}.`,
        outputs.length ? `The files of the project: ${outputs.join(', ')}.` : '',
        libraries.length ? `The packages of the project: ${libraries.join(', ')}.` : '',
        '',
        'The customer asks:',
        '',
        '```md',
        String(prompt).trim() || '(no text; follow the references)',
        '```',
    ].filter((line) => line !== '').join('\n');
}

/**
 * The files the scaffold writes before the first step.
 * @param {{ kind: string|null, platform?: object, recommendations?: object, name?: string,
 *   framework?: string|null, scriptLanguage?: string|null, styleLanguage?: string|null,
 *   markup?: string|null }} request
 * @returns {Record<string, string>}
 * @exports
 * @ai.hint pure
 */
export function preparedScaffoldFiles({
    kind,
    platform = {},
    recommendations = { libraries: [] },
    name = 'app',
    framework = null,
    scriptLanguage = null,
    styleLanguage = null,
    markup = null,
} = {}) {
    const files = {};
    const manifest = buildPackageManifest({ kind, name, framework, scriptLanguage, styleLanguage, libraries: recommendations.libraries ?? [] });
    files['package.json'] = `${JSON.stringify(manifest, null, 2)}\n`;

    if (kind === 'landing' || kind === 'site' || kind === 'app') {
        const target = platform?.vite?.target ?? 'esnext';
        const cssTarget = platform?.vite?.cssTarget ?? 'chrome156';
        const plugins = [];
        const imports = ["import { defineConfig } from 'vite';"];
        if (framework === 'react') {
            imports.push("import react from '@vitejs/plugin-react';");
            plugins.push('react()');
        } else if (framework === 'vue') {
            imports.push("import vue from '@vitejs/plugin-vue';");
            plugins.push('vue()');
        } else if (framework === 'svelte') {
            imports.push("import { svelte } from '@sveltejs/vite-plugin-svelte';");
            plugins.push('svelte()');
        }
        const lines = [...imports, '', 'export default defineConfig({'];
        if (plugins.length) lines.push(`    plugins: [${plugins.join(', ')}],`);
        lines.push('    build: {', `        target: '${target}',`, `        cssTarget: '${cssTarget}',`, '    },', '});', '');
        files['vite.config.js'] = lines.join('\n');
        files['.rules/stack.md'] = `# Stack\n\n${stackText(kind, platform, recommendations.libraries ?? [], { framework, scriptLanguage, styleLanguage, markupLanguage: markup })}\n`;
        files['.rules/files.md'] = '# Files\n\nRead the existing files before you change them. A scaffold writes only the missing paths.\n';
    }
    if (framework === 'ssre') {
        // The server renders the HTML: no vite config and no static page. The entry is the
        // server itself, and the run learns the wiring from the stack rules.
        delete files['vite.config.js'];
        delete files['index.html'];
        if (files['package.json']) {
            const manifest = JSON.parse(files['package.json']);
            delete manifest.devDependencies?.vite;
            delete manifest.dependencies?.vite;
            files['package.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
        }
    }

    return files;
}

/**
 * Write the prepared files into a project. A file that exists is never overwritten.
 * @param {string} root
 * @param {Record<string, string>} files
 * @returns {Promise<{ written: string[], skipped: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function writePreparedScaffold(root, files = {}) {
    const written = [];
    const skipped = [];
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        const exists = await stat(abs).then(() => true).catch(() => false);
        if (exists) {
            skipped.push(rel);
            continue;
        }
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        written.push(rel);
    }
    return { written, skipped };
}

/**
 * The plan of the merge of a `package.json` into an existing one.
 *
 * The existing file wins on every key it already has; the incoming file only adds what is
 * missing. Nothing is removed.
 * @param {{ incoming: object, existing: object }} request
 * @returns {{ merged: object, added: string[], kept: string[] }}
 * @exports
 * @ai.hint pure
 */
export function planScaffoldMerge({ incoming, existing } = {}) {
    const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
    const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
    const merged = { ...current };
    const added = [];
    const kept = [];

    for (const [key, value] of Object.entries(next)) {
        if (!(key in merged)) {
            merged[key] = value;
            added.push(key);
            continue;
        }
        kept.push(key);
        if (value && typeof value === 'object' && !Array.isArray(value)
            && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
            // The sections of the manifest merge key by key: a script that exists is kept.
            const section = { ...merged[key] };
            for (const [name, item] of Object.entries(value)) {
                if (!(name in section)) section[name] = item;
            }
            merged[key] = section;
        }
    }

    return { merged, added, kept };
}

/**
 * Merge a `package.json` into the one of the project, if it is there.
 * @param {string} root
 * @param {object} incoming
 * @returns {Promise<{ merged: boolean, added: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function mergePackageManifest(root, incoming) {
    const file = path.join(root, 'package.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return { merged: false, added: [] };
    let existing = null;
    try { existing = JSON.parse(text); } catch { existing = null; }
    if (!existing || typeof existing !== 'object') return { merged: false, added: [] };
    const plan = planScaffoldMerge({ incoming, existing });
    if (!plan.added.length) return { merged: false, added: [] };
    // The manifest is written whole: a crash in the middle leaves the old one.
    await writeFileAtomic(file, `${JSON.stringify(plan.merged, null, 2)}\n`);
    return { merged: true, added: plan.added };
}
