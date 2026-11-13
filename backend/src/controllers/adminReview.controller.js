const mongoose = require("mongoose");
const { Review, ArtisanProfile } = require("../models");
const { recalcArtisanRating } = require("../utils/ratings");
const { logAction } = require("../utils/audit");
const notify = require("../utils/notify");

const NOT_FOUND = { message: "Review not found" };
const FLAGGED = { "flag.reason": { $exists: true }, "flag.resolved": { $ne: true } };

const populateAll = [
  { path: "user", select: "fullName" },
  { path: "artisan", select: "user", populate: { path: "user", select: "fullName" } },
  { path: "booking", select: "service" },
];

const row = (r) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment || "",
  photos: (r.photos || []).map((p) => p.url),
  reviewer: r.user ? r.user.fullName : null,
  artisan: r.artisan && r.artisan.user ? r.artisan.user.fullName : null,
  serviceName: r.booking && r.booking.service ? r.booking.service.name : null,
  artisanReply: r.artisanReply && r.artisanReply.text ? r.artisanReply.text : null,
  createdAt: r.createdAt,
  isHidden: r.isHidden,
  hiddenReason: r.hiddenReason || null,
  flag:
    r.flag && r.flag.reason
      ? { reason: r.flag.reason, at: r.flag.at, resolved: Boolean(r.flag.resolved) }
      : null,
});

const readReason = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 10) return { error: "Please give a reason (at least 10 characters)" };
  if (text.length > 300) return { error: "The reason can be at most 300 characters" };
  return { text };
};

const artisanUserId = async (artisanProfileId) => {
  const profile = await ArtisanProfile.findById(artisanProfileId).select("user");
  return profile ? profile.user : null;
};

// Explains why an action didn't happen
const explain = async (res, id, message) => {
  const found = await Review.findById(id).select("_id");
  if (!found) return res.status(404).json(NOT_FOUND);
  return res.status(409).json({ message });
};

// GET /api/admin/reviews?view=flagged|hidden|all&rating=1&page=1
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const view = ["flagged", "hidden", "all"].includes(req.query.view) ? req.query.view : "flagged";

    const filter = view === "hidden" ? { isHidden: true } : view === "all" ? {} : { ...FLAGGED };
    const rating = Number(req.query.rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) filter.rating = rating;

    const [reviews, total, flaggedCount, hiddenCount] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: view === "flagged" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateAll),
      Review.countDocuments(filter),
      Review.countDocuments(FLAGGED),
      Review.countDocuments({ isHidden: true }),
    ]);

    res.json({
      reviews: reviews.map(row),
      counts: { flagged: flaggedCount, hidden: hiddenCount },
      view,
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/reviews/:id/hide   { reason }
exports.hide = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const reason = readReason((req.body || {}).reason);
    if (reason.error) return res.status(400).json({ message: reason.error });

    const updated = await Review.findOneAndUpdate(
      { _id: id, isHidden: false },
      { $set: { isHidden: true, hiddenReason: reason.text, hiddenBy: req.user._id, hiddenAt: new Date() } },
      { new: true }
    );
    if (!updated) return explain(res, id, "This review is already hidden");

    const wasFlagged = Boolean(updated.flag && updated.flag.reason);
    if (wasFlagged) await Review.updateOne({ _id: updated._id }, { $set: { "flag.resolved": true } });

    await recalcArtisanRating(updated.artisan);

    notify(updated.user, {
      type: "review_hidden",
      title: "Your review was removed",
      message: `Your review broke our community rules. Reason: ${reason.text}`,
    });
    if (wasFlagged) {
      const artisanUser = await artisanUserId(updated.artisan);
      if (artisanUser) {
        notify(artisanUser, {
          type: "review_flag_result",
          title: "The review you flagged was removed",
          message: "Our team agreed with you and removed the review.",
          link: "/artisan/reviews",
        });
      }
    }

    await logAction(req, "review.hide", {
      targetType: "review",
      targetId: updated._id,
      summary: `Hid a ${updated.rating}-star review: ${reason.text}`,
    });

    res.json({ message: "Review hidden. The artisan's rating was updated." });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/reviews/:id/unhide
exports.unhide = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const updated = await Review.findOneAndUpdate(
      { _id: id, isHidden: true },
      { $set: { isHidden: false }, $unset: { hiddenReason: 1, hiddenBy: 1, hiddenAt: 1 } },
      { new: true }
    );
    if (!updated) return explain(res, id, "This review is not hidden");

    await recalcArtisanRating(updated.artisan);
    await logAction(req, "review.unhide", {
      targetType: "review",
      targetId: updated._id,
      summary: "Restored a hidden review",
    });

    res.json({ message: "Review is visible again. The artisan's rating was updated." });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/reviews/:id/dismiss-flag   (the review stays visible)
exports.dismissFlag = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json(NOT_FOUND);

    const updated = await Review.findOneAndUpdate(
      { _id: id, ...FLAGGED },
      { $set: { "flag.resolved": true } },
      { new: true }
    );
    if (!updated) return explain(res, id, "This review has no open flag");

    const artisanUser = await artisanUserId(updated.artisan);
    if (artisanUser) {
      notify(artisanUser, {
        type: "review_flag_result",
        title: "We reviewed the review you flagged",
        message: "Our team looked at it and the review stays visible.",
        link: "/artisan/reviews",
      });
    }

    await logAction(req, "review.dismiss_flag", {
      targetType: "review",
      targetId: updated._id,
      summary: "Dismissed an artisan's flag. The review stays visible.",
    });

    res.json({ message: "Flag dismissed. The review stays visible." });
  } catch (err) {
    next(err);
  }
};