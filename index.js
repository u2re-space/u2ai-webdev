/**
 * @file index.js
 * @module index
 * @purpose Public entry of the package: the CLI entry and the programmatic API.
 * @ai.hint keep
 */
export { EXIT, main, parseArgv, VALUE_FLAGS } from './src/cli.js';
export { HELP } from './src/help.js';
export * from './src/cli/colors.js';
export * from './src/cli/compatibility.js';
export * from './src/cli/stdio.js';
export * from './src/cli/renderer.js';
export * from './src/cli/run.js';
export * from './src/cli/jobs.js';
export * from './src/cli/memory.js';
export * from './src/config.js';
export * from './src/agent/tool-specs.js';
export * from './src/agent/tools.js';
export * from './src/agent/bridges.js';
export * from './src/agent/skills.js';
export * from './src/agent/docs.js';
export * from './src/agent/mcp.js';
export * from './src/agent/schemas.js';
export * from './src/roles/index.js';
export * from './src/inputs/index.js';
export * from './src/generate/brief.js';
export * from './src/generate/component.js';
export * from './src/registry.js';
export * from './src/cli/install.js';
export * from './src/cli/config.js';
export * from './src/structure/structure.js';
export * from './src/stages/plan.js';
export * from './src/stages/plan-order.js';
export * from './src/stages/collect.js';
export * from './src/stages/architect.js';
export * from './src/stages/setup.js';
export * from './src/stages/step.js';
export * from './src/stages/markup.js';
export * from './src/stages/coding.js';
export * from './src/stages/styling.js';
export * from './src/stages/build.js';
export * from './src/stages/vector.js';
export * from './src/stages/iconify.js';
export * from './src/vector/svg.js';
export * from './src/stages/review.js';
export * from './src/stages/audit.js';
export * from './src/stages/learn.js';
export * from './src/stages/index.js';
export * from './src/agent/work-plan.js';
export * from './src/pipeline.js';
export * from './src/jobs/manager.js';
export * from './src/memory.js';
export * from './src/agent/quality.js';
export * from './src/agent/pace.js';
export * from './src/openai/client.js';
export * from './src/openai/responses.js';
export * from './src/model/profiles.js';
