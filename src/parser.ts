import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Вспомогательный тип для DOM-узлов Cheerio/domhandler.
// ---------------------------------------------------------------------------

type AnyNode = any;

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

export interface LessonCell {
  group: string;
  lines: string[];
  subject: string | null;
  teacher: string | null;
  room: string | null;
  flags: string[];
  confidence: "high" | "low";
}

export interface PeriodRow {
  periodNo: number | null;
  timeRange: string | null;
  label: string;
  cells: LessonCell[];
}

export interface TableBlock {
  kind: "table";
  index: number;
  groups: string[];
  periods: PeriodRow[];
}

export interface UnstructuredBlock {
  kind: "unstructured";
  index: number;
  groups: string[];
  rawText: string;
}

export type ScheduleBlock = TableBlock | UnstructuredBlock;

// ---------------------------------------------------------------------------
// Один день расписания
// ---------------------------------------------------------------------------

export interface ParsedDay {
  /** "YYYY-MM-DD" */
  isoDate: string;

  /** "25 сентября 2026" — как в заголовке страницы */
  dateText: string | null;

  /** "пятница" / "суббота" / ... */
  weekday: string | null;

  blocks: ScheduleBlock[];
}

export interface ParsedPage {
  /** Основная дата (первая найденная или fallback). */
  isoDate: string;

  title: string | null;

  /** Дни в порядке появления на странице. */
  days: ParsedDay[];

  /**
   * Плоский список всех блоков всех дней — для отладки и обратной
   * совместимости. Сохранять по нему НЕЛЬЗЯ, дата неоднозначна.
   */
  blocks: ScheduleBlock[];
}

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = new Set(["ВПР"]);

const TIME_LINE = /^\d{1,2}[.:]\d{2}$/;

const ROOM_LIKE =
  /^(?:\d{2,4}[а-яё]?(?:\/\d{2,4}[а-яё]?)?|дистанционно|спортзал|библиотека|тренажерный зал|практика)$/i;

const LINE_BREAK_TAGS = new Set(["br", "p", "div", "li"]);

// ---------------------------------------------------------------------------
// Месяцы (родительный падеж, как в заголовках сайта)
// ---------------------------------------------------------------------------

const MONTHS_GENITIVE: Record<string, number> = {
  "января": 0,
  "февраля": 1,
  "марта": 2,
  "апреля": 3,
  "мая": 4,
  "июня": 5,
  "июля": 6,
  "августа": 7,
  "сентября": 8,
  "октября": 9,
  "ноября": 10,
  "декабря": 11,
};

/**
 * Примеры заголовков:
 *   РАСПИСАНИЕ ЗАНЯТИЙ   НА   25 сентября  2026  года (пятница)
 *   РАСПИСАНИЕ ЗАНЯТИЙ НА 26 сентября 2026 года (суббота)
 */
const DATE_HEADER_RE =
  /РАСПИСАНИЕ\s+ЗАНЯТИЙ\s+НА\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s+года(?:\s*\(([^)]+)\))?/i;

// ---------------------------------------------------------------------------
// Основной parser
// ---------------------------------------------------------------------------

