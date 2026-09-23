import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ParsedPage, ScheduleBlock } from "./parser";

const DB_PATH = process.env.SCHEDULE_DB_PATH || "./data/schedule.sqlite";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS raw_pages (
    date        TEXT PRIMARY KEY,   -- YYYY-MM-DD
    url         TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,      -- ISO timestamp
    status      TEXT NOT NULL,      -- 'ok' | 'error'
    http_status INTEGER,
    html        TEXT
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    block_index INTEGER NOT NULL,
    period_no   INTEGER,
    time_range  TEXT,
    group_name  TEXT NOT NULL,
    subject     TEXT,
    teacher     TEXT,
    room        TEXT,
    flags       TEXT,               -- JSON array
    confidence  TEXT,               -- 'high' | 'low'
    raw_lines   TEXT,               -- JSON array, всегда достоверно
    UNIQUE(date, block_index, period_no, group_name)
  );

  CREATE TABLE IF NOT EXISTS unstructured_blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    block_index INTEGER NOT NULL,
    groups      TEXT,               -- JSON array
    raw_text    TEXT,
    UNIQUE(date, block_index)
  );
  CREATE TABLE IF NOT EXISTS chat_groups (
  chat_id    TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
 CREATE TABLE IF NOT EXISTS schedule_notifications (
    chat_id    TEXT NOT NULL,
    date       TEXT NOT NULL,
    sent_at    TEXT NOT NULL,

    PRIMARY KEY (chat_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_lessons_date_group ON lessons(date, group_name);
`);

export function saveRawPage(params: {
  isoDate: string;
  url: string;
  status: "ok" | "error";
  httpStatus?: number;
  html?: string;
}) {
  db.query(
    `INSERT INTO raw_pages (date, url, fetched_at, status, http_status, html)
     VALUES ($date, $url, $fetched_at, $status, $http_status, $html)
     ON CONFLICT(date) DO UPDATE SET
       url = excluded.url,
       fetched_at = excluded.fetched_at,
       status = excluded.status,
       http_status = excluded.http_status,
       html = excluded.html`
  ).run({
    $date: params.isoDate,
    $url: params.url,
    $fetched_at: new Date().toISOString(),
    $status: params.status,
    $http_status: params.httpStatus ?? null,
    $html: params.html ?? null,
  });
}
/**
 легаси
 */
// export function getRawPage(isoDate: string) {
//   return db.query(`SELECT * FROM raw_pages WHERE date = $date`).get({ $date: isoDate }) as
//     | { date: string; url: string; fetched_at: string; status: string; http_status: number | null; html: string | null }
//     | null;
// }

export function saveParsedPage(parsed: ParsedPage) {
  const del = db.transaction(() => {
    db.query(`DELETE FROM lessons WHERE date = $date`).run({ $date: parsed.isoDate });
    db.query(`DELETE FROM unstructured_blocks WHERE date = $date`).run({ $date: parsed.isoDate });

    for (const block of parsed.blocks) {
      saveBlock(parsed.isoDate, block);
    }
  });
  del();
}

function saveBlock(isoDate: string, block: ScheduleBlock) {
  if (block.kind === "unstructured") {
    db.query(
      `INSERT INTO unstructured_blocks (date, block_index, groups, raw_text)
       VALUES ($date, $block_index, $groups, $raw_text)
       ON CONFLICT(date, block_index) DO UPDATE SET
         groups = excluded.groups, raw_text = excluded.raw_text`
    ).run({
      $date: isoDate,
      $block_index: block.index,
      $groups: JSON.stringify(block.groups),
      $raw_text: block.rawText,
    });
    return;
  }

  const insert = db.query(
    `INSERT INTO lessons
       (date, block_index, period_no, time_range, group_name, subject, teacher, room, flags, confidence, raw_lines)
     VALUES
       ($date, $block_index, $period_no, $time_range, $group_name, $subject, $teacher, $room, $flags, $confidence, $raw_lines)
     ON CONFLICT(date, block_index, period_no, group_name) DO UPDATE SET
       time_range = excluded.time_range,
       subject = excluded.subject,
       teacher = excluded.teacher,
       room = excluded.room,
       flags = excluded.flags,
       confidence = excluded.confidence,
       raw_lines = excluded.raw_lines`
  );

  for (const period of block.periods) {
    for (const cell of period.cells) {
      insert.run({
        $date: isoDate,
        $block_index: block.index,
        $period_no: period.periodNo,
        $time_range: period.timeRange,
        $group_name: cell.group,
        $subject: cell.subject,
        $teacher: cell.teacher,
        $room: cell.room,
        $flags: JSON.stringify(cell.flags),
        $confidence: cell.confidence,
        $raw_lines: JSON.stringify(cell.lines),
      });
    }
  }
}

export interface LessonRow {
  date: string;
  block_index: number;
  period_no: number | null;
  time_range: string | null;
  group_name: string;
  subject: string | null;
  teacher: string | null;
  room: string | null;
  flags: string;
  confidence: string;
  raw_lines: string;
}

export function getLessons(isoDate: string, group?: string): LessonRow[] {
  if (group) {
    return db
      .query(
        `SELECT * FROM lessons WHERE date = $date AND group_name = $group
         ORDER BY block_index, period_no`
      )
      .all({ $date: isoDate, $group: group }) as LessonRow[];
  }
  return db
    .query(`SELECT * FROM lessons WHERE date = $date ORDER BY block_index, period_no`)
    .all({ $date: isoDate }) as LessonRow[];
}

export function getUnstructuredBlocks(isoDate: string) {
  return db
    .query(`SELECT * FROM unstructured_blocks WHERE date = $date ORDER BY block_index`)
    .all({ $date: isoDate }) as { date: string; block_index: number; groups: string; raw_text: string }[];
}

export function listStoredDates(): string[] {
  return (db.query(`SELECT date FROM raw_pages ORDER BY date`).all() as { date: string }[]).map(
    (r) => r.date
  );
}

export function listGroupsForDate(isoDate: string): string[] {
  const rows = db
    .query(`SELECT DISTINCT group_name FROM lessons WHERE date = $date ORDER BY group_name`)
    .all({ $date: isoDate }) as { group_name: string }[];
  return rows.map((r) => r.group_name);
}
export  function listAllGroups (): string[] {
  const rows = db
  .query(`select distinct group_name from lessons `)
  .all() as { group_name: string }[];
  return rows.map((r) => r.group_name);

}
export function listChatIds(): string[] {
  const rows = db
    .query(`SELECT chat_id FROM chat_groups`)
    .all() as { chat_id: string }[];

  return rows.map((row) => row.chat_id);
}
export interface ChatGroup {
  chat_id: string;
  group_name: string;
  updated_at: string;
}

export function setChatGroup(
  chatId: string | number,
  groupName: string,
) {
  db.query(`
    INSERT INTO chat_groups (
      chat_id,
      group_name,
      updated_at
    )
    VALUES (
      $chat_id,
      $group_name,
      $updated_at
    )
    ON CONFLICT(chat_id) DO UPDATE SET
      group_name = excluded.group_name,
      updated_at = excluded.updated_at
  `).run({
    $chat_id: String(chatId),
    $group_name: groupName,
    $updated_at: new Date().toISOString(),
  });
}

export function getChatGroup(
  chatId: string | number,
): ChatGroup | null {
  return db
    .query(`
      SELECT *
      FROM chat_groups
      WHERE chat_id = $chat_id
    `)
    .get({
      $chat_id: String(chatId),
    }) as ChatGroup | null;
}

export function deleteChatGroup(
  chatId: string | number,
) {
  db.query(`
    DELETE FROM chat_groups
    WHERE chat_id = $chat_id
  `).run({
    $chat_id: String(chatId),
  });
}
export interface ChatGroup {
  chat_id: string;
  group_name: string;
  updated_at: string;
}

export function listChatsForGroup(
  groupName: string,
): string[] {
  const rows = db
    .query(`
      SELECT chat_id
      FROM chat_groups
      WHERE group_name = $group_name
    `)
    .all({
      $group_name: groupName,
    }) as { chat_id: string }[];

  return rows.map((row) => row.chat_id);
}

export function wasScheduleNotificationSent(
  chatId: string,
  isoDate: string,
): boolean {
  const row = db
    .query(`
      SELECT 1
      FROM schedule_notifications
      WHERE chat_id = $chat_id
        AND date = $date
      LIMIT 1
    `)
    .get({
      $chat_id: chatId,
      $date: isoDate,
    });

  return Boolean(row);
}

export function markScheduleNotificationSent(
  chatId: string,
  isoDate: string,
): void {
  db.query(`
    INSERT OR IGNORE INTO schedule_notifications (
      chat_id,
      date,
      sent_at
    )
    VALUES (
      $chat_id,
      $date,
      $sent_at
    )
  `).run({
    $chat_id: chatId,
    $date: isoDate,
    $sent_at: new Date().toISOString(),
  });
}
export interface RawPage {
  date: string;
  url: string;
  fetched_at: string;
  status: "ok" | "error";
  http_status: number | null;
  html: string | null;
}

export function getRawPage(isoDate: string): RawPage | null {
  return (
    db
      .query<RawPage, { $date: string }>(
        `SELECT date, url, fetched_at, status, http_status, html
         FROM raw_pages
         WHERE date = $date`
      )
      .get({ $date: isoDate }) ?? null
  );
}

/**
 * Обновляет только отметку времени — используется, когда
 * содержимое страницы не изменилось, но нужно «освежить» кэш,
 * чтобы не долбить сервер на каждом запросе.
 */
export function touchRawPage(isoDate: string): void {
  db.query(
    `UPDATE raw_pages
       SET fetched_at = $fetched_at
     WHERE date = $date`
  ).run({
    $date: isoDate,
    $fetched_at: new Date().toISOString(),
  });
}