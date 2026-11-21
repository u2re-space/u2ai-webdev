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
 * reasoning (`xhigh`). The scanner reads the project and reports it: it works on
 * `medium`, because the files answer faster than the plans do. Every other stage works on
 * `high`: the code, the icons, the setup, the review and the audit answer on a model that
 * thinks long enough to be right, and the stages that only decide — the plan, the
 * architecture — pay for the seconds of the thinking on a plan that may be thrown away.
 */
export const STAGE_EFFORT = Object.freeze({
    scanner: 'medium',
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
  cssFonts: 'https://drafts.csswg.org/css-fonts/',
  cssText: 'https://drafts.csswg.org/css-text-4/',
  cssMasking: 'https://drafts.csswg.org/css-masking/',
  cssNesting: 'https://drafts.csswg.org/css-nesting/',
  cssSelectors: 'https://drafts.csswg.org/selectors/',
  cssUI: 'https://drafts.csswg.org/css-ui/',
  cssDisplay: 'https://drafts.csswg.org/css-display/',
  cssFlex: 'https://drafts.csswg.org/css-flexbox/',
  cssGrid: 'https://drafts.csswg.org/css-grid-3/',
  cssScrollSnap: 'https://drafts.csswg.org/css-scroll-snap-2/',
  cssScrollbars: 'https://drafts.csswg.org/css-scrollbars/',
  cssColors: 'https://drafts.csswg.org/css-color-5/',
  magickOptions: 'https://imagemagick.org/command-line-options/',
  magickTools: 'https://imagemagick.org/command-line-tools/',
  phosphorIcons: 'https://phosphoricons.com/',
  lucideIcons: 'https://lucide.dev/icons/',
  googleFonts: 'https://fonts.google.com/',
  wcagColors: 'https://w3c.github.io/wcag/guidelines/22/'
});

