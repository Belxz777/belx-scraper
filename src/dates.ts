// Даты: сайт использует в URL формат "23 сентября" (число + месяц в родительном падеже),
// а для парных страниц (пт + сб) — "25, 26 сентября".

import { getRawPage } from "./db";
import { logger } from "./logs/logger";

// Здесь всё, что нужно, чтобы конвертировать в обе стороны и принимать удобный ввод от пользователя.
const log = logger.child({ module: "dates.ts" });
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const MONTHS_INDEX = new Map<string, number>(
  MONTHS_GENITIVE.map((m, i) => [m, i]),
);

const BASE_URL = "https://www.pilot-ipek.ru/raspo";
/**
 * Разбор пользовательского ввода, который может быть URL сайта.
 * Возвращает массив дат или null, если это не URL.
 */
export function parseScheduleUrl(
  input: string,
  now: Date = new Date(),
): Date[] | null {
  const trimmed = input.trim();

  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?pilot-ipek\.ru\/raspo\/(.+)$/i,
  );
  if (!match) return null;

  const slug = decodeURIComponent(match[1]).trim();
  const year = now.getFullYear();

  const dates = parseScheduleSlug(slug, year);
  if (dates.length === 0) return null;

  // Та же корректировка года, что и в parseUserDate.
  const halfYearAgo = new Date(now);
  halfYearAgo.setDate(now.getDate() - 183);

  return dates.map((d) =>
    d.getTime() < halfYearAgo.getTime()
      ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
      : d,
  );
}

/** Универсальный резолвер: URL или обычная дата -> массив Date. */
export function resolveDates(
  input: string,
  now: Date = new Date(),
): Date[] {
  const urlDates = parseScheduleUrl(input, now);
  if (urlDates) return urlDates;
  return [parseUserDate(input, now)];
}
// ---------------------------------------------------------------------------
// Базовые преобразования
// ---------------------------------------------------------------------------

/** JS Date -> "23 сентября" (без года, как в URL сайта) */
export function toUrlDatePart(date: Date): string {
  const day = date.getDate();
  const month = MONTHS_GENITIVE[date.getMonth()] ?? MONTHS_GENITIVE[0];
  return `${day} ${month}`;
}

export function getStudyWeekPair(date: Date): [Date, Date] {
  const d = startOfDay(date);

  // getDay(): 0=вс, 1=пн, ..., 5=пт, 6=сб
  const day = d.getDay();

  // сколько дней до ближайшей пятницы (включая сегодня, если это пт)
  let diffToFriday: number;
  if (day === 5) diffToFriday = 0;
  else if (day === 6) diffToFriday = -1;      // суббота → пятница была вчера
  else if (day === 0) diffToFriday = -2;      // воскресенье → пятница позавчера
  else diffToFriday = 5 - day;                // пн..чт → вперёд к пятнице

  const friday = addDays(d, diffToFriday);
  const saturday = addDays(friday, 1);

  return [friday, saturday];
}

/** Парный слаг вида "25, 26 сентября" */
export function toPairedSlug(friday: Date, saturday: Date): string {
  return `${friday.getDate()}, ${saturday.getDate()} ${MONTHS_GENITIVE[friday.getMonth()]}`;
}

/** Единый URL расписания для любой даты — всегда парный (пятница+суббота) */
/** Единый URL расписания.
 *
 * Правила сайта:
 *   пт  -> парный "25, 26 сентября"
 *   сб  -> парный "25, 26 сентября" (та же страница, что и пятница)
 *   пн..чт, вс -> одиночный "28 сентября"
 */
export function toScheduleUrl(date: Date): string {
  const d = startOfDay(date);
  const day = d.getDay(); // 0=вс, 1=пн, ..., 5=пт, 6=сб

  // Суббота — часть пары пт+сб
  if (day === 6) {
    const [fri] = getStudyWeekPair(d);
    const sat = addDays(fri, 1);
    const slug = toPairedSlug(fri, sat);
    log.debug(`toScheduleUrl slug=${slug} (sat -> fri+sat)`);
    return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
  }

  // Пятница — пара с субботой
  if (day === 5) {
    const sat = addDays(d, 1);
    const slug = toPairedSlug(d, sat);
    log.debug(`toScheduleUrl slug=${slug} (fri+sat)`);
    return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
  }

  // Пн..чт (и вс на всякий случай) — одиночный день
  const slug = toUrlDatePart(d);
  log.debug(`toScheduleUrl slug=${slug} (single)`);
  return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
}

