import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Вспомогательный тип для DOM-узлов Cheerio/domhandler.
// Для этого scraper-файла сознательно не усложняем типизацию.
// ---------------------------------------------------------------------------

type AnyNode = any;

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

export interface LessonCell {
  group: string;

  // Исходные строки внутри <td>
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

  // Исходное содержимое первой ячейки строки
  label: string;

  cells: LessonCell[];
}

export interface TableBlock {
  kind: "table";
  index: number;

  // Логические колонки после раскрытия colspan
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

export interface ParsedPage {
  isoDate: string;
  title: string | null;
  blocks: ScheduleBlock[];
}

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = new Set([
  "ВПР",
]);

const TIME_LINE = /^\d{1,2}[.:]\d{2}$/;

const ROOM_LIKE =
  /^(?:\d{2,4}[а-яё]?(?:\/\d{2,4}[а-яё]?)?|дистанционно|спортзал|библиотека|тренажерный зал|практика)$/i;

// HTML-теги, которые в этой таблице означают отдельную строку.
// В частности, реальный сайт использует <p>, а не <br>.
const LINE_BREAK_TAGS = new Set([
  "br",
  "p",
  "div",
  "li",
]);

// ---------------------------------------------------------------------------
// Основной parser
// ---------------------------------------------------------------------------

export function parseSchedulePage(
  html: string,
  isoDate: string,
): ParsedPage {
  const $ = cheerio.load(html);

  const title =
    $("title").first().text().trim() || null;

  const tables = $("table").toArray();

  const blocks: ScheduleBlock[] = [];

  // На странице нет таблиц
  if (tables.length === 0) {
    const text = normalizeText(
      $("body")
        .text()
        .replace(/\s+\n/g, "\n"),
    );

    blocks.push({
      kind: "unstructured",
      index: 0,
      groups: [],
      rawText: text,
    });

    return {
      isoDate,
      title,
      blocks,
    };
  }

  tables.forEach((table, index) => {
    blocks.push(
      parseTable($, table, index),
    );
  });

  return {
    isoDate,
    title,
    blocks,
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
  const rows = $(table)
    .find("tr")
    .toArray();

  const groups: string[] = [];

  // -------------------------------------------------------------------------
  // Первая строка — группы
  //
  // Реальный HTML:
  //
  // <td></td>
  // <td><h1>Э-26-1</h1></td>
  // ...
  // <td colspan="2"><h1>ЭР-26-1</h1></td>
  //
  // Поэтому colspan=2 превращаем в:
  //
  // ЭР-26-1
  // ЭР-26-1
  // -------------------------------------------------------------------------

  if (rows.length > 0) {
    const headerCells = $(rows[0])
      .find("th,td")
      .toArray();

    for (let i = 0; i < headerCells.length; i++) {
      const cell = headerCells[i];

      let name = extractHeaderText($, cell);

      name = normalizeText(name);

      // Пустой угол таблицы
      if (!name) {
        continue;
      }

      const span =
        Number($(cell).attr("colspan") || "1") || 1;

      for (let s = 0; s < span; s++) {
        groups.push(name);
      }
    }
  }

  const periods: PeriodRow[] = [];

  // -------------------------------------------------------------------------
  // Остальные строки — пары
  // -------------------------------------------------------------------------

  for (let r = 1; r < rows.length; r++) {
    const cells = $(rows[r])
      .find("th,td")
      .toArray();

    if (cells.length === 0) {
      continue;
    }

    // -----------------------------------------------------------------------
    // Первая ячейка — номер пары + время
    //
    // Например:
    //
    // <td>
    //   <p>1 пара</p>
    //   <p>8.30</p>
    //   <p> – </p>
    //   <p>10.00</p>
    // </td>
    // -----------------------------------------------------------------------

    const labelLines = splitCellIntoLines(
      $,
      cells[0],
    );

    const label = labelLines.join(" ");

    const periodMatch = label.match(
      /(\d+)\s*пара/i,
    );

    const timeMatch = label.match(
      /\d{1,2}[.:]\d{2}\s*[–-]\s*\d{1,2}[.:]\d{2}/,
    );

    const rowCells: LessonCell[] = [];

    let colCursor = 0;

    // -----------------------------------------------------------------------
    // Ячейки групп
    //
    // colspan=2 раскрываем в две логические колонки.
    // Например:
    //
    // <td colspan="2">
    //   <p>География</p>
    //   <p>Гончаренко</p>
    //   <p>702</p>
    // </td>
    //
    // превратится в две LessonCell:
    //
    // ЭР-26-1 -> География
    // ЭР-26-1 -> География
    // -----------------------------------------------------------------------

    for (let c = 1; c < cells.length; c++) {
      const cell = cells[c];

      const span =
        Number($(cell).attr("colspan") || "1") || 1;

      const lines = splitCellIntoLines(
        $,
        cell,
      );

      for (let s = 0; s < span; s++) {
        const group =
          groups[colCursor] ??
          `col_${colCursor}`;

        rowCells.push(
          buildLessonCell(
            group,
            lines,
          ),
        );

        colCursor++;
      }
    }

    // -----------------------------------------------------------------------
    // Если последняя пустая строка вообще ничего не содержит,
    // не добавляем её в результат.
    //
    // Например:
    //
    // <tr>
    //   <td></td>
    //   <td></td>
    //   ...
    // </tr>
    // -----------------------------------------------------------------------

    const hasData =
      label.length > 0 ||
      rowCells.some(
        (cell) => cell.lines.length > 0,
      );

    if (!hasData) {
      continue;
    }

    periods.push({
      periodNo: periodMatch
        ? Number(periodMatch[1])
        : null,

      timeRange: timeMatch
        ? normalizeText(timeMatch[0])
        : null,

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
// Извлечение названия группы из header.
//
// Обычно:
// <h1>Э-26-1</h1>
//
// Но если h1 вдруг исчезнет — fallback на обычный text.
// ---------------------------------------------------------------------------

function extractHeaderText(
  $: cheerio.CheerioAPI,
  cell: AnyNode,
): string {
  const heading = $(cell)
    .find("h1,h2,h3,h4")
    .first()
    .text();

  if (heading.trim()) {
    return heading;
  }

  return $(cell).text();
}

// ---------------------------------------------------------------------------
// Разбивка <td> на строки.
//
// ВАЖНО:
// сайт использует <p>, поэтому:
//
// <p>Математика</p>
// <p>Соковикова</p>
// <p>403</p>
//
// даст:
//
// [
//   "Математика",
//   "Соковикова",
//   "403"
// ]
//
// Также поддерживаются <br>, <div>, <li>.
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

    if (node.type !== "tag") {
      return;
    }

    const tag =
      String(node.tagName ?? "").toLowerCase();

    // <br>
    if (tag === "br") {
      flush();
      return;
    }

    // <p>, <div>, <li>
    //
    // Сначала собираем содержимое элемента,
    // затем принудительно завершаем строку.
    if (LINE_BREAK_TAGS.has(tag)) {
      for (const child of node.children ?? []) {
        walk(child);
      }

      flush();
      return;
    }

    // Другие теги просто рекурсивно обходим.
    //
    // Например:
    //
    // <strong>Математика</strong>
    //
    // или:
    //
    // <span>403</span>
    //
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
    KNOWN_FLAGS.has(
      normalizeText(line).toUpperCase(),
    ),
  );

  // Убираем флаги и строки, которые являются чисто временем.
  const content = lines.filter(
    (line) =>
      !TIME_LINE.test(
        normalizeText(line),
      ) &&
      !KNOWN_FLAGS.has(
        normalizeText(line).toUpperCase(),
      ),
  );

  // -------------------------------------------------------------------------
  // Полностью пустая ячейка
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Только один текст
  //
  // Например:
  //
  // <p>Информатика</p>
  //
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Две строки
  //
  // Например:
  //
  // <p>Математика</p>
  // <p>Соковикова</p>
  //
  // или:
  //
  // <p>Математика</p>
  // <p>Соковикова 403</p>
  // -------------------------------------------------------------------------

  if (content.length === 2) {
    const split = splitTeacherRoom(
      content[1] ?? "",
    );

    return {
      group,
      lines,

      subject: content[0] ?? null,

      teacher: split.teacher,
      room: split.room,

      flags,

      confidence: split.room
        ? "high"
        : "low",
    };
  }

  // -------------------------------------------------------------------------
  // 3+ строки
  //
  // Нормальный вариант:
  //
  // subject
  // teacher
  // teacher
  // room
  //
  // Например:
  //
  // Англ язык
  // Волкова/
  // Шкляева
  // 306а/208
  //
  // Получим:
  //
  // subject = "Англ язык"
  // teacher = "Волкова/Шкляева"
  // room = "306а/208"
  // -------------------------------------------------------------------------

  const subject =
    content[0] ?? null;

  const room =
    content[content.length - 1] ?? null;

  const teacherParts =
    content.slice(1, -1);

  let teacher = "";

  for (const part of teacherParts) {
    if (
      teacher === "" ||
      teacher.endsWith("/")
    ) {
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
    return {
      teacher: null,
      room: null,
    };
  }

  // Вся строка — кабинет.
  //
  // Например:
  // 403
  // 306а/208
  // Дистанционно
  // Библиотека
  // Тренажерный зал
  if (ROOM_LIKE.test(normalized)) {
    return {
      teacher: null,
      room: normalized,
    };
  }

  const tokens = normalized.split(/\s+/);

  const last =
    tokens[tokens.length - 1] ?? "";

  // "Соковикова 403"
  if (
    tokens.length > 1 &&
    ROOM_LIKE.test(last)
  ) {
    return {
      teacher:
        tokens
          .slice(0, -1)
          .join(" ") || null,

      room: last,
    };
  }

  // "Жуйкова/Кайрова"
  return {
    teacher: normalized,
    room: null,
  };
}

// ---------------------------------------------------------------------------
// Нормализация текста
// ---------------------------------------------------------------------------

function normalizeText(
  value: string,
): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
//все давай вася