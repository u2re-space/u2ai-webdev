# План перехода: Universal-AI (монолит 0.2.xx) → @u2ai/webdev (0.3.xx)

> Актуальный статус: **шаги 1–20 выполнены** — каркас, конфигурация, openai-слой,
> агентный слой, скиллы, MCP, схемы, роли, входные данные, генератор, контракт компонента,
> локальный реестр, подготовка кода, все стадии (`plan`, `collect`, `architect`, `setup`,
> `markup`, `coding`, `styling`, `vector`, `iconify`, `review`, `audit`, `learn`), реестр
> стадий, план работ, прогресс, пауза/возобновление, фоновые задачи, постоянная память,
> CLI `ai-webdev`, рендерер и тесты на месте; README написан, монолит переведён на делегирование
> (`ai gen` и веб-часть `ai run` → `ai-webdev`), релиз-чеклист пройден.
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
| Инструменты агента: fs, дифф, извлечение, бэкап проекта, сканирование воркспейса, карта, качество, темп | Инструменты изображений монолита (`crop_image`, `split_image`, `alpha`, `raster`) — кроме сверки: `compare_images` и `magick` перенесены (step-92) |
| SVG как код: генерация и правка векторной графики, загрузка шрифтов и наборов иконок | Растровая обработка изображений — её делает `ai-image` (кроме сверки страницы с референсом — step-92) |
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

Каталог `src/shared/` каркаса остаётся под общие помощники (текст, пути, формат);
имена ролей и стадий в каркасе совпадают с планом.

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
| `ai-webdev skills list\|search\|show\|path\|rm` | скилл-паки: список, поиск, текст, путь, удаление (только паки проекта) |
| `ai-webdev docs` | документация стандартов и форматов |
| `ai-webdev config show\|path\|check` | конфиг |
| `ai-webdev models` | профили моделей и их лимиты |

---

## 1. Шаги

### step-1 — Каркас пакета и лаунчеры
- [x] `package.json` (`@u2ai/webdev`, бинарь `ai-webdev`, Node >= 26, ESM, зависимости)
- [x] `bin/ai-webdev.{js,cmd,ps1,sh}`
- [x] `index.js` — публичный точечный вход
- [x] `scripts/check-syntax.mjs` — разбор всех файлов пакета
- [x] `.gitignore` (без `package-lock.json`)
- [x] Каркас каталогов `src/{cli,help,index}.js`, `src/agent`, `src/cli`, `src/config`,
      `src/core`, `src/generate`, `src/inputs`, `src/jobs`, `src/model`, `src/openai`,
      `src/roles`, `src/shared`, `src/structure`, `src/stages`
- [x] `src/cli.js` и `src/help.js` — заготовка: только `--help` и `--version`
      (полная поверхность команд приходит в step-18)

### step-2 — Система конфигурации `~/.ai-webdev`
- [x] `src/config/constants.js` — enum'ы (стадии, языки разметки/стилей/скриптов, фреймворки, наборы иконок, режимы мостов)
- [x] `src/config/defaults.js` — дефолты: API, лимиты, инструменты, стадии, роли, темп и качество, `components.*`, `bridges.*`, `pipeline`
- [x] `src/config/env.js` — `AI_WEBDEV_*` → поля конфига
- [x] `src/config/paths.js` — `~/.ai-webdev`, `config.json`, `skills/`, `components/`, `memory.db`, `components.db`, `jobs/`
- [x] `src/config/merge.js`, `src/config/parser.js` — merge, JSON, `{{env:}}`/`{{file:}}`
- [x] `src/config/validate.js` — проверки с русскими сообщениями
- [x] `src/config/index.js`, `src/config.js` — загрузка, `ensureConfigFile`, `redactConfig`

### step-3 — OpenAI-слой
- [x] `src/openai/http.js` — транспорт: бэкенды, ретраи, таймауты, редиректы
- [x] `src/openai/api.js` — ошибки API (`ApiError`), разбор SSE, редуктор потока, чтение usage
- [x] `src/openai/responses.js` — Responses-запрос: `imagePart` (vision), строгий JSON, текст
- [x] `src/openai/chat.js` — запасной транспорт Chat Completions
- [x] `src/openai/fallback.js` — цепочка моделей и их откат
- [x] `src/openai/client.js` — клиент: ротация бэкендов, ретраи, `responses.create`
- [x] `src/model/profiles.js` — профили моделей, reasoning-усилие, лимиты контекста, цены
- [x] Слой перенесён из `u2ai-measurer` (тот же openai-слой), проверен на локальном
      мокк-хосте `node:http`

### step-4 — Агентный слой: инструменты
- [x] `src/agent/paths.js` — пути внутри рабочего каталога, запрет секретов
- [x] `src/agent/tool-specs.js` — каталог инструментов веба и их схемы
- [x] `src/agent/tools.js` — исполнитель: `list_files`, `read_file`, `write_file`, `copy_path`,
      `replace_text`, `delete_file`, `make_dir`, `search_files`, `list_backups`,
      `restore_backup`, `run_command`, `run_script`, `fetch_url`,
      `generate_svg`, `download_font`, `download_icons`,
      `call_ai_decompose`, `call_ai_measure`, `call_ai_image`
      (`structure_file` — в step-11, `read_skill`/`run_skill` — в step-5;
      растр не векторизуется: картинки — работа мостов)
- [x] `src/agent/fs-tools.js` — безопасные файловые операции
- [x] `src/agent/diff.js`, `src/agent/extract.js` — диффы и извлечение фрагментов
- [x] `src/agent/project-backup.js` — бэкап и откат
- [x] `src/agent/workspace-scan.js`, `src/agent/task-map.js`, `src/agent/map.js` — обзор проекта и карта символов
- [x] `src/agent/quality.js`, `src/agent/pace.js` — уровни качества и темп
- [x] `src/agent/assets.js` — SVG, шрифты и наборы иконок
- [x] `src/agent/bridges.js` — мосты к `ai-decompose`, `ai-measure`, `ai-image`:
      каждый выключается, падение моста не ломает запуск
- [x] `src/util/text.js` — общие помощники текста и чисел
- [x] Проверка: запись, чтение, замена, бэкап и откат, отказ записи вне каталога,
      выключенный мост, `fetch_url` на локальном мокк-хосте

### step-5 — Скиллы, документация и MCP
- [x] `src/agent/skills.js` — чтение скилл-паков из `~/.ai-webdev/skills` и `skills.dir`,
      frontmatter, инъекция подсказок в роли
- [x] `src/agent/docs.js` — тексты стандартов (CSS units, CSS shapes, WCAG colors, SVG, a11y)
- [x] `src/agent/mcp.js` — подключение MCP-серверов из конфига, доступ к их инструментам
- [x] Инструменты `read_skill` и `run_skill` (команда пака — в frontmatter)
- [x] Проверка: ролевые паки, `SKILL.md` проекта, документация роли, MCP-сервер
      на локальном мокк-хосте и недоступный сервер

### step-6 — Схемы ответов ролей
- [x] `src/agent/schemas.js` — `PLAN_SCHEMA`, `ARCHITECTURE_SCHEMA`, `CODE_SCHEMA`,
      `STYLE_SCHEMA`, `MARKUP_SCHEMA`, `ICON_SCHEMA`, `SETUP_SCHEMA`, `REVIEW_SCHEMA`
- [x] Проверка схем на строгость (все поля обязательны, лишние запрещены)

### step-7 — Роли
- [x] `src/roles/untrusted.js` — общая директива о недоверенных данных
- [x] `src/roles/planner.js` — план работ: шаги, зависимости, критерии готовности
- [x] `src/roles/architect.js` — структура модулей и бриф для ролей (файл `architector.js` переименован)
- [x] `src/roles/director.js` — разбор шага, делегирование, сбор отчёта
- [x] `src/roles/coder.js` — генерация кода по одному шагу
- [x] `src/roles/markup.js` — разметка: семантика, доступность, атрибуты
- [x] `src/roles/styler.js` — CSS/SCSS по одному шагу
- [x] `src/roles/iconifier.js` — подбор и интеграция иконок
- [x] `src/roles/installer.js` — подготовка окружения и зависимостей
- [x] `src/roles/editor.js` — декоративный слой и правки по месту
- [x] `src/roles/reviewer.js` — ревью результата и vision-разбор
- [x] `src/roles/auditor.js` — аудит структуры, a11y, производительности
- [x] `src/roles/learner.js` — извлечение уроков в постоянную память
- [x] `src/roles/index.js` — резолв ролей и цикл вызовов с инструментами и скиллами
- [x] Проверка: резолв роли, инструкции со стандартами и паками, цикл с инструментами
      на локальном мокк-хосте, остановка по лимиту ходов, падение инструмента

### step-8 — Входные данные
- [x] `src/inputs/design-md.js` — разбор `DESIGN.md`: палитра, типографика, шкала, компоненты, конфликты
- [x] `src/inputs/measurements.js` — разбор `measurements.json`: боксы, размеры, юниты, регионы
- [x] `src/inputs/palette.js`, `src/inputs/tokens.js` — `palette.json` и `tokens.css`
- [x] `src/inputs/assets.js` — референсы, кропы, изображения-ассеты, `AGENTS.md`
- [x] `src/inputs/index.js` — сводный контекст задачи для ролей
- [x] Проверка: разбор всех четырёх форматов, перевод пикселей в rem, контраст палитры, приоритет `tokens.css`, пропуск отсутствующих входов как предупреждения

### step-9 — Генератор: бриф, скаффолд, платформа, fidelity, референсы
- [x] `src/generate/brief.js` — бриф генерации: вид задачи (`landing|site|backend|app|component`), выходы, ограничения, манифест
- [x] `src/generate/scaffold.js` — стек, `package.json`, рекомендации, безопасное слияние скаффолда
- [x] `src/generate/platform.js` — замороженный профиль веб-платформы
- [x] `src/generate/fidelity.js` — цели fidelity и creativity
- [x] `src/generate/references.js` — эталонизация референсов в `.ai/refs/`
- [x] Проверка: бриф и манифест, файлы по стеку, `package.json`, рекомендации по словам задачи,
      слияние манифеста без перезаписи, замороженный профиль платформы, staging референсов

### step-10 — Компоненты: контракт и локальный реестр
- [x] `src/generate/component.js` — контракт `.ai/component.json`, теги и классы, `custom-elements.json`, README-API
- [x] `src/registry.js` — реестр: каталог + SQLite-индекс, поиск, показ, публикация, удаление
- [x] Установка в проект как `file:`-пакет (`src/cli.js`: `install`)
- [x] Проверка: нормализация контракта, имена тега и класса, манифест custom elements, README-API,
      публикация и поиск в реестре, установка в проект и регистрация `file:`-зависимости

### step-11 — Подготовка кода
- [x] `src/structure/imports.js` — сортировка блока импортов и имён внутри них
- [x] `src/structure/structure.js` — структурные задачи по файлу и диапазону
- [x] `src/structure/style.js` — сортировка, группировка, дедупликация и слои CSS/SCSS
- [x] Проверка: группы импортов, директивы, диапазон правки, дедупликация, слияние и группировка
      правил, слои, запись файла, запрет выхода за пределы проекта

### step-12 — Стадии `plan`, `collect`, `architect`, `setup`
- [x] `src/stages/workspace.js` — каталог прогона `.tmp/<id>/`, json-файлы стадий
- [x] `src/stages/plan.js` — план работ по шагам, запись в `.tmp/<id>/plan.json`
- [x] `src/stages/collect.js` — сбор контекста: входные данные, проект, реестр компонентов, скиллы
- [x] `src/stages/architect.js` — модульная структура и бриф для ролей
- [x] `src/stages/setup.js` — окружение, зависимости, фреймворк, проверка готовности
- [x] Проверка: нормализация плана и порядок шагов, файл плана, сбор контекста, нормализация
      архитектуры по перечислениям, применение зависимостей и скриптов, готовность проекта

### step-13 — Стадии `markup`, `coding`, `styling`
- [x] `src/stages/step.js` — общий прогон шага плана: выбор шагов по роли, запись файлов, отчёт
- [x] `src/stages/markup.js` — разметка по плану и брифу
- [x] `src/stages/coding.js` — код по шагу плана
- [x] `src/stages/styling.js` — стили по шагу плана, токены и `DESIGN.md`
- [x] Проверка: выбор шагов по роли, запись файлов без перезаписи, запрет выхода за проект,
      отчёт шага, ориентиры разметки, блок токенов

### step-14 — Стадия `vector` и `iconify`
- [x] `src/vector/svg.js` — разбор, проверка и чистка SVG как кода
- [x] `src/stages/vector.js` — SVG как код: генерация, правка, оптимизация, выгрузка в проект
- [x] `src/stages/iconify.js` — подбор иконок, скачивание набора, интеграция в разметку
- [x] Проверка: разбор SVG, поиск ошибок, чистка без правки рисунка, проверка иконок на диске

### step-15 — Стадии `review`, `audit`, `learn`
- [x] `src/stages/review.js` — проверка результата по критериям шага, vision-проверка скриншотов
- [x] `src/stages/audit.js` — аудит структуры, доступности, производительности, зависимостей
- [x] `src/stages/learn.js` — извлечение уроков и фактов в постоянную память
- [x] Проверка: вердикт и худший вердикт, картинки в запросе, файл ревью, аудит целиком,
      разбор уроков и список в `.tmp/<id>/lessons.json`

### step-16 — План работ, прогресс и процесс-менеджмент
- [x] `src/agent/work-plan.js` — план, прогресс на диске, `recordStep`, `applyPlanUpdate`, `resolveResumeStep`
- [x] `src/stages/index.js` — реестр стадий, их порядок, зависимости и точки восстановления
- [x] `src/pipeline.js` — оркестратор стадий, пауза на границе шага, продолжение после обрыва
- [x] `src/jobs/manager.js` — фоновые отсоединённые задачи: список, ожидание, отмена, удаление
- [x] Проверка: прогресс на диске, обновление плана, точка продолжения, порядок стадий,
      пауза и возобновление, падение стадии, запуск/ожидание/отмена/удаление фоновой задачи

### step-17 — Постоянная память и реестр компонентов
- [x] `src/memory.js` — SQLite + FTS5: виды (`fact`, `convention`, `decision`, `preference`, `pitfall`, `summary`, `note`), области (`global`, `project`), сводки файлов, завершённые задачи
- [x] Связка памяти со стадиями: запись находок, чтение в контекст ролей
- [x] Проверка: полнотекстовый поиск, области и проекты, сводки файлов, завершённые задачи,
      контекст памяти, запись уроков, чтение памяти в сборе контекста

### step-18 — CLI `ai-webdev` и рендерер
- [x] `src/cli/colors.js`, `src/cli/compatibility.js`, `src/cli/stdio.js` — цвета, проверка версии Node, работа со stdout/stderr
- [x] `src/cli/renderer.js` — рендер событий: план, стадии, файлы, инструменты, предупреждения, прогресс
- [x] `src/cli.js` — разбор argv, диспетчер команд, коды возврата, флаги
- [x] `src/help.js` — справка на английском языке
- [x] Поверх API: команды `run`, `plan`, `stages`, `component`, `install`, `jobs`, `memory`;
      флаги `--route`, `--stop-after`, `--resume`, `--pace`, `--quality`, `--fidelity`,
      `--creativity`, `--platform`, `--frontend-*`, `--icon-set`, `--role`, `--summary`,
      `--context`, `--extract`, `--approve`, `--detail`, `--json`, `--quiet`
- [x] Политика записи: `agent.approve` и `agent.extract` решают, пишет ли прогон файлы в проект

### step-19 — Тесты
- [x] `test/config.test.js` — конфиг, валидация, русские сообщения
- [x] `test/tools.test.js` — инструменты агента, запись только в разрешённые каталоги, запрет выхода за пределы проекта (сделан в step-4)
- [x] `test/roles.test.js` — резолв ролей, схемы, цикл вызовов (сделан в step-7)
- [x] `test/inputs.test.js` — разбор `DESIGN.md`, `measurements.json`, `palette.json`, `tokens.css` (сделан в step-8)
- [x] `test/generate.test.js` — бриф, скаффолд, платформа, fidelity, staging референсов (сделан в step-9)
- [x] `test/component.test.js` — контракт компонента, реестр, установка (сделан в step-10)
- [x] `test/structure.test.js` — сортировка импортов, структура файла, CSS/SCSS (сделан в step-11)
- [x] `test/stages.test.js` — план, сбор контекста, архитектура, окружение (сделан в step-12)
- [x] `test/steps.test.js` — шаги плана: разметка, код, стили (сделан в step-13)
- [x] `test/vector.test.js` — SVG как код, стадии вектора и иконок (сделан в step-14)
- [x] `test/review.test.js` — ревью, аудит и уроки (сделан в step-15)
- [x] `test/process.test.js` — план, прогресс, пауза/возобновление, восстановление после обрыва, jobs (сделан в step-16)
- [x] `test/memory.test.js` — SQLite-память, поиск, области (сделан в step-17)
- [x] `test/cli.test.js` — разбор argv, коды возврата, локальные команды

### step-20 — README и релиз-чеклист
- [x] `README.md` — установка, команды, примеры, формат конфига, мосты, входные данные
- [x] Затухание в монолите: `ai gen`/`ai run` веб-части делегируют в `ai-webdev`
- [x] Чеклист релиза: `npm run check`, `npm test`, `npm pack --dry-run`, версия, репозиторий

### step-21 — Скилл-паки и гайды современной платформы
- [x] `skills/modern-web-guidance/` — вендоренный пак гайдов (209 гайдов, 17 категорий,
      Apache-2.0, `NOTICE.md` с правками копии)
- [x] `src/agent/guidance.js` — движок гайдов: индекс, поиск по словам, чтение по id,
      категории, запасной путь через CLI апстрима (`npx modern-web-guidance@latest`)
- [x] Инструмент `web_guidance` (`configKey: guidance`): поиск, чтение, каталог, источник
      `bundled` или `cli`
- [x] `src/agent/skills.js` — каталог паков пакета стал последним в списке: копия проекта
      важнее встроенной; `skillCatalog()`, `removeSkillPack()`
- [x] Команда `src/cli/skills.js` — `list | search | show | path | rm`; встроенные пакеты
      не удаляются
- [x] Роли архитектора, кодера, разметчика, стилиста, редактора, ревьюера, аудитора и
      ученика получили инструмент и правило: сначала гайды, потом код
- [x] Проверка: `test/guidance.test.js`, тесты команды `skills` в `test/cli.test.js`

