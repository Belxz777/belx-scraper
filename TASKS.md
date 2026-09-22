# Pilot IPEK Schedule Bot — TODO / Technical Notes

## Статус проекта

Проект деплоен на VPS через Docker.

Текущий стек:

- Bun
- TypeScript
- Cheerio
- SQLite (`bun:sqlite`)
- grammY
- Docker / Docker Compose
- Telegram long polling

Основная задача проекта: получать расписание с `pilot-ipek.ru`, сохранять его в SQLite и отдавать расписание конкретной группы через Telegram-бота.

---

# 1. Что уже реализовано

## Парсер сайта

Есть парсер HTML-таблиц расписания:

- определяет группы из первой строки таблицы;
- учитывает `colspan`;
- разбирает строки `<p>` внутри `<td>`;
- выделяет:
  - предмет;
  - преподавателя;
  - кабинет;
  - флаги;
- сохраняет исходные строки `raw_lines`;
- сохраняет `confidence` для результата эвристического парсинга.

Пример исходной HTML-ячейки:

```html
<td>
  <p>Англ язык</p>
  <p>Волкова/</p>
  <p>Шкляева</p>
  <p>306а/208</p>
</td>
```

Должна превращаться в:

```text
subject: Англ язык
teacher: Волкова/Шкляева
room: 306а/208
```

## SQLite

Есть хранение:

- сырых HTML страниц;
- распарсенных уроков;
- неструктурированных блоков;
- списка групп;
- привязки Telegram-чата к группе.

Основные таблицы:

```text
raw_pages
lessons
unstructured_blocks
chat_groups
```

## Telegram

Есть Telegram-бот на grammY.

Поддерживаются команды:

```text
/start
/help
/schedule
/today
/tomorrow
/setgroup И-26-1
/mygroup
/unsetgroup
/groups
```

Группа может быть привязана к чату:

```text
Telegram chat_id -> group_name
```

## Автозагрузка даты

Если нужной даты нет в SQLite, бот может:

1. скачать страницу;
2. распарсить HTML;
3. сохранить HTML;
4. сохранить уроки;
5. выдать расписание.

---

# 2. Критическая проблема: строки расписания всё ещё слиты

Сейчас Telegram может показывать занятие примерно так:

```text
📘 ИсторияЕфремова107
```

вместо:

```text
📘 История
👨‍🏫 Ефремова
🚪 Каб. 107
```

Другие примеры проблемы:

```text
📘 ФизкультураПеревозчиковСпортзал
```

вместо:

```text
📘 Физкультура
👨‍🏫 Перевозчиков
🚪 Спортзал
```

И:

```text
📘 ЛитератураСозонова207
```

вместо:

```text
📘 Литература
👨‍🏫 Созонова
🚪 Каб. 207
```

## Важно

`formatSchedule()` сам по себе не должен быть причиной этой проблемы, если `formatLesson()` действительно возвращает строки через `\n`.

Нужно проверить реальное содержимое `LessonRow`, приходящее из SQLite, и реальную строку, которую отправляет Telegram.

---

# 3. Что проверить первым делом

Добавить временный debug перед `ctx.reply()`:

```ts
console.log("TELEGRAM TEXT:", JSON.stringify(result.text));
```

Ожидаемый результат должен содержать реальные `\n`:

```text
"📘 <b>История</b>\n👨‍🏫 Ефремова\n🚪 Каб. 107"
```

Если `JSON.stringify()` уже показывает:

```text
"📘 <b>ИсторияЕфремова107</b>"
```

то проблема находится **до Telegram**, то есть в данных SQLite или в форматировании.

Если `JSON.stringify()` показывает нормальные `\n`, а Telegram отображает всё слитно, проверять нужно код отправки сообщения и `parse_mode`.

---

# 4. Проверить данные в SQLite

Для конкретной даты и группы проверить:

```sql
SELECT
  date,
  period_no,
  time_range,
  group_name,
  subject,
  teacher,
  room,
  confidence,
  raw_lines
FROM lessons
WHERE date = 'YYYY-MM-DD'
  AND group_name = 'И-26-1'
ORDER BY period_no;
```

Для нормального занятия ожидается:

```text
subject = История
teacher = Ефремова
room    = 107
```

а не:

