# План перехода: Universal-AI (монолит 0.2.xx) → @u2ai/webdev (0.3.xx)

> Актуальный статус: **план создан, шаги ещё не начаты**.
> Рабочий дом переносимого кода: `submodules/u2ai-webdev/`.
> Репозиторий: <https://github.com/u2re-space/u2ai-webdev> (remote настроен, пуш не делаем).
>
> Родственники: `submodules/u2ai-decomposer/` (`@u2ai/decomposer`, CLI `ai-decompose`),
> `submodules/u2ai-images/` (`@u2ai/images`, CLI `ai-image`),
> `submodules/u2ai-measurer/` (`@u2ai/measurer`, CLI `ai-measure`) — из них берутся
> конфиг-система, openai-слой, агентный слой (tools/skills/MCP) и мосты к внешним CLI,
> чтобы четыре пакета не расходились по стилю.

---

## 0. Цели и рамки

**Цель:** выделить из монолитного CLI `ai` всю веб-разработку — кодинг, разметку,
стили, генерацию и подготовку кода, компоненты, библиотеки, иконки, фреймворки,
план, архитектуру, установку, сбор контекста, ревью и аудит — в самостоятельный
CLI `ai-webdev` (`@u2ai/webdev`) с собственным конфигом `~/.ai-webdev`.

**Рамки нового пакета:**

| Параметр | Значение |
|---|---|
| Имя пакета | `@u2ai/webdev` |
| Бинарь | `ai-webdev` (`bin/ai-webdev.{js,cmd,ps1,sh}`) |
| Репозиторий | <https://github.com/u2re-space/u2ai-webdev> |
| Версия | 0.3.0-alpha |
| Конфиг | `~/.ai-webdev/` — каталог: `config.json`, `skills/`, `components/`, `memory.db`, `components.db` (оверрайд `AI_WEBDEV_HOME`) |
| Префикс env | `AI_WEBDEV_*` (совместимость с `OPENAI_*`, `AI_MODEL`) |
| Runtime | Node.js >= 26, ESM, без SDK (чистый `fetch`) |
| Зависимости | `@modelcontextprotocol/node` (остальное — только встроенные модули Node) |
| Внешние CLI | `ai-decompose`, `ai-measure`, `ai-image` — вызываются как подпроцессы, каждый включается/выключается в конфиге |

**Что переносим, а что — нет:**

| Переносим | Не переносим |
|---|---|
| Роли `planner`, `architect`, `coder`, `styler`, `iconifier`, `installer`, `reviewer` (плюс новые `markup`, `auditor`, `editor`, `learner`) | Роли монолита, не связанные с вебом: `classifier`, `clicker`, `typer`, `solver`, `encoder`, `decomposer`, `measurer`, `designer`, `image-processor` |
| Генератор: бриф задачи, скаффолд стека, платформа, fidelity/creativity, референсы | Генератор и редактор изображений — их нет в пакете, только вызов внешнего `ai-image` |
| Система компонентов: контракт `.ai/component.json`, `custom-elements.json`, README-API, локальный реестр с SQLite-индексом | Публикация в npm из пакета (остаётся действием пользователя) |
| Подготовка кода: структура файла, сортировка импортов, реструктуризация CSS/SCSS | `browser`/`browser_drive` (ego-browser) — остаётся в монолите |
| Инструменты агента: fs, дифф, извлечение, бэкап проекта, сканирование воркспейса, карта, качество, темп | Инструменты изображений монолита (`crop_image`, `split_image`, `compare_images`, `alpha`, `magick`, `raster`) |
| SVG как код: генерация и правка векторной графики, загрузка шрифтов и наборов иконок | Растровая обработка изображений — её делает `ai-image` |
| Стадии: `plan`, `collect`, `architect`, `setup`, `markup`, `coding`, `styling`, `vector`, `iconify`, `review`, `audit` | Стадии `decompose`, `measure`, `design`, `images` — их делают `ai-decompose` и `ai-measure` |
| Процесс-менеджмент: план работ с прогрессом на диске, пауза/возобновление, фоновые задачи, восстановление после обрыва | Команды монолита: `ask`, `chat`, `image`, `channels`, `telegram`, `serve`, `complete` |
| Постоянная память: SQLite + FTS5, факты, соглашения, решения, сводки файлов, завершённые задачи | Модельные профили картинок (`seedream`, `gpt-image`) — остаются в `@u2ai/images` |
| Скиллы (`~/.ai-webdev/skills/*.md`) и документация стандартов (CSS units, shapes, WCAG) | `skills-lock.json` монолита и его экосистема |