### step-22 — Пауза по стадии и подготовка картинок
- [x] `--stop-after=<stage>` — имя стадии нечувствительно к регистру, проверяется по реально
      исполняемым стадиям (маршрут ∩ включённые), неизвестная или недостижимая стадия —
      ошибка запуска
- [x] `src/cli/run.js` — `stopAfterStage()` и подсказка продолжения
      `ai-webdev run --resume <id>` после паузы
- [x] `src/stages/pictures.js` — новая стадия после `collect`: обрезки-картинки (шахматная
      фигура, доска) готовятся мостом `ai-image` (`background` по умолчанию) и кладутся
      в `assets/import/`
- [x] `src/inputs/crops.js` — поиск файла обрезка рядом с листом измерений и в рабочем
      каталоге прогона
- [x] `src/config/defaults.js`, `constants.js`, `validate.js` — секция `pictures`, стадия в
      перечне, проверка значений
- [x] `src/inputs/index.js` — блок подготовленных картинок в контексте ролей
- [x] Предмет вырезания: `pictureSubject()` собирает, что оставить (`{name}`, `{use}`,
      `{kind}`), и передаёт мосту `ai-image` флагом `--subject` — лишние детали (кусок доски
      в пешке, кусок пешки в доске) уходят
- [x] Проверка: `test/pictures.test.js`, тест `stopAfterStage` в `test/cli.test.js`

### step-26 — Состояние прогона и план без шагов
- [x] `src/stages/collect.js` — собранные входные данные пишутся в каталог прогона
      (`inputs.json`): `INPUTS_FILE`, `inputsPath()`, `writeInputs()`, `readInputs()`
- [x] `src/stages/pictures.js` — список подготовленных картинок пишется в каталог прогона
      (`pictures.json`): `PICTURES_FILE`, `picturesPath()`, `writePictures()`, `readPictures()`
- [x] `src/pipeline.js` — продолжение читает `inputs.json` и `pictures.json` обратно: иначе
      пропущенные стадии оставляли следующие без контекста
- [x] `src/pipeline.js` — задача принадлежит прогону: `--resume <id>` без своей задачи
      работает над задачей прежнего прогона; прогон без `inputs.json` собирает входные заново
- [x] `src/roles/index.js` — `roleReason()`: отказ, ошибка и текст без данных называют причину
- [x] `src/stages/plan.js` — план без шагов — это план намерений; планировщик спрашивается
      ещё раз (`PLAN_CORRECTION`), и стадия падает, если шагов нет и после повтора
- [x] `src/roles/planner.js`, `src/agent/schemas.js` — контракт плана: ответ — это работа,
      а не описание того, что модель собирается сделать; шагов не меньше двух
- [x] `src/config/defaults.js`, `validate.js`, `src/stages/pictures.js` — `pictures.model`:
      модель картинок передаётся мосту `ai-image` флагом `--image-model` (по умолчанию —
      модель конфигурации `ai-image`, то есть seedream)
- [x] README (EN): состояние прогона, модель картинок, план без шагов
- [x] Проверка: `test/process.test.js` (чтение входных и картинок при продолжении, повтор
      сбора), `test/stages.test.js` (план без шагов, запись входных), `test/pictures.test.js`
      (модель, запись картинок), `test/roles.test.js` (`roleReason`)

### step-27 — Цикл роли: последний ход отдаётся ответу
- [x] `src/roles/index.js` — `SCHEMA_CORRECTION`: роль, ответившая текстом вместо данных
      схемы, спрашивается ещё раз (один раз)
- [x] `src/roles/index.js` — `FINAL_ANSWER`: когда ходы исчерпаны, роль спрашивается об
      ответе без инструментов — только схема; ответ роли приходит даже после длинной серии
      вызовов инструментов (`stopped: 'completed'`)
- [x] `src/roles/index.js` — текст ответа до исправления сохраняется: пустой ответ после
      исправления не стирает причину отказа
- [x] `src/stages/step.js` — предупреждение называет причину: `Шаг <id>: роль <role> не
      вернула ответ (<причина>)`
- [x] README (EN): цикл роли, исправление ответа, последний ход
- [x] Проверка: `test/roles.test.js` — роль без схемы получает повтор; роль, исчерпавшая
      ходы, всё равно возвращает схему

### step-28 — Роли делают работу, каркас пишет код
- [x] `src/roles/index.js` — `WORK_CORRECTION`: роль, которая только описала свою работу
      (ответ без файлов, ответ с пустыми файлами или ответ с заглушкой), получает требование
      сделать её инструментами; поправка одна
- [x] `src/stages/step.js` — `missingFiles()`: после роли файлы шага проверяются на диске;
      шаг без своих файлов не считается сделанным, а предупреждение называет их
- [x] `src/stages/step.js` — стадия без шага своей роли пропускается, а не рушит прогон
      (`ok: true`, `skipped: true`)
- [x] `src/stages/setup.js` — `ensureScaffold()`: каркас проекта пишет код, а не модель —
      `package.json`, `vite.config.js`, `.rules/stack.md`, `.rules/files.md` (стек архитектора)
- [x] `src/stages/setup.js` — `INSTALL_CORRECTION`: установщик, ответивший без зависимостей,
      скриптов и файлов, спрашивается ещё раз; молчание установщика не отменяет каркас
- [x] `src/agent/tools.js` — `BLOCKING_COMMANDS`: сервер, вотчер и `tail -f` не запускаются
      (команда не заканчивается сама — прогон ждал бы впустую); время команды по умолчанию 60 с
- [x] `src/roles/reviewer.js`, `auditor.js` — роли ревью и аудита не запускают серверы
- [x] README (EN): работа роли, каркас проекта, запрет серверов
- [x] Проверка: `test/roles.test.js` (поправка работы), `test/steps.test.js` (незаписанные
      файлы), `test/stages.test.js` (каркас), `test/tools.test.js` (команда без конца)

### step-29 — Программы запускаются кодом, роли пишут файлы
- [x] `src/agent/programs.js` — единый запуск программ: поиск в PATH с учётом расширений
      Windows (`.cmd`, `.exe`, `.bat`, `.com`), запуск shim-а через `cmd.exe /d /c`
      (`windowsVerbatimArguments`), таймаут, сбор ответа и `taskkill /T /F` для дерева процесса
- [x] `src/agent/tools.js` — инструмент `run_command` использует общий runner; серверы и
      вотчеры по-прежнему запрещены (`BLOCKING_COMMANDS`)
- [x] `src/stages/setup.js` — `installDependencies()`: зависимости ставит код стадии по
      манифесту (`npm install --no-audit --no-fund`, таймаут 600 с), а не модель; результат
      установки попадает в отчёт стадии и в предупреждения
- [x] `src/generate/scaffold.js` — `SCAFFOLD_VERSIONS`: версии каркаса запинены
      (`vite ^7.0.0`, `sass ^1.80.0` и т.д.), вместо `*`
- [x] `src/roles/index.js` — `WORK_ORDER`: вторая поправка работы прямо называет инструмент
      (`write_file` — по одному вызову на файл шага); максимум две поправки работы
- [x] `src/roles/coder.js`, `markup.js`, `styler.js` — заголовок шага не определяет вид работы:
      шаг «Описать поведение» значит файлы поведения, а не описание поведения
- [x] README (EN): runner программ, установка зависимостей кодом, запиненные версии каркаса,
      вторая поправка работы
- [x] Проверка: `test/programs.test.js` (поиск в PATH, запуск, отсутствующая программа, код
      возврата), `test/stages.test.js` (установка зависимостей, повторная установка не нужна)

### step-30 — Файлы шага должны компилироваться
- [x] `src/agent/syntax.js` — проверка синтаксиса: `node --check` для скриптов, `sass` проекта
      для стилей (`scss`, `sass`, `css`); ошибка компилятора возвращается списком файлов
- [x] `src/agent/syntax.js` — файл-модуль в пакете без `type: module` проверяется как модуль
      (копия `.mjs`): браузер грузит его как модуль, и проверка видит тот же код
- [x] `src/agent/syntax.js` — частичный файл без переменных других файлов — не ошибка синтаксиса,
      а примечание; без `sass` в `node_modules` стили не проверяются, и это сказано в отчёте
- [x] `src/roles/index.js` — `syntaxCorrection()`: роль получает ошибки компилятора и чинит файлы
- [x] `src/stages/step.js` — после записи файлов шага идёт проверка; при ошибке роль зовётся ещё
      раз с текстом ошибок, её файлы перезаписываются, проверка повторяется
- [x] `src/stages/step.js` — отчёт шага несёт `syntax` (проверенные файлы и ошибки), шаг с
      ошибками синтаксиса не считается сделанным
- [x] README (EN): проверка синтаксиса файлов шага
- [x] Проверка: `test/syntax.test.js` (скрипт со сломанной строкой, модуль, стиль без `sass`,
      подделка `sass`), `test/steps.test.js` (сломанный файл чинится ролью, незачёнённый сломанный
      файл — ошибка шага)

### step-31 — Референс дизайна видят роли
- [x] `src/inputs/references.js` — поиск референса: файл из задачи, файл с именем `landing`,
      `reference`, `screenshot`, `mockup`, `design`, любой файл `.ai/refs/`; одна картинка в двух
      форматах — одна (лучший формат)
- [x] `src/config/defaults.js`, `src/config/validate.js` — `inputs.reference`: `null` (искать по
      имени) или путь/список путей (референс назван прямо)
- [x] `src/inputs/index.js` — собранные входы несут `references`, контекст роли говорит о референсе
- [x] `src/inputs/references.js` — картинка читается и уходит в запрос как `input_image`
- [x] `src/stages/step.js`, `src/stages/review.js`, `src/stages/architect.js` — референс прикреплён
      к запросу роли
- [x] `src/roles/reference.js` — `referenceNote()`: роли сказано, что картинка приложена
- [x] README (EN): референс дизайна во входах
- [x] Проверка: `test/inputs.test.js` (поиск по имени, файл из задачи, файл из конфига, картинка
      в запросе), `test/steps.test.js` (референс в запросе роли)

### step-32 — Стили подключены: сборка и разметка
- [x] `src/stages/build.js` — точка входа стилей: файлы `scss`/`sass`, не партиалы и не
      используемые другими файлами; черновики (`main-incorrect.scss`) не часть стилей
- [x] `src/stages/build.js` — недостающий `@use` для партиала, который никто не использует
- [x] `src/stages/build.js` — компиляция `sass` проекта: `styles/main.scss` → `styles/main.css`
- [x] `src/stages/build.js` — `index.html`: `<link rel="stylesheet">` на собранный CSS и
      `<script type="module">` на скрипт, если их нет; битая ссылка — в отчёт
- [x] `src/stages/index.js`, `src/config/constants.js`, `src/config/defaults.js` — стадия `build`
      после `styling`; `review` зависит от неё
- [x] `src/stages/step.js` — проверяются и те файлы, что роль написала рядом с файлами шага:
      сломанный партиал, которого никто не назвал, тоже сломан
- [x] `src/stages/build.js` — сломанная сборка не оставляет файл: `sass` пишет ошибку в
      результат, а ошибка в CSS хуже, чем нет CSS
- [x] `src/roles/markup.js`, `src/roles/styler.js` — роли сказано про точку входа и про
      ссылку на стили
- [x] `src/stages/step.js`, `src/roles/index.js` — починка пишет файл под тем же путём, а не
      копией рядом
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/build.test.js` (точка входа, партиал-сирота, `@use`, ссылки разметки,
      сборка без `sass`, сборка проектом, сломанная сборка, стадия целиком),
      `test/steps.test.js` (файл рядом с файлами шага тоже проверяется)

### step-33 — `sass` по npm и стили Vite
- [x] `src/stages/setup.js` — `ensureStyleCompiler()`: для SCSS компилятор `sass` (`^1.80.0`)
      добавляется в `devDependencies` манифеста; для CSS — нет; повторно не добавляется
- [x] `src/stages/setup.js` — `missingPackages()`: установка не пропускается, если в
      `node_modules` нет пакета из манифеста (например, `sass`)
- [x] `src/stages/build.js` — `isViteProject()`: проект Vite узнаётся по `vite.config.*` и по
      манифесту
- [x] `src/stages/build.js` — `ensureStyleImport()`, `importPath()`, `scriptImports()`,
      `insertImport()`: импорт точки входа стилей добавляется в главный JS-файл проекта
      (`import './styles/main.scss'`), если его там нет; файл с тем же именем в другой папке
      импортом не считается
- [x] `src/stages/build.js` — `removeStyleLink()`: ссылка разметки на собранный CSS в проекте
      Vite удаляется — этот CSS артефакт сборщика, а не файл проекта
- [x] `src/stages/build.js` — стадия `build`: в проекте Vite стили не компилируются кодом,
      их собирает сборщик; в остальных проектах путь прежний
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/build.test.js` (Vite по конфигу и по манифесту, путь импорта, импорт
      добавлен, импорт не задвоен, ссылка на CSS удалена, стадия целиком на проекте Vite),
      `test/stages.test.js` (`sass` в манифест, установка при неполном `node_modules`)

### step-c6 — Копия библиотеки доступа: список файлов и копирование
- [x] `src/access/native.js` — копия из `u2ai-server`: операция `copy` и состояние пути
      свойствами (`isDirectory`, `isFile`, `isSymbolicLink`), а не методами Node.js
- [x] `src/access/memory.js` — копия из `u2ai-server`: копирование файла и поддерева
- [x] `src/access/fs.js` — копия из `u2ai-server`: `listFiles(relative, { depth, limit,
      includeHidden })` и `copy(source, destination, { overwrite })` с правилами путей
- [x] Правило: правки слоя доступа идут в `u2ai-server` первыми, остальные пакеты получают
      копию `src/access/*`
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 316 тестов, все проходят

### step-35 — Стили не ссылаются на ненаписанные файлы
- [x] Проблема: модель написала `scss/main.scss` с `@use "tokens"`, `base`, `layout`,
      `components`, `utilities` и не написала ни одного из этих файлов — страница без
      стилей, а проект Vite падает с `Can't find stylesheet to import`
- [x] `src/agent/syntax.js` — `styleReferences()`, `styleImportCandidates()`,
      `missingStyleReferences()`: файлы, на которые указывает таблица стилей, ищутся по
      правилам Sass (`tokens`, `_tokens.scss`, `tokens/_index.scss`); модули `sass:math` и
      импорты CSS не считаются файлами проекта
- [x] `src/agent/syntax.js` — `checkStyle()`: недостающий файл — ошибка, а не заметка;
      проверка работает без компилятора, поэтому роль получает точный адрес файла
- [x] `src/stages/build.js` — `missingReferences()`: стадия называет недостающие файлы
      (`Стиль не найден: scss/main.scss → tokens (scss/tokens.scss)`) и проваливает прогон
- [x] `src/stages/build.js` — `verifyStyles()`: стили проекта Vite тоже проверяются
      компилятором (во временный файл, без артефакта в проекте), хотя собирает их сборщик
- [x] `src/roles/styler.js` — правило: каждый файл, который `@use` точка входа, должен быть
      на диске
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/syntax.test.js` (недостающий файл, правила Sass, `sass:math`),
      `test/build.test.js` (стадия называет недостающий файл, Vite проверяет стили),
      `npm test` — 322 теста, все проходят

### step-36 — Стили приходят из импорта, а не из ссылки
- [x] `src/stages/build.js` — `removeStyleLink()` принимает список целей: убирается и ссылка
      на собранный CSS, и ссылка на исходный SCSS — иначе стили грузятся дважды
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 324 теста, все проходят

### step-37 — Меазер включён по-настоящему
- [x] Проблема: `call_ai_measure` был разрешён спецификацией для planner, architect и styler,
      но в списках инструментов ролей его имел только styler — роли получают инструменты
      только из своего списка, поэтому меазер в прогоне фактически не работал
- [x] `src/roles/planner.js` — инструмент `call_ai_measure` и правило: если измерений
      референса нет, мерить до плана (`["measure", "landing.png"]`, `["design", …]`)
- [x] `src/roles/architect.js` — тот же инструмент и правило: токены и сетка следуют
      картинке, а не догадкам
- [x] `src/agent/tool-specs.js` — описание инструмента называет команды меазера
      (`measure`, `design`, `palette`)
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/roles.test.js` (у planner, architect и styler есть инструмент),
      `npm test` — 325 тестов, все проходят

### step-38 — Модель, прибитая к JSON, не вызывает инструменты
- [x] Проблема: на `moonshotai/kimi-k3.1-pro` стадия `markup` падала — «файлы не написаны:
      index.html». Ответ роли был пустым JSON: `{"summary":"","files":[],…}`
- [x] Причина: `text.format = json_schema` прибивает ответ модели к схеме, и такая модель
      не вызывает ни одного инструмента — она описывает работу вместо того, чтобы её сделать
      (проверено пробой: с форматом Kimi отвечает текстом JSON, без формата — зовёт
      `write_file`)
- [x] `src/openai/responses.js` — канал схемы ответа (`schemaChannel`): `tool` — схема едет
      инструментом, `format` — ответ прибит к схеме, `auto` — инструментом, когда у роли
      есть другие инструменты, и форматом иначе
- [x] `src/openai/client.js` — канал берётся из профиля модели
- [x] `src/model/profiles.js` — у профиля модели поле `schemaChannel`:
      `auto` (Kimi и неизвестные модели), `format` (minimax, openai); переопределяется
      в конфиге через `models.<id>.schemaChannel`
- [x] `src/config/validate.js` — поле `models.<id>.schemaChannel` (`auto | tool | format`)
- [x] `src/roles/index.js` — эскалация роли: если роль описала работу, а ничего не написала,
      первая коррекция переносит схему в канал инструмента, вторая убирает и схему —
      остаются только инструменты работы; последний ход ответа снова с прибивкой
- [x] `src/roles/index.js` — запись считается сделанной, только если инструмент записи
      действительно записал файл (`wroteSomething()`)
