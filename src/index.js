/**
 * @file src/index.js
 * @module index
 * @purpose Barrel re-export: everything the CLI and the public API use.
 * @ai.hint keep
 */
export * from './cli.js';
export * from './help.js';
export * from './config.js';
export * from './agent/tool-specs.js';
export * from './agent/tools.js';
export * from './agent/bridges.js';
export * from './agent/skills.js';
export * from './agent/docs.js';
export * from './agent/mcp.js';
export * from './agent/schemas.js';
export * from './roles/index.js';
export * from './inputs/index.js';
export * from './inputs/design-md.js';
export * from './inputs/measurements.js';
export * from './inputs/palette.js';
export * from './inputs/tokens.js';
export * from './inputs/assets.js';
export * from './agent/paths.js';
export * from './agent/fs-tools.js';
export * from './agent/project-backup.js';
export * from './agent/diff.js';
export * from './agent/extract.js';
export * from './agent/map-scan.js';
export * from './agent/map.js';
export * from './agent/task-map.js';
export * from './agent/workspace-scan.js';
export * from './agent/assets.js';
export * from './agent/pace.js';
export * from './agent/quality.js';
export * from './openai/client.js';
export * from './openai/responses.js';
export * from './model/profiles.js';
