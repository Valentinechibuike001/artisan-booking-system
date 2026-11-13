const mongoose = require("mongoose");
const { Booking, Payment, Payout } = require("../models");
const { populateArtisan, populateStudent } = require("../utils/bookingHelpers");
const { publicName } = require("../utils/artisanPublic");
const { dateKey } = require("../utils/time");

const NOT_FOUND = { message: "Booking not found" };
const NO_RECEIPT = { message: "There is no receipt for this booking yet" };

// UNN-5F3A9C21, made from the end of the booking's ID, so it never changes
const receiptNumber = (bookingId) => `UNN-${String(bookingId).slice(-8).toUpperCase()}`;

// GET /api/user/bookings/:id/receipt
exports.userReceipt = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const booking = await Booking.findOne({ _id: id, user: req.user._id }).populate(populateArtisan);
    if (!booking) return res.status(404).json(NOT_FOUND);

    const payment = await Payment.findOne({ booking: booking._id });
    if (!payment || !payment.paidAt) return res.status(404).json(NO_RECEIPT);

    const artisan = booking.artisan;
    const owner = artisan && artisan.user;
    const refunded = payment.refundedAmount || 0;

    res.json({
      receipt: {
        number: receiptNumber(booking._id),
        issuedAt: payment.paidAt,
        student: { name: req.user.fullName, email: req.user.email },
        artisan: {
          name: publicName(owner ? owner.fullName : ""),
          occupation: artisan ? artisan.occupation : null,
        },
        service: {
          name: booking.service.name,
          durationMinutes: booking.service.durationMinutes || null,
        },
        date: dateKey(booking.date),
        time: booking.time,
        location: booking.locationNote || null,
        amountPaid: payment.amount,
        refundedAmount: refunded,
        netPaid: payment.amount - refunded,
        paymentStatus: payment.status,
        paymentReference: payment.reference || null,
        bookingStatus: booking.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/bookings/:id/statement
exports.artisanStatement = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const booking = await Booking.findOne({ _id: id, artisan: req.profile._id }).populate(populateStudent);
    if (!booking) return res.status(404).json(NOT_FOUND);

    const payment = await Payment.findOne({ booking: booking._id });
    if (!payment || !payment.paidAt) return res.status(404).json(NO_RECEIPT);

    const payout = payment.payout
      ? await Payout.findById(payment.payout).select("status paidAt transferReference bankName accountLast4")
      : null;

    res.json({
      statement: {
        number: receiptNumber(booking._id),
        issuedAt: payment.paidAt,
        student: publicName(booking.user ? booking.user.fullName : ""),
        service: booking.service.name,
        date: dateKey(booking.date),
        time: booking.time,
        studentPaid: payment.amount,
        refundedAmount: payment.refundedAmount || 0,
        platformFee: payment.platformFee,
        feePercent: Number(process.env.PLATFORM_FEE_PERCENT) || 10,
        youEarn: payment.artisanAmount,
        paymentStatus: payment.status,
        payout: payout
          ? {
              status: payout.status === "paid" ? "paid" : "processing",
              paidAt: payout.paidAt || null,
              reference: payout.transferReference || null,
              bankName: payout.bankName,
              accountLast4: payout.accountLast4,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};
