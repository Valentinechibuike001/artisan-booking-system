const crypto = require("crypto");
const { User, ArtisanProfile, Booking, Dispute, Payment, Notification, RoleRequest } = require("../models");
const C = require("../utils/constants");
const signToken = require("../utils/token");
const notify = require("../utils/notify");
const { encrypt } = require("../utils/encryption");
const { acceptedVersion, needsTerms } = require("../utils/legal");
const { uploadImage, deleteImage } = require("../utils/imageUpload");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_BOOKING = ["pending", "accepted", "completed"];

// Takes text from a form. Anything that isn't text becomes null.
const text = (value) => (typeof value === "string" ? value.trim() : null);

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const prefsOf = (u) => ({
  reminders: !u.emailPrefs || u.emailPrefs.reminders !== false,
  bookingUpdates: !u.emailPrefs || u.emailPrefs.bookingUpdates !== false,
});

const profileView = (u) => ({
  id: u._id,
  role: u.role,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  hostel: u.hostel || null,
  schoolEmail: u.schoolEmail || null,
  avatar: u.avatar && u.avatar.url ? u.avatar.url : null,
  emailVerified: u.isEmailVerified,
  joinedAt: u.createdAt,
  preferences: prefsOf(u),
  legal: {
    acceptedVersion: acceptedVersion(u),
    currentVersion: C.LEGAL_VERSION,
    needsTerms: needsTerms(u),
  },
});

// GET /api/account/profile
exports.getProfile = (req, res) => {
  res.json({ profile: profileView(req.user) });
};

// PUT /api/account/profile   { fullName?, phone?, hostel?, schoolEmail? }
exports.updateProfile = async (req, res, next) => {
  try {
    const body = req.body || {};
    const user = await User.findById(req.user._id);

    if (body.fullName !== undefined) {
      if (user.role === "artisan") {
        return res
          .status(403)
          .json({ message: "Your name is linked to your NIN, so only our support team can change it." });
      }
      const name = text(body.fullName);
      if (!name || name.length < 2 || name.length > 80) {
        return res.status(400).json({ message: "Please enter your full name" });
      }
      user.fullName = name.replace(/\s+/g, " ");
    }

    if (body.phone !== undefined) {
      const phone = text(body.phone);
      const digits = phone ? phone.replace(/[\s-]/g, "") : "";
      if (!/^\+?\d{10,15}$/.test(digits)) {
        return res.status(400).json({ message: "Please enter a valid phone number" });
      }
      user.phone = digits;
    }

    // Hostel and school email belong to students only. Anyone else sending them is ignored.
    if (user.role === "user") {
      if (body.hostel !== undefined) {
        const hostel = text(body.hostel);
        if (hostel === null || hostel.length > 60) {
          return res.status(400).json({ message: "Hostel can be at most 60 characters" });
        }
        user.hostel = hostel || undefined;
      }

      if (body.schoolEmail !== undefined) {
        const schoolEmail = text(body.schoolEmail);
        if (schoolEmail === null || (schoolEmail && !EMAIL_RE.test(schoolEmail))) {
          return res.status(400).json({ message: "Please enter a valid school email" });
        }
        user.schoolEmail = schoolEmail ? schoolEmail.toLowerCase() : undefined;
      }
    }

    await user.save();
    res.json({ message: "Profile updated", profile: profileView(user) });
  } catch (err) {
    next(err);
  }
};

// POST /api/account/avatar   (students; form field: avatar)
exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Please choose an image" });

    const result = await uploadImage(req.file.buffer, "avatars", {
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const oldId = req.user.avatar && req.user.avatar.publicId;
    await User.updateOne({ _id: req.user._id }, { avatar: result });
    await deleteImage(oldId); // remove the old photo only after the new one is saved

    res.json({ message: "Photo updated", avatar: result.url });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/account/avatar   (students)
exports.removeAvatar = async (req, res, next) => {
  try {
    const oldId = req.user.avatar && req.user.avatar.publicId;
    await User.updateOne({ _id: req.user._id }, { $unset: { avatar: 1 } });
    await deleteImage(oldId);
    res.json({ message: "Photo removed" });
  } catch (err) {
    next(err);
  }
};

// PUT /api/account/password   { currentPassword, newPassword }
exports.changePassword = async (req, res, next) => {
  try {
    const body = req.body || {};
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Your current and new password are required" });
    }
    if (newPassword.length < C.PASSWORD_MIN || newPassword.length > C.PASSWORD_MAX) {
      return res.status(400).json({
        message: `Your new password must be ${C.PASSWORD_MIN} to ${C.PASSWORD_MAX} characters`,
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ message: "Your current password is wrong" });
    }
    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({ message: "Please choose a password you haven't used just now" });
    }

    user.password = newPassword; // the model hashes it and records the time of the change
    await user.save();

    notify(user._id, {
      type: "password_changed",
      title: "Your password was changed",
      message: "If this wasn't you, reset your password straight away using Forgot password, and contact support.",
      link: "/login",
    });

    // Every older login token now stops working. This device gets a fresh one.
    res.json({ message: "Password changed. Other devices were logged out.", token: signToken(user) });
  } catch (err) {
    next(err);
  }
};

// GET /api/account/preferences
exports.getPreferences = (req, res) => {
  res.json({
    preferences: prefsOf(req.user),
    alwaysOn: "Emails about payments, refunds, disputes, your account and security are always sent.",
  });
};

