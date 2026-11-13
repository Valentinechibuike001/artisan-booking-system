const mongoose = require("mongoose");
const { RoleRequest } = require("../models");
const C = require("../utils/constants");
const { cleanName, findRole } = require("../utils/jobRoles");
const notify = require("../utils/notify");

const DAY = 24 * 60 * 60 * 1000;

const view = (r) => ({
  id: r._id,
  status: r.status,
  currentOccupation: r.currentOccupation,
  requestedOccupation: r.requestedOccupation,
  requestedCategory: r.requestedCategory || null,
  reason: r.reason,
  adminNote: r.adminNote || null,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt || null,
});

// POST /api/artisan/role-requests   { occupation, reason, category? }
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const occupation = cleanName(body.occupation);
    if (occupation.length < 2 || occupation.length > 40) {
      return res.status(400).json({ message: "The job role must be 2 to 40 characters" });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 300) {
      return res.status(400).json({ message: "Please say why (10 to 300 characters)" });
    }

    const p = req.profile;
    if (occupation.toLowerCase() === String(p.occupation).toLowerCase()) {
      return res.status(400).json({ message: "That is already your job role" });
    }

    // If it's on the admin's list, the list decides the name and the category
    let requestedName = occupation;
    let requestedCategory;
    const role = await findRole(occupation);
    if (role) {
      if (!role.isActive) {
        return res.status(400).json({ message: "That job role isn't available right now" });
      }
      requestedName = role.name;
      requestedCategory = role.category;
    } else if (C.CATEGORIES.includes(body.category)) {
      requestedCategory = body.category;
    }

    const recent = await RoleRequest.countDocuments({
      artisan: p._id,
      createdAt: { $gte: new Date(Date.now() - 30 * DAY) },
    });
    if (recent >= C.ROLE_REQUESTS_PER_MONTH) {
      return res.status(429).json({
        message: `You can send at most ${C.ROLE_REQUESTS_PER_MONTH} change requests a month`,
      });
    }

    let request;
    try {
      request = await RoleRequest.create({
        artisan: p._id,
        user: req.user._id,
        currentOccupation: p.occupation,
        currentCategory: p.category,
        requestedOccupation: requestedName,
        requestedCategory,
        reason,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: "You already have a request waiting for review" });
      }
      throw err;
    }

    notify.notifyAdmins({
      type: "role_change_requested",
      title: "Job role change requested",
      message: `${req.user.fullName} asked to change from ${p.occupation} to ${requestedName}.`,
      link: `/admin/role-requests/${request._id}`,
    });

    res.status(201).json({ message: "Your request was sent. Our team will review it.", request: view(request) });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/role-requests
exports.list = async (req, res, next) => {
  try {
    const requests = await RoleRequest.find({ artisan: req.profile._id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ requests: requests.map(view) });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/role-requests/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Request not found" });

    const request = await RoleRequest.findOneAndUpdate(
      { _id: id, artisan: req.profile._id, status: "pending" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!request) {
      return res.status(404).json({ message: "No waiting request found" });
    }

    res.json({ message: "Request cancelled", request: view(request) });
  } catch (err) {
    next(err);
  }
};