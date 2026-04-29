const mysql = require("mysql2/promise");

const { log } = require("../utils/logger");

let db;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTableColumns(tableName, columns) {
  const [rows] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.DB_NAME, tableName]
  );

  const existingColumns = new Set(rows.map((row) => row.COLUMN_NAME));

  for (const [columnName, definition] of Object.entries(columns)) {
    if (existingColumns.has(columnName)) continue;

    await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    log(`Columna agregada ${tableName}.${columnName}`);
  }
}

async function ensureSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(255),
      telefono VARCHAR(50),
      empresa VARCHAR(255),
      direccion TEXT,
      notas TEXT,
      estado VARCHAR(50) DEFAULT 'Sin gestionar',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS representantes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT,
      nombre VARCHAR(255),
      puesto VARCHAR(255),
      telefono VARCHAR(50)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS recordatorios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT,
      user_id BIGINT,
      fecha DATETIME,
      motivo VARCHAR(255),
      enviado TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTableColumns("clientes", {
    telefono: "VARCHAR(50)",
    empresa: "VARCHAR(255)",
    direccion: "TEXT",
    notas: "TEXT",
    estado: "VARCHAR(50) DEFAULT 'Sin gestionar'",
    created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  });

  await ensureTableColumns("representantes", {
    cliente_id: "INT",
    nombre: "VARCHAR(255)",
    puesto: "VARCHAR(255)",
    telefono: "VARCHAR(50)",
  });

  await ensureTableColumns("recordatorios", {
    cliente_id: "INT",
    user_id: "BIGINT",
    fecha: "DATETIME",
    motivo: "VARCHAR(255)",
    enviado: "TINYINT DEFAULT 0",
    created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  });
}

async function initDB(maxAttempts = 12) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      db = await mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3307,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 10,
      });

      await db.query("SELECT 1");
      await ensureSchema();
      log("DB lista");
      return db;
    } catch (err) {
      log(`Intento DB ${attempt}/${maxAttempts} falló: ${err.message}`, "WARN");
      if (attempt === maxAttempts) throw err;
      await sleep(3000);
    }
  }

  return db;
}

function getDb() {
  if (!db) throw new Error("DB no inicializada");
  return db;
}

module.exports = {
  getDb,
  initDB,
};