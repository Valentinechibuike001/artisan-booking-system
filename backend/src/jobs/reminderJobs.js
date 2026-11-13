const { Booking, Dispute, Report, Review, ArtisanProfile } = require("../models");
const C = require("../utils/constants");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// An artisan hasn't answered a dispute for a day: remind them
const nudgeArtisansOnDisputes = async () => {
  const cutoff = new Date(Date.now() - C.DISPUTE_ARTISAN_NUDGE_HOURS * HOUR);
  const waiting = await Dispute.find({
    status: "open",
    artisanNudged: { $ne: true },
    "artisanResponse.text": { $exists: false },
    createdAt: { $lt: cutoff },
  })
    .select("_id artisan")
    .limit(100);

  for (const d of waiting) {
    // Claim it first, so the reminder is only ever sent once
    const claimed = await Dispute.findOneAndUpdate(
      {
        _id: d._id,
        status: "open",
        artisanNudged: { $ne: true },
        "artisanResponse.text": { $exists: false },
      },
      { $set: { artisanNudged: true } }
    );
    if (!claimed) continue;

    const profile = await ArtisanProfile.findById(d.artisan).select("user");
    if (!profile) continue;

    notify(profile.user, {
      type: "dispute_nudge",
      title: "A dispute is waiting for your side",
      message: "A student reported a problem and you haven't answered yet. Please give your side so we can decide fairly.",
      link: `/artisan/disputes/${d._id}`,
      sendEmail: true,
    });
  }
};

// Disputes or reports have waited too long: warn the admins (one message per batch)
const alertAdmins = async () => {
  const disputes = await Dispute.updateMany(
    {
      status: "open",
      adminNudged: { $ne: true },
      createdAt: { $lt: new Date(Date.now() - C.DISPUTE_ADMIN_ALERT_HOURS * HOUR) },
    },
    { $set: { adminNudged: true } }
  );
  if (disputes.modifiedCount > 0) {
    const n = disputes.modifiedCount;
    notify.notifyAdmins({
      type: "overdue_alert",
      title: "Disputes are waiting",
      message: `${n} dispute${n > 1 ? "s have" : " has"} waited more than ${C.DISPUTE_ADMIN_ALERT_HOURS} hours for a decision.`,
      link: "/admin/disputes?status=open",
      sendEmail: true,
    });
  }

  const reports = await Report.updateMany(
    {
      status: "open",
      adminNudged: { $ne: true },
      createdAt: { $lt: new Date(Date.now() - C.REPORT_ADMIN_ALERT_HOURS * HOUR) },
    },
    { $set: { adminNudged: true } }
  );
  if (reports.modifiedCount > 0) {
    const n = reports.modifiedCount;
    notify.notifyAdmins({
      type: "overdue_alert",
      title: "Reports are waiting",
      message: `${n} report${n > 1 ? "s have" : " has"} waited more than ${C.REPORT_ADMIN_ALERT_HOURS} hours for review.`,
      link: "/admin/reports?status=open",
      sendEmail: true,
    });
  }
};

// A job was confirmed a couple of days ago and there is no review yet
const sendReviewReminders = async () => {
  const now = Date.now();
  const due = await Booking.find({
    status: "confirmed",
    reviewReminderSent: { $ne: true },
    confirmedAt: {
      $lte: new Date(now - C.REVIEW_REMINDER_AFTER_DAYS * DAY),
      $gt: new Date(now - C.REVIEW_WINDOW_DAYS * DAY),
    },
  })
    .select("_id")
    .limit(100);

  for (const item of due) {
    // Claim first, so one job only ever gets one reminder
    const b = await Booking.findOneAndUpdate(
      { _id: item._id, status: "confirmed", reviewReminderSent: { $ne: true } },
      { $set: { reviewReminderSent: true } },
      { new: true }
    ).populate({ path: "artisan", select: "user", populate: { path: "user", select: "fullName" } });

    if (!b || !b.artisan || !b.artisan.user) continue;
    if (await Review.exists({ booking: b._id })) continue; // they already reviewed it

    notify(b.user, {
      type: "review_reminder",
      title: "How did it go?",
      message: `Tell others about your ${b.service.name} with ${publicName(b.artisan.user.fullName)}. It only takes a minute.`,
      link: `/bookings/${b._id}`,
      sendEmail: true,
    });
  }
};

const runAll = async () => {
  try {
    await nudgeArtisansOnDisputes();
    await alertAdmins();
    await sendReviewReminders();
  } catch (err) {
    console.error("Reminder job error:", err.message);
  }
};

const startReminderJobs = () => {
  runAll();
  setInterval(runAll, 10 * 60 * 1000); // every 10 minutes
};

module.exports = { startReminderJobs };