const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    artisan: { type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile", required: true },

    // Copy of the chosen service, so later edits don't change old bookings
        service: {
      serviceId: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      durationMinutes: { type: Number, required: true },
    },

    date: { type: Date, required: true },     // the day (midnight UTC of the Nigerian date)
    time: { type: String, required: true },   // "16:00"
    startsAt: { type: Date, required: true }, // the exact start moment
    endsAt: { type: Date }, // start + the service's duration
    bufferMinutes: Number, // the gap kept after this job (copied from the artisan when booked)
    description: { type: String, required: true, trim: true },
    locationNote: { type: String, trim: true }, // hostel and room
    price: { type: Number, required: true, min: 0 },

    // awaiting_payment -> pending -> accepted -> completed -> confirmed
    // side exits: expired, declined, cancelled, disputed
    status: {
      type: String,
      enum: [
        "awaiting_payment", "pending", "accepted", "completed",
        "confirmed", "declined", "cancelled", "expired", "disputed",
      ],
      default: "awaiting_payment",
    },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        note: String,
        _id: false,
      },
    ],

    paymentDeadline: Date,
    paidAt: Date,
    acceptedAt: Date,
    completedAt: Date,
    confirmedAt: Date,
    disputeWindowEndsAt: Date, // 48 hours after completedAt
    reminder24Sent: { type: Boolean, default: false },
    reminder2Sent: { type: Boolean, default: false },

    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: String,
    cancelledAt: Date,
    refundPercent: { type: Number, min: 0, max: 100 },
        reviewReminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

bookingSchema.index({ user: 1, status: 1 });
bookingSchema.index({ artisan: 1, status: 1 });
bookingSchema.index({ artisan: 1, startsAt: 1 });
bookingSchema.index({ status: 1, paymentDeadline: 1 });

module.exports = mongoose.model("Booking", bookingSchema);