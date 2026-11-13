const mongoose = require("mongoose");
const { Dispute, Booking, Payment, Message, ArtisanProfile } = require("../models");
const { releasePayment, refundPaymentAmount } = require("../utils/payments");
const { naira } = require("../utils/money");
const { dateKey } = require("../utils/time");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");
const { checkDisputeRate } = require("../utils/artisanRisk");
const { isSuper } = require("../utils/adminLevel");

const DECISIONS = ["refund_user", "pay_artisan", "split"];
const NOT_FOUND = { message: "Dispute not found" };
const HOUR = 60 * 60 * 1000;
const urls = (list) => (list || []).map((p) => p.url);

const listPopulate = [
  { path: "booking", select: "service price date time" },
  { path: "raisedBy", select: "fullName" },
  { path: "artisan", select: "user", populate: { path: "user", select: "fullName" } },
];

const row = (d) => ({
  id: d._id,
  status: d.status,
  category: d.category,
  createdAt: d.createdAt,
  hoursOpen: d.status === "open" ? Math.floor((Date.now() - d.createdAt.getTime()) / HOUR) : null,
  hasArtisanResponse: Boolean(d.artisanResponse && d.artisanResponse.text),
  decision: d.resolution || null,
  booking: d.booking
    ? {
        id: d.booking._id,
        serviceName: d.booking.service ? d.booking.service.name : null,
        price: d.booking.price,
        date: d.booking.date ? dateKey(d.booking.date) : null,
        time: d.booking.time || null,
      }
    : null,
  student: d.raisedBy ? d.raisedBy.fullName : null,
  artisan: d.artisan && d.artisan.user ? d.artisan.user.fullName : null,
});

