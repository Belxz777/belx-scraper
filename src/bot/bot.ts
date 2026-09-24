import { Bot,InputFile } from "grammy";

import {
  getChatGroup,
  setChatGroup,
  deleteChatGroup,
  listGroupsForDate,
  listChatIds,
} from "../db";

import {
  getGroupScheduleMessage,
} from "./schedule";

import {
  ensureSchedule,
} from "./sch-service";

import {
  parseUserDate,
  toIsoDate,
} from "../dates";
import {  isAdmin } from "../roles/rules";
import { renderScheduleImage } from "../render/image";
import { logError, logger } from "../logs/logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const token =
  process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN не задан",
  );
}
const log = logger.child({ module: "bot.ts" });
export const bot = new Bot(token);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChatId(
  ctx: any,
): string {
  return String(ctx.chat.id);
}

function normalizeGroup(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isGroupName(
  value: string,
): boolean {
  return /^[A-ZА-ЯЁ]{1,3}-\d{2}-\d+(?:-\d+)?$/i.test(
    value.trim(),
  );
}

function isDateArg(
  value: string,
): boolean {
  const normalized =
    value.trim().toLowerCase();

  return (
    normalized === "today" ||
    normalized === "tomorrow" ||
    normalized === "yesterday" ||
    /^\d{1,2}\.\d{1,2}$/.test(normalized) ||
    /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(normalized)
  );
}

interface ScheduleArgs {
  group: string | null;
  dateArg: string;
  image?: boolean;
}

const IMAGE_TOKENS = new Set([
  "image", "img", "photo", "pic",
  "фото", "картинка", "изображение",
]);
/**
 * Разбирает:
 *
 * /schedule
 * /schedule tomorrow
 * /schedule 23.09
 * /schedule И-26-1
 * /schedule И-26-1 tomorrow
 * /schedule tomorrow И-26-1
 */

function parseScheduleArgs(
  raw: string,
  savedGroup: string | null,
): ScheduleArgs {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let group: string | null =
    savedGroup
      ? normalizeGroup(savedGroup)
      : null;

  let dateArg = "today";
  let image = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (isGroupName(token)) {
      group = normalizeGroup(token);
      continue;
    }
    if (IMAGE_TOKENS.has(lower)) {
      image = true;
      continue;
    }

    if (isDateArg(token)) {
      dateArg = token;
      continue;
    }
  }

  return {
    group,
    dateArg,
    image,
  };
}
// ---------------------------------------------------------------------------
// Единая отправка расписания: текст или картинка
// ---------------------------------------------------------------------------

async function replySchedule(
  ctx: any,
  dateArg: string,
  group: string,
  asImage: boolean,
): Promise<void> {
  if (!asImage) {
    const result = getGroupScheduleMessage(dateArg, group);

    await ctx.reply(result.text, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
    });

    return;
  }

  // --- Картинка -----------------------------------------------------------
  const rendered = await renderScheduleImage(dateArg, group);

  if (!rendered.ok || !rendered.filePath) {
    // Что-то пошло не так — отдаём хотя бы текстовую версию.
    console.error(
      "renderScheduleImage failed:",
      rendered.errorText,
    );

    const result = getGroupScheduleMessage(dateArg, group);

    await ctx.reply(
      result.text ||
        "❌ Не удалось построить изображение расписания.",
      {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      },
    );

    return;
  }

  await ctx.replyWithPhoto(new InputFile(rendered.filePath), {
    parse_mode: "HTML",
    caption: rendered.caption,
  });
}
// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

