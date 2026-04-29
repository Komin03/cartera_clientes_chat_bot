const { getDb } = require("../db");

const CLIENT_STATUSES = [
  { code: "sin_gestion", label: "Sin gestionar" },
  { code: "solo_info", label: "Solo info" },
  { code: "respondio", label: "Respondió" },
  { code: "se_comunicaron", label: "Se comunicaron" },
];

const STATUS_MAP = Object.fromEntries(CLIENT_STATUSES.map((status) => [status.code, status.label]));

function resolveStatusLabel(code) {
  return STATUS_MAP[code] || STATUS_MAP.sin_gestion;
}

function normalizeLimit(limit, fallback = 25) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

async function createClient(data) {
  const db = getDb();
  const [result] = await db.execute(
    `INSERT INTO clientes (nombre, telefono, empresa, direccion, notas, estado)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.nombre,
      data.telefono,
      data.empresa,
      data.direccion,
      data.notas,
      resolveStatusLabel("sin_gestion"),
    ]
  );

  return getClientById(result.insertId);
}

async function getClientById(id) {
  const db = getDb();
  const [[client]] = await db.execute(
    `SELECT c.*,
            (SELECT COUNT(*) FROM recordatorios r WHERE r.cliente_id = c.id AND r.enviado = 0) AS pending_reminders
     FROM clientes c
     WHERE c.id = ?`,
    [id]
  );

  return client || null;
}

async function listClients(limit = 25) {
  const db = getDb();
  const safeLimit = normalizeLimit(limit, 25);
  const [rows] = await db.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM recordatorios r WHERE r.cliente_id = c.id AND r.enviado = 0) AS pending_reminders
     FROM clientes c
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${safeLimit}`
  );

  return rows;
}

async function searchClients(term, limit = 25) {
  const db = getDb();
  const like = `%${term}%`;
  const safeLimit = normalizeLimit(limit, 25);
  const [rows] = await db.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM recordatorios r WHERE r.cliente_id = c.id AND r.enviado = 0) AS pending_reminders
     FROM clientes c
     WHERE c.nombre LIKE ? OR c.empresa LIKE ? OR c.telefono LIKE ?
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${safeLimit}`,
    [like, like, like]
  );

  return rows;
}

async function updateClientStatus(clientId, statusCode) {
  const db = getDb();
  await db.execute("UPDATE clientes SET estado=? WHERE id=?", [resolveStatusLabel(statusCode), clientId]);
  return getClientById(clientId);
}

async function listClientsForExport(limit = 5000) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 20000);
  const [rows] = await db.query(
    `SELECT nombre, telefono, empresa, direccion, notas, estado
     FROM clientes
     ORDER BY id ASC
     LIMIT ${safeLimit}`
  );

  return rows;
}

async function importClients(items) {
  if (!Array.isArray(items)) {
    throw new Error("El JSON debe ser un arreglo de clientes");
  }

  const db = getDb();
  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    const nombre = normalizeText(item?.nombre || item?.name);
    if (!nombre) {
      skipped += 1;
      continue;
    }

    const telefono = normalizeText(item?.telefono || item?.phone);
    const empresa = normalizeText(item?.empresa || item?.company);
    const direccion = normalizeText(item?.direccion || item?.address);
    const notas = normalizeText(item?.notas || item?.notes);
    const estado = normalizeText(item?.estado || item?.status, resolveStatusLabel("sin_gestion"));

    await db.execute(
      `INSERT INTO clientes (nombre, telefono, empresa, direccion, notas, estado)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, telefono, empresa, direccion, notas, estado]
    );

    imported += 1;
  }

  return { imported, skipped };
}

async function getDashboardStats() {
  const db = getDb();
  const [[clients]] = await db.execute("SELECT COUNT(*) AS total FROM clientes");
  const [[pending]] = await db.execute("SELECT COUNT(*) AS total FROM recordatorios WHERE enviado=0");
  const [[today]] = await db.execute(
    "SELECT COUNT(*) AS total FROM recordatorios WHERE enviado=0 AND DATE(fecha)=CURDATE()"
  );
  const [statusRows] = await db.execute(
    "SELECT estado, COUNT(*) AS total FROM clientes GROUP BY estado ORDER BY total DESC"
  );

  return {
    totalClients: clients.total,
    pendingReminders: pending.total,
    todayReminders: today.total,
    statusBreakdown: statusRows,
  };
}

module.exports = {
  CLIENT_STATUSES,
  createClient,
  getClientById,
  getDashboardStats,
  importClients,
  listClients,
  listClientsForExport,
  resolveStatusLabel,
  searchClients,
  updateClientStatus,
};