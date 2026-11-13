const { Notification, User } = require("../models");
const { sendNotificationEmail } = require("./sendEmail");

// Only these events also send an email
const EMAIL_TYPES = new Set([
  "booking_request",
  "payment_received",
  "booking_accepted",
  "booking_declined",
  "booking_cancelled",
  "job_completed",
  "job_confirmed",
  "payment_refunded",
  "job_reminder",
  "dispute_opened",
  "dispute_resolved",
  "new_report",
  "artisan_approved",
  "artisan_rejected",
  "artisan_suspended",
  "artisan_reinstated",
  "artisan_pending",
  "artisan_resubmitted",
  "role_changed",
  "payout_sent",
  "account_suspended",
  "account_reinstated",
  "risk_alert",
  "password_changed",
]);

// Emails a person can switch off. Every type NOT listed here is always sent.
const PREF_KEY = {
  job_reminder: "reminders",
  review_reminder: "reminders",
  booking_request: "bookingUpdates",
  booking_accepted: "bookingUpdates",
  booking_declined: "bookingUpdates",
  booking_cancelled: "bookingUpdates",
  job_completed: "bookingUpdates",
  job_confirmed: "bookingUpdates",
};

// Saves an in-app notification, and sends an email for the important ones.
// It never throws, so a notification problem can't break the real request.
const notify = async (
  userId,
  { type, title, message, link, replaceUnread = false, allowInactive = false, sendEmail = false }
) => {
  try {
    if (replaceUnread) {
      await Notification.deleteMany({ user: userId, type, link, isRead: false });
    }
    await Notification.create({ user: userId, type, title, message, link });
  } catch (err) {
    console.error("Notification failed:", err.message);
    return;
  }

  if (!sendEmail && !EMAIL_TYPES.has(type)) return;

  try {
    const user = await User.findById(userId).select("email fullName isActive emailPrefs");
    if (!user) return;
    if (!user.isActive && !allowInactive) return;
    if (/@sample\.test$/i.test(user.email)) return; // sample accounts never get real emails

    const prefKey = PREF_KEY[type];
    if (prefKey && user.emailPrefs && user.emailPrefs[prefKey] === false) return;

    await sendNotificationEmail(user.email, user.fullName, { title, message, link });
  } catch (err) {
    console.error("Notification email failed:", err.message);
  }
};

// Sends the same notification to every admin
const notifyAdmins = async (payload) => {
  try {
    const admins = await User.find({ role: "admin", isActive: true }).select("_id");
    await Promise.all(admins.map((a) => notify(a._id, payload)));
  } catch (err) {
    console.error("Admin notification failed:", err.message);
  }
};

notify.notifyAdmins = notifyAdmins;
module.exports = notify;