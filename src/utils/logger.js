const fs = require("fs");

function log(message, type = "INFO") {
  const line = `[${new Date().toISOString()}][${type}] ${message}`;
  console.log(line);
  fs.appendFileSync("logs.txt", line + "\n");
}

module.exports = { log };