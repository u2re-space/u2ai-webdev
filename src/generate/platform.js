/**
 * @file src/generate/platform.js
 * @module generate/platform
 * @purpose The frozen web-platform profile: what the browser of the project supports, and what
 *          the generated code may not use.
 *
 *   The profile is a snapshot, not a live check. A feature that was behind a flag or an origin
 *   trial at the snapshot date is withheld, no matter what a documentation site says today: the
 *   documentation also describes the experiments.
 *
 * @depends none
 * @usedBy generate/brief, generate/scaffold, stages/architect
 * @exports ENABLED_FEATURES, WITHHELD_FEATURES, PLATFORM_SOURCES, CHROMIUM_156,
 *          PLATFORMS, resolvePlatform, platformInstructions
 * @ai.tags generate, platform, browser
 * @ai.hint pure
 * @ai.hint legacy-0.2
 */

import { ENUMS } from '../config/constants.js';

/** The features enabled by default in the browser of the snapshot. */
export const ENABLED_FEATURES = Object.freeze([
    Object.freeze({ id: 'sanitizer-javascript-urls', area: 'html', summary: 'SanitizerConfig javascriptURLs option. Omitting the option keeps the previous behavior.' }),
    Object.freeze({ id: 'background-fetch-cors', area: 'fetch', summary: 'Background Fetch enforces CORS and the same security checks as fetch, including Local Network Access.' }),
    Object.freeze({ id: 'css-corner-shorthand', area: 'css', summary: 'corner shorthand plus per-corner, physical, and logical sub-shorthands for border-radius and corner-shape. corners stays as a compat alias.' }),
    Object.freeze({ id: 'css-position-visibility-anchor-valid', area: 'css', summary: 'position-visibility: anchor-valid. Only the default anchor counts.' }),
    Object.freeze({ id: 'css-text-overflow-string', area: 'css', summary: 'text-overflow accepts a custom string such as "(more)".' }),
    Object.freeze({ id: 'capability-elements-icon-only', area: 'html', summary: 'Capability elements can render as icon-only buttons with the displaymode attribute.' }),
    Object.freeze({ id: 'canvas-text-metrics', area: 'canvas', summary: 'TextMetrics adds selection rectangles, bounding boxes, and glyph-cluster operations.' }),
    Object.freeze({ id: 'progress-event-service-worker', area: 'workers', summary: 'Service workers can construct ProgressEvent.' }),
    Object.freeze({ id: 'html-in-canvas', area: 'canvas', summary: 'HTML-in-canvas primitives for canvas layout, drawing, and DOM synchronization.' }),
    Object.freeze({ id: 'language-detector-android', area: 'js', summary: 'LanguageDetector on Chrome for Android, on device.' }),
    Object.freeze({ id: 'loaf-style-duration', area: 'js', summary: 'Long Animation Frames expose styleDuration and forcedStyleDuration.' }),
    Object.freeze({ id: 'html-insertion-streaming', area: 'html', summary: 'Positional HTML insertion methods and streaming HTML writers, including runScripts on the unsafe setters.' }),
    Object.freeze({ id: 'css-anchor-valid-visible', area: 'css', summary: 'anchor-valid and anchor-visible ship. The plural names are deprecated aliases, not removed.' }),
    Object.freeze({ id: 'web-bluetooth-gatt-event-target', area: 'webbluetooth', summary: 'BluetoothRemoteGATTServer extends EventTarget.' }),
    Object.freeze({ id: 'webgpu-atomic-vec2u', area: 'webgpu', summary: 'WGSL atomic min and max on atomic vec2u.' }),
    Object.freeze({ id: 'svg-object-fit', area: 'css', summary: 'object-fit and object-position size embedded SVG documents instead of stretching the document viewport.' }),
]);

/** The features a generated page may not use: a trial, a flag, or simply not shipped. */
export const WITHHELD_FEATURES = Object.freeze([
    Object.freeze({ id: 'connection-allowlists-embedded', gate: 'origin-trial', summary: 'Connection Allowlists embedded enforcement is an origin trial in the browser of the snapshot.' }),
    Object.freeze({ id: 'overscroll-areas', gate: 'origin-trial', summary: 'Overscroll Areas is an origin trial in the browser of the snapshot.' }),
    Object.freeze({ id: 'flagged-features', gate: 'flag', summary: 'The snapshot has features behind a flag. Do not toggle browser flags and do not ship a feature whose status is behind a flag.' }),
    Object.freeze({ id: 'css-random', gate: 'not-default', summary: 'CSS random() is not in the default-enabled list of the browser of the snapshot.' }),
]);

/**
 * The pages the profile was checked against. They also describe experiments, which stay
 * withheld. The list came from the monolith; the address of the cascade draft was in it
 * twice, and here every address is written once.
 */
