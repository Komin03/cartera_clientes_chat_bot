const { InlineKeyboard } = require("grammy");

const { CLIENT_STATUSES } = require("../services/clientService");
const { getAvailableDays, getTimeSlotsForDate, getUpcomingMonths } = require("../utils/date");

function isPublicWebUrl(value) {
  if (!value) return false;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return false;
    if (host.endsWith(".local")) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;

    return true;
  } catch {
    return false;
  }
}

function addRows(keyboard, items, mapItem, perRow = 2) {
  items.forEach((item, index) => {
    const { text, callback } = mapItem(item);
    keyboard.text(text, callback);

    if ((index + 1) % perRow === 0 || index === items.length - 1) {
      keyboard.row();
    }
  });

  return keyboard;
}

function buildMainMenu(webUrl) {
  const keyboard = new InlineKeyboard()
    .text("➕ Agregar cliente", "add")
    .row()
    .text("📋 Ver clientes", "list")
    .text("🔎 Buscar", "buscar")
    .row()
    .text("⏰ Recordatorios", "remmenu");

  if (isPublicWebUrl(webUrl)) {
    keyboard.row().url("🌐 Dashboard", webUrl);
  }

  return keyboard;
}

function buildClientsKeyboard(clients) {
  const keyboard = new InlineKeyboard();
  clients.forEach((client) => keyboard.text(client.nombre, `ver_${client.id}`).row());
  keyboard.text("📋 Menú", "menu");
  return keyboard;
}

function buildClientActions(clientId) {
  return new InlineKeyboard()
    .text("⏰ Agendar recordatorio", `remadd_${clientId}`)
    .text("📌 Ver recordatorios", `remlist_${clientId}`)
    .row()
    .text("🟢 Cambiar estatus", `status_${clientId}`)
    .row()
    .text("📋 Menú", "menu");
}

function buildReminderScopeMenu() {
  return new InlineKeyboard()
    .text("📅 Solo hoy", "remscope_today")
    .text("🗂 Todos", "remscope_all")
    .row()
    .text("📋 Menú", "menu");
}

function buildReminderListKeyboard(reminders, backCallback = "remmenu") {
  const keyboard = new InlineKeyboard();

  reminders.forEach((reminder) => {
    const reason = reminder.motivo.length > 18 ? `${reminder.motivo.slice(0, 15)}...` : reminder.motivo;
    keyboard.text(`🗑 ${reason}`, `remdel_${reminder.id}`).row();
  });

  keyboard.text("🔙 Volver", backCallback);
  return keyboard;
}

function buildStatusKeyboard(clientId) {
  const keyboard = new InlineKeyboard();
  addRows(
    keyboard,
    CLIENT_STATUSES,
    (status) => ({
      text: status.label,
      callback: `statusset_${clientId}_${status.code}`,
    }),
    1
  );

  keyboard.text("🔙 Volver al cliente", `ver_${clientId}`);
  return keyboard;
}

function buildMonthKeyboard(clientId) {
  const keyboard = new InlineKeyboard();
  addRows(
    keyboard,
    getUpcomingMonths(),
    (month) => ({
      text: month.label,
      callback: `rmm_${clientId}_${month.value}`,
    }),
    2
  );

  keyboard.text("🔙 Cliente", `ver_${clientId}`);
  return keyboard;
}

function buildDayKeyboard(clientId, year, month) {
  const keyboard = new InlineKeyboard();
  addRows(
    keyboard,
    getAvailableDays(year, month),
    (day) => ({
      text: String(day),
      callback: `rmd_${clientId}_${month}_${day}`,
    }),
    5
  );

  keyboard.text("🔙 Meses", `remadd_${clientId}`);
  return keyboard;
}

function buildTimeKeyboard(clientId, year, month, day) {
  const keyboard = new InlineKeyboard();
  addRows(
    keyboard,
    getTimeSlotsForDate(year, month, day),
    (slot) => ({
      text: slot.label,
      callback: `rmt_${clientId}_${month}_${day}_${slot.value}`,
    }),
    4
  );

  keyboard.text("🔙 Días", `rmm_${clientId}_${month}`);
  return keyboard;
}

module.exports = {
  buildClientActions,
  buildClientsKeyboard,
  buildDayKeyboard,
  buildMainMenu,
  buildMonthKeyboard,
  buildReminderListKeyboard,
  buildReminderScopeMenu,
  buildStatusKeyboard,
  buildTimeKeyboard,
};