/**
 * Default configuration of the webdev CLI.
 *
 * Shape mirrors the monolith's config minus everything this CLI does not have
 * (image generation, decomposition, raster editing). Every section listed here
 * is also the allow-list for user config files.
 *
 * @ai.hint legacy-0.2
 */

import { ENUMS } from './constants.js';

/**
 * The effort of every role of the run, by the stage it works in.
 *
 * The markup and the styles carry the look of the reference: they get the deepest
 * reasoning. The mechanical work — the scripts, the icons, the lessons — gets the
 * cheapest one. The planner and the architect stay in between: they decide, but they
 * do not build. A thinking model spends minutes on a high effort, so the stages that
 * only decide stay at `medium`.
 */
export const STAGE_EFFORT = Object.freeze({
    planner: 'medium',
    architect: 'medium',
    director: 'medium',
    coder: 'medium',
    markup: 'xhigh',
    styler: 'xhigh',
    iconifier: 'medium',
    installer: 'low',
    editor: 'medium',
    reviewer: 'medium',
    auditor: 'medium',
    learner: 'low',
});

export const defaults = {
  // --- API -----------------------------------------------------------------
  /** Text model for the role agents. */
  model: 'minimax/minimax-m3.1-flash',//'moonshotai/kimi-k3.1-pro',
  /** Endpoint of the text API; backends[] below can override it. */
  baseURL: 'https://routerai.ru/api/v1',
  apiKey: null,
  organization: null,
  project: null,
  /** Send `store: true` on API calls. */
  store: false,
  truncation: 'auto',
  verbosity: null,
  temperature: null,
  maxOutputTokens: null,
  /** Per-model ceilings: { "<model>": { window, maxOutput, ceiling } }. */
  models: {},
  reasoning: {
    /**
     * The ceiling of the reasoning effort of the run. A stage asks for the effort it
     * needs (`reasoning.stageEffort`), but never works above this ceiling.
     */
    effort: 'xhigh',
    summary: 'auto',
    mode: null,
    /**
     * The effort of every role, by the stage it works in. `null` turns the profile off
     * and leaves every role with the effort of `reasoning.effort`.
     */
    stageEffort: { ...STAGE_EFFORT },
  },
  retries: 3,
  /**
   * How long a request may stay silent before it is treated as dead.
   *
   * A thinking model works for minutes without a word. A short timeout does not make
   * the model faster: it throws away the whole reasoning and asks again. The ceiling
   * of the config is thirty minutes.
   */
  timeoutMs: 900_000,

  // --- HTTP backends -------------------------------------------------------
  /**
   * Ordered text-API hosts; the first usable one becomes the primary.
   * Entry: { baseURL, apiKey?, env?, headers?, body?, supports? }.
   * `env` is the environment variable name for the key (checked when apiKey
   * is not set).
   */
  backends: [
    { baseURL: 'https://routerai.ru/api/v1', env: 'ROUTERAI_API_KEY' },
    { baseURL: 'https://api.proxyapi.ru/v1', env: 'PROXYAPI_API_KEY' },
    { baseURL: 'https://sprutdock.ru/v1', env: 'SPRUTDOCK_API_KEY' },
    { baseURL: 'https://gptunnel.ru/v1', env: 'GPTUNNEL_API_KEY' },
  ],
  /** Per-model host lists: { "<model>": [{ baseURL, apiKey?, prefix?, vendor?, suffix?, type? }] }. */
  modelsBackends: {},
  fallback: { enabled: true, models: {} },

  // --- limits ---------------------------------------------------------------
  limits: {
    /** Wall-clock budget per stage. */
    stageTimeoutMs: 15 * 60_000,
    /** Agent-loop turns per role call. */
    maxTurns: 24,
    /** Retries per API request. */
    requestRetries: 3,
    /** Cap for {{file:...}} substitutions in config strings. */
    maxFileReadBytes: 256 * 1024,
    /** Cap of one tool answer that goes back into the context. */
    maxToolOutputBytes: 128 * 1024,
  },

  // --- tools ----------------------------------------------------------------
  tools: {
    read: true,
    write: true,
    list: true,
    search: true,
    /** Restructure a file or a range of it. */
    structure: true,
    /** Run a command in the project directory. */
    command: true,
    /** Run a script file in the project directory. */
    script: true,
    /** Fetch a page of the internet and read its text. */
    fetch: true,
    /** Generate and edit SVG as code. */
    svg: true,
    /** Download fonts from Google Fonts. */
    fonts: true,
    /** Download icon sets (Phosphor, Lucide). */
    icons: true,
    /** Read and run the skill packs. */
    skill: true,
    /** Search and read the guides of the modern web platform. */
    guidance: true,
    /** Call the external `ai-decompose` CLI. */
    external_decompose: true,
    /** Call the external `ai-measure` CLI. */
    external_measure: true,
    /** Call the external `ai-image` CLI. */
    external_image: true,
  },

  // --- the stack the generator writes for ------------------------------------
  stack: {
    /** The framework the scaffold sets up. */
    frontendFramework: 'vanilla',
    /** The markup the generator writes. */
    markupLanguage: 'html',
    /** The stylesheet language the generator writes. */
    styleLanguage: 'scss',
    /** The script language the generator writes. */
    scriptLanguage: 'javascript',
    /** The icon set the iconifier pulls. */
    iconSet: 'auto',
  },

  // --- generation knobs ------------------------------------------------------
  agent: {
    /** How close the result must be to the reference: 0..100. */
    fidelity: 70,
    /** How far the result may go from the reference: 0..100. */
    creativity: 30,
    /** The web platform profile the result must run on. */
    platform: 'chromium',
    /** The kind of the task: landing | site | backend | app | component. */
    kind: 'app',
    /**
     * The policy of the confirmations before the run writes into the project:
     * ask (ask in a terminal, read without one), read (write nothing), write (the
     * files of the answers are written), all (the files and the commands).
     */
    approve: 'write',
    /**
     * How the files are taken out of the answers of the roles: off (nothing is
     * written, the files stay in the report), auto (the files are written when the
     * role gives them), always (the same as auto for this package).
     */
    extract: 'auto',
    /** Tool turns the planner may spend. */
    plannerMaxTurns: 12,
    /** Tool turns the architect may spend. */
    architectMaxTurns: 16,
    /** Tool turns one coding step may spend. */
    coderMaxTurns: 24,
  },

  // --- pace ------------------------------------------------------------------
  /**
   * The team pace: speed and quality are 0..100, mode auto follows those
   * numbers. The per-stage dials never move on their own.
   */
  pace: {
    mode: 'auto',
    speed: 50,
    quality: 50,
    codeQuality: 50,
    decorQuality: 50,
    architectQuality: 50,
    iconifierQuality: 50,
    reviewerQuality: 50,
  },

  // --- stages -----------------------------------------------------------------
  stages: {
    plan: { enabled: true, maxTurns: 12 },
    collect: { enabled: true, maxTurns: 8 },
    pictures: { enabled: true, maxTurns: 4 },
    architect: { enabled: true, maxTurns: 16 },
    setup: { enabled: true, maxTurns: 8 },
    markup: { enabled: true, maxTurns: 16 },
    coding: { enabled: true, maxTurns: 24 },
    styling: { enabled: true, maxTurns: 16 },
    build: { enabled: true, maxTurns: 1 },
    vector: { enabled: true, maxTurns: 8 },
    iconify: { enabled: true, maxTurns: 8 },
    review: { enabled: true, maxTurns: 12 },
    audit: { enabled: true, maxTurns: 8 },
    learn: { enabled: true, maxTurns: 8 },
  },

  /** Where the artifacts of a run are written, relative to cwd. */
  output: {
    /** The project artifacts: .ai/ by default. */
    dir: './.ai',
    /** The working directory of a run: .tmp/ by default. */
    work: './.tmp',
  },

  // --- pictures -----------------------------------------------------------------
  /**
   * The crops of the reference that are pictures: the chess piece, the board, the badge.
   *
   * The sheet of the measurements names the crops of the elements and of the regions. A crop
   * is a rectangle of the reference: the page around it is still in the picture. The stage
   * `pictures` prepares the crops that are pictures with the sibling CLI `ai-image`, so the
   * roles get an asset instead of a screenshot.
   */
  pictures: {
    /** Prepare the crops with `ai-image`. */
    enabled: true,
    /** The kinds of the crops that are prepared. */
    kinds: ['image', 'illustration', 'artwork', 'photo', 'ornament'],
    /** The command of `ai-image`: background | alpha | trim | edit. */
    command: 'background',
    /** The command of a kind, when it differs from the command above. */
    commands: {},
    /** The prompt of the command `edit`, by kind. */
    prompts: {},
    /**
     * What the cut-out has to keep: the subject of the picture.
     *
     * `{name}` is the name of the item in the sheet of the measurements, `{use}` is its
     * use, `{kind}` is its kind. The words that name the kind of the cut (`artwork`,
     * `picture`, `region`) are dropped: they describe the crop, not the object.
     */
    subject: '{name}',
    /** The subject of a kind, when it differs from the subject above. */
    subjects: {},
    /** The mode of the alpha channel: auto | mask | contour | flat | key | off. */
    alphaMode: 'auto',
    /**
     * The model that prepares the pictures.
     *
     * `null` keeps the model of the configuration of `ai-image` — the seedream of ByteDance
     * by default. A name here is passed to the CLI as `--image-model`.
     */
    model: null,
    /** Where the prepared pictures land, relative to the project. */
    dir: 'assets/import',
    /** How many pictures one run prepares. */
    max: 6,
  },

  // --- inputs ------------------------------------------------------------------
  /**
   * The files a run may read as its input: the design direction, the sheet of
   * measurements, the palette and the tokens.
   */
  inputs: {
    designMd: 'DESIGN.md',
    measurements: 'measurements.json',
    palette: 'palette.json',
    tokens: 'tokens.css',
    /**
     * The files with the essence of the task: the notes the run reads before it starts.
     *
     * The paths are relative to the root of the project. The flag `--input` writes this
     * list for one run; the file may be given many times.
     */
    extra: [],
    /** Read the project instructions (AGENTS.md, CLAUDE.md). */
    projectInstructions: true,
    /**
     * The reference of the design: the screenshot the roles have to look at.
     *
     * `null` → the reference is found by the name: a file the task names, a file that says
     * that it is a reference (`landing`, `reference`, `screenshot`, `mockup`, `design`), or a
     * file of `.ai/refs/`. A path (or a list of paths) names the reference outright.
     */
    reference: null,
  },

  // --- memory ------------------------------------------------------------------
  /**
   * The permanent memory of the CLI: the lessons of the runs, the summaries of the
   * files and the finished tasks. `dbFile` is null → <home>/memory.db.
   */
  memory: {
    /** The database of the memory: a path or null for the one of the home. */
    dbFile: null,
    /** The scope of the records: global or project. */
    scope: 'project',
    /** How many records go into the context of the roles. */
    limit: 40,
    /** Keep the summaries of the files. */
    files: true,
    /** Keep the finished tasks. */
    tasks: true,
  },

  // --- components ---------------------------------------------------------------
  /**
   * The local component registry: a directory of sources and a SQLite index.
   * `dir` and `dbFile` are null → <home>/components and <home>/components.db.
   */
  components: {
    dir: null,
    dbFile: null,
    /** Where a component lands inside the target project. */
    vendorDir: 'vendor/components',
    /** Suggest the registry components in a generation brief. */
    autoReuse: true,
  },

  // --- the external CLIs ---------------------------------------------------------
  /**
   * The bridges to the sibling CLIs. Each one may be switched off; a bridge
   * that fails never breaks the run, it only empties its part of the context.
   */
  bridges: {
    decompose: { enabled: true, command: 'ai-decompose', timeoutMs: 10 * 60_000 },
    measure: { enabled: true, command: 'ai-measure', timeoutMs: 10 * 60_000 },
    image: { enabled: true, command: 'ai-image', timeoutMs: 10 * 60_000 },
  },

  // --- roles ----------------------------------------------------------------
  /**
   * Per-role overrides. Model/effort resolution chain:
   * role -> roles.default -> top level. `instructions` are appended to the
   * role prompt; `tools` limits the tools of that role.
   */
  roles: {
    default: { model: null, effort: null, summary: null, maxEffort: null, context: null, temperature: null, maxOutputTokens: null, instructions: null, tools: null },
    planner: {},
    architect: {},
    director: {},
    coder: {},
    markup: {},
    styler: {},
    iconifier: {},
    installer: {},
    editor: {},
    reviewer: {},
    auditor: {},
    learner: {},
  },

  /** Extra named roles merged into the role registry at load. */
  customRoles: {},

  // --- documentation ----------------------------------------------------------
  /**
   * The standards a role is given as documentation: CSS units, CSS shapes,
   * the icon sets, the WCAG colour rules. The coder needs them to write the
   * markup and the styles; the styler needs them to name the tokens.
   */
  documentation: {
    roles: {
      coder: ['cssUnits', 'cssGrid', 'cssFlex', 'htmlSemantics', 'a11y'],
      markup: ['htmlSemantics', 'a11y', 'svg', 'phosphorIcons', 'lucideIcons'],
      styler: ['cssUnits', 'cssShapes', 'cssGrid', 'cssFlex', 'cssFonts', 'cssColors', 'wcagColors'],
      iconifier: ['phosphorIcons', 'lucideIcons'],
    },
  },

  // --- MCP ------------------------------------------------------------------
  /**
   * External tool servers. Each entry is either `{ name, url }` for an HTTP
   * server or `{ name, command, args }` for a server started over stdio.
   */
  mcp: { servers: [] },

  /** Output root for role skills (read-only skill packs per role). */
  skills: { dir: null },
};

