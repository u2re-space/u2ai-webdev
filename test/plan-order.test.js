/**
 * @file test/plan-order.test.js
 * @module test/plan-order
 * @purpose The tests of the order of the stages: the plan decides it, the registry breaks the tie.
 * @depends node:test, stages/index, stages/plan-order
 * @ai.tags test, stages, plan, order
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/stages/index.js';
import {
    PLAN_STAGES,
    STYLE_CODE_PHASES,
    planEdges,
    planOrder,
    placeIconifyStage,
    placeVectorStage,
    placeAssetsAfterVector,
} from '../src/stages/plan-order.js';
import { isStateful } from '../src/stages/stateful.js';

/**
 * The plan of a landing where the graphics come before the page: the page links the files
 * of the editor. Two steps of the coder stand on both sides of the markup, and the roles of
 * the steps make a circle of the stages — the code before the markup and after it.
 */
const ART_PLAN = {
    summary: 'A landing with drawn assets.',
    steps: [
        { id: 'setup', title: 'Manifest', role: 'coder', dependsOn: [], files: ['package.json'] },
        { id: 'primary-art', title: 'Wordmark', role: 'editor', dependsOn: [], files: ['public/assets/wordmark.svg'] },
        { id: 'secondary-art', title: 'Screens', role: 'editor', dependsOn: [], files: ['public/assets/crt.svg'] },
        { id: 'markup', title: 'Markup', role: 'markup', dependsOn: ['primary-art', 'secondary-art'], files: ['index.html'] },
        { id: 'styles', title: 'Styles', role: 'styler', dependsOn: ['setup', 'markup'], files: ['src/styles/main.scss'] },
        { id: 'interactions', title: 'Interactions', role: 'coder', dependsOn: ['setup', 'markup', 'styles'], files: ['src/main.js'] },
    ],
};

/** The plan of a landing: the icons come before the styles, the scripts come last. */
const PLAN = {
    summary: 'A landing.',
    steps: [
        { id: 'measure-design', title: 'Measure', role: 'markup', dependsOn: [], files: ['measurements/DESIGN.md'] },
        { id: 'create-markup', title: 'Markup', role: 'markup', dependsOn: ['measure-design'], files: ['index.html'] },
        { id: 'select-icons', title: 'Icons', role: 'iconifier', dependsOn: ['measure-design'], files: ['src/assets/icons/'] },
        { id: 'create-styles', title: 'Styles', role: 'styler', dependsOn: ['create-markup', 'select-icons'], files: ['src/styles/main.scss'] },
        { id: 'add-animations', title: 'Animations', role: 'coder', dependsOn: ['create-styles'], files: ['src/scripts/main.js'] },
    ],
};

test('the stages that do the steps of the plan are known', () => {
    assert.ok(PLAN_STAGES.has('write'));
    assert.ok(PLAN_STAGES.has('iconify'));
    assert.ok(!PLAN_STAGES.has('build'));
});

test('there is one stage of writing', () => {
    // Фаз больше нет: разметку, стили, код и движение пишет одна стадия.
    assert.deepEqual(STYLE_CODE_PHASES, ['write']);
    const names = STAGES.map((stage) => stage.name);
    assert.ok(names.includes('write'));
    for (const gone of ['pre-coding', 'pre-styling', 'styling', 'coding', 'animation', 'markup']) {
        assert.ok(!names.includes(gone), `the stage ${gone} is still there`);
    }
});

test('the edges of the plan are the edges of the stages of its steps', () => {
    const { edges } = planEdges(PLAN);
    const list = edges.map(([from, to]) => `${from}>${to}`).sort();
    // Шаги одной роли дают ребро между её стадиями; здесь стадия письма одна, и шаги
    // роли не дают ребра вовсе — их работа идёт внутри стадии.
    assert.deepEqual(list, ['write>iconify']);
});

test('the plan decides the order of the stages that do its steps', () => {
    const { stages, warnings } = planOrder([...STAGES], PLAN);
    const names = stages.map((stage) => stage.name);

    // The stages that are not steps keep their place: the build is after the writing, the
    // review is after everything.
    assert.ok(names.indexOf('write') < names.indexOf('build'));
    assert.ok(names.indexOf('build') < names.indexOf('review'));
    assert.equal(names[0], 'collect');
    assert.equal(names[names.length - 1], 'learn');
});

test('the icons are picked after the writing', () => {
    const { stages } = planOrder([...STAGES], PLAN);
    const names = stages.map((stage) => stage.name);
    // Иконки ложатся в разметку, которую уже написали.
    assert.ok(names.indexOf('iconify') > names.indexOf('write'), names.join(' → '));
    // И до сборки: иконки должны попасть в бандл.
    assert.ok(names.indexOf('iconify') < names.indexOf('build'));
});

test('the iconify stage never stands before the writing', () => {
    const placed = placeIconifyStage(['write', 'iconify', 'build', 'sight']);
    // Иконки уже после письма: двигать нечего.
    assert.equal(placed.moved, false);
    assert.ok(placed.names.indexOf('iconify') > placed.names.indexOf('write'));
    // The icons stay before the build: they have to reach the bundle.
    assert.ok(placed.names.indexOf('iconify') < placed.names.indexOf('build'));

    // The icons before the writing go after it: the markup they land in is written.
    const before = placeIconifyStage(['iconify', 'write', 'build', 'sight']);
    assert.equal(before.moved, true);
    assert.ok(before.names.indexOf('iconify') > before.names.indexOf('write'));
    assert.ok(before.names.indexOf('iconify') < before.names.indexOf('build'));
});

