# Бот для расписания ИПЭК

Бот для просмотра расписания ИПЭК в Telegram.

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

Конфигурация .env :
1. Для разработки создавайте файл `.env.development` в корне проекта с следующим содержимым:
```
TELEGRAM_BOT_TOKEN=XXXXXXXXX:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

```
2. Для работы в продакшене создавайте файл `.env.production` 