- [x] `src/stages/step.js` — слова модели не пишутся в картинку: файлы с бинарным
      расширением пропускаются
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/responses.test.js` (режим формата), `test/roles.test.js`
      (коррекция снимает прибивку; модель с профилем `auto` зовёт инструменты),
      `test/steps.test.js` (бинарный файл не перезаписан), `npm test` — 333 теста,
      все проходят; живой шаг `markup` на Kimi пишет `index.html` (9.4 КБ, 9 ходов)

### step-39 — Effort у каждой стадии свой
- [x] Проблема: прогон на `moonshotai/kimi-k3.1-pro` шёл полчаса на одной стадии — все роли
      работали с effort прогона (`xhigh`), хотя план, архитектура и скрипты в таком
      размышлении не нуждаются
- [x] `src/config/defaults.js` — `STAGE_EFFORT`: профиль стадий — разметка и стили `xhigh`,
      архитектура и ревью `high`, план, скрипты, иконки, редактор, аудит `medium`,
      установщик и ученик `low`
- [x] `src/config/defaults.js` — `reasoning.stageEffort` — профиль в конфиге;
      `reasoning.effort` — потолок прогона, стадия никогда не работает выше него
- [x] `src/agent/pace.js` — `stageEffortFor()`, `lowerEffort()`: effort роли — это effort
      роли из конфига, иначе профиль стадии под потолком прогона, иначе сам потолок;
      `roles.<role>.effort` важнее профиля
- [x] `src/openai/client.js` — effort стадии опускается до потолка модели (`snapEffort`):
      модель с потолком `high` не получает `xhigh`
- [x] `src/config/validate.js` — проверка `reasoning.stageEffort`: роль известна, уровень из
      лестницы усилий (`null` выключает профиль)
- [x] `src/help.js`, README (EN), planned.md (RU)
- [x] Проверка: `test/roles.test.js` (профиль стадий, потолок, effort роли, потолок модели),
      `test/config.test.js` (проверка профиля), `npm test` — 335 тестов, все проходят

### step-40 — Входы прогона не читаются дважды
- [x] Проблема: план на Kimi читал проект 20 раз, и среди них — лист измерений (87 КБ)
      двадцать раз; контекст прогона раздувался, а стадия шла десятки минут
- [x] `src/roles/inputs.js` — `INPUTS_IN_CONTEXT`: правило для ролей — направление дизайна,
      измерения, палитра и токены уже в контексте, их файлы не читаются снова
- [x] `src/roles/planner.js`, `architect.js`, `markup.js`, `coder.js`, `styler.js` — правило
      в списке правил роли
- [x] `src/agent/tools.js` — `read_file` не отдаёт содержимое файла второй раз: файл, который
      не менялся, читается один раз на роль, второй ответ — короткая заметка; после записи
      файл читается снова
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/tools.test.js` (файл читается один раз, изменённый — снова),
      `test/roles.test.js` (роли знают про входы в контексте), `npm test` — 337 тестов,
      все проходят

### step-41 — Молчание модели больше не похоже на зависание
- [x] Проблема: ход Kimi длится минутами, терминал молчит — кажется, что прогон завис
- [x] Проблема (главная): молчащий запрос обрывался по таймауту в 120 с и **начинался
      заново** — всё рассуждение модели выбрасывалось, поэтому «думающий» ход шёл по
      кругу: 8 минут архитектуры вместо одной минуты
- [x] `src/config/defaults.js` — `timeoutMs` по умолчанию 600 000 (10 минут): короткий
      таймаут не делает модель быстрее, он заставляет её думать заново
- [x] `src/openai/client.js` — пульс запроса: событие `request.wait` каждые 20 с
      (`WAIT_INTERVAL_MS`)
- [x] `src/cli/renderer.js` — `wait()`: строка `· thinking (60s)`, в json — событие `wait`;
      `retry()` и ошибка запроса больше не молчат
- [x] `src/cli/run.js` — события транспорта (`request.wait`, `request.retry`,
      `request.error`) доходят до рендерера
- [x] `src/config/defaults.js` — архитектура и ревью `high → medium`: стадия, которая
      только решает, не должна стоить минуты размышления
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/cli.test.js` (строка ожидания и json-событие),
      `test/config.test.js` (таймаут по умолчанию), `test/roles.test.js` (профиль
      стадий), `npm test` — 340 тестов, все проходят

### step-42 — Потолок таймаута поднят до получаса
- [x] Проблема: ход Kimi на `xhigh` идёт 5–6 минут, а потолок таймаута был 10 минут —
      длинный ход рисковал быть выброшенным и начат заново
- [x] `src/config/defaults.js` — `timeoutMs` 600 000 → 900 000 (15 минут)
- [x] `src/config/validate.js`, `src/config/env.js` — потолок конфига 600 000 → 1 800 000
      (30 минут)
- [x] `src/openai/client.js` — запасной таймаут транспорта 900 000
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/config.test.js` (таймаут и его потолок), `npm test` — 340 тестов,
      все проходят

### step-43 — Продолжение идёт с того места, где остановилось
- [x] Проблема: прогон, остановленный на середине, при продолжении переделывал заново
      уже сделанные шаги — модель снова смотрела на картинку и снова писала тот же файл,
      а каждый её ход стоит минуты
- [x] `src/stages/step.js` — `resumableStep()`: отчёт шага лежит в `.tmp/<id>/steps/<id>.json`
      и читается обратно; шаг, чьи файлы ещё на диске, повторно не выполняется
- [x] `src/stages/step.js` — файл, удалённый после шага, означает, что работа пропала:
      шаг выполняется снова
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (шаг не делается дважды; удалённый файл — шаг
      повторяется), `npm test` — 341 тест, все проходят

### step-44 — Картинка идёт только тем, кто смотрит на дизайн
- [x] Проблема: скриншот референса прикладывался к каждому шагу каждой роли — кодер и
      иконщик его не смотрят, но картинка загружалась и оплачивалась на каждом ходу
- [x] `src/stages/step.js` — `LOOKS_AT_DESIGN`: разметка, стили и вектор получают
      скриншот; скрипты, иконки и прочая механика работают по числам, палитре и токенам
- [x] `src/stages/step.js` — роль без картинки получает текст: «скриншот есть, но он не
      приложен, работай по измерениям»
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (разметка получает картинку, кодер — нет),
      `npm test` — 342 теста, все проходят

### step-45 — По логу видно, что именно читают и пишут
- [x] Проблема: в логе было видно только имя инструмента (`· read_file`) — какой файл
      читается и какая программа запускается, оставалось неизвестным
- [x] `src/roles/index.js` — событие `role.tool` несёт аргументы вызова (`toolCallDetail`:
      длинные строки обрезаются, содержимое файла в лог не попадает)
- [x] `src/roles/index.js` — событие `role.tool.result`: короткий ответ инструмента
- [x] `src/cli/renderer.js` — строка вызова называет предмет: путь файла, программу с
      аргументами, слова поиска; ответ — строкой ниже
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/cli.test.js` (строка вызова называет путь и программу),
      `test/roles.test.js` (событие несёт аргументы), `npm test` — 343 теста,
      все проходят

### step-46 — Ответ роли больше не теряется
- [x] Проблема: `applyFiles` не перезаписывал существующий файл — ответ роли (например,
      `src/main.js` на 3134 знака) молча терялся, если файл остался от прошлой стадии.
      Шаг при этом помечался `ok=true`, и прогон уезжал дальше с пустым результатом
- [x] `src/stages/step.js` — `applyFiles`: файл, который отличается от ответа роли,
      записывается (старое содержимое уходит в резервную копию `step`); тот же файл
      повторно не пишется; файл, который роль написала своим инструментом, не трогаем —
      на диске истина
- [x] `src/stages/step.js` — `filesByTool`: список файлов, которые роль записала сама
- [x] `src/stages/step.js` — файл, который не записался, валит шаг (`ok=false`) с внятным
      предупреждением; в отчёт шага попадают `replaced` и `failed`
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (файл перезаписывается, чужой файл не трогается,
      тот же контент не пишется, неудачная запись валит шаг), `npm test` — 346 тестов,
      все проходят

### step-47 — Роли читают проект в строгом порядке и проверяют сборкой
- [x] Проблема: роль писала файлы, не посмотрев проект: не открывала `index.html`, не
      смотрела импорты скриптов и `@use` стилей, искала файлы только чтением, а ошибки
      проверяла «на глаз»
- [x] `src/stages/step.js` — `orderOfWork`: общий порядок работы в запросе каждого шага —
      точка входа (`index.html`), скрипт точки входа и его импорты, таблица стилей и её
      `@use`; пути ищутся через `list_files` и `search_files`
- [x] `src/stages/step.js` — `projectScripts`: имена скриптов `package.json` попадают в
      запрос — роль не гадает, какой командой проверять
- [x] `src/agent/tool-specs.js`, `src/roles/styler.js`, `src/roles/editor.js` — команда
      (`run_command`) доступна кодеру, стилизатору и редактору: `run_command` был в списке
      ролей, но не в списке ролей каталога инструментов, поэтому не работал ни у кого
- [x] `src/roles/coder.js`, `src/roles/styler.js`, `src/roles/markup.js` — правила:
      проверять работу командой проекта, а не чтением кода; путь, который не видели, не
      существует
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (в запросе есть порядок работы и скрипты проекта),
      `test/roles.test.js` (у ролей есть команда), `npm test` — 348 тестов, все проходят

### step-48 — Шаг сделан, только когда ответ роли лежит на диске
- [x] Проблема: шаг, отчёт которого есть, считался сделанным по одному лишь отчёту. Если
      ответ роли потерялся (файл остался от прошлой стадии), прогон продолжался с
      чужим содержимым и никто этого не замечал
- [x] `src/stages/step.js` — `resumableStep()`: ответ роли сверяется с диском, файл,
      который не совпадает, означает потерянную работу — шаг выполняется заново
- [x] `src/stages/step.js` — файл, который роль записала своим инструментом (`applied.own`),
      не сверяется: там на диске истина
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (потерянный ответ — шаг делается снова),
      `npm test` — 349 тестов, все проходят

### step-49 — Поиск: контент, имена, glob, regex
- [x] Проблема: `search_files` умел только грепнуть текст по всему дереву. Найти файл по
      имени или по маске (`*.scss`, `src/**/*.js`) было нельзя, а роль, которая ищет
      модуль, читала каталог целиком
- [x] `src/agent/fs-tools.js` — `globMatcher()`: маска имени (`*`, `**`, `?`); маска без
      слэша — имя файла, со слэшем — путь от корня
- [x] `src/agent/fs-tools.js` — `searchFiles()`: `inContent=0` ищет по путям и отдаёт сами
      пути, `inContent=1` грепает текст и отдаёт `путь:строка: текст`; `glob` отсекает
      файлы до чтения, `regex` читает запрос как регулярное выражение
- [x] `src/agent/tool-specs.js`, `src/agent/tools.js` — параметры `inContent`, `glob`,
      `regex` в каталоге и в вызове инструмента
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/tools.test.js` (контент, имена, glob, regex), `npm test` — 350 тестов,
      все проходят

### step-50 — Стадия не считается сделанной, если её работа потеряна
- [x] Проблема: прогон, который продолжался, пропускал стадию по прогрессу: стадия `coding`
      считалась сделанной, хотя ответ кодера (`src/main.js`, 3134 знака) не был на диске —
      прогон уехал дальше с файлом в 29 байт
- [x] `src/stages/step.js` — `roleWorkOnDisk()`: работа роли на диске или нет; файл, который
      изменили после отчёта шага, принадлежит более поздней стадии и потерей не считается
- [x] `src/stages/step.js` — `laterSteps()`: файл более позднего шага принадлежит ему —
      ранний шаг не сверяет его со своим ответом и не отменяет чужую работу
- [x] `src/stages/index.js` — у стадий `markup`, `coding`, `styling` есть проверка работы
- [x] `src/pipeline.js` — стадия, работа которой потеряна, выполняется заново, а прогресс
      говорит об этом предупреждением
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/steps.test.js` (потерянная работа, файл позднего шага),
      `test/process.test.js` (стадия с потерянной работой выполняется заново),
      `npm test` — 353 теста, все проходят

### step-51 — `--input` и `--image`: суть задачи и картинка задачи
- [x] Проблема: у задачи бывает «суть» — файл с требованиями, который никто не читает, и
      картинка, которую нельзя дать прогону: путь к макету приходилось вписывать в текст
      задачи, а роли, которые смотрят на дизайн, её не видели
- [x] `src/cli.js` — флаги `input` и `image` с значением; каждый может быть дан много раз
- [x] `src/cli/run.js` — `pathListFlag()`: список путей; флаг без значения — ошибка
      использования; `configOverrides()` пишет `inputs.extra`
- [x] `src/config/defaults.js`, `src/config/validate.js` — `inputs.extra`: список непустых строк
- [x] `src/inputs/index.js` — `collectEssence()`: файлы читаются, отсутствующий файл —
      предупреждение, а не ошибка; блок `# The essence of the task` в контексте ролей
- [x] `src/cli/run.js` — картинки ставятся в проект (`stageReferences()`): файл вне проекта
      копируется в `.ai/refs/`, файл проекта сохраняет свой путь; пути добавляются в
      `inputs.reference` и становятся референсами дизайна
- [x] `src/inputs/references.js` — референс из конфига ищется по пути проекта, а не по имени:
      картинка в `.ai/refs/` больше не теряется
- [x] `src/help.js`, README (EN), planned.md (RU)
- [x] Проверка: `test/inputs.test.js` (суть читается, отсутствующая суть — предупреждение,
      референс из вложенного каталога), `test/cli.test.js` (флаги → `inputs.extra`, флаг без
      значения — ошибка), `npm test` — 357 тестов, все проходят

### step-52 — Иконки Lucide и Phosphor: каталог имён и загрузка пачкой
- [x] Проблема: иконщик брал иконки по памяти. Наборы большие (у Lucide больше тысячи, у
      Phosphor больше полутора тысяч), и имя, которого в наборе нет, — это битая иконка.
      Кроме того, инструмент брал иконки по одной: десять иконок — десять ходов роли
- [x] `src/agent/icon-sets.js` — реестр наборов (CDN, варианты, префикс), `iconCatalogue()`:
      имена читаются из списка файлов пакета jsDelivr и кэшируются; `searchIcons()`: поиск
      по имени; `iconUrl()`, `iconName()`
- [x] `src/agent/assets.js` — `downloadIcons()` берёт список имён (`icons`), пишет файлы и
      возвращает `missing` (имени нет в наборе) и `failed` (не скачалось) вместо исключения
- [x] `src/agent/tool-specs.js`, `src/agent/tools.js` — параметр `icons` у `download_icons`,
      новый инструмент `search_icons`
- [x] `src/roles/iconifier.js` — роль ищет имена и берёт иконки одной пачкой
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/icons.test.js` (имена набора, поиск, кэш каталога, загрузка пачкой,
      отсутствующее имя), `npm test` — 363 теста, все проходят

### step-53 — Продолжённый прогон берёт суть задачи из своих флагов
- [x] `src/inputs/index.js` — `collectEssence()` собирает `# The essence of the task`,
      `mergeInputs()` мерджит входы прогона с сохранёнными
- [x] `src/pipeline.js` — при `--resume` входы пересобираются и мерджатся сохранёнными
- [x] `test/process.test.js` — тест на продолжение с `--input`
- [x] Проверка: `npm test` — 364 теста, все проходят

### step-54 — Журнал запросов и ответов: цепочка читается, а не угадывается
- [x] Проблема: прогон, который упал, говорил только «failed». Не было видно, какой хост
      спрашивали, что ушло, что пришло, сколько модель думала и где цепочка оборвалась
- [x] `src/openai/log.js` — `createApiLogger()` пишет по JSON-записи на запрос,
      `redactBody()` заменяет base64-картинки на note о размере
- [x] `src/openai/client.js` — запись собирает тело запроса, цепочку хостов, попытки,
      время и ответ; ошибка записи не ломает запрос
- [x] `src/config/defaults.js` — секция `logging` (`enabled`, `dir`)
- [x] `src/config/validate.js`, `src/config/env.js` — проверки и `AI_WEBDEV_LOG_DIR`
- [x] `test/log.test.js` — 4 теста: запись, отключение, редакция картинок
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 368 тестов, все проходят

### step-55 — Смерть прогона не должна быть тихой
- [x] Проблема: прогон webdev падал без слова — ни сообщения, ни кода возврата. Стадия,
      которая не возвращается, ждала вечно, а падение вне команды не оставляло следов
- [x] `src/pipeline.js` — `runStage()`: бюджет стадии `limits.stageTimeoutMs` превращает
      зависание в отказ с именем стадии
- [x] `src/cli.js` — `unhandledRejection` и `uncaughtException` печатаются и оставляют код
      возврата ошибки
- [x] `bin/ai-webdev.js` — код возврата падения не затирается кодом команды
- [x] `test/process.test.js` — тест на стадию, которая не вернулась
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 369 тестов, все проходят

### step-56 — Шаблон сути задачи принимает сообщение прогона
- [x] Проблема: суть задачи и текст задачи лежали в двух местах — в файле `--input` и в
      аргументе прогона. Одно и то же приходилось писать дважды, и файл переставал быть
      переносимым
- [x] `src/inputs/index.js` — `collectEssence(root, files, task)`: плейсхолдер `{{message}}`
      в файле сути заменяется текстом задачи прогона
- [x] `src/inputs/index.js` — `collectInputs()` передаёт задачу в сбор сути
- [x] `test/inputs.test.js` — тест на подстановку
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 370 тестов, все проходят

### step-57 — Программа команды не ждёт ввода
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): роль вызвала `run_command` с
      программой `node` без аргументов. Консоль node читает ввод и ждёт клавиши — вызов
      висел все 60 с, а стадия `coding` умерла по бюджету (15 мин) с «This operation was
      aborted». Два вызова `node` съели треть стадии
- [x] `src/agent/programs.js` — ввод программы закрывается сразу: программа, которая читает
      ввод, заканчивается, а не держит прогон до таймаута
- [x] `src/roles/coder.js`, `src/roles/styler.js` — правило: программе нужны её аргументы,
      голый `node` не значит ничего
- [x] `test/programs.test.js` — тест: программа, читающая ввод, заканчивается сама
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 371 тест, все проходят

### step-58 — Сервер vite не запускается из роли
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): роль вызвала `npx vite` — сервер
      разработки не заканчивается сам, а запрет знал только `vite dev` и `npm run dev`. Сервер
      остался жить после прогона и держал порт
- [x] `src/agent/tools.js` — `BLOCKING_COMMANDS` отказывает и голому `vite`, и `npx vite`,
      и `vite dev`; `vite build` и `npm run build` остаются разрешёнными
- [x] `test/tools.test.js` — тест на все формы команды vite
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 372 теста, все проходят

### step-59 — Упавшая работа продолжается той же командой
- [x] Проблема: прогон, который упал, не говорил, как его продолжить. Идентификатор был
      виден только в итоговой сводке — а падение случается раньше. Продолжение приходилось
      собирать руками: без `--input` и `--image` суть задачи терялась
- [x] `src/cli/run.js` — `resumeCommand()`: команда продолжения повторяет всё, что нужно
      прогону (конфиг, суть, картинку, вид, модель, effort) и называет его идентификатор
