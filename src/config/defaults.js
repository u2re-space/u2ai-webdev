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
 * reasoning (`xhigh`). Every other stage works on `high`: the code, the icons, the
 * setup, the review and the audit answer on a model that thinks long enough to be
 * right, and the stages that only decide — the plan, the architecture — pay for the
 * seconds of the thinking on a plan that may be thrown away.
 */
export const STAGE_EFFORT = Object.freeze({
    planner: 'high',
    architect: 'high',
    director: 'high',
    coder: 'high',
    markup: 'xhigh',
    styler: 'xhigh',
    iconifier: 'high',
    installer: 'high',
    editor: 'high',
    reviewer: 'high',
    auditor: 'high',
    learner: 'high',
});

/**
 * The addresses of the pages of the documentation: the name of a source and its address.
 *
 * The name is the key by which a role gets the link: `documentation.roles.<role>` names the
 * sources, and `documentation.sources` holds their addresses. The map came from the monolith:
 * the addresses of the pages change slowly, and a role gets them once with its instructions.
 *
 * A user adds its own sources to the same section: a name that is not in the map is a link
 * of the user, and a name that is in the map replaces the address of the built-in one.
 */
export const DOCUMENTATION_SOURCES = Object.freeze({
  mdnCss: 'https://developer.mozilla.org/en-US/docs/Web/CSS',
  mdnJavaScript: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  ecma262: 'https://tc39.es/ecma262/',
  typescript: 'https://www.typescriptlang.org/docs/',
  sass: 'https://sass-lang.com/documentation/',
  eslint: 'https://eslint.org/docs/latest/',
  stylelint: 'https://stylelint.io/user-guide/',
  prettier: 'https://prettier.io/docs/',
  canIUse: 'https://caniuse.com/',
  cssTricks: 'https://css-tricks.com/',
  chromeStatus: 'https://chromestatus.com/',
  cssLogical: 'https://drafts.csswg.org/css-logical/',
  cssProperty: 'https://drafts.css-houdini.org/css-properties-values-api/',
  cssLayer: 'https://drafts.csswg.org/css-cascade-5/',
  cssConditional: 'https://drafts.csswg.org/css-conditional-5/',
  cssAnchor: 'https://drafts.csswg.org/css-anchor-position-2/',
  cssUnits: 'https://drafts.csswg.org/css-values-5/',
  cssAnimation: 'https://drafts.csswg.org/css-animations-2/',
  cssShapes: 'https://drafts.csswg.org/css-shapes-2/',
  cssMotion: 'https://drafts.csswg.org/motion/',
  cssTransform: 'https://drafts.csswg.org/css-transforms-2/',
  cssCascade: 'https://drafts.csswg.org/css-cascade-5/',
  cssContain: 'https://drafts.csswg.org/css-contain/',
  cssImages: 'https://drafts.csswg.org/css-images-5/',
  cssMasking: 'https://drafts.csswg.org/css-masking/',
  cssFonts: 'https://drafts.csswg.org/css-fonts/',
  magickOptions: 'https://imagemagick.org/command-line-options/',
  magickTools: 'https://imagemagick.org/command-line-tools/',
  phosphorIcons: 'https://phosphoricons.com/',
  lucideIcons: 'https://lucide.dev/icons/',
  googleFonts: 'https://fonts.google.com/',
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
    effort: 'high',
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
  /**
   * The models to try when the model of the run refuses the request.
   *
   * The key is the model that failed, the value is the list of the models that get the request
   * next; the key `*` is the chain of every other model. The chain of the house is the Kimi: it
   * answers with the reasoning off in a fraction of the time, so a run that met a refusal keeps
   * going. The Kimi is the fallback of the Gemini too — the two never stand in the same chain.
   */
  fallback: {
    enabled: true,
    models: {
      'google/gemini-4-hydrogen': ['moonshotai/kimi-k3.1-pro'],
      '*': ['moonshotai/kimi-k3.1-pro'],
    },
  },

  // --- logging ---------------------------------------------------------------
  /**
   * The log of the API calls: one JSON record per request.
   *
   * Off by default — the records are big, and a run that works does not need them. When a
   * chain misbehaves, they are the only witness: which host was asked, what went out, what
   * came back and where it broke.
   */
  logging: {
    enabled: false,
    /** Where the records are written, relative to the working directory. */
    dir: '.ai/logs/api',
  },

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
  // A stage may ask for a budget of its own: `timeoutMs` wins over `limits.stageTimeoutMs`.
  // The review with a repair asks for more time than the stages that write the files: it
  // reads every step, repairs what it finds and reads the repaired steps again.
  stages: {
    plan: { enabled: true, maxTurns: 12, timeoutMs: null },
    collect: { enabled: true, maxTurns: 8, timeoutMs: null },
    pictures: { enabled: true, maxTurns: 4, timeoutMs: null },
    architect: { enabled: true, maxTurns: 16, timeoutMs: null },
    setup: { enabled: true, maxTurns: 8, timeoutMs: null },
    markup: { enabled: true, maxTurns: 16, timeoutMs: null },
    coding: { enabled: true, maxTurns: 24, timeoutMs: null },
    styling: { enabled: true, maxTurns: 16, timeoutMs: null },
    build: { enabled: true, maxTurns: 1, timeoutMs: null },
    vector: { enabled: true, maxTurns: 8, timeoutMs: null },
    iconify: { enabled: true, maxTurns: 8, timeoutMs: null },
    review: { enabled: true, maxTurns: 12, repair: true, repairRounds: 2, checkStyles: true, timeoutMs: null },
    audit: { enabled: true, maxTurns: 8, timeoutMs: null },
    learn: { enabled: true, maxTurns: 8, timeoutMs: null },
  },

  /** Where the artifacts of a run are written, relative to cwd. */
  output: {
    /** The house of the project: .ai/ by default. */
    dir: './.ai',
    /**
     * The working directory of a run: `.ai/tmp/` by default.
     *
     * The state of a run lives in the house and dies with the run: `.ai/tmp/<run id>/`.
     * The path may be moved away, but it is one path, and it is computed in one place —
     * `shared/house.js`.
     */
    work: './.ai/tmp',
    /** The assets of the house: the pictures, the decorations, the crops. */
    assets: './.ai/assets',
  },

  // --- контекст прогона -------------------------------------------------------
  /**
   * Контекст прогона: что он сделал, что решил и какие ответы уже получил.
   *
   * Контекст живёт в `<output.work>/<id>/context/` и умирает вместе с прогоном. Это главное
   * знание прогона: новый прогон начинается с чистой головы, а старый не мешает новому.
   * Постоянная память проекта — другое дело: здесь лежит то, что знает *этот* прогон.
   */
  context: {
    /** Держать контекст прогона. */
    enabled: true,
    /** Помнить ответы инструментов, чтобы не спрашивать одно и то же дважды. */
    cache: true,
    /** Какой длины может быть сводка контекста, в знаках. */
    maxBriefChars: 4000,
  },

  // --- карта прогона ----------------------------------------------------------
  /**
   * Карта прогона: указатель на файлы рабочего каталога с их строками и их символами.
   * Поиск и чтение файлов, которые карта знает, не ходят на диск.
   *
   * Карта живёт в `<output.work>/<id>/map.json` и умирает вместе с прогоном: новый прогон
   * строит новую карту, и от старой ничего не течёт в новую.
   */
  map: {
    /** Строить и держать карту прогона. */
    enabled: true,
    /** Насколько глубоко карта заходит в каталоги. */
    depth: 8,
    /** Сколько файлов карта держит. */
    maxFiles: 2000,
    /** Самый большой файл, который карта читает целиком; больший ищется на диске. */
    maxFileBytes: 32 * 1024,
    /** Больше строк одного файла карта не держит; длинный ищется на диске. */
    maxLines: 400,
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
   *
   * Every path is a list of candidates: the first file that is there is the input of the
   * run. The root of the project comes first, and the directory of the measurer comes
   * second: the measurer writes its delivery into `measurements/`, and the run has to
   * find it there — otherwise it measures the same picture again.
   */
  inputs: {
    designMd: ['DESIGN.md', 'measurements/DESIGN.md'],
    measurements: ['measurements.json', 'measurements/measurements.json'],
    palette: ['palette.json', 'measurements/palette.json'],
    tokens: ['tokens.css', 'measurements/tokens.css'],
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
   * The documentation of the roles: the standards that live in the package and the
   * addresses of the pages behind them.
   *
   * A name in `roles` may name a standard (the texts of `agent/docs`) or a source (an
   * address of `sources`). A name that is both gives the role the rules and the page:
   * `cssUnits` is the rules of the units and the draft that defines them.
   */
  documentation: {
    /**
     * The addresses of the pages: the built-in map, which the config may extend or
     * override with a source of its own.
     */
    sources: { ...DOCUMENTATION_SOURCES },
    roles: {
      planner: [
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass',
        'canIUse', 'cssTricks', 'chromeStatus',
      ],
      architect: [
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssUnits', 'cssAnimation', 'cssShapes',
        'cssMotion', 'cssTransform', 'cssCascade', 'cssContain', 'cssImages',
        'cssMasking', 'cssFonts', 'eslint', 'stylelint', 'prettier',
        'phosphorIcons', 'lucideIcons', 'googleFonts',
      ],
      director: [
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssUnits', 'cssAnimation', 'cssShapes',
        'cssMotion', 'cssTransform', 'cssCascade', 'cssContain', 'cssImages',
        'cssMasking', 'cssFonts', 'eslint', 'stylelint', 'prettier',
        'phosphorIcons', 'lucideIcons', 'googleFonts',
      ],
      coder: [
        'cssUnits', 'cssGrid', 'cssFlex', 'htmlSemantics', 'a11y',
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssAnimation', 'cssShapes', 'cssMotion',
        'cssTransform', 'cssCascade', 'cssContain', 'cssImages', 'cssMasking',
        'cssFonts', 'eslint', 'stylelint', 'prettier', 'phosphorIcons',
        'lucideIcons', 'googleFonts',
      ],
      markup: [
        'htmlSemantics', 'a11y', 'svg',
        'mdnCss', 'phosphorIcons', 'lucideIcons',
      ],
      styler: [
        'cssUnits', 'cssShapes', 'cssGrid', 'cssFlex', 'cssFonts', 'cssColors', 'wcagColors',
        'mdnCss', 'sass', 'canIUse', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssAnimation', 'cssMotion', 'cssTransform',
        'cssCascade', 'cssContain', 'cssImages', 'cssMasking', 'stylelint',
        'prettier', 'googleFonts',
      ],
      iconifier: ['phosphorIcons', 'lucideIcons', 'googleFonts'],
      editor: ['svg', 'mdnCss', 'phosphorIcons', 'lucideIcons'],
      reviewer: ['mdnCss', 'cssTricks'],
      auditor: ['mdnCss'],
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
    reasoning: { effort: 'high', summary: 'auto' },
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