**Карта источников монолита:**

| Файл монолита | Файл нового пакета | Что забираем |
|---|---|---|
| `src/roles/planner.js` | `src/roles/planner.js` | промпт плана работ и его структура |
| `src/roles/architect.js` | `src/roles/architect.js` | промпт архитектуры: модули, структура файлов, бриф для ролей |
| `src/roles/coder.js` | `src/roles/coder.js` | промпт генерации кода по одному шагу |
| `src/roles/styler.js` | `src/roles/styler.js` | промпт CSS/SCSS по одному шагу |
| `src/roles/iconifier.js` | `src/roles/iconifier.js` | промпт подбора и интеграции иконок |
| `src/roles/installer.js` | `src/roles/installer.js` | промпт подготовки окружения и зависимостей |
| `src/roles/reviewer.js` | `src/roles/reviewer.js` | промпты ревью: проверка результата, vision-разбор изображений |
| `src/roles/decorator.js` | `src/roles/editor.js` | промпт декоративного слоя (переименован: «редактор» шире) |
| `src/roles/orchestrator.js`, `src/roles/worker.js` | `src/roles/director.js` | разбор шага плана, делегирование и сбор отчёта |
| `src/agent/roles.js`, `src/agent/role-registry.js` | `src/roles/index.js` | резолв ролей, их модели, цикл вызовов с инструментами |
| `src/agent/schemas.js` | `src/agent/schemas.js` | строгие JSON-схемы ответов ролей |
| `src/agent/tool-specs.js` | `src/agent/tool-specs.js` | каталог инструментов веб-разработки и их схемы |
| `src/agent/tools.js` (веб-часть) | `src/agent/tools.js` | исполнитель инструментов: fs, структура, запуск, шрифты, иконки, SVG |
| `src/agent/fs-tools.js`, `src/agent/paths.js` | `src/agent/fs-tools.js`, `src/agent/paths.js` | безопасная работа с файлами, запрет выхода за пределы каталога |
| `src/agent/diff.js`, `src/agent/extract.js` | `src/agent/diff.js`, `src/agent/extract.js` | диффы и извлечение фрагментов кода |
| `src/agent/project-backup.js` | `src/agent/project-backup.js` | бэкап и откат файлов перед крупной правкой |
| `src/agent/workspace-scan.js`, `src/agent/task-map.js`, `src/agent/map.js` | `src/agent/workspace-scan.js`, `src/agent/task-map.js`, `src/agent/map.js` | обзор проекта, карта символов, `.ai/map.json` |
| `src/agent/work-plan.js` | `src/agent/work-plan.js` | план работ, прогресс на диске, пауза/возобновление, продолжение шага |
| `src/agent/quality.js`, `src/agent/pace.js` | `src/agent/quality.js`, `src/agent/pace.js` | уровни качества и темп (speed/quality) по стадиям |
| `src/agent/skills.js` | `src/agent/skills.js` | поиск `SKILL.md` в `.agents/skills`, `.koda/skills`, `.claude/skills`, `~/.agents/skills` |
| `src/agent/mcp.js` | `src/agent/mcp.js` | подключение MCP-серверов из конфига и доступ к их инструментам |
| `src/generate/brief.js` | `src/generate/brief.js` | бриф генерации: вид задачи, выходы, ограничения, манифест |
| `src/generate/scaffold.js` | `src/generate/scaffold.js` | стек, `package.json`, рекомендации, безопасное слияние скаффолда |
| `src/generate/platform.js` | `src/generate/platform.js` | замороженный профиль веб-платформы |
| `src/generate/fidelity.js` | `src/generate/fidelity.js` | цели fidelity и creativity |
| `src/generate/references.js` | `src/generate/references.js` | эталонизация референсов в `.ai/refs/` |
| `src/generate/component.js` | `src/generate/component.js` | контракт компонента `.ai/component.json`, имена, манифест, README-API |
| `src/structure/imports.js` | `src/structure/imports.js` | сортировка блока импортов и имён внутри них |
| `src/structure/structure.js` | `src/structure/structure.js` | структурные задачи по файлу и диапазону |
| `src/structure/style.js` | `src/structure/style.js` | сортировка, группировка, дедупликация и слои CSS/SCSS |
| `src/agent/assets.js` | `src/agent/assets.js` | генерация SVG, загрузка шрифтов Google Fonts, загрузка наборов иконок |
| `src/core/registry.js` | `src/registry.js` | локальный реестр компонентов: каталог + SQLite-индекс, поиск, установка |
| `src/core/memory.js` | `src/memory.js` | постоянная память: SQLite + FTS5, виды и области видимости |
| `src/core/session.js`, `src/core/attachments.js`, `src/core/agents-md.js` | `src/core/session.js`, `src/core/attachments.js`, `src/core/agents-md.js` | сессия, вложения (изображения, `DESIGN.md`), инструкции проекта |
| `src/jobs/manager.js` | `src/jobs/manager.js` | фоновые отсоединённые задачи: список, ожидание, отмена, удаление |
| `src/agent/pipeline.js` | `src/stages/index.js`, `src/pipeline.js` | каталог стадий, их порядок и зависимости |
| `src/commands/gen.js`, `src/commands/run.js` | `src/cli.js` | разбор argv, диспетчер команд, коды возврата |
| `src/commands/component.js`, `src/commands/install.js` | `src/cli.js` (`component`, `install`) | команды реестра компонентов и установки в проект |
| `src/commands/jobs.js`, `src/commands/memory.js`, `src/commands/map.js` | `src/cli.js` (`jobs`, `memory`, `map`) | команды процесс-менеджмента, памяти и карты проекта |
| `src/cli-help.js` | `src/help.js` | тексты справки (на английском) |
| `src/core/config-defaults.js` (ключи `frontendFramework`, `scriptLanguage`, `styleLanguage`, `markupLanguage`, `iconSet`, `components.*`, `pace.*`, `pipeline`) | `src/config/defaults.js` | ключи конфига и их значения |
| `src/commands/flags.js` (флаги веб-части) | `src/cli.js`, `src/help.js` | `--pace`, `--quality`, `--fidelity`, `--creativity`, `--platform`, `--frontend-*`, `--icon-set`, `--stop-after`, `--route`, `--context`, `--detail`, `--role`, `--summary`, `--extract`, `--approve` |

