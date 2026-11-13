const mongoose = require("mongoose");

const roleRequestSchema = new mongoose.Schema(
  {
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    currentOccupation: String,
    currentCategory: String,
    requestedOccupation: { type: String, required: true, trim: true, maxlength: 40 },
    requestedCategory: String, // only filled when the role isn't on the admin's list
    reason: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    adminNote: { type: String, trim: true },
  },
  { timestamps: true }
);

roleRequestSchema.index({ status: 1, createdAt: 1 });
roleRequestSchema.index({ artisan: 1, createdAt: -1 });
// The database itself allows only ONE waiting request per artisan
roleRequestSchema.index({ artisan: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

module.exports = mongoose.model("RoleRequest", roleRequestSchema);