const mongoose = require("mongoose");
const { Booking, Payment, ArtisanProfile } = require("../models");
const { transition } = require("./bookingHelpers");
const { refundPayment } = require("./payments");
const { readMetadata } = require("./paystack");
const { publicName } = require("./artisanPublic");
const notify = require("./notify");

// "data" is Paystack's description of a successful payment
const processSuccessfulCharge = async (data) => {
  const bookingId = readMetadata(data).bookingId;
  if (!mongoose.isValidObjectId(bookingId)) return { outcome: "ignored" };

  const booking = await Booking.findById(bookingId).populate("user", "fullName");
  const payment = await Payment.findOne({ booking: bookingId });
  if (!booking || !payment) return { outcome: "ignored" };

  // Already handled (the webhook and the browser can both arrive)
  if (payment.status !== "pending") {
    return { outcome: "already_processed", bookingId, paymentStatus: payment.status };
  }

  // The amount paid must match what we expected
  const amountOk = Number(data.amount) === payment.amount * 100 && data.currency === "NGN";
  if (!amountOk) {
    console.error(`Payment mismatch for booking ${bookingId}:`, data.amount, data.currency);
    await Payment.updateOne(
      { _id: payment._id },
      { issue: `Amount mismatch: expected ${payment.amount * 100} kobo, got ${data.amount} ${data.currency}` }
    );
    return { outcome: "mismatch", bookingId, paymentStatus: "pending" };
  }

  // Claim the payment. Only one caller can win this.
  const now = new Date();
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "pending" },
    { status: "held", reference: data.reference, paidAt: now },
    { new: true }
  );
  if (!claimed) {
    return { outcome: "already_processed", bookingId, paymentStatus: "held" };
  }

  // Is the booking still waiting for this payment?
  const stillOpen = booking.status === "awaiting_payment" && booking.paymentDeadline > now;
  if (stillOpen) {
    const moved = await transition({
      id: booking._id,
      from: ["awaiting_payment"],
      to: "pending",
      by: booking.user._id,
      note: "Payment received",
      set: { paidAt: now },
    });

    if (moved) {
      const ap = await ArtisanProfile.findById(booking.artisan).select("user");
      if (ap) {
        notify(ap.user, {
          type: "booking_request",
          title: "New booking request",
          message: `${publicName(booking.user.fullName)} booked ${booking.service.name}.`,
          link: `/artisan/bookings/${booking._id}`,
        });
      }
      notify(booking.user._id, {
        type: "payment_received",
        title: "Payment received",
        message: `Your payment for ${booking.service.name} is held safely until the job is done.`,
        link: `/bookings/${booking._id}`,
      });
      return { outcome: "paid", bookingId, paymentStatus: "held" };
    }
  }

  // Too late, or the booking changed while the student was paying: give the money back
  await Payment.updateOne(
    { _id: claimed._id },
    { issue: "Paid after the booking expired or was cancelled. Refunded automatically." }
  );
  await refundPayment(booking._id, 100);
  notify(booking.user._id, {
    type: "payment_refunded",
    title: "Payment refunded",
    message: `Your payment for ${booking.service.name} arrived after the booking had closed, so it is being refunded in full.`,
    link: `/bookings/${booking._id}`,
  });
  return { outcome: "refunded", bookingId, paymentStatus: "refunded" };
};

module.exports = { processSuccessfulCharge };