### 1.1. Что добавляем сверх монолита

Каркас `submodules/u2ai-webdev/src/` (пустые файлы) задаёт архитектуру; часть
модулей в нём ещё не существует и создаётся по ходу шагов:

| Новый модуль | Назначение |
|---|---|
| `src/inputs/` | разбор входных данных: `DESIGN.md`, `measurements.json`, `palette.json`, `tokens.css`, референсы и ассеты |
| `src/generate/` | бриф, скаффолд, платформа, fidelity, референсы (из монолита) |
| `src/structure/` | структура, импорты, стили (из монолита) |
| `src/agent/tool-specs.js`, `src/agent/schemas.js` | каталоги инструментов и схемы ролей |
| `src/agent/work-plan.js` | план работ и прогресс на диске (пауза/возобновление) |
| `src/memory.js`, `src/registry.js` | постоянная память и реестр компонентов |
| `src/jobs/manager.js` | фоновые задачи и восстановление после обрыва |
| `src/pipeline.js` | оркестратор стадий и точек восстановления |

Косметика каркаса: файл `src/roles/archititor.js` переименовывается в
`src/roles/architect.js` (в каркасе опечатка; файлы пустые, конфликта не будет).

### 1.2. Входные данные

`ai-webdev` работает не только с текстом задачи, но и с готовыми артефактами:

| Вход | Источник | Что делаем |
|---|---|---|
| `DESIGN.md` | `ai-measure` (стадия `design`) | читаем визуальное направление: палитру, типографику, шкалу отступов, компоненты; конфликты — в отчёт и в ревью |
| `measurements.json` | `ai-measure` (стадия `measure`) | геометрия, боксы, размеры, единицы → используются в разметке и стилях |
| `palette.json`, `tokens.css` | `ai-measure` | цвета и готовые токены; при конфликте — приоритет `tokens.css` |
| Кропы и референсы | `.tmp/<id>/crops/`, `.ai/refs/` | подсказки для разметки и стилей; кроп — вход для `vector` (SVG как код) |
| Изображения-ассеты | каталог проекта, вложения | визуальный контекст ролей `reviewer`/`iconifier` через vision |
| `AGENTS.md` / `CLAUDE.md` | корень проекта | локальные инструкции проекта подмешиваются в промпты ролей |
| `package.json` проекта | корень проекта | определяем фреймворк, скрипты, линтер; влияет на скаффолд и `setup` |
| Реестр компонентов | `~/.ai-webdev/components` | подбор и переиспользование готовых компонентов (`components.autoReuse`) |

### 1.3. Мосты к внешним CLI

Каждый мост включается и выключается в конфиге (`bridges.*.enabled`) и флагом
(`--no-decompose`, `--no-measure`, `--no-image`). Мост = подпроцесс, ошибка моста
не роняет пайплайн, а пишется в отчёт стадии.

| Мост | Что зовём | Когда | Артефакты на входе |
|---|---|---|---|
| `ai-decompose` | `ai-decompose decompose <ref…>` | есть референс-скриншот, нужен разбор на экраны | кропы в `.tmp/<id>/crops/` |
| `ai-measure` | `ai-measure measure <ref…>` / `ai-measure design "<task>"` | нужен лист измерений или визуальное направление | `measurements.json`, `DESIGN.md`, `palette.json`, `tokens.css` |
| `ai-image` | `ai-image <prompt>` (генерация), `ai-image edit` | нужны растровые ассеты, которых нет среди референсов | файлы в `.ai/assets/` |

Векторная графика — единственная графика, которую пакет делает сам: SVG
генерируется и правится как код (`generate_svg`, `vectorize_image` → текстовый SVG).

### 1.4. Процесс, память и восстановление

| Механизм | Где живёт | Что даёт |
|---|---|---|
| План работ | `.tmp/<id>/plan.json` | декомпозиция задачи на шаги, порядок и зависимости |
| Прогресс | `.tmp/<id>/progress.json` | состояние каждого шага, файлы, отчёты, модель |
| Пауза | флаг `paused` в `progress.json` + остановка на границе шага | `ai-webdev pause <id>` |
| Возобновление | `ai-webdev resume <id> [--from N]` | продолжение с нужного шага, с контекстом прошлых шагов |
| Восстановление после обрыва | `progress.json` + `.tmp/<id>/lock` | `ai-webdev resume --list` показывает незавершённые работы |
| Фоновые задачи | `~/.ai-webdev/jobs/*.json` + отсоединённый процесс | `ai-webdev jobs list|follow|wait|cancel|rm` |
| Постоянная память | `~/.ai-webdev/memory.db` (SQLite + FTS5) | факты, соглашения, решения, сводки файлов, завершённые задачи |
| Реестр компонентов | `~/.ai-webdev/components.db` + `~/.ai-webdev/components/` | поиск, показ, установка, удаление компонентов |
| Ролевая память | запись в `memory.db` по завершении стадии | следующий заход помнит решения и находки |

### 1.5. Поверхность CLI `ai-webdev`

| Команда | Что делает |
|---|---|
| `ai-webdev run "<task>"` | полный автономный прогон: план → сбор → архитектура → setup → разметка → код → стили → иконки → ревью |
| `ai-webdev plan "<task>"` | только план работ, без кода |
| `ai-webdev build` | код без планирования (план уже есть) |
| `ai-webdev markup` / `code` / `style` | отдельные стадии разметки, кода и стилей |
| `ai-webdev review` | ревью текущего состояния проекта |
| `ai-webdev audit` | аудит структуры, доступности и производительности |
| `ai-webdev init [dir]` | создать заготовку проекта под выбранный стек |
| `ai-webdev component list\|search\|show\|publish\|rm` | локальный реестр компонентов |
| `ai-webdev install <component>` | положить компонент из реестра в проект как `file:`-пакет |
| `ai-webdev icons "<query>"` | подобрать и скачать иконки (Phosphor, Lucide) |
| `ai-webdev svg "<prompt>"` | сгенерировать SVG-код |
| `ai-webdev fonts "<name>"` | скачать шрифт из Google Fonts |
| `ai-webdev structure <file>` | структурные задачи по файлу |
| `ai-webdev style <file>` | сортировка и группировка CSS/SCSS |
| `ai-webdev pause <id>` / `resume <id>` / `status` | управление процессом |
| `ai-webdev jobs list\|follow\|wait\|cancel\|rm` | фоновые задачи |
| `ai-webdev memory list\|search\|add\|rm` | постоянная память |
| `ai-webdev map` | перестроить `.ai/map.json` |
| `ai-webdev skills` | список доступных скилл-паков |
| `ai-webdev docs` | документация стандартов и форматов |
| `ai-webdev config show\|path\|check` | конфиг |
| `ai-webdev models` | профили моделей и их лимиты |

