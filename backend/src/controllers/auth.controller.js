const { User, ArtisanProfile ,jobRole} = require("../models/index.js");
const { encrypt, hashValue } = require("../utils/encryption.js");
const { generateOtp, hashOtp, verifyOtpHash } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/sendEmail");
const signToken = require("../utils/token");
const C = require("../utils/constants");
const { needsTerms } = require("../utils/legal");
const { findRole } = require("../utils/jobRoles");
const notify = require("../utils/notify");
const { resolveBank } = require("../utils/banks");


const OTP_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES) || 10;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const CATEGORIES = ["Electrical", "Plumbing", "Baking", "Decor", "Repairs", "Beauty", "Other"];

const publicUser = (u) => ({
  id: u._id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  hostel: u.hostel,
  avatar: u.avatar && u.avatar.url ? u.avatar.url : null,
  adminLevel: u.role === "admin" ? u.adminLevel || "super" : undefined,
  needsTerms: needsTerms(u),
});

// Creates a code, stores its hash, emails the code
const issueOtp = async (user, purpose = "verify") => {
  const otp = generateOtp();
  user.otpHash = hashOtp(otp);
  user.otpExpires = new Date(Date.now() + OTP_MINUTES * 60 * 1000);
  user.otpAttempts = 0;
  user.otpLastSentAt = new Date();
  user.otpPurpose = purpose;
  await user.save();
  await sendOtpEmail(user.email, user.fullName, otp, purpose);
};
// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { role, fullName, phone, email, password, location, schoolEmail } = req.body;

    if (!["user", "artisan"].includes(role)) {
      return res.status(400).json({ message: "Role must be user or artisan" });
    }
    if (!fullName || !phone || !email || !password) {
      return res.status(400).json({ message: "Name, phone, email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
        if (req.body.acceptedTerms !== true) {
      return res.status(400).json({ message: "You must accept the Terms and Privacy Policy" });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(409).json({
        message: "This email is already registered. If you haven't verified it, use resend code.",
      });
    }

    // Validate artisan fields BEFORE creating anything
          // The job role must come from the admin's list (once the list has been set up)
      let jobTitle = String(occupation).trim();
      let jobCategory = CATEGORIES.includes(category) ? category : "Other";
      if ((await JobRole.countDocuments({ isActive: true })) > 0) {
        const jobRole = await findRole(jobTitle);
        if (!jobRole || !jobRole.isActive) {
          return res.status(400).json({ message: "Please choose your job role from the list" });
        }
        jobTitle = jobRole.name;
        jobCategory = jobRole.category;
      }
    let artisanData = null;
    if (role === "artisan") {
      const { nin, address, occupation, category, startingPrice, bankName,bankCode, accountNumber, bio } = req.body;

      if (!nin || !address || !occupation || !startingPrice || (!bankName && !bankCode)  || !accountNumber) {
        return res.status(400).json({ message: "Please fill all artisan details" });
      }
      if (!/^\d{11}$/.test(nin)) {
        return res.status(400).json({ message: "NIN must be 11 digits" });
      }
      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({ message: "Account number must be 10 digits" });
      }
      if (Number(startingPrice) <= 0) {
        return res.status(400).json({ message: "Starting price must be more than 0" });
      }
            const ninHash = hashValue(nin);
      if (await ArtisanProfile.findOne({ ninHash })) {
        return res.status(409).json({ message: "This NIN is already registered" });
      }

      const bank = await resolveBank({ bankCode, bankName });
      if (bank.error) return res.status(400).json({ message: bank.error });

      artisanData = {
        nin: encrypt(nin),
        ninHash,
        address,
         occupation: jobTitle,
        category: jobCategory,
        startingPrice: Number(startingPrice),
        bankName: bank.name,
        bankCode: bank.code,
        accountNumber,
        bio,
      };
    }

    const user = await User.create({
      fullName,
      phone,
      email,
      password,
      role,
      termsAcceptedAt: new Date(),
     termsVersion: C.LEGAL_VERSION,
      location: role === "user" ? location : undefined,
      schoolEmail: role === "user" ? schoolEmail : undefined,
    });

    if (artisanData) {
      try {
        await ArtisanProfile.create({ user: user._id, ...artisanData });
      } catch (err) {
        await User.findByIdAndDelete(user._id); // don't leave a half-made account
        throw err;
      }
    }

    let emailSent = true;
    try {
      await issueOtp(user);
    } catch (err) {
      console.error("OTP email failed:", err.message);
      emailSent = false;
    }

    res.status(201).json({
      message: emailSent
        ? "Account created. We sent a 6-digit code to your email."
        : "Account created, but we couldn't send the code. Tap resend code.",
      email: user.email,
      emailSent,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/verify-otp
exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and code are required" });

        const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+otpHash +otpExpires +otpAttempts +otpPurpose"
    );
    if (!user) return res.status(400).json({ message: "Invalid code" });

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Email already verified. Please log in." });
    }
    if (!user.otpHash || !user.otpExpires || user.otpPurpose !== "verify") {
      return res.status(400).json({ message: "No code found. Please request a new one." });
    }
    if (user.otpExpires < new Date()) {
      return res.status(400).json({ message: "Code expired. Please request a new one." });
    }
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: "Too many wrong attempts. Please request a new code." });
    }

    if (!verifyOtpHash(String(otp), user.otpHash)) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Invalid code" });
    }

    user.isEmailVerified = true;
    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

      if (user.role === "artisan") {
      notify.notifyAdmins({
        type: "artisan_pending",
        title: "New artisan to review",
        message: `${user.fullName} signed up and is waiting for approval.`,
        link: "/admin/artisans?status=pending",
      });
    }

    res.json({
      message: "Email verified",
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/resend-otp
exports.resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Same reply whether or not the email exists, so nobody can probe who has an account
    const genericReply = { message: "If that account needs verification, a new code has been sent." };

    const user = await User.findOne({ email: email.toLowerCase() }).select("+otpLastSentAt");
    if (!user || user.isEmailVerified) return res.json(genericReply);

    if (user.otpLastSentAt) {
      const secondsSince = (Date.now() - user.otpLastSentAt.getTime()) / 1000;
      if (secondsSince < RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince);
        return res.status(429).json({ message: `Please wait ${wait}s before asking for another code` });
      }
    }

    await issueOtp(user);
    res.json(genericReply);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: "This account has been disabled" });
    }
    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email first",
        needsVerification: true,
        email: user.email,
      });
    }

        // Remember this login (the last 10), so people can spot a stranger
    try {
      await User.updateOne(
        { _id: user._id },
        {
          $push: {
            loginHistory: {
              $each: [
                {
                  at: new Date(),
                  ip: req.ip,
                  device: String(req.headers["user-agent"] || "").slice(0, 150),
                },
              ],
              $slice: -10,
            },
          },
        }
      );
    } catch (err) {
      console.error("Could not save login history:", err.message);
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
exports.me = async (req, res, next) => {
  try {
    const data = { user: publicUser(req.user) };
    if (req.user.role === "artisan") {
      data.artisanProfile = await ArtisanProfile.findOne({ user: req.user._id });
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Same reply every time, so nobody can discover who has an account
    const genericReply = { message: "If that email has an account, we sent a reset code." };

    const user = await User.findOne({ email: email.toLowerCase() }).select("+otpLastSentAt");
    if (!user || !user.isEmailVerified || !user.isActive) return res.json(genericReply);

    if (user.otpLastSentAt) {
      const secondsSince = (Date.now() - user.otpLastSentAt.getTime()) / 1000;
      if (secondsSince < RESEND_COOLDOWN_SECONDS) return res.json(genericReply);
    }

    await issueOtp(user, "reset");
    res.json(genericReply);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Email, code and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+otpHash +otpExpires +otpAttempts +otpPurpose"
    );

    const invalid = { message: "Invalid or expired code" };
    if (!user || user.otpPurpose !== "reset" || !user.otpHash || !user.otpExpires) {
      return res.status(400).json(invalid);
    }
    if (user.otpExpires < new Date()) return res.status(400).json(invalid);
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: "Too many wrong attempts. Please request a new code." });
    }

    if (!verifyOtpHash(String(otp), user.otpHash)) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json(invalid);
    }

    user.password = newPassword; // the model hashes it automatically
    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    res.json({ message: "Password updated. Please log in with your new password." });
  } catch (err) {
    next(err);
  }
};