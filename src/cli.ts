import { mkdirSync, writeFileSync } from "node:fs";
import {
  parseUserDate,
  toIsoDate,
  toScheduleUrl,
  dateRange,
} from "./dates";
import { fetchPage, sleep } from "./fetcher";
import { parseSchedulePage } from "./parser";
import {
  saveRawPage,
  saveParsedPage,
  getRawPage,
  getLessons,
  getUnstructuredBlocks,
  listStoredDates,
  listGroupsForDate,
} from "./db";

const [, , cmd, ...args] = process.argv;
//! Добавить логи
async function main() {
  switch (cmd) {
    case "fetch":
      await cmdFetch(args[0]);
      break;
    case "range":
      await cmdRange(args[0], args[1]);
      break;
    case "show":
      cmdShow(args[0], args[1]);
      break;
    case "dates":
      cmdDates();
      break;
    case "dump":
      cmdDump(args[0]);
      break;
    default:
      printHelp();
  }
}

async function fetchAndStore(date: Date): Promise<"ok" | "notfound" | "error"> {
  const isoDate = toIsoDate(date);
  const url = toScheduleUrl(date);

  process.stdout.write(`Фетчу ${isoDate} (${url}) ... `);

  const result = await fetchPage(url);

  if (!result.ok) {
    saveRawPage({ isoDate, url, status: "error", httpStatus: result.status });
    console.log(
      result.status === 404 ? "нет страницы (404)" : `ошибка: ${result.error}`,
    );
    return result.status === 404 ? "notfound" : "error";
  }

  // Основная дата — та, по которой ходили
  saveRawPage({
    isoDate,
    url,
    status: "ok",
    httpStatus: result.status,
    html: result.html,
  });

  const parsed = parseSchedulePage(result.html!, isoDate);

  // Пишем все дни, найденные на странице (обычно 1 или 2)
  saveParsedPage(parsed);

  // Все «дополнительные» дни тоже помечаем в raw_pages,
  // чтобы ensureSchedule для них не дёргал сеть.
  for (const day of parsed.days) {
    if (day.isoDate === isoDate) continue;

    saveRawPage({
      isoDate: day.isoDate,
      url,
      status: "ok",
      httpStatus: result.status,
      html: result.html,
    });
  }

  // -------------------------------------------------------------------------
  // Статистика
  // -------------------------------------------------------------------------

  let lessonsTotal = 0;
  let unstructuredTotal = 0;

  const perDay: string[] = [];

  for (const day of parsed.days) {
    let lessons = 0;
    let unstructured = 0;

    for (const block of day.blocks) {
      if (block.kind === "table") {
        for (const period of block.periods) {
          lessons += period.cells.length;
        }
      } else {
        unstructured += 1;
      }
    }

    lessonsTotal += lessons;
    unstructuredTotal += unstructured;

    perDay.push(
      `${day.isoDate}${day.weekday ? ` (${day.weekday})` : ""}: ` +
        `блоков ${day.blocks.length}, ячеек ${lessons}` +
        (unstructured ? `, нераспознано ${unstructured}` : ""),
    );
  }

  const daysCount = parsed.days.length;

  console.log(
    daysCount > 1
      ? `ок, дней ${daysCount} [${perDay.join(" | ")}]`
      : `ок, блоков: ${parsed.blocks.length} ` +
        `(ячеек распознано: ${lessonsTotal}` +
        (unstructuredTotal ? `, нераспознанных блоков: ${unstructuredTotal}` : "") +
        ")",
  );

  return "ok";
}

async function cmdFetch(dateArg?: string) {
  if (!dateArg) {
    console.error("Использование: fetch <дата>   например: fetch today  |  fetch 23.09.2026");
    process.exit(1);
  }
  const date = parseUserDate(dateArg);
  await fetchAndStore(date);
}

async function cmdRange(startArg?: string, endArg?: string) {
  if (!startArg || !endArg) {
    console.error("Использование: range <начало> <конец>   например: range 01.09.2026 30.09.2026");
    process.exit(1);
  }
  const start = parseUserDate(startArg);
  const end = parseUserDate(endArg);
  const days = dateRange(start, end);
  console.log(`Всего дней: ${days.length}`);

  for (const day of days) {
    await fetchAndStore(day);
    await sleep(400); // не долбим сайт запросами подряд
  }
}