---

## 1. Шаги

### step-1 — Каркас пакета и лаунчеры
- [ ] `package.json` (`@u2ai/webdev`, бинарь `ai-webdev`, Node >= 26, ESM, зависимости)
- [ ] `bin/ai-webdev.{js,cmd,ps1,sh}`
- [ ] `index.js` — публичный точечный вход
- [ ] `scripts/check-syntax.mjs` — разбор всех файлов пакета
- [ ] `.gitignore` (без `package-lock.json`)
- [ ] Каркас каталогов `src/{cli,help,index}.js`, `src/agent`, `src/cli`, `src/config`,
      `src/core`, `src/generate`, `src/inputs`, `src/jobs`, `src/model`, `src/openai`,
      `src/roles`, `src/structure`, `src/stages`

### step-2 — Система конфигурации `~/.ai-webdev`
- [ ] `src/config/constants.js` — enum'ы (стадии, языки разметки/стилей/скриптов, фреймворки, наборы иконок, режимы мостов)
- [ ] `src/config/defaults.js` — дефолты: API, лимиты, инструменты, стадии, роли, темп и качество, `components.*`, `bridges.*`, `pipeline`
- [ ] `src/config/env.js` — `AI_WEBDEV_*` → поля конфига
- [ ] `src/config/paths.js` — `~/.ai-webdev`, `config.json`, `skills/`, `components/`, `memory.db`, `components.db`, `jobs/`
- [ ] `src/config/merge.js`, `src/config/parser.js` — merge, JSON, `{{env:}}`/`{{file:}}`
- [ ] `src/config/validate.js` — проверки с русскими сообщениями
- [ ] `src/config/index.js`, `src/config.js` — загрузка, `ensureConfigFile`, `redactConfig`

### step-3 — OpenAI-слой
- [ ] `src/openai/http.js` — транспорт: бэкенды, ретраи, таймауты, редиректы
- [ ] `src/openai/api.js` — тело запроса, заголовки, `purpose`/роль
- [ ] `src/openai/responses.js` — Responses-запрос: `imagePart` (vision), строгий JSON, текст
- [ ] `src/openai/chat.js` — запасной транспорт Chat Completions
- [ ] `src/openai/fallback.js` — цепочка моделей и их откат
- [ ] `src/openai/client.js` — клиент: ротация бэкендов, ретраи, `responses.create`
- [ ] `src/model/profiles.js` — профили моделей, reasoning-усилие, лимиты контекста, цены

### step-4 — Агентный слой: инструменты
- [ ] `src/agent/paths.js` — пути внутри рабочего каталога, запрет секретов
- [ ] `src/agent/tool-specs.js` — каталог инструментов веба и их схемы
- [ ] `src/agent/tools.js` — исполнитель: `list_files`, `read_file`, `write_file`, `copy_path`,
      `replace_text`, `delete_file`, `make_dir`, `search_files`, `list_backups`,
      `restore_backup`, `structure_file`, `run_command`, `run_script`, `fetch_url`,
      `generate_svg`, `vectorize_image`, `download_font`, `download_icons`,
      `read_skill`, `run_skill`, `call_ai_decompose`, `call_ai_measure`, `call_ai_image`
- [ ] `src/agent/fs-tools.js` — безопасные файловые операции
- [ ] `src/agent/diff.js`, `src/agent/extract.js` — диффы и извлечение фрагментов
- [ ] `src/agent/project-backup.js` — бэкап и откат
- [ ] `src/agent/workspace-scan.js`, `src/agent/task-map.js`, `src/agent/map.js` — обзор проекта и карта символов
- [ ] `src/agent/quality.js`, `src/agent/pace.js` — уровни качества и темп

