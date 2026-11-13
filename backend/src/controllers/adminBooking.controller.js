const mongoose = require("mongoose");
const { Booking, Payment, Dispute, Review, Message } = require("../models");
const T = require("../utils/time");

const STATUSES = [
  "awaiting_payment", "pending", "accepted", "completed",
  "confirmed", "declined", "cancelled", "expired", "disputed",
];

const populateAll = [
  { path: "user", select: "fullName phone email hostel" },
  { path: "artisan", select: "occupation user", populate: { path: "user", select: "fullName phone email" } },
];

const row = (b) => ({
  id: b._id,
  status: b.status,
  serviceName: b.service ? b.service.name : null,
  price: b.price,
  date: T.dateKey(b.date),
  time: b.time,
  createdAt: b.createdAt,
  student: b.user ? { id: b.user._id, name: b.user.fullName } : null,
  artisan:
    b.artisan && b.artisan.user
      ? { id: b.artisan._id, name: b.artisan.user.fullName, occupation: b.artisan.occupation }
      : null,
});

// GET /api/admin/bookings?status=&artisanId=&userId=&from=2026-11-01&to=2026-11-30&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = {};
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (mongoose.isValidObjectId(req.query.artisanId)) filter.artisan = req.query.artisanId;
    if (mongoose.isValidObjectId(req.query.userId)) filter.user = req.query.userId;

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if ((from && !T.isValidDateStr(from)) || (to && !T.isValidDateStr(to))) {
      return res.status(400).json({ message: "Dates must look like 2026-11-09" });
    }
    if (from || to) {
      filter.startsAt = {};
      if (from) filter.startsAt.$gte = T.buildStartsAt(from, "00:00");
      if (to) filter.startsAt.$lt = T.buildStartsAt(T.addDays(to, 1), "00:00");
    }

    const [bookings, total, countRows] = await Promise.all([
      Booking.find(filter)
        .sort({ startsAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateAll),
      Booking.countDocuments(filter),
      Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = {};
    STATUSES.forEach((s) => (counts[s] = 0));
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    res.json({ bookings: bookings.map(row), counts, page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/bookings/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const b = await Booking.findById(id).populate(populateAll);
    if (!b) return res.status(404).json({ message: "Booking not found" });

    const [payment, dispute, review, messageCount] = await Promise.all([
      Payment.findOne({ booking: b._id }),
      Dispute.findOne({ booking: b._id }).select("status category resolution"),
      Review.findOne({ booking: b._id }).select("rating isHidden"),
      Message.countDocuments({ booking: b._id }),
    ]);

    res.json({
      booking: {
        ...row(b),
        startsAt: b.startsAt,
        endsAt: b.endsAt || null,
        durationMinutes: b.service ? b.service.durationMinutes : null,
        description: b.description,
        locationNote: b.locationNote || null,
        cancelReason: b.cancelReason || null,
        refundPercent: b.refundPercent === undefined ? null : b.refundPercent,
        paymentDeadline: b.paymentDeadline || null,
        paidAt: b.paidAt || null,
        acceptedAt: b.acceptedAt || null,
        completedAt: b.completedAt || null,
        confirmedAt: b.confirmedAt || null,
        disputeWindowEndsAt: b.disputeWindowEndsAt || null,
        studentContact: b.user ? { phone: b.user.phone, email: b.user.email, hostel: b.user.hostel || null } : null,
        artisanContact:
          b.artisan && b.artisan.user ? { phone: b.artisan.user.phone, email: b.artisan.user.email } : null,
        timeline: b.statusHistory.map((h) => ({ status: h.status, at: h.at, note: h.note || null })),
        payment: payment
          ? {
              id: payment._id,
              status: payment.status,
              amount: payment.amount,
              platformFee: payment.platformFee,
              artisanAmount: payment.artisanAmount,
              refundedAmount: payment.refundedAmount || 0,
            }
          : null,
        dispute: dispute ? { id: dispute._id, status: dispute.status, category: dispute.category } : null,
        review: review ? { id: review._id, rating: review.rating, isHidden: review.isHidden } : null,
        messageCount,
      },
    });
  } catch (err) {
    next(err);
  }
};