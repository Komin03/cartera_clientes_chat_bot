const crypto = require("crypto");
const express = require("express");

const { CLIENT_STATUSES, getDashboardStats, listClients, updateClientStatus } = require("../services/clientService");
const { createReminder, deleteReminderById, listDashboardReminders } = require("../services/reminderService");
const { formatDateTime, getNextHalfHourDate } = require("../utils/date");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

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

function hasWebCredentials() {
  return Boolean(process.env.WEB_USERNAME && process.env.WEB_PASSWORD);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function requireWebAuthConfig() {
  if (hasWebCredentials()) {
    return;
  }

  if (isPublicWebUrl(process.env.WEB_URL)) {
    throw new Error("WEB_USERNAME y WEB_PASSWORD son obligatorios cuando WEB_URL es publico");
  }
}

function createBasicAuthMiddleware() {
  if (!hasWebCredentials()) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    if (req.path === "/health") {
      return next();
    }

    const credentials = parseBasicAuthHeader(req.headers.authorization);
    const usernameMatches = credentials && safeCompare(credentials.username, process.env.WEB_USERNAME);
    const passwordMatches = credentials && safeCompare(credentials.password, process.env.WEB_PASSWORD);

    if (usernameMatches && passwordMatches) {
      return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="EcoGarner Dashboard"');
    return res.status(401).send("Autenticacion requerida");
  };
}

function renderDashboard({ stats, clients, reminders, scope, message }) {
  const statusCards = stats.statusBreakdown.length
    ? stats.statusBreakdown
        .map(
          (row) => `
            <div class="mini-card">
              <span>${escapeHtml(row.estado)}</span>
              <strong>${row.total}</strong>
            </div>
          `
        )
        .join("")
    : '<div class="mini-card"><span>Sin datos</span><strong>0</strong></div>';

  const clientOptions = clients
    .map((client) => `<option value="${client.id}">${escapeHtml(client.nombre)}</option>`)
    .join("");

  const clientsRows = clients
    .map(
      (client) => `
        <tr>
          <td>${escapeHtml(client.nombre)}</td>
          <td>${escapeHtml(client.telefono || "-")}</td>
          <td>${escapeHtml(client.empresa || "-")}</td>
          <td>${client.pending_reminders || 0}</td>
          <td>
            <form method="post" action="/clients/${client.id}/status" class="inline-form">
              <select name="statusCode">
                ${CLIENT_STATUSES.map(
                  (status) =>
                    `<option value="${status.code}" ${client.estado === status.label ? "selected" : ""}>${escapeHtml(status.label)}</option>`
                ).join("")}
              </select>
              <button type="submit">Guardar</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");

  const remindersRows = reminders
    .map(
      (reminder) => `
        <tr>
          <td>${escapeHtml(reminder.cliente_nombre)}</td>
          <td>${formatDateTime(reminder.fecha)}</td>
          <td>${escapeHtml(reminder.motivo)}</td>
          <td>${escapeHtml(reminder.user_id)}</td>
          <td>${reminder.enviado ? "Enviado" : "Pendiente"}</td>
          <td>
            <form method="post" action="/reminders/${reminder.id}/delete" class="inline-form">
              <button type="submit" class="danger">Eliminar</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>EcoGarner CRM Bot</title>
        <style>
          :root {
            --bg: #f5efe1;
            --panel: rgba(255,255,255,0.82);
            --ink: #1f2b20;
            --accent: #2d6a4f;
            --line: rgba(31,43,32,0.12);
            --danger: #b23a48;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
            color: var(--ink);
            background:
              radial-gradient(circle at top left, rgba(188,108,37,0.2), transparent 30%),
              radial-gradient(circle at bottom right, rgba(45,106,79,0.22), transparent 34%),
              var(--bg);
          }
          .shell { max-width: 1280px; margin: 0 auto; padding: 32px 20px 48px; }
          .hero { display: grid; gap: 16px; margin-bottom: 24px; }
          .hero h1 { margin: 0; font-size: clamp(2rem, 4vw, 3.6rem); line-height: 0.95; letter-spacing: -0.04em; }
          .hero p { margin: 0; max-width: 760px; font-size: 1rem; }
          .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 18px; }
          .card {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 22px;
            padding: 20px;
            backdrop-filter: blur(16px);
            box-shadow: 0 18px 60px rgba(31,43,32,0.08);
          }
          .stats { grid-column: span 12; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
          .stat strong { display: block; font-size: 2rem; }
          .mini-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
          .mini-card { border: 1px solid var(--line); border-radius: 16px; padding: 12px; background: rgba(255,255,255,0.68); }
          .mini-card span, .stat span { display: block; font-size: 0.86rem; opacity: 0.75; }
          .panel-wide { grid-column: span 8; }
          .panel-side { grid-column: span 4; }
          h2 { margin-top: 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
          form { margin: 0; }
          .inline-form { display: flex; gap: 8px; align-items: center; }
          input, select, button { border-radius: 12px; border: 1px solid var(--line); padding: 10px 12px; font: inherit; }
          button { cursor: pointer; background: var(--accent); color: white; border: none; }
          button.danger { background: var(--danger); }
          .filters { display: flex; gap: 10px; margin-bottom: 14px; }
          .filters a { text-decoration: none; color: var(--ink); padding: 8px 12px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,0.5); }
          .filters a.active { background: var(--accent); color: white; }
          .message { margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(45,106,79,0.12); border: 1px solid rgba(45,106,79,0.18); }
          @media (max-width: 980px) {
            .stats, .panel-wide, .panel-side { grid-column: span 12; }
            .stats { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 640px) {
            .stats { grid-template-columns: 1fr; }
            .inline-form { flex-direction: column; align-items: stretch; }
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <section class="hero">
            <h1>EcoGarner CRM Dashboard</h1>
            <p>Gestiona clientes, estatus y recordatorios desde web sin soltar Telegram. Esta vista se conecta a la misma base del bot.</p>
          </section>
          ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
          <section class="card stats">
            <div class="stat"><span>Clientes</span><strong>${stats.totalClients}</strong></div>
            <div class="stat"><span>Recordatorios pendientes</span><strong>${stats.pendingReminders}</strong></div>
            <div class="stat"><span>Recordatorios de hoy</span><strong>${stats.todayReminders}</strong></div>
            <div class="stat"><span>Estatus</span><div class="mini-grid">${statusCards}</div></div>
          </section>
          <section class="grid">
            <article class="card panel-wide">
              <h2>Clientes</h2>
              <table>
                <thead>
                  <tr><th>Nombre</th><th>Teléfono</th><th>Empresa</th><th>Pendientes</th><th>Estatus</th></tr>
                </thead>
                <tbody>
                  ${clientsRows || '<tr><td colspan="5">Sin clientes</td></tr>'}
                </tbody>
              </table>
            </article>
            <aside class="card panel-side">
              <h2>Nuevo recordatorio</h2>
              <form method="post" action="/reminders">
                <p>Alta rápida desde web para el mismo flujo del bot.</p>
                <select name="clientId" required>
                  <option value="">Selecciona cliente</option>
                  ${clientOptions}
                </select>
                <input type="number" name="userId" placeholder="Telegram user ID" required />
                <input type="datetime-local" name="fecha" value="${toDateTimeLocalValue(getNextHalfHourDate())}" required />
                <input type="text" name="motivo" placeholder="Motivo" required />
                <button type="submit">Guardar recordatorio</button>
              </form>
            </aside>
            <article class="card panel-wide">
              <h2>Recordatorios</h2>
              <div class="filters">
                <a href="/?scope=all" class="${scope === "all" ? "active" : ""}">Todos</a>
                <a href="/?scope=today" class="${scope === "today" ? "active" : ""}">Solo hoy</a>
              </div>
              <table>
                <thead>
                  <tr><th>Cliente</th><th>Fecha</th><th>Motivo</th><th>Telegram ID</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  ${remindersRows || '<tr><td colspan="6">Sin recordatorios</td></tr>'}
                </tbody>
              </table>
            </article>
          </section>
        </div>
      </body>
    </html>
  `;
}

async function startWebServer({ port }) {
  requireWebAuthConfig();

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(createBasicAuthMiddleware());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", async (req, res, next) => {
    try {
      const scope = req.query.scope === "today" ? "today" : "all";
      const [stats, clients, reminders] = await Promise.all([
        getDashboardStats(),
        listClients(50),
        listDashboardReminders(scope, 80),
      ]);

      res.send(
        renderDashboard({
          stats,
          clients,
          reminders,
          scope,
          message: req.query.message || "",
        })
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/clients/:id/status", async (req, res, next) => {
    try {
      await updateClientStatus(Number(req.params.id), req.body.statusCode);
      res.redirect("/?message=" + encodeURIComponent("Estatus actualizado"));
    } catch (err) {
      next(err);
    }
  });

  app.post("/reminders", async (req, res, next) => {
    try {
      await createReminder({
        clientId: Number(req.body.clientId),
        userId: Number(req.body.userId),
        date: new Date(req.body.fecha),
        motivo: req.body.motivo,
      });
      res.redirect("/?message=" + encodeURIComponent("Recordatorio creado"));
    } catch (err) {
      next(err);
    }
  });

  app.post("/reminders/:id/delete", async (req, res, next) => {
    try {
      await deleteReminderById(Number(req.params.id));
      res.redirect("/?message=" + encodeURIComponent("Recordatorio eliminado"));
    } catch (err) {
      next(err);
    }
  });

  app.use((err, _req, res, _next) => {
    res.status(500).send(`Error: ${escapeHtml(err.message)}`);
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

module.exports = { startWebServer };