export function parseSchedulePage(
  html: string,
  fallbackIsoDate: string,
): ParsedPage {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;

  const daysByDate = new Map<string, ParsedDay>();
  const dayOrder: string[] = [];

  let currentIso: string | null = null;

  const getOrCreateDay = (
    isoDate: string,
    dateText: string | null,
    weekday: string | null,
  ): ParsedDay => {
    let day = daysByDate.get(isoDate);

    if (!day) {
      day = { isoDate, dateText, weekday, blocks: [] };
      daysByDate.set(isoDate, day);
      dayOrder.push(isoDate);
    } else {
      if (!day.dateText && dateText) day.dateText = dateText;
      if (!day.weekday && weekday) day.weekday = weekday;
    }

    return day;
  };

  const body = $("body");
 const root: cheerio.Cheerio<any> = body.length > 0 ? body : $.root();
  root.children().each((_, node) => {
    const node$ = $(node);

    // -----------------------------------------------------------------------
    // 1. Заголовок нового дня
    // -----------------------------------------------------------------------
    const header = tryParseDateHeader($, node);
    if (header) {
      getOrCreateDay(header.isoDate, header.dateText, header.weekday);
      currentIso = header.isoDate;
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Таблицы (могут лежать внутри <div class="table-wrapper">)
    // -----------------------------------------------------------------------
    const tag = (node as AnyNode).tagName?.toLowerCase();

    const tables =
      tag === "table"
        ? [node]
        : node$.find("table").toArray();

    if (tables.length === 0) return;

    const day = getOrCreateDay(
      currentIso ?? fallbackIsoDate,
      null,
      null,
    );

    for (const table of tables) {
      const idx = day.blocks.length;
      day.blocks.push(parseTable($, table, idx));
    }
  });

  let days: ParsedDay[] = dayOrder.map((iso) => daysByDate.get(iso)!);

  // -------------------------------------------------------------------------
  // Ничего не нашли — кладём unstructured с fallback-датой
  // -------------------------------------------------------------------------

  if (days.length === 0) {
    const text = normalizeText(
      $("body")
        .text()
        .replace(/\s+\n/g, "\n"),
    );

    days = [
      {
        isoDate: fallbackIsoDate,
        dateText: null,
        weekday: null,
        blocks: [
          {
            kind: "unstructured",
            index: 0,
            groups: [],
            rawText: text,
          },
        ],
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Плоский список блоков (для отладки / обратной совместимости)
  // -------------------------------------------------------------------------

  const flatBlocks: ScheduleBlock[] = [];
  for (const day of days) {
    for (const block of day.blocks) {
      flatBlocks.push(block);
    }
  }

  return {
    isoDate: days[0]?.isoDate ?? fallbackIsoDate,
    title,
    days,
    blocks: flatBlocks,
  };
}

// ---------------------------------------------------------------------------
// Заголовок дня
// ---------------------------------------------------------------------------

interface DateHeaderInfo {
  isoDate: string;
  dateText: string;
  weekday: string | null;
}

function tryParseDateHeader(
  $: cheerio.CheerioAPI,
  node: AnyNode,
): DateHeaderInfo | null {
  const tag = (node as AnyNode).tagName?.toLowerCase();
  if (!tag) return null;

  if (
    tag !== "p" &&
    tag !== "h1" &&
    tag !== "h2" &&
    tag !== "h3" &&
    tag !== "h4"
  ) {
    return null;
  }

  const text = normalizeText($(node).text());
  if (!text) return null;

  const m = text.match(DATE_HEADER_RE);
  if (!m) return null;

  const day = Number(m[1]);
  const monthName = m[2]!.toLowerCase();
  const year = Number(m[3]);
  const weekday = m[4]?.trim() || null;

  const monthIdx = MONTHS_GENITIVE[monthName];
  if (monthIdx === undefined) return null;

  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;

  const isoDate = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;

  return {
    isoDate,
    dateText: `${day} ${monthName} ${year}`,
    weekday,
  };
}

// ---------------------------------------------------------------------------
// Таблица расписания
// ---------------------------------------------------------------------------

function parseTable(
  $: cheerio.CheerioAPI,
  table: AnyNode,
  index: number,
): TableBlock {
  const rows = $(table).find("tr").toArray();

  const groups: string[] = [];

  if (rows.length > 0) {
    const headerCells = $(rows[0]).find("th,td").toArray();

    for (let i = 0; i < headerCells.length; i++) {
      const cell = headerCells[i];

      let name = extractHeaderText($, cell);
      name = normalizeText(name);

      if (!name) continue;

      const span = Number($(cell).attr("colspan") || "1") || 1;

      for (let s = 0; s < span; s++) {
        groups.push(name);
      }
    }
  }

  const periods: PeriodRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = $(rows[r]).find("th,td").toArray();

    if (cells.length === 0) continue;

    const labelLines = splitCellIntoLines($, cells[0]);
    const label = labelLines.join(" ");

    const periodMatch = label.match(/(\d+)\s*пара/i);
    const timeMatch = label.match(
      /\d{1,2}[.:]\d{2}\s*[–-]\s*\d{1,2}[.:]\d{2}/,
    );

    const rowCells: LessonCell[] = [];

    let colCursor = 0;

    for (let c = 1; c < cells.length; c++) {
      const cell = cells[c];

      const span = Number($(cell).attr("colspan") || "1") || 1;

      const lines = splitCellIntoLines($, cell);

      for (let s = 0; s < span; s++) {
        const group = groups[colCursor] ?? `col_${colCursor}`;

        rowCells.push(buildLessonCell(group, lines));

        colCursor++;
      }
    }

    const hasData =
      label.length > 0 ||
      rowCells.some((cell) => cell.lines.length > 0);

    if (!hasData) continue;

    periods.push({
      periodNo: periodMatch ? Number(periodMatch[1]) : null,
      timeRange: timeMatch ? normalizeText(timeMatch[0]) : null,
      label,
      cells: rowCells,
    });
  }

  return {
    kind: "table",
    index,
    groups,
    periods,
  };
}

// ---------------------------------------------------------------------------
// Извлечение названия группы из header
// ---------------------------------------------------------------------------

function extractHeaderText(
  $: cheerio.CheerioAPI,
  cell: AnyNode,
): string {
  const heading = $(cell).find("h1,h2,h3,h4").first().text();

  if (heading.trim()) return heading;

  return $(cell).text();
}

// ---------------------------------------------------------------------------
// Разбивка <td> на строки
// ---------------------------------------------------------------------------

function splitCellIntoLines(
  $: cheerio.CheerioAPI,
  cell: AnyNode,
): string[] {
  const lines: string[] = [];

  let buffer = "";

  const flush = () => {
    const value = normalizeText(buffer);

    if (value.length > 0) {
      lines.push(value);
    }

    buffer = "";
  };

  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      buffer += node.data ?? "";
      return;
    }

    if (node.type !== "tag") return;

    const tag = String(node.tagName ?? "").toLowerCase();

    if (tag === "br") {
      flush();
      return;
    }

    if (LINE_BREAK_TAGS.has(tag)) {
      for (const child of node.children ?? []) {
        walk(child);
      }

      flush();
      return;
    }

    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  for (const child of cell.children ?? []) {
    walk(child);
  }

  flush();

  return lines;
}

// ---------------------------------------------------------------------------
// Построение LessonCell
// ---------------------------------------------------------------------------

function buildLessonCell(
  group: string,
  lines: string[],
): LessonCell {
  const flags = lines.filter((line) =>
    KNOWN_FLAGS.has(normalizeText(line).toUpperCase()),
  );

  const content = lines.filter(
    (line) =>
      !TIME_LINE.test(normalizeText(line)) &&
      !KNOWN_FLAGS.has(normalizeText(line).toUpperCase()),
  );

  if (content.length === 0) {
    return {
      group,
      lines,
      subject: null,
      teacher: null,
      room: null,
      flags,
      confidence: "high",
    };
  }

  if (content.length === 1) {
    return {
      group,
      lines,
      subject: content[0] ?? null,
      teacher: null,
      room: null,
      flags,
      confidence: "low",
    };
  }

  if (content.length === 2) {
    const split = splitTeacherRoom(content[1] ?? "");

    return {
      group,
      lines,
      subject: content[0] ?? null,
      teacher: split.teacher,
      room: split.room,
      flags,
      confidence: split.room ? "high" : "low",
    };
  }

  const subject = content[0] ?? null;
  const room = content[content.length - 1] ?? null;
  const teacherParts = content.slice(1, -1);

  let teacher = "";

  for (const part of teacherParts) {
    if (teacher === "" || teacher.endsWith("/")) {
      teacher += part;
    } else {
      teacher += ` ${part}`;
    }
  }

  return {
    group,
    lines,
    subject,
    teacher: teacher || null,
    room,
    flags,
    confidence: "high",
  };
}

// ---------------------------------------------------------------------------
// Разделение "преподаватель + кабинет"
// ---------------------------------------------------------------------------

function splitTeacherRoom(
  value: string,
): {
  teacher: string | null;
  room: string | null;
} {
  const normalized = normalizeText(value);

  if (!normalized) {
    return { teacher: null, room: null };
  }

  if (ROOM_LIKE.test(normalized)) {
    return { teacher: null, room: normalized };
  }

  const tokens = normalized.split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";

  if (tokens.length > 1 && ROOM_LIKE.test(last)) {
    return {
      teacher: tokens.slice(0, -1).join(" ") || null,
      room: last,
    };
  }

  return { teacher: normalized, room: null };
}

// ---------------------------------------------------------------------------
// Нормализация текста
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}