/**
 * Обратный разбор слага в список дат. Год в слаге не хранится — передаём отдельно.
 *
 * Поддерживает:
 *   "25 сентября"                -> [25 сент]
 *   "25, 26 сентября"            -> [25 сент, 26 сент]
 *   "30 сентября, 1 октября"     -> [30 сент, 1 окт]
 *
 * Возвращает [] если слаг не распознан.
 */
export function parseScheduleSlug(slug: string, year: number): Date[] {
  const decoded = decodeURIComponent(slug).trim();

  // "25, 26 сентября"
  let m = decoded.match(/^(\d{1,2}),\s*(\d{1,2})\s+([а-яё]+)$/i);
  if (m) {
    const month = MONTHS_INDEX.get(m[3].toLowerCase());
    if (month === undefined) return [];
    return [
      new Date(year, month, Number(m[1])),
      new Date(year, month, Number(m[2])),
    ];
  }

  // "30 сентября, 1 октября"
  m = decoded.match(/^(\d{1,2})\s+([а-яё]+),\s*(\d{1,2})\s+([а-яё]+)$/i);
  if (m) {
    const monthA = MONTHS_INDEX.get(m[2].toLowerCase());
    const monthB = MONTHS_INDEX.get(m[4].toLowerCase());
    if (monthA === undefined || monthB === undefined) return [];
    return [
      new Date(year, monthA, Number(m[1])),
      new Date(year, monthB, Number(m[3])),
    ];
  }

  // "25 сентября"
  m = decoded.match(/^(\d{1,2})\s+([а-яё]+)$/i);
  if (m) {
    const month = MONTHS_INDEX.get(m[2].toLowerCase());
    if (month === undefined) return [];
    return [new Date(year, month, Number(m[1]))];
  }

  return [];
}

// ---------------------------------------------------------------------------
// ISO / парсинг пользовательского ввода
// ---------------------------------------------------------------------------

/** JS Date -> "YYYY-MM-DD", используется как первичный ключ в БД */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "23 сентября" (строка из URL/страницы) -> JS Date. Год не известен из строки — передаём отдельно. */
export function fromUrlDatePart(part: string, year: number): Date | null {
  const m = part.trim().match(/^(\d{1,2})\s+([а-яё]+)$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const monthName = m[2];
  if (!monthName) return null;
  const monthIdx = MONTHS_INDEX.get(monthName.toLowerCase());
  if (monthIdx === undefined) return null;
  return new Date(year, monthIdx, day);
}

/**
 * Разбор пользовательского ввода даты:
 *  - "today" / "сегодня"
 *  - "tomorrow" / "завтра"
 *  - "yesterday" / "вчера"
 *  - "23.09.2026"
 *  - "23.09" (год берётся текущий; если дата уже прошла больше чем на полгода — считаем, что имелся в виду следующий год)
 */

export function parseUserDate(input: string, now: Date = new Date()): Date {
  const s = input.trim().toLowerCase();
  if (s === "today" || s === "сегодня") return startOfDay(now);
  if (s === "tomorrow" || s === "завтра") return addDays(startOfDay(now), 1);
  if (s === "yesterday" || s === "вчера") return addDays(startOfDay(now), -1);

  const m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (!m) {
    throw new Error(
      `Не понял дату: "${input}". Ожидался формат DD.MM.YYYY, DD.MM, today/tomorrow/yesterday.`,
    );
  }
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = m[3] ? Number(m[3]) : now.getFullYear();

  if (!m[3]) {
    const guess = new Date(year, month, day);
    const diffDays = (guess.getTime() - startOfDay(now).getTime()) / 86_400_000;
    if (diffDays < -183) year += 1; // явно прошлый год не имелся в виду
  }
  return new Date(year, month, day);
}

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Включительный диапазон дат от start до end */
export function dateRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cur = startOfDay(start);
  const last = startOfDay(end);
  while (cur.getTime() <= last.getTime()) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
