const { SlotLock, Booking } = require("../models");
const C = require("./constants");

const MINUTE = 60 * 1000;
const BLOCK_MS = C.DURATION_STEP_MINUTES * MINUTE; // each lock covers 15 minutes

// A booking that ends up in one of these never happens, so it gives its time back
const RELEASING = ["expired", "declined", "cancelled"];

const isDuplicate = (err) =>
  Boolean(err) && (err.code === 11000 || /E11000/.test(String(err.message)));

// All the 15-minute blocks a job holds, including the gap kept after it
const blocksFor = (startsAt, endsAt, bufferMinutes) => {
  const start = startsAt.getTime();
  const end = endsAt.getTime() + bufferMinutes * MINUTE;
  const blocks = [];
  for (let t = start; t < end; t += BLOCK_MS) blocks.push(new Date(t));
  return blocks;
};

// Frees locks that belong to bookings that are already dead. Returns how many bookings were freed.
const reclaimStale = async (artisanId, blocks) => {
  const locks = await SlotLock.find({ artisan: artisanId, slot: { $in: blocks } }).select("booking");
  const ids = [...new Set(locks.map((l) => String(l.booking)))];
  if (ids.length === 0) return 0;

  const bookings = await Booking.find({ _id: { $in: ids } }).select("status paymentDeadline");
  const now = Date.now();
  const dead = [];

  for (const b of bookings) {
    const closed = RELEASING.includes(b.status);
    const unpaidTooLong =
      b.status === "awaiting_payment" && b.paymentDeadline && b.paymentDeadline.getTime() < now;
    if (closed || unpaidTooLong) dead.push(String(b._id));
  }

  // Locks pointing at a booking that no longer exists are dead too
  const known = new Set(bookings.map((b) => String(b._id)));
  ids.forEach((id) => {
    if (!known.has(id)) dead.push(id);
  });

  if (dead.length === 0) return 0;
  await SlotLock.deleteMany({ booking: { $in: dead } });
  return dead.length;
};

// Tries to hold the booking's time. Returns true if it got it, false if someone else has it.
const acquireLocks = async (booking) => {
  const gap = Number.isInteger(booking.bufferMinutes) ? booking.bufferMinutes : C.TRAVEL_BUFFER_MINUTES;
  const blocks = blocksFor(booking.startsAt, booking.endsAt, gap);
  const docs = blocks.map((slot) => ({ artisan: booking.artisan, slot, booking: booking._id }));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await SlotLock.insertMany(docs, { ordered: true });
      return true;
    } catch (err) {
      await SlotLock.deleteMany({ booking: booking._id }); // undo whatever we managed to insert
      if (!isDuplicate(err)) throw err;
      if (attempt === 1) return false;

      const freed = await reclaimStale(booking.artisan, blocks);
      if (freed === 0) return false;
    }
  }
  return false;
};

// Gives a booking's time back. It never throws, so it can't break the real action.
const releaseLocks = async (bookingId) => {
  try {
    await SlotLock.deleteMany({ booking: bookingId });
  } catch (err) {
    console.error("Could not release slot locks:", err.message);
  }
};

module.exports = { acquireLocks, releaseLocks, RELEASING };