const crypto = require("crypto");
const mongoose = require("mongoose");
const { Booking, Payment } = require("../models");
const paystack = require("../utils/paystack");
const { processSuccessfulCharge } = require("../utils/paymentProcessor");

const PAID_STATUSES = ["held", "released", "paid_out", "partially_refunded"];

// POST /api/user/bookings/:id/pay
exports.initiate = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const booking = await Booking.findOne({ _id: id, user: req.user._id });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.status !== "awaiting_payment") {
      return res.status(409).json({
        message: `This booking is "${booking.status.replace("_", " ")}", so it can't be paid for`,
      });
    }
    if (booking.paymentDeadline <= new Date()) {
      return res.status(410).json({ message: "Payment time ran out. Please book again." });
    }

    const payment = await Payment.findOne({ booking: booking._id, status: "pending" });
    if (!payment) return res.status(409).json({ message: "This booking has already been paid for" });

    const reference = `UNN-${booking._id}-${crypto.randomBytes(4).toString("hex")}`;
    const data = await paystack.initializeTransaction({
      email: req.user.email,
      amount: payment.amount,
      reference,
      callbackUrl: `${process.env.CLIENT_URL}/payment/callback`,
      metadata: { bookingId: String(booking._id), userId: String(req.user._id) },
    });

    res.json({
      authorizationUrl: data.authorization_url,
      reference: data.reference,
      paymentDeadline: booking.paymentDeadline,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/payments/verify?reference=...
exports.verify = async (req, res, next) => {
  try {
    const reference = String(req.query.reference || "").trim();
    if (!/^[\w-]{6,100}$/.test(reference)) {
      return res.status(400).json({ message: "A valid payment reference is required" });
    }

    const data = await paystack.verifyTransaction(reference);

    const bookingId = paystack.readMetadata(data).bookingId;
    const booking = mongoose.isValidObjectId(bookingId)
      ? await Booking.findOne({ _id: bookingId, user: req.user._id }).select("_id")
      : null;
    if (!booking) return res.status(404).json({ message: "Payment not found" });

    if (data.status !== "success") {
      return res.json({
        paid: false,
        paystackStatus: data.status,
        bookingId: booking._id,
        message: "We haven't received this payment yet.",
      });
    }

    const result = await processSuccessfulCharge(data);
    const paid = PAID_STATUSES.includes(result.paymentStatus);

    const messages = {
      paid: "Payment received. Your request has been sent to the artisan.",
      already_processed: paid
        ? "This payment was already confirmed."
        : "This payment was refunded.",
      refunded: "Your payment arrived after the booking time ran out, so we are refunding you in full.",
      mismatch: "The amount didn't match. Please contact support.",
      ignored: "We couldn't match this payment to a booking. Please contact support.",
    };

    res.json({
      paid,
      outcome: result.outcome,
      bookingId: booking._id,
      message: messages[result.outcome],
    });
  } catch (err) {
    next(err);
  }
};