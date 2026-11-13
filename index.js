/**
 * @file index.js
 * @module index
 * @purpose Public entry of the package: the CLI entry and the programmatic API.
 * @ai.hint keep
 */
export { EXIT, main, parseArgv } from './src/cli.js';
export { HELP } from './src/help.js';
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
export * from './src/structure/structure.js';
export * from './src/stages/plan.js';
export * from './src/stages/collect.js';
export * from './src/stages/architect.js';
export * from './src/stages/setup.js';
export * from './src/agent/quality.js';
export * from './src/agent/pace.js';
export * from './src/openai/client.js';
export * from './src/openai/responses.js';
export * from './src/model/profiles.js';
