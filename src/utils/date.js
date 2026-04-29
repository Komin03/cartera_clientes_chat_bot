function pad(value) {
  return String(value).padStart(2, "0");
}

function toMysqlDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:00`;
}

function formatDateTime(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return "fecha inválida";

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function getUpcomingMonths(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("es-MX", { month: "long" });
  const year = now.getFullYear();
  const startMonth = now.getMonth() + 1;
  const months = [];

  for (let month = startMonth; month <= 12; month += 1) {
    const label = formatter.format(new Date(year, month - 1, 1));
    months.push({ value: month, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }

  return months;
}

function getAvailableDays(year, month, now = new Date()) {
  const lastDay = new Date(year, month, 0).getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const startDay = isCurrentMonth ? now.getDate() : 1;
  const days = [];

  for (let day = startDay; day <= lastDay; day += 1) {
    days.push(day);
  }

  return days;
}

function roundToNextHalfHour(date) {
  const next = new Date(date);
  next.setSeconds(0, 0);

  if (next.getMinutes() < 30) {
    next.setMinutes(30, 0, 0);
  } else {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  }

  return next;
}

function getTimeSlotsForDate(year, month, day, now = new Date()) {
  const selected = new Date(year, month - 1, day, 0, 0, 0, 0);
  const isToday =
    selected.getFullYear() === now.getFullYear() &&
    selected.getMonth() === now.getMonth() &&
    selected.getDate() === now.getDate();

  let startHour = 0;
  let startMinute = 0;

  if (isToday) {
    const rounded = roundToNextHalfHour(now);
    startHour = rounded.getHours();
    startMinute = rounded.getMinutes();
  }

  const slots = [];

  for (let hour = startHour; hour <= 23; hour += 1) {
    const minuteOptions = hour === startHour ? [startMinute, startMinute === 0 ? 30 : null] : [0, 30];

    for (const minute of minuteOptions) {
      if (minute === null) continue;
      if (hour === startHour && minute < startMinute) continue;

      slots.push({
        value: `${pad(hour)}${pad(minute)}`,
        label: `${pad(hour)}:${pad(minute)}`,
      });
    }
  }

  return slots;
}

function buildReminderDate(year, month, day, timeValue) {
  const hours = Number(timeValue.slice(0, 2));
  const minutes = Number(timeValue.slice(2, 4));
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getNextHalfHourDate(now = new Date()) {
  return roundToNextHalfHour(now);
}

module.exports = {
  buildReminderDate,
  formatDateTime,
  getAvailableDays,
  getCurrentYear,
  getNextHalfHourDate,
  getTimeSlotsForDate,
  getUpcomingMonths,
  toMysqlDateTime,
};