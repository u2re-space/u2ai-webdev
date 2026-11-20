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
import { PLAN_STAGES, planEdges, planOrder, placeIconifyStage, placeVectorStage } from '../src/stages/plan-order.js';

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
    assert.ok(PLAN_STAGES.has('markup'));
    assert.ok(PLAN_STAGES.has('iconify'));
    assert.ok(!PLAN_STAGES.has('build'));
});

test('the edges of the plan are the edges of the stages of its steps', () => {
    const { edges } = planEdges(PLAN);
    const list = edges.map(([from, to]) => `${from}>${to}`).sort();
    // The steps of one role give no edge: their work goes inside the stage.
    assert.deepEqual(list, ['iconify>styling', 'markup>iconify', 'markup>styling', 'styling>coding']);
});

test('the plan decides the order of the stages that do its steps', () => {
    const { stages, warnings } = planOrder([...STAGES], PLAN);
    const names = stages.map((stage) => stage.name);

    // The icons are picked before the styles are written when the plan says so, and the
    // scripts come after both.
    assert.ok(names.indexOf('styling') < names.indexOf('coding'));
    // The stages that are not steps keep their place: the build is after the styles, the
    // review is after everything.
    assert.ok(names.indexOf('styling') < names.indexOf('build'));
    assert.ok(names.indexOf('build') < names.indexOf('review'));
    assert.equal(names[0], 'collect');
    assert.equal(names[names.length - 1], 'learn');
    assert.ok(warnings.some((item) => /Порядок стадий задан планом/.test(item)));
});

test('the icons are picked after the styles, even when the plan says the opposite', () => {
    const { stages, warnings } = planOrder([...STAGES], PLAN);
    const names = stages.map((stage) => stage.name);
    // The plan asked for the icons before the styles; the floor of the stage wins.
    assert.ok(names.indexOf('iconify') > names.indexOf('styling'), names.join(' → '));
    assert.ok(warnings.some((item) => /Стадия иконок перенесена после стилиста/.test(item)));
});

test('the iconify stage never stands before the styler', () => {
    const placed = placeIconifyStage(['markup', 'coding', 'iconify', 'styling', 'build', 'sight']);
    assert.equal(placed.moved, true);
    assert.ok(placed.names.indexOf('iconify') > placed.names.indexOf('styling'));
    // The icons stay before the build: they have to reach the bundle.
    assert.ok(placed.names.indexOf('iconify') < placed.names.indexOf('build'));

    // The icons after the styler stay where they are.
    const kept = placeIconifyStage(['markup', 'coding', 'styling', 'iconify', 'build', 'sight']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['markup', 'coding', 'styling', 'iconify', 'build', 'sight']);
});

test('a plan without dependencies keeps the order of the registry', () => {
    const { stages, warnings } = planOrder([...STAGES], { steps: [] });
    assert.deepEqual(stages.map((stage) => stage.name), STAGES.map((stage) => stage.name));
    assert.equal(warnings.length, 0);
});

test('the plan moves only the stages it says something about', () => {
    const plan = {
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'] },
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['code-1'], files: ['src/styles/main.css'] },
        ],
    };
    const { stages } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    // The registry order says the same thing here: the code is before the styles.
    assert.ok(names.indexOf('coding') < names.indexOf('styling'));
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
    assert.ok(names.indexOf('coding') < names.indexOf('styling'));
    assert.ok(warnings.some((item) => /круг зависимостей/.test(item)));
});

test('the graphics are drawn before the page that links them', () => {
    // The registry itself: the vector stage stands before the markup.
    const registry = STAGES.map((stage) => stage.name);
    assert.ok(registry.indexOf('vector') < registry.indexOf('markup'));

    // The plan of the run: the assets come before the markup, and the circle of the stages
    // does not throw that order away.
    const { stages, warnings } = planOrder([...STAGES], ART_PLAN);
    const names = stages.map((stage) => stage.name);
    assert.ok(names.indexOf('vector') < names.indexOf('markup'), names.join(' → '));
    assert.ok(names.indexOf('markup') < names.indexOf('coding'), names.join(' → '));
    assert.ok(warnings.some((item) => /круг зависимостей/.test(item)));
});

test('the vector stage does not stand in the middle of the chain', () => {
    // The vector between the markup and the build: it goes to the end of the chain.
    const placed = placeVectorStage(['setup', 'markup', 'coding', 'styling', 'vector', 'build', 'sight', 'review']);
    assert.equal(placed.moved, true);
    assert.equal(placed.reason, 'end');
    assert.ok(placed.names.indexOf('vector') > placed.names.indexOf('sight'));
    assert.ok(placed.names.indexOf('vector') < placed.names.indexOf('review'));

    // The vector before the markup stays where it is.
    const kept = placeVectorStage(['setup', 'vector', 'markup', 'coding', 'build', 'sight', 'review']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['setup', 'vector', 'markup', 'coding', 'build', 'sight', 'review']);

    // The vector at the very end is where it may stand.
    const end = placeVectorStage(['setup', 'markup', 'coding', 'build', 'sight', 'vector', 'review']);
    assert.equal(end.moved, false);
});

test('the vector stage of a continued run comes before the build', () => {
    // The markup is already done: the vector must not wait for the build, or the bundle
    // misses the assets.
    const placed = placeVectorStage(['coding', 'styling', 'build', 'sight', 'vector', 'iconify', 'review']);
    assert.equal(placed.moved, true);
    assert.equal(placed.reason, 'build');
    assert.ok(placed.names.indexOf('vector') < placed.names.indexOf('build'));
    assert.ok(placed.names.indexOf('coding') < placed.names.indexOf('vector'));
});
