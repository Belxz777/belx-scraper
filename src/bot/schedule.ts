import {
  getLessons,
  getRawPage,
  listGroupsForDate,
  type LessonRow,
} from "../db";

import {
  parseUserDate,
  toIsoDate,
} from "../dates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleMessageResult {
  ok: boolean;
  text: string;
  isoDate: string;
  group: string;
}

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const PERIOD_EMOJI: Record<number, string> = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
  9: "9️⃣",
};

// ---------------------------------------------------------------------------
// Основная функция
//
// date:
//   today
//   tomorrow
//   yesterday
//   23.09
//   23.09.2026
//
// group:
//   И-26-1
// ---------------------------------------------------------------------------

export function getGroupScheduleMessage(
  date: string,
  group: string,
): ScheduleMessageResult {
  const isoDate = toIsoDate(parseUserDate(date));
  const normalizedGroup = normalizeGroup(group);

  const rawPage = getRawPage(isoDate);

  // -------------------------------------------------------------------------
  // Дата вообще не загружена
  // -------------------------------------------------------------------------

  if (!rawPage) {
    return {
      ok: false,
      isoDate,
      group: normalizedGroup,

      text:
        `⚠️ <b>Нет расписания</b>\n\n` +
        `Дата: <b>${escapeHtml(formatRuDate(isoDate))}</b>\n` +
        `Группа: <b>${escapeHtml(normalizedGroup)}</b>\n\n` +
        `Эта дата ещё не загружена в базу.`,
    };
  }

  // -------------------------------------------------------------------------
  // Страница была загружена, но закончилась ошибкой
  // -------------------------------------------------------------------------

  if (rawPage.status !== "ok") {
    return {
      ok: false,
      isoDate,
      group: normalizedGroup,

      text:
        `⚠️ <b>Не удалось получить расписание</b>\n\n` +
        `Дата: <b>${escapeHtml(formatRuDate(isoDate))}</b>\n` +
        `Группа: <b>${escapeHtml(normalizedGroup)}</b>`,
    };
  }

  // -------------------------------------------------------------------------
  // Получаем строки из SQLite
  // -------------------------------------------------------------------------

  let lessons = getLessons(
    isoDate,
    normalizedGroup,
  );

  // Пустые ячейки таблицы в БД тоже сохраняются,
  // поэтому убираем их перед отправкой в Telegram.
  lessons = lessons.filter(hasLessonData);

  // -------------------------------------------------------------------------
  // Дубликаты от colspan
  //
  // Например:
  //
  // ЭР-26-1
  // ЭР-26-1
  //
  // одна HTML-ячейка с colspan=2 попадёт в БД дважды.
  //
  // Для одного group/date/period мы оставляем только уникальную комбинацию
  // предмет + преподаватель + кабинет + flags.
  // -------------------------------------------------------------------------

  lessons = deduplicateLessons(lessons);

  // -------------------------------------------------------------------------
  // Группа отсутствует
  // -------------------------------------------------------------------------

  if (lessons.length === 0) {
    const knownGroups = listGroupsForDate(isoDate);

    let text =
      `📚 <b>${escapeHtml(normalizedGroup)}</b>\n` +
      `📅 ${escapeHtml(formatRuDate(isoDate))}\n\n` +
      `На эту дату расписание для группы не найдено.`;

    if (knownGroups.length > 0) {
      text +=
        `\n\n` +
        `Доступные группы:\n` +
        knownGroups
          .map((item) => `• ${escapeHtml(item)}`)
          .join("\n");
    }

    return {
      ok: false,
      isoDate,
      group: normalizedGroup,
      text,
    };
  }

  // -------------------------------------------------------------------------
  // Форматируем расписание
  // -------------------------------------------------------------------------

  const text = formatSchedule(
    isoDate,
    normalizedGroup,
    lessons,
  );

  return {
    ok: true,
    isoDate,
    group: normalizedGroup,
    text,
  };
}

// ---------------------------------------------------------------------------
// Форматирование расписания
// ---------------------------------------------------------------------------

