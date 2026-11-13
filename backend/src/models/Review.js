const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
    photos: [{ url: String, publicId: String }],

    artisanReply: { text: { type: String, trim: true }, repliedAt: Date },

    isHidden: { type: Boolean, default: false }, // admin moderation
     hiddenReason: String,
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    hiddenAt: Date,
     helpfulCount: { type: Number, default: 0 },
    helpfulBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], select: false },

    // An artisan can flag a review they think is unfair or fake
    flag: {
      reason: String,
      at: Date,
      resolved: Boolean,
    },



  },
  { timestamps: true }
);

reviewSchema.index({ artisan: 1, createdAt: -1 });

module.exports = mongoose.model("Review", reviewSchema);