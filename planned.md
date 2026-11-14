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
