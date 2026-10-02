# Бот для расписания ИПЭК

Бот для просмотра расписания ИПЭК в Telegram.

Линтер biome : https://biomejs.dev/guides/getting-started/
там вся документация 
```sh
# Format specific files
bunx --bun @biomejs/biome format --write <files>

# Lint and apply safe fixes to all files
bunx --bun @biomejs/biome lint --write

# Lint files and apply safe fixes to specific files
bunx --bun @biomejs/biome lint --write <files>

# Format, lint, and organize imports of all files
bunx --bun @biomejs/biome check --write

# Format, lint, and organize imports of specific files
bunx --bun @biomejs/biome check --write <files>
```
напишу здесь , а то скоро интернета в россии не будет бля

## Коротко о структуре :

```text
├── bot
│   ├── bot.ts - все команды бота (центр принятия решений)
│   ├── cron.ts - запланированная фича для авторассылки в определенное время
│   ├── schedule.ts - ф-ции для посторения самих расписаний в чате telegram
│   └── sch-service.ts - отвечает за скачивание и добавление в бд сырых html расписаний
├── dates.ts - ф-ции для работы с датами , а именно парсинг для URl сайта (потому что сайт принимает в примерном формате /raspo/01 сентября то есть по уебански)
├── db.ts - главный файл с бд , там весь функционал для crud в  БД
├── fetcher.ts - загрузка самого html сайта чисто в формате html
├── logs
│   └── logger.ts - центр управления логами и логики логов
├── notifications
│   └── notify.ts - модуль по оповещениям в чатах реализованный через /notify команду
├── parser.ts - ф-ции для преобразования html в json
├── render
│   └── image.ts - центр создания изображений расписания
├── roles
│   └── rules.ts - миддлевейр для проверок на админа 
├── types
│   ├── constant.ts - константы значений (месяцев дат и т.д.) 
│   └── index.ts - типы данных для всего проекта
├── url
│   └── index.ts - ф-ции формирование ссылок на запрос расписания с сайта
└── utils
    └── index.ts  - вспомогательные ф-ции
```

---

##  Поддержать 

<div align="center">

  <table>
    <tr>
      <td align="center"><b>USDT (TON)</b></td>
      <td align="center"><b>Solana(SOL)</b></td>
    </tr>
    <tr>
      <td align="center"><code>UQC9ko8-fXCv3bhDVhK3S_qmLgCFDWny1fVjI7tf3RNX2M5c</code></td>
      <td align="center"><code>8retiN8itMrWwHxVne7MgoiGEcrBXwubs4HVvBNL6vrK</code></td>
    </tr>
  </table>

  <br>

</div>

