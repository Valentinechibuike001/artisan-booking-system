const mongoose = require("mongoose");
const { Booking, Review, ArtisanProfile } = require("../models");
const C = require("../utils/constants");
const { uploadImage, deleteImage } = require("../utils/imageUpload");
const { recalcArtisanRating } = require("../utils/ratings");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

const DAY = 24 * 60 * 60 * 1000;

// Accepts 1 to 5 as a number or text. Anything else becomes null.
const parseRating = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

// What the student sees about their own review
const ownView = (r) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment || "",
  photos: (r.photos || []).map((p) => p.url),
  artisanReply: r.artisanReply && r.artisanReply.text ? r.artisanReply : null,
  createdAt: r.createdAt,
  canEdit: Date.now() - r.createdAt.getTime() <= C.REVIEW_EDIT_DAYS * DAY,
});

// POST /api/user/bookings/:id/review   (form-data: rating, comment, photos)
exports.createReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const body = req.body || {};
    const rating = parseRating(body.rating);
    if (!rating) {
      return res.status(400).json({ message: "Please choose a rating from 1 to 5 stars" });
    }

    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (comment.length > C.MAX_REVIEW_COMMENT) {
      return res
        .status(400)
        .json({ message: `Comments can be at most ${C.MAX_REVIEW_COMMENT} characters` });
    }

    const files = req.files || [];
    if (files.length > C.MAX_REVIEW_PHOTOS) {
      return res.status(400).json({ message: `You can add at most ${C.MAX_REVIEW_PHOTOS} photos` });
    }

    const booking = await Booking.findOne({ _id: id, user: req.user._id });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.status !== "confirmed") {
      return res.status(409).json({ message: "You can review a job after you confirm it is done" });
    }
    if (booking.confirmedAt && Date.now() - booking.confirmedAt.getTime() > C.REVIEW_WINDOW_DAYS * DAY) {
      return res.status(409).json({ message: "The time to review this job has passed" });
    }
    if (await Review.exists({ booking: booking._id })) {
      return res.status(409).json({ message: "You have already reviewed this job" });
    }

    // Upload the photos only after every check has passed
    const photos = await Promise.all(
      files.map((f) =>
        uploadImage(f.buffer, "reviews", {
          transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
        })
      )
    );

    let review;
    try {
      review = await Review.create({
        booking: booking._id,
        user: req.user._id,
        artisan: booking.artisan,
        rating,
        comment,
        photos,
      });
    } catch (err) {
      await Promise.all(photos.map((p) => deleteImage(p.publicId))); // don't leave orphan photos
      if (err.code === 11000) {
        return res.status(409).json({ message: "You have already reviewed this job" });
      }
      throw err;
    }

    await recalcArtisanRating(booking.artisan);

    const ap = await ArtisanProfile.findById(booking.artisan).select("user");
    if (ap) {
      notify(ap.user, {
        type: "new_review",
        title: "New review",
        message: `${publicName(req.user.fullName)} gave you ${rating} star${rating > 1 ? "s" : ""} for ${booking.service.name}.`,
        link: "/artisan/reviews",
      });
    }

    res.status(201).json({ message: "Thank you for your review!", review: ownView(review) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/user/reviews/:reviewId   (JSON: rating and/or comment)
exports.updateReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(404).json({ message: "Review not found" });
    }

    const review = await Review.findOne({ _id: reviewId, user: req.user._id, isHidden: false });
    if (!review) return res.status(404).json({ message: "Review not found" });

    if (Date.now() - review.createdAt.getTime() > C.REVIEW_EDIT_DAYS * DAY) {
      return res
        .status(409)
        .json({ message: `Reviews can only be edited within ${C.REVIEW_EDIT_DAYS} days` });
    }

    const body = req.body || {};

    if (body.rating !== undefined) {
      const rating = parseRating(body.rating);
      if (!rating) {
        return res.status(400).json({ message: "Please choose a rating from 1 to 5 stars" });
      }
      review.rating = rating;
    }

    if (body.comment !== undefined) {
      if (typeof body.comment !== "string") {
        return res.status(400).json({ message: "Comment must be text" });
      }
      const comment = body.comment.trim();
      if (comment.length > C.MAX_REVIEW_COMMENT) {
        return res
          .status(400)
          .json({ message: `Comments can be at most ${C.MAX_REVIEW_COMMENT} characters` });
      }
      review.comment = comment;
    }

    await review.save();
    await recalcArtisanRating(review.artisan);

    res.json({ message: "Review updated", review: ownView(review) });
  } catch (err) {
    next(err);
  }
};
// POST /api/user/reviews/:reviewId/helpful
exports.markHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Add my vote, but only if the review is visible, isn't mine, and I haven't voted yet
    const updated = await Review.findOneAndUpdate(
      {
        _id: reviewId,
        isHidden: false,
        user: { $ne: req.user._id },
        helpfulBy: { $ne: req.user._id },
      },
      { $addToSet: { helpfulBy: req.user._id }, $inc: { helpfulCount: 1 } },
      { new: true }
    );
    if (updated) return res.json({ helpful: true, helpfulCount: updated.helpfulCount });

    // It didn't change. Find out why.
    const review = await Review.findOne({ _id: reviewId, isHidden: false }).select("user helpfulCount");
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (String(review.user) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't mark your own review as helpful" });
    }

    // Otherwise they had already voted, so the answer is the same as before
    res.json({ helpful: true, helpfulCount: review.helpfulCount });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/user/reviews/:reviewId/helpful
exports.unmarkHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Remove my vote, only if I really had one
    const updated = await Review.findOneAndUpdate(
      { _id: reviewId, helpfulBy: req.user._id },
      { $pull: { helpfulBy: req.user._id }, $inc: { helpfulCount: -1 } },
      { new: true }
    );
    if (updated) return res.json({ helpful: false, helpfulCount: Math.max(updated.helpfulCount, 0) });

    const review = await Review.findById(reviewId).select("helpfulCount");
    if (!review) return res.status(404).json({ message: "Review not found" });
    res.json({ helpful: false, helpfulCount: review.helpfulCount });
  } catch (err) {
    next(err);
  }
};