- [x] `src/cli/run.js` — идентификатор прогона создаётся в CLI и печатается до первой стадии:
      прогон называет себя, пока он жив
- [x] `src/cli/run.js` — упавший прогон печатает команду своего продолжения
- [x] `test/cli.test.js` — тест на команду продолжения
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 373 теста, все проходят

### step-60 — Роль пишет партиалы, которых нет
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): роль `styler` написала
      `src/styles.scss` с четырьмя `@use` (`variables`, `base`, `hero`, `drop-menu`) и не
      написала ни одного партиала. Сборка vite падала с «Can't find stylesheet to import»,
      страница осталась без стилей. Шаг шага проходил: файлы шага на диске были, ошибок
      компилятора стадия не видела — она проверяла только файлы шага
- [x] `src/agent/syntax.js` — `partialName()` (имя партиала: с подчёркиванием) и
      `missingPartials()` (список отсутствующих партиалов с путями, под которыми их надо
      написать)
- [x] `src/roles/index.js` — `partialCorrection()`: роль получает точный список
      «`@use 'variables'` → напиши `src/_variables.scss`»
- [x] `src/stages/step.js` — `styleScope()`: роль стилей отвечает за все таблицы стилей
      проекта, остальные роли — только за файлы своего шага; проверка партиалов и
      ремонтный вызов роли; `writtenLater()`: партиал, который напишет следующий шаг
      плана, ошибкой текущего шага не считается; `partials` в отчёте шага; шаг падает с
      внятным предупреждением, если партиал так и не написан
- [x] `src/roles/styler.js` — правило: `@use` называет файл, который должен быть на
      диске; партиал — это файл с подчёркиванием; делить стили на партиалы только когда
      шаг называет партиалы
- [x] `src/stages/setup.js` — установщик больше не получает первый шаг плана: он готовит
      окружение, а не пишет файлы плана; в блок входа добавлен список «The files of the plan»
- [x] `src/roles/installer.js` — правило: шаги плана пишут другие роли
- [x] `src/stages/build.js` — `missingReferences()` называет партиал под именем, под
      которым его надо написать
- [x] `test/syntax.test.js` — тесты на `missingPartials()` и `partialName()`
- [x] `test/steps.test.js` — три теста: роль получает список отсутствующих партиалов и
      пишет их; недописанный партиал — ошибка шага; партиал следующего шага — не ошибка
- [x] `test/stages.test.js` — тест: установщик не получает шаг плана
- [x] `test/build.test.js` — ассерт на имя партиала в отчёте сборки
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 380 тестов, все проходят; `npm run check` — 155 из 155

### step-61 — Гайды платформы доходят до роли
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): вызов `web_guidance` на Windows падал
      с `'\"npx\"' is not recognized` — строка команды собиралась с кавычками внутри, и
      `cmd.exe /s` вместе с экранированием Node ломал её. Роль получала отказ вместо
      гайдов и тратила ходы впустую
- [x] `src/agent/guidance.js` — `cliProgram()`: на Windows команда идёт через
      `cmd.exe /d /c` с аргументами по одному, без строки с кавычками внутри
- [x] `src/agent/tools.js` — `web_guidance` принимает слова поиска списком: модель часто
      передаёт `["navbar","accessibility"]` вместо объекта с `query`, и раньше запрос
      превращался в каталог всех гайдов
- [x] `test/guidance.test.js` — тест на список слов и тест на форму аргументов CLI
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 382 теста, все проходят; `npm run check` — 155 из 155

### step-62 — Ремонт стилей видит и новые файлы
- [x] Проблема: список таблиц стилей, по которым ищутся отсутствующие партиалы, снимался
      один раз — до ремонта. Ремонт мог создать новую таблицу стилей, и партиал, который
      называет она, уже не попадал в проверку
- [x] `src/stages/step.js` — область стилей пересчитывается после ремонта: новая таблица
      стилей проверяется на свои `@use`
- [x] `src/roles/index.js` — `partialCorrection()`: понятнее сказано, что такое партиал
      и куда класть правила слоя
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 382 теста, все проходят; `npm run check` — 155 из 155

### step-63 — Ревью чинит то, что нашло
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): ревью нашло три дефекта — мобильное
      меню открывается на 600px ниже кнопки, правый рельс смещён на 6px, — но починить их
      было некому: у роли `reviewer` нет инструментов записи, а стадия `review` только
      собирала замечания. Прогон доходил до конца с вердиктом `partial` и сломанным
      проектом на диске
- [x] `src/stages/review.js` — `issueOwner()`: владелец файла замечания — это шаг плана,
      который его написал; `repairText()`: запрос роли с файлом, дефектом и требуемым
      изменением; `repairIssues()`: замечания группируются по роли, роли пишут файлы, правки
      проверяются компилятором; починенные шаги ревьюятся заново, вердикт прогона — от
      второго прохода
- [x] `src/roles/styler.js`, `src/roles/coder.js`, `src/roles/markup.js` — правило: запрос
      на починку — это файл на диске, а не описание починки
- [x] `src/config/defaults.js` — `stages.review.repair: true` (по умолчанию включено)
- [x] `src/config/validate.js` — поле `repair` проверяется как `true | false`
- [x] `test/review.test.js` — тесты на владельца файла, на текст запроса, на ремонт с повторным
      ревью и на выключенный ремонт
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 386 тестов, все проходят; `npm run check` — 155 из 155

### step-64 — Продолжённый прогон помнит, что сделали шаги
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): отчёты шагов плана лежали на диске,
      но пайплайн их не читал. Продолжённый прогон доходил до ревью без единого отчёта
      шага — ревьюеру нечего было судить, а починить найденное было некому
- [x] `src/stages/step.js` — `readStepReports()`: отчёты всех шагов прогона читаются с
      диска; отсутствующий отчёт просто пропускается
- [x] `src/pipeline.js` — при продолжении отчёты шагов кладутся в контекст прогона
- [x] `src/cli/run.js` — `requestedStages()`: стадии, названные в `--route`, отличаются от
      тех, что добавлены как зависимости
- [x] `src/pipeline.js` — стадия, названная в `--route`, выполняется заново, даже когда
      прогресс говорит, что она уже сделана: ремонт ревью требует именно её
- [x] `test/steps.test.js` — тест на чтение отчётов шагов с диска
- [x] `test/process.test.js` — тест: продолжённый прогон получает отчёты шагов; тест:
      названная стадия выполняется заново
- [x] `test/cli.test.js` — тест на `requestedStages()`
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 390 тестов, все проходят; `npm run check` — 155 из 155

### step-65 — Ремонт ревью берёт бюджет своей стадии
- [x] Проблема: бюджет ходов роли ремонта искался по имени роли (`styler`), а конфиг
      называет стадии (`styling`). Бюджет не находился, и роль работала с лимитом по
      умолчанию вместо того, который задал пользователь
- [x] `src/stages/review.js` — `STAGE_OF_ROLE`: имя роли и имя стадии не совпадают; бюджет
      берётся у той стадии, к которой роль относится
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 390 тестов, все проходят; `npm run check` — 155 из 155

### step-66 — Стадия просит свой бюджет, а ремонт повторяется
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): стадия `review` не укладывалась в
      `limits.stageTimeoutMs` (30 мин) — пять шагов ревью, ремонт двух ролей и повторное
      ревью на `xhigh` дольше. Таймаут терял всё: ни вердикта, ни второго прохода
- [x] `src/config/defaults.js` — у каждой стадии есть `timeoutMs` (null); у `review` —
      `repairRounds: 2`
- [x] `src/config/validate.js` — проверка `timeoutMs` и `repairRounds`
- [x] `src/pipeline.js` — `budgetOf()`: бюджет стадии важнее бюджета прогона
- [x] `src/stages/review.js` — находки первого прохода пишутся на диск до ремонта; ремонт
      повторяется, пока дефекты остаются (не больше `repairRounds`); починенные шаги
      ревьюятся заново
- [x] `test/review.test.js` — тест: находки на диске до ремонта; тест: ремонт повторяется;
      тест: ремонт останавливается по кругам
- [x] `test/process.test.js` — тест: у стадии свой бюджет
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 394 теста, все проходят; `npm run check` — 155 из 155

### step-67 — Планировщик без шагов спрашивается ещё раз — в канале инструмента
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): стадия `plan` вернула пустой план —
      `{"questions": [], "risks": [], "steps": [], "summary": "..."}` — и прогон умер на
      третьей стадии из четырнадцати («Планировщик не вернул ни одного шага»)
- [x] Причина: профиль `minimax/minimax-m3.1-flash` прибивает ответ к JSON
      (`schemaChannel: 'format'`). Модель, прибитая к JSON, отвечает скелетом схемы и не
      зовёт ни одного инструмента: планировщик не измерил картинку и не прочитал проект.
      Повторный вопрос в том же канале дал тот же скелет
- [x] `src/roles/index.js` — `runRole()` принимает `schemaChannel`: стадия может сама
      прибить канал схемы роли (`tool` — ответ едет инструментом)
- [x] `src/stages/plan.js` — пустой план переспрашивается в канале инструмента: модель
      работает инструментами (`call_ai_measure`, `list_files`, `read_file`) и сдаёт план
      вызовом `plan`
- [x] `src/stages/plan.js` — `PLAN_CORRECTION` называет инструменты и требование сдать
      план вызовом `plan`
- [x] `src/stages/plan.js` — пустой план — ошибка с понятным действием: что смотреть в
      конфиге и как посмотреть план отдельно (`ai-webdev plan <задача>`)
- [x] `test/stages.test.js` — тест: повторный вопрос идёт в канале инструмента; тест:
      пустой план объясняет, что делать
- [x] `test/roles.test.js` — тест: стадия прибивает канал схемы
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 411 тестов, все проходят; `npm run check` — 157 из 157

### step-68 — Измеритель не запускается, если лист измерений уже есть
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): `ai-webdev` заново запускал измерение
      картинки, хотя данные измерений уже лежали на диске — роль решала, что измерять
      надо, потому что лист измерений не находился
- [x] Причина: измеритель пишет свою поставку в `<root>/measurements/` (`measurements.json`,
      `palette.json`, `tokens.css`, `DESIGN.md`), а пути `inputs.*` в конфиге смотрели только
      в корень проекта. Лист не находился — и роль, и инструмент `call_ai_measure` решали,
      что измерений нет
- [x] `src/config/defaults.js` — пути входных данных стали списками кандидатов: корень
      проекта, потом каталог измерителя
- [x] `src/config/validate.js` — путь входа принимает строку или список непустых строк
- [x] `src/inputs/candidates.js` — первый файл, который есть, и есть вход прогона
- [x] `src/inputs/index.js` — входы ищутся по кандидатам, найденный путь остаётся в `files`;
      предупреждение называет все кандидаты
- [x] `src/inputs/measured.js` — лист на диске: поле `source` говорит, чья это картинка, а
      лист старше картинки — устаревший
- [x] `src/agent/tools.js` — `call_ai_measure` сначала смотрит на диск: лист есть — отвечает
      путём и счётчиками, измеритель не запускается; факт кладётся в контекст прогона
- [x] `src/stages/pictures.js` — обрезки ищутся рядом с найденным листом, а не в корне
- [x] `src/roles/planner.js`, `src/roles/architect.js`, `src/agent/tool-specs.js` — правило
      роли и описание инструмента говорят, что повторно измерять не надо
- [x] `test/inputs.test.js` — тест: поставка измерителя находится; тест: лист чужой картинки
      — не ответ; тест: устаревший лист; тест: путь входа может быть одной строкой
- [x] `test/tools.test.js` — тест: измеритель не запускается, когда лист есть; тест: картинка
      без листа измеряется; тест: лист измерений не отвечает на вопрос про дизайн
- [x] `test/config.test.js` — тест: путь входа может быть списком кандидатов
- [x] `test/pictures.test.js` — тест: стадия работает с найденным листом
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 422 теста, все проходят; `npm run check` — 159 из 159

### step-69 — Обработка изображений больше не забывается
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): стадия `pictures` пропустила себя
      («Лист измерений не найден: обрезки не готовятся»), хотя на диске лежали 11 обрезков
      измерителя — картинки не были подготовлены, `assets/import/` остался пустым
- [x] Причина 1: измеритель режет фрагменты раньше, чем пишет лист. Прогон измерителя умер
      после стадии обрезки — листа нет, а фрагменты уже нарезаны
- [x] Причина 2: стадия `pictures` шла до `plan`, а план — это то, что измеряет картинку.
      Обрезков свежего измерения на момент стадии ещё не существовало
- [x] `src/inputs/measuredCrops.js` — обрезки измерителя на диске: список `stages/crops.json`
      и сами файлы `crops/*.png`; `asset` → `image`, `detail` → не картинка
- [x] `src/stages/pictures.js` — лист читается заново (он мог появиться после сбора); когда
      лист не называет обрезков, берутся обрезки с диска; каталоги поставки измерителя
      ищутся по кандидатам `inputs.measurements`
- [x] `src/stages/index.js` — стадия `pictures` идёт после `plan`; лист измерений обновляется
      в контексте прогона, чтобы следующие стадии видели настоящие числа
- [x] `test/pictures.test.js` — тесты: обрезки измерителя без листа; обрезки по файлам; лист
      важнее диска; лист, появившийся после сбора; готовая картинка не готовится дважды
- [x] `test/inputs.test.js` — тесты: обрезки измерителя на диске; вид обрезки и её имя
- [x] `test/process.test.js` — тест: картинки идут после плана
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 431 тест, все проходят; `npm run check` — 160 из 160

### step-70 — Прогон не умирает на неожиданном ответе стадии
- [x] Проблема (живой прогон ForMeasure, 2026-11-15): прогон умер сразу после строки
      «▸ pictures — Prepare the pictures» — `ai-webdev: object is not iterable (cannot read
      property Symbol(Symbol.iterator))`. Ни отчёта, ни прогресса: ошибка ушла из пайплайна
      и была поймана только верхним `catch` в CLI
- [x] Причина: в ответе стадии поле `files` — это список написанных путей, и пайплайн его
      обходит. Стадия `pictures` (step-69) положила туда объект `{ measurements: ... }` —
      список листов измерений. `pipelineFiles()` обошёл объект как список и упал. Падение
      было вне `try/catch` стадии, поэтому прогон не записал ни прогресса, ни отчёта
- [x] `src/stages/pictures.js` — лист измерений возвращается в поле `sheetFile`, а не в
      `files`: у ответа стадии это имя принадлежит списку путей
- [x] `src/stages/index.js` — `apply` стадии `pictures` берёт лист из `sheetFile`
- [x] `src/pipeline.js` — `pipelineFiles()` и `stageFiles()` ждут списки, а не объекты;
      результат стадии применяется внутри защиты: стадия, чей результат не применился, —
      это упавшая стадия с записью в прогресс, а не мёртвый прогон
- [x] `src/cli/run.js` — `stageFiles()` ждёт списки
- [x] `test/pictures.test.js` — тест: в ответе стадии нет объекта в `files`, лист лежит в
      `sheetFile`
- [x] `test/process.test.js` — тесты: стадия с неожиданной формой ответа не убивает прогон;
      стадия, чей результат не применился, — упавшая стадия
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 434 теста, все проходят; `npm run check` — 160 из 160;
      тот же прогон `collect → pictures` на ForMeasure, что падал, теперь проходит

### step-71 — Направление дизайна не измеряется
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-124740`): планировщик
      позвал `call_ai_measure ["design", "landing.png"]` — и прогон на шесть минут встал,
      пока измеритель прогонял свою стадию `design`. При этом `measurements/DESIGN.md` уже
      лежал на диске с 12:47:26: токены референса были измерены
- [x] Причина: команда `design` измерителя — это не то же, что `measurements/DESIGN.md`.
      Токены пишет стадия `resolve`, а `design` смотрит на референс и на `DESIGN.md` из корня
      и пишет направление в `.tmp/<workId>/design.json` — рабочий каталог измерителя, который
      вебдев не читает нигде. Вызов был чистыми издержками: результат никто не открывал.
      Свой предохранитель измерителя (`shouldRunDesign`) обходится явным запросом
      (`u2ai-measurer/src/shared/pipeline.js:190`), а описание инструмента само предлагало
      этот вызов (`src/agent/tool-specs.js`)
- [x] `src/agent/tools.js` — мост не зовёт команду `design`: отвечает внятно, где лежат
      токены референса, и измеритель не запускает
- [x] `src/agent/tool-specs.js` — описание `call_ai_measure` больше не предлагает `design`:
      примеры — `["measure", …]` и `["palette", …]`
- [x] `test/tools.test.js` — тесты: команда `design` не запускает измеритель; описание
      инструмента не предлагает эту команду
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 435 тестов, все проходят; `npm run check` — 160 из 160

### step-72 — Разметка и стили говорят на одном языке
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-125753`): ревью отдало
      `index.html` роли `markup`, и та переписала файл целиком, переименовав классы
      (`.hero-card__title` → `.hero__headline`, `.icon-button` → `.round-button`,
      `.site-menu__trigger` → `.menu-trigger`). `styles.scss` остался от прежней разметки:
      32 класса из 51 в разметке не имели ни одного правила, 23 селектора стилей не
      находили ни одного элемента. До починки было 44 класса без стилей — 5
- [x] Причина: проверки «класс разметки есть в стилях» в пайплайне не было вообще. Ревьюер
      оценивал шаг по его критериям (токены, геометрия, повороты) и не смотрел, применяются
      ли правила к элементам. Починка переименовывала классы молча: запрос ремонта не говорил,
      что имена классов — это контракт со стилями
- [x] `src/agent/markup-styles.js` — новое: `markupClasses()` (классы разметки),
      `styleClasses()` (классы селекторов стилей; вложенность SCSS разворачивается,
      `&__title` внутри `.card` — это `.card__title`), `checkMarkupStyles()` (классы без
      правил и правила без классов) и `renamedClasses()` (класс, который исчез из разметки,
      но остался в стилях)
- [x] `src/stages/project-files.js` — новое: файлы разметки и файлы стилей проекта (из
      плана по ролям, а при молчании плана — по диску)
- [x] `src/stages/review.js` — перед каждым кругом ремонта harness проверяет имена: класс
      разметки без правила — это дефект стилей (чинит `styler`), исчезнувший класс, который
      описывают стили, — это переименование (чинит `markup`, возвращая прежние имена).
      Снимок имён снимается до ремонта и после, и ремонт, переименовавший классы, ловится
      вторым кругом. Запрос ремонта (`repairText`) и роль `markup` говорят: имена классов —
      это контракт со стилями, их не переименовывают
