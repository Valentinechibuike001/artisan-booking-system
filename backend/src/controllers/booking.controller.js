const mongoose = require("mongoose");
const { Booking, Payment, ArtisanProfile ,Review, Dispute} = require("../models");
const C = require("../utils/constants");
const T = require("../utils/time");
const { checkSlot, bufferFor } = require("../utils/slots");
const { calcFees, refundPayment, releasePayment } = require("../utils/payments");
const { move, userView, studentCancelPercent, populateArtisan } = require("../utils/bookingHelpers");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");
const { acquireLocks, releaseLocks } = require("../utils/slotLocks");

const TAB_STATUSES = {
  upcoming: ["awaiting_payment", "pending", "accepted", "completed"],
  completed: ["confirmed", "disputed"],
  cancelled: ["cancelled", "declined", "expired"],
};

// Builds student views with their payment info attached
// Builds student views with their payment and review info attached
// Builds student views with their payment, review and dispute info attached
const withPayments = async (bookings) => {
  const ids = bookings.map((b) => b._id);

  const [payments, reviews, disputes] = await Promise.all([
    Payment.find({ booking: { $in: ids } }).select(
      "booking status amount refundedAmount refundStatus"
    ),
    Review.find({ booking: { $in: ids } }).select("booking rating"),
    Dispute.find({ booking: { $in: ids } }).select("booking status"),
  ]);

  const paymentMap = new Map(payments.map((p) => [String(p.booking), p]));
  const reviewMap = new Map(reviews.map((r) => [String(r.booking), r]));
  const disputeMap = new Map(disputes.map((d) => [String(d.booking), d]));

  return bookings.map((b) =>
    userView(
      b,
      paymentMap.get(String(b._id)),
      reviewMap.get(String(b._id)),
      disputeMap.get(String(b._id))
    )
  );
};
// POST /api/user/bookings
exports.createBooking = async (req, res, next) => {
  try {
    const { artisanId, serviceId, date, time, description, locationNote } = req.body;

    if (!mongoose.isValidObjectId(artisanId) || !mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: "Please choose an artisan and a service" });
    }
    if (!T.isValidDateStr(date) || !T.isValidTimeStr(time)) {
      return res.status(400).json({ message: "Date must look like 2026-11-09 and time like 16:00" });
    }
    const desc = String(description || "").trim();
    if (desc.length < 10) {
      return res.status(400).json({ message: "Please describe the job (at least 10 characters)" });
    }
    if (desc.length > 500) {
      return res.status(400).json({ message: "Description is too long (max 500 characters)" });
    }

    const profile = await ArtisanProfile.findOne({ _id: artisanId, status: "approved" }).populate(
      "user",
      "isActive blockedUsers"
    );
    if (!profile || !profile.user || !profile.user.isActive) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    // Blocked in either direction: look the same as "not found"
    const iBlockedThem = req.user.blockedUsers.some((id) => id.equals(profile.user._id));
    const theyBlockedMe = profile.user.blockedUsers.some((id) => id.equals(req.user._id));
    if (iBlockedThem || theyBlockedMe) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    if (!profile.isAvailable) {
      return res.status(400).json({ message: "This artisan is not taking bookings right now" });
    }

    const service = profile.services.id(serviceId);
    if (!service || !service.isActive) {
      return res.status(400).json({ message: "That service is no longer available" });
    }

    const unpaid = await Booking.countDocuments({
      user: req.user._id,
      status: "awaiting_payment",
      paymentDeadline: { $gt: new Date() },
    });
    if (unpaid >= 3) {
      return res.status(429).json({ message: "You have unpaid bookings. Pay for or cancel them first." });
    }

    const duration = service.durationMinutes || C.DEFAULT_DURATION_MINUTES;
    const slot = await checkSlot(profile, date, time, duration);
    if (!slot.ok) return res.status(400).json({ message: slot.message });

    const fees = calcFees(service.price);
    const booking = await Booking.create({
      user: req.user._id,
      artisan: profile._id,
      service: {
        serviceId: service._id,
        name: service.name,
        price: service.price,
        durationMinutes: duration,
      },
      date: new Date(`${date}T00:00:00.000Z`),
      time,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
       bufferMinutes: bufferFor(profile),
      description: desc,
      locationNote: String(locationNote || "").trim().slice(0, 150),
      price: service.price,
      status: "awaiting_payment",
      paymentDeadline: new Date(Date.now() + C.PAYMENT_WINDOW_MINUTES * 60 * 1000),
      statusHistory: [{ status: "awaiting_payment", by: req.user._id, note: "Booking created" }],
    });

        // Hold the time slot in the database, so two students can never get the same time
    let locked;
    try {
      locked = await acquireLocks(booking);
    } catch (err) {
      await Booking.deleteOne({ _id: booking._id });
      throw err;
    }
    if (!locked) {
      await Booking.deleteOne({ _id: booking._id });
      return res.status(409).json({ message: "That time was just taken. Please pick another." });
    }

    try {
      await Payment.create({
        booking: booking._id,
        user: req.user._id,
        artisan: profile._id,
        ...fees,
        status: "pending",
      });
    } catch (err) {
      await releaseLocks(booking._id);
      await Booking.findByIdAndDelete(booking._id); // don't leave a booking without a payment
      throw err;
    }

    res.status(201).json({
      message: "Booking created. Complete the payment to send it to the artisan.",
      booking: {
        id: booking._id,
        status: booking.status,
        date,
        time,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        service: booking.service,
        price: booking.price,
        paymentDeadline: booking.paymentDeadline,
      },
      payment: { amount: fees.amount },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/bookings?tab=upcoming|completed|cancelled&page=1
exports.listMyBookings = async (req, res, next) => {
  try {
    const tab = TAB_STATUSES[req.query.tab] ? req.query.tab : "upcoming";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { user: req.user._id, status: { $in: TAB_STATUSES[tab] } };

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ startsAt: tab === "upcoming" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateArtisan),
      Booking.countDocuments(filter),
    ]);

    res.json({
      tab,
      bookings: await withPayments(bookings),
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/bookings/stats
exports.myStats = async (req, res, next) => {
  try {
    const [active, completed, spentRows] = await Promise.all([
      Booking.countDocuments({ user: req.user._id, status: { $in: TAB_STATUSES.upcoming } }),
      Booking.countDocuments({ user: req.user._id, status: "confirmed" }),
      Payment.aggregate([
        {
          $match: {
            user: req.user._id,
            status: { $in: ["held", "released", "paid_out", "partially_refunded"] },
          },
        },
        { $group: { _id: null, total: { $sum: { $subtract: ["$amount", "$refundedAmount"] } } } },
      ]),
    ]);

    res.json({
      activeBookings: active,
      completedJobs: completed,
      totalSpent: spentRows[0] ? spentRows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/bookings/:id
exports.getBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const booking = await Booking.findOne({ _id: id, user: req.user._id }).populate(populateArtisan);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const [view] = await withPayments([booking]);
    res.json({ booking: view });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/bookings/:id/cancel
exports.cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const b = await Booking.findOne({ _id: id, user: req.user._id });
    if (!b) return res.status(404).json({ message: "Booking not found" });

    if (!["awaiting_payment", "pending", "accepted"].includes(b.status)) {
      return res.status(409).json({
        message: `A booking that is "${b.status.replace("_", " ")}" can't be cancelled`,
      });
    }
    if (b.status === "accepted" && b.startsAt <= new Date()) {
      return res.status(409).json({
        message: "The job time has passed. Tap Job done, or report a problem.",
      });
    }

    const wasPaid = b.status !== "awaiting_payment";
    const percent = wasPaid ? studentCancelPercent(b) : 0;
    const reason = String(req.body.reason || "").trim().slice(0, 300);

    const result = await move({
      id,
      owner: { user: req.user._id },
      from: [b.status],
      to: "cancelled",
      by: req.user._id,
      note: reason || "Cancelled by the student",
      set: {
        cancelledBy: req.user._id,
        cancelReason: reason,
        cancelledAt: new Date(),
        refundPercent: percent,
      },
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    if (wasPaid) {
      await refundPayment(b._id, percent);
      const ap = await ArtisanProfile.findById(b.artisan).select("user");
      if (ap) {
        notify(ap.user, {
          type: "booking_cancelled",
          title: "Booking cancelled",
          message: `${publicName(req.user.fullName)} cancelled the ${b.service.name} booking.`,
          link: `/artisan/bookings/${b._id}`,
        });
      }
    }

    res.json({
      message: wasPaid ? `Booking cancelled. ${percent}% will be refunded.` : "Booking cancelled",
      refundPercent: wasPaid ? percent : null,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/bookings/:id/confirm   ("Job done")
exports.confirmBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const b = await Booking.findOne({ _id: id, user: req.user._id });
    if (!b) return res.status(404).json({ message: "Booking not found" });

    const jobDone =
      b.status === "completed" || (b.status === "accepted" && b.startsAt <= new Date());
    if (!jobDone) {
      return res.status(409).json({
        message: "You can tap Job done once the artisan has finished, or after the scheduled time",
      });
    }

    const now = new Date();
    const set = { confirmedAt: now };
    if (b.status === "accepted") {
      // The artisan never marked it complete, so the report window starts now
      set.completedAt = now;
      set.disputeWindowEndsAt = new Date(now.getTime() + C.DISPUTE_WINDOW_HOURS * 60 * 60 * 1000);
    }

    const result = await move({
      id,
      owner: { user: req.user._id },
      from: [b.status],
      to: "confirmed",
      by: req.user._id,
      note: "The student confirmed the job is done",
      set,
    });
    if (!result.booking) return res.status(result.code).json({ message: result.message });

    await releasePayment(b._id);
    const ap = await ArtisanProfile.findByIdAndUpdate(b.artisan, { $inc: { jobsCompleted: 1 } });
    if (ap) {
      notify(ap.user, {
        type: "job_confirmed",
        title: "Job confirmed",
        message: `${publicName(req.user.fullName)} confirmed the ${b.service.name} job. Your payment is on its way.`,
        link: `/artisan/bookings/${b._id}`,
      });
    }

    res.json({
      message: "Thanks! The artisan will be paid once the report window closes.",
      disputeWindowEndsAt: result.booking.disputeWindowEndsAt,
    });
  } catch (err) {
    next(err);
  }
};