### step-5 — Скиллы, документация и MCP
- [ ] `src/agent/skills.js` — чтение скилл-паков из `~/.ai-webdev/skills` и `skills.dir`,
      frontmatter, инъекция подсказок в роли
- [ ] `src/agent/docs.js` — тексты стандартов (CSS units, CSS shapes, WCAG colors, SVG, a11y)
- [ ] `src/agent/mcp.js` — подключение MCP-серверов из конфига, доступ к их инструментам

### step-6 — Схемы ответов ролей
- [ ] `src/agent/schemas.js` — `PLAN_SCHEMA`, `ARCHITECTURE_SCHEMA`, `CODE_SCHEMA`,
      `STYLE_SCHEMA`, `MARKUP_SCHEMA`, `ICON_SCHEMA`, `SETUP_SCHEMA`, `REVIEW_SCHEMA`
- [ ] Проверка схем на строгость (все поля обязательны, лишние запрещены)

### step-7 — Роли
- [ ] `src/roles/untrusted.js` — общая директива о недоверенных данных
- [ ] `src/roles/planner.js` — план работ: шаги, зависимости, критерии готовности
- [ ] `src/roles/architect.js` — структура модулей и бриф для ролей (файл `archititor.js` переименовать)
- [ ] `src/roles/director.js` — разбор шага, делегирование, сбор отчёта
- [ ] `src/roles/coder.js` — генерация кода по одному шагу
- [ ] `src/roles/markup.js` — разметка: семантика, доступность, атрибуты
- [ ] `src/roles/styler.js` — CSS/SCSS по одному шагу
- [ ] `src/roles/iconifier.js` — подбор и интеграция иконок
- [ ] `src/roles/installer.js` — подготовка окружения и зависимостей
- [ ] `src/roles/editor.js` — декоративный слой и правки по месту
- [ ] `src/roles/reviewer.js` — ревью результата и vision-разбор
- [ ] `src/roles/auditor.js` — аудит структуры, a11y, производительности
- [ ] `src/roles/learner.js` — извлечение уроков в постоянную память
- [ ] `src/roles/index.js` — резолв ролей и цикл вызовов с инструментами и скиллами

### step-8 — Входные данные
- [ ] `src/inputs/design-md.js` — разбор `DESIGN.md`: палитра, типографика, шкала, компоненты, конфликты
- [ ] `src/inputs/measurements.js` — разбор `measurements.json`: боксы, размеры, юниты, регионы
- [ ] `src/inputs/palette.js`, `src/inputs/tokens.js` — `palette.json` и `tokens.css`
- [ ] `src/inputs/assets.js` — референсы, кропы, изображения-ассеты, `AGENTS.md`
- [ ] `src/inputs/index.js` — сводный контекст задачи для ролей

### step-9 — Генератор: бриф, скаффолд, платформа, fidelity, референсы
- [ ] `src/generate/brief.js` — бриф генерации: вид задачи (`landing|site|backend|app|component`), выходы, ограничения, манифест
- [ ] `src/generate/scaffold.js` — стек, `package.json`, рекомендации, безопасное слияние скаффолда
- [ ] `src/generate/platform.js` — замороженный профиль веб-платформы
- [ ] `src/generate/fidelity.js` — цели fidelity и creativity
- [ ] `src/generate/references.js` — эталонизация референсов в `.ai/refs/`

### step-10 — Компоненты: контракт и локальный реестр
- [ ] `src/generate/component.js` — контракт `.ai/component.json`, теги и классы, `custom-elements.json`, README-API
- [ ] `src/registry.js` — реестр: каталог + SQLite-индекс, поиск, показ, публикация, удаление
- [ ] Установка в проект как `file:`-пакет (`src/cli.js`: `install`)

### step-11 — Подготовка кода
- [ ] `src/structure/imports.js` — сортировка блока импортов и имён внутри них
- [ ] `src/structure/structure.js` — структурные задачи по файлу и диапазону
- [ ] `src/structure/style.js` — сортировка, группировка, дедупликация и слои CSS/SCSS

### step-12 — Стадии `plan`, `collect`, `architect`, `setup`
- [ ] `src/stages/plan.js` — план работ по шагам, запись в `.tmp/<id>/plan.json`
- [ ] `src/stages/collect.js` — сбор контекста: входные данные, проект, реестр компонентов, скиллы
- [ ] `src/stages/architect.js` — модульная структура и бриф для ролей
- [ ] `src/stages/setup.js` — окружение, зависимости, фреймворк, проверка готовности

