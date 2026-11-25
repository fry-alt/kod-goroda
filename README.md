# Код города

Рабочий репозиторий команды на кейс-чемпионате МГТС «Код города».
Направление — **ИИ в бизнес-процессах**: анализ обратной связи стажёров и наставников.

## Быстрый старт

```bash
~/.local/bin/python3.12 -m venv .venv      # нужен Python ≥ 3.10
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                       # вписать YC_API_KEY и YC_FOLDER_ID (без ключей — офлайн-режим)

streamlit run app/dashboard.py             # дашборд, сразу с демо-данными
python -m feedback data/sample/feedback.csv -o out/   # CLI → out/analysis.csv, alerts.csv, stats.json, insights.json
uvicorn api.main:app --reload              # REST API, документация на /docs
pytest                                     # тесты (без обращений к API)
```

## Архитектура

```
 CSV / XLSX / JSON ──► ingest ──► analyzers ──► aggregate ──► insights ──► дашборд / API / CLI
  (любые колонки)    авто-маппинг   YandexGPT /  pandas-метрики  отчёт для HR
                     колонок        Claude /
                                    офлайн-правила
```

| Модуль | Что делает |
|---|---|
| [feedback/ingest.py](feedback/ingest.py) | Читает CSV/XLSX/JSON, сам находит колонки (текст, роль, автор, о ком, отдел, дата, оценка) по русским и английским синонимам |
| [feedback/schemas.py](feedback/schemas.py) | Pydantic-модели: входной отзыв, разметка отзыва, итоговый отчёт |
| [feedback/taxonomy.py](feedback/taxonomy.py) | Темы отзывов (наставник, задачи, нагрузка, онбординг…) — **правим под реальный кейс** |
| [feedback/analyzers/llm.py](feedback/analyzers/llm.py) | Общий LLM-слой: промпты, нарезка на пачки, параллельность, кеш, откат на офлайн при ошибках |
| [feedback/analyzers/yandex.py](feedback/analyzers/yandex.py) | Провайдер YandexGPT (Yandex AI Studio SDK, ответ строго по JSON-схеме) — **основной** |
| [feedback/analyzers/claude.py](feedback/analyzers/claude.py) | Провайдер Claude API — запасной |
| [feedback/analyzers/offline.py](feedback/analyzers/offline.py) | Запасной анализ на правилах: работает без ключа и интернета |
| [feedback/aggregate.py](feedback/aggregate.py) | Статистика: тональность, темы, рейтинги наставников и стажёров, динамика, алерты |
| [feedback/pipeline.py](feedback/pipeline.py) | Склеивает всё и строит итоговые выводы и рекомендации |
| [app/dashboard.py](app/dashboard.py) | Streamlit-дашборд: загрузка файла, фильтры, графики, срочные отзывы, выгрузка |
| [api/main.py](api/main.py) | FastAPI: `POST /analyze` (один текст), `POST /report` (файл) |

**Что получаем по каждому отзыву:** тональность (-1…1), темы, конкретные проблемы, предложения,
срочность, риск ухода стажёра, краткое резюме.

**По всей выборке:** распределение тональности, проблемные темы, наставники и стажёры с худшими
отзывами, динамика по неделям, список «требуют внимания HR», выводы и рекомендации от LLM.

## Нейросеть

Провайдер выбирается в `.env` через `LLM_PROVIDER` (по умолчанию `auto`: Яндекс → Claude → офлайн).
Чтобы подключить YandexGPT:

1. [Yandex AI Studio](https://aistudio.yandex.ru) → создать каталог (или взять существующий) и скопировать его ID.
2. Создать сервисный аккаунт с ролью `ai.languageModels.user` и API-ключ для него
   (область `yc.ai.foundationModels.execute`).
3. Вписать `YC_API_KEY` и `YC_FOLDER_ID` в `.env`. Модель — `YANDEX_MODEL` (по умолчанию `yandexgpt-5.1`).

Новый провайдер (GigaChat, локальная модель) — это класс с одним методом `complete(system, user, schema, kind)`,
см. [feedback/analyzers/yandex.py](feedback/analyzers/yandex.py).

## Когда придёт кейс

1. Посмотреть формат данных → при необходимости добавить синонимы колонок в `COLUMN_ALIASES`.
2. Поправить темы в `taxonomy.py` и поля `ItemAnalysis`, если жюри ждёт другие метрики.
3. Прогнать на их данных, сверить разметку глазами на 20–30 примерах, подкрутить промпт.
4. Дашборд — под сценарий демо на защите.

## О чемпионате

| | |
|---|---|
| Организатор | МГТС (при поддержке Минцифры Московской области) |
| Кто участвует | студенты бакалавриата, специалитета и магистратуры, 18–25 лет |
| Команда | 3–5 человек |
| Формат | онлайн-отбор → очный финал в Москве |
| **Финал** | **26 ноября 2026, Москва** |
| Призовой фонд | 600 000 ₽ |

Сайт: <https://studchamp.mgts.ru> · Codenrock: <https://codenrock.com/contests/keys-chempionat-kod-goroda>

Другие направления: «Робототехника» (алгоритм для сервисного робота), «Сетевой сервис»
(мониторинг телеком-инфраструктуры на ИИ и компьютерном зрении).

## Команда

- _TODO_
