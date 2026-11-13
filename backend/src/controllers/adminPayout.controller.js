const mongoose = require("mongoose");
const { Payout, Payment, ArtisanProfile, User } = require("../models");
const C = require("../utils/constants");
const { payablePipeline } = require("../utils/payouts");
const { naira } = require("../utils/money");
const { dateKey } = require("../utils/time");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");
const paystack = require("../utils/paystack");
const { findBank, compareNames } = require("../utils/bankCheck");

const STATUSES = ["pending", "paid", "cancelled"];
const PAYABLE_STATUSES = ["released", "partially_refunded"];
const NOT_FOUND = { message: "Payout not found" };

const populateArtisan = {
  path: "artisan",
  select: "user",
  populate: { path: "user", select: "fullName phone" },
};

const readText = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const view = (p, withAccount = false) => ({
  id: p._id,
  status: p.status,
  amount: p.amount,
  paymentCount: p.paymentCount,
  artisan:
    p.artisan && p.artisan.user
      ? { id: p.artisan._id, name: p.artisan.user.fullName, phone: p.artisan.user.phone }
      : null,
  bank: {
    bankName: p.bankName,
    accountLast4: p.accountLast4,
    ...(withAccount ? { accountNumber: p.accountNumber } : {}),
  },
  createdAt: p.createdAt,
  paidAt: p.paidAt || null,
  cancelledAt: p.cancelledAt || null,
  transferReference: p.transferReference || null,
  note: p.note || null,
  accountCheck:
    p.accountCheck && p.accountCheck.status
      ? {
          status: p.accountCheck.status,
          accountName: p.accountCheck.accountName || null,
          reason: p.accountCheck.reason || null,
          checkedAt: p.accountCheck.checkedAt || null,
        }
      : null,
});

// Explains why a payout can't be changed
const explain = async (res, id, action) => {
  const found = await Payout.findById(id).select("status");
  if (!found) return res.status(404).json(NOT_FOUND);
  return res.status(409).json({ message: `This payout is "${found.status}", so it can't be ${action}` });
};

