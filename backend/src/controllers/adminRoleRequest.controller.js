const mongoose = require("mongoose");
const { RoleRequest, ArtisanProfile } = require("../models");
const { findRole } = require("../utils/jobRoles");
const { resolveRole, applyRole } = require("../utils/roleChange");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");

const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const NOT_FOUND = { message: "Request not found" };

const populateAll = [
  { path: "artisan", select: "user status", populate: { path: "user", select: "fullName" } },
];

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const row = (r) => ({
  id: r._id,
  status: r.status,
  createdAt: r.createdAt,
  artisan:
    r.artisan && r.artisan.user
      ? { id: r.artisan._id, name: r.artisan.user.fullName, status: r.artisan.status }
      : null,
  currentOccupation: r.currentOccupation,
  requestedOccupation: r.requestedOccupation,
  requestedCategory: r.requestedCategory || null,
  reason: r.reason,
});

// GET /api/admin/role-requests?status=pending&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const filter = status ? { status } : {};

    const [requests, total, countRows] = await Promise.all([
      RoleRequest.find(filter)
        .sort({ createdAt: status === "pending" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateAll),
      RoleRequest.countDocuments(filter),
      RoleRequest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    res.json({ requests: requests.map(row), counts, page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/role-requests/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const r = await RoleRequest.findById(id).populate(populateAll);
    if (!r) return res.status(404).json(NOT_FOUND);

    const listed = await findRole(r.requestedOccupation);

    res.json({
      request: {
        ...row(r),
        adminNote: r.adminNote || null,
        decidedAt: r.decidedAt || null,
        // On the list? Then the category is already decided. If not, choose one when approving.
        listedRole: listed ? { name: listed.name, category: listed.category, isActive: listed.isActive } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/role-requests/:id/approve   { occupation?, category?, note? }
exports.approve = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};
    const request = await RoleRequest.findById(id);
    if (!request) return res.status(404).json(NOT_FOUND);
    if (request.status !== "pending") {
      return res.status(409).json({ message: `This request is already ${request.status}` });
    }

    const name = text(body.occupation, 40) || request.requestedOccupation;
    const category = body.category || request.requestedCategory;
    const resolved = await resolveRole(name, category);
    if (resolved.error) return res.status(400).json({ message: resolved.error });

    const note = text(body.note, 200);

    // Claim the request first, so only one admin can decide it
    const claimed = await RoleRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status: "approved", decidedBy: req.user._id, decidedAt: new Date(), adminNote: note } },
      { new: true }
    );
    if (!claimed) return res.status(409).json({ message: "This request was already decided" });

    const profile = await ArtisanProfile.findById(request.artisan);
    if (!profile) {
      await RoleRequest.updateOne(
        { _id: id },
        { $set: { status: "pending" }, $unset: { decidedBy: 1, decidedAt: 1, adminNote: 1 } }
      );
      return res.status(404).json({ message: "The artisan's profile no longer exists" });
    }

    await applyRole(profile, resolved, req.user._id, note || "Requested by the artisan");

    notify(request.user, {
      type: "role_request_approved",
      title: "Your job role was changed",
      message: `Your job role is now ${resolved.name} (${resolved.category}).${note ? ` Note: ${note}` : ""}`,
      link: "/artisan/profile",
      sendEmail: true,
    });
    await logAction(req, "rolerequest.approve", {
      targetType: "artisan",
      targetId: profile._id,
      summary: `Approved role change to ${resolved.name}`,
    });

    res.json({ message: "Approved. The artisan's job role was updated.", occupation: resolved.name, category: resolved.category });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/role-requests/:id/reject   { note }
exports.reject = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const note = text((req.body || {}).note, 300);
    if (note.length < 5) {
      return res.status(400).json({ message: "Please say why (at least 5 characters)" });
    }

    const request = await RoleRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status: "rejected", decidedBy: req.user._id, decidedAt: new Date(), adminNote: note } },
      { new: true }
    );
    if (!request) {
      const found = await RoleRequest.findById(id).select("status");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: `This request is already ${found.status}` });
    }

    notify(request.user, {
      type: "role_request_rejected",
      title: "Your job role request was not approved",
      message: `Reason: ${note}`,
      link: "/artisan/profile",
      sendEmail: true,
    });
    await logAction(req, "rolerequest.reject", {
      targetType: "artisan",
      targetId: request.artisan,
      summary: `Rejected role change: ${note}`,
    });

    res.json({ message: "Request rejected" });
  } catch (err) {
    next(err);
  }
};