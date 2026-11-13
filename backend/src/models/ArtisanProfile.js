const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: String,
  caption: { type: String, trim: true },
});

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true, min: 0 },
  durationMinutes: { type: Number, default: 120, min: 30, max: 480 },
  isActive: { type: Boolean, default: true },
});

const dayScheduleSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    enabled: { type: Boolean, default: true },
    from: { type: String, default: "09:00" },
    to: { type: String, default: "17:00" },
  },
  { _id: false }
);

const artisanProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    nin: { type: String, required: true, select: false }, 
    ninHash: { type: String, unique: true, sparse: true, select: false }, 
    address: { type: String, required: true, trim: true },
    occupation: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["Electrical", "Plumbing", "Baking", "Decor", "Repairs", "Beauty", "Other"],
      default: "Other",
    },
    startingPrice: { type: Number, required: true, min: 0 },
    bio: { type: String, trim: true },

        baseArea: { type: String, trim: true },         
        serviceAreas: [{ type: String, trim: true }],     

    avatar: { url: String, publicId: String },
    portfolio: [imageSchema],
    services: [serviceSchema],

    bankName: { type: String, required: true },
     bankCode: { type: String },
    accountNumber: { type: String, required: true, select: false },

    
    isAvailable: { type: Boolean, default: true },
    bufferMinutes: { type: Number, default: 15, min: 0, max: 60 },
    weeklySchedule: { type: [dayScheduleSchema], default: [] },
    blockedDates: [{ type: Date }],

    
    status: { type: String, enum: ["pending", "approved", "rejected","suspended"], default: "pending" },
    ninVerified: { type: Boolean, default: false },
    addressVerified: { type: Boolean, default: false },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },


    suspensionReason: { type: String },
    roleHistory: [
      {
        from: String,
        to: String,
        fromCategory: String,
        toCategory: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
        note: String,
        _id: false,
      },
    ],

    // Calculated
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
  },
  { timestamps: true }
);

artisanProfileSchema.index({ occupation: "text", bio: "text", "services.name": "text" });
artisanProfileSchema.index({ status: 1, category: 1, ratingAverage: -1 });

module.exports = mongoose.model("ArtisanProfile", artisanProfileSchema);