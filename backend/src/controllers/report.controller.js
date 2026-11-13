const mongoose = require("mongoose");
const { Booking, Report, ArtisanProfile, Message } = require("../models");
const C = require("../utils/constants");
const notify = require("../utils/notify");

const REASONS = ["fake_profile", "unsafe_behaviour", "harassment", "scam", "other"];
const MESSAGE_REASONS = ["harassment", "scam", "unsafe_behaviour", "inappropriate_message", "other"];
const DAY = 24 * 60 * 60 * 1000;

// Checks the form. Returns { error } or { reason, details }
const readForm = (body = {}, allowed = REASONS) => {
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!allowed.includes(reason)) return { error: "Please choose a reason" };

  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (details.length > 500) return { error: "Details can be at most 500 characters" };
  if (reason === "other" && details.length < 10) {
    return { error: "Please explain what happened (at least 10 characters)" };
  }
  return { reason, details };
};

// Stops spam: a daily limit, and only one open report per person
const checkLimits = async (reporterId, reportedId) => {
  const recent = await Report.countDocuments({
    reporter: reporterId,
    createdAt: { $gte: new Date(Date.now() - DAY) },
  });
  if (recent >= C.MAX_REPORTS_PER_DAY) {
    return { code: 429, message: "You have sent too many reports today. Please try again tomorrow." };
  }

  const open = await Report.exists({ reporter: reporterId, reportedUser: reportedId, status: "open" });
  if (open) {
    return { code: 409, message: "You already have an open report about this person" };
  }
  return null;
};

const saveReport = async (res, { reporter, reportedUser, booking, message, reason, details }) => {
  const report = await Report.create({ reporter, reportedUser, booking, message, reason, details });

  notify.notifyAdmins({
    type: "new_report",
    title: "New user report",
    message: `Reason: ${reason.replace(/_/g, " ")}`,
    link: `/admin/reports/${report._id}`,
  });

  res.status(201).json({ message: "Thank you. Our team will review your report." });
};

// POST /api/user/artisans/:artisanId/report   { reason, details, bookingId? }
exports.reportArtisan = async (req, res, next) => {
  try {
    const { artisanId } = req.params;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const form = readForm(req.body);
    if (form.error) return res.status(400).json({ message: form.error });

    const profile = await ArtisanProfile.findById(artisanId).select("user");
    if (!profile) return res.status(404).json({ message: "Artisan not found" });

    // Optional: link the report to a job this student really had with this artisan
    let bookingId;
    const given = (req.body || {}).bookingId;
    if (given) {
      const booking = mongoose.isValidObjectId(given)
        ? await Booking.findOne({ _id: given, user: req.user._id, artisan: profile._id }).select("_id")
        : null;
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      bookingId = booking._id;
    }

    const blocked = await checkLimits(req.user._id, profile.user);
    if (blocked) return res.status(blocked.code).json({ message: blocked.message });

    await saveReport(res, {
      reporter: req.user._id,
      reportedUser: profile.user,
      booking: bookingId,
      reason: form.reason,
      details: form.details,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/report-student   { reason, details }
exports.reportStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const form = readForm(req.body);
    if (form.error) return res.status(400).json({ message: form.error });

    const booking = await Booking.findOne({
      _id: id,
      artisan: req.profile._id,
      status: { $nin: ["awaiting_payment", "expired"] },
    }).select("user");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const blocked = await checkLimits(req.user._id, booking.user);
    if (blocked) return res.status(blocked.code).json({ message: blocked.message });

    await saveReport(res, {
      reporter: req.user._id,
      reportedUser: booking.user,
      booking: booking._id,
      reason: form.reason,
      details: form.details,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/messages/:bookingId/:messageId/report   { reason, details }
exports.reportMessage = async (req, res, next) => {
  try {
    const { bookingId, messageId } = req.params;
    if (!mongoose.isValidObjectId(bookingId) || !mongoose.isValidObjectId(messageId)) {
      return res.status(404).json({ message: "Message not found" });
    }

    const form = readForm(req.body, MESSAGE_REASONS);
    if (form.error) return res.status(400).json({ message: form.error });

    const message = await Message.findOne({ _id: messageId, booking: bookingId });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (String(message.sender) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't report your own message" });
    }

    // The person reporting must be one of the two people in this booking
    const booking = await Booking.findById(bookingId).populate("artisan", "user");
    if (!booking || !booking.artisan) return res.status(404).json({ message: "Message not found" });

    const me = String(req.user._id);
    const isStudent = String(booking.user) === me;
    const isArtisan = String(booking.artisan.user) === me;
    if (!isStudent && !isArtisan) return res.status(404).json({ message: "Message not found" });

    const blocked = await checkLimits(req.user._id, message.sender);
    if (blocked) return res.status(blocked.code).json({ message: blocked.message });

    await saveReport(res, {
      reporter: req.user._id,
      reportedUser: message.sender,
      booking: booking._id,
      message: message._id,
      reason: form.reason,
      details: form.details,
    });
  } catch (err) {
    next(err);
  }
};