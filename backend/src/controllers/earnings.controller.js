const { Payment, Payout } = require("../models");
const { payablePipeline, waitingPipeline } = require("../utils/payouts");
const { dateKey, buildStartsAt, todayWAT } = require("../utils/time");

const group = (field) => ({ $group: { _id: null, total: { $sum: field }, count: { $sum: 1 } } });
const first = (rows) => (rows[0] ? { amount: rows[0].total, count: rows[0].count } : { amount: 0, count: 0 });

// What an artisan reads about one payment
const stageOf = (p) => {
  if (p.status === "held") return "Held until the job is confirmed";
  if (p.status === "paid_out") return "Paid to your bank";
  if (p.status === "refunded") return "Refunded to the student";
  if (p.payout) return "Included in a payout";
  return "Confirmed, waiting to be paid";
};

// GET /api/artisan/earnings
exports.summary = async (req, res, next) => {
  try {
    const artisan = req.profile._id;
    const monthStart = buildStartsAt(`${todayWAT().slice(0, 7)}-01`, "00:00");

    const [held, waiting, ready, processing, paid, paidMonth] = await Promise.all([
      Payment.aggregate([{ $match: { artisan, status: "held" } }, group("$artisanAmount")]),
      Payment.aggregate([...waitingPipeline(artisan), group("$artisanAmount")]),
      Payment.aggregate([...payablePipeline(artisan), group("$artisanAmount")]),
      Payout.aggregate([{ $match: { artisan, status: "pending" } }, group("$amount")]),
      Payout.aggregate([{ $match: { artisan, status: "paid" } }, group("$amount")]),
      Payout.aggregate([
        { $match: { artisan, status: "paid", paidAt: { $gte: monthStart } } },
        group("$amount"),
      ]),
    ]);

    const result = {
      feePercent: Number(process.env.PLATFORM_FEE_PERCENT) || 10,
      heldUntilConfirmed: first(held),
      confirmedWaitingWindow: first(waiting),
      readyForPayout: first(ready),
      payoutProcessing: first(processing),
      paidToBank: first(paid),
      paidThisMonth: first(paidMonth),
    };
    result.totalEarned =
      result.heldUntilConfirmed.amount +
      result.confirmedWaitingWindow.amount +
      result.readyForPayout.amount +
      result.payoutProcessing.amount +
      result.paidToBank.amount;

    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/earnings/payments?page=1
exports.payments = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { artisan: req.profile._id, status: { $ne: "pending" } };

    const [items, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("booking", "service date time"),
      Payment.countDocuments(filter),
    ]);

    res.json({
      payments: items.map((p) => ({
        id: p._id,
        bookingId: p.booking ? p.booking._id : null,
        serviceName: p.booking && p.booking.service ? p.booking.service.name : null,
        date: p.booking && p.booking.date ? dateKey(p.booking.date) : null,
        studentPaid: p.amount,
        platformFee: p.platformFee,
        youEarn: p.artisanAmount,
        refundedAmount: p.refundedAmount || 0,
        status: p.status,
        stage: stageOf(p),
      })),
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/earnings/payouts?page=1
exports.payouts = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { artisan: req.profile._id, status: { $in: ["pending", "paid"] } };

    const [items, total] = await Promise.all([
      Payout.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Payout.countDocuments(filter),
    ]);

    res.json({
      payouts: items.map((p) => ({
        id: p._id,
        amount: p.amount,
        status: p.status === "paid" ? "paid" : "processing",
        paymentCount: p.paymentCount,
        bankName: p.bankName,
        accountLast4: p.accountLast4,
        createdAt: p.createdAt,
        paidAt: p.paidAt || null,
        transferReference: p.transferReference || null,
      })),
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};