// GET /api/admin/disputes?status=open|resolved&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const status = ["open", "resolved"].includes(req.query.status) ? req.query.status : null;
    const filter = status ? { status } : {};

    const [disputes, total, countRows] = await Promise.all([
      Dispute.find(filter)
        .sort({ createdAt: status === "open" ? 1 : -1 }) // open ones: longest-waiting first
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(listPopulate),
      Dispute.countDocuments(filter),
      Dispute.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = { open: 0, resolved: 0 };
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    res.json({ disputes: disputes.map(row), counts, page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/disputes/:id  (everything needed to decide, including the chat)
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const d = await Dispute.findById(id).populate([
      {
        path: "booking",
        select: "service price date time startsAt completedAt confirmedAt locationNote status statusHistory",
      },
      { path: "raisedBy", select: "fullName phone email" },
      { path: "artisan", select: "user occupation", populate: { path: "user", select: "fullName phone email" } },
    ]);
    if (!d || !d.booking || !d.raisedBy || !d.artisan || !d.artisan.user) {
      return res.status(404).json(NOT_FOUND);
    }

    const [payment, messages, studentDisputes, artisanDisputes] = await Promise.all([
      Payment.findOne({ booking: d.booking._id }),
      
      isSuper(req.user)
        ? Message.find({ booking: d.booking._id }).sort({ createdAt: 1 }).limit(100)
        : Promise.resolve([]),
      Dispute.countDocuments({ raisedBy: d.raisedBy._id }),
      Dispute.countDocuments({ artisan: d.artisan._id }),
    ]);

      if (isSuper(req.user)) {
      await logAction(req, "dispute.view_chat", {
        targetType: "dispute",
        targetId: d._id,
        summary: "Opened a dispute (the chat is visible)",
      });
    }
    res.json({
      dispute: {
        ...row(d),
        reason: d.reason,
        photos: urls(d.evidence),
        bookingStatusBefore: d.bookingStatusBefore || null,
        artisanResponse:
          d.artisanResponse && d.artisanResponse.text
            ? {
                text: d.artisanResponse.text,
                photos: urls(d.artisanResponse.evidence),
                respondedAt: d.artisanResponse.respondedAt,
              }
            : null,
        resolution:
          d.status === "resolved"
            ? {
                decision: d.resolution,
                refundAmount: d.refundAmount || 0,
                note: d.adminNote || null,
                resolvedAt: d.resolvedAt,
              }
            : null,
        student: {
          id: d.raisedBy._id,
          name: d.raisedBy.fullName,
          phone: d.raisedBy.phone,
          email: d.raisedBy.email,
          totalDisputes: studentDisputes,
        },
        artisanDetails: {
          id: d.artisan._id,
          name: d.artisan.user.fullName,
          phone: d.artisan.user.phone,
          email: d.artisan.user.email,
          occupation: d.artisan.occupation,
          totalDisputes: artisanDisputes,
        },
        bookingDetails: {
          status: d.booking.status,
          startsAt: d.booking.startsAt,
          completedAt: d.booking.completedAt || null,
          confirmedAt: d.booking.confirmedAt || null,
          locationNote: d.booking.locationNote || null,
          timeline: d.booking.statusHistory.map((h) => ({ status: h.status, at: h.at, note: h.note || null })),
        },
        payment: payment
          ? {
              id: payment._id,
              status: payment.status,
              amount: payment.amount,
              platformFee: payment.platformFee,
              artisanAmount: payment.artisanAmount,
              refundedAmount: payment.refundedAmount || 0,
              refundStatus: payment.refundStatus,
            }
          : null,
          canResolve: isSuper(req.user) && d.status === "open" && Boolean(payment) && payment.status === "held",
        chatHidden: !isSuper(req.user),
        chat: messages.map((m) => ({
          from: String(m.sender) === String(d.raisedBy._id) ? "student" : "artisan",
          text: m.text || "",
          image: m.image && m.image.url ? m.image.url : null,
          createdAt: m.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/disputes/:id/resolve   { decision, refundAmount?, note }
exports.resolve = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};

    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!DECISIONS.includes(decision)) {
      return res.status(400).json({ message: "Please choose a decision" });
    }

    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length < 10) {
      return res.status(400).json({ message: "Please explain your decision (at least 10 characters)" });
    }
    if (note.length > 500) {
      return res.status(400).json({ message: "The note can be at most 500 characters" });
    }

    const dispute = await Dispute.findById(id);
    if (!dispute) return res.status(404).json(NOT_FOUND);
    if (dispute.status !== "open") {
      return res.status(409).json({ message: "This dispute has already been resolved" });
    }

    const [booking, payment] = await Promise.all([
      Booking.findById(dispute.booking),
      Payment.findOne({ booking: dispute.booking }),
    ]);
    if (!booking || !payment) {
      return res.status(409).json({ message: "The booking or payment for this dispute is missing" });
    }
    if (payment.status !== "held") {
      return res.status(409).json({
        message: `The payment is "${payment.status}", not held, so it can't be decided here. Check the Payments page.`,
      });
    }

    // How much goes back to the student?
    let refundAmount = 0;
    if (decision === "refund_user") {
      refundAmount = payment.amount;
    } else if (decision === "split") {
      const given = body.refundAmount;
      const n = typeof given === "number" || typeof given === "string" ? Number(given) : NaN;
      if (!Number.isInteger(n) || n < 1 || n >= payment.amount) {
        return res.status(400).json({
          message: `For a split, the refund must be a whole number from 1 to ${payment.amount - 1}`,
        });
      }
      refundAmount = n;
    }

    // Claim the dispute first, so only one decision can ever be made
    const now = new Date();
    const claimed = await Dispute.findOneAndUpdate(
      { _id: dispute._id, status: "open" },
      {
        $set: {
          status: "resolved",
          resolution: decision,
          refundAmount,
          adminNote: note,
          resolvedBy: req.user._id,
          resolvedAt: now,
        },
      },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ message: "This dispute has already been resolved" });
    }

    // Now move the money
    const paymentResult =
      decision === "pay_artisan"
        ? await releasePayment(dispute.booking)
        : await refundPaymentAmount(dispute.booking, refundAmount);

    if (!paymentResult) {
      // The payment changed while we were working. Undo the decision.
      await Dispute.updateOne(
        { _id: dispute._id, status: "resolved", resolvedBy: req.user._id },
        {
          $set: { status: "open", refundAmount: 0 },
          $unset: { resolution: 1, adminNote: 1, resolvedBy: 1, resolvedAt: 1 },
        }
      );
      return res.status(409).json({
        message: "The payment changed while you were deciding. Nothing was changed. Please try again.",
      });
    }

    // Record it on the booking. A pay or split closes the report window, so the artisan can be paid.
    const label = {
      refund_user: "refunded to the student",
      pay_artisan: "paid to the artisan",
      split: "split between both",
    }[decision];
    const bookingUpdate = {
      $push: {
        statusHistory: { status: "disputed", at: now, by: req.user._id, note: `Dispute resolved: ${label}` },
      },
    };
    if (decision !== "refund_user") bookingUpdate.$set = { disputeWindowEndsAt: now };
    await Booking.updateOne({ _id: booking._id }, bookingUpdate);

    // Keep the artisan's "jobs completed" number honest
    const wasCounted = dispute.bookingStatusBefore === "confirmed";
    if (decision === "refund_user" && wasCounted) {
      await ArtisanProfile.updateOne(
        { _id: dispute.artisan, jobsCompleted: { $gt: 0 } },
        { $inc: { jobsCompleted: -1 } }
      );
    }
    if (decision !== "refund_user" && !wasCounted) {
      await ArtisanProfile.updateOne({ _id: dispute.artisan }, { $inc: { jobsCompleted: 1 } });
    }

    // Tell both people
    const messages = {
      refund_user: {
        student: `You will be refunded ${naira(refundAmount)} in full.`,
        artisan: "The payment was refunded to the student.",
      },
      pay_artisan: {
        student: "The payment will go to the artisan.",
        artisan: `${naira(paymentResult.artisanAmount)} will be included in your next payout.`,
      },
      split: {
        student: `You will be refunded ${naira(refundAmount)}. The rest goes to the artisan.`,
        artisan: `${naira(refundAmount)} was refunded to the student. Your share, ${naira(paymentResult.artisanAmount)}, will be included in your next payout.`,
      },
    }[decision];

    const artisanProfile = await ArtisanProfile.findById(dispute.artisan).select("user");
    notify(dispute.raisedBy, {
      type: "dispute_resolved",
      title: "Your report was decided",
      message: `${messages.student} Note from our team: ${note}`,
      link: `/disputes/${dispute._id}`,
    });
    if (artisanProfile) {
      notify(artisanProfile.user, {
        type: "dispute_resolved",
        title: "A dispute was decided",
        message: `${messages.artisan} Note from our team: ${note}`,
        link: `/artisan/disputes/${dispute._id}`,
      });
    }

    await logAction(req, "dispute.resolve", {
      targetType: "dispute",
      targetId: dispute._id,
      summary: `Decision: ${decision}`,
      meta: { decision, refundAmount, note },
    });
      if (decision === "refund_user") await checkDisputeRate(dispute.artisan);

    const refundFailed = paymentResult.refundStatus === "failed";
    res.json({
      message: "Dispute resolved",
      decision,
      refundAmount,
      artisanAmount: paymentResult.artisanAmount,
      yourFee: paymentResult.platformFee,
      refundStatus: paymentResult.refundStatus,
      warning: refundFailed
        ? "The decision is saved, but Paystack could not send the refund. Open Payments and tap Retry refund."
        : null,
    });
  } catch (err) {
    next(err);
  }
};