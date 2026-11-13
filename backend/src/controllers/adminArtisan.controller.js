const mongoose = require("mongoose");
const { ArtisanProfile, Booking, Dispute, Report } = require("../models");
const C = require("../utils/constants");
const { decrypt } = require("../utils/encryption");
const { logAction } = require("../utils/audit");
const { cleanName, findRole, escapeRegex } = require("../utils/jobRoles");
const notify = require("../utils/notify");
const { profileChecklist } = require("../utils/profileChecklist");
const { isSuper } = require("../utils/adminLevel");
const { resolveRole, applyRole } = require("../utils/roleChange");

const STATUSES = ["pending", "approved", "rejected", "suspended"];
const NOT_FOUND = { message: "Artisan not found" };
const imageOf = (a) => (a && a.url ? a.url : null);

// Reads the "reason" box: 10 to 300 characters
const readReason = (body) => {
  const text = typeof (body || {}).reason === "string" ? body.reason.trim() : "";
  if (text.length < 10) return { error: "Please give a reason (at least 10 characters)" };
  if (text.length > 300) return { error: "The reason can be at most 300 characters" };
  return { text };
};

// Changes an artisan's status in ONE step, only if it is currently in an allowed status
const changeStatus = (id, from, set, unset = {}) =>
  ArtisanProfile.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true }
  );

// Explains why a status change didn't happen
const explainFailure = async (res, id, action) => {
  const found = await ArtisanProfile.findById(id).select("status");
  if (!found) return res.status(404).json(NOT_FOUND);
  return res.status(409).json({ message: `This artisan is "${found.status}", so you can't ${action}` });
};