export const PLATFORM_SOURCES = Object.freeze([
    'https://css-tricks.com/',
    'https://chromestatus.com/roadmap',
    'https://262.ecma-international.org/',
    'https://caniuse.com/',
    'https://drafts.csswg.org/css-logical/',
    'https://drafts.css-houdini.org/css-properties-values-api/',
    'https://drafts.csswg.org/css-cascade-5/',
    'https://drafts.csswg.org/css-conditional-5/',
    'https://drafts.csswg.org/css-anchor-position-2/',
    'https://drafts.csswg.org/css-values-5/',
    'https://drafts.csswg.org/css-animations-2/',
    'https://drafts.csswg.org/css-shapes-2/',
    'https://drafts.csswg.org/motion/',
    'https://drafts.csswg.org/css-transforms-2/',
    'https://drafts.csswg.org/css-contain/',
    'https://drafts.csswg.org/css-images-5/',
    'https://drafts.csswg.org/css-masking/',
    'https://drafts.csswg.org/css-fonts/',
    'https://imagemagick.org/command-line-options/',
    'https://imagemagick.org/command-line-tools/',
    'https://phosphoricons.com/',
    'https://lucide.dev/icons/',
    'https://fonts.google.com/',
    'https://www.typescriptlang.org/docs/',
    'https://sass-lang.com/documentation/',
    'https://developer.mozilla.org/en-US/docs/Web/CSS',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    'https://eslint.org/docs/latest/',
    'https://stylelint.io/user-guide/',
    'https://prettier.io/docs/'
]);

/**
 * The browser of the snapshot: Chromium 156 based, experimental flags off, origin trials off.
 */
export const CHROMIUM_156 = Object.freeze({
    id: 'chromium',
    browser: 'chromium',
    version: 156,
    channel: 'stable',
    experimentalFlags: false,
    originTrials: false,
    snapshot: '2026-10-15',
    ecma: Object.freeze({ edition: 2026, spec: 'https://262.ecma-international.org/' }),
    javascript: Object.freeze({ target: 'es2026', engine: 'v8', flags: false }),
    css: Object.freeze({ target: 'chromium-156', flags: false }),
    vite: Object.freeze({ target: 'esnext', cssTarget: 'chrome156' }),
    sources: PLATFORM_SOURCES,
    enabled: ENABLED_FEATURES,
    withheld: WITHHELD_FEATURES,
});

/** The profiles a config may name. The default is `chromium`. */
export const PLATFORMS = Object.freeze({
    chromium: CHROMIUM_156,
});

/**
 * The profile of a platform id, or the default one when the id is omitted.
 * @param {string} [id='chromium']
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function resolvePlatform(id = 'chromium') {
    const key = String(id ?? '').trim() || 'chromium';
    const profile = PLATFORMS[key];
    if (!profile) {
        throw new Error(`Неизвестный профиль платформы: ${id}. Доступны: ${Object.keys(PLATFORMS).join(', ')}`);
    }
    return profile;
}

/**
 * The rules of one platform profile for the model.
 *
 * The list is built from the data of the profile, so the text cannot drift away from it.
 * @param {object} profile the result of `resolvePlatform`
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function platformInstructions(profile) {
    const enabled = profile.enabled.map((feature) => `- ${feature.id} (${feature.area}): ${feature.summary}`).join('\n');
    const withheld = profile.withheld.map((feature) => `- ${feature.id} [${feature.gate}]: ${feature.summary}`).join('\n');
    const sources = profile.sources.map((url) => `- ${url}`).join('\n');
    return [
        `Platform profile ${profile.id}.`,
        `Browser: ${String(profile.browser ?? '').replace(/^./, (letter) => letter.toUpperCase())} ${profile.version} ${profile.channel}. Experimental flags: ${profile.experimentalFlags ? 'on' : 'off'}. Origin trials: ${profile.originTrials ? 'allowed' : 'off'}.`,
        `Snapshot: ${profile.snapshot}.`,
        `ECMAScript edition ${profile.ecma.edition} (${profile.ecma.spec}). Use that edition only for the syntax and the built-ins the browser runs with experimental flags off.`,
        `JavaScript target: ${profile.javascript.target}. CSS target: ${profile.css.target}.`,
        `Vite build target: ${profile.vite.target}. Vite CSS target: ${profile.vite.cssTarget}.`,
        'The features that earlier versions enabled by default stay allowed: CSS nesting, cascade layers, :has(), container queries, subgrid, color-mix(), oklch, light-dark(), anchor positioning, same-document view transitions, popover, dialog, text-wrap: balance, and dvh/svh/lvh, plus the ECMAScript built-ins those versions ship without a flag.',
        `The features the browser of the snapshot enabled by default:`,
        enabled,
        'Do not use:',
        withheld,
        'Documentation sources. These sites also describe experiments. Experiments are not allowed:',
        sources,
    ].join('\n');
}

/**
 * The languages the generator may write, taken from the config enums.
 * @returns {{ frameworks: string[], markup: string[], style: string[], script: string[] }}
 * @exports
 * @ai.hint pure
 */
export function platformLanguages() {
    return {
        frameworks: [...ENUMS.frontendFrameworks],
        markup: [...ENUMS.markupLanguages],
        style: [...ENUMS.styleLanguages],
        script: [...ENUMS.scriptLanguages],
    };
}
