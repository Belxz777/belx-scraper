import { bot } from "../bot/bot";
import { listChatIds } from "../db";
import { adminOnly, isAdmin } from "../roles/rules";


bot.command(
  "notify",
  adminOnly,
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "⛔ У вас нет доступа к этой команде.",
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
    console.log(chatIds);
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
        "✅ Рассылка завершена.",
        "",
        `📨 Отправлено: ${success}`,
        `❌ Ошибок: ${failed}`,
      ].join("\n"),
    );
  },
);