/** Allowed fields of one `roles.<name>` entry (null = inherited). */
export const ROLE_FIELDS = Object.freeze([
  'model', 'effort', 'summary', 'maxEffort', 'context', 'temperature',
  'maxOutputTokens', 'instructions', 'tools',
]);

export function cloneDefaults() {
  return structuredClone(defaults);
}

/**
 * Starter file written to ~/.ai-webdev/config.json on first run: only the
 * fields a user is expected to edit; everything else stays on the defaults.
 */
export function defaultConfigText() {
  const starter = {
    model: defaults.model,
    reasoning: { effort: 'xhigh', summary: 'auto' },
    backends: structuredClone(defaults.backends),
    stack: structuredClone(defaults.stack),
    agent: { fidelity: defaults.agent.fidelity, creativity: defaults.agent.creativity, platform: defaults.agent.platform },
    pace: { mode: defaults.pace.mode, speed: defaults.pace.speed, quality: defaults.pace.quality },
    stages: Object.fromEntries(ENUMS.stages.map((stage) => [stage, { enabled: true }])),
    bridges: {
      decompose: { enabled: defaults.bridges.decompose.enabled },
      measure: { enabled: defaults.bridges.measure.enabled },
      image: { enabled: defaults.bridges.image.enabled },
    },
  };
  return `${JSON.stringify(starter, null, 2)}\n`;
}