```text
subject = ИсторияЕфремова107
teacher = NULL
room    = NULL
```

Если в SQLite уже лежит объединённая строка, проблему надо исправлять в `parser.ts` / `splitCellIntoLines()` / `buildLessonCell()` и затем заново скачать дату.

---

# 5. Проверить `splitCellIntoLines()`

Сайт использует `<p>` как разделители строк:

```html
<p>История</p>
<p>Ефремова</p>
<p>107</p>
```

Поэтому parser обязан получать:

```ts
[
  "История",
  "Ефремова",
  "107",
]
```

а не:

```ts
[
  "ИсторияЕфремова107",
]
```

В `splitCellIntoLines()` должны обрабатываться как минимум:

```text
<br>
<p>
<div>
<li>
```

---

# 6. Перепроверить `buildLessonCell()`

Для 3 строк:

```text
subject
teacher
room
```

ожидать:

```ts
subject = content[0]
room = content[content.length - 1]
teacher = content.slice(1, -1)
```

Для примера:

```text
История
Ефремова
107
```

результат:

```ts
{
  subject: "История",
  teacher: "Ефремова",
  room: "107",
}
```

Для 4 строк:

```text
Англ язык
Волкова/
Шкляева
306а/208
```

результат:

```ts
{
  subject: "Англ язык",
  teacher: "Волкова/Шкляева",
  room: "306а/208",
}
```

---

# 7. Исправить `normalizeTime()`

Следить, чтобы регулярное выражение было таким:

```ts
function normalizeTime(value: string): string {
  return value
    .replace(/(\d{1,2})[.:](\d{2})/g, "$1:$2")
    .replace(/\s+/g, " ")
    .trim();
}
```

Нельзя оставлять ошибочный вариант с лишним `\(`:

```ts
.replace(/(\d{1,2})[.:]\(\d{2})/g, "$1:$2")
```

---

# 8. Формат Telegram сообщения

`formatLesson()` должен возвращать строки примерно так:

```ts
function formatLesson(lesson: LessonRow): string {
  const periodNo = lesson.period_no ?? "?";

  const periodIcon =
    typeof lesson.period_no === "number"
      ? PERIOD_EMOJI[lesson.period_no] ?? "📖"
      : "📖";

  const time = lesson.time_range
    ? escapeHtml(normalizeTime(lesson.time_range))
    : "время неизвестно";

  let text =
    `${periodIcon} <b>${periodNo} пара</b> · <code>${time}</code>`;

  if (lesson.subject) {
    text += `\n📘 <b>${escapeHtml(lesson.subject)}</b>`;
  }

  if (lesson.teacher) {
    text += `\n👨‍🏫 ${escapeHtml(lesson.teacher)}`;
  }

  if (lesson.room) {
    text += `\n🚪 ${escapeHtml(formatRoom(lesson.room))}`;
  }

  return text;
}
```

Ожидаемый Telegram результат:

```text
4️⃣ 4 пара · 13:40 – 15:10
📘 Матем моделирование
👨‍🏫 Ошуркова
🚪 Каб. 703
```

---

# 9. После исправления parser обязательно обновить данные

Важно: если неправильные данные уже были записаны в SQLite, исправление parser само по себе не изменит старые записи.

После исправления нужно заново загрузить дату.

Например:

```bash
bun run src/cli.ts fetch 22.09.2026
```

или на VPS:

```bash
docker exec -it pilot-bot bun src/cli.ts fetch 22.09.2026
```

После этого проверить:

```bash
docker exec -it pilot-bot bun src/cli.ts show 22.09.2026 И-26-1
```

Если parser исправлен правильно, `show` должен выводить предмет, преподавателя и кабинет отдельно.

---

# 10. Устранить дубликаты из `colspan="2"`

Сейчас `colspan="2"` может приводить к тому, что одна HTML-ячейка сохраняется как две одинаковые записи.

Пример:

```html
<td colspan="2">
  <p>Родной язык</p>
  <p>Самсонова</p>
  <p>205</p>
</td>
```

На уровне группы это может создавать две одинаковые записи:

```text
ЭР-26-1 -> Родной язык
ЭР-26-1 -> Родной язык
```

Временное решение уже есть в Telegram-модуле через `deduplicateLessons()`.

Но правильнее исправить это на уровне модели данных и не записывать дубликаты в SQLite.