// GET /api/admin/artisans?status=pending&q=emeka&category=Electrical&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const category = C.CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const q = String(req.query.q || "").trim().slice(0, 60);

    const match = {};
    if (status) match.status = status;
    if (category) match.category = category;

    const pipeline = [
      { $match: match },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "owner" } },
      { $unwind: "$owner" },
    ];

    // Every word typed must match the job role, name, email or phone
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
    if (words.length) {
      pipeline.push({
        $match: {
          $and: words.map((w) => {
            const rx = new RegExp(escapeRegex(w), "i");
            return {
              $or: [
                { occupation: rx },
                { "owner.fullName": rx },
                { "owner.email": rx },
                { "owner.phone": rx },
              ],
            };
          }),
        },
      });
    }

    pipeline.push(
      // The waiting list shows the longest-waiting artisan first
      { $sort: { createdAt: status === "pending" ? 1 : -1, _id: 1 } },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                occupation: 1,
                category: 1,
                status: 1,
                ninVerified: 1,
                addressVerified: 1,
                ratingAverage: 1,
                ratingCount: 1,
                jobsCompleted: 1,
                createdAt: 1,
                avatar: 1,
                "owner._id": 1,
                "owner.fullName": 1,
                "owner.email": 1,
                "owner.phone": 1,
                "owner.isActive": 1,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      }
    );

    const [[result], countRows] = await Promise.all([
      ArtisanProfile.aggregate(pipeline),
      ArtisanProfile.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0, suspended: 0 };
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    const total = result.total[0] ? result.total[0].count : 0;

    res.json({
      artisans: result.items.map((p) => ({
        id: p._id,
        userId: p.owner._id,
        name: p.owner.fullName,
        email: p.owner.email,
        phone: p.owner.phone,
        accountActive: p.owner.isActive,
        avatar: imageOf(p.avatar),
        occupation: p.occupation,
        category: p.category,
        status: p.status,
        ninVerified: p.ninVerified,
        addressVerified: p.addressVerified,
        ratingAverage: Math.round((p.ratingAverage || 0) * 10) / 10,
        ratingCount: p.ratingCount || 0,
        jobsCompleted: p.jobsCompleted || 0,
        joinedAt: p.createdAt,
      })),
      counts,
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/artisans/:id  (shows the decrypted NIN and the full bank account)
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const profile = await ArtisanProfile.findById(id)
      .select("+nin +accountNumber")
      .populate("user", "fullName email phone isActive isEmailVerified createdAt");
    if (!profile || !profile.user) return res.status(404).json(NOT_FOUND);

      const superAdmin = isSuper(req.user);

   
    let nin = null;
    if (superAdmin) {
      try {
        nin = decrypt(profile.nin);
      } catch (err) {
        console.error("Could not decrypt a NIN:", err.message);
      }

      await logAction(req, "artisan.view_nin", {
        targetType: "artisan",
        targetId: profile._id,
        summary: "Opened the artisan's details (NIN visible)",
      });
    }

    const [totalBookings, totalDisputes, openDisputes, totalReports] = await Promise.all([
      Booking.countDocuments({
        artisan: profile._id,
        status: { $nin: ["awaiting_payment", "expired"] },
      }),
      Dispute.countDocuments({ artisan: profile._id }),
      Dispute.countDocuments({ artisan: profile._id, status: "open" }),
      Report.countDocuments({ reportedUser: profile.user._id }),
    ]);

    res.json({
      artisan: {
        id: profile._id,
        status: profile.status,
        rejectionReason: profile.rejectionReason || null,
        suspensionReason: profile.suspensionReason || null,
        user: {
          id: profile.user._id,
          fullName: profile.user.fullName,
          email: profile.user.email,
          phone: profile.user.phone,
          isActive: profile.user.isActive,
          emailVerified: profile.user.isEmailVerified,
          joinedAt: profile.user.createdAt,
        },
        nin,
        ninVerified: profile.ninVerified,
        addressVerified: profile.addressVerified,
        address: profile.address,
        baseArea: profile.baseArea || null,
        serviceAreas: profile.serviceAreas || [],
        occupation: profile.occupation,
        category: profile.category,
        roleHistory: profile.roleHistory || [],
        checklist: profileChecklist(profile),
        bio: profile.bio || "",
        avatar: imageOf(profile.avatar),
        startingPrice: profile.startingPrice,
        services: profile.services,
        portfolio: profile.portfolio.map((i) => ({ id: i._id, url: i.url, caption: i.caption })),
        bank: {
          bankName: profile.bankName,
          accountNumber: superAdmin ? profile.accountNumber : null,
          accountLast4: String(profile.accountNumber || "").slice(-4),
        },
        detailsHidden: !superAdmin,
        ratingAverage: profile.ratingAverage,
        ratingCount: profile.ratingCount,
        jobsCompleted: profile.jobsCompleted,
        createdAt: profile.createdAt,
        reviewedAt: profile.reviewedAt || null,
        stats: { totalBookings, totalDisputes, openDisputes, totalReports },
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/artisans/:id/approve   { ninVerified?, addressVerified? }
exports.approve = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};
    const ninVerified = body.ninVerified === undefined ? true : body.ninVerified === true;
    const addressVerified = body.addressVerified === true;

    const updated = await changeStatus(
      id,
      ["pending", "rejected"],
      {
        status: "approved",
        ninVerified,
        addressVerified,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
      },
      { rejectionReason: 1 }
    );
    if (!updated) return explainFailure(res, id, "approve");

    notify(updated.user, {
      type: "artisan_approved",
      title: "Your account was approved",
      message: "You can now accept bookings. Add your services and working hours so students can book you.",
      link: "/artisan/dashboard",
    });
    await logAction(req, "artisan.approve", {
      targetType: "artisan",
      targetId: updated._id,
      summary: `Approved (NIN verified: ${ninVerified}, address verified: ${addressVerified})`,
    });

    res.json({ message: "Artisan approved", status: updated.status, ninVerified, addressVerified });
  } catch (err) {
    next(err);
  }
};


exports.reject = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const reason = readReason(req.body);
    if (reason.error) return res.status(400).json({ message: reason.error });

    const updated = await changeStatus(id, ["pending"], {
      status: "rejected",
      rejectionReason: reason.text,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    });
    if (!updated) return explainFailure(res, id, "reject");

    notify(updated.user, {
      type: "artisan_rejected",
      title: "Your account was not approved",
      message: `Reason: ${reason.text} You can fix your details and send them for review again.`,
      link: "/artisan/dashboard",
    });
    await logAction(req, "artisan.reject", {
      targetType: "artisan",
      targetId: updated._id,
      summary: `Rejected: ${reason.text}`,
    });

    res.json({ message: "Artisan rejected", status: updated.status });
  } catch (err) {
    next(err);
  }
};


exports.suspend = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const reason = readReason(req.body);
    if (reason.error) return res.status(400).json({ message: reason.error });

    const updated = await changeStatus(id, ["approved"], {
      status: "suspended",
      suspensionReason: reason.text,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    });
    if (!updated) return explainFailure(res, id, "suspend");

    notify(updated.user, {
      type: "artisan_suspended",
      title: "Your account was suspended",
      message: `Reason: ${reason.text} Please contact support.`,
      link: "/artisan/dashboard",
    });
    await logAction(req, "artisan.suspend", {
      targetType: "artisan",
      targetId: updated._id,
      summary: `Suspended: ${reason.text}`,
    });

    res.json({ message: "Artisan suspended. They no longer appear in Browse.", status: updated.status });
  } catch (err) {
    next(err);
  }
};


