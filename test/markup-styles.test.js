/**
 * @file test/markup-styles.test.js
 * @module test/markup-styles
 * @purpose The tests of the check that the markup and the styles speak the same language.
 * @depends node:test, node:path, node:os, node:fs/promises, agent/markup-styles
 * @ai.tags test, styles, markup
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import {
    markupClasses,
    styleClasses,
    checkMarkupStyles,
    renamedClasses,
} from '../src/agent/markup-styles.js';

test('the classes of the markup are the names it uses', () => {
    const html = `
        <div class="landing hero">
            <span class="hero__title">A</span>
            <img class="hero__piece" src="a.png" alt="a" data-class="not-a-class" />
        </div>`;
    assert.deepEqual(markupClasses(html), ['hero', 'hero__piece', 'hero__title', 'landing']);
});

test('the markup without classes has none', () => {
    assert.deepEqual(markupClasses('<main><p>Text</p></main>'), []);
    assert.deepEqual(markupClasses(''), []);
});

test('the styles name the classes of their selectors', () => {
    const scss = `
        .landing {
            display: grid;
        }
        .hero__title,
        .hero__piece {
            color: red;
        }
        .is-open {
            display: block;
        }`;
    assert.deepEqual(styleClasses(scss), ['hero__piece', 'hero__title', 'is-open', 'landing']);
});

test('the nested selectors of the styles are resolved to their names', () => {
    const scss = `
        .card {
            color: red;
            &__title {
                font-size: 2rem;
            }
            &--wide {
                width: 100%;
            }
            .is-open {
                display: block;
            }
        }`;
    assert.deepEqual(styleClasses(scss), ['card', 'card--wide', 'card__title', 'is-open']);
});

test('the comments, the addresses and the strings are not classes', () => {
    const scss = `
        /* .commented { color: red; } */
        .logo {
            background: url(../assets/logo.png);
            content: ".quoted";
            // .line { color: blue; }
        }`;
    assert.deepEqual(styleClasses(scss), ['logo']);
});

test('the check of the project names the classes without a rule and the rules without a markup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    await writeFile(path.join(root, 'index.html'), '<div class="landing hero__title"></div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.landing { color: red; }\n.hero__piece { color: blue; }\n', 'utf8');

    const check = await checkMarkupStyles({
        root,
        markup: ['index.html'],
        styles: ['styles.scss'],
    });

    assert.deepEqual(check.orphans, ['hero__title']);
    assert.deepEqual(check.unused, ['hero__piece']);
    assert.equal(check.ok, false);
    assert.deepEqual(check.warnings, []);
});

test('the check of the project is happy when the names match', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    await writeFile(path.join(root, 'index.html'), '<div class="landing"></div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.landing { color: red; }\n', 'utf8');

    const check = await checkMarkupStyles({
        root,
        markup: ['index.html'],
        styles: ['styles.scss'],
    });

    assert.deepEqual(check.orphans, []);
    assert.equal(check.ok, true);
});

test('the file that is not there is a warning, not a failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    const check = await checkMarkupStyles({
        root,
        markup: ['index.html'],
        styles: ['styles.scss'],
    });
    assert.equal(check.warnings.length, 2);
    assert.equal(check.ok, true);
});

test('the renamed classes are the ones that the styles still describe', () => {
    const renamed = renamedClasses(
        ['hero-card__title', 'landing'],
        ['hero__headline', 'landing'],
        ['hero-card__title', 'landing'],
    );
    assert.deepEqual(renamed, ['hero-card__title']);
});

test('a class that nobody described is not a rename', () => {
    assert.deepEqual(renamedClasses(['old'], ['new'], []), []);
});
