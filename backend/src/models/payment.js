const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },

    amount: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    artisanAmount: { type: Number, required: true },

    status: {
      type: String,
       enum: ["pending", "held", "released", "paid_out", "refunded", "partially_refunded"],
    },

    reference: { type: String, unique: true, sparse: true }, // Paystack reference
    paidAt: Date,
    releasedAt: Date,

    refundedAmount: { type: Number, default: 0 },
    refundedAt: Date,

    payout: { type: mongoose.Schema.Types.ObjectId, ref: "Payout" },

        // Did the money-back request reach Paystack?
    refundStatus: { type: String, enum: ["none", "requested", "failed"], default: "none" },
    refundError: String,

    // Anything odd the admin should look at
    issue: String,
  },
  { timestamps: true }

    
);

module.exports = mongoose.model("Payment", paymentSchema);