require("dotenv").config();

const { initDB } = require("./src/db");
const { createBot, startReminderWorker } = require("./src/bot");
const { startWebServer } = require("./src/web/server");
const { log } = require("./src/utils/logger");

async function bootstrap() {
  await initDB();

  const webPort = Number(process.env.WEB_PORT || 3000);
  await startWebServer({ port: webPort });
  log(`Dashboard web listo en puerto ${webPort}`);

  if (!process.env.BOT_TOKEN) {
    log("BOT_TOKEN no configurado. Dashboard activo, bot deshabilitado.", "WARN");
    return;
  }

  const bot = createBot({
    token: process.env.BOT_TOKEN,
    webUrl: process.env.WEB_URL,
  });

  startReminderWorker(bot);
  await bot.start();
}

bootstrap().catch((err) => {
  log(`Fallo de arranque: ${err.message}`, "ERROR");
  process.exit(1);
});