### step-13 — Стадии `markup`, `coding`, `styling`
- [ ] `src/stages/markup.js` — разметка по плану и брифу
- [ ] `src/stages/coding.js` — код по шагу плана
- [ ] `src/stages/styling.js` — стили по шагу плана, токены и `DESIGN.md`

### step-14 — Стадия `vector` и `iconify`
- [ ] `src/stages/vector.js` — SVG как код: генерация, правка, оптимизация, выгрузка в проект
- [ ] `src/stages/iconify.js` — подбор иконок, скачивание набора, интеграция в разметку

### step-15 — Стадии `review`, `audit`, `learn`
- [ ] `src/stages/review.js` — проверка результата по критериям шага, vision-проверка скриншотов
- [ ] `src/stages/audit.js` — аудит структуры, доступности, производительности, зависимостей
- [ ] `src/stages/learn.js` — извлечение уроков и фактов в постоянную память

### step-16 — План работ, прогресс и процесс-менеджмент
- [ ] `src/agent/work-plan.js` — план, прогресс на диске, `recordStep`, `applyPlanUpdate`, `resolveResumeStep`
- [ ] `src/stages/index.js` — реестр стадий, их порядок, зависимости и точки восстановления
- [ ] `src/pipeline.js` — оркестратор стадий, пауза на границе шага, продолжение после обрыва
- [ ] `src/jobs/manager.js` — фоновые отсоединённые задачи: список, ожидание, отмена, удаление

### step-17 — Постоянная память и реестр компонентов
- [ ] `src/memory.js` — SQLite + FTS5: виды (`fact`, `convention`, `decision`, `preference`, `pitfall`, `summary`, `note`), области (`global`, `project`), сводки файлов, завершённые задачи
- [ ] Связка памяти со стадиями: запись находок, чтение в контекст ролей

### step-18 — CLI `ai-webdev` и рендерер
- [ ] `src/cli/colors.js`, `src/cli/compatibility.js`, `src/cli/stdio.js` — цвета, проверка версии Node, работа со stdout/stderr
- [ ] `src/cli/renderer.js` — рендер событий: план, стадии, файлы, инструменты, предупреждения, прогресс
- [ ] `src/cli.js` — разбор argv, диспетчер команд, коды возврата, флаги
- [ ] `src/help.js` — справка на английском языке

### step-19 — Тесты
- [ ] `test/config.test.js` — конфиг, валидация, русские сообщения
- [ ] `test/tools.test.js` — инструменты агента, запись только в разрешённые каталоги, запрет выхода за пределы проекта
- [ ] `test/roles.test.js` — резолв ролей, схемы, цикл вызовов
- [ ] `test/inputs.test.js` — разбор `DESIGN.md`, `measurements.json`, `palette.json`, `tokens.css`
- [ ] `test/structure.test.js` — сортировка импортов, структура файла, CSS/SCSS
- [ ] `test/component.test.js` — контракт компонента, реестр, установка
- [ ] `test/memory.test.js` — SQLite-память, поиск, области
- [ ] `test/process.test.js` — план, прогресс, пауза/возобновление, восстановление после обрыва, jobs
- [ ] `test/cli.test.js` — разбор argv, коды возврата, локальные команды
- [ ] `test/stages.test.js` — стадии на локальном мокк-хосте (`node:http`)

### step-20 — README и релиз-чеклист
- [ ] `README.md` — установка, команды, примеры, формат конфига, мосты, входные данные
- [ ] Затухание в монолите: `ai gen`/`ai run` веб-части делегируют в `ai-webdev`
- [ ] Чеклист релиза: `npm run check`, `npm test`, `npm pack --dry-run`, версия, репозиторий

---

## 2. Порядок работы и зависимости шагов

