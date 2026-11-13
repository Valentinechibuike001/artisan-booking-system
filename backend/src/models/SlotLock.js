const mongoose = require("mongoose");

const slotLockSchema = new mongoose.Schema(
  {
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },
    slot: { type: Date, required: true }, // the start of one 15-minute block
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
  },
  { timestamps: true }
);

// The database refuses a second lock on the same block for the same artisan
slotLockSchema.index({ artisan: 1, slot: 1 }, { unique: true });
slotLockSchema.index({ booking: 1 });
// Old locks delete themselves 7 days after their time slot
slotLockSchema.index({ slot: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("SlotLock", slotLockSchema);