const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    message: { type: mongoose.Schema.Types.ObjectId, ref: "Message" }, // set when a chat message was reported
    reason: {
      type: String,
      enum: ["fake_profile", "unsafe_behaviour", "harassment", "scam", "inappropriate_message", "other"],
      required: true,
    },
    details: { type: String, trim: true },

    status: { type: String, enum: ["open", "reviewed", "action_taken", "dismissed"], default: "open" },
    adminNote: { type: String, trim: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    adminNudged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: 1 });
reportSchema.index({ reportedUser: 1 });

module.exports = mongoose.model("Report", reportSchema);