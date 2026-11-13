require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const { Payment } = require("../models");

(async () => {
  try {
    if (process.env.NODE_ENV === "production") {
      console.log("Not allowed in production");
      process.exit(1);
    }

    const bookingId = process.argv[2];
    if (!mongoose.isValidObjectId(bookingId)) {
      console.log('Usage: npm run dev:fakepay -- "<bookingId>"');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    const payment = await Payment.findOne({ booking: bookingId });
    if (!payment) {
      console.log("No payment found for that booking");
      process.exit(1);
    }

    const body = JSON.stringify({
      event: "charge.success",
      data: {
        status: "success",
        reference: `DEV-${Date.now()}`,
        amount: payment.amount * 100,
        currency: "NGN",
        metadata: { bookingId: String(bookingId) },
      },
    });

    const signature = crypto
      .createHmac("sha512", require("../utils/paystack").getSecretKey())
      .update(body)
      .digest("hex");

    const res = await fetch(`http://localhost:${process.env.PORT || 5000}/api/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
      body,
    });

    console.log("Webhook replied with status", res.status);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();