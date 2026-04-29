const { Bot } = require("grammy");

const { buildReminderDate, formatDateTime, getCurrentYear } = require("../utils/date");
const { log } = require("../utils/logger");
const { createClient, getClientById, listClients, searchClients, updateClientStatus } = require("../services/clientService");
const {
  createReminder,
  deleteReminderForUser,
  listDueReminders,
  listPendingByClientAndUser,
  listUserReminders,
  markReminderSent,
} = require("../services/reminderService");
const { clearState, getState, setState } = require("./state");
const {
  buildClientActions,
  buildClientsKeyboard,
  buildDayKeyboard,
  buildMainMenu,
  buildMonthKeyboard,
  buildReminderListKeyboard,
  buildReminderScopeMenu,
  buildStatusKeyboard,
  buildTimeKeyboard,
} = require("./keyboards");

const REMINDER_POLL_MS = 30000;
const cooldown = {};

function isSpam(userId) {
  const now = Date.now();
  if (cooldown[userId] && now - cooldown[userId] < 1200) return true;
  cooldown[userId] = now;
  return false;
}

async function showClientDetail(ctx, clientId) {
  const client = await getClientById(clientId);

  if (!client) {
    await ctx.reply("No existe ese cliente.");
    return null;
  }

  await ctx.reply(
    [
      `🧑 ${client.nombre}`,
      `📞 ${client.telefono || "-"}`,
      `🏢 ${client.empresa || "-"}`,
      `📍 ${client.direccion || "-"}`,
      `📝 ${client.notas || "-"}`,
      `📊 ${client.estado || "-"}`,
      `⏰ Pendientes: ${client.pending_reminders || 0}`,
    ].join("\n"),
    { reply_markup: buildClientActions(client.id) }
  );

  return client;
}

async function showReminderScope(ctx, userId, scope) {
  const reminders = await listUserReminders(userId, scope);
  const title = scope === "today" ? "Recordatorios de hoy" : "Todos tus recordatorios pendientes";

  if (!reminders.length) {
    return ctx.reply(`${title}: sin pendientes.`, { reply_markup: buildReminderScopeMenu() });
  }

  const lines = reminders.map(
    (reminder, index) =>
      `${index + 1}. ${formatDateTime(reminder.fecha)} | ${reminder.cliente_nombre} | ${reminder.motivo}`
  );

  return ctx.reply([title, ...lines].join("\n"), {
    reply_markup: buildReminderListKeyboard(reminders, "remmenu"),
  });
}