bot.command(
  "start",
  async (ctx) => {
    await ctx.reply(
      [
        "👋 <b>Бот расписания ИПЭК</b>",
        "",
        "Основные команды:",
        "",
        "/schedule — расписание на сегодня",
        "/schedule tomorrow — на завтра",
        "/schedule 23.09 — на дату",
        "/schedule И-26-1 — расписание группы",
        "",
        "/setgroup И-26-1 — привязать группу к этому чату",
        "/mygroup — показать текущую группу",
        "/unsetgroup — убрать привязку",
        "",
        "/groups — группы на сегодня",
        "/help — помощь",
      ].join("\n"),
      {
        parse_mode: "HTML",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

bot.command(
  "help",
  async (ctx) => {
    await ctx.reply(
      [
        "▤  <b>Команды расписания</b>",
        "",
        "<b>Расписание:</b>",
        "/schedule",
        "/schedule today",
        "/schedule tomorrow",
        "/schedule 23.09",
        "/schedule 23.09.2026",
        "",
        "<b>Конкретная группа:</b>",
        "/schedule И-26-1",
        "/schedule И-26-1 tomorrow",
        "",
        "<b>Группа этого чата:</b>",
        "/setgroup И-26-1",
        "/mygroup",
        "/unsetgroup",
        "",
        "<b>Расписание картинкой:</b>",
        "/schedule 23.09 image",
        "",
     
        "<b>Список групп:</b>",
        "/groups",
      ].join("\n"),
      {
        parse_mode: "HTML",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// /setgroup И-26-1
// ---------------------------------------------------------------------------

bot.command(
  "setgroup",
  async (ctx) => {
    const raw = String(
      ctx.match ?? "",
    ).trim();

    if (!raw) {
      await ctx.reply(
        "Использование:\n\n" +
        "<code>/setgroup И-26-1</code>",
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    const group = normalizeGroup(raw);

    if (!isGroupName(group)) {
      await ctx.reply(
        "❌ Не смог распознать группу.\n\n" +
        "Пример:\n" +
        "<code>/setgroup И-26-1</code>",
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    setChatGroup(
      getChatId(ctx),
      group,
    );

    await ctx.reply(
      `✓  Этот чат привязан к группе <b>${escapeHtml(group)}</b>.`,
      {
        parse_mode: "HTML",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// /mygroup
// ---------------------------------------------------------------------------

bot.command(
  "mygroup",
  async (ctx) => {
    const saved =
      getChatGroup(
        getChatId(ctx),
      );

    if (!saved) {
      await ctx.reply(
        "ⓘ Для этого чата группа ещё не задана.\n\n" +
        "Используй:\n" +
        "<code>/setgroup И-26-1</code>",
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    await ctx.reply(
      `▤  Группа этого чата: <b>${escapeHtml(saved.group_name)}</b>`,
      {
        parse_mode: "HTML",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// /unsetgroup
// ---------------------------------------------------------------------------

bot.command(
  "unsetgroup",
  async (ctx) => {
    const saved =
      getChatGroup(
        getChatId(ctx),
      );

    if (!saved) {
      await ctx.reply(
        "ⓘ  У этого чата нет привязанной группы.",
      );

      return;
    }

    deleteChatGroup(
      getChatId(ctx),
    );

    await ctx.reply(
      `✓  Привязка группы <b>${escapeHtml(saved.group_name)}</b> удалена.`,
      {
        parse_mode: "HTML",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// /schedule
// ---------------------------------------------------------------------------

bot.command(
  "schedule",
  async (ctx) => {
    try {

      const chatId =
        getChatId(ctx);

      const saved =
        getChatGroup(chatId);

     const {
  group,
  dateArg,
  image,
} = parseScheduleArgs(
  String(ctx.match ?? ""),
  saved?.group_name ?? null,
);

      // Нет группы
      if (!group) {
        await ctx.reply(
          [
            "✘  Группа не указана.",
            "",
            "Сначала привяжи группу:",
            "<code>/setgroup И-26-1</code>",
            "",
            "или укажи её прямо:",
            "<code>/schedule И-26-1</code>",
          ].join("\n"),
          {
            parse_mode: "HTML",
          },
        );

        return;
      }

      // ---------------------------------------------------------------------
      // Вычисляем дату
      // ---------------------------------------------------------------------

      const date =
        parseUserDate(dateArg);

      const isoDate =
        toIsoDate(date);

      // ---------------------------------------------------------------------
      // Проверяем БД.
      // Если данных нет — скачиваем.
      // ---------------------------------------------------------------------

      await ctx.reply(
        "↻ Проверяю расписание...",
      );
      const fetched =
        await ensureSchedule(date);
      if (
        fetched.status === "notfound"
      ) {
        await ctx.reply(
          `❌ На <b>${escapeHtml(isoDate)}</b> страница расписания отсутствует.`,
          {
            parse_mode: "HTML",
          },
        );

        return;
      }

      if (
        fetched.status === "error"
      ) {
        await ctx.reply(
          [
            "❌ Не удалось загрузить расписание.",
            "",
            fetched.error
              ? `Ошибка: <code>${escapeHtml(fetched.error)}</code> \n
              Вероятнее всего расписание еще не выложили
              `
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          {
            parse_mode: "HTML",
          },
        );

        return;
      }

      // ---------------------------------------------------------------------
      // Получаем красивый текст
      // ---------------------------------------------------------------------
    log.debug(`replySchedule ${dateArg} ${group} ${image}`);
     await replySchedule(
        ctx,
        dateArg,
        group,
        image === true,
      );
    } 
    catch (error) {
      log.error(`schedule command error: ${error}`);
      await ctx.reply(
        "❌ Произошла внутренняя ошибка при получении расписания.",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// /today
// ---------------------------------------------------------------------------

bot.command(
  "today",
  async (ctx) => {
    await sendScheduleForCommand(
      ctx,
      "today",
    );
  },
);

// ---------------------------------------------------------------------------
// /tomorrow
// ---------------------------------------------------------------------------

bot.command(
  "tomorrow",
  async (ctx) => {
    await sendScheduleForCommand(
      ctx,
      "tomorrow",
    );
  },
);

// ---------------------------------------------------------------------------
// Общая логика /today /tomorrow
// ---------------------------------------------------------------------------

async function sendScheduleForCommand(
  ctx: any,
  dateArg: string,
) {
  try {
    const saved =
      getChatGroup(
        getChatId(ctx),
      );

    if (!saved) {
      await ctx.reply(
        "❗ У этого чата не указана группа.\n\n" +
        "Используй:\n" +
        "<code>/setgroup И-26-1</code>",
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    const date =
      parseUserDate(dateArg);

    await ensureSchedule(date);

    const result =
      getGroupScheduleMessage(
        dateArg,
        saved.group_name,
      );

    await ctx.reply(
      result.text,
      {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      },
    );
  } catch (error) {
    console.error(
      `${dateArg} command error:`,
      error,
    );

    await ctx.reply(
      "❌ Не удалось получить расписание.",
    );
  }
}

// ---------------------------------------------------------------------------
// /groups
// ---------------------------------------------------------------------------

bot.command(
  "groups",
  async (ctx) => {
    try {
      const date =
        parseUserDate("today");

      const isoDate =
        toIsoDate(date);

      // Заодно гарантируем, что сегодняшняя дата есть
      // в БД.
      await ensureSchedule(date);

      const groups =
        listGroupsForDate(isoDate);

      if (groups.length === 0) {
        await ctx.reply(
          "На сегодня группы не найдены.",
        );

        return;
      }

      const text =
        [
          `▤  <b>Группы на ${escapeHtml(isoDate)}</b>`,
          "",
          ...groups.map(
            (group, index) =>
              `${index + 1}. <code>${escapeHtml(group)}</code>`,
          ),
        ].join("\n");

      await ctx.reply(
        text,
        {
          parse_mode: "HTML",
        },
      );
    } catch (error) {
      console.error(
        "groups command error:",
        error,
      );

      await ctx.reply(
        "❌ Не удалось получить список групп.",
      );
    }
  },
);

bot.command(
  "notify",
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "✕  У вас нет доступа к этой команде.",
      );

      return;
    }

    const message = String(
      ctx.match ?? "",
    ).trim();

    if (!message) {
      await ctx.reply(
        [
          "Использование:",
          "",
          "<code>/notify Текст сообщения</code>",
          "",
          "Например:",
          "<code>/notify Завтра пары начинаются в 10:00</code>",
        ].join("\n"),
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    const chatIds = listChatIds();
    if (chatIds.length === 0) {
      await ctx.reply(
        "❌ Нет зарегистрированных чатов.",
      );

      return;
    }

    await ctx.reply(
      `📨 Начинаю отправку в ${chatIds.length} чатов...`,
    );

    let success = 0;
    let failed = 0;

    for (const chatId of chatIds) {
      try {
        await bot.api.sendMessage(
          chatId,
          message,
        );

        success++;

      } catch (error) {
        failed++;

        console.error(
          `Не удалось отправить сообщение в ${chatId}:`,
          error,
        );
      }
    }

    await ctx.reply(
      [
        "✓ Рассылка завершена.",
        "",
        `📨 Отправлено: ${success}`,
        `❌ Ошибок: ${failed}`,
      ].join("\n"),
    );
  },
);
// ---------------------------------------------------------------------------
// Команды Telegram
// ---------------------------------------------------------------------------

await bot.api.setMyCommands([
  {
    command: "today",
    description: "Расписание на сегодня",
  },
  {
    command: "tomorrow",
    description: "Расписание на завтра",
  },
  {
    command: "schedule",
    description: "Расписание картинкой или в текстовом виде",
  },
  {
    command: "setgroup",
    description: "Привязать группу к чату",
  },
  {
    command: "mygroup",
    description: "Показать группу чата",
  },
  {
    command: "unsetgroup",
    description: "Удалить группу чата",
  },
  {
    command: "groups",
    description: "Список групп на сегодня",
  },
  {
    command: "help",
    description: "Помощь",
  },

]);

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

bot.catch((err) => {
  console.error(
    "Telegram bot error:",
    err.error,
  );
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.once(
  "SIGINT",
  () => bot.stop(),
);

process.once(
  "SIGTERM",
  () => bot.stop(),
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const PORT = Number(
  process.env.PORT ?? 3000,
);

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,

  routes: {
    "/": () => {
      return new Response(
        "IPEK Telegram bot is running\n",
        {
          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",
          },
        },
      );
    },

    "/health": () => {
      return Response.json({
        ok: true,
        service: "ipek-telegram-bot",
        uptime: process.uptime(),
      });
    },
  },

  fetch() {
    return new Response(
      "Not Found",
      { status: 404 },
    );
  },
});

console.log(
  `◉  HTTP server: http://127.0.0.1:${server.port}`,
);

// ---------------------------------------------------------------------------
// Проверяем Telegram API
// ---------------------------------------------------------------------------

try {
  await bot.init();

  console.log(
    `✓  Telegram API доступен`,
  );

  console.log(
    `⌬  Bot: @${bot.botInfo.username}`,
  );

  console.log(
    `🆔 Bot ID: ${bot.botInfo.id}`,
  );
} catch (error) {
  console.error(
    "❌ Не удалось подключиться к Telegram API",
  );

  console.error(error);

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Проверяем webhook
// ---------------------------------------------------------------------------

try {
  const webhook =
    await bot.api.getWebhookInfo();

  if (webhook.url) {
    console.warn(
      `⚠︎  У бота установлен webhook: ${webhook.url}`,
    );

    console.warn(
      "Удаляю webhook и переключаюсь на long polling...",
    );

    await bot.api.deleteWebhook({
      drop_pending_updates: false,
    });

    console.log(
      "✓  Webhook удалён",
    );
  } else {
    console.log(
      "✓  Webhook не установлен",
    );
  }
} catch (error) {
  console.error(
    "❌ Не удалось проверить webhook",
  );

  console.error(error);

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.once(
  "SIGINT",
  () => {
    console.log("\n🛑 Stopping bot...");
    bot.stop();
    server.stop();
  },
);

process.once(
  "SIGTERM",
  () => {
    console.log("\n🛑 Stopping bot...");
    bot.stop();
    server.stop();
  },
);

// ---------------------------------------------------------------------------
// Start long polling
// ---------------------------------------------------------------------------

console.log(
  "⌬  Starting Telegram long polling...",
);

bot.start({
  onStart(botInfo) {
    console.log(
      `✓  Telegram bot started: @${botInfo.username}`,
    );

    console.log(
      "📡 Mode: long polling",
    );

    console.log(
      "📨 Waiting for Telegram updates...",
    );
  },
});
// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escapeHtml(
  value: string,
): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