test('a plan without dependencies keeps the order of the registry', () => {
    const { stages, warnings } = planOrder([...STAGES], { steps: [] });
    assert.deepEqual(stages.map((stage) => stage.name), STAGES.map((stage) => stage.name));
    assert.equal(warnings.length, 0);
});

test('a circle in the plan is broken by the registry and says so', () => {
    const plan = {
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: ['style-1'], files: ['src/main.js'] },
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['code-1'], files: ['src/styles/main.css'] },
        ],
    };
    const { stages, warnings } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    // The circle does not throw the plan away: the registry decides who goes first, and
    // every stage is still there exactly once.
    assert.equal(names.length, STAGES.length);
    assert.equal(new Set(names).size, STAGES.length);
    // Круг шагов одной роли не трогает порядок стадий: стадия письма одна.
    assert.ok(names.includes('write'));
});

test('the graphics are drawn before the page that links them', () => {
    // The registry itself: the vector stage stands before the writing.
    const registry = STAGES.map((stage) => stage.name);
    assert.ok(registry.indexOf('vector') < registry.indexOf('write'));

    // The plan of the run: the assets come after the vector, and the writing comes after.
    const { stages } = planOrder([...STAGES], ART_PLAN);
    const names = stages.map((stage) => stage.name);
    assert.ok(names.indexOf('vector') < names.indexOf('write'), names.join(' → '));
});

test('the vector stage does not stand in the middle of the chain', () => {
    // The vector between the writing and the build: it goes to the end of the chain.
    const placed = placeVectorStage(['setup', 'write', 'vector', 'build', 'sight', 'review']);
    assert.equal(placed.moved, true);
    assert.equal(placed.reason, 'end');
    assert.ok(placed.names.indexOf('vector') > placed.names.indexOf('sight'));
    assert.ok(placed.names.indexOf('vector') < placed.names.indexOf('review'));

    // The vector before the writing stays where it is.
    const kept = placeVectorStage(['setup', 'vector', 'write', 'build', 'sight', 'review']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['setup', 'vector', 'write', 'build', 'sight', 'review']);
});

test('the vector stage of a continued run comes before the build', () => {
    // Стадии письма в прогоне нет: она уже сделана. Вектор должен встать до сборки,
    // иначе бандл останется без ассетов.
    const placed = placeVectorStage(['build', 'sight', 'vector', 'iconify', 'review']);
    assert.equal(placed.moved, true);
    assert.equal(placed.reason, 'build');
    assert.ok(placed.names.indexOf('vector') < placed.names.indexOf('build'));
});

test('a page with a state gets the same stages as a page without one', () => {
    // Порядок один для всех: страница с состоянием и страница без него идут одинаково.
    const plan = {
        steps: [
            { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'] },
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['markup-1'], files: ['src/styles.scss'] },
            { id: 'data-1', title: 'Model', role: 'coder', dependsOn: ['markup-1'], files: ['src/model.js'] },
        ],
    };

    const plain = planOrder([...STAGES], plan, { config: { stack: { frontendFramework: 'vanilla' }, agent: { kind: 'landing' } } });
    const plainNames = plain.stages.map((stage) => stage.name);
    const app = planOrder([...STAGES], plan, { config: { stack: { frontendFramework: 'lure' }, agent: { kind: 'app' } } });
    const appNames = app.stages.map((stage) => stage.name);

    // Стадия письма одна и там, и там.
    for (const names of [plainNames, appNames]) {
        assert.ok(names.includes('write'));
    }
    assert.deepEqual(
        plainNames.filter((name) => name === 'write'),
        appNames.filter((name) => name === 'write'),
    );
});

test('the page with a state is known by the kind and by the framework', () => {
    assert.equal(isStateful({ config: { agent: { kind: 'app' } } }), true);
    assert.equal(isStateful({ config: { agent: { kind: 'site' } } }), true);
    assert.equal(isStateful({ config: { agent: { kind: 'landing' } } }), false);
    assert.equal(isStateful({ config: { agent: { kind: 'component' } } }), false);
    // Фреймворк, который рисует сам, — страница с состоянием по природе.
    assert.equal(isStateful({ config: { stack: { frontendFramework: 'react' } } }), true);
    assert.equal(isStateful({ config: { stack: { frontendFramework: 'vanilla' } } }), false);
    // Config says it outright.
    assert.equal(isStateful({ config: { stack: { stateful: true }, agent: { kind: 'landing' } } }), true);
    assert.equal(isStateful({ config: { stack: { stateful: false }, agent: { kind: 'app' } } }), false);
});

test('the assets floor keeps the assets after the vector', () => {
    const placed = placeAssetsAfterVector(['setup', 'assets', 'vector', 'write']);
    assert.equal(placed.moved, true);
    assert.ok(placed.names.indexOf('assets') > placed.names.indexOf('vector'));

    // The assets after the vector stay where they are.
    const kept = placeAssetsAfterVector(['setup', 'vector', 'assets', 'write']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['setup', 'vector', 'assets', 'write']);
});

test('the plan of the run breaks the circle of the assets and the markup', () => {
    const plan = {
        steps: [
            { id: 'graphics', title: 'Graphics', role: 'editor', dependsOn: [], files: ['public/images/logo.svg'] },
            { id: 'markup', title: 'Markup', role: 'markup', dependsOn: ['graphics'], files: ['index.html'] },
            { id: 'imagery', title: 'Imagery', role: 'illustrator', dependsOn: ['markup'], files: ['public/images/event-01.webp'] },
            { id: 'styles', title: 'Styles', role: 'styler', dependsOn: ['imagery'], files: ['src/styles/main.scss'] },
        ],
    };
    const { stages } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    // Стадия письма одна, и круг плана не может её разорвать: она одна.
    assert.ok(names.includes('write'));
});
