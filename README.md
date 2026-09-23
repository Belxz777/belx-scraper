# pilot-ipek schedule scraper

Фетчит расписание с `pilot-ipek.ru/raspo/<DD месяц>`, сохраняет в SQLite (сырой HTML +
разобранные занятия) и выдаёт по запросу — офлайн, без повторных походов на сайт.

## Установка

```
bun install
```

## Команды

```
bun run src/cli.ts fetch <дата>              # скачать и разобрать один день
bun run src/cli.ts range <начало> <конец>    # скачать диапазон дат подряд (с паузой между запросами)
bun run src/cli.ts show <дата> [группа]      # прочитать сохранённое расписание
bun run src/cli.ts dates                     # какие даты уже есть в базе
bun run src/cli.ts dump <дата>               # выгрузить сырой HTML на диск для отладки парсера
```

Формат даты: `today` / `tomorrow` / `yesterday` / `DD.MM` / `DD.MM.YYYY`.

Примеры:
```
bun run src/cli.ts fetch 23.09.2026
bun run src/cli.ts range 01.09.2026 30.09.2026
bun run src/cli.ts show 23.09.2026 И-25-1
```

Данные лежат в `./data/schedule.sqlite` (путь можно переопределить через `SCHEDULE_DB_PATH`).



1. **Fetcher** (`fetcher.ts`) — тупой HTTP-клиент с ретраями. Ничего не знает о структуре
   страницы.
2. **Storage** (`db.ts`, SQLite) — хранит **сырой HTML** в `raw_pages` как источник истины,
   и уже поверх него — разобранные данные (`lessons`, `unstructured_blocks`).
3. **Parser** (`parser.ts`) — чистая функция `html -> структура`, ничего не пишет и не
   фетчит. Вызывается отдельно от storage, поэтому её можно прогнать заново по уже
   сохранённому HTML без единого сетевого запроса — важно, раз разметка сайта не
   гарантированно стабильна.
\
