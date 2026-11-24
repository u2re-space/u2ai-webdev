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
    planEdges,
    planOrder,
    placeIconifyStage,
    placeVectorStage,
    placeAnimationAfterStyles,
    placeAssetsAfterVector,
    placeAssetsAfterMarkup,
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
    assert.ok(PLAN_STAGES.has('markup'));
    assert.ok(PLAN_STAGES.has('iconify'));
    assert.ok(!PLAN_STAGES.has('build'));
});

test('the edges of the plan are the edges of the stages of its steps', () => {
    const { edges } = planEdges(PLAN);
    const list = edges.map(([from, to]) => `${from}>${to}`).sort();
    // The steps of one role give no edge: their work goes inside the stage.
    // The stages of one role are ordered among themselves: the skeleton of the code
    // comes before the full work.
    assert.deepEqual(list, [
        'iconify>styling',
        'markup>iconify',
        'markup>styling',
        'pre-coding>coding',
        'pre-coding>pre-styling',
        'pre-styling>styling',
        'styling>coding',
    ].sort());
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
    assert.ok(warnings.some((item) => /Стадия иконок перенесена после кода/.test(item)));
});

test('the phases of the styles and the code keep their order, even when the plan says the opposite', () => {
    const plan = {
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'] },
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['code-1'], files: ['src/styles/main.css'] },
        ],
    };
    const { stages, warnings } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    // The plan asked for the full code before the styles; the order of the phases wins.
    assert.ok(names.indexOf('pre-coding') < names.indexOf('pre-styling'), names.join(' → '));
    assert.ok(names.indexOf('pre-styling') < names.indexOf('styling'), names.join(' → '));
    assert.ok(names.indexOf('styling') < names.indexOf('coding'), names.join(' → '));
    assert.ok(warnings.some((item) => /противоречит фазам стилей и кода/.test(item)),
        warnings.join(' | '));
});

test('the icons are picked after the code, even when the plan says the opposite', () => {
    const { stages, warnings } = planOrder([...STAGES], PLAN);
    const names = stages.map((stage) => stage.name);
    // The plan asked for the icons before the styles; the floor of the stage wins.
    assert.ok(names.indexOf('iconify') > names.indexOf('styling'), names.join(' → '));
    assert.ok(names.indexOf('iconify') > names.indexOf('coding'), names.join(' → '));
    assert.ok(warnings.some((item) => /Стадия иконок перенесена после кода/.test(item)));
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

    // The icons before the code go after it: the code is written against the styles.
    const afterCode = placeIconifyStage(['markup', 'styling', 'iconify', 'coding', 'build', 'sight']);
    assert.equal(afterCode.moved, true);
    assert.ok(afterCode.names.indexOf('iconify') > afterCode.names.indexOf('coding'));
    assert.ok(afterCode.names.indexOf('iconify') < afterCode.names.indexOf('build'));
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
    // The floor of the styles wins here too: the styles are the contract the code follows.
    assert.ok(names.indexOf('styling') < names.indexOf('coding'));
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
    // The floor of the phases keeps the order: the skeleton of the code never goes
    // after the styles.
    assert.ok(names.indexOf('pre-coding') < names.indexOf('pre-styling'), names.join(' → '));
    assert.ok(names.indexOf('pre-styling') < names.indexOf('styling'), names.join(' → '));
    assert.ok(names.indexOf('styling') < names.indexOf('coding'), names.join(' → '));
});