export const defaults = {
  // --- API -----------------------------------------------------------------
  /** Text model for the role agents. */
  model: 'family:gpt',
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

  // --- the house of the run ----------------------------------------------------
  /**
   * The model of the house for the roles that have one.
   *
   * A role that is named here does not answer on the model of the run: it answers on the
   * model of the house. The config may change every name of the map and may put a family
   * of models in its place (`family:gpt`); a role that is named with an empty value has no
   * model of its own and answers on the model of the run.
   */
  house: {
    models: {
      // The styles are the work of the best model of the family: the Sol writes them, the
      // Terra polishes them afterwards.
      styler: 'family:gpt',
      // The architecture decides the files, the modules and the order of the whole project.
      // The structure is the most expensive thing to change later, so the architect answers
      // with the head of the family too — the Sol, and not the model of the run.
      architect: 'family:gpt',
      // The vector graphics are drawn as text: the geometry of an isometric drawing and the
      // letters of a wordmark are the work of the best model of the family. A cheaper model
      // draws a floppy disk well and a wordmark with letters that do not spell anything.
      editor: 'family:gpt',
    },
    /**
     * The ladders of the ranks of the models of the house in their families.
     *
     * A ladder is a list of the places of the family: the role works with the head of it
     * and polishes what is already on the disk with the tail. The head of the ladder is
     * never lost for good: a stage that comes later starts at the head again, so the styles
     * can always be fixed with the model of the house.
     *
     * The ladder belongs to the role. A stage of the house never lowers the model of the
     * work on its own: the stage of the styles and the stage that fixes the styles answer
     * with the same model of the house.
     */
    ranks: {
      roles: {
        styler: [1, 0],
        // The architect only answers: there is nothing for it to polish on the disk, so it
        // stays on the head of the ladder.
        architect: [1],
        // The editor writes the SVG and then answers for it: the whole session of the
        // editor is the work of the model of the house.
        editor: [1],
      },
    },
  },
  /**
   * The families of models: a named list of interchangeable models, from the cheapest to
   * the most expensive.
   *
   * A family is named where a model is expected with the prefix `family:`: the run answers
   * with the cheapest member of the family that takes the effort of the role, and the rest
   * of the list is the ladder of the budget — the next member answers when the first one
   * refuses.
   */
  modelFamilies: {
    gpt: ['openai/gpt-6.1-terra', 'openai/gpt-6.2-sol'],
    gemini: ['google/gemini-4-hydrogen', 'google/gemini-4-neon'],
    claude: ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5'],
  },
  /**
   * The groups of models: a named list of models of one kind — the small and the budget
   * models of the house.
   *
   * The members of a group are peers: the one that fits the work answers. A member may name
   * the limit of the context it is trusted with (`maxContext`, in tokens): the member is not
   * asked when the context of the role is bigger than the limit.
   *
   * A group is named where a model is expected with the prefix `group:`.
   */
  modelGroups: {
    small: [
      { model: 'openai/gpt-6-luna' },
      { model: 'anthropic/claude-haiku-5.5', maxContext: 100_000 },
      { model: 'google/gemini-3.8-flash' },
      { model: 'minimax/minimax-m3.1-flash' },
      { model: 'z-ai/glm-5.3-flashx' },
    ],
  },

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
    /** Open the page of the project in a browser and take a screenshot of it. */
    browser: true,
    /** Compare two pictures of the project and measure the difference between them. */
    compare: true,
    /** Ask the operator a blocking question in interactive runs. */
    ask_user: true,
    /** Hand the work from one role to another, in a separate session. */
    delegate: true,
    /** Call the external `ai-decompose` CLI. */
    external_decompose: true,
    /** Call the external `ai-measure` CLI. */
    external_measure: true,
    /** Call the external `ai-image` CLI. */
    external_image: true,
    /** Run ImageMagick on the pictures of the project. */
    image_magick: true,
    /** Call any CLI of the house with the flags of its own command line. */
    external_cli: true,
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
    scan: { enabled: true, maxTurns: 10, timeoutMs: null },
    pictures: { enabled: true, maxTurns: 4, timeoutMs: null },
    architect: { enabled: true, maxTurns: 16, timeoutMs: null },
    setup: { enabled: true, maxTurns: 8, timeoutMs: null },
    markup: { enabled: true, maxTurns: 16, timeoutMs: null },
    coding: { enabled: true, maxTurns: 24, timeoutMs: null },
    styling: { enabled: true, maxTurns: 16, timeoutMs: null },
    build: { enabled: true, maxTurns: 1, timeoutMs: null },
    // The stage of the sight looks at the page and asks the styler to fix it, and it does
    // that twice: it needs more time than the stages that write the files.
    sight: { enabled: true, maxTurns: 16, timeoutMs: 30 * 60_000 },
    vector: { enabled: true, maxTurns: 8, timeoutMs: null },
    iconify: { enabled: true, maxTurns: 8, timeoutMs: null },
    // The review judges every step of the plan, repairs what it finds and judges the
    // repaired steps again. That is more work than the stages that write the files, and
    // a repair that runs out of its budget dies with the findings still on the disk.
    review: { enabled: true, maxTurns: 4, repair: true, repairRounds: 2, checkStyles: true, timeoutMs: 30 * 60_000 },
    audit: { enabled: true, maxTurns: 8, timeoutMs: null },
    learn: { enabled: true, maxTurns: 8, timeoutMs: null },
  },

  // --- browser ----------------------------------------------------------------
  /**
   * The browser of the run: the eyes of the stages.
   *
   * The styles of a page cannot be judged by the code that writes them. The run opens the page
   * of the project in a real browser, takes a screenshot of it and gives the picture to the
   * role that owns the styles, so it can see what it has written and compare it with the
   * reference of the design.
   *
   * The snapshot is taken by headless Chrome/Edge: it is read-only and it is on every desktop.
   * Ego Lite (`ego`) is the engine of the house with the window and the interaction; it is used
   * when it is asked for explicitly, because the ego lite hands the page to the session that is
   * already open and gives nothing back to a caller that waits for a snapshot.
   */
  browser: {
    /** `auto` takes the headless Chromium, `ego` demands the ego lite, `chrome` demands a Chromium. */
    engine: 'auto',
    /** The path of the browser, when the usual places do not hold it. */
    executable: null,
    /** How long one call of the browser may take, in milliseconds. */
    timeoutMs: 45_000,
    /** The frame of the picture of the page: the width and the height in pixels. */
    viewport: { width: 1440, height: 900 },
    /**
     * The live address of the page: `http://localhost:5173/` for the dev server of Vite.
     *
     * An empty address means that the run serves the project itself. A live address is
     * taken as it is: the styles there are the current ones, compiled by the bundler, so the
     * next picture shows the fix right away.
     */
    url: '',
    /**
     * Start the dev server of the project when the page is not served anywhere yet.
     *
     * `auto` starts it when the project has a `dev` script and nothing answers on the
     * address, `off` never starts it, `always` starts it every time.
     */
    devServer: 'auto',
    /** How long the run waits for the dev server to answer, in milliseconds. */
    devTimeoutMs: 60_000,
    /**
     * The stage of the styles takes a screenshot of the page and asks the styler to compare it
     * with the reference. `off` never shoots, `auto` shoots when the reference is there, `always`
     * shoots even without it.
     */
    stylingVision: 'auto',
    /** How many times the stage of the styles may look at the page and ask for a fix. */
    stylingVisionRounds: 2,
    /**
     * The comparison of the page with the reference of the design.
     *
     * `off` never compares, `auto` compares when the reference and ImageMagick are there,
     * `always` compares even without the reference.
     */
    compare: 'auto',
    /**
     * The PPI the house tries for the reference of the design.
     *
     * A picture of the design is a picture of a page, and a page is measured in CSS pixels
     * while the picture is measured in pixels of the picture: 1x, 1.5x, 2x and 3x are the
     * usual captures, and the house tries them one after another.
     */
    compareDprs: [1, 1.5, 2, 3],
    /**
     * Shoot the page at the width of the design, so the picture of the page and the picture of
     * the reference are the same size and are compared without a rescale.
     */
    compareAtDesignWidth: true,
    /**
     * The browser that answers: the Chrome DevTools MCP server of the house.
     *
     * `off` never starts it, `auto` starts it when the machine has Chrome and npm, `always`
     * starts it regardless. The server drives the real Chrome: the roles can take the
     * snapshot of the page, click, type, resize the window and run a script.
     */
    devtools: 'off',
    /** The package of the server: the version is pinned, so the run is the same every day. */
    devtoolsPackage: 'chrome-devtools-mcp@1.13.0',
    /** The command that starts the server. */
    devtoolsCommand: 'npx',
    /** The extra arguments of the server. */
    devtoolsArgs: [],
    /**
     * The tools of the server that the roles get.
     *
     * The list is short on purpose: every tool is a schema that travels with every request of
     * every turn. Empty means the list of the house.
     */
    devtoolsTools: [],
    /** How long one call of the server may take, in milliseconds. */
    devtoolsTimeoutMs: 120_000,
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
     * by default. A name here is passed to the CLI as `--image-model`. It is the only model
     * asked unless `pictures.models` explicitly names additional candidates.
     */
    model: null,
    /**
     * The models that prepare the pictures, one after another.
     *
     * By default only the first picture model is used. Naming models opts in to trying the
     * model list and keeping the better cut-out.
     *
     * One model is a lottery: the cut-out of the seedream is tight most of the time and the
     * cut-out of the sunburst of OpenAI is smoother the other times. The house asks the
     * models of this list and keeps the better cut-out — a real one first, then the tighter
     * edge, then the background that is really gone. Every model on the list is a paid call
     * for every crop, so the list is short.
     */
    models: [],
    /**
     * The tier of the quality the picture models are asked for.
     *
     * The field is `quality` in the body of the request, and the models that take it are the
     * gpt-image family of OpenAI: `high` is the tier of the model itself, `xhigh` is the step
     * above it. The models that know no such field never see it.
     */
    quality: 'high',
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
   *
   * `log` is the live log of the sibling CLI: its lines are shown while it works.
   * A bridge with `log: false` works in silence, and only its answer is read.
   */
  bridges: {
    decompose: { enabled: true, command: 'ai-decompose', timeoutMs: 10 * 60_000, log: true },
    measure: { enabled: true, command: 'ai-measure', timeoutMs: 10 * 60_000, log: true },
    image: { enabled: true, command: 'ai-image', timeoutMs: 10 * 60_000, log: true },
  },

  // --- roles ----------------------------------------------------------------
  /**
   * Per-role overrides. Model/effort resolution chain:
   * role -> roles.default -> top level. `instructions` are appended to the
   * role prompt; `tools` limits the tools of that role.
   */
  roles: {
    default: { model: null, effort: null, summary: null, maxEffort: null, context: null, temperature: null, maxOutputTokens: null, instructions: null, tools: null },
    scanner: {},
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
        'cssNesting', 'cssSelectors', 'cssUI', 'cssScrollSnap', 'cssScrollbars', 'cssColors',
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssUnits', 'cssAnimation', 'cssShapes',
        'cssMotion', 'cssTransform', 'cssCascade', 'cssContain', 'cssImages',
        'cssMasking', 'cssFonts', 'eslint', 'stylelint', 'prettier', 'cssText',
        'phosphorIcons', 'lucideIcons', 'googleFonts', 'cssGrid', 'cssFlex'
      ],
      director: [
        'cssNesting', 'cssSelectors', 'cssUI', 'cssScrollSnap', 'cssScrollbars', 'cssColors',
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssUnits', 'cssAnimation', 'cssShapes',
        'cssMotion', 'cssTransform', 'cssCascade', 'cssContain', 'cssImages',
        'cssMasking', 'cssFonts', 'eslint', 'stylelint', 'prettier', 'cssText',
        'phosphorIcons', 'lucideIcons', 'googleFonts', 'cssGrid', 'cssFlex'
      ],
      coder: [
        'cssNesting', 'cssSelectors', 'cssUI', 'cssScrollSnap', 'cssScrollbars',
        'cssUnits', 'cssGrid', 'cssFlex', 'htmlSemantics', 'a11y', 'cssColors',
        'mdnCss', 'mdnJavaScript', 'ecma262', 'typescript', 'sass', 'canIUse',
        'cssTricks', 'chromeStatus', 'cssLogical', 'cssProperty', 'cssLayer',
        'cssConditional', 'cssAnchor', 'cssAnimation', 'cssShapes', 'cssMotion',
        'cssTransform', 'cssCascade', 'cssContain', 'cssImages', 'cssMasking',
        'cssFonts', 'eslint', 'stylelint', 'prettier', 'phosphorIcons',
        'lucideIcons', 'googleFonts', 'cssGrid', 'cssFlex', 'cssText'
      ],
      markup: [
        'htmlSemantics', 'a11y', 'svg',
        'mdnCss', 'phosphorIcons', 'lucideIcons',
      ],
      styler: [
        'cssNesting', 'cssSelectors', 'cssUI', 'cssScrollSnap', 'cssScrollbars',
        'cssUnits', 'cssShapes', 'cssGrid', 'cssFlex', 'cssFonts', 'cssColors', 'wcagColors',
        'mdnCss', 'sass', 'canIUse', 'cssLogical', 'cssProperty', 'cssLayer', 'cssColors',
        'cssConditional', 'cssAnchor', 'cssAnimation', 'cssMotion', 'cssTransform',
        'cssCascade', 'cssContain', 'cssImages', 'cssMasking', 'stylelint',
        'prettier', 'googleFonts', 'cssGrid', 'cssFlex', 'cssText'
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
    browser: {
      engine: defaults.browser.engine,
      viewport: structuredClone(defaults.browser.viewport),
      stylingVision: defaults.browser.stylingVision,
    },
    agent: { fidelity: defaults.agent.fidelity, creativity: defaults.agent.creativity, platform: defaults.agent.platform },
    pace: { mode: defaults.pace.mode, speed: defaults.pace.speed, quality: defaults.pace.quality },
    house: { models: structuredClone(defaults.house.models), ranks: structuredClone(defaults.house.ranks) },
    modelFamilies: structuredClone(defaults.modelFamilies),
    modelGroups: structuredClone(defaults.modelGroups),
    stages: Object.fromEntries(ENUMS.stages.map((stage) => [stage, { enabled: true }])),
    bridges: {
      decompose: { enabled: defaults.bridges.decompose.enabled, log: defaults.bridges.decompose.log },
      measure: { enabled: defaults.bridges.measure.enabled, log: defaults.bridges.measure.log },
      image: { enabled: defaults.bridges.image.enabled, log: defaults.bridges.image.log },
    },
  };
  return `${JSON.stringify(starter, null, 2)}\n`;
}