```
step-1 ─┬─ step-2 ─┬─ step-3 ─┬─ step-4 ─┬─ step-5
        │          │          │          └─ step-6 ─┬─ step-7 ─┬─ step-8 ─┬─ step-9 ─┬─ step-10
        │          │          │                     │          │          │          │        │
        │          │          │                     │          │          │          │        └─ step-11
        │          │          │                     │          │          │          │
        │          │          │                     │          │          └──────────┴─ step-12 ─┬─ step-13 ─┬─ step-14 ─┬─ step-15
        │          │          │                     │          │                            │           │           │           │
        │          │          │                     │          │                            └───────────┴───────────┴───────────┴─ step-16 ── step-17
        │          │          │                     │          │                                                                  │
        │          │          │                     │          └──────────────────────────────────────────────────────────┴─ step-18 ── step-19 ── step-20
        └──────────┴──────────┴─────────────────────┴─────────────────────────────────────────────────────────────── step-20
```

Обязательные предшественники:

| Шаг | Требует |
|---|---|
| step-4 | step-2 (список разрешённых инструментов), step-3 (вызовы ролей) |
| step-7 | step-4 (инструменты), step-5 (скиллы), step-6 (схемы) |
| step-8 | step-2 (пути входа), step-4 |
| step-12 | step-7, step-8, step-9 |
| step-13 | step-7, step-11 (структура и стили), step-12 |
| step-14 | step-4 (`generate_svg`, `download_icons`), step-13 |
| step-15 | step-7, step-13 |
| step-16 | step-12, step-13, step-14, step-15 |
| step-17 | step-2 (пути), step-15 |
| step-18 | step-16, step-17 |
| step-19 | всё выше |
| step-20 | step-19 |

---

## 3. Риски и заметки

1. **Объём ролей.** Двенадцать ролей — это много промптов. Планируем портировать
   дословно там, где поведение важно (`coder`, `styler`, `iconifier`, `installer`,
   `reviewer`), и сокращать там, где монолит дублировал (`orchestrator`/`worker`
   сворачиваются в `director`, `decorator` становится `editor`).
2. **Строгие схемы против свободного кода.** Роль `coder` в монолите отдаёт свободный
   текст с файлами. Для нового пакета код выносится в отдельный канал (файлы
   записываются инструментом `write_file`), а в JSON-схеме остаётся только отчёт.
3. **`structure_file` и `run_command` — опасные инструменты.** Их вызовы требуют
   явного разрешения в конфиге (`tools.allow`) и проверки риска команды; в тестах
   путь выполнения ограничен временным каталогом.
4. **Мосты к внешним CLI.** Мост не должен ронять пайплайн: ошибка внешнего CLI
   пишется в отчёт стадии, стадия переходит в состояние `skipped`, а пайплайн
   продолжает работу без этих данных.
5. **SQLite.** `node:sqlite` требует Node >= 22; в пакете закреплён Node >= 26,
   поэтому `memory.db` и `components.db` пишутся без внешних зависимостей.
6. **SVG как код.** Растровые операции (растеризация, alpha, compare) в пакет не
   портируются: это зона `ai-image`. Вектор правится текстом: правки идут через
   `replace_text`, результат проверяется разбором SVG.
7. **Темп и качество.** Пороги `pace` и `quality` переносятся из монолита, но
   числа пересчитываются под новый набор стадий; в конфиге остаётся одно место
   для правки (`pace.*`).
8. **Пуш не делаем.** Remote настроен, но репозиторий остаётся локальным, как и
   у `u2ai-decomposer`, `u2ai-images` и `u2ai-measurer`.

---

## 4. Правила работы

1. Каждый шаг — отдельный коммит с сообщением `step-N: <что сделано>`; в этом же
   коммите галочки соответствующего шага в `planned.md` отмечаются.
2. Пуш не делаем: remote настроен, но репозиторий остаётся локальным.
3. Тексты CLI и README — на английском; сообщения валидации конфига — на русском
   (как в `u2ai-decomposer`, `u2ai-images` и `u2ai-measurer`).
4. Файлы, портированные из монолита, помечаются тегом `@ai.hint legacy-0.2`.
5. Внешние CLI (`ai-decompose`, `ai-measure`, `ai-image`) вызываются как
   подпроцессы; генерации картинок и растровой обработки внутри пакета нет.
6. Стиль кода совпадает с соседними пакетами: JSDoc-карточка с `@file`, `@module`,
   `@purpose`, `@depends`, `@usedBy`, `@exports`, `@ai.tags`, `@ai.hint`, `@changed`;
   4 пробела, одинарные кавычки, `export const`/`export function`.
