const { Booking, ArtisanProfile } = require("../models");
const C = require("../utils/constants");
const { transition } = require("../utils/bookingHelpers");
const { refundPayment, releasePayment } = require("../utils/payments");
const { publicName } = require("../utils/artisanPublic");
const { formatWhen, dateKey } = require("../utils/time");
const notify = require("../utils/notify");

const HOUR = 60 * 60 * 1000;

// Unpaid bookings free their time slot after the payment window
const expireUnpaid = async () => {
  const stale = await Booking.find({
    status: "awaiting_payment",
    paymentDeadline: { $lt: new Date() },
  }).select("_id");

  for (const b of stale) {
    await transition({
      id: b._id,
      from: ["awaiting_payment"],
      to: "expired",
      note: "Payment time ran out",
    });
  }
};

// Paid, but the artisan never answered: decline and refund in full
const autoDeclineUnanswered = async () => {
  const cutoff = new Date(Date.now() - C.ARTISAN_RESPONSE_HOURS * HOUR);
  const stale = await Booking.find({
    status: "pending",
    $or: [{ paidAt: { $lt: cutoff } }, { startsAt: { $lt: new Date() } }],
  }).select("_id user service");

  for (const b of stale) {
    const done = await transition({
      id: b._id,
      from: ["pending"],
      to: "declined",
      note: "The artisan did not respond in time",
      set: { refundPercent: 100 },
    });
    if (!done) continue;

    await refundPayment(b._id, 100);
    notify(b.user, {
      type: "booking_declined",
      title: "Booking not accepted",
      message: `Your ${b.service.name} booking got no response, so you will be refunded in full.`,
      link: `/bookings/${b._id}`,
    });
  }
};

// The student never tapped "Job done": confirm after the report window closes
const autoConfirm = async () => {
  const due = await Booking.find({
    status: "completed",
    disputeWindowEndsAt: { $lt: new Date() },
  }).select("_id artisan");

  for (const b of due) {
    const done = await transition({
      id: b._id,
      from: ["completed"],
      to: "confirmed",
      note: "Confirmed automatically after the report window",
      set: { confirmedAt: new Date() },
    });
    if (!done) continue;

    await releasePayment(b._id);
    await ArtisanProfile.updateOne({ _id: b.artisan }, { $inc: { jobsCompleted: 1 } });
  }
};

// Sends one kind of reminder to every accepted job whose start time is in "range"
const sendReminderBatch = async (flag, range, extraFlags = {}) => {
  const due = await Booking.find({
    status: "accepted",
    [flag]: { $ne: true },
    startsAt: range,
  })
    .select("_id")
    .limit(200);

  for (const item of due) {
    // Claim it first: only one run can flip the flag, so nobody gets two reminders
    const b = await Booking.findOneAndUpdate(
      { _id: item._id, status: "accepted", [flag]: { $ne: true } },
      { $set: { [flag]: true, ...extraFlags } },
      { new: true }
    )
      .populate("user", "fullName")
      .populate({ path: "artisan", select: "user", populate: { path: "user", select: "fullName" } });

    if (!b || !b.user || !b.artisan || !b.artisan.user) continue;

    const when = formatWhen(dateKey(b.date), b.time);

    notify(b.user._id, {
      type: "job_reminder",
      title: "Job coming up",
      message: `${b.service.name} with ${publicName(b.artisan.user.fullName)} on ${when}.`,
      link: `/bookings/${b._id}`,
    });
    notify(b.artisan.user._id, {
      type: "job_reminder",
      title: "Job coming up",
      message: `${b.service.name} for ${publicName(b.user.fullName)} on ${when}.`,
      link: `/artisan/bookings/${b._id}`,
    });
  }
};

const sendReminders = async () => {
  const now = Date.now();

  // Within 2 hours. This also switches off the 24-hour reminder, so nobody gets both at once.
  await sendReminderBatch(
    "reminder2Sent",
    { $gt: new Date(now), $lte: new Date(now + 2 * HOUR) },
    { reminder24Sent: true }
  );

  // Between 2 and 24 hours away
  await sendReminderBatch("reminder24Sent", {
    $gt: new Date(now + 2 * HOUR),
    $lte: new Date(now + 24 * HOUR),
  });
};

const runAll = async () => {
  try {
    await expireUnpaid();
    await autoDeclineUnanswered();
    await autoConfirm();
    await sendReminders();
  } catch (err) {
    console.error("Booking job error:", err.message);
  }
};

const startBookingJobs = () => {
  runAll();
  setInterval(runAll, 60 * 1000);
};

module.exports = { startBookingJobs };