exports.reinstate = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const updated = await changeStatus(
      id,
      ["suspended"],
      { status: "approved", reviewedBy: req.user._id, reviewedAt: new Date() },
      { suspensionReason: 1 }
    );
    if (!updated) return explainFailure(res, id, "reinstate");

    notify(updated.user, {
      type: "artisan_reinstated",
      title: "Your account is active again",
      message: "Your suspension has been lifted. You can take bookings again.",
      link: "/artisan/dashboard",
    });
    await logAction(req, "artisan.reinstate", { targetType: "artisan", targetId: updated._id, summary: "Reinstated" });

    res.json({ message: "Artisan reinstated", status: updated.status });
  } catch (err) {
    next(err);
  }
};


exports.setVerification = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};
    const set = {};
    for (const key of ["ninVerified", "addressVerified"]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean") {
        return res.status(400).json({ message: `${key} must be true or false` });
      }
      set[key] = body[key];
    }
    if (Object.keys(set).length === 0) {
      return res.status(400).json({ message: "Send ninVerified and/or addressVerified" });
    }

    const updated = await ArtisanProfile.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!updated) return res.status(404).json(NOT_FOUND);

    await logAction(req, "artisan.verification", {
      targetType: "artisan",
      targetId: updated._id,
      summary: `Badges changed`,
      meta: set,
    });

    res.json({
      message: "Verification updated",
      ninVerified: updated.ninVerified,
      addressVerified: updated.addressVerified,
    });
  } catch (err) {
    next(err);
  }
};

exports.updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};
    const resolved = await resolveRole(body.occupation, body.category);
    if (resolved.error) return res.status(400).json({ message: resolved.error });

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

    const profile = await ArtisanProfile.findById(id);
    if (!profile) return res.status(404).json(NOT_FOUND);

    const result = await applyRole(profile, resolved, req.user._id, note);
    if (!result.changed) {
      return res.json({
        message: "Nothing to change",
        occupation: profile.occupation,
        category: profile.category,
      });
    }

    notify(profile.user, {
      type: "role_changed",
      title: "Your job role was updated",
      message: `Your job role is now ${resolved.name} (${resolved.category}).${note ? ` Note: ${note}` : ""}`,
      link: "/artisan/profile",
    });
    await logAction(req, "artisan.update_role", {
      targetType: "artisan",
      targetId: profile._id,
      summary: `Job role: ${result.before.occupation} to ${resolved.name}`,
      meta: { before: result.before, after: { occupation: resolved.name, category: resolved.category }, note },
    });

    res.json({
      message: "Job role updated",
      occupation: profile.occupation,
      category: profile.category,
      roleHistory: profile.roleHistory,
    });
  } catch (err) {
    next(err);
  }
};
