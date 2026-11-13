const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },

    category: {
      type: String,
      enum: ["not_done", "poor_quality", "no_show", "overcharged", "damage", "other"],
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    evidence: [{ url: String, publicId: String }],

    // What the booking's status was before it became "disputed"
    bookingStatusBefore: String,

    artisanResponse: {
      text: { type: String, trim: true },
      respondedAt: Date,
      evidence: [{ url: String, publicId: String }],
    },

    status: { type: String, enum: ["open", "resolved"], default: "open" },
    resolution: { type: String, enum: ["refund_user", "pay_artisan", "split"] },
    refundAmount: { type: Number, default: 0 },
    adminNote: { type: String, trim: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    artisanNudged: { type: Boolean, default: false },
    adminNudged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ artisan: 1, createdAt: -1 });
disputeSchema.index({ raisedBy: 1, createdAt: -1 });

module.exports = mongoose.model("Dispute", disputeSchema);