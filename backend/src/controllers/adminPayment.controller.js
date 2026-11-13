const mongoose = require("mongoose");
const { Payment, Payout } = require("../models");
const paystack = require("../utils/paystack");
const { payablePipeline, waitingPipeline } = require("../utils/payouts");
const { escapeRegex } = require("../utils/jobRoles");
const { logAction } = require("../utils/audit");
const { dateKey } = require("../utils/time");

const STATUSES = ["pending", "held", "released", "paid_out", "refunded", "partially_refunded"];
const NOT_FOUND = { message: "Payment not found" };

const populateAll = [
  { path: "booking", select: "service date time status" },
  { path: "user", select: "fullName" },
  { path: "artisan", select: "user", populate: { path: "user", select: "fullName" } },
];

const row = (p) => ({
  id: p._id,
  status: p.status,
  amount: p.amount,
  platformFee: p.platformFee,
  artisanAmount: p.artisanAmount,
  refundedAmount: p.refundedAmount || 0,
  refundStatus: p.refundStatus,
  hasIssue: Boolean(p.issue),
  reference: p.reference || null,
  paidAt: p.paidAt || null,
  createdAt: p.createdAt,
  booking: p.booking
    ? {
        id: p.booking._id,
        serviceName: p.booking.service ? p.booking.service.name : null,
        date: p.booking.date ? dateKey(p.booking.date) : null,
        time: p.booking.time || null,
        status: p.booking.status,
      }
    : null,
  student: p.user ? p.user.fullName : null,
  artisan: p.artisan && p.artisan.user ? p.artisan.user.fullName : null,
});

// GET /api/admin/payments/summary
exports.summary = async (req, res, next) => {
  try {
    const empty = { count: 0, amount: 0 };

    const [byStatus, ready, waiting, payoutRows, refunds, failedRefunds, withIssues] = await Promise.all([
      Payment.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
            fee: { $sum: "$platformFee" },
            artisan: { $sum: "$artisanAmount" },
          },
        },
      ]),
      Payment.aggregate([
        ...payablePipeline(),
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$artisanAmount" } } },
      ]),
      Payment.aggregate([
        ...waitingPipeline(),
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$artisanAmount" } } },
      ]),
      Payout.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
      Payment.aggregate([
        { $match: { refundedAmount: { $gt: 0 } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$refundedAmount" } } },
      ]),
      Payment.countDocuments({ refundStatus: "failed" }),
      Payment.countDocuments({ issue: { $exists: true } }),
    ]);

    const status = (key) =>
      byStatus.find((r) => r._id === key) || { count: 0, amount: 0, fee: 0, artisan: 0 };
    const payout = (key) => payoutRows.find((r) => r._id === key) || empty;
    const one = (rows) => (rows[0] ? { count: rows[0].count, amount: rows[0].amount } : empty);

    const held = status("held");

    res.json({
      held: { count: held.count, amount: held.amount, yourFee: held.fee, artisanShare: held.artisan },
      waitingForWindow: one(waiting),
      readyForPayout: one(ready),
      inPendingPayouts: payout("pending"),
      paidOut: payout("paid"),
      refunded: one(refunds),
      fees: {
        earned: status("released").fee + status("partially_refunded").fee + status("paid_out").fee,
        pending: held.fee,
      },
      problems: { failedRefunds, withIssues },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/payments?status=held&problems=true&q=reference&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = {};
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    else filter.status = { $ne: "pending" }; // unpaid ones are hidden unless you ask

    if (req.query.problems === "true") {
      filter.$or = [{ refundStatus: "failed" }, { issue: { $exists: true } }];
    }

    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q) filter.reference = { $regex: escapeRegex(q), $options: "i" };

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateAll),
      Payment.countDocuments(filter),
    ]);

    res.json({ payments: payments.map(row), page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/payments/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const payment = await Payment.findById(id).populate(populateAll);
    if (!payment) return res.status(404).json(NOT_FOUND);

    res.json({
      payment: {
        ...row(payment),
        refundError: payment.refundError || null,
        issue: payment.issue || null,
        releasedAt: payment.releasedAt || null,
        refundedAt: payment.refundedAt || null,
        payoutId: payment.payout || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payments/:id/retry-refund
exports.retryRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    // Claim it, so two taps can't send two refunds
    const claimed = await Payment.findOneAndUpdate(
      { _id: id, refundStatus: "failed" },
      { $set: { refundStatus: "requested" }, $unset: { refundError: 1 } },
      { new: true }
    );
    if (!claimed) {
      const found = await Payment.findById(id).select("_id");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: "This payment has no failed refund to retry" });
    }

    try {
      await paystack.refundTransaction(claimed.reference, claimed.refundedAmount);
    } catch (err) {
      const reason = String(err.detail || err.message).slice(0, 200);
      await Payment.updateOne({ _id: id }, { $set: { refundStatus: "failed", refundError: reason } });
      await logAction(req, "payment.retry_refund_failed", {
        targetType: "payment",
        targetId: claimed._id,
        summary: `Refund retry failed: ${reason}`,
      });
      return res.status(502).json({ message: "Paystack still refused the refund", reason });
    }

    await logAction(req, "payment.retry_refund", {
      targetType: "payment",
      targetId: claimed._id,
      summary: `Refund of ${claimed.refundedAmount} sent to Paystack again`,
    });

    res.json({ message: "Refund sent to Paystack", refundStatus: "requested" });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payments/:id/refund-handled   { note }
exports.refundHandled = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const note = typeof (req.body || {}).note === "string" ? req.body.note.trim() : "";
    if (note.length < 5 || note.length > 200) {
      return res.status(400).json({ message: "Please say how it was handled (5 to 200 characters)" });
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: id, refundStatus: "failed" },
      { $set: { refundStatus: "requested" }, $unset: { refundError: 1 } },
      { new: true }
    );
    if (!updated) {
      const found = await Payment.findById(id).select("_id");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: "This payment has no failed refund" });
    }

    await logAction(req, "payment.refund_handled", {
      targetType: "payment",
      targetId: updated._id,
      summary: `Refund handled manually: ${note}`,
    });

    res.json({ message: "Marked as handled", refundStatus: updated.refundStatus });
  } catch (err) {
    next(err);
  }
};