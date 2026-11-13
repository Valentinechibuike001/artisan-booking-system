const {
  User, ArtisanProfile, Booking, Dispute, Report, Review, RoleRequest, Payment, Notification,
} = require("../models");
const C = require("../utils/constants");
const T = require("../utils/time");
const { payablePipeline } = require("../utils/payouts");
const { naira } = require("../utils/money");
const { isSuper } = require("../utils/adminLevel");
const notify = require("../utils/notify");

const DAY = 24 * 60 * 60 * 1000;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The hour on a Nigerian clock (UTC+1), 0 to 23
const hourInNigeria = () => new Date(Date.now() + 60 * 60 * 1000).getUTCHours();

const sendDailySummary = async () => {
  if (hourInNigeria() !== C.DAILY_SUMMARY_HOUR) return;

  const todayStart = T.buildStartsAt(T.todayWAT(), "00:00");

  // Already sent today?
  if (await Notification.exists({ type: "daily_summary", createdAt: { $gte: todayStart } })) return;

  const admins = await User.find({ role: "admin", isActive: true }).select("_id role adminLevel");
  if (admins.length === 0) return;

  const yesterdayStart = new Date(todayStart.getTime() - DAY);

  const [newBookings, pendingArtisans, openDisputes, openReports, flaggedReviews, roleRequests, failedRefunds, ready] =
    await Promise.all([
      Booking.countDocuments({
        createdAt: { $gte: yesterdayStart, $lt: todayStart },
        status: { $nin: ["awaiting_payment", "expired"] },
      }),
      ArtisanProfile.countDocuments({ status: "pending" }),
      Dispute.countDocuments({ status: "open" }),
      Report.countDocuments({ status: "open" }),
      Review.countDocuments({ "flag.reason": { $exists: true }, "flag.resolved": { $ne: true } }),
      RoleRequest.countDocuments({ status: "pending" }),
      Payment.countDocuments({ refundStatus: "failed" }),
      Payment.aggregate([
        ...payablePipeline(),
        { $group: { _id: null, total: { $sum: "$artisanAmount" } } },
      ]),
    ]);

  const readyAmount = ready[0] ? ready[0].total : 0;

  const everyone =
    `${plural(newBookings, "new booking")} yesterday. ` +
    `Waiting for you: ${plural(pendingArtisans, "artisan")} to approve, ` +
    `${plural(openDisputes, "dispute")}, ${plural(openReports, "report")}, ` +
    `${plural(flaggedReviews, "flagged review")}, ${plural(roleRequests, "role request")}.`;

  const moneyLine =
    ` Money: ${naira(readyAmount)} ready for payout` +
    (failedRefunds > 0 ? `, and ${plural(failedRefunds, "failed refund")} to fix.` : ".");

  await Promise.all(
    admins.map((a) =>
      notify(a._id, {
        type: "daily_summary",
        title: "Your daily summary",
        message: isSuper(a) ? everyone + moneyLine : everyone,
        link: "/admin/dashboard",
        sendEmail: true,
      })
    )
  );
};

const runAll = async () => {
  try {
    await sendDailySummary();
  } catch (err) {
    console.error("Admin job error:", err.message);
  }
};

const startAdminJobs = () => {
  runAll();
  setInterval(runAll, 15 * 60 * 1000); // checks every 15 minutes, sends once a day
};

module.exports = { startAdminJobs };