test('the graphics are drawn before the page that links them', () => {
    // The registry itself: the vector stage stands before the markup.
    const registry = STAGES.map((stage) => stage.name);
    assert.ok(registry.indexOf('vector') < registry.indexOf('markup'));

    // The plan of the run: the assets come after the markup, and the phases of the
    // styles and the code keep their order.
    const { stages } = planOrder([...STAGES], ART_PLAN);
    const names = stages.map((stage) => stage.name);
    assert.ok(names.indexOf('vector') < names.indexOf('markup'), names.join(' → '));
    assert.ok(names.indexOf('markup') < names.indexOf('pre-coding'), names.join(' → '));
    assert.ok(names.indexOf('pre-coding') < names.indexOf('coding'), names.join(' → '));
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

test('the animation stands after the styles, even when the plan says the opposite', () => {
    // The plan asks for the motion before the styles: the floor of the stage wins.
    const plan = {
        steps: [
            { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['motion'], files: ['src/styles/main.scss'] },
            { id: 'motion', title: 'Motion', role: 'animator', dependsOn: [], files: ['src/styles/main.scss'] },
        ],
    };
    const { stages, warnings } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    assert.ok(names.indexOf('styling') < names.indexOf('animation'), names.join(' → '));
    assert.ok(warnings.some((item) => /Стадия анимации перенесена после стилиста/.test(item)));
});

test('the motion floor keeps the animation after the styles', () => {
    const placed = placeAnimationAfterStyles(['markup', 'animation', 'styling', 'coding']);
    assert.equal(placed.moved, true);
    assert.ok(placed.names.indexOf('animation') > placed.names.indexOf('styling'));
    assert.ok(placed.names.indexOf('animation') < placed.names.indexOf('coding'));

    // The animation after the styles stays where it is.
    const kept = placeAnimationAfterStyles(['markup', 'styling', 'animation', 'coding']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['markup', 'styling', 'animation', 'coding']);
});

test('the assets are placed after the markup, even when the plan says the opposite', () => {
    // The plan asks for the assets before the markup: the floor of the stage wins.
    const plan = {
        steps: [
            { id: 'place', title: 'Place the pictures', role: 'illustrator', dependsOn: [], files: ['assets/logo.png'] },
            { id: 'markup', title: 'Markup', role: 'markup', dependsOn: ['place'], files: ['index.html'] },
        ],
    };
    const { stages, warnings } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    assert.ok(names.indexOf('assets') > names.indexOf('markup'), names.join(' → '));
    assert.ok(warnings.some((item) => /Стадия ассетов перенесена после разметки/.test(item)));
});

test('a page with a state gets the same phases as a page without one', () => {
    // Порядок фаз один для всех: скелет кода, черновик стилей, полные стили, полный код.
    // Скелет растёт из разметки, стили одевают то, что скелет назвал.
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

    // Порядок фаз одинаковый: скелет кода, черновик стилей, полные стили, полный код.
    for (const names of [plainNames, appNames]) {
        assert.ok(names.indexOf('pre-coding') < names.indexOf('pre-styling'), names.join(' → '));
        assert.ok(names.indexOf('pre-styling') < names.indexOf('styling'), names.join(' → '));
        assert.ok(names.indexOf('styling') < names.indexOf('coding'), names.join(' → '));
    }
    assert.deepEqual(
        plainNames.filter((name) => ['pre-styling', 'pre-coding', 'styling', 'coding'].includes(name)),
        appNames.filter((name) => ['pre-styling', 'pre-coding', 'styling', 'coding'].includes(name)),
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
    const placed = placeAssetsAfterVector(['setup', 'assets', 'vector', 'markup']);
    assert.equal(placed.moved, true);
    assert.ok(placed.names.indexOf('assets') > placed.names.indexOf('vector'));

    // The assets after the vector stay where they are.
    const kept = placeAssetsAfterVector(['setup', 'vector', 'assets', 'markup']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['setup', 'vector', 'assets', 'markup']);
});

test('the assets do not stand before the markup: the circle of the plan is broken', () => {
    // План связал картинки с разметкой кругом (картинки ждут разметку, стили ждут
    // картинки): ассеты встают после разметки, и круг исчезает.
    const placed = placeAssetsAfterMarkup(['vector', 'assets', 'markup', 'styling']);
    assert.equal(placed.moved, true);
    assert.deepEqual(placed.names, ['vector', 'markup', 'assets', 'styling']);

    // Ассеты после разметки остаются где были.
    const kept = placeAssetsAfterMarkup(['vector', 'markup', 'assets', 'styling']);
    assert.equal(kept.moved, false);
    assert.deepEqual(kept.names, ['vector', 'markup', 'assets', 'styling']);
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
    const { stages, warnings } = planOrder([...STAGES], plan);
    const names = stages.map((stage) => stage.name);
    // Ассеты стоят после разметки, и стили идут после разметки: круг разорван.
    assert.ok(names.indexOf('assets') > names.indexOf('markup'), names.join(' → '));
    assert.ok(names.indexOf('markup') < names.indexOf('styling'), names.join(' → '));
    // План и так просит ассеты после разметки: перестраивать нечего.
    assert.ok(!warnings.some((item) => /Стадия ассетов/.test(item)),
        warnings.join(' | '));
});
