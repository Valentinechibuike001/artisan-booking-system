const { Payment } = require("../models");
const paystack = require("./paystack");

// References starting with DEV- come from our local test script, not from Paystack
const isTestReference = (ref) =>
  process.env.NODE_ENV !== "production" && typeof ref === "string" && ref.startsWith("DEV-");

// Splits a price into your fee and the artisan's share
const calcFees = (amount) => {
  const pct = Number(process.env.PLATFORM_FEE_PERCENT) || 10;
  const platformFee = Math.round((amount * pct) / 100);
  return { amount, platformFee, artisanAmount: amount - platformFee };
};

// Does the real work: refunds "refundedAmount" naira of a payment that is held
const applyRefund = async (payment, refundedAmount) => {
  const isFull = refundedAmount >= payment.amount;
  const kept = calcFees(payment.amount - refundedAmount);

  // Only one caller can flip "held", so we never refund twice
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "held" },
    {
      status: isFull ? "refunded" : "partially_refunded",
      refundedAmount,
      refundedAt: new Date(),
      platformFee: isFull ? 0 : kept.platformFee,
      artisanAmount: isFull ? 0 : kept.artisanAmount,
    },
    { new: true }
  );
  if (!updated) return null;

  // Now ask Paystack to really send the money back
  if (refundedAmount > 0 && !isTestReference(updated.reference)) {
    try {
      await paystack.refundTransaction(updated.reference, refundedAmount);
      updated.refundStatus = "requested";
    } catch (err) {
      updated.refundStatus = "failed";
      updated.refundError = String(err.detail || err.message).slice(0, 200);
    }
    await updated.save();
  }
  return updated;
};

// Refunds a percent (0 to 100) of a held payment
const refundPayment = async (bookingId, percent) => {
  const payment = await Payment.findOne({ booking: bookingId });
  if (!payment || payment.status !== "held") return null;
  return applyRefund(payment, Math.round((payment.amount * percent) / 100));
};

// Refunds an exact amount in naira of a held payment
const refundPaymentAmount = async (bookingId, refundedAmount) => {
  const payment = await Payment.findOne({ booking: bookingId });
  if (!payment || payment.status !== "held") return null;
  if (!Number.isInteger(refundedAmount) || refundedAmount < 0 || refundedAmount > payment.amount) {
    return null;
  }
  return applyRefund(payment, refundedAmount);
};

// The student confirmed the job: the money is now owed to the artisan
const releasePayment = (bookingId) =>
  Payment.findOneAndUpdate(
    { booking: bookingId, status: "held" },
    { status: "released", releasedAt: new Date() },
    { new: true }
  );

module.exports = { calcFees, refundPayment, refundPaymentAmount, releasePayment };