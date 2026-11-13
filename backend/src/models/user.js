const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName:
     { 
      type: String,
       required: true, 
       trim: true
     },
    phone:
     {
       type: String,
        required: true,
         trim: true
     },
    email:
     {
       type: String,
       
       required: true,
        unique: true, 
        lowercase: true, 
        trim: true
       },
    password: 
    { 
      type: String, 
      required: true,
       minlength: 8, 
       select: false 
      },
    role:
     { 
      type: String,
       enum: ["user", "artisan", "admin"],
        default: "user"
       },

  
    location: { type: String, trim: true },
    schoolEmail: { type: String, lowercase: true, trim: true },
    savedArtisans: [{ type: mongoose.Schema.Types.ObjectId, ref: "ArtisanProfile" }],

    isActive: { type: Boolean, default: true },

     // Email verification (OTP)
    isEmailVerified: { type: Boolean, default: false },
    otpHash: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLastSentAt: { type: Date, select: false },
        otpPurpose: { type: String, enum: ["verify", "reset"], default: "verify", select: false },

    avatar: { url: String, publicId: String },

    // Terms and Privacy agreement
    termsAcceptedAt: { type: Date },

    // Users this person has blocked
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

        // Set when the password changes, so older login tokens can be rejected
    passwordChangedAt: { type: Date },
        // Set when an admin suspends the account
    suspendedReason: { type: String },
    suspendedAt: { type: Date },
       
    adminLevel: { type: String, enum: ["super", "support"] },

    emailPrefs: {
      reminders: { type: Boolean, default: true },
      bookingUpdates: { type: Boolean, default: true },
    },

    // The Terms and Privacy version this person accepted
    termsVersion: String,

    // Set when the person deletes their account (their details are erased)
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
        // Logging out everywhere: login tokens made before this moment stop working
    sessionsValidFrom: Date,

    // The last few logins, so people can spot a stranger
    loginHistory: [
      {
        at: { type: Date, default: Date.now },
        ip: String,
        device: String,
        _id: false,
      },
    ],

    // Changing email: the new address waits here until the code from its inbox is entered
    pendingEmail: { type: String, select: false },
    pendingEmailHash: { type: String, select: false },
    pendingEmailExpires: { type: Date, select: false },
    pendingEmailAttempts: { type: Number, default: 0, select: false },
    pendingEmailSentAt: { type: Date, select: false },
  },
  { timestamps: true }
);


userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("User", userSchema);