const mongoose = require("mongoose");
const { Review } = require("../models");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

const MAX_REPLY = 500;

const view = (r) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment || "",
  photos: (r.photos || []).map((p) => p.url),
  reviewer: publicName(r.user ? r.user.fullName : ""),
  serviceName: r.booking && r.booking.service ? r.booking.service.name : null,
  reply: r.artisanReply && r.artisanReply.text ? r.artisanReply : null,
  createdAt: r.createdAt,
   flagged: Boolean(r.flag && r.flag.reason),
});

// GET /api/artisan/reviews?page=1&unreplied=true
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

    const filter = { artisan: req.profile._id, isHidden: false };
    if (req.query.unreplied === "true") filter["artisanReply.text"] = { $exists: false };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "fullName")
        .populate("booking", "service"),
      Review.countDocuments(filter),
    ]);

    res.json({
      reviews: reviews.map(view),
      page,
      total,
      pages: Math.ceil(total / limit),
      ratingAverage: Math.round((req.profile.ratingAverage || 0) * 10) / 10,
      ratingCount: req.profile.ratingCount,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/artisan/reviews/:reviewId/reply   { "text": "..." }
exports.reply = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(404).json({ message: "Review not found" });
    }

    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 2) return res.status(400).json({ message: "Please write a reply" });
    if (text.length > MAX_REPLY) {
      return res.status(400).json({ message: `Replies can be at most ${MAX_REPLY} characters` });
    }

    const review = await Review.findOne({
      _id: reviewId,
      artisan: req.profile._id,
      isHidden: false,
    });
    if (!review) return res.status(404).json({ message: "Review not found" });

    const isFirstReply = !review.artisanReply || !review.artisanReply.text;
    review.artisanReply = { text, repliedAt: new Date() };
    await review.save();

    if (isFirstReply) {
      notify(review.user, {
        type: "review_reply",
        title: "The artisan replied to your review",
        message: `${publicName(req.user.fullName)}: ${text.length > 80 ? `${text.slice(0, 80)}...` : text}`,
        link: `/artisans/${req.profile._id}`,
      });
    }

    res.json({ message: "Reply saved", reply: review.artisanReply });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/reviews/:reviewId/flag   { "reason": "..." }
exports.flag = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(404).json({ message: "Review not found" });
    }

    const body = req.body || {};
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10) {
      return res.status(400).json({
        message: "Please explain what is wrong with this review (at least 10 characters)",
      });
    }
    if (reason.length > 300) {
      return res.status(400).json({ message: "The explanation can be at most 300 characters" });
    }

    // Only one flag per review, and only on this artisan's own visible reviews
    const updated = await Review.findOneAndUpdate(
      { _id: reviewId, artisan: req.profile._id, isHidden: false, "flag.reason": { $exists: false } },
      { $set: { flag: { reason, at: new Date(), resolved: false } } },
      { new: true }
    );

    if (!updated) {
      const mine = await Review.findOne({
        _id: reviewId,
        artisan: req.profile._id,
        isHidden: false,
      }).select("_id");
      if (!mine) return res.status(404).json({ message: "Review not found" });
      return res.status(409).json({ message: "You have already flagged this review" });
    }

    notify.notifyAdmins({
      type: "review_flagged",
      title: "A review was flagged",
      message: `${req.user.fullName} flagged a ${updated.rating}-star review.`,
      link: `/admin/reviews/${updated._id}`,
    });

    res.json({ message: "Thank you. Our team will look at this review." });
  } catch (err) {
    next(err);
  }
};