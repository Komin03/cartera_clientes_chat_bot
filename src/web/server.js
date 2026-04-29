const crypto = require("crypto");
const express = require("express");

const {
  CLIENT_STATUSES,
  getDashboardStats,
  importClients,
  listClients,
  listClientsForExport,
  updateClientStatus,
} = require("../services/clientService");
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

function getImportPayload(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    throw new Error("No se recibio JSON para importar");
  }

  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && Array.isArray(parsed.clientes)) {
    return parsed.clientes;
  }

  throw new Error("Formato invalido: usa un arreglo o un objeto con la clave clientes");
}

function renderDashboard({ stats, clients, reminders, scope, message }) {
  const statusCards = stats.statusBreakdown.length
    ? stats.statusBreakdown
        .map(
          (row) => `
            <div class="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <p class="text-xs text-slate-300">${escapeHtml(row.estado)}</p>
              <p class="text-base font-semibold text-white">${row.total}</p>
            </div>
          `
        )
        .join("")
    : '<div class="rounded-xl border border-white/10 bg-white/5 px-3 py-2"><p class="text-xs text-slate-300">Sin datos</p><p class="text-base font-semibold text-white">0</p></div>';

  const clientOptions = clients.map((client) => `<option value="${client.id}">${escapeHtml(client.nombre)}</option>`).join("");

  const clientsRows = clients
    .map(
      (client) => `
        <tr class="align-top" data-client-status="${escapeHtml(client.estado)}" data-client-name="${escapeHtml(client.nombre).toLowerCase()}" data-client-phone="${escapeHtml(client.telefono || "-").toLowerCase()}" data-client-company="${escapeHtml(client.empresa || "-").toLowerCase()}">
          <td class="px-3 py-3 font-medium">${escapeHtml(client.nombre)}</td>
          <td class="px-3 py-3 text-slate-300">${escapeHtml(client.telefono || "-")}</td>
          <td class="px-3 py-3 text-slate-300">${escapeHtml(client.empresa || "-")}</td>
          <td class="px-3 py-3"><span class="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200">${client.pending_reminders || 0}</span></td>
          <td class="px-3 py-3">
            <form method="post" action="/clients/${client.id}/status" class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select name="statusCode" class="rounded-lg border border-white/15 bg-slate-800/80 px-2 py-1.5 text-sm text-white outline-none focus:border-emerald-400">
                ${CLIENT_STATUSES.map(
                  (status) =>
                    `<option value="${status.code}" ${client.estado === status.label ? "selected" : ""}>${escapeHtml(status.label)}</option>`
                ).join("")}
              </select>
              <button type="submit" class="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">Guardar</button>
            </form>
          </td>
         </tr>
      `
    )
    .join("");

  const remindersRows = reminders
    .map(
      (reminder) => `
        <tr class="align-top" data-reminder-status="${reminder.enviado ? 'sent' : 'pending'}" data-reminder-client="${escapeHtml(reminder.cliente_nombre).toLowerCase()}">
          <td class="px-3 py-3 font-medium">${escapeHtml(reminder.cliente_nombre)}</td>
          <td class="px-3 py-3 text-slate-300">${formatDateTime(reminder.fecha)}</td>
          <td class="px-3 py-3 text-slate-300">${escapeHtml(reminder.motivo)}</td>
          <td class="px-3 py-3 text-slate-300">${escapeHtml(reminder.user_id)}</td>
          <td class="px-3 py-3">
            <span class="rounded-full px-2 py-1 text-xs ${
              reminder.enviado ? "bg-sky-500/20 text-sky-200" : "bg-amber-500/20 text-amber-200"
            }">${reminder.enviado ? "Enviado" : "Pendiente"}</span>
          </td>
          <td class="px-3 py-3">
            <form method="post" action="/reminders/${reminder.id}/delete">
              <button type="submit" class="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-rose-50 transition hover:bg-rose-400">Eliminar</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");

  const statusChartData = JSON.stringify(stats.statusBreakdown.map(s => s.total));
  const statusChartLabels = JSON.stringify(stats.statusBreakdown.map(s => s.estado));
  
  const todayRemindersCount = reminders.filter(r => {
    const reminderDate = new Date(r.fecha);
    const today = new Date();
    return reminderDate.toDateString() === today.toDateString();
  }).length;

  const weekRemindersCount = reminders.filter(r => {
    const reminderDate = new Date(r.fecha);
    const today = new Date();
    const weekLater = new Date(today);
    weekLater.setDate(today.getDate() + 7);
    return reminderDate >= today && reminderDate <= weekLater;
  }).length;

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>EcoGarner CRM Bot</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <script>
          tailwind.config = {
            theme: {
              extend: {
                fontFamily: {
                  display: ["Sora", "Segoe UI", "sans-serif"],
                  body: ["DM Sans", "Segoe UI", "sans-serif"],
                },
              },
            },
          };
        </script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Sora:wght@500;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://unpkg.com/primeicons@7.0.0/primeicons.css" />
        <link rel="stylesheet" href="https://unpkg.com/primevue@3.53.1/resources/themes/lara-light-green/theme.css" />
        <link rel="stylesheet" href="https://unpkg.com/primevue@3.53.1/resources/primevue.min.css" />
        <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
        <script src="https://unpkg.com/primevue@3.53.1/config/config.min.js"></script>
        <script src="https://unpkg.com/primevue@3.53.1/button/button.min.js"></script>
        <style>
          .filter-chip {
            transition: all 0.2s ease;
            cursor: pointer;
          }
          .filter-chip.active {
            background-color: rgb(16 185 129);
            color: rgb(2 6 23);
          }
          .filter-chip:not(.active) {
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: rgb(203 213 225);
          }
          .filter-chip:not(.active):hover {
            background-color: rgba(255, 255, 255, 0.05);
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in {
            animation: fadeIn 0.3s ease-out;
          }
          .stat-card {
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          }
          .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          }
        </style>
      </head>
      <body class="font-body bg-slate-950 text-slate-100 min-h-screen">
        <div class="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_20%,rgba(16,185,129,0.2),transparent_36%),radial-gradient(circle_at_88%_0%,rgba(59,130,246,0.2),transparent_40%),linear-gradient(135deg,#020617,#0f172a_40%,#111827)]"></div>
        <main class="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-10">
          <header class="mb-8 grid gap-5 md:grid-cols-[1.2fr_auto] md:items-end">
            <div>
              <p class="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-emerald-200">
                <i class="pi pi-chart-line text-[11px]"></i> EcoGarner Control Center
              </p>
              <h1 class="font-display text-3xl font-bold tracking-tight text-white md:text-5xl">Dashboard de Clientes</h1>
              <p class="mt-2 max-w-2xl text-slate-300">Visualiza cartera, agenda seguimientos y mueve informacion entre entornos con exportacion/importacion JSON.</p>
            </div>
            <div id="prime-actions" class="justify-self-start md:justify-self-end"></div>
          </header>

          ${message ? `<div class="mb-6 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 animate-fade-in">${escapeHtml(message)}</div>` : ""}

          <!-- Gráficos y estadísticas mejoradas -->
          <section class="grid gap-6 lg:grid-cols-2 mb-6">
            <article class="rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl stat-card">
              <h3 class="font-display text-lg font-semibold text-white mb-3">Distribución por Estado</h3>
              <canvas id="statusChart" height="200"></canvas>
            </article>
            
            <article class="rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl stat-card">
              <h3 class="font-display text-lg font-semibold text-white mb-3">Próximos Recordatorios</h3>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="text-center p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <p class="text-2xl font-bold text-emerald-400">${todayRemindersCount}</p>
                  <p class="text-xs text-slate-300">Para hoy</p>
                </div>
                <div class="text-center p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
                  <p class="text-2xl font-bold text-sky-400">${weekRemindersCount}</p>
                  <p class="text-xs text-slate-300">Próximos 7 días</p>
                </div>
              </div>
              <canvas id="trendChart" height="150"></canvas>
            </article>
          </section>

          <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
            <article class="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl stat-card"><p class="text-sm text-slate-300">Clientes</p><p class="mt-2 text-3xl font-semibold text-white">${stats.totalClients}</p></article>
            <article class="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl stat-card"><p class="text-sm text-slate-300">Recordatorios Pendientes</p><p class="mt-2 text-3xl font-semibold text-white">${stats.pendingReminders}</p></article>
            <article class="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl stat-card"><p class="text-sm text-slate-300">Recordatorios de Hoy</p><p class="mt-2 text-3xl font-semibold text-white">${stats.todayReminders}</p></article>
            <article class="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl stat-card"><p class="mb-3 text-sm text-slate-300">Estatus</p><div class="grid gap-2">${statusCards}</div></article>
          </section>

          <section class="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <article class="rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 class="font-display text-xl font-semibold text-white">Clientes</h2>
                <a href="/clients/export" class="inline-flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/20"><i class="pi pi-download"></i> Exportar JSON</a>
              </div>
              
              <!-- Filtros para clientes -->
              <div class="mb-4 flex flex-wrap gap-3">
                <div class="flex-1 min-w-[200px]">
                  <input type="text" id="searchClients" placeholder="🔍 Buscar por nombre, teléfono o empresa..." 
                         class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400">
                </div>
                <select id="statusFilter" class="rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400">
                  <option value="">Todos los estados</option>
                  ${CLIENT_STATUSES.map(s => `<option value="${s.label}">${s.label}</option>`).join('')}
                </select>
                <button id="clearFilters" class="rounded-xl border border-white/20 bg-slate-800/50 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 transition">
                  <i class="pi pi-filter-slash"></i> Limpiar
                </button>
              </div>
              
              <div class="overflow-x-auto rounded-xl border border-white/10">
                <table class="min-w-full text-sm" id="clientsTable">
                  <thead class="bg-slate-800/80 text-xs uppercase tracking-wide text-slate-300">
                    <tr>
                      <th class="px-3 py-3 text-left">Nombre</th>
                      <th class="px-3 py-3 text-left">Teléfono</th>
                      <th class="px-3 py-3 text-left">Empresa</th>
                      <th class="px-3 py-3 text-left">Pendientes</th>
                      <th class="px-3 py-3 text-left">Estatus</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/10 text-slate-100">${clientsRows || '<tr><td class="px-3 py-4 text-slate-300" colspan="5">Sin clientes</td></tr>'}</tbody>
                </table>
              </div>
            </article>

            <aside class="space-y-6">
              <section class="rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                <h2 class="font-display text-xl font-semibold text-white">Nuevo Recordatorio</h2>
                <form method="post" action="/reminders" class="mt-4 space-y-3">
                  <select name="clientId" required class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400">
                    <option value="">Selecciona cliente</option>
                    ${clientOptions}
                  </select>
                  <input type="number" name="userId" placeholder="Telegram user ID" required class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400" />
                  <input type="datetime-local" name="fecha" value="${toDateTimeLocalValue(getNextHalfHourDate())}" required class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400" />
                  <input type="text" name="motivo" placeholder="Motivo" required class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400" />
                  <button type="submit" class="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">Guardar recordatorio</button>
                </form>
              </section>

              <section class="rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                <h2 class="font-display text-xl font-semibold text-white">Importar Clientes</h2>
                <form method="post" action="/clients/import" class="mt-4 space-y-3">
                  <input type="file" id="clientsJsonFile" accept="application/json,.json" class="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100 file:hover:bg-slate-600 file:cursor-pointer" />
                  <textarea name="clientsJson" id="clientsJson" rows="8" placeholder='[{"nombre":"Cliente 1","telefono":"555","empresa":"ACME"}]' class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400"></textarea>
                  <button type="submit" class="w-full rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">Importar JSON</button>
                </form>
              </section>
            </aside>
          </section>

          <section class="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display text-xl font-semibold text-white">Recordatorios</h2>
              <div class="flex items-center gap-2">
                <button data-filter-scope="all" class="reminder-scope-filter rounded-full px-3 py-1.5 text-sm ${scope === "all" ? "bg-emerald-500 text-slate-950" : "border border-white/20 text-slate-300"}">Todos</button>
                <button data-filter-scope="today" class="reminder-scope-filter rounded-full px-3 py-1.5 text-sm ${scope === "today" ? "bg-emerald-500 text-slate-950" : "border border-white/20 text-slate-300"}">Solo hoy</button>
              </div>
            </div>
            
            <!-- Filtros adicionales para recordatorios -->
            <div class="mb-4 flex flex-wrap gap-3">
              <div class="flex-1 min-w-[200px]">
                <input type="text" id="searchReminders" placeholder="🔍 Buscar por cliente..." 
                       class="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400">
              </div>
              <div class="flex gap-2">
                <button data-reminder-filter="all" class="reminder-filter-chip filter-chip active px-3 py-1.5 rounded-full text-sm">Todos</button>
                <button data-reminder-filter="pending" class="reminder-filter-chip filter-chip px-3 py-1.5 rounded-full text-sm">Pendientes</button>
                <button data-reminder-filter="sent" class="reminder-filter-chip filter-chip px-3 py-1.5 rounded-full text-sm">Enviados</button>
              </div>
            </div>
            
            <div class="overflow-x-auto rounded-xl border border-white/10">
              <table class="min-w-full text-sm" id="remindersTable">
                <thead class="bg-slate-800/80 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th class="px-3 py-3 text-left">Cliente</th>
                    <th class="px-3 py-3 text-left">Fecha</th>
                    <th class="px-3 py-3 text-left">Motivo</th>
                    <th class="px-3 py-3 text-left">Telegram ID</th>
                    <th class="px-3 py-3 text-left">Estado</th>
                    <th class="px-3 py-3 text-left"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/10 text-slate-100">${remindersRows || '<tr><td class="px-3 py-4 text-slate-300" colspan="6">Sin recordatorios</td></tr>'}</tbody>
              </table>
            </div>
          </section>
        </main>

        <script>
          (() => {
            const root = document.getElementById("prime-actions");
            if (!root || !window.Vue || !window.primevue) return;

            const PrimeVueConfig = window.primevue.config && (window.primevue.config.default || window.primevue.config);
            const PrimeButton = window.primevue.button && (window.primevue.button.default || window.primevue.button);
            if (!PrimeVueConfig || !PrimeButton) return;

            const outlinedAll = ${scope !== "all"};
            const outlinedToday = ${scope !== "today"};

            const app = Vue.createApp({
              methods: {
                goExport() {
                  window.location.href = "/clients/export";
                },
                goScope(nextScope) {
                  window.location.href = nextScope === "today" ? "/?scope=today" : "/?scope=all";
                },
              },
              template:
                '<div class="flex flex-wrap gap-2">' +
                '<PButton label="Exportar" icon="pi pi-download" severity="success" @click="goExport" />' +
                '<PButton label="Todos" icon="pi pi-list" :outlined="' + outlinedAll + '" @click="goScope(\\'all\\')" />' +
                '<PButton label="Hoy" icon="pi pi-calendar" :outlined="' + outlinedToday + '" @click="goScope(\\'today\\')" />' +
                '</div>',
            });

            app.use(PrimeVueConfig);
            app.component("PButton", PrimeButton);
            app.mount(root);
          })();

          (() => {
            const fileInput = document.getElementById("clientsJsonFile");
            const textArea = document.getElementById("clientsJson");
            if (!fileInput || !textArea) return;

            fileInput.addEventListener("change", async () => {
              const file = fileInput.files && fileInput.files[0];
              if (!file) return;
              try {
                textArea.value = await file.text();
              } catch {
                alert("No se pudo leer el archivo JSON");
              }
            });
          })();

          // Gráfico de distribución de estados
          (() => {
            const ctx = document.getElementById('statusChart');
            if (ctx) {
              const statusLabels = ${statusChartLabels};
              const statusData = ${statusChartData};
              
              new Chart(ctx, {
                type: 'doughnut',
                data: {
                  labels: statusLabels,
                  datasets: [{
                    data: statusData,
                    backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'],
                    borderWidth: 0
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: true,
                  plugins: {
                    legend: { 
                      position: 'bottom',
                      labels: { 
                        color: '#cbd5e1',
                        font: { size: 11 }
                      }
                    }
                  }
                }
              });
            }
          })();

          // Gráfico de tendencia semanal
          (() => {
            const ctx = document.getElementById('trendChart');
            if (ctx) {
              const today = new Date();
              const weekDays = [];
              const reminderCounts = [];
              
              for (let i = 0; i < 7; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                weekDays.push(date.toLocaleDateString('es', { weekday: 'short' }));
                
                const count = ${JSON.stringify(reminders.map(r => ({
                  date: new Date(r.fecha).toDateString(),
                  count: 1
                })))};
                
                const dateString = date.toDateString();
                const dayCount = count.filter(c => c.date === dateString).length;
                reminderCounts.push(dayCount);
              }
              
              new Chart(ctx, {
                type: 'line',
                data: {
                  labels: weekDays,
                  datasets: [{
                    label: 'Recordatorios',
                    data: reminderCounts,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.3,
                    fill: true
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: true,
                  plugins: {
                    legend: { labels: { color: '#cbd5e1' } }
                  },
                  scales: {
                    y: { 
                      beginAtZero: true,
                      ticks: { color: '#cbd5e1' },
                      grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    x: { 
                      ticks: { color: '#cbd5e1' },
                      grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    }
                  }
                }
              });
            }
          })();

          // Filtros para clientes
          (() => {
            const searchInput = document.getElementById('searchClients');
            const statusFilter = document.getElementById('statusFilter');
            const clearBtn = document.getElementById('clearFilters');
            const tableRows = document.querySelectorAll('#clientsTable tbody tr');
            
            function filterTable() {
              const searchTerm = searchInput?.value.toLowerCase() || '';
              const statusTerm = statusFilter?.value || '';
              
              let visibleCount = 0;
              tableRows.forEach(row => {
                const clientName = row.getAttribute('data-client-name') || '';
                const clientPhone = row.getAttribute('data-client-phone') || '';
                const clientCompany = row.getAttribute('data-client-company') || '';
                const clientStatus = row.getAttribute('data-client-status') || '';
                
                const matchesSearch = clientName.includes(searchTerm) || 
                                      clientPhone.includes(searchTerm) || 
                                      clientCompany.includes(searchTerm);
                const matchesStatus = !statusTerm || clientStatus === statusTerm;
                
                if (matchesSearch && matchesStatus) {
                  row.style.display = '';
                  visibleCount++;
                } else {
                  row.style.display = 'none';
                }
              });
              
              // Mostrar mensaje si no hay resultados
              const tbody = document.querySelector('#clientsTable tbody');
              const noResultsRow = document.getElementById('noClientsResults');
              if (visibleCount === 0 && tableRows.length > 0) {
                if (!noResultsRow) {
                  const row = document.createElement('tr');
                  row.id = 'noClientsResults';
                  row.innerHTML = '<td colspan="5" class="px-3 py-8 text-center text-slate-400">No se encontraron clientes con esos filtros</td>';
                  tbody.appendChild(row);
                }
              } else if (noResultsRow) {
                noResultsRow.remove();
              }
            }
            
            if (searchInput) searchInput.addEventListener('input', filterTable);
            if (statusFilter) statusFilter.addEventListener('change', filterTable);
            if (clearBtn) {
              clearBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (statusFilter) statusFilter.value = '';
                filterTable();
              });
            }
          })();

          // Filtros para recordatorios
          (() => {
            const searchInput = document.getElementById('searchReminders');
            const filterChips = document.querySelectorAll('.reminder-filter-chip');
            const reminderRows = document.querySelectorAll('#remindersTable tbody tr');
            let currentFilter = 'all';
            
            function filterReminders() {
              const searchTerm = searchInput?.value.toLowerCase() || '';
              
              let visibleCount = 0;
              reminderRows.forEach(row => {
                const clientName = row.getAttribute('data-reminder-client') || '';
                const reminderStatus = row.getAttribute('data-reminder-status') || '';
                
                const matchesSearch = clientName.includes(searchTerm);
                const matchesFilter = currentFilter === 'all' || reminderStatus === currentFilter;
                
                if (matchesSearch && matchesFilter) {
                  row.style.display = '';
                  visibleCount++;
                } else {
                  row.style.display = 'none';
                }
              });
              
              const tbody = document.querySelector('#remindersTable tbody');
              const noResultsRow = document.getElementById('noRemindersResults');
              if (visibleCount === 0 && reminderRows.length > 0) {
                if (!noResultsRow) {
                  const row = document.createElement('tr');
                  row.id = 'noRemindersResults';
                  row.innerHTML = '<td colspan="6" class="px-3 py-8 text-center text-slate-400">No se encontraron recordatorios con esos filtros</td>';
                  tbody.appendChild(row);
                }
              } else if (noResultsRow) {
                noResultsRow.remove();
              }
            }
            
            filterChips.forEach(chip => {
              chip.addEventListener('click', () => {
                filterChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-reminder-filter') || 'all';
                filterReminders();
              });
            });
            
            if (searchInput) searchInput.addEventListener('input', filterReminders);
          })();

          // Navegación de filtros de scope
          (() => {
            const scopeFilters = document.querySelectorAll('.reminder-scope-filter');
            scopeFilters.forEach(filter => {
              filter.addEventListener('click', () => {
                const scope = filter.getAttribute('data-filter-scope');
                if (scope === 'today') {
                  window.location.href = '/?scope=today';
                } else {
                  window.location.href = '/?scope=all';
                }
              });
            });
          })();
        </script>
      </body>
    </html>
  `;
}

async function startWebServer({ port }) {
  requireWebAuthConfig();

  const app = express();
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(express.json({ limit: "5mb" }));
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

  app.get("/clients/export", async (_req, res, next) => {
    try {
      const clients = await listClientsForExport();
      const payload = {
        exportedAt: new Date().toISOString(),
        total: clients.length,
        clientes: clients,
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="clientes-${Date.now()}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      next(err);
    }
  });

  app.post("/clients/import", async (req, res, next) => {
    try {
      const items = getImportPayload(req.body.clientsJson);
      const result = await importClients(items);
      const msg = `Importacion terminada. Importados: ${result.imported}. Omitidos: ${result.skipped}.`;
      res.redirect("/?message=" + encodeURIComponent(msg));
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