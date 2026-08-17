// src/bot.js
const { Bot, InputFile } = require('grammy');

function formatOrderNotification(order) {
  return `Новый заказ #${order.id}\nСумма: ${order.total} ₽\nСтатус: ${order.status}`;
}

// grammY passes a BotError: `.error` holds the thrown value, `.ctx` the update context.
function handleBotError(err) {
  console.error('bot error', err && err.error !== undefined ? err.error : err);
}

function createBot({ token, adminIds }) {
  const bot = new Bot(token);
  bot.catch(handleBotError);

  // The handler must return the promise so grammY (and bot.catch) sees a rejection
  // instead of it becoming an unhandled rejection that kills the process.
  bot.command('start', (ctx) => ctx.reply('Открой каталог через кнопку меню, чтобы посмотреть товары.'));

  async function notifyNewOrder(order) {
    const text = formatOrderNotification(order);
    for (const adminId of adminIds) {
      await bot.api.sendMessage(adminId, text).catch(() => {});
    }
  }

  async function sendProofPhoto(orderId, buffer) {
    let fileId = null;
    for (const adminId of adminIds) {
      const message = await bot.api.sendPhoto(adminId, new InputFile(buffer), {
        caption: `Чек к заказу #${orderId}`,
      });
      if (!fileId) {
        fileId = message.photo[message.photo.length - 1].file_id;
      }
    }
    return fileId;
  }

  return { bot, notifyNewOrder, sendProofPhoto };
}

module.exports = { formatOrderNotification, createBot, handleBotError };
