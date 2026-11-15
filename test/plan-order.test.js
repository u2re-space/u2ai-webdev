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
import { PLAN_STAGES, planEdges, planOrder } from '../src/stages/plan-order.js';

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

    // The icons are picked before the styles are written, and the scripts come after both.
    assert.ok(names.indexOf('iconify') < names.indexOf('styling'));
    assert.ok(names.indexOf('styling') < names.indexOf('coding'));
    // The stages that are not steps keep their place: the build is after the styles, the
    // review is after everything.
    assert.ok(names.indexOf('styling') < names.indexOf('build'));
    assert.ok(names.indexOf('build') < names.indexOf('review'));
    assert.equal(names[0], 'collect');
    assert.equal(names[names.length - 1], 'learn');
    assert.ok(warnings.some((item) => /Порядок стадий задан планом/.test(item)));
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

test('a circle in the plan keeps the order of the registry and says so', () => {
    const plan = {
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: ['style-1'], files: ['src/main.js'] },
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['code-1'], files: ['src/styles/main.css'] },
        ],
    };
    const { stages, warnings } = planOrder([...STAGES], plan);
    assert.deepEqual(stages.map((stage) => stage.name), STAGES.map((stage) => stage.name));
    assert.ok(warnings.some((item) => /круг зависимостей/.test(item)));
});
