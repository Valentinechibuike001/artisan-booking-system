const WAT = "+01:00"; // Nigeria has no daylight saving


const isValidDateStr = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const isValidTimeStr = (s) =>
  typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// Date + time in Nigerian time -> exact moment
const buildStartsAt = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr}:00${WAT}`);

// Today's date in Nigeria, e.g. "2026-11-07"
const todayWAT = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 0 = Sunday ... 6 = Saturday
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();

const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

const dateKey = (d) => d.toISOString().slice(0, 10);

// ("2026-11-17", "16:00") -> "Tue 17 Nov, 4:00 PM"
const formatWhen = (dateStr, timeStr) => {
  const day = new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const [h, m] = timeStr.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${day}, ${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

module.exports = {
  isValidDateStr, isValidTimeStr, buildStartsAt, todayWAT,
  addDays, weekdayOf, toMinutes, fromMinutes, dateKey, formatWhen,
};