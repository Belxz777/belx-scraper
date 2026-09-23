import {
  createCanvas,
  GlobalFonts,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  getLessons,
  getRawPage,
  type LessonRow,
} from "../db";

import {
  parseUserDate,
  toIsoDate,
} from "../dates";

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const REGULAR_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];

const BOLD_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

let FAMILY_REG = "sans-serif";
let FAMILY_BOLD = "sans-serif";

for (const p of REGULAR_PATHS) {
  if (existsSync(p)) {
    GlobalFonts.registerFromPath(p, "SchedReg");
    FAMILY_REG = "SchedReg";
    break;
  }
}
for (const p of BOLD_PATHS) {
  if (existsSync(p)) {
    GlobalFonts.registerFromPath(p, "SchedBold");
    FAMILY_BOLD = "SchedBold";
    break;
  }
}

const font = (weight: "normal" | "bold", size: number) =>
  weight === "bold"
    ? `bold ${size}px "${FAMILY_BOLD}", sans-serif`
    : `${size}px "${FAMILY_REG}", sans-serif`;

// ---------------------------------------------------------------------------
// Theme / layout
// ---------------------------------------------------------------------------

const WIDTH = 760;
const PAD = 36;
const LESSON_GAP = 12;
const HEADER_H = 118;

const BG = "#0b1220";
const CARD = "#111c30";
const CARD_HEADER = "#0f1a2c";
const ACCENT = "#38bdf8";
const TEXT = "#f1f5f9";
const MUTED = "#94a3b8";
const SUBTLE = "#64748b";

const IMAGE_DIR =
  process.env.SCHEDULE_IMAGE_DIR || "./data/images";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderScheduleImageResult {
  ok: boolean;
  filePath?: string;
  fileName?: string;
  caption?: string;
  errorText?: string;
}

interface LessonView {
  periodNo: number | null;
  timeRange: string | null;
  subject: string | null;
  teacher: string | null;
  room: string | null;
  flags: string[];
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatRuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return isoDate;
  return `${d} ${MONTHS_RU[m - 1]} ${y}`;
}

