const mongoose = require("mongoose");
const {
  User, ArtisanProfile, Booking, Dispute, Report, Payment, AuditLog, RoleRequest, Review,
} = require("../models");
const T = require("../utils/time");
const { isSuper } = require("../utils/adminLevel");

const DAY = 24 * 60 * 60 * 1000;

// GET /api/admin/dashboard
exports.stats = async (req, res, next) => {
  try {
    const superAdmin = isSuper(req.user);
    const dayStart = T.buildStartsAt(T.todayWAT(), "00:00");
    const dayEnd = new Date(dayStart.getTime() + DAY);

    const [
      pendingArtisans,
      approvedArtisans,
      suspendedArtisans,
      students,
      bookingsToday,
      jobsToday,
      openDisputes,
      openReports,
      pendingRoleRequests,
      flaggedReviews,
      money,
    ] = await Promise.all([
      ArtisanProfile.countDocuments({ status: "pending" }),
      ArtisanProfile.countDocuments({ status: "approved" }),
      ArtisanProfile.countDocuments({ status: "suspended" }),
      User.countDocuments({ role: "user" }),
      Booking.countDocuments({
        createdAt: { $gte: dayStart, $lt: dayEnd },
        status: { $nin: ["awaiting_payment", "expired"] },
      }),
      Booking.countDocuments({
        startsAt: { $gte: dayStart, $lt: dayEnd },
        status: { $in: ["pending", "accepted", "completed", "confirmed"] },
      }),
      Dispute.countDocuments({ status: "open" }),
      Report.countDocuments({ status: "open" }),
      RoleRequest.countDocuments({ status: "pending" }),
      Review.countDocuments({ "flag.reason": { $exists: true }, "flag.resolved": { $ne: true } }),
      // Support staff never get the money numbers
      superAdmin
        ? Payment.aggregate([
            { $match: { status: { $in: ["held", "released", "paid_out", "partially_refunded"] } } },
            {
              $group: {
                _id: "$status",
                fees: { $sum: "$platformFee" },
                artisan: { $sum: "$artisanAmount" },
              },
            },
          ])
        : Promise.resolve([]),
    ]);

    const data = {
      you: { level: superAdmin ? "super" : "support" },
      pendingArtisans,
      approvedArtisans,
      suspendedArtisans,
      students,
      bookingsToday,
      jobsToday,
      openDisputes,
      openReports,
      pendingRoleRequests,
      flaggedReviews,
    };

    if (superAdmin) {
      const byStatus = {};
      money.forEach((m) => (byStatus[m._id] = m));
      const sum = (statuses, field) =>
        statuses.reduce((total, s) => total + (byStatus[s] ? byStatus[s][field] : 0), 0);

      data.earnings = {
        earned: sum(["released", "paid_out", "partially_refunded"], "fees"),
        notYetEarned: sum(["held"], "fees"),
      };
      data.moneyHeld = sum(["held"], "fees") + sum(["held"], "artisan");
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/audit-logs?page=1&targetType=artisan&targetId=...
exports.auditLogs = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

    const filter = {};
    if (typeof req.query.targetType === "string" && req.query.targetType) {
      filter.targetType = req.query.targetType;
    }
    if (mongoose.isValidObjectId(req.query.targetId)) filter.targetId = req.query.targetId;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("admin", "fullName"),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      logs: logs.map((l) => ({
        id: l._id,
        admin: l.admin ? l.admin.fullName : null,
        action: l.action,
        targetType: l.targetType || null,
        targetId: l.targetId || null,
        summary: l.summary || "",
        meta: l.meta || null,
        createdAt: l.createdAt,
      })),
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};