// Даты: сайт использует в URL формат "23 сентября" (число + месяц в родительном падеже).
// Здесь всё, что нужно, чтобы конвертировать в обе стороны и принимать удобный ввод от пользователя.

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const MONTHS_INDEX = new Map<string, number>(MONTHS_GENITIVE.map((m, i) => [m, i]));

/** JS Date -> "23 сентября" (без года, как в URL сайта) */
export function toUrlDatePart(date: Date): string {
  const day = date.getDate();
  const month = MONTHS_GENITIVE[date.getMonth()] ?? MONTHS_GENITIVE[0];
  return `${day} ${month}`;
}

/** JS Date -> полный URL страницы расписания */
export function toScheduleUrl(date: Date): string {
  const part = toUrlDatePart(date);
  return `https://www.pilot-ipek.ru/raspo/${encodeURIComponent(part)}`;
}

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
      `Не понял дату: "${input}". Ожидался формат DD.MM.YYYY, DD.MM, today/tomorrow/yesterday.`
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