// GET /api/admin/payouts/payable   (who is ready to be paid)
exports.payable = async (req, res, next) => {
  try {
    const rows = await Payment.aggregate([
      ...payablePipeline(),
      {
        $group: {
          _id: "$artisan",
          count: { $sum: 1 },
          amount: { $sum: "$artisanAmount" },
          oldest: { $min: "$createdAt" },
        },
      },
      { $lookup: { from: "artisanprofiles", localField: "_id", foreignField: "_id", as: "profile" } },
      { $unwind: "$profile" },
      { $lookup: { from: "users", localField: "profile.user", foreignField: "_id", as: "owner" } },
      { $unwind: "$owner" },
      { $sort: { amount: -1 } },
      { $limit: 200 },
    ]);

    const artisans = rows.map((r) => ({
      artisanId: r._id,
      name: r.owner.fullName,
      phone: r.owner.phone,
      bankName: r.profile.bankName,
      accountLast4: String(r.profile.accountNumber || "").slice(-4),
      paymentCount: r.count,
      amount: r.amount,
      oldestPayment: r.oldest,
    }));

    res.json({
      artisans,
      totalAmount: artisans.reduce((sum, a) => sum + a.amount, 0),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payouts   { artisanId }
exports.create = async (req, res, next) => {
  try {
    const artisanId = (req.body || {}).artisanId;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const profile = await ArtisanProfile.findById(artisanId).select("+accountNumber");
    if (!profile) return res.status(404).json({ message: "Artisan not found" });

    const rows = await Payment.aggregate([
      ...payablePipeline(profile._id),
      { $project: { artisanAmount: 1 } },
    ]);
    if (rows.length === 0) {
      return res.status(409).json({ message: "Nothing is ready to pay out for this artisan yet" });
    }

    const ids = rows.map((r) => r._id);
    const amount = rows.reduce((sum, r) => sum + r.artisanAmount, 0);

    const payout = await Payout.create({
      artisan: profile._id,
      payments: ids,
      amount,
      paymentCount: ids.length,
      bankName: profile.bankName,
      bankCode: profile.bankCode,
      accountNumber: profile.accountNumber,
      accountLast4: String(profile.accountNumber).slice(-4),
      createdBy: req.user._id,
    });

    // Reserve those payments for this payout. If any were taken meanwhile, undo everything.
    const claimed = await Payment.updateMany(
      { _id: { $in: ids }, status: { $in: PAYABLE_STATUSES }, payout: { $exists: false } },
      { $set: { payout: payout._id } }
    );
    if (claimed.modifiedCount !== ids.length) {
      await Payment.updateMany({ payout: payout._id }, { $unset: { payout: 1 } });
      await Payout.deleteOne({ _id: payout._id });
      return res
        .status(409)
        .json({ message: "Some payments changed while the payout was being made. Please try again." });
    }

    await logAction(req, "payout.create", {
      targetType: "payout",
      targetId: payout._id,
      summary: `Payout of ${naira(amount)} created (${ids.length} payments)`,
    });

    res.status(201).json({
      message: "Payout created. Send the money, then mark it as paid.",
      payout: {
        ...view(payout, true),
        artisan: { id: profile._id },
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/payouts?status=pending&artisanId=...&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = {};
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (mongoose.isValidObjectId(req.query.artisanId)) filter.artisan = req.query.artisanId;

    const [payouts, total, countRows] = await Promise.all([
      Payout.find(filter)
        .sort({ createdAt: filter.status === "pending" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateArtisan),
      Payout.countDocuments(filter),
      Payout.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = { pending: 0, paid: 0, cancelled: 0 };
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    res.json({ payouts: payouts.map((p) => view(p)), counts, page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/payouts/:id  (shows the full account number)
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const payout = await Payout.findById(id).select("+accountNumber").populate(populateArtisan);
    if (!payout) return res.status(404).json(NOT_FOUND);

    const payments = await Payment.find({ payout: payout._id }).populate("booking", "service date time");

    await logAction(req, "payout.view_account", {
      targetType: "payout",
      targetId: payout._id,
      summary: "Opened a payout (full account number visible)",
    });

    res.json({
      payout: {
        ...view(payout, true),
        payments: payments.map((p) => ({
          id: p._id,
          bookingId: p.booking ? p.booking._id : null,
          serviceName: p.booking && p.booking.service ? p.booking.service.name : null,
          date: p.booking && p.booking.date ? dateKey(p.booking.date) : null,
          amountPaid: p.amount,
          refundedAmount: p.refundedAmount || 0,
          yourFee: p.platformFee,
          artisanAmount: p.artisanAmount,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payouts/:id/verify-account
exports.verifyAccount = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const payout = await Payout.findById(id).select("+accountNumber").populate(populateArtisan);
    if (!payout) return res.status(404).json(NOT_FOUND);
    if (payout.status !== "pending") {
      return res.status(409).json({ message: "Only a pending payout can be checked" });
    }

    const registered = payout.artisan && payout.artisan.user ? payout.artisan.user.fullName : "";

    let check;
    try {
       // If we saved the bank's code, use it. Otherwise find the bank by its name.
      const bank = payout.bankCode
        ? { code: payout.bankCode, name: payout.bankName }
        : findBank(await paystack.listBanks(), payout.bankName);
      if (!bank) {
        check = { status: "unavailable", reason: "Couldn't match the bank name to Paystack's bank list" };
      } else {
        const data = await paystack.resolveAccount(payout.accountNumber, bank.code);
        check = {
          status: compareNames(registered, data.account_name),
          accountName: data.account_name,
          bankMatched: bank.name,
        };
      }
    } catch (err) {
      check = { status: "unavailable", reason: String(err.detail || err.message).slice(0, 200) };
    }

    check.checkedAt = new Date();
    check.checkedBy = req.user._id;
    await Payout.updateOne({ _id: id, status: "pending" }, { $set: { accountCheck: check } });

    await logAction(req, "payout.verify_account", {
      targetType: "payout",
      targetId: payout._id,
      summary: `Account check: ${check.status}`,
    });

    const messages = {
      match: "The account name matches the artisan's name.",
      partial: "Only part of the name matches. Check with the artisan before paying.",
      mismatch: "The account name does NOT match the artisan's name.",
      unavailable: "We couldn't check this account.",
    };

    res.json({
      message: messages[check.status],
      accountCheck: {
        status: check.status,
        accountName: check.accountName || null,
        bankMatched: check.bankMatched || null,
        reason: check.reason || null,
        checkedAt: check.checkedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payouts/:id/mark-paid   { transferReference?, note?, confirmMismatch? }
exports.markPaid = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};
    const transferReference = readText(body.transferReference, 100);
    const note = readText(body.note, 200);

    // If the bank says the account belongs to someone else, make the admin confirm first
    const checked = await Payout.findOne({ _id: id, status: "pending" }).select("accountCheck createdBy amount");
    if (
      checked &&
      checked.accountCheck &&
      checked.accountCheck.status === "mismatch" &&
      body.confirmMismatch !== true
    ) {
      return res.status(409).json({
        message: `The bank says this account belongs to "${checked.accountCheck.accountName}", which doesn't match the artisan's name. Check with the artisan first, then send confirmMismatch: true.`,
        needsConfirmation: true,
      });
    }

        // A big payout needs a second pair of eyes: someone other than the person who created it
    if (
      checked &&
      checked.amount >= C.PAYOUT_TWO_PERSON_THRESHOLD &&
      String(checked.createdBy) === String(req.user._id)
    ) {
      const others = await User.countDocuments({
        role: "admin",
        isActive: true,
        adminLevel: { $ne: "support" },
        _id: { $ne: req.user._id },
      });
      if (others > 0) {
        return res.status(403).json({
          message: `Payouts of ${naira(C.PAYOUT_TWO_PERSON_THRESHOLD)} or more must be marked as paid by a different super admin than the one who created them.`,
          needsSecondApprover: true,
        });
      }
    }

    // Only a pending payout can be marked as paid, and only once
    const payout = await Payout.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status: "paid", paidBy: req.user._id, paidAt: new Date(), transferReference, note } },
      { new: true }
    ).populate(populateArtisan);
    if (!payout) return explain(res, id, "marked as paid");

    await Payment.updateMany(
      { payout: payout._id, status: { $in: PAYABLE_STATUSES } },
      { $set: { status: "paid_out" } }
    );

    if (payout.artisan && payout.artisan.user) {
      notify(payout.artisan.user._id, {
        type: "payout_sent",
        title: "Your payout was sent",
        message: `${naira(payout.amount)} was sent to your ${payout.bankName} account ending ${payout.accountLast4}.`,
        link: "/artisan/earnings",
      });
    }

    await logAction(req, "payout.paid", {
      targetType: "payout",
      targetId: payout._id,
      summary: `Payout of ${naira(payout.amount)} marked as paid`,
      meta: { transferReference },
    });

    res.json({ message: "Payout marked as paid. The artisan has been told.", payout: view(payout) });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/payouts/:id/cancel   { note? }
exports.cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const note = readText((req.body || {}).note, 200);

    const payout = await Payout.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status: "cancelled", cancelledAt: new Date(), note } },
      { new: true }
    );
    if (!payout) return explain(res, id, "cancelled");

    // The payments go back to the "ready to pay" pool
    await Payment.updateMany({ payout: payout._id }, { $unset: { payout: 1 } });

    await logAction(req, "payout.cancel", {
      targetType: "payout",
      targetId: payout._id,
      summary: `Payout of ${naira(payout.amount)} cancelled`,
      meta: { note },
    });

    res.json({ message: "Payout cancelled. Those payments are ready to be paid out again." });
  } catch (err) {
    next(err);
  }
};