function formatSchedule(
  isoDate: string,
  group: string,
  lessons: LessonRow[],
): string {
  const lines: string[] = [];

  lines.push(
    `📚 <b>${escapeHtml(group)}</b>`,
  );

  lines.push(
    `📅 <b>${escapeHtml(formatRuDate(isoDate))}</b>`,
  );

  lines.push("");

  // На всякий случай сортируем ещё раз.
  const sorted = [...lessons].sort((a, b) => {
    const periodA = a.period_no ?? 999;
    const periodB = b.period_no ?? 999;

    return periodA - periodB;
  });

  let currentPeriod: number | null = null;

  for (const lesson of sorted) {
    const period = lesson.period_no;

    // Разделитель между парами
    if (
      period !== null &&
      period !== currentPeriod
    ) {
      if (currentPeriod !== null) {
        lines.push("");
      }

      currentPeriod = period;
    }

    lines.push(
      formatLesson(lesson),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Одна пара
// ---------------------------------------------------------------------------

function formatLesson(
  lesson: LessonRow,
): string {
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

  const flags = parseJsonArray(lesson.flags);

  if (flags.length > 0) {
    text += `\n🏷 ${flags
      .map((flag) => escapeHtml(flag))
      .join(", ")}`;
  }

  return text;
}
// ---------------------------------------------------------------------------
// Проверка — есть ли вообще занятие
// ---------------------------------------------------------------------------

function hasLessonData(
  lesson: LessonRow,
): boolean {
  return Boolean(
    lesson.subject ||
    lesson.teacher ||
    lesson.room ||
    parseJsonArray(lesson.raw_lines).length > 0,
  );
}

// ---------------------------------------------------------------------------
// Убираем дубли
// ---------------------------------------------------------------------------

function deduplicateLessons(
  lessons: LessonRow[],
): LessonRow[] {
  const seen = new Set<string>();

  const result: LessonRow[] = [];

  for (const lesson of lessons) {
    const key = [
      lesson.block_index,
      lesson.period_no,
      lesson.time_range ?? "",
      lesson.subject ?? "",
      lesson.teacher ?? "",
      lesson.room ?? "",
      normalizeFlags(lesson.flags),
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(lesson);
  }

  return result;
}

// ---------------------------------------------------------------------------
// JSON array helper
// ---------------------------------------------------------------------------

function parseJsonArray(
  value: string | null | undefined,
): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => String(item))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Флаги для deduplication
// ---------------------------------------------------------------------------

function normalizeFlags(
  value: string | null | undefined,
): string {
  return parseJsonArray(value)
    .sort()
    .join(",");
}

// ---------------------------------------------------------------------------
// Группа
// ---------------------------------------------------------------------------

function normalizeGroup(
  group: string,
): string {
  return group
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Формат даты:
//
// 2026-09-23
// ->
// 23 сентября 2026
// ---------------------------------------------------------------------------

function formatRuDate(
  isoDate: string,
): string {
  const [year, month, day] =
    isoDate.split("-").map(Number);

  if (
    !year ||
    !month ||
    !day ||
    month < 1 ||
    month > 12
  ) {
    return isoDate;
  }

  return `${day} ${MONTHS_RU[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Формат времени
//
// 8.30 – 10.00
// ->
// 8:30 – 10:00
//
// При этом не пытаемся менять остальной текст.
// ---------------------------------------------------------------------------

function normalizeTime(
  value: string,
): string {
  return value
    .replace(/(\d{1,2})[.:](\d{2})/g, "$1:$2")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Кабинет
// ---------------------------------------------------------------------------

function formatRoom(
  room: string,
): string {
  const normalized = room.trim();

  const lower = normalized.toLowerCase();

  if (lower === "дистанционно") {
    return "Дистанционно";
  }

  if (lower === "спортзал") {
    return "Спортзал";
  }

  if (lower === "библиотека") {
    return "Библиотека";
  }

  if (lower === "тренажерный зал") {
    return "Тренажерный зал";
  }

  if (lower === "практика") {
    return "Практика";
  }

  return `Каб. ${normalized}`;
}

// ---------------------------------------------------------------------------
// Telegram HTML escaping
// ---------------------------------------------------------------------------

function escapeHtml(
  value: string,
): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}