// PUT /api/account/preferences   { reminders?, bookingUpdates? }
exports.updatePreferences = async (req, res, next) => {
  try {
    const body = req.body || {};
    const set = {};

    for (const key of ["reminders", "bookingUpdates"]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean") {
        return res.status(400).json({ message: `${key} must be true or false` });
      }
      set[`emailPrefs.${key}`] = body[key];
    }
    if (Object.keys(set).length === 0) {
      return res.status(400).json({ message: "Send reminders and/or bookingUpdates" });
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true });
    res.json({ message: "Preferences saved", preferences: prefsOf(user) });
  } catch (err) {
    next(err);
  }
};

// POST /api/account/accept-terms   { accepted: true }
exports.acceptTerms = async (req, res, next) => {
  try {
    if ((req.body || {}).accepted !== true) {
      return res.status(400).json({ message: "Please accept the Terms and Privacy Policy to continue" });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $set: { termsVersion: C.LEGAL_VERSION, termsAcceptedAt: new Date() } }
    );
    res.json({ message: "Thank you", acceptedVersion: C.LEGAL_VERSION });
  } catch (err) {
    next(err);
  }
};

// Finds the reasons an account can't be deleted yet
const findBlockers = async (user) => {
  const now = new Date();
  const reasons = [];

  if (user.role === "user") {
    const [open, unpaid, windowOpen, disputes] = await Promise.all([
      Booking.countDocuments({ user: user._id, status: { $in: ACTIVE_BOOKING } }),
      Booking.countDocuments({ user: user._id, status: "awaiting_payment", paymentDeadline: { $gt: now } }),
      Booking.countDocuments({ user: user._id, status: "confirmed", disputeWindowEndsAt: { $gt: now } }),
      Dispute.countDocuments({ raisedBy: user._id, status: "open" }),
    ]);

    if (open) reasons.push(`You have ${plural(open, "booking")} in progress. Finish or cancel them first.`);
    if (unpaid) reasons.push(`You have ${plural(unpaid, "booking")} waiting for payment. Cancel them or wait for them to expire.`);
    if (windowOpen) reasons.push(`${plural(windowOpen, "job")} can still be reported for a problem. Try again in a couple of days.`);
    if (disputes) reasons.push(`You have ${plural(disputes, "open problem report")}. Wait until it is decided.`);
    return { reasons, profile: null };
  }

  const profile = await ArtisanProfile.findOne({ user: user._id });
  if (!profile) return { reasons, profile: null };

  const [open, windowOpen, disputes, owed] = await Promise.all([
    Booking.countDocuments({ artisan: profile._id, status: { $in: ACTIVE_BOOKING } }),
    Booking.countDocuments({ artisan: profile._id, status: "confirmed", disputeWindowEndsAt: { $gt: now } }),
    Dispute.countDocuments({ artisan: profile._id, status: "open" }),
    Payment.countDocuments({
      artisan: profile._id,
      $or: [
        { status: "held" },
        { status: { $in: ["released", "partially_refunded"] }, artisanAmount: { $gt: 0 } },
      ],
    }),
  ]);

  if (open) reasons.push(`You have ${plural(open, "job")} in progress. Finish or cancel them first.`);
  if (windowOpen) reasons.push(`${plural(windowOpen, "finished job")} can still be reported for a problem. Try again in a couple of days.`);
  if (disputes) reasons.push(`You have ${plural(disputes, "open dispute")}. Wait until it is decided.`);
  if (owed) reasons.push(`You still have money waiting to be paid out (${plural(owed, "payment")}). Wait until it reaches your bank.`);
  return { reasons, profile };
};

// DELETE /api/account   { password }
exports.deleteAccount = async (req, res, next) => {
  try {
    const password = typeof (req.body || {}).password === "string" ? req.body.password : "";
    if (!password) return res.status(400).json({ message: "Please enter your password to confirm" });

    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(password))) {
      return res.status(400).json({ message: "Your password is wrong" });
    }

    const { reasons, profile } = await findBlockers(user);
    if (reasons.length > 0) {
      return res.status(409).json({ message: "You can't delete your account yet", reasons });
    }

    // Erase the personal details. The account number of a person can never be used again.
    const oldAvatar = user.avatar && user.avatar.publicId;
    user.fullName = "Deleted";
    user.email = `deleted-${user._id}@deleted.invalid`;
    user.phone = "0";
    user.hostel = undefined;
    user.schoolEmail = undefined;
    user.avatar = undefined;
    user.password = crypto.randomBytes(24).toString("hex"); // an unknown password nobody can use
    user.savedArtisans = [];
    user.blockedUsers = [];
    user.isActive = false;
    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();

    const photoIds = new Set([oldAvatar]);

    if (profile) {
      (profile.portfolio || []).forEach((i) => photoIds.add(i.publicId));
      if (profile.avatar) photoIds.add(profile.avatar.publicId);

      await ArtisanProfile.updateOne(
        { _id: profile._id },
        {
          $set: {
            status: "suspended",
            suspensionReason: "Account deleted by the owner",
            isAvailable: false,
            bio: "",
            address: "Deleted",
            baseArea: "",
            serviceAreas: [],
            services: [],
            portfolio: [],
            nin: encrypt("00000000000"),
            bankName: "Deleted",
            accountNumber: "0000000000",
          },
          $unset: { ninHash: 1, avatar: 1 },
        }
      );
    }

    await Notification.deleteMany({ user: user._id });
    await RoleRequest.updateMany({ user: user._id, status: "pending" }, { $set: { status: "cancelled" } });
    await Promise.all([...photoIds].filter(Boolean).map((id) => deleteImage(id)));

    res.json({ message: "Your account was deleted. Goodbye, and thank you for using UNN Artisans." });
  } catch (err) {
    next(err);
  }
};