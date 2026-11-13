const mongoose = require("mongoose");
const { Report, User, ArtisanProfile } = require("../models");
const { dateKey } = require("../utils/time");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");

const STATUSES = ["open", "reviewed", "action_taken", "dismissed"];
const OUTCOMES = ["reviewed", "action_taken", "dismissed"];
const NOT_FOUND = { message: "Report not found" };
const HOUR = 60 * 60 * 1000;

const populateAll = [
  { path: "reporter", select: "fullName role" },
  { path: "reportedUser", select: "fullName role isActive" },
  { path: "booking", select: "service date time status" },
 { path: "message", select: "text image createdAt" },
];

// Reads a text box and checks its length. Returns { error } or { text }.
const readText = (value, label, min, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min) return { error: `Please write a ${label} (at least ${min} characters)` };
  if (text.length > max) return { error: `The ${label} can be at most ${max} characters` };
  return { text };
};

const person = (u) =>
  u ? { id: u._id, name: u.fullName, role: u.role, isActive: u.isActive } : null;

const row = (r) => ({
  id: r._id,
  status: r.status,
  reason: r.reason,
  createdAt: r.createdAt,
  hoursOpen: r.status === "open" ? Math.floor((Date.now() - r.createdAt.getTime()) / HOUR) : null,
  reporter: person(r.reporter),
  reportedUser: person(r.reportedUser),
});

// GET /api/admin/reports?status=open&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const filter = status ? { status } : {};

    const [reports, total, countRows] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: status === "open" ? 1 : -1 }) // open ones: longest-waiting first
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateAll),
      Report.countDocuments(filter),
      Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = { open: 0, reviewed: 0, action_taken: 0, dismissed: 0 };
    countRows.forEach((r) => {
      if (r._id in counts) counts[r._id] = r.count;
    });

    res.json({ reports: reports.map(row), counts, page, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/reports/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const r = await Report.findById(id).populate(populateAll);
    if (!r || !r.reporter || !r.reportedUser) return res.status(404).json(NOT_FOUND);

    const others = { reportedUser: r.reportedUser._id, _id: { $ne: r._id } };
    const [otherReports, otherOpen, profile] = await Promise.all([
      Report.countDocuments(others),
      Report.countDocuments({ ...others, status: "open" }),
      r.reportedUser.role === "artisan"
        ? ArtisanProfile.findOne({ user: r.reportedUser._id }).select("status occupation")
        : null,
    ]);

    res.json({
      report: {
        ...row(r),
        details: r.details || "",
        adminNote: r.adminNote || null,
        resolvedAt: r.resolvedAt || null,
        booking: r.booking
          ? {
              id: r.booking._id,
              serviceName: r.booking.service ? r.booking.service.name : null,
              date: r.booking.date ? dateKey(r.booking.date) : null,
              time: r.booking.time || null,
              status: r.booking.status,
            }
          : null,
        reportedArtisan: profile
          ? { id: profile._id, status: profile.status, occupation: profile.occupation }
          : null,
        otherReportsAboutThisPerson: otherReports,
        otherOpenReports: otherOpen,
          reportedMessage: r.message
          ? { text: r.message.text || "", image: r.message.image && r.message.image.url ? r.message.image.url : null, sentAt: r.message.createdAt }
          : null,
        canResolve: r.status === "open",
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/reports/:id/resolve
// { outcome, note, suspend?, suspensionReason? }
exports.resolve = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};

    const outcome = typeof body.outcome === "string" ? body.outcome : "";
    if (!OUTCOMES.includes(outcome)) {
      return res.status(400).json({ message: "Please choose an outcome" });
    }

    const note = readText(body.note, "note", 5, 500);
    if (note.error) return res.status(400).json({ message: note.error });

    const wantsSuspend = body.suspend === true;
    let suspension = null;
    if (wantsSuspend) {
      if (outcome !== "action_taken") {
        return res
          .status(400)
          .json({ message: "Suspending someone counts as taking action. Choose action_taken." });
      }
      suspension = readText(body.suspensionReason, "suspension reason", 10, 300);
      if (suspension.error) return res.status(400).json({ message: suspension.error });
    }

    // Close the report. Only one admin can do this.
    const report = await Report.findOneAndUpdate(
      { _id: id, status: "open" },
      {
        $set: {
          status: outcome,
          adminNote: note.text,
          resolvedBy: req.user._id,
          resolvedAt: new Date(),
        },
      },
      { new: true }
    ).populate("reportedUser", "fullName role isActive");

    if (!report) {
      const found = await Report.findById(id).select("_id");
      if (!found) return res.status(404).json(NOT_FOUND);
      return res.status(409).json({ message: "This report has already been closed" });
    }

    // Suspend the reported person, if the admin asked for it
    let suspended = false;
    const target = report.reportedUser;
    if (wantsSuspend && target) {
      if (target.role === "artisan") {
        const profile = await ArtisanProfile.findOneAndUpdate(
          { user: target._id, status: "approved" },
          {
            $set: {
              status: "suspended",
              suspensionReason: suspension.text,
              reviewedBy: req.user._id,
              reviewedAt: new Date(),
            },
          },
          { new: true }
        );
        if (profile) {
          suspended = true;
          notify(target._id, {
            type: "artisan_suspended",
            title: "Your account was suspended",
            message: `Reason: ${suspension.text} Please contact support.`,
            link: "/artisan/dashboard",
          });
        }
      } else if (target.role === "user") {
        const user = await User.findOneAndUpdate(
          { _id: target._id, role: "user", isActive: true },
          { $set: { isActive: false, suspendedReason: suspension.text, suspendedAt: new Date() } },
          { new: true }
        );
        if (user) {
          suspended = true;
          notify(target._id, {
            type: "account_suspended",
            title: "Your account was suspended",
            message: `Reason: ${suspension.text} Please contact support.`,
            allowInactive: true,
          });
        }
      }
    }

    // Thank the reporter, without sharing any details
    notify(report.reporter, {
      type: "report_reviewed",
      title: "We reviewed your report",
      message: "Thank you for helping keep UNN Artisans safe. Our team has looked into your report.",
    });

    await logAction(req, "report.resolve", {
      targetType: "report",
      targetId: report._id,
      summary: `Report closed as ${outcome}${suspended ? " (person suspended)" : ""}`,
      meta: { outcome, note: note.text, suspended },
    });

    res.json({
      message: "Report closed",
      status: outcome,
      suspended,
      warning:
        wantsSuspend && !suspended
          ? "The report was closed, but the person could not be suspended (they may already be suspended or not approved)."
          : null,
    });
  } catch (err) {
    next(err);
  }
};