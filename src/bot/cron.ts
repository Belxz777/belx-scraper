import { Bot } from "grammy";

import {
  getLessons,
  getRawPage,
  listChatsForGroup,
  markScheduleNotificationSent,
  wasScheduleNotificationSent,
  type LessonRow,
} from "../db";

import {
  fetchAndStore,
} from "./sch-service";

import {
  getGroupScheduleMessage,
} from "./schedule";

import {
  toIsoDate,
  toScheduleUrl,
} from "../dates";

const token =
  process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN не задан",
  );
}

const bot = new Bot(token);

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

const DAYS_AHEAD = Number(
  process.env.SCHEDULE_DAYS_AHEAD ?? 7,
);

const FETCH_DELAY_MS = Number(
  process.env.SCHEDULE_FETCH_DELAY_MS ?? 500,
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "⏰ Schedule cron started",
  );

  console.log(
    `📅 Проверяем сегодня + ${DAYS_AHEAD} дней`,
  );

  const today = startOfDay(
    new Date(),
  );

  for (
    let offset = 0;
    offset <= DAYS_AHEAD;
    offset++
  ) {
    const date = addDays(
      today,
      offset,
    );

    try {
      await processDate(date);
    } catch (error) {
      console.error(
        `❌ Ошибка обработки ${toIsoDate(date)}:`,
        error,
      );
    }

    if (offset < DAYS_AHEAD) {
      await sleep(FETCH_DELAY_MS);
    }
  }

  console.log(
    "✅ Schedule cron finished",
  );
}

// ---------------------------------------------------------------------------
// Один день
// ---------------------------------------------------------------------------

async function processDate(
  date: Date,
) {
  const isoDate = toIsoDate(date);

  const raw = getRawPage(isoDate);

  // -------------------------------------------------------------------------
  // Если расписание уже нормально сохранено и в нём есть реальные занятия,
  // повторно страницу не скачиваем.
  //
  // Если было 404/error или пустая страница — пробуем снова.
  // -------------------------------------------------------------------------

  const alreadyAvailable =
    raw?.status === "ok" &&
    hasActualLessons(
      getLessons(isoDate),
    );

  if (alreadyAvailable) {
    console.log(
      `⏭ ${isoDate}: расписание уже есть`,
    );

    return;
  }

  console.log(
    `🔎 ${isoDate}: проверяем ${toScheduleUrl(date)}`,
  );

  const result =
    await fetchAndStore(date);

  if (result.status === "notfound") {
    console.log(
      `⏳ ${isoDate}: страницы ещё нет`,
    );

    return;
  }

  if (result.status === "error") {
    console.log(
      `⚠️ ${isoDate}: ошибка загрузки: ${result.error ?? "unknown"}`,
    );

    return;
  }

  // -------------------------------------------------------------------------
  // После загрузки проверяем, действительно ли появилось расписание.
  // -------------------------------------------------------------------------

  const lessons =
    getLessons(isoDate);

  if (!hasActualLessons(lessons)) {
    console.log(
      `⏳ ${isoDate}: страница есть, но расписания пока нет`,
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Расписание появилось.
  // Отправляем сообщения для всех групп, найденных на дату.
  // -------------------------------------------------------------------------

  console.log(
    `🎉 ${isoDate}: новое расписание появилось`,
  );

  await notifyGroups(
    isoDate,
    lessons,
  );
}

// ---------------------------------------------------------------------------
// Уведомление групп
// ---------------------------------------------------------------------------

async function notifyGroups(
  isoDate: string,
  lessons: LessonRow[],
) {
  const groups =
    getGroupsWithLessons(lessons);

  console.log(
    `👥 ${isoDate}: групп с расписанием ${groups.length}`,
  );

  for (const group of groups) {
    const chatIds =
      listChatsForGroup(group);

    if (chatIds.length === 0) {
      console.log(
        `ℹ️ ${group}: Telegram-чатов нет`,
      );

      continue;
    }

    const dateArg =
      formatUserDate(isoDate);

    const result =
      getGroupScheduleMessage(
        dateArg,
        group,
      );

    if (!result.ok) {
      console.log(
        `⚠️ ${group}: не удалось сформировать сообщение`,
      );

      continue;
    }

    for (const chatId of chatIds) {
      // ---------------------------------------------------------------------
      // Защита от повторной отправки
      // ---------------------------------------------------------------------

      if (
        wasScheduleNotificationSent(
          chatId,
          isoDate,
        )
      ) {
        console.log(
          `⏭ ${group} → ${chatId}: уже отправлено`,
        );

        continue;
      }

      try {
        const text =
          [
            `🔔 <b>Появилось новое расписание</b>`,
            "",
            result.text,
          ].join("\n");

        await bot.api.sendMessage(
          chatId,
          text,
          {
            parse_mode: "HTML",
            link_preview_options: {
              is_disabled: true,
            },
          },
        );

        markScheduleNotificationSent(
          chatId,
          isoDate,
        );

        console.log(
          `📨 ${group} → ${chatId}: отправлено`,
        );
      } catch (error) {
        console.error(
          `❌ ${group} → ${chatId}: Telegram error`,
          error,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Только группы, у которых действительно есть занятия
// ---------------------------------------------------------------------------

function getGroupsWithLessons(
  lessons: LessonRow[],
): string[] {
  const groups = new Set<string>();

  for (const lesson of lessons) {
    const hasData =
      Boolean(
        lesson.subject ||
        lesson.teacher ||
        lesson.room,
      );

    if (hasData) {
      groups.add(
        lesson.group_name,
      );
    }
  }

  return [
    ...groups,
  ].sort();
}

// ---------------------------------------------------------------------------
// Есть ли реальные занятия
// ---------------------------------------------------------------------------

function hasActualLessons(
  lessons: LessonRow[],
): boolean {
  return lessons.some(
    (lesson) =>
      Boolean(
        lesson.subject ||
        lesson.teacher ||
        lesson.room,
      ),
  );
}

// ---------------------------------------------------------------------------
// ISO → DD.MM.YYYY
// ---------------------------------------------------------------------------

function formatUserDate(
  isoDate: string,
): string {
  const [
    year,
    month,
    day,
  ] = isoDate.split("-");

  return `${day}.${month}.${year}`;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfDay(
  date: Date,
): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
}

function addDays(
  date: Date,
  days: number,
): Date {
  const result = new Date(date);

  result.setDate(
    result.getDate() + days,
  );

  return result;
}

function sleep(
  ms: number,
) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

main().catch((error) => {
  console.error(
    "❌ Schedule cron fatal error:",
    error,
  );

  process.exit(1);
});