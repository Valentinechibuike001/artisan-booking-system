const crypto = require("crypto");
const mongoose = require("mongoose");
const { User } = require("../models");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");

const LEVELS = ["super", "support"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_FOUND = { message: "Admin not found" };

const view = (u) => ({
  id: u._id,
  name: u.fullName,
  email: u.email,
  phone: u.phone,
  level: u.adminLevel || "super",
  isActive: u.isActive,
  createdAt: u.createdAt,
});


const otherSupers = (excludeId) =>
  User.countDocuments({
    role: "admin",
    isActive: true,
    adminLevel: { $ne: "support" },
    _id: { $ne: excludeId },
  });


exports.list = async (req, res, next) => {
  try {
    const admins = await User.find({ role: "admin" })
      .sort({ createdAt: 1 })
      .select("fullName email phone adminLevel isActive createdAt");
    res.json({ admins: admins.map(view) });
  } catch (err) {
    next(err);
  }
};


exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const level = body.level === undefined ? "support" : body.level;
    const phone =
      typeof body.phone === "string" && body.phone.trim() ? body.phone.trim().slice(0, 20) : "00000000000";

    if (fullName.length < 2 || fullName.length > 80) {
      return res.status(400).json({ message: "Please enter the person's name" });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: "Please enter a valid email" });
    if (!LEVELS.includes(level)) {
      return res.status(400).json({ message: "Level must be super or support" });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ message: "That email is already registered" });
    }

    
    const admin = await User.create({
      fullName,
      email,
      phone,
      password: crypto.randomBytes(24).toString("hex"),
      role: "admin",
      adminLevel: level,
      isEmailVerified: true,
    });

    notify(admin._id, {
      type: "admin_invited",
      title: "You were added as an admin",
      message: `You now have ${level} admin access. To choose your password, open the site, tap Forgot password and enter this email address.`,
      link: "/login",
      sendEmail: true,
    });
    await logAction(req, "admin.create", {
      targetType: "admin",
      targetId: admin._id,
      summary: `Added ${fullName} as ${level} admin`,
    });

    res.status(201).json({
      message: "Admin added. Ask them to tap Forgot password and use this email to set a password.",
      admin: view(admin),
    });
  } catch (err) {
    next(err);
  }
};


exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);
    if (String(id) === String(req.user._id)) {
      return res
        .status(400)
        .json({ message: "You can't change your own access. Ask another super admin." });
    }

    const body = req.body || {};
    if (body.level === undefined && body.isActive === undefined) {
      return res.status(400).json({ message: "Send level and/or isActive" });
    }
    if (body.level !== undefined && !LEVELS.includes(body.level)) {
      return res.status(400).json({ message: "Level must be super or support" });
    }
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be true or false" });
    }

    const admin = await User.findOne({ _id: id, role: "admin" });
    if (!admin) return res.status(404).json(NOT_FOUND);

   
    const isSuperNow = (admin.adminLevel || "super") === "super" && admin.isActive;
    const losingSuper = isSuperNow && (body.level === "support" || body.isActive === false);
    if (losingSuper && (await otherSupers(admin._id)) < 1) {
      return res.status(409).json({ message: "There must always be at least one active super admin" });
    }

    if (body.level !== undefined) admin.adminLevel = body.level;
    if (body.isActive !== undefined) admin.isActive = body.isActive;
    await admin.save();

    await logAction(req, "admin.update", {
      targetType: "admin",
      targetId: admin._id,
      summary: `Changed ${admin.fullName}`,
      meta: { level: body.level, isActive: body.isActive },
    });

    res.json({ message: "Admin updated", admin: view(admin) });
  } catch (err) {
    next(err);
  }
};