const mongoose = require("mongoose");
const { Booking } = require("../models");
const C = require("../utils/constants");
const { move, artisanView, populateStudent } = require("../utils/bookingHelpers");
const { refundPayment } = require("../utils/payments");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

// The artisan never sees unpaid or expired bookings
const TAB_STATUSES = {
  requests: ["pending"],
  upcoming: ["accepted", "completed"],
  history: ["confirmed", "declined", "cancelled", "disputed"],
};

const findMine = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Booking.findOne({ _id: req.params.id, artisan: req.profile._id });
};

// GET /api/artisan/bookings?tab=requests|upcoming|history
exports.listBookings = async (req, res, next) => {
  try {
    const tab = TAB_STATUSES[req.query.tab] ? req.query.tab : "requests";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { artisan: req.profile._id, status: { $in: TAB_STATUSES[tab] } };

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ startsAt: tab === "history" ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateStudent),
      Booking.countDocuments(filter),
    ]);

    res.json({ tab, bookings: bookings.map((b) => artisanView(b)), page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/bookings/stats
exports.stats = async (req, res, next) => {
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const mine = { artisan: req.profile._id };

    const [newRequests, upcomingJobs, jobsThisMonth] = await Promise.all([
      Booking.countDocuments({ ...mine, status: "pending" }),
      Booking.countDocuments({ ...mine, status: { $in: ["accepted", "completed"] } }),
      Booking.countDocuments({ ...mine, status: "confirmed", confirmedAt: { $gte: monthStart } }),
    ]);

    res.json({
      newRequests,
      upcomingJobs,
      jobsThisMonth,
      rating: Math.round((req.profile.ratingAverage || 0) * 10) / 10,
      ratingCount: req.profile.ratingCount,
      jobsCompleted: req.profile.jobsCompleted,
      isAvailable: req.profile.isAvailable,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/bookings/:id
exports.getBooking = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Booking not found" });
    }
    const booking = await Booking.findOne({
      _id: req.params.id,
      artisan: req.profile._id,
      status: { $nin: ["awaiting_payment", "expired"] },
    }).populate(populateStudent);

    if (!booking) return res.status(404).json({ message: "Booking not found" });
    res.json({ booking: artisanView(booking) });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/accept
exports.accept = async (req, res, next) => {
  try {
    const b = await findMine(req);
    if (!b) return res.status(404).json({ message: "Booking not found" });
    if (b.status === "pending" && b.startsAt <= new Date()) {
      return res.status(409).json({ message: "The time for this job has already passed" });
    }

    const result = await move({
      id: b._id,
      owner: { artisan: req.profile._id },
      from: ["pending"],
      to: "accepted",
      by: req.user._id,
      note: "The artisan accepted",
      set: { acceptedAt: new Date() },
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    notify(b.user, {
      type: "booking_accepted",
      title: "Booking accepted",
      message: `${publicName(req.user.fullName)} accepted your ${b.service.name} booking.`,
      link: `/bookings/${b._id}`,
    });
    res.json({ message: "Booking accepted" });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/decline
exports.decline = async (req, res, next) => {
  try {
    const b = await findMine(req);
    if (!b) return res.status(404).json({ message: "Booking not found" });

    const reason = String(req.body.reason || "").trim().slice(0, 300);
    const result = await move({
      id: b._id,
      owner: { artisan: req.profile._id },
      from: ["pending"],
      to: "declined",
      by: req.user._id,
      note: reason || "The artisan declined",
      set: { cancelledBy: req.user._id, cancelReason: reason, cancelledAt: new Date(), refundPercent: 100 },
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    await refundPayment(b._id, 100);
    notify(b.user, {
      type: "booking_declined",
      title: "Booking declined",
      message: `${publicName(req.user.fullName)} couldn't take your ${b.service.name} booking. You will be refunded in full.`,
      link: `/bookings/${b._id}`,
    });
    res.json({ message: "Booking declined. The student has been refunded." });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/complete
exports.complete = async (req, res, next) => {
  try {
    const b = await findMine(req);
    if (!b) return res.status(404).json({ message: "Booking not found" });
    if (b.status === "accepted" && b.startsAt > new Date()) {
      return res.status(400).json({
        message: "You can mark the job complete only after the scheduled start time",
      });
    }

    const now = new Date();
    const result = await move({
      id: b._id,
      owner: { artisan: req.profile._id },
      from: ["accepted"],
      to: "completed",
      by: req.user._id,
      note: "The artisan marked the job complete",
      set: {
        completedAt: now,
        disputeWindowEndsAt: new Date(now.getTime() + C.DISPUTE_WINDOW_HOURS * 60 * 60 * 1000),
      },
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    notify(b.user, {
      type: "job_completed",
      title: "Job finished?",
      message: `${publicName(req.user.fullName)} marked ${b.service.name} as complete. Please confirm or report a problem.`,
      link: `/bookings/${b._id}`,
    });
    res.json({ message: "Marked complete. Waiting for the student to confirm." });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/cancel   (an accepted job)
exports.cancel = async (req, res, next) => {
  try {
    const b = await findMine(req);
    if (!b) return res.status(404).json({ message: "Booking not found" });

    const reason = String(req.body.reason || "").trim().slice(0, 300);
    if (reason.length < 5) {
      return res.status(400).json({ message: "Please give a reason for cancelling" });
    }
    if (b.status === "accepted" && b.startsAt <= new Date()) {
      return res.status(409).json({ message: "The job time has passed. Mark it complete instead." });
    }

    const result = await move({
      id: b._id,
      owner: { artisan: req.profile._id },
      from: ["accepted"],
      to: "cancelled",
      by: req.user._id,
      note: reason,
      set: { cancelledBy: req.user._id, cancelReason: reason, cancelledAt: new Date(), refundPercent: 100 },
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    await refundPayment(b._id, 100);
    notify(b.user, {
      type: "booking_cancelled",
      title: "Booking cancelled by the artisan",
      message: `${publicName(req.user.fullName)} cancelled your ${b.service.name} booking. You will be refunded in full.`,
      link: `/bookings/${b._id}`,
    });
    res.json({ message: "Booking cancelled. The student has been refunded." });
  } catch (err) {
    next(err);
  }
};