---

# 11. Нераспознанные блоки

На сайте могут встречаться таблицы / блоки нестандартной структуры.

Если таблица не соответствует обычной сетке расписания, нельзя молча считать её нормально распарсенной.

Сохранять:

- `rawText`;
- исходный HTML в `raw_pages`;
- информацию о том, что блок не разобран.

При необходимости такие блоки исследовать через:

```bash
bun src/cli.ts dump 22.09.2026
```

После чего открыть:

```text
data/dumps/2026-09-22.html
```

---

# 12. Улучшения Telegram-бота

## Группа чата

Уже есть:

```text
/setgroup И-26-1
/mygroup
/unsetgroup
```

Нужно оставить это как основной способ настройки группового чата.

## Команды расписания

Желаемый интерфейс:

```text
/schedule
/schedule today
/schedule tomorrow
/schedule 23.09
/schedule 23.09.2026
/schedule И-26-1
/schedule И-26-1 tomorrow
```

## Возможные следующие команды

```text
/week
/next
/groups
/teacher
```

---

# 13. Автообновление расписания

После базового исправления parser добавить фоновое обновление.

Например:

- утром скачивать расписание на сегодня;
- вечером скачивать завтра;
- периодически обновлять текущий день;
- не скачивать одну и ту же страницу слишком часто.

Для этого лучше использовать отдельный scheduler, а не Telegram command handler.

---

# 14. Production / Docker

Текущая схема:

```text
Docker
└── pilot-bot
    ├── Bun
    ├── Telegram bot
    ├── SQLite
    └── HTTP :3000
```

Compose использует:

```yaml
restart: unless-stopped
```

и volume:

```yaml
volumes:
  - ./data:/app/data
```

SQLite должен храниться в:

```text
/app/data/schedule.sqlite
```

а на VPS:

```text
/root/apps/pilot-scraper/data/schedule.sqlite
```

---

# 15. Деплой после изменений

Локально:

```bash
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude data \
  ./ root@YOUR_VPS:/root/apps/pilot-scraper/
```

На VPS:

```bash
cd /root/apps/pilot-scraper

docker compose up -d --build
```

Логи:

```bash
docker compose logs -f pilot-bot
```

Статус:

```bash
docker compose ps
```

---

# 16. Тестовый сценарий после исправлений

После изменения parser выполнить полный тест:

```bash
# 1. Скачать конкретный день заново
docker exec -it pilot-bot bun src/cli.ts fetch 22.09.2026

# 2. Посмотреть расписание конкретной группы
docker exec -it pilot-bot bun src/cli.ts show 22.09.2026 И-26-1

# 3. Проверить Telegram
/schedule И-26-1
```

Проверить минимум такие занятия:

```text
История / Ефремова / 107
Физкультура / Перевозчиков / Спортзал
Литература / Созонова / 207
Матем моделирование / Ошуркова / 703
```

Отдельно проверить сложные значения:

```text
Волкова/Шкляева
306а/208
Дистанционно
Библиотека
Тренажерный зал
```

---

# Приоритеты

## P0 — сделать в первую очередь

1. Найти причину, почему `subject + teacher + room` всё ещё сливаются.
2. Проверить реальные значения `LessonRow` из SQLite.
3. Проверить `splitCellIntoLines()` на `<p>`.
4. Исправить parser.
5. Пересохранить уже загруженные даты.
6. Проверить Telegram output.

## P1

1. Убрать дубликаты `colspan` на уровне БД.
2. Улучшить обработку нестандартных блоков.
3. Добавить автоматическое обновление расписания.

## P2

1. Добавить расписание на неделю.
2. Добавить выбор группы через Telegram keyboard.
3. Добавить настройки чата.
4. Добавить уведомления об изменениях расписания.

---

# Критерий готовности

Для обычной строки HTML:

```html
<td>
  <p>История</p>
  <p>Ефремова</p>
  <p>107</p>
</td>
```

в Telegram должно приходить:

```text
📘 История
👨‍🏫 Ефремова
🚪 Каб. 107
```

а не:

```text
📘 ИсторияЕфремова107
```

После исправления parser нужно обязательно повторно сохранить соответствующие даты в SQLite, иначе бот продолжит выдавать старые данные.
