const { Payment, Payout } = require("../models");
const C = require("../utils/constants");
const T = require("../utils/time");
const { sendCsv } = require("../utils/csv");
const { logAction } = require("../utils/audit");

const PAYMENT_STATUSES = ["held", "released", "paid_out", "refunded", "partially_refunded"];

const iso = (d) => (d ? d.toISOString() : "");

// GET /api/admin/payments/export?status=&from=2026-11-01&to=2026-11-30
exports.payments = async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if ((from && !T.isValidDateStr(from)) || (to && !T.isValidDateStr(to))) {
      return res.status(400).json({ message: "Dates must look like 2026-11-09" });
    }

    const filter = {
      status: PAYMENT_STATUSES.includes(req.query.status) ? req.query.status : { $ne: "pending" },
    };
    if (from || to) {
      filter.paidAt = {};
      if (from) filter.paidAt.$gte = T.buildStartsAt(from, "00:00");
      if (to) filter.paidAt.$lt = T.buildStartsAt(T.addDays(to, 1), "00:00");
    }

    const payments = await Payment.find(filter)
      .sort({ paidAt: -1, createdAt: -1 })
      .limit(C.EXPORT_MAX_ROWS)
      .populate("booking", "service")
      .populate("user", "fullName")
      .populate({ path: "artisan", select: "user", populate: { path: "user", select: "fullName" } });

    const headers = [
      "Paid at", "Reference", "Booking ID", "Service", "Student", "Artisan",
      "Amount paid", "Your fee", "Artisan share", "Refunded", "Status", "Refund status",
    ];
    const rows = payments.map((p) => [
      iso(p.paidAt),
      p.reference || "",
      p.booking ? p.booking._id : "",
      p.booking && p.booking.service ? p.booking.service.name : "",
      p.user ? p.user.fullName : "",
      p.artisan && p.artisan.user ? p.artisan.user.fullName : "",
      p.amount,
      p.platformFee,
      p.artisanAmount,
      p.refundedAmount || 0,
      p.status,
      p.refundStatus,
    ]);

    await logAction(req, "export.payments", {
      targetType: "export",
      summary: `Downloaded ${rows.length} payments`,
      meta: { from, to, status: req.query.status || null },
    });

    sendCsv(res, `payments-${T.todayWAT()}.csv`, headers, rows);
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/payouts/export?status=paid
exports.payouts = async (req, res, next) => {
  try {
    const filter = {};
    if (["pending", "paid", "cancelled"].includes(req.query.status)) filter.status = req.query.status;

    const payouts = await Payout.find(filter)
      .sort({ createdAt: -1 })
      .limit(C.EXPORT_MAX_ROWS)
      .populate({ path: "artisan", select: "user", populate: { path: "user", select: "fullName" } });

    const headers = [
      "Created", "Artisan", "Bank", "Account (last 4)", "Amount", "Jobs",
      "Status", "Paid at", "Transfer reference", "Note",
    ];
    const rows = payouts.map((p) => [
      iso(p.createdAt),
      p.artisan && p.artisan.user ? p.artisan.user.fullName : "",
      p.bankName || "",
      p.accountLast4 || "",
      p.amount,
      p.paymentCount,
      p.status,
      iso(p.paidAt),
      p.transferReference || "",
      p.note || "",
    ]);

    await logAction(req, "export.payouts", {
      targetType: "export",
      summary: `Downloaded ${rows.length} payouts`,
    });

    sendCsv(res, `payouts-${T.todayWAT()}.csv`, headers, rows);
  } catch (err) {
    next(err);
  }
};