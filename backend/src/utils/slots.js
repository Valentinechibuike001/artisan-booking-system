const { Booking } = require("../models");
const C = require("./constants");
const T = require("./time");

const MINUTE = 60 * 1000;

// The gap this artisan keeps after each job
const bufferFor = (profile) => {
  const n = profile && profile.bufferMinutes;
  return Number.isInteger(n) && n >= 0 ? n : C.TRAVEL_BUFFER_MINUTES;
};

// 90 -> "1h 30m", 120 -> "2 hours", 45 -> "45 min"
const formatDuration = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${h}h ${m}m`;
};

// The artisan's working hours on a date, or null if they don't work that day
const getWindow = (profile, dateStr) => {
  const schedule = profile.weeklySchedule || [];
  if (schedule.length === 0) return C.DEFAULT_HOURS;
  const entry = schedule.find((e) => e.day === T.weekdayOf(dateStr));
  return entry && entry.enabled ? { from: entry.from, to: entry.to } : null;
};

const isBlockedDate = (profile, dateStr) =>
  (profile.blockedDates || []).some((d) => T.dateKey(d) === dateStr);

// Time ranges already taken: [{ start, end }] in milliseconds.
// Each range includes the gap that artisan kept after that job.
const getBusy = async (artisanId, fromMs, toMs) => {
  const lookBack = (C.MAX_DURATION_MINUTES + C.MAX_BUFFER_MINUTES) * MINUTE; // a long job may have started earlier
  const bookings = await Booking.find({
    artisan: artisanId,
    startsAt: { $gt: new Date(fromMs - lookBack), $lt: new Date(toMs) },
    $or: [
      { status: { $in: ["pending", "accepted"] } },
      { status: "awaiting_payment", paymentDeadline: { $gt: new Date() } },
    ],
  }).select("startsAt endsAt bufferMinutes");

  return bookings
    .map((b) => {
      const gap = Number.isInteger(b.bufferMinutes) ? b.bufferMinutes : C.TRAVEL_BUFFER_MINUTES;
      const jobEnd = b.endsAt
        ? b.endsAt.getTime()
        : b.startsAt.getTime() + C.DEFAULT_DURATION_MINUTES * MINUTE; // bookings made before durations existed
      return { start: b.startsAt.getTime(), end: jobEnd + gap * MINUTE };
    })
    .filter((i) => i.end > fromMs);
};

// Two time ranges clash when each one starts before the other ends
const overlaps = (startMs, endMs, busy) =>
  busy.some((b) => startMs < b.end && endMs > b.start);

// Checks every rule. Returns { ok: false, message } or { ok: true, startsAt, endsAt }
const checkSlot = async (profile, dateStr, timeStr, durationMin, busy) => {
  const startsAt = T.buildStartsAt(dateStr, timeStr);
  const startMs = startsAt.getTime();
  const endMs = startMs + durationMin * MINUTE;
  const blockEndMs = endMs + bufferFor(profile) * MINUTE; // the time this job really occupies

  // Start times must sit on a 15-minute mark, so the database locks line up
  if (T.toMinutes(timeStr) % C.DURATION_STEP_MINUTES !== 0) {
    return { ok: false, message: "Please pick one of the available times" };
  }
  if (startMs - Date.now() < C.MIN_LEAD_MINUTES * MINUTE) {
    return { ok: false, message: `Please book at least ${C.MIN_LEAD_MINUTES / 60} hours ahead` };
  }
  if (dateStr > T.addDays(T.todayWAT(), C.MAX_DAYS_AHEAD)) {
    return { ok: false, message: `You can only book up to ${C.MAX_DAYS_AHEAD} days ahead` };
  }
  if (isBlockedDate(profile, dateStr)) {
    return { ok: false, message: "This artisan is not available on that date" };
  }

  const win = getWindow(profile, dateStr);
  if (!win) return { ok: false, message: "This artisan doesn't work on that day" };
  if (timeStr < win.from || timeStr >= win.to) {
    return { ok: false, message: `This artisan works ${win.from} to ${win.to} on that day` };
  }
  if (T.toMinutes(timeStr) + durationMin > T.toMinutes(win.to)) {
    return {
      ok: false,
      message: `This job takes ${formatDuration(durationMin)} and would run past ${win.to}. Pick an earlier time.`,
    };
  }

  const list = busy || (await getBusy(profile._id, startMs, blockEndMs));
  if (overlaps(startMs, blockEndMs, list)) {
    return { ok: false, message: "That time is already taken. Please pick another." };
  }
  return { ok: true, startsAt, endsAt: new Date(endMs) };
};

// Free start times on a date for a service of this length
const listSlots = async (profile, dateStr, durationMin) => {
  if (dateStr < T.todayWAT()) return { slots: [], reason: "That date has passed" };
  if (dateStr > T.addDays(T.todayWAT(), C.MAX_DAYS_AHEAD)) {
    return { slots: [], reason: `You can only book up to ${C.MAX_DAYS_AHEAD} days ahead` };
  }
  if (isBlockedDate(profile, dateStr)) {
    return { slots: [], reason: "This artisan is not available on that date" };
  }

  const win = getWindow(profile, dateStr);
  if (!win) return { slots: [], reason: "This artisan doesn't work on that day" };
  if (T.toMinutes(win.to) - T.toMinutes(win.from) < durationMin) {
    return {
      slots: [],
      reason: `This service takes ${formatDuration(durationMin)}, which is longer than the artisan's working hours that day`,
    };
  }

  const dayStart = T.buildStartsAt(dateStr, "00:00").getTime();
  const busy = await getBusy(profile._id, dayStart, dayStart + 24 * 60 * MINUTE);

  // Start at the first 15-minute mark on or after opening time, then step every 30 minutes
  const first =
    Math.ceil(T.toMinutes(win.from) / C.DURATION_STEP_MINUTES) * C.DURATION_STEP_MINUTES;

  const slots = [];
  for (let m = first; m + durationMin <= T.toMinutes(win.to); m += C.SLOT_STEP_MINUTES) {
    const time = T.fromMinutes(m);
    const result = await checkSlot(profile, dateStr, time, durationMin, busy);
    if (result.ok) slots.push(time);
  }
  return { slots, reason: slots.length ? null : "No free times on that day" };
};

module.exports = { checkSlot, listSlots, formatDuration, bufferFor };