- [x] `src/stages/styling.js` — стадия стилей предупреждает о классах разметки без правил
      и о правилах без разметки, пока стили ещё пишутся
- [x] `src/config/defaults.js`, `src/config/validate.js` — переключатель
      `stages.review.checkStyles` (по умолчанию `true`)
- [x] `test/markup-styles.test.js` — тесты: классы разметки, классы стилей (вложенность,
      комментарии, адреса, строки), проверка проекта, переименованные классы
- [x] `test/review.test.js` — тесты: запрос ремонта хранит контракт со стилями; класс без
      правила — дефект стилей; переименование — дефект разметки; ремонт, переименовавший
      классы, пойман и имена возвращены
- [x] `test/steps.test.js` — тест: стадия стилей называет классы разметки без правил
- [x] `test/config.test.js` — тест: переключатель `checkStyles` и его проверка
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 452 теста, все проходят; `npm run check` — 163 из 163

### step-73 — Приготовленная картинка вместо самодельного SVG
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-125753`): стадия
      `pictures` приготовила вырезанный из референса бейдж — `assets/import/award-badge.png`.
      Но план писался раньше и требовал `assets/award-badge.svg` («воссоздать круглую
      SVG-эмблему»), и кодировщик нарисовал его сам (`steps/s6.json`, `applied.own`):
      залитый градиентом диск вместо кольца, круговой текст на радиусе 86 px вместо края,
      обычная «h» вместо монограммы. Настоящий вырез лежал рядом и не использовался
- [x] Причина: план не знает, что картинка уже подготовлена, и просит нарисовать объект,
      который лежит на диске готовым. Роли разметки и кода тоже не сказано, что подготовленная
      картинка — это и есть ассет. Никто не проверял, что нарисованный SVG повторяет
      готовую картинку
- [x] `src/roles/planner.js` — правило: элемент измерений, чей вид `asset`, — это картинка
      референса; стадия `pictures` вырезает её, и шаг берёт готовую картинку, а не рисует
      копию (никакого SVG логотипа, бейджа или фотографии референса)
- [x] `src/roles/planner.js`, `src/stages/plan.js` — из промпта планировщика и из поправки
      `PLAN_CORRECTION` убрана команда `["design", …]`: её нет в мосте измерителя (step-71)
- [x] `src/roles/markup.js`, `src/roles/coder.js` — правило: подготовленные из обрезков
      картинки — это ассеты результата; берутся как есть, копия не рисуется и на SVG не
      меняется
- [x] `src/roles/editor.js` — правило: подготовленная картинка не перерисовывается, вектор
      нужен для того, чего в референсе нет
- [x] `src/stages/vector.js` — `preparedVectorPlan()`: SVG, имя которого совпадает с именем
      подготовленной картинки, не рисуется (шаг выпадает, если от него не осталось файлов),
      а стадия пишет в отчёт, какая картинка уже готова. Нарисованный SVG, повторяющий
      готовую картинку, тоже называется в отчёте
- [x] `test/vector.test.js` — тесты: план вектора оставляет готовую картинку в покое; стадия
      не рисует подготовленную картинку и говорит, какая готова
- [x] `test/roles.test.js` — тесты: роли разметки, кода и редактора берут подготовленные
      картинки как есть; планировщик не планирует нарисованную копию и не предлагает команду
      `design`
- [x] `test/stages.test.js` — тест: поправка планировщика не предлагает команду `design`
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 457 тестов, все проходят; `npm run check` — 163 из 163

### step-74 — Роль шага — та, что исполняет стадия
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-125753`): в плане
      `s2` («Извлечь из landing.png фигуру, доску и логотип») и `s3` («Воссоздать круглую
      SVG-эмблему award») стояла роль `planner`, а `s7` («Сверить результат с референсом») —
      роль `reviewer`. Ни одну из этих ролей не берёт ни одна стадия: шаги висели в плане
      и никто их не делал. `s3` в итоге сделал кодировщик (`steps/s6.json`, `applied.own`) —
      нарисовал свой SVG вместо готовой картинки
- [x] Причина: роль шага проверялась по реестру ролей (`ROLE_NAMES`), а не по тем ролям,
      которые реально исполняют стадии. Роль `planner` есть в реестре — и молча превращалась
      в мёртвую: `src/stages/plan.js:129-136` подставляла `'planner'` как запасную роль, и
      шаг с такой ролью просто не попадал ни в одну стадию. План обещал работу, прогон её
      не делал, и в отчёте не было ни слова
- [x] `src/stages/roles.js` — новое: `LIVE_ROLES` (живые роли и их стадии: `markup`,
      `coder`, `styler`, `editor`, `iconifier`), `liveRole()`, `stageForRole()`,
      `roleForFiles()` (роль по расширению файла) и `planRole()` (роль шага: названа,
      угадана или шаг выпадает). Файлы окружения (`package.json`, `vite.config.js`,
      `.gitignore`) не угадываются: их готовит стадия `setup`
- [x] `src/stages/plan.js` — `normalizePlan()` больше не подставляет мёртвую роль: роль,
      которую не исполняет ни одна стадия, угадывается по файлам шага, а шаг, чью роль
      угадать нельзя, уходит из плана с предупреждением (роль, файлы, кто это делает
      вместо шага). `PLAN_CORRECTION` называет живые роли
- [x] `src/roles/planner.js` — правило: роль шага — одна из пяти живых; окружение, структура
      проекта, измерение референса, подготовка картинок и ревью — не шаги, их делают
      стадии прогона
- [x] `src/agent/schemas.js` — описание поля `role` в схеме плана: пять живых ролей
- [x] `src/stages/markup.js`, `src/stages/coding.js`, `src/stages/styling.js`,
      `src/stages/vector.js`, `src/stages/iconify.js` — каждая стадия объявляет свою роль
      (`export const role`), и тест сверяет список живых ролей со стадиями: список нельзя
      разойтись с кодом незаметно
- [x] `test/stages.test.js` — тесты: мёртвая роль отдаётся роли, которой принадлежат файлы
      шага; шаг, чью роль угадать нельзя, уходит из плана с предупреждением; живые роли
      совпадают со стадиями; стадия плана говорит в отчёте, куда делся такой шаг
- [x] `test/roles.test.js` — тест: планировщику названы живые роли, и он не планирует шаг
      для роли, которая работает раз за прогон
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 462 теста, все проходят; `npm run check` — 164 из 164

### step-75 — Аудитор видит проект
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-125753`): отчёт
      аудита (`audit.json`) говорил «в проекте нет `package.json`, нет конфига Vite, нет
      точки входа JavaScript» — и всё это в проекте было (`package.json`, `vite.config.js`,
      `main.js`). Аудитор не вызвал ни одного инструмента и описал проект по задаче
- [x] Причина: у стадии аудита в контексте не было проекта. В роль уходил только текст
      задачи, список шагов плана и архитектура, а `context.design` был булевым флагом
      «дизайн есть». Свежий список файлов проекта не читался, отчёт сборки стадии `build`
      не передавался, а текст дизайна (`inputContext`) не доходил до аудитора вовсе
- [x] `src/stages/audit.js` — аудитор получает правду о проекте: свежий список файлов с
      диска (`listFiles`, глубина 4), отчёт сборки стадии (`readBuild`: разметка, скрипт,
      стили, связи, ошибки компиляции) и текст дизайна задачи (`inputContext`) вместо
      флага. Новые функции: `auditListing()`, `buildReport()`, `auditContext()`
- [x] `src/stages/audit.js` — аудитор, который не вызвал ни одного инструмента, спрашивается
      ещё раз: к запросу добавляется `AUDIT_CORRECTION` («сначала прочитай проект и
      запусти сборку, потом давай вердикт»), а схема ответа едет в канале инструментов
      (`schemaChannel: 'tool'`). Модель, прибитая к JSON-ответу (`schemaChannel: format`),
      инструменты не вызывает вовсе — для неё повтор бессмыслен, и в отчёт идёт
      предупреждение, что аудит построен на том, что прочитал сам этап
- [x] `src/roles/auditor.js` — правило: прочитать проект и запустить сборку до вердикта;
      список файлов проекта лежит в контексте задачи, и путь вне его списка не существует
- [x] Отчёт аудита (`audit.json`) помнит, что аудитор видел: `seen.files` (файлов в
      списке), `seen.tools` (вызовов инструментов), `seen.turns`, `seen.model`
- [x] `test/review.test.js` — тесты: аудитор видит файлы, которые лежат на диске; модель с
      `schemaChannel: format` не переспрашивается и получает предупреждение; аудитор без
      вызовов инструментов переспрашивается с `AUDIT_CORRECTION`; отчёт сборки и текст
      дизайна доходят до аудитора; отчёт сборы читается как текст; контекст аудита
      собирает список, сборку и дизайн; правило роли говорит «прочитай проект до вердикта»
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 469 тестов, все проходят; `npm run check` — 164 из 164

### step-76 — Каталог, названный шагом, — это не «файл не написан»
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-135057`): стадия
      `iconify` провалилась, и прогон на этом остановился: `review`, `audit` и `learn` не
      пошли. Отчёт шага `select-icons` (`steps/select-icons.json`) — `ok: false`, хотя все
      восемь иконок лежат на диске (`src/assets/icons/*.svg`), а `index.html` записан
- [x] Причина: шаг `select-icons` называет не файлы, а каталог (`src/assets/icons/`), и
      проверка `missingFiles()` ждала файл: `stat(...).isFile()` для каталога — ложь.
      Каталог попадал в список «файлы не написаны», шаг не был сделан, стадия — нет
- [x] `src/stages/step.js` — `missingFiles()`: каталог тоже считается тем, что есть на
      диске (`isFile() || isDirectory()`). Шаг, который назвал каталог иконок, сделан, когда
      каталог есть
- [x] `test/steps.test.js` — тесты: каталог не в списке недостающих файлов; шаг, который
      назвал каталог, сделан, когда каталог на диске
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 471 тест, все проходят; `npm run check` — 164 из 164

### step-77 — Порядок стадий задаёт план
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-135057`): план требует
      `create-styles` от `select-icons` (иконки — до стилей) и `add-animations` от
      `create-styles` (стили — до скриптов). Реестр стадий шёл по своему порядку:
      `markup → coding → styling → build → vector → iconify`. Стадия `iconify` therefore
      работала после `styling`, хотя план просил её раньше
- [x] Причина: порядок стадий был зашит в реестр, а зависимости шагов плана
      (`dependsOn`) не читались нигде. План, который обещает порядок, не получал его
- [x] `src/stages/plan-order.js` — новое: `PLAN_STAGES` (стадии, которые делают шаги
      плана), `planEdges()` (зависимости шагов → зависимости стадий) и `planOrder()`
      (порядок стадий, который задаёт план). Зависимости реестра между двумя
      стадиями шагов уступают плану, остальные остаются в силе (сборка — после стилей,
      ревью — после всего). Порядок реестра — правило развязки: план без зависимостей
      между стадиями порядок не меняет; круг зависимостей в плане оставляет порядок
      прежним, и прогон говорит об этом
- [x] `src/pipeline.js` — очередь стадий вместо `for...of`: план известен только после
      стадии `plan`, поэтому очередь пересобирается, когда план прочитан (в продолжении
      прогона план читается с диска до цикла). Изменённый порядок попадает в
      предупреждения прогона
- [x] `index.js` — новый модуль в публичном API
- [x] `test/plan-order.test.js` — тесты: стадии шагов известны; рёбра плана; план решает
      порядок (иконки раньше стилей, стили раньше скриптов); план без зависимостей не
      меняет порядок; круг зависимостей оставляет порядок и говорит о нём
- [x] `test/process.test.js` — тест: прогон идёт по порядку плана (markup → iconify →
      styling), хотя реестр говорил markup → styling → iconify
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 478 тестов, все проходят; `npm run check` — 166 из 166

### step-78 — Стадия пишет файлы своего шага
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-135057`): ответ роли
      `iconifier` содержал не только иконки и `index.html`, но и все семь таблиц стилей
      проекта. `applyFiles()` писал их без разбора, и стили, которые только что написала
      роль `styler`, исчезли: `_components.scss` — 12 391 байт в ответе роли и 9 807 на диске,
      `_variables.scss` — 10 297 и 1 774. Классы разметки и классы стилей разошлись, и
      страница осталась без оформления
- [x] Причина: план делит работу проекта между шагами, но код ответа роли это division не
      знал: `applyFiles()` писал каждый файл ответа, какому бы шагу он ни принадлежал
- [x] `src/stages/step.js` — границы шага: `stepScope()` (файлы шага и файлы, которые
      принадлежат другим шагам плана) и `inScope()` (файл внутри границ). `applyFiles()`
      принимает `scope` и не пишет файл, который принадлежит другому шагу: файл остаётся
      как был, а в отчёт идёт предупреждение с именем шага
- [x] Шаг, который назвал каталог, владеет и файлами внутри каталога: иконки
      `src/assets/icons/*.svg` пишутся, как и раньше
- [x] Файлы, которые не назвал ни один шаг, остаются свободными: модуль, который роль
      добавила рядом со своим шагом (`src/scripts/reveal.js`), пишется и проверяется
- [x] `test/steps.test.js` — тесты: границы шага; ответ роли не перезаписывает файл
      другого шага (стили остаются как были, файл шага пишется); сломанный файл, который
      роль написала рядом с файлами шага, всё равно проверяется
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 480 тестов, все проходят; `npm run check` — 166 из 166

