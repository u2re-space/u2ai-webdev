/**
 * Allowed values and shared literals of the configuration system.
 *
 * These enums are the contract between the parser, the validator and the
 * stages: a config value outside them is a user error and fails the load.
 *
 * @ai.hint legacy-0.2
 */

export const KiB = 1024;
export const MiB = 1024 * KiB;

/** Env prefix of this CLI (the monolith uses AI_*, ours is namespaced). */
export const ENV_PREFIX = 'AI_WEBDEV_';

export const ENUMS = Object.freeze({
  reasoningEfforts: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  reasoningSummaries: Object.freeze(['auto', 'concise', 'detailed']),
  reasoningModes: Object.freeze(['off', 'priority']),
  /** Word context levels; resolved to bytes by the model profile at load time. */
  contextLevels: Object.freeze({ small: 16 * KiB, normal: 96 * KiB, large: 512 * KiB, max: 8 * MiB }),
  contextWords: Object.freeze(['auto', 'small', 'normal', 'large', 'max']),
  /** Backend entries may declare which API routes the host serves. */
  backendRoutes: Object.freeze(['responses', 'chat']),
  /** Pipeline stages in execution order. */
  stages: Object.freeze([
    'collect', 'scan', 'pictures', 'plan', 'architect', 'setup',
    'markup', 'coding', 'styling', 'build', 'sight',
    'vector', 'iconify',
    'review', 'audit', 'learn',
  ]),
  /** The scopes of the records of the memory. */
  memoryScopes: Object.freeze(['global', 'project']),
  /** The markup the generator may write. */
  markupLanguages: Object.freeze(['html', 'jsx', 'tsx', 'vue', 'svelte']),
  /** The stylesheet language the generator may write. */
  styleLanguages: Object.freeze(['css', 'scss', 'less']),
  /** The script language the generator may write. */
  scriptLanguages: Object.freeze(['javascript', 'typescript']),
  /** The frameworks the scaffold may set up. */
  frontendFrameworks: Object.freeze(['vanilla', 'react', 'vue', 'svelte', 'next', 'astro', 'vite']),
  /** The icon sets the iconifier may pull. */
  iconSets: Object.freeze(['auto', 'phosphor', 'lucide']),
  /** The external CLIs this package may call. */
  bridges: Object.freeze(['decompose', 'measure', 'image']),
  /** How the pace dials move. */
  paceModes: Object.freeze(['auto', 'speed', 'quality']),
  /** The kinds of a generation task. */
  generationKinds: Object.freeze(['landing', 'site', 'backend', 'app', 'component']),
  /** The policy of the confirmations before the run writes into the project. */
  approvalLevels: Object.freeze(['ask', 'read', 'write', 'all']),
  /** How the files are taken out of the answers of the roles. */
  extractModes: Object.freeze(['off', 'auto', 'always']),
  /** The documentation sources a role may be given. */
  documentationSources: Object.freeze([
    'cssUnits', 'cssShapes', 'cssGrid', 'cssFlex', 'cssFonts', 'cssColors',
    'cssMotion', 'svg', 'htmlSemantics', 'a11y', 'wcagColors',
    'phosphorIcons', 'lucideIcons', 'googleFonts',
  ]),
});

/** The roles that always exist; user roles are validated against the schema only. */
export const BUILTIN_ROLE_NAMES = Object.freeze([
  'scanner', 'planner', 'architect', 'director', 'coder', 'markup', 'styler',
  'iconifier', 'installer', 'editor', 'reviewer', 'auditor', 'learner',
]);

/** Alias spellings accepted in backend `supports` maps. */
export const SUPPORT_ALIASES = Object.freeze({
  responseapi: 'responses', responses: 'responses',
  chatapi: 'chat', chat: 'chat', chatcompletions: 'chat', completions: 'chat',
});

/** RFC 7230 token characters for header names in backend entries. */
export const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