function normalizeGroup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeTime(value: string): string {
  return value
    .replace(/(\d{1,2})[.:](\d{2})/g, "$1:$2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRoom(room: string): string {
  const normalized = room.trim();
  const lower = normalized.toLowerCase();

  if (lower === "дистанционно") return "Дистанционно";
  if (lower === "спортзал") return "Спортзал";
  if (lower === "библиотека") return "Библиотека";
  if (lower === "тренажерный зал") return "Тренажерный зал";
  if (lower === "практика") return "Практика";

  return `Каб. ${normalized}`;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeFlags(value: string | null | undefined): string {
  return parseJsonArray(value).sort().join(",");
}

function hasLessonData(lesson: LessonRow): boolean {
  return Boolean(
    lesson.subject ||
      lesson.teacher ||
      lesson.room ||
      parseJsonArray(lesson.raw_lines).length > 0,
  );
}

function deduplicateLessons(lessons: LessonRow[]): LessonRow[] {
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

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lesson);
  }

  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function lessonHeight(l: LessonView): number {
  let h = 18 + 44 + 10;
  if (l.subject) h += 28 + 6;
  if (l.teacher) h += 22 + 2;
  if (l.room) h += 22 + 2;
  if (l.flags.length) h += 20 + 2;
  h += 18;
  return h;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function renderScheduleImage(
  dateArg: string,
  groupRaw: string,
): Promise<RenderScheduleImageResult> {
  try {
    // -----------------------------------------------------------------------
    // 1. Собираем данные
    // -----------------------------------------------------------------------

    const isoDate = toIsoDate(parseUserDate(dateArg));
    const group = normalizeGroup(groupRaw);
    const dateText = formatRuDate(isoDate);

    const rawPage = getRawPage(isoDate);

    if (!rawPage) {
      return {
        ok: false,
        errorText: "Эта дата ещё не загружена в базу.",
      };
    }

    if (rawPage.status !== "ok") {
      return {
        ok: false,
        errorText: "Не удалось получить расписание для этой даты.",
      };
    }

    let lessons = getLessons(isoDate, group);
    lessons = lessons.filter(hasLessonData);
    lessons = deduplicateLessons(lessons);

    if (lessons.length === 0) {
      return {
        ok: false,
        errorText: "На эту дату расписание для группы не найдено.",
      };
    }

    const sorted = [...lessons].sort((a, b) => {
      const pa = a.period_no ?? 999;
      const pb = b.period_no ?? 999;
      return pa - pb;
    });

    const view: LessonView[] = sorted.map((l) => ({
      periodNo: l.period_no,
      timeRange: l.time_range ? normalizeTime(l.time_range) : null,
      subject: l.subject,
      teacher: l.teacher,
      room: l.room ? formatRoom(l.room) : null,
      flags: parseJsonArray(l.flags),
    }));

    // -----------------------------------------------------------------------
    // 2. Рисуем
    // -----------------------------------------------------------------------

    const boxesH =
      view.reduce((sum, l) => sum + lessonHeight(l), 0) +
      LESSON_GAP * Math.max(0, view.length - 1);

    const height = PAD + HEADER_H + boxesH + PAD;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, height);

    // ---- Header -----------------------------------------------------------

    ctx.fillStyle = ACCENT;
    roundRect(ctx, PAD, PAD + 6, 4, 68, 2);
    ctx.fill();

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    ctx.fillStyle = TEXT;
    ctx.font = font("bold", 42);
    ctx.fillText(
      ellipsize(ctx, group, WIDTH - PAD * 2 - 20),
      PAD + 20,
      PAD + 48,
    );

    ctx.fillStyle = MUTED;
    ctx.font = font("normal", 22);
    ctx.fillText(
      ellipsize(ctx, dateText, WIDTH - PAD * 2 - 20),
      PAD + 20,
      PAD + 82,
    );

    // ---- Lessons ----------------------------------------------------------

    const boxX = PAD;
    const boxW = WIDTH - PAD * 2;
    let y = PAD + HEADER_H;

    for (const l of view) {
      const h = lessonHeight(l);

      ctx.fillStyle = CARD;
      roundRect(ctx, boxX, y, boxW, h, 16);
      ctx.fill();

      ctx.save();
      roundRect(ctx, boxX, y, boxW, h, 16);
      ctx.clip();
      ctx.fillStyle = ACCENT;
      ctx.fillRect(boxX, y, 6, h);
      ctx.restore();

      const badgeR = 22;
      const badgeCX = boxX + 22 + badgeR;
      const badgeCY = y + 18 + badgeR;

      ctx.fillStyle = CARD_HEADER;
      ctx.beginPath();
      ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = ACCENT;
      ctx.font = font("bold", 22);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        l.periodNo !== null ? String(l.periodNo) : "–",
        badgeCX,
        badgeCY + 1,
      );

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";

      ctx.fillStyle = TEXT;
      ctx.font = font("bold", 22);
      ctx.fillText(
        l.timeRange ?? "время неизвестно",
        badgeCX + badgeR + 14,
        badgeCY + 8,
      );

      let cy = y + 18 + 44 + 10 + 22;
      const contentX = boxX + 22;
      const contentW = boxW - 44;

      if (l.subject) {
        ctx.fillStyle = TEXT;
        ctx.font = font("bold", 26);
        ctx.fillText(ellipsize(ctx, l.subject, contentW), contentX, cy);
        cy += 28 + 6;
      }
      if (l.teacher) {
        ctx.fillStyle = MUTED;
        ctx.font = font("normal", 20);
        ctx.fillText(
          ellipsize(ctx, "✎ " + l.teacher, contentW),
          contentX,
          cy,
        );
        cy += 22 + 2;
      }
      if (l.room) {
        ctx.fillStyle = MUTED;
        ctx.font = font("normal", 20);
        ctx.fillText(
          ellipsize(ctx, "⌂ " + l.room, contentW),
          contentX,
          cy,
        );
        cy += 22 + 2;
      }
      if (l.flags.length > 0) {
        ctx.fillStyle = SUBTLE;
        ctx.font = font("normal", 18);
        ctx.fillText(
          ellipsize(ctx, "⌗ " + l.flags.join(", "), contentW),
          contentX,
          cy,
        );
      }

      y += h + LESSON_GAP;
    }

    // -----------------------------------------------------------------------
    // 3. Сохраняем
    // -----------------------------------------------------------------------

    mkdirSync(IMAGE_DIR, { recursive: true });

    const safeGroup = group.replace(/[^A-Za-zА-Яа-я0-9_-]/g, "_");
    const fileName = `schedule-${isoDate}-${safeGroup}.png`;
    const filePath = join(IMAGE_DIR, fileName);

    const buffer = canvas.toBuffer("image/png");
    await Bun.write(filePath, buffer);

    const caption =
      `<b>${escapeHtml(group)}</b> · ` +
      `<i>${escapeHtml(dateText)}</i>`;

    return {
      ok: true,
      filePath,
      fileName,
      caption,
    };
  } catch (error) {
    console.error("renderScheduleImage error:", error);

    return {
      ok: false,
      errorText:
        error instanceof Error ? error.message : String(error),
    };
  }
}