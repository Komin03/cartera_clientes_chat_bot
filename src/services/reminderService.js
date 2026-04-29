const { getDb } = require("../db");
const { toMysqlDateTime } = require("../utils/date");

function normalizeLimit(limit, fallback = 50) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 300);
}

async function createReminder({ clientId, userId, date, motivo }) {
  const db = getDb();
  const fecha = date instanceof Date ? toMysqlDateTime(date) : date;

  const [result] = await db.execute(
    `INSERT INTO recordatorios (cliente_id, user_id, fecha, motivo)
     VALUES (?, ?, ?, ?)`,
    [clientId, userId, fecha, motivo]
  );

  const [[reminder]] = await db.execute(
    `SELECT r.*, c.nombre AS cliente_nombre
     FROM recordatorios r
     INNER JOIN clientes c ON c.id = r.cliente_id
     WHERE r.id=?`,
    [result.insertId]
  );

  return reminder;
}

async function listUserReminders(userId, scope = "all") {
  const db = getDb();
  const todayClause = scope === "today" ? "AND DATE(r.fecha) = CURDATE()" : "";
  const [rows] = await db.execute(
    `SELECT r.id, r.fecha, r.motivo, r.user_id, r.cliente_id, c.nombre AS cliente_nombre
     FROM recordatorios r
     INNER JOIN clientes c ON c.id = r.cliente_id
     WHERE r.user_id=? AND r.enviado=0 ${todayClause}
     ORDER BY r.fecha ASC`,
    [userId]
  );

  return rows;
}

async function listPendingByClientAndUser(clientId, userId) {
  const db = getDb();
  const [rows] = await db.execute(
    `SELECT r.id, r.fecha, r.motivo, r.cliente_id
     FROM recordatorios r
     WHERE r.cliente_id=? AND r.user_id=? AND r.enviado=0
     ORDER BY r.fecha ASC`,
    [clientId, userId]
  );

  return rows;
}

async function deleteReminderForUser(reminderId, userId) {
  const db = getDb();
  const [[reminder]] = await db.execute(
    `SELECT r.id, r.cliente_id, c.nombre AS cliente_nombre
     FROM recordatorios r
     INNER JOIN clientes c ON c.id = r.cliente_id
     WHERE r.id=? AND r.user_id=? AND r.enviado=0`,
    [reminderId, userId]
  );

  if (!reminder) return null;

  await db.execute("DELETE FROM recordatorios WHERE id=?", [reminderId]);
  return reminder;
}

async function deleteReminderById(reminderId) {
  const db = getDb();
  await db.execute("DELETE FROM recordatorios WHERE id=?", [reminderId]);
}

async function listDueReminders() {
  const db = getDb();
  const [rows] = await db.execute(
    `SELECT r.id, r.user_id, r.fecha, r.motivo, r.cliente_id, c.nombre AS cliente_nombre
     FROM recordatorios r
     INNER JOIN clientes c ON c.id = r.cliente_id
     WHERE r.enviado=0 AND r.fecha<=NOW()
     ORDER BY r.fecha ASC`
  );

  return rows;
}

async function markReminderSent(reminderId) {
  const db = getDb();
  await db.execute("UPDATE recordatorios SET enviado=1 WHERE id=?", [reminderId]);
}

async function listDashboardReminders(scope = "all", limit = 50) {
  const db = getDb();
  const todayClause = scope === "today" ? "AND DATE(r.fecha)=CURDATE()" : "";
  const safeLimit = normalizeLimit(limit, 50);
  const [rows] = await db.query(
    `SELECT r.id, r.fecha, r.motivo, r.user_id, r.enviado, c.nombre AS cliente_nombre
     FROM recordatorios r
     INNER JOIN clientes c ON c.id = r.cliente_id
     WHERE 1=1 ${todayClause}
     ORDER BY r.enviado ASC, r.fecha ASC
     LIMIT ${safeLimit}`
  );

  return rows;
}

module.exports = {
  createReminder,
  deleteReminderById,
  deleteReminderForUser,
  listDashboardReminders,
  listDueReminders,
  listPendingByClientAndUser,
  listUserReminders,
  markReminderSent,
};