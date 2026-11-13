const { User } = require("../models");
const signToken = require("../utils/token");
const { generateOtp, hashOtp, verifyOtpHash } = require("../utils/otp");
const { sendOtpEmail, sendNotificationEmail } = require("../utils/sendEmail");

const OTP_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES) || 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/account/sessions   (the last logins)
exports.sessions = (req, res) => {
  const logins = [...(req.user.loginHistory || [])]
    .reverse() // newest first
    .map((h) => ({ at: h.at, ip: h.ip || null, device: h.device || null }));

  res.json({
    logins,
    tip: "If you see a login you don't recognise, change your password and tap Log out everywhere.",
  });
};

// POST /api/account/logout-all
exports.logoutAll = async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { sessionsValidFrom: new Date() } });

    // Every older login stops working. This device gets a fresh one.
    res.json({
      message: "You were logged out of all other devices.",
      token: signToken(req.user),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/account/email/request   { newEmail, password }
exports.requestEmailChange = async (req, res, next) => {
  try {
    const body = req.body || {};
    const password = typeof body.password === "string" ? body.password : "";
    const newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";

    if (!password || !newEmail) {
      return res.status(400).json({ message: "Your password and the new email are required" });
    }
    if (!EMAIL_RE.test(newEmail) || newEmail.length > 120) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    const user = await User.findById(req.user._id).select("+password +pendingEmailSentAt");
    if (!(await user.comparePassword(password))) {
      return res.status(400).json({ message: "Your password is wrong" });
    }
    if (newEmail === user.email) {
      return res.status(400).json({ message: "That is already your email" });
    }
    if (await User.exists({ email: newEmail })) {
      return res.status(409).json({ message: "That email is already registered" });
    }

    if (user.pendingEmailSentAt) {
      const seconds = (Date.now() - user.pendingEmailSentAt.getTime()) / 1000;
      if (seconds < RESEND_SECONDS) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(RESEND_SECONDS - seconds)}s before asking for another code`,
        });
      }
    }

    const otp = generateOtp();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          pendingEmail: newEmail,
          pendingEmailHash: hashOtp(otp),
          pendingEmailExpires: new Date(Date.now() + OTP_MINUTES * 60 * 1000),
          pendingEmailAttempts: 0,
          pendingEmailSentAt: new Date(),
        },
      }
    );

    try {
      await sendOtpEmail(newEmail, user.fullName, otp, "email_change");
    } catch (err) {
      console.error("Email change code failed:", err.message);
      await User.updateOne(
        { _id: user._id },
        { $unset: { pendingEmail: 1, pendingEmailHash: 1, pendingEmailExpires: 1, pendingEmailSentAt: 1 } }
      );
      return res.status(502).json({ message: "We couldn't send the code. Please try again." });
    }

    res.json({ message: `We sent a 6-digit code to ${newEmail}. It expires in ${OTP_MINUTES} minutes.` });
  } catch (err) {
    next(err);
  }
};

// POST /api/account/email/confirm   { otp }
exports.confirmEmailChange = async (req, res, next) => {
  try {
    const otp = String((req.body || {}).otp ?? "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "Please enter the 6-digit code" });
    }

    const user = await User.findById(req.user._id).select(
      "+pendingEmail +pendingEmailHash +pendingEmailExpires +pendingEmailAttempts"
    );
    if (!user.pendingEmail || !user.pendingEmailHash || !user.pendingEmailExpires) {
      return res.status(400).json({ message: "No email change is waiting. Please start again." });
    }
    if (user.pendingEmailExpires < new Date()) {
      return res.status(400).json({ message: "That code has expired. Please start again." });
    }
    if (user.pendingEmailAttempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ message: "Too many wrong attempts. Please start again." });
    }

    if (!verifyOtpHash(otp, user.pendingEmailHash)) {
      await User.updateOne({ _id: user._id }, { $inc: { pendingEmailAttempts: 1 } });
      return res.status(400).json({ message: "That code is wrong" });
    }

    const oldEmail = user.email;
    const newEmail = user.pendingEmail;

    try {
      await User.updateOne(
        { _id: user._id },
        {
          $set: { email: newEmail, isEmailVerified: true, sessionsValidFrom: new Date() },
          $unset: {
            pendingEmail: 1,
            pendingEmailHash: 1,
            pendingEmailExpires: 1,
            pendingEmailSentAt: 1,
            pendingEmailAttempts: 1,
          },
        }
      );
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: "That email was just taken by someone else" });
      }
      throw err;
    }

    // Warn the OLD address, in case someone else did this
    if (!/@sample\.test$/i.test(oldEmail)) {
      try {
        await sendNotificationEmail(oldEmail, user.fullName, {
          title: "Your email address was changed",
          message: `The email on your UNN Artisans account was changed to ${newEmail}. If this wasn't you, contact support straight away.`,
          link: "/login",
        });
      } catch (err) {
        console.error("Could not warn the old email:", err.message);
      }
    }

    res.json({
      message: "Your email was changed. Other devices were logged out.",
      email: newEmail,
      token: signToken(user),
    });
  } catch (err) {
    next(err);
  }
};