function cmdShow(dateArg?: string, group?: string) {
  if (!dateArg) {
    console.error("Использование: show <дата> [группа]   например: show 23.09.2026 И-25-1");
    process.exit(1);
  }
  const isoDate = toIsoDate(parseUserDate(dateArg));
  const raw = getRawPage(isoDate);
  if (!raw) {
    console.log(`Нет данных за ${isoDate} — сначала выполни: fetch ${dateArg}`);
    return;
  }
  if (raw.status !== "ok") {
    console.log(`За ${isoDate} страница не была получена успешно (${raw.status}).`);
    return;
  }

  if (group) {
    const rows = getLessons(isoDate, group);
    if (rows.length === 0) {
      const known = listGroupsForDate(isoDate);
      console.log(`Группа "${group}" не найдена на ${isoDate}.`);
      if (known.length) console.log(`Известные группы этого дня: ${known.join(", ")}`);
      return;
    }
    console.log(`Расписание ${group} на ${isoDate}:\n`);
    for (const r of rows) {
      const flags = JSON.parse(r.flags || "[]");
      const flagStr = flags.length ? ` [${flags.join(",")}]` : "";
      if (r.confidence === "high") {
        console.log(
          `  ${r.period_no ?? "?"} пара (${r.time_range ?? "?"}): ${r.subject ?? "—"} — ${r.teacher ?? "—"} — ${r.room ?? "—"}${flagStr}`
        );
      } else {
        const lines: string[] = JSON.parse(r.raw_lines || "[]");
        console.log(
          `  ${r.period_no ?? "?"} пара (${r.time_range ?? "?"}): ${lines.join(" / ")}${flagStr}  [не до конца разобрано]`
        );
      }
    }
    return;
  }

  const groups = listGroupsForDate(isoDate);
  console.log(`${isoDate}: сохранено групп — ${groups.length}`);
  console.log(groups.join(", "));

  const unstructured = getUnstructuredBlocks(isoDate);
  if (unstructured.length) {
    console.log(
      `\nЕсть ${unstructured.length} нераспознанный(х) блок(ов) — группы там: ` +
        unstructured.map((b) => JSON.parse(b.groups).join("/")).join("; ")
    );
    console.log(`Смотри их текст: show ${dateArg} --raw  (или dump ${dateArg})`);
  }
  console.log(`\nПодробности по группе: show ${dateArg} <группа>`);
}

function cmdDates() {
  const dates = listStoredDates();
  if (dates.length === 0) {
    console.log("В базе пока ничего нет.");
    return;
  }
  console.log(dates.join("\n"));
}

function cmdDump(dateArg?: string) {
  if (!dateArg) {
    console.error("Использование: dump <дата>");
    process.exit(1);
  }
  const isoDate = toIsoDate(parseUserDate(dateArg));
  const raw = getRawPage(isoDate);
  if (!raw || !raw.html) {
    console.log(`Нет сырого HTML за ${isoDate}.`);
    return;
  }
  mkdirSync("./data/dumps", { recursive: true });
  const path = `./data/dumps/${isoDate}.html`;
  writeFileSync(path, raw.html, "utf-8");
  console.log(`Сохранено: ${path} (${raw.html.length} байт) — открой в браузере / текстовом редакторе для отладки парсера.`);
}

function printHelp() {
  console.log(`Использование:
  bun run src/cli.ts fetch <дата>              — скачать и распарсить один день
  bun run src/cli.ts range <начало> <конец>    — скачать диапазон дат подряд
  bun run src/cli.ts show <дата> [группа]      — показать сохранённое расписание
  bun run src/cli.ts dates                     — какие даты уже есть в базе
  bun run src/cli.ts dump <дата>               — сохранить сырой HTML на диск для отладки

Формат даты: today | tomorrow | yesterday | DD.MM | DD.MM.YYYY
`);
}

main();