function createBot({ token, webUrl }) {
  const bot = new Bot(token);

  bot.catch((err) => {
    const error = err.error || err;
    log(`Error bot: ${error.message}`, "ERROR");
  });

  bot.command("start", async (ctx) => {
    log(`START por ${ctx.from.id}`);
    await ctx.reply("Panel listo.", { reply_markup: buildMainMenu(webUrl) });
  });

  bot.command("menu", async (ctx) => {
    clearState(ctx.from.id);
    await ctx.reply("Menú principal", { reply_markup: buildMainMenu(webUrl) });
  });

  async function safeCallback(ctx, name, fn) {
    try {
      if (isSpam(ctx.from.id)) {
        return ctx.answerCallbackQuery({ text: "Espera un segundo.", show_alert: false });
      }

      await ctx.answerCallbackQuery();
      log(`Click ${name} por ${ctx.from.id}`);
      await fn();
    } catch (err) {
      log(`Error en ${name}: ${err.message}`, "ERROR");
      await ctx.reply("No pude completar esa acción.");
    }
  }

  bot.callbackQuery("menu", (ctx) =>
    safeCallback(ctx, "menu", async () => {
      clearState(ctx.from.id);
      await ctx.reply("Menú principal", { reply_markup: buildMainMenu(webUrl) });
    })
  );

  bot.callbackQuery("add", (ctx) =>
    safeCallback(ctx, "add", async () => {
      setState(ctx.from.id, { step: "client_name", data: {} });
      await ctx.reply("Nombre del contacto o representante:");
    })
  );

  bot.callbackQuery("buscar", (ctx) =>
    safeCallback(ctx, "buscar", async () => {
      setState(ctx.from.id, { step: "search_query", data: {} });
      await ctx.reply("Escribe nombre, empresa o teléfono:");
    })
  );

  bot.callbackQuery("list", (ctx) =>
    safeCallback(ctx, "list", async () => {
      const clients = await listClients();

      if (!clients.length) {
        return ctx.reply("No hay clientes todavía.");
      }

      await ctx.reply("Clientes recientes:", {
        reply_markup: buildClientsKeyboard(clients),
      });
    })
  );

  bot.callbackQuery("remmenu", (ctx) =>
    safeCallback(ctx, "remmenu", async () => {
      await ctx.reply("¿Qué recordatorios quieres ver?", {
        reply_markup: buildReminderScopeMenu(),
      });
    })
  );

  bot.callbackQuery("remscope_today", (ctx) =>
    safeCallback(ctx, "remscope_today", async () => {
      await showReminderScope(ctx, ctx.from.id, "today");
    })
  );

  bot.callbackQuery("remscope_all", (ctx) =>
    safeCallback(ctx, "remscope_all", async () => {
      await showReminderScope(ctx, ctx.from.id, "all");
    })
  );

  bot.callbackQuery(/ver_(\d+)/, (ctx) =>
    safeCallback(ctx, "ver", async () => {
      await showClientDetail(ctx, Number(ctx.match[1]));
    })
  );

  bot.callbackQuery(/status_(\d+)/, (ctx) =>
    safeCallback(ctx, "status", async () => {
      const clientId = Number(ctx.match[1]);
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      await ctx.reply(`Selecciona nuevo estatus para ${client.nombre}:`, {
        reply_markup: buildStatusKeyboard(clientId),
      });
    })
  );

  bot.callbackQuery(/statusset_(\d+)_(.+)/, (ctx) =>
    safeCallback(ctx, "statusset", async () => {
      const clientId = Number(ctx.match[1]);
      const statusCode = ctx.match[2];
      const client = await updateClientStatus(clientId, statusCode);

      if (!client) return ctx.reply("No pude actualizar el estatus.");

      await ctx.reply(`Estatus actualizado a ${client.estado}.`);
      await showClientDetail(ctx, clientId);
    })
  );

  bot.callbackQuery(/remadd_(\d+)/, (ctx) =>
    safeCallback(ctx, "remadd", async () => {
      const clientId = Number(ctx.match[1]);
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      setState(ctx.from.id, {
        step: "reminder_month",
        data: {
          clientId,
          clientName: client.nombre,
          year: getCurrentYear(),
        },
      });

      await ctx.reply(`Selecciona el mes para ${client.nombre}:`, {
        reply_markup: buildMonthKeyboard(clientId),
      });
    })
  );

  bot.callbackQuery(/rmm_(\d+)_(\d+)/, (ctx) =>
    safeCallback(ctx, "rmm", async () => {
      const clientId = Number(ctx.match[1]);
      const month = Number(ctx.match[2]);
      const state = getState(ctx.from.id);
      const year = state?.data?.year || getCurrentYear();
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      setState(ctx.from.id, {
        step: "reminder_day",
        data: { clientId, clientName: client.nombre, year, month },
      });

      await ctx.reply(`Ahora selecciona el día para ${client.nombre}:`, {
        reply_markup: buildDayKeyboard(clientId, year, month),
      });
    })
  );

  bot.callbackQuery(/rmd_(\d+)_(\d+)_(\d+)/, (ctx) =>
    safeCallback(ctx, "rmd", async () => {
      const clientId = Number(ctx.match[1]);
      const month = Number(ctx.match[2]);
      const day = Number(ctx.match[3]);
      const state = getState(ctx.from.id);
      const year = state?.data?.year || getCurrentYear();
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      setState(ctx.from.id, {
        step: "reminder_time",
        data: { clientId, clientName: client.nombre, year, month, day },
      });

      await ctx.reply(`Selecciona la hora para ${client.nombre}:`, {
        reply_markup: buildTimeKeyboard(clientId, year, month, day),
      });
    })
  );

  bot.callbackQuery(/rmt_(\d+)_(\d+)_(\d+)_(\d{4})/, (ctx) =>
    safeCallback(ctx, "rmt", async () => {
      const clientId = Number(ctx.match[1]);
      const month = Number(ctx.match[2]);
      const day = Number(ctx.match[3]);
      const timeValue = ctx.match[4];
      const state = getState(ctx.from.id);
      const year = state?.data?.year || getCurrentYear();
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      const date = buildReminderDate(year, month, day, timeValue);
      if (date.getTime() <= Date.now()) {
        return ctx.reply("Ese horario ya pasó. Elige otro.");
      }

      setState(ctx.from.id, {
        step: "reminder_reason",
        data: { clientId, clientName: client.nombre, date },
      });

      await ctx.reply(`Fecha elegida: ${formatDateTime(date)}. Ahora escribe el motivo del recordatorio.`);
    })
  );

  bot.callbackQuery(/remlist_(\d+)/, (ctx) =>
    safeCallback(ctx, "remlist", async () => {
      const clientId = Number(ctx.match[1]);
      const client = await getClientById(clientId);

      if (!client) return ctx.reply("No existe ese cliente.");

      const reminders = await listPendingByClientAndUser(clientId, ctx.from.id);
      if (!reminders.length) {
        return ctx.reply(`No tienes recordatorios pendientes para ${client.nombre}.`, {
          reply_markup: buildClientActions(clientId),
        });
      }

      const lines = reminders.map(
        (reminder, index) => `${index + 1}. ${formatDateTime(reminder.fecha)} | ${reminder.motivo}`
      );

      await ctx.reply([`Recordatorios de ${client.nombre}:`, ...lines].join("\n"), {
        reply_markup: buildReminderListKeyboard(reminders, `ver_${clientId}`),
      });
    })
  );

  bot.callbackQuery(/remdel_(\d+)/, (ctx) =>
    safeCallback(ctx, "remdel", async () => {
      const reminder = await deleteReminderForUser(Number(ctx.match[1]), ctx.from.id);

      if (!reminder) {
        return ctx.reply("Ese recordatorio no existe o no te pertenece.", {
          reply_markup: buildReminderScopeMenu(),
        });
      }

      await ctx.reply(`Recordatorio eliminado para ${reminder.cliente_nombre}.`, {
        reply_markup: buildClientActions(reminder.cliente_id),
      });
    })
  );

  bot.on("message", async (ctx) => {
    try {
      const state = getState(ctx.from.id);
      if (!state) return;

      const text = ctx.message.text;
      if (!text) return ctx.reply("Mándame texto para continuar.");

      if (text.toLowerCase() === "cancelar") {
        clearState(ctx.from.id);
        return ctx.reply("Operación cancelada.", { reply_markup: buildMainMenu(webUrl) });
      }

      log(`MSG ${ctx.from.id} -> ${text}`);

      switch (state.step) {
        case "client_name":
          setState(ctx.from.id, { step: "client_phone", data: { ...state.data, nombre: text.trim() } });
          return ctx.reply("Teléfono:");

        case "client_phone":
          setState(ctx.from.id, {
            step: "client_company",
            data: { ...state.data, telefono: text.replace(/\D/g, "") },
          });
          return ctx.reply("Empresa (o escribe no):");

        case "client_company":
          setState(ctx.from.id, {
            step: "client_address",
            data: { ...state.data, empresa: text.toLowerCase() === "no" ? "" : text.trim() },
          });
          return ctx.reply("Dirección (o escribe no):");

        case "client_address":
          setState(ctx.from.id, {
            step: "client_notes",
            data: { ...state.data, direccion: text.toLowerCase() === "no" ? "" : text.trim() },
          });
          return ctx.reply("Notas (o escribe no):");

        case "client_notes": {
          const client = await createClient({
            ...state.data,
            notas: text.toLowerCase() === "no" ? "" : text.trim(),
          });

          clearState(ctx.from.id);
          await ctx.reply(`Cliente guardado: ${client.nombre}`, {
            reply_markup: buildClientActions(client.id),
          });
          return undefined;
        }

        case "search_query": {
          const clients = await searchClients(text.trim());
          clearState(ctx.from.id);

          if (!clients.length) {
            return ctx.reply("No encontré clientes con ese dato.", {
              reply_markup: buildMainMenu(webUrl),
            });
          }

          return ctx.reply("Resultados:", {
            reply_markup: buildClientsKeyboard(clients),
          });
        }

        case "reminder_reason": {
          const reason = text.trim();
          if (reason.length < 3) {
            return ctx.reply("Escribe un motivo más claro, mínimo 3 caracteres.");
          }

          const reminder = await createReminder({
            clientId: state.data.clientId,
            userId: ctx.from.id,
            date: state.data.date,
            motivo: reason,
          });

          clearState(ctx.from.id);
          return ctx.reply(
            [
              "Recordatorio agendado.",
              `Cliente: ${reminder.cliente_nombre}`,
              `Fecha: ${formatDateTime(reminder.fecha)}`,
              `Motivo: ${reminder.motivo}`,
            ].join("\n"),
            { reply_markup: buildClientActions(reminder.cliente_id) }
          );
        }

        default:
          return undefined;
      }
    } catch (err) {
      log(`Error mensaje: ${err.message}`, "ERROR");
      return ctx.reply("Se cayó esa operación. Revisa logs.");
    }
  });

  return bot;
}

function startReminderWorker(bot) {
  setInterval(async () => {
    try {
      const reminders = await listDueReminders();
      if (reminders.length) log(`Recordatorios pendientes: ${reminders.length}`);

      for (const reminder of reminders) {
        try {
          await bot.api.sendMessage(
            reminder.user_id,
            [
              "⏰ Recordatorio",
              `Cliente: ${reminder.cliente_nombre}`,
              `Hora: ${formatDateTime(reminder.fecha)}`,
              `Motivo: ${reminder.motivo}`,
            ].join("\n")
          );

          await markReminderSent(reminder.id);
          log(`Recordatorio ${reminder.id} enviado a ${reminder.user_id}`);
        } catch (err) {
          log(`No se pudo enviar recordatorio ${reminder.id}: ${err.message}`, "ERROR");
        }
      }
    } catch (err) {
      log(`Error worker recordatorios: ${err.message}`, "ERROR");
    }
  }, REMINDER_POLL_MS);
}

module.exports = {
  createBot,
  startReminderWorker,
};