### step-79 — Роль видит файлы, которые уже лежат на диске
- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-135057`): ответ роли
      `iconifier` переписал `index.html` целиком и с другими именами классов (41 класс →
      41 другой: `page` → `landing-shell`, `rail--left` → `left-rail`, `cta` →
      `cta-button`). Стили, которые писала роль `styler` под исходную разметку, к новым
      именам не подошли ни на один класс
- [x] Причина: роль не видела проекта. Модель прогона была прибита к JSON-ответу
      (`schemaChannel: format`) и не вызывала ни одного инструмента, а в запрос шага
      попадали только задача, шаг, бриф архитектора, дизайн и референс — без содержимого
      файлов. Роль писала файл, которого не видела, и называла его своими именами
- [x] `src/stages/step.js` — `visibleFiles()` (файлы шага, которые лежат на диске, и
      разметка проекта) и `filesBlock()` (блок запроса). Текст файла — это данные, а не
      инструкция: блок так и говорит. Пределы: 6 000 знаков на файл и 20 000 на блок,
      длинный файл показан с начала и помечен
- [x] Роль стилей и роль кода видят разметку проекта: классы стилей — это классы разметки,
      а `data-атрибуты` разметки — это то, что вешает скрипт
- [x] `test/steps.test.js` — тесты: роль видит файл своего шага и разметку проекта, текст
      файла назван данными; проект без файлов не получает пустой блок
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 482 теста, все проходят; `npm run check` — 166 из 166

### step-80 — Стандарт фронтенд-работы в промптах ролей
- [x] Проблема: в монолите был манифест `webDevelopment` (`src/roles/coder.js`) — один текст,
      который подставлялся в промпт роли кода и роли стилей. В новом пакете такого
      стандарта нет: у каждой роли свои правила, а общего правила фронтенд-работы нет —
      каскад, вложенность и слои не сказаны нигде
- [x] Причина: манифест монолита не перенесли. Кое-что из его правил совпадает с правилами
      ролей нового пакета, а сам текст устарел: `transition: all`, сброс на `*`, BEM как
      способ управления специфичностью
- [x] `src/roles/web-development.js` — новое: `WEB_DEVELOPMENT` (стандарт целиком) и
      `webDevelopment(role)` (часть стандарта под роль). Три части: правила каждого файла,
      правила разметки, правила стилей
- [x] Стандарт обновлён под платформу сегодня:
      - каскад держат слои (`@layer reset, base, theme, layout, components, utilities;`), а не
        специфичность; правило вне слоя попадает в последний слой и выигрывает всё
      - правила блока живут во вложенности (`&:hover`, `&__title`), а не в плоском списке
        селекторов
      - сброс называет элементы, а не `*`: сброс на `*` не уступает нижнему слою и не
        перебивается веб-компонентом
      - дефолт, который должен проиграть, написан через `:where()`; `:not()` вместо
        отменяющего правила; `@scope`, когда важен ближайший предок
      - логические свойства (`margin-inline-start`, `padding-block`, `inline-size`)
      - компонент спрашивает `@container`, а не ширину окна; сетка, которая выравнивается
        по сетке родителя, — `subgrid`
      - в `transition` называются свойства: `transition: all` анимирует и те свойства,
        которые не имелись в виду
      - эксперименты платформы (за флагом, за origin trial, из черновика) не используются
- [x] Роли: `markup` и `coder` получают правила каждого файла и правила разметки, `styler` —
      правила каждого файла и правила стилей. Словарь слоёв в правилах роли стилей приведён
      к тому же списку, что и в стандарте
- [x] `index.js` — стандарт в публичном API
- [x] `test/roles.test.js` — тесты: фронтенд-роли получают стандарт, а остальные — нет;
      роль получает часть своего ремесла; в стандарте есть слои, вложенность, `:where()`,
      контейнерные запросы, логические свойства и сброс без `*`; правила монолита, которые
      ещё верны, остались
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 486 тестов, все проходят; `npm run check` — 167 из 167

### step-81 — Источники документации: страницы и карта имён
- [x] Проблема: в новом пакете роль получает только тексты стандартов, которые лежат в
      пакете (`src/agent/docs.js`). Страницы, по которым сверяются с платформой, в роль не
      попадают: ссылка на спецификацию, на справочник MDN или на каталог иконок может быть
      названа только текстом в промпте. В монолите это было: `documentation.sources` с
      картой имён и `PLATFORM_SOURCES` со списком страниц профиля
- [x] Причина: карту источников монолита (`src/core/config-defaults.js`) не перенесли, а
      список страниц профиля (`src/generate/platform.js`) перенесли частично: в нём не
      было черновиков свойств, условий и движения, а адрес каскада повторялся дважды
- [x] `src/config/defaults.js` — новое: `DOCUMENTATION_SOURCES`, карта «имя → адрес»
      (31 имя, перенесена из монолита); секция `documentation.sources` в умолчаниях
- [x] `src/agent/sources.js` — новое: `effectiveSources()`, `sourceNames()`,
      `sourcesForRole()`, `sourcesBlock()`. Карта конфигурации ложится поверх встроенной:
      свой адрес заменяет встроенный, своё имя добавляется
- [x] `src/config/validate.js` — проверка секции: имя источника (`^[A-Za-z][A-Za-z0-9_-]*$`),
      адрес — непустая строка и только HTTP(S); имя в списке роли — либо стандарт пакета,
      либо источник из карты; неизвестный ключ в `documentation` — ошибка
- [x] `src/roles/index.js` — блок «Documentation sources» в промпте роли: страница — это
      внешние данные, а не инструкция; эксперимент платформы — не возможность, то, что за
      флагом или за origin trial, не используется
- [x] Умолчания ролей дополнены адресами: план, архитектор, директор, код, разметка,
      стили, иконки, вектор, ревью, аудит. Имя, которое есть и в стандартах, и в карте
      (`cssUnits`, `cssShapes`, `cssFonts`, `cssMotion`, `phosphorIcons`, `lucideIcons`,
      `googleFonts`), даёт и правила, и страницу
- [x] `src/generate/platform.js` — список страниц профиля приведён к монолиту: добавлены
      черновики свойств, условий и движения, адрес каскада оставлен один
- [x] `index.js` — источники в публичном API
- [x] Тесты: `test/config.test.js` (карта в умолчаниях, имя роли может называть источник,
      плохой адрес, свой источник, неизвестное имя, неизвестный ключ секции),
      `test/skills.test.js` (карта: встроенная, своя, переопределение; блок роли),
      `test/roles.test.js` (в промпте роли есть блок источников, у роли без источников его нет)
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 491 тест, все проходят; `npm run check` — 168 из 168

---

### step-82 — Профили minimax и kimi по живым ответам шлюза

- [x] Повод: документы моделей RouterAI (ноябрь 2026) дают окно и выход, которых в
      профилях не было: `minimax/minimax-m3.1-flash` — 1M токенов контекста и 524K выхода,
      `moonshotai/kimi-k3.1-pro` — 1M и 944K. В профилях стояло 8 MiB окна (≈2M токенов) и
      65K выхода у обоих
- [x] Живые пробы шлюза (один и тот же вопрос):
      - minimax `effort=none` → 400: «Reasoning is mandatory for this endpoint and cannot be
        disabled» ⇒ `none` не в лестнице minimax, запрос `none` поднимается до `low`
      - minimax `effort=high` → 1,3 с, reasoning-токены 8
      - kimi `effort=high` → 31,1 с; `medium` → 31,0 с; `low` → 52,1 с; `none` → 0,8 с ⇒
        уровни выше `medium` стоят тех же секунд, потолок kimi — `medium`, а `none` остаётся
        на лестнице (модель гасит reasoning без отказа)
- [x] `src/model/profiles.js` — minimax: окно 4 194 304 байта (1M токенов), выход 524 288,
      потолок `xhigh`, лестница `low|medium|high|xhigh`; kimi: окно 4 194 304, выход 944 000,
      потолок `medium`, лестница `none|low|medium`
- [x] `test/responses.test.js` — тест на профили: окно, выход, потолок, лестница; `none`
      у minimax поднимается до `low`, у kimi остаётся `none`
- [x] README (EN), planned.md (RU)
- [x] Проверка: `npm test` — 492 теста, все проходят

---

### step-83 — Gemini 4 Hydrogen вместо kimi, kimi — как fallback

- [x] Повод: карточка модели `google/gemini-4-hydrogen` на RouterAI (ноябрь 2026) — 1M токенов
      контекста, до 1M токенов выхода с продолжением, уровни усилия `low|medium|high|xhigh`.
      Kimi становится моделью-фолбэком, а Gemini — основной альтернативой
- [x] Живые пробы шлюза (2026-11-15):
      - `POST /v1/responses` с `text.format` (json_schema) → 200, ответ по схеме
        (`{"answer": "42"}`)
      - `POST /v1/responses` с инструментом → 200, ответ `function_call`
      - `POST /v1/responses` с `reasoning.effort = xhigh` → 200, 305 reasoning-токенов
      - `POST /v1/chat/completions` с `response_format` (json_schema) → 200, ответ по схеме
      ⇒ канал схемы `auto`: при инструментах схема едет своим инструментом, без них — в
      `text.format`
- [x] `src/model/profiles.js` — профиль `google/gemini-4-hydrogen`: окно 4 194 304 байта
      (1M токенов), выход 1 048 576, потолок `xhigh`, лестница `low|medium|high|xhigh`,
      канал схемы `auto`; уровня `none` у карточки нет — запрос `none` поднимается до `low`
- [x] `src/config/defaults.js` — цепочка фолбэков дома: у Gemini и у всех прочих моделей
      первым идёт kimi (`fallback.models`); модель по умолчанию остаётся minimax
- [x] `test/responses.test.js` — профиль Gemini, срез усилия, цепочка фолбэков;
      `test/roles.test.js` — роль работает на Gemini
- [x] README (EN): таблица профилей, цепочка фолбэков, пример конфигурации
- [x] Проверка: `npm test` — 493 теста, все проходят

Замечание: механизм фолбэка моделей в `u2ai-webdev` (`src/openai/fallback.js`) пока не вшит в
клиент — цепочка объявлена в конфигурации и читается этим модулем. В пакетах, где фолбэк
включён в клиент (`u2ai-measurer`, `u2ai-decomposer`, `u2ai-server`), цепочка работает сразу.

---

### step-84 — У прогона есть глаза: страница снимается и сравнивается с референсом

- [x] Проблема (живой прогон ForMeasure, 2026-11-15, прогон `20261115-135057`): стилизатор
      писал CSS по цифрам измерений, не видя результата. На странице тип в 120 px вылезал за
      колонку, рельсы разъезжались, горизонтальная прокрутка шла через весь экран — и
      ничто в прогоне этого не показывало: снимка страницы не снимал никто
- [x] Причина 1: в `u2ai-webdev` не было инструмента браузера вообще. Единственный источник
      картинок — референс дизайна; своего результата прогон не видел никогда
- [x] Причина 2: ревью принимало `screenshots`, но никто их не снимал и не передавал — параметр
      был пуст всегда
- [x] Причина 3: роль, чинившая стили по замечаниям ревью, получала только текст замечания.
      Дефект вёрстки — это картинка, а не строка
- [x] `src/agent/browser.js` — новое: движок (`ego-browser` — движок дома, иначе headless
      Chrome/Edge), поиск движка в PATH и в обычных местах, аргументы headless-вызова,
      локальный HTTP-сервер проекта (`file://` ломает модули и fetch современного проекта)
- [x] `src/agent/tool-specs.js`, `src/agent/tools.js` — инструмент `screenshot`
      (`configKey: browser`): снимает страницу проекта и называет файл картинки; роли
      `styler` и `editor` могут смотреть на страницу посреди работы
- [x] `src/stages/vision.js` — новое: `shootPage()` (страница → PNG в `.ai/shots/`),
      `visionPrompt()` (запрос роли: сравни снимок с референсом и почини стили),
      `visionEnabled()` (`off` | `auto` | `always`)
- [x] `src/stages/sight.js` — новая стадия `sight` после `build`: страница собрана, значит её
      уже можно смотреть. Стадия снимает страницу, отдаёт снимок и референс роли `styler`,
      принимает её правки и снимает страницу снова. Круг ограничен
      `browser.stylingVisionRounds`; страница, которую не открыть, — это предупреждение, а не
      падение прогона
- [x] `src/stages/review.js` — ревьюер видит снимки результата рядом с референсом; роль,
      чинящая стили, получает те же картинки (`repairIssues({ parts })`): дефект вёрстки виден
      глазами
- [x] `src/stages/sight.js` — заметки роли о странице кладутся в контекст прогона
      (`the page`): что осталось отличаться от референса. Поздние стадии читают это и знают,
      как выглядит страница, не видя картинки
- [x] `src/config/defaults.js`, `src/config/validate.js` — секция `browser`: `engine`
      (`auto` | `ego` | `chrome`), `executable`, `timeoutMs`, `viewport`, `stylingVision`,
      `stylingVisionRounds`; переключатель `tools.browser`
- [x] `src/stages/index.js`, `src/config/constants.js` — стадия `sight` в реестре и в перечне;
      `review` зависит от неё и получает её снимки
- [x] README (EN): раздел «The eye of the run», стадия в таблице пайплайна, секция `browser`
      в описании конфигурации
- [x] Проверка: `test/browser.test.js` (движки, аргументы, сервер, включённое зрение),
      `test/sight.test.js` (стадия снимает страницу, отдаёт картинку роли, её правка попадает
      на диск; страница, которую не открыть, — предупреждение), `npm test` — 573 теста, все
      проходят; `npm run check` — 187 из 187; живая проверка: страница снята headless Chrome,
      картинка открыта и показывает сломанную вёрстку верно

### step-96 — Картинки: перебор моделей и тир качества

- [x] Проблема: обрезок (`award-badge.png` и другие) готовился **одной** моделью и **одной**
      попыткой — розыгрыш: то край аккуратный, то «жеваный». Модель `gpt-image-2.6-sunburst`
      рисует тот же объект плавнее, и она не спрашивалась вовсе
- [x] `src/stages/pictures.js` — `pictureModels()`: список моделей, которых спрашивают
      (`pictures.models`; по умолчанию — `bytedance-seed/seedream-5-5` и
      `openai/gpt-image-2.6-sunburst`; `pictures.model`, если он назван, идёт первым)
- [x] `src/stages/pictures.js` — `pictureQuality()`: тир качества (`pictures.quality`, по
      умолчанию `high`) уходит в CLI как `--quality`, а тот пишет его в тело запроса полем
      `quality` — только для моделей, которые его знают (gpt-image; seedream и riverflow поля
      не видят)
- [x] `src/stages/pictures.js` — `judgePicture()`: факты картинки через `ai-image info --json`
      (сколько кадра очищено, сколько в мягкой полосе края, настоящий ли альфа-канал) —
      локальная проверка, без запроса к модели
- [x] `src/stages/pictures.js` — `pickPicture()`: побеждает настоящая вырезка, потом самый
      узкий край, потом больше очищенного; без фактов побеждает порядок моделей
- [x] `src/stages/pictures.js` — каждый обрезок готовится всеми моделями списка, кандидаты
      лежат в рабочем каталоге прогона, в проект попадает лучший; в отчёте стадии и в ответе
      роли — какая модель победила и какие были спрошены
- [x] `src/cli/renderer.js` — консоль показывает каждую попытку и победителя
- [x] `src/config/defaults.js`, `src/config/validate.js` — `pictures.models`, `pictures.quality`
- [x] Проверено телом запроса: `gpt-image-2.6-sunburst` → `{"quality":"high"}` (и `xhigh` по
      просьбе), `seedream-5-5` → поля `quality` нет вовсе; `--quality` от CLI доходит до
      `overrides.image.quality` → `qualityOf()` → `snapQuality()` → тело запроса
- [x] Проверка: `test/pictures.test.js` — 23 теста (список моделей, тир, выбор лучшего,
      безопасное имя модели, оба моделя спрошены, `--quality` в аргументах, sunburst с более
      узким краем побеждает); полный прогон — 636 тестов, все проходят; `npm run check` — 203/203

### step-95 — Data URL из текста — в картинку или файл
- [x] `src/shared/data-urls.js` *(новый, в обоих пакетах)* — `scrubDataUrls()` вырезает
      каждую `data:`-строку из текста и заменяет её коротким пояснением
      (`[picture attached: image/png, 12.4 KB]`); `scrubItems()` то же для разговора;
      `assetPart()` собирает часть запроса: картинка → `input_image` (с `data:` URL),
      файл → `input_file` (`file_data` в base64 + `filename`), текст → `input_text`
- [x] `src/shared/data-urls.js` — `sniffType()`: **имя вызывающего — это claim, а байты — факт**.
      Дом смотрит на содержимое и сам решает, что это: PNG, JPEG, GIF, WebP, BMP, ICO, TIFF,
      QOI, AVIF, HEIC, PDF, ZIP, GZIP, 7-Zip, RAR, ELF, EXE, WASM, OGG, WAV, AVI, MP4 —
      по первым байтам; текст — когда в нём нет нулевого байта и управляющих символов;
      JSON, HTML и SVG — по началу; полезная нагрузка, которая называет себя base64, но не
      переживает круг-через-кодирование, читается как текст, которым она является
- [x] Записка называет и claim, и факт, когда они разошлись:
      `[picture attached: application/octet-stream → image/png, 317.8 KB]`
- [x] `src/openai/responses.js` — сборщик запроса: инструкции, текст запроса и готовые items
      разговора чистятся; найденные данные едут в запрос частями (в items — сообщением в
      конце). Это **сетка**: мимо неё не проходит ни один текст, который уходит из дома
- [x] `src/roles/index.js` — ответ инструмента (`function_call_output`) чистится сразу, данные
      едут в запрос следом частью: роль видит то же, но текст не несёт base64
- [x] `src/openai/chat.js` — конвертер чата понимает `input_file` и в новом виде
      (`file_data` + `filename` наверху), и в старом (`file: {file_data}`)
- [x] `u2ai-server` — тот же модуль, тот же сборщик, тот же цикл роли
- [x] Проверка: `test/data-urls.test.js` (14 тестов в каждом пакете): картинка → картинка,
      файл → файл с именем, текст → текст, картинка под именем «блоб» → картинка, бинарник под
      именем «текст» → файл, json под именем «блоб» → текст, подделка base64 → текст, сигнатуры
      форматов, все три в одном сообщении, слова без data URL не трогаются, разговор
      чистится, запрос несёт картинку частью; полные прогоны: `u2ai-webdev` — 632 теста,
      `u2ai-server` — 482 (+1 пропущенный), все проходят; `npm run check` — 203/203 и 101/101

### step-94 — Chrome DevTools MCP: браузер, с которым можно говорить

- [x] Проблема: MCP-клиент дома был (`src/agent/mcp.js`), но серверы **никогда не
      подключались**: `mcp.servers` только проверялся конфигом, `connectMcpServers` не
      вызывался нигде, а `createToolset({mcp})` никто не передавал. Плюс у дома не было
      второго глаза: `screenshot` показывает, как страница выглядит, но не как она
      работает — открывается ли меню, отправляется ли форма, что падает по клику
- [x] `src/agent/mcp.js` — stdio-сервер на Windows: программа ищется через `findProgram`
      (шим `npx.cmd` — это пакетный файл, он идёт через `cmd.exe`), окружение сервера
      **добавляется** к окружению машины (иначе теряется PATH), stderr сервера читается
      (труба не переполняется и сервер не встаёт), таймаут вызова настраивается
- [x] `src/agent/devtools.js` — сервер дома: `chrome-devtools-mcp@1.13.0`, флаги
      `--headless --isolated --viewport=WxH --executablePath=<Chrome> --no-usage-statistics
      --no-performance-crux`; установленная программа идёт первой, `npx` — запасной путь;
      список из 11 инструментов (не 60: каждый инструмент — схема в каждом запросе)
- [x] `src/agent/devtools.js` — `firstPageId()`: дом спрашивает список страниц один раз и
      подставляет номер страницы в вызовы — роль не тратит ход на это
- [x] `src/agent/tools.js` — маркер `mcp:<сервер>` в списке инструментов роли; вызов MCP с
      подстановкой `pageId` и повтором при «No page found»; картинки из ответов сервера
      пишутся в `.ai/shots/` и называются в ответе (цикл роли вернёт их в разговор)
- [x] `src/roles/index.js` — инструменты MCP достаются роли через контекст прогона
      (`runContext.mcp`), конфиг едет с контекстом в промпт
- [x] `src/pipeline.js` — `connectServers()`: серверы конфига + браузер DevTools; серверы
      закрываются в конце прогона
- [x] `src/roles/devtools.js` — правила для ролей: снимок дерева до клика, `uid` из
      снимка, скрипт читает и не пишет, `get_css_styles` отвечает, какое правило выиграло
- [x] `src/roles/{styler,coder,editor,reviewer}.js` — маркер и правила
- [x] `src/config/defaults.js`, `src/config/validate.js` — `browser.devtools` (`off`/`auto`/
      `always`), `devtoolsPackage`, `devtoolsCommand`, `devtoolsArgs`, `devtoolsTools`,
      `devtoolsTimeoutMs`
- [x] Живая проверка (2026-11-17): сервер поднялся за **374 мс** (глобальная установка),
      11 инструментов; на живом Hubfolio: `navigate_page` → страница открылась,
      `take_snapshot` → дерево с uid (`1_4` — кнопка меню), `get_css_styles` → «правило
      `.menu-toggle` (`<style>:375`)» с настоящим значением, `list_console_messages` →
      404 favicon, `evaluate_script` → `{"width":1024,"height":768}`, `take_screenshot` →
      картинка в `.ai/shots/`
- [x] Проверка: `test/devtools.test.js` (8 тестов), полный прогон — 617 тестов, все
      проходят; `npm run check` — 200 из 200

### step-93 — Референс виден в прогоре, а картинка различий не подменяется

- [x] Проблема (из живого прогона `ai-webdev run --resume 20261116-195518`): консоль молчала
      о сверке — было видно `read_skill`, `web_guidance`, `batch`, и складывалось впечатление,
      что проект и не знает про `landing.png`; картинка различий называлась всегда
      `diff-<референс>.png`, поэтому следующая сверка (её делала уже роль через
      `compare_images`) **затирала** ту картинку, которую роль в этот момент смотрела —
      «в diff взял что-то не то за основу»; страница снималась на ширине дизайна, но на
      высоте окна (900), а картинка референса — 768: сравнение шло с обрезкой, и вертикальное
      центрирование страницы давало лишние расхождения
- [x] `src/agent/image-compare.js` — имя картинки различий несёт картинку страницы:
      `diff-<референс>-<снимок>.png`; следующая сверка пишет свой файл
- [x] `src/stages/sight.js` — страница снимается на **полном размере дизайна**
      (`ширина x высота`): картинка страницы и картинка референса одного размера, сравнение
      идёт один к одному
- [x] `src/stages/sight.js` — событие `stage.compare` (референс, PPI, размер дизайна, числа,
      картинка различий) и `stage.shot` с размером; факт `the comparison` пишется в контекст
      **сразу после сверки**, а не после ответа роли: прерванная стадия не теряет числа
- [x] `src/cli/renderer.js` — консоль показывает сверку: `сверка с референсом landing.png: PPI
      1x, ширина дизайна 1024x768 CSS px`, сходство, RMSE, SSIM и путь картинки различий
- [x] `src/stages/vision.js` — подсказка роли называет и высоту дизайна и говорит снимать
      свою картинку того же размера
- [x] `src/config/defaults.js` — `stages.sight.timeoutMs` = 30 минут: стадия зрения делает
      два прохода с моделью и на общем лимите 15 минут обрывалась («This operation was
      aborted» в шести прогонах подряд)
- [x] Живая проверка на Hubfolio: та же страница и тот же референс — 81% при 1024×768
      против 73% при 1024×900 и 73% при 1440×900; высота окна меняет центрирование, а с ним
      и результат
- [x] Проверка: `test/image-compare.test.js` (11 тестов: уникальное имя картинки, размер
      дизайна по ширине и высоте), `sight`, `vision`, `cli` — 52 теста, все проходят;
      `npm run check` — 198 из 198

### step-92 — Сверка с референсом при одном размере и перебор PPI

- [x] Проблема: сверки пикселей не было вовсе — `comparePictures` был заявлен в
      `@exports` файла `src/stages/vision.js`, но не написан; референс и снимок страницы
      просто уезжали в один запрос, и роль сравнивала их глазами. Ширина дизайна была только
      прозой для модели («картинка 2304 может быть 2× от 1152»), а разные размеры картинок
      не сравнивались никак
- [x] `src/agent/image-magick.js` — два бэкенда с одинаковыми ответами:
      **нативный** (`magick` из PATH или из папки установки `ImageMagick-*`) и **wasm**
      (`@imagemagick/magick-wasm`, optionalDependency); `parseMetric()` читает число метрики
      из ответа (`41443 (0.63238)`); картинки приводятся к одному размеру с сохранением
      пропорций (`-resize WxH^ -extent WxH`)
- [x] `src/agent/image-compare.js` — ядро сверки: `scaleCandidates()` (гипотезы PPI:
      1x, 1.5x, 2x, 3x), `pickScale()` (выбор по ширине страницы: 2880px → 2× при цели
      1440px, 1024px → 1×), `similarityOf()` (процент сходства), `compareWithReference()`
      (замер всех кандидатов + картинка различий в `.ai/shots/diff-*.png`)
- [x] `src/stages/vision.js` — реализован `comparePictures()`, добавлены `comparisonNote()`
      (текст чисел для роли) и `designWidth()` (ширина дизайна по референсу и цели)
- [x] `src/stages/sight.js` — страница снимается **на ширине дизайна**, после снимка идёт
      сверка, числа уходят в промпт, картинка различий — в запрос роли, числа — в контекст
      прогона (`the comparison`) и в отчёт стадии
- [x] `src/stages/review.js` — `compareReview()`: сверка в ревью, числа в блоке ревьюера,
      картинка различий едет вместе со снимками и референсом
- [x] `src/agent/tool-specs.js`, `src/agent/tools.js` — инструмент `compare_images`
      (референс, снимок, ширина) для ролей `styler`, `reviewer`, `editor`
- [x] `src/config/defaults.js`, `src/config/validate.js` — `browser.compare`
      (`off`/`auto`/`always`), `browser.compareDprs`, `browser.compareAtDesignWidth`,
      `tools.compare`
- [x] `package.json` — `@imagemagick/magick-wasm` в `optionalDependencies` (запасной
      бэкенд; нативный ImageMagick предпочтительнее)
- [x] README (EN): раздел «The comparison with the reference»
- [x] Проверка: живая — на Hubfolio: ширина дизайна 1024 (1x), снимок страницы на 1024,
      сверка 73% сходства (RMSE 0.2667, SSIM 0.1790), картинка различий 234 КБ показала
      перекрытие тегов справа; нативный и wasm бэкенды дали одинаковые числа
      (rmse 0.63238 / 0.6323795); тесты `test/image-compare.test.js` (9), `review`, `sight`,
      `vision`, `tools`, `roles`, `config`, `economy` — 132 теста, все проходят;
      `npm run check` — 198 из 198

### step-91 — Экономия токенов: адрес строки, патч, пакет

- [x] Проблема: роль, чтобы поменять одно правило, читала файл целиком и переписывала его
      целиком — платила за весь файл в каждом ходу и платила снова при проверке
- [x] `src/agent/fs-tools.js` — `findLines()`: номер строки по тексту (или по регулярному
      выражению), с диапазоном поиска и числом совпадений; `patchFile()`: правка строк **по
      номерам** (`startLine`/`endLine`/`text`), снизу вверх, поэтому номера нетронутых строк
      сохраняются; проверка до записи (патч несуществующей строки не меняет ничего), старая
      версия — в бэкап
- [x] `src/agent/tool-specs.js` — три новых инструмента: `find_line`, `patch_file`, `batch`
- [x] `src/agent/tools.js` — случаи `find_line`, `patch_file`, `batch`; белый список `BATCH_TOOLS`
      (только работа с файлами, без самого `batch`, без команд и мостов), максимум 50 действий
- [x] `src/agent/tools.js` — **момент чтения** в контексте прогона: `read:<path>` хранит файл,
      диапазоны прочитанных строк, время каждого чтения и время первого; второе чтение не
      затирает первое; запись сбрасывает факт (прочитанное — уже не то, что на диске)
- [x] `src/roles/economy.js` — правило экономии для ролей; подключено в `styler`, `coder`,
      `markup`: читать диапазон, искать номер строки через `find_line`, править через
      `patch_file`, группировать действия в `batch`; текст «почини» в этих ролях больше не
      просит переписать файл целиком
- [x] README (EN): раздел «The economy of the run»
- [x] Проверка: `test/economy.test.js` (9 тестов: поиск строки, патч, сохранение номеров строк,
      отказ при неверной строке, момент чтения, накопление диапазонов, сброс при записи,
      пакет, белый список, роли знают дешёвый способ), `test/tools.test.js`, `test/roles.test.js` —
      60 тестов, все проходят; `npm run check` — 195 из 195

### step-90 — Движок называется `ego`, и снимок делает headless

- [x] Проблема: движок искался как `ego-browser`, а на машине стоит `ego`
      (`C:\Program Files\Citro Labs\ego lite\Application\ego.exe`, версия 0.6.3.14) — прогон
      его не находил и уходил в headless Chrome, не зная, что ego lite рядом
- [x] Живая проверка (2026-11-16, ~30 с): `ego --help` открывает окно браузера;
      `ego skill` молчит; `ego nodejs -e …` подключается к уже открытой сессии и **не отдаёт
      результат скрипта** в stdout/stderr ⇒ протокол ego не годится для headless-снимка
- [x] `src/agent/browser.js` — поиск: имя `ego` (`ego.exe`, `ego.cmd`) + папки установки
      (`Citro Labs\ego lite\Application`, `~/.local/bin`, `~/.local/share/ego`, `ego lite.app`)
- [x] `src/agent/browser.js` — `resolveEngine()`: `auto` берёт **headless Chromium** (снимок
      делает он), `ego` — только по явному `browser.engine: "ego"`, `chrome` — Chromium.
      Движок больше не врёт в отчёте о том, кто снял страницу
- [x] `u2ai-server/src/tools/browser.js` — то же имя и тот же выбор движка
- [x] `src/agent/browser.js` (монолита) — имя `ego` в поиске (монолит помечен как deprecated)
- [x] README (EN) обоих пакетов, комментарии в коде, `planned.md`
- [x] Проверка: живая — движок найден (`ego.exe`), `auto` → chrome, dev-сервер поднят,
      страница снята (66 КБ), слова страницы собраны, сервер остановлен; тесты `browser` и
      `dev-server` в `u2ai-webdev` (14), в `u2ai-server` (6) — все проходят

### step-90 — Свободная дверь к CLI семейства `ai-*`

- [x] Повод: мосты (`call_ai_measure`, `call_ai_decompose`, `call_ai_image`) узкие по замыслу —
      каждый зовёт один CLI для одной работы. Роли, которой нужен флаг CLI, версия пакета или
      команда, которую мост не покрывает, не имела куда пойти, и флаги приходилось угадывать,
      а угаданный флаг стоит неудачного вызова и потерянного хода
- [x] `src/agent/cli-family.js` — каталог семейства (`ai`, `ai-webdev`, `ai-decompose`,
      `ai-measure`, `ai-image`: команда, переменная окружения, пакет, каталоги, скрипт, краткое
      описание), `familyCandidates`, `resolveFamilyCli`, `runFamilyCli` (запуск без shell,
      `.cmd` через `cmd.exe` с `quoteWindowsArg`, потолок 600000 мс), `familyPathArgs`,
      `familyOutputArg`, `familyDoc` (топики `family`, `flags`, `commands`, `all`)
- [x] `src/agent/bridges.js` — каталог мостов переехал в `agent/cli-family`: мосты и свободная
      дверь ищут бинарники одинаково
- [x] `src/agent/tool-specs.js` — новые инструменты `ai_cli` (имя CLI, аргументы, `timeoutMs`)
      и `ai_cli_help` (топик), оба под ключом `config.tools.external_cli`
- [x] `src/agent/tools.js` — `ai_cli` проверяет имя CLI, отказывает командам-серверам
      (`BLOCKING_COMMANDS`), держит пути внутри корня прогона, проверяет `--out/--output` по
      разрешённым каталогам стадии, запускает CLI и отдаёт код, stdout и stderr;
      `ai_cli_help` отдаёт руководство
- [x] `src/roles/cli-note.js` — правило дома: «спроси CLI через `ai_cli` `--help`»
- [x] роли `planner`, `architect`, `editor`, `reviewer`, `auditor`, `installer` — инструменты
      `ai_cli`/`ai_cli_help` и правило о `--help` в списке правил
- [x] `src/config/defaults.js` — `tools.external_cli: true`
- [x] `src/help.js`, `index.js` — раздел «The CLIs of the house» и публичный экспорт каталога
- [x] `test/cli-family.test.js` — 13 тестов: каталог, руководство, поиск путей и места записи,
      запуск CLI, отказ чужому CLI, отказ пути снаружи, отказ серверу, «не установлен»,
      выключатель конфигурации, роли
- [x] README (EN) — раздел «The CLIs of the house»
- [x] Проверка: `npm test` — 550 тестов, все проходят; `npm run check` — 182 файла

---
### step-89 — Логи страницы: консоль браузера и сборщик

- [x] Проблема (живой прогон ForMeasure, 2026-11-16): картинка говорит, как страница выглядит,
      но не говорит, почему она сломана. Ошибка в консоли, неудавшийся запрос и слова
      сборщика — это и есть причина
- [x] `src/agent/cdp.js` — новое: речь с браузером по Chrome DevTools Protocol. За один
      проход собираются снимок, консоль, исключения и неудавшиеся запросы (404, 500)
- [x] `src/agent/browser.js` — `screenshotPage()` отдаёт вместе с картинкой слова страницы;
      `serverAnswers()` и `waitForServer()` — проверка живого сервера
- [x] `src/stages/vision.js` — `visionPrompt()` несёт слова страницы в запрос роли
- [x] `src/stages/sight.js` — слова страницы и лог сборщика кладутся в контекст прогона
- [x] `src/stages/review.js`, `src/stages/index.js` — ревьюер получает снимки и слова
      страницы рядом с референсом
- [x] `src/agent/tools.js` — инструмент `screenshot` отвечает и картинкой, и словами
- [x] `u2ai-server` — то же в MCP-сервере дома: `src/tools/cdp.js`, `src/tools/browser.js`,
      инструмент `screenshot` с живым адресом и словами страницы
- [x] Проверка: живая проверка на Hubfolio — собраны логи Vite (`[vite] connecting…`,
      `[vite] connected`), ошибка консоли и неудавшийся запрос; `npm test` в `u2ai-webdev` —
      589 тестов, в `u2ai-server` — 468

### step-89 — Холст страницы: ширина дизайна и масштаб под окно

- [x] Повод: референс бывает и upscale, и не upscale (картинка на 2000 px может показывать
      страницу на 1440 px), и по самой картинке ширину дизайна не определить: API отдаёт
      модели уже уменьшенную картинку. Модель писала страницу в ширину окна и не знала, в
      какую ширину её верстать
- [x] `src/roles/page-frame.js` — закон кадра страницы: класс холста `page`, токен ширины
      `--real-page-width`, токен масштаба `--zoom`, `pageFrameRules` (правила разметки),
      `pageScaleRules` (правила стилей), `pageWidthNote` (предупреждение про upscale)
- [x] `src/roles/markup.js` — внутри `body` один холст с классом `page`, вся страница в нём;
      свойства холста пишут стили, а не разметка
- [x] `src/roles/styler.js` — `body { container-type: size; min-block-size: 100dvh; }`, холст
      `{ container-type: inline-size; inline-size: var(--real-page-width, 1024px); }`, масштаб
      `--zoom: calc(100cqi / var(--real-page-width, 1024px));` и `zoom: var(--zoom, 1);` на
      холсте; узкий экран не масштабируется (`inline-size: 100%; zoom: 1;`)
- [x] `src/roles/architect.js` — ширина дизайна решается один раз и живёт в токене
      `--real-page-width`; ширина картинки — не ширина дизайна: один и тот же дизайн приходит
      и на 1152 px, и на 2304 px, поэтому ширину берут по тексту (кегль основного текста
      страницы — 16..18 CSS px, размер текста в пикселях картинки делит ширину картинки)
- [x] `src/roles/reference.js` — заметка о референсе называет размер картинки в пикселях
- [x] `src/inputs/assets.js` — `imageSize` (размер картинки по её заголовку) живёт в доме;
      `src/generate/references.js` реэкспортирует его, чтобы публичный API не менялся
- [x] `src/inputs/references.js` — `readReferences` отдаёт размер каждого референса в пикселях
- [x] `src/stages/step.js`, `src/stages/architect.js`, `src/stages/review.js` — размер
      референса едет в роль (`referenceSizes`), `referenceList` печатает имя с размером
- [x] `src/generate/scaffold.js` — правило вида: у страницы есть холст с классом `page`
- [x] `test/page-frame.test.js` — 12 тестов: разметка пишет холст, стили дают ширину и
      масштаб, архитектор решает ширину, роли без фронтенда кадра не получают, заметка молчит
      без референса и предупреждает про upscale, размер картинки читается из заголовка,
      референс приезжает со своим размером
- [x] README (EN) — раздел «The frame of the page»
- [x] Проверка: `npm test` — 537 тестов, все проходят; `npm run check` — 179 файлов;
      механика сверена в Chrome: `100cqi` холста берётся от `body` (зум `0.974` при окне
      1418 px и дизайне 1440 px), холст занимает ширину окна, страница скроллится, а `body`
      без `min-block-size` схлопывается в ноль

---

### step-88 — Роль видит то, что сама сняла

- [x] Проблема (живой прогон ForMeasure, 2026-11-16): роль сняла страницу инструментом
      `screenshot` и не смогла её посмотреть — инструмент отвечает путём к файлу, а
      `read_file` на бинарном файле отказывает («Бинарный файл; этот инструмент читает только
      текст»). Роль пошла звать измеритель, чтобы увидеть собственную страницу
- [x] `src/roles/index.js` — `pictureParts()`: картинки, названные в ответе инструмента,
      читаются из проекта и уходят в разговор как `input_image`. Путь в тексте — не картинка
- [x] `src/roles/index.js` — цикл роли: после вызова инструмента картинка, которую он сделал,
      едет в разговор отдельным сообщением с просьбой посмотреть на неё
- [x] `test/roles.test.js` — тест: картинка из ответа инструмента видна следующему запросу;
      тест: путь вне проекта картинкой не считается
- [x] Проверка: `npm test` — 589 тестов, все проходят

### step-88 — Лог соседнего CLI идёт в ту же консоль

- [x] Повод: мост звал соседний CLI (`ai-image`, `ai-measure`, `ai-decompose`) и молчал:
      stdout и stderr ребёнка собирались в кучу и показывались только после конца, а прогон
      минуты-две выглядел как зависший
- [x] `src/shared/child-log.js` — закон живого лога, общий для пакетов дома, побайтово
      одинаковый в пакетах, которые его зовут: `createLineReader` (хвост чанка без перевода
      строки ждёт остатка), `splitLines`, `formatBridgeLine` (имя ребёнка в начале строки,
      длинная строка обрезается)
- [x] `src/agent/bridges.js` — `runBridge` получает `onLine` и отдаёт строки ребёнка, как
      они приходят; весь вывод по-прежнему собирается в ответе моста
- [x] `src/agent/tools.js` — инструмент моста (`call_ai_measure`, `call_ai_decompose`,
      `call_ai_image`) рассказывает прогону о строках ребёнка через `notify`
- [x] `src/roles/index.js` — `notify` доходит до набора инструментов, который создаёт роль
- [x] `src/stages/pictures.js` — стадия картинок показывает строки `ai-image` во время
      приготовления обрезков
- [x] `src/cli/renderer.js` — событие `bridge.log`: в обычном режиме строка идёт на stderr
      (stdout несёт ответ прогона), в режиме `--json` это событие `bridge.log`
- [x] `src/config/defaults.js`, `src/config/validate.js` — `bridges.<name>.log`: мост может
      молчать (`false`), по умолчанию лог живой
- [x] `src/config/env.js` — `AI_WEBDEV_BRIDGES_LOG=0` глушит лог всех мостов разом
- [x] `test/bridge-log.test.js` — 9 тестов: хвост чанка, последняя строка без перевода
      строки, живой лог моста (ребёнок ждёт файл, который появляется только после строки),
      молчащий мост, строка в рендерере, событие в режиме json, инструмент моста
- [x] README (EN) — раздел «The log of a bridge comes live», `bridges.*.log` и
      `AI_WEBDEV_BRIDGES_LOG` в таблицах конфигурации и окружения
- [x] Проверка: `npm test` — 525 тестов, все проходят; `npm run check` — 177 файлов

---

### step-87 — Передача работы между ролями: отдельная сессия

- [x] Проблема (живой прогон ForMeasure, 2026-11-16): роль, встретив чужую работу,
      описывала её вместо того, чтобы сделать или передать. Стилизатор писал правила под
      разметку, которой нет; разметчик не мог починить имя класса, о котором говорил стилизатор
      в отчёте. Переключиться между ролями было нечем: список инструментов у роли был
      закрытым, а смена роли внутри разговора — это не смена роли, а другой разговор
- [x] `src/agent/delegation.js` — новое: реестр ролей, которым передают работу (`markup`,
      `styler`, `coder`, `editor`, `iconifier`) с описанием, кому что; `delegateToolNames()` —
      инструменты получателя без самого инструмента передачи; `delegationNote()` — правило для
      ролей; `createDelegator()` — обработчик вызова
- [x] Передача — это **отдельная сессия**: `runRole` вызывается снова, у получателя своя
      история (чистая), свои инструкции, свои инструменты и свой бюджет ходов. Разговор
      вызывающей роли не продолжается
- [x] Картинка референса и контекст шага едут вместе с работой: получатель смотрит на тот же
      референс и продолжает ту же работу, а не чужой разговор
- [x] Файлы, названные получателем в ответе, пишутся на диск: диск — истина
- [x] Глубина — один уровень: делегированная роль не получает инструмент передачи; роль не
      может передать работу самой себе; неизвестная роль и пустая задача — понятный отказ
- [x] `src/roles/index.js` — цикл роли узнаёт вызов `delegate_role` и отдаёт его делегатору;
      `depth` идёт по цепочке сессий
- [x] `src/roles/markup.js`, `styler.js`, `coder.js` — инструмент `delegate_role` и правило
      о передаче в инструкциях роли
- [x] `src/agent/tool-specs.js`, `src/config/defaults.js` — описание инструмента и
      переключатель `tools.delegate`
- [x] `src/cli/renderer.js` — передача видна в консоли: кто кому и зачем
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/delegation.test.js` (реестр ролей, инструменты получателя, правило,
      отдельная сессия — разговоры не смешиваются, файлы на диске, запреты); `npm test` — 587
      тестов, все проходят

### step-87 — Юнит-тесты остаются офлайн

- [x] Повод: юнит-тесты не должны ходить в сеть: живой вызов стоит денег и молчит долго,
      а провалившийся тест об этом не говорит
- [x] `test/offline-guard.js` — гард офлайна: `fetch`, `http.request`, `https.request`,
      `net.connect` и `WebSocket` отказывают любому адресу, кроме самой машины; тот же файл
      побайтово одинаков во всех пяти пакетах дома
- [x] `package.json` — `npm test` грузит гард до тестов: `node --test --import
      ./test/offline-guard.js "test/*.test.js"`
- [x] `test/offline.test.js` — 4 теста: гард знает хосты машины, сеть выключена без флага,
      запрос наружу отказан, гард включён
- [x] Флаг пакета (`AI_<ПАКЕТ>_NETWORK_TESTS=1`) отпускает гард — живые тесты работают
- [x] README (EN) — раздел «Development»
- [x] Проверка: `npm test` — 516 тестов, все проходят; `npm run check` — 175 файлов

### step-86 — Живая страница и слова о ней: dev-сервер, консоль, логи сборки

- [x] Проблема (живой прогон ForMeasure, 2026-11-16): страница снималась не с того места.
      Проект на Vite держит стили внутри скрипта (`import './styles.scss'`), поэтому страница
      корня вообще без стилей — смотреть было не на что. Живой dev-сервер (`npm run dev` →
      `http://localhost:5173/`) показывал правильную страницу, но прогон о нём не знал
- [x] `src/stages/dev-server.js` — новое: скрипты `dev`/`start`/`serve` и `build` из
      манифеста; адрес живого сервера (конфиг или `http://localhost:5173/`); сервер, который
      уже работает, используется как есть; сервер, которого нет, поднимается прогоном и
      останавливается им же. Адрес сервера — догадка, поэтому чужой сервер на этом порту не
      берётся: живую страницу использует только проект со скриптом `dev` или с явно
      названным адресом
- [x] `src/stages/vision.js` — `shootPage()` умеет снимать и локально обслуживаемую
      страницу, и живую по адресу; `entryPage()` смотрит `dist/` первым — без сборки там
      ничего нет
- [x] `src/stages/sight.js` — перед первым снимком проект собирается (`buildProject`): без
      сборки прогон смотрел бы на устаревшую страницу и судил не те стили. Между кругами
      сборка повторяется — следующий снимок показывает правку
- [x] `src/agent/cdp.js` — новое: речь с браузером по Chrome DevTools Protocol. За один
      проход собираются снимок, консоль, исключения и неудавшиеся запросы (404, 500)
- [x] `src/agent/browser.js` — `screenshotPage()` отдаёт вместе с картинкой слова страницы;
      `serverAnswers()` и `waitForServer()` — проверка живого сервера
- [x] `src/stages/vision.js` — `visionPrompt()` несёт слова страницы в запрос роли: картинка
      говорит, как страница выглядит, а консоль и лог сборщика — почему она сломана
- [x] `src/stages/sight.js` — роль видит текущие стили (`filesBlock`): она правит файл, который
      лежит на диске, а не пишет новый; править могут только таблицы стилей проекта
      (`stylesOnly`), разметка и скрипты не тронуты
- [x] `src/stages/sight.js`, `src/agent/context.js` — слова страницы и заметки роли о
      странице кладутся в контекст прогона: поздние стадии знают, как страница выглядит и
      чем отличается от референса, не видя картинки
- [x] `src/stages/review.js`, `src/stages/index.js` — ревьюер получает снимки и слова
      страницы рядом с референсом
- [x] `src/agent/tools.js` — инструмент `screenshot` отвечает и картинкой, и словами
      страницы
- [x] `src/cli/sight.js` — новая команда `ai-webdev sight`: посмотреть на готовый проект и
      починить стили, не начиная прогон заново
- [x] `src/config/defaults.js`, `src/config/validate.js` — `browser.url`, `browser.devServer`,
      `browser.devTimeoutMs`
- [x] `src/stages/project-files.js` — запасной поиск стилей знает и простой `css`: проект без
      плана терял свои стили
- [x] README (EN), planned.md (RU)
- [x] Проверка: `test/browser.test.js`, `test/dev-server.test.js`, `test/sight.test.js`;
      `npm test` — 574 теста, все проходят; `npm run check` — 190 из 190; живая проверка на
      Hubfolio: dev-сервер найден, страница снята (262 КБ), собраны логи Vite
      (`[vite] connecting…`, `[vite] connected`), ошибка консоли и неудавшийся запрос

---

### step-86 — Закон дома: где живёт сгенерированное

- [x] Повод: пути генерации считались по-разному в четырёх местах, модель видела другие
      строки путей, чем реальные, а системы дома не умели находить работу друг друга:
      измеритель клал лист в `measurements/`, вебдев искал его по списку кандидатов и
      угадывал
- [x] `src/shared/house.js` — закон дома, общий для всех пакетов дома, побайтово одинаковый:
      `.ai/tmp/<run-id>/` — состояние прогона (умирает с прогоном), `.ai/assets/` — ассеты,
      `.ai/logs/` — логи API, `.ai/manifest.json` — контракт проекта. Контракт: одна версия
      (`manifestVersion: 1`), одна секция на систему, каждая система подписывает только свою
- [x] `src/shared/house.js` — `workRel`/`workDir`/`runStateDir`: путь состояния прогона
      считается в одном месте; конфигурация (`output.work`) может увести его из дома, но
      второго пути больше нет
- [x] `src/config/defaults.js` — `output.work` → `./.ai/tmp`, `output.assets` → `./.ai/assets`,
      `logging.dir` → `.ai/logs/api`
- [x] `src/stages/workspace.js` — `workRoot` идёт через дом; `writeJsonFile` пишет атомарно
- [x] `src/agent/context.js`, `src/agent/run-map.js`, `src/stages/pictures.js`,
      `src/inputs/crops.js` — четыре разных вычисления рабочего каталога заменены одним
      (`workRel`); модель видит ту же строку пути, что и диск
- [x] `src/inputs/candidates.js` — `findContractInput`: вход ищется по контракту проекта
      первым, кандидаты конфигурации — потом; проект, сделанный до контракта, работает
- [x] `src/stages/publish.js` — прогон подписывает свою секцию контракта: поставка (`site`),
      ассеты, картинки, написанные файлы
- [x] `src/pipeline.js` — конец прогона публикует секцию `webdev`; ошибка публикации —
      предупреждение, а не падение прогона
- [x] Атомарные записи: `src/access/fs.js` (слой доступа), `src/agent/fs-tools.js` (файлы
      модели), `src/agent/context.js`, `src/agent/run-map.js`, `src/agent/map.js`,
      `src/generate/brief.js` — файл появляется целиком, временного файла не остаётся
- [x] `src/agent/map.js`, `src/generate/brief.js` — пути дома берутся из `shared/house.js`,
      а не пишутся руками
- [x] `src/openai/client.js`, `src/cli/run.js` — лог API пишется в дом проекта, а не в
      текущий каталог процесса
- [x] `src/agent/run-map.js` — карта прогона не заходит в дом (иначе она увидела бы чужие
      прогоны)
- [x] `test/house.test.js` — 13 тестов: путь состояния прогона, дом и его каталоги, контракт
      (запись, чтение, сломанный контракт, чужая секция), поиск чужой работы по контракту,
      вход по контракту, атомарная запись, подпись прогона
- [x] README (EN) — раздел «The house of the project», поправлены пути в разделах о
      конфигурации, логе API, контексте, карте и процессе прогона
- [x] Проверка: `npm test` — 512 тестов, все проходят; `npm run check` — 173 файла

### step-85 — Файлы и JSON пакета не молчат о поломке

- [x] Проблема (по образцу `u2ai-measurer`, step-c24): ошибка файловой системы пряталась под
      «файла нет». `stat`/`lstat`/`readdir` глотали любой сбой, и прогон рапортовал пустой
      каталог там, где был отказ в доступе
- [x] `src/access/paths.js`, `src/access/native.js`, `src/agent/fs-tools.js` — «нет файла» это
      только `ENOENT`/`ENOTDIR`; отказ в доступе и ошибка устройства доходят до вызывающего
- [x] JSON пакета писался обычной записью: падение посреди записи оставляло сломанный
      `package.json`, манифест, состояние прогона, карту, запись задания или конфиг — и
      следующий запуск не мог их прочитать
- [x] `src/stages/setup.js`, `src/cli/install.js`, `src/generate/scaffold.js`,
      `src/jobs/manager.js`, `src/jobs/runner.js`, `src/config/parser.js` — весь JSON пишется
      целиком (`writeFileAtomic`)
- [x] `src/agent/context.js`, `src/stages/workspace.js`, `src/agent/run-map.js`,
      `src/shared/house.js` — массив, пришедший вместо объекта состояния, больше не принимается
      за состояние
- [x] `src/roles/index.js`, `src/agent/schemas.js` — ответ роли проверяется по схеме: сломанный
      JSON аргументов вызова не запускает инструмент, а ответ не по схеме не проходит молча —
      данные сохраняются, а проблема едет в отчёт стадии
- [x] `src/stages/plan.js`, `src/stages/architect.js`, `src/stages/setup.js`,
      `src/stages/review.js`, `src/stages/audit.js`, `src/stages/step.js` — проблема схемы
      называется в предупреждении стадии
- [x] README (EN): атомарная запись JSON, проверка ответа роли
- [x] Проверка: `test/roles.test.js`, `test/schemas.test.js`, `test/responses.test.js`,
      `test/access.test.js`, `test/generate.test.js`, `test/house.test.js`; `npm test` — 573
      теста, все проходят

### step-85 — Разметка — работа Kimi

- [x] Повод: вывод по итогам прогонов — для `markup` и разметки лучше доверять
      `moonshotai/kimi-k3.1-pro`: Kimi строит структуру страницы быстрее и вернее, чем Gemini
      4 Hydrogen, и отвечает в долю времени
- [x] `src/model/trust.js` — модель дома для ролей, у которых она есть: `markup` →
      `moonshotai/kimi-k3.1-pro`; `houseModel(role)`
- [x] `src/roles/index.js` — цепочка модели роли: пин роли (`roles.<role>.model`, флаг
      `--role <role>=<model>`) → модель дома для роли → пин `roles.default` → модель прогона.
      Пин роли не двигается никогда
- [x] `src/roles/index.js` — усилие роли срезается по профилю модели (`snapEffort`): у Kimi нет
      уровней выше `medium`, поэтому разметка работает на `medium`, как бы глубоко ни просил
      профиль стадий
- [x] Побочный эффект: канал схемы роли `markup` стал `auto` (профиль Kimi) — схема едет
      своим инструментом, а не прибитым JSON, и роль пишет файлы с первого хода
- [x] `test/trust.test.js` — модель дома для разметки, пин роли, остальные роли на модели
      прогона, срез усилия, `roles.default` не двигает разметку; `test/roles.test.js` —
      усилие роли (разметка на `medium`) и путь minimax у роли `markup` с явным пином
- [x] README (EN): раздел «The markup is a Kimi job»
- [x] Проверка: `npm test` — 499 тестов, все проходят

Отложенные решения (модель не назначена, роль работает на модели прогона):

- [ ] Стадия `vector` (роль `editor`) — векторную графику пока никто из моделей дома не
      делает нормально; вердикта нет, стадия остаётся на модели прогона
- [ ] Стадия `measure` пакета `u2ai-measurer` (роль `measurer`) — что лучше, Gemini или Kimi,
      пока не решено; стадия остаётся на модели прогона

---

### step-84 — Профиль усилия стадий поднят

- [x] Повод: профиль стадий был опущен до `medium`/`low` (шаг «reduce effort»), и роли,
      которые решают и пишут, отвечали на слишком мелком усилии — модель спешила и
      ошибалась
- [x] `src/config/defaults.js` — `STAGE_EFFORT`: `markup` и `styler` → `xhigh`, остальные
      стадии → `high`; комментарий карточки переписан под новые значения
- [x] README (EN) — пример `reasoning.stageEffort` приведён к профилю по умолчанию,
      текст рядом с ним переписан
- [x] `test/roles.test.js` — тест профиля усилия роли: разметка и стили `xhigh`, код, план,
      архитектура и установка `high`, потолок прогона и профиль роли
- [x] Проверка: `npm test` — 493 теста, все проходят

---

### step-97 — Графическая CLI и внутренний worker

- [x] Повод: `ai-webdev` вырос из линейного вывода в терминал: стадии, прогресс, живой лог
      и управление оператора больше не помещаются в одну простыню текста
- [x] `src/cli/protocol.js` — версионированный двунаправленный протокол worker-а и оболочки
- [x] `src/cli/input-state.js`, `src/cli/input.js` — общее состояние оператора для терминала и worker-а
- [x] `src/cli/worker.js`, `bin/ai-webdev-worker.js` — внутренний процесс с обычными stdout/stderr и IPC
- [x] `src/tui/{state,render,app,worker-client,cli}.js`, `bin/ai-webdev.js` — оболочка `terminal-kit`;
      строка состояния над вводом показывает модель, стадию, роль, effort, mode и шаг
- [x] `package.json` — `terminal-kit`, бинарь `ai-webdev-worker`; pipe, `--json`, `--quiet` и
      `--headless` сохраняют машинный режим
- [x] `test/worker.test.js`, `test/tui.test.js` — протокол, канал оператора, reducer и запуск worker-а
- [x] README (EN) — архитектура CLI, TUI и машинный режим
- [x] Проверка: `npm test`, `npm run check`, `git diff --check`

### step-98 — Стадия вектора: до разметки или в самом конце

- [x] Повод (живой прогон `Designed-3`, 2026-11-20, прогон `20261120-100616`): план просит
      ассеты раньше разметки (`markup` после `primary-art` и `secondary-art`), но стадия
      `vector` шла после `markup` и `coding`. Разметка ждала картинок, которых ещё никто
      не нарисовал, и прогон до `vector` не доходил: ассеты пришлось перенести из прошлого
      прогона вручную
- [x] Причина: `planOrder()` строит граф стадий по ролям шагов. Два шага одной роли,
      разделённые шагом другой роли, дают круг, которого нет в плане: шаг `setup` с ролью
      `coder` дал ребро `coding → markup`, а шаг `interactions` — `markup → coding`. Круг
      отменял порядок плана целиком, и стадии шли по реестру
- [x] `src/stages/index.js` — стадия `vector` переехала перед `markup` (зависимость — от
      `setup`): разметка подключает файлы редактора, и они должны существовать. Стадия
      `iconify` переехала после `styling` (зависимость — от `styling`): иконки ложатся в
      разметку готовой страницы, а до сборки — чтобы файлы иконок и разметка, что их
      использует, попали в бандл
- [x] `src/stages/plan-order.js` — круг больше не отменяет план: порядок реестра рвёт круг,
      остальные рёбра плана остаются в силе, прогон говорит о круге в предупреждениях.
      Новое `placeVectorStage()`: вектор стоит либо до разметки, либо в самом конце цепочки
      (после сборки и взгляда) и никогда в середине, где разметка ждёт ассеты. Новое
      `placeIconifyStage()`: иконки не встают раньше стилиста, даже если план этого просит
- [x] `test/plan-order.test.js` — тесты: круг рвётся порядком реестра и говорит о нём;
      ассеты рисуются до разметки (план с двумя шагами кодера по краям разметки); вектор не
      стоит в середине цепочки; вектор продолжения — до сборки; иконки встают после стилей
- [x] `test/process.test.js` — тест: прогон идёт по порядку плана, но иконки после стилей
- [x] README (EN) — порядок стадий и правила вектора и иконок

### step-99 — Кодер не лезет в окружение и в стили

- [x] Повод (живой прогон `Designed-3`, 2026-11-20, прогон `20261120-100616`): шаг плана
      `setup` с файлами `package.json` и `package-lock.json` был назван ролью `coder`, а роль
      `coder` исполняет стадия `coding` — то есть после `markup` и `styling`. Окружение
      приходило слишком поздно, и кодер 12 минут воевал с `npm ci` и `npm run build`, правил
      lock-файл и читал `src/styles/main.scss`
- [x] Причина: план может назвать роль, которая есть, — и тогда шаг остаётся в плане, даже
      если его файлы принадлежат окружению. Стадия `setup` готовит окружение сама, до
      разметки, и шаг кодера с манифестом был её работой, сделанной не вовремя
- [x] `src/stages/roles.js` — `planRole()`: шаг, который состоит только из файлов окружения,
      убирается из плана, кем бы ни был назван; шаг, где есть и окружение, и код, остаётся
- [x] `src/roles/planner.js` — правило планировщику: шага для `package.json`, lock-файла и
      конфига сборки не бывает, их пишет стадия `setup` до разметки
- [x] `src/roles/coder.js` — кодеру сказано: окружение не его (`npm install` и `npm ci` не
      запускать, манифест и lock-файл не менять), стили ему не читать и не менять,
      production-сборку не гонять (она работает стадии `build`, а падение сборки до стилей —
      не его дефект)
- [x] `src/agent/delegation.js` — вторые «ворота» делегации: кодер на стадии `coding` не
      отдаёт работу стилям и иконкам, пока не началась стадия `styling`
- [x] `test/stages.test.js`, `test/roles.test.js`, `test/delegation.test.js` — тесты: шаг
      окружения уходит из плана, шаг с окружением и кодом остаётся, планировщик и кодер
      знают свои границы, кодер не отдаёт стили стилеру
- [x] README (EN) — границы ролей
- [x] Проверка: `npm test`, `npm run check`, `git diff --check`
- [x] Проверка: `npm test`, `npm run check`, `git diff --check`

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
