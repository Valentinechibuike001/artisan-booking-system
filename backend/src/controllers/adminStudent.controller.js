const mongoose = require("mongoose");
const { User, Booking, Dispute, Report, Payment } = require("../models");
const { escapeRegex } = require("../utils/jobRoles");
const { dateKey } = require("../utils/time");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");

const NOT_FOUND = { message: "Student not found" };
const PAID = ["held", "released", "paid_out", "partially_refunded"];
const UNPAID = ["awaiting_payment", "expired"];

const row = (u) => ({
  id: u._id,
  name: u.fullName,
  email: u.email,
  phone: u.phone,
  hostel: u.hostel || null,
  isActive: u.isActive,
  emailVerified: u.isEmailVerified,
  joinedAt: u.createdAt,
  suspendedReason: u.suspendedReason || null,
});

// GET /api/admin/students?status=active|suspended&q=chinedu&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = { role: "user" };
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "suspended") filter.isActive = false;

    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }

    const [students, total, active, suspended] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("fullName email phone hostel isActive isEmailVerified createdAt suspendedReason"),
      User.countDocuments(filter),
      User.countDocuments({ role: "user", isActive: true }),
      User.countDocuments({ role: "user", isActive: false }),
    ]);

    res.json({
      students: students.map(row),
      counts: { active, suspended },
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/students/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const user = await User.findOne({ _id: id, role: "user" }).select(
      "fullName email phone hostel schoolEmail isActive isEmailVerified createdAt suspendedReason suspendedAt"
    );
    if (!user) return res.status(404).json(NOT_FOUND);

    const [bookings, completed, disputes, reportsAgainst, reportsMade, spentRows, recent] =
      await Promise.all([
        Booking.countDocuments({ user: user._id, status: { $nin: UNPAID } }),
        Booking.countDocuments({ user: user._id, status: "confirmed" }),
        Dispute.countDocuments({ raisedBy: user._id }),
        Report.countDocuments({ reportedUser: user._id }),
        Report.countDocuments({ reporter: user._id }),
        Payment.aggregate([
          { $match: { user: user._id, status: { $in: PAID } } },
          { $group: { _id: null, total: { $sum: { $subtract: ["$amount", "$refundedAmount"] } } } },
        ]),
        Booking.find({ user: user._id, status: { $nin: UNPAID } })
          .sort({ createdAt: -1 })
          .limit(5)
          .select("service price date time status"),
      ]);

    res.json({
      student: {
        ...row(user),
        schoolEmail: user.schoolEmail || null,
        suspendedAt: user.suspendedAt || null,
        stats: {
          bookings,
          completedJobs: completed,
          disputesRaised: disputes,
          reportsAgainst,
          reportsMade,
          totalSpent: spentRows[0] ? spentRows[0].total : 0,
        },
        recentBookings: recent.map((b) => ({
          id: b._id,
          serviceName: b.service ? b.service.name : null,
          price: b.price,
          date: dateKey(b.date),
          time: b.time,
          status: b.status,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/students/:id/suspend   { reason }
exports.suspend = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const reason = typeof (req.body || {}).reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 300) {
      return res.status(400).json({ message: "Please give a reason (10 to 300 characters)" });
    }

    const user = await User.findOneAndUpdate(
      { _id: id, role: "user", isActive: true },
      { $set: { isActive: false, suspendedReason: reason, suspendedAt: new Date() } },
      { new: true }
    );
    if (!user) {
      const found = await User.findOne({ _id: id, role: "user" }).select("_id");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: "This student is already suspended" });
    }

    notify(user._id, {
      type: "account_suspended",
      title: "Your account was suspended",
      message: `Reason: ${reason} Please contact support.`,
      allowInactive: true,
    });
    await logAction(req, "student.suspend", {
      targetType: "student",
      targetId: user._id,
      summary: `Suspended: ${reason}`,
    });

    res.json({ message: "Student suspended. They can no longer log in." });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/students/:id/reinstate
exports.reinstate = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const user = await User.findOneAndUpdate(
      { _id: id, role: "user", isActive: false },
      { $set: { isActive: true }, $unset: { suspendedReason: 1, suspendedAt: 1 } },
      { new: true }
    );
    if (!user) {
      const found = await User.findOne({ _id: id, role: "user" }).select("_id");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: "This student is not suspended" });
    }

    notify(user._id, {
      type: "account_reinstated",
      title: "Your account is active again",
      message: "Your suspension has been lifted. You can use UNN Artisans again.",
      link: "/",
    });
    await logAction(req, "student.reinstate", {
      targetType: "student",
      targetId: user._id,
      summary: "Reinstated",
    });

    res.json({ message: "Student reinstated" });
  } catch (err) {
    next(err);
  }
};