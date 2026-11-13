const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema(
  {
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Payment" }],
    amount: { type: Number, required: true },
    paymentCount: { type: Number, default: 0 },

    // Bank details as they were when the payout was made
    bankName: String,
    bankCode: String,
    accountNumber: { type: String, select: false },
    accountLast4: String,

    status: { type: String, enum: ["pending", "paid", "cancelled"], default: "pending" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
    cancelledAt: Date,
    transferReference: String,
    note: String,
        // Result of asking the bank "whose account is this?"
    accountCheck: {
      status: { type: String, enum: ["match", "partial", "mismatch", "unavailable"] },
      accountName: String,
      bankMatched: String,
      reason: String,
      checkedAt: Date,
      checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
  },
  { timestamps: true }
);

payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ artisan: 1, createdAt: -1 });

module.exports = mongoose.model("Payout", payoutSchema);