const mongoose = require("mongoose");
const { Booking, Dispute, Payment, ArtisanProfile } = require("../models");
const C = require("../utils/constants");
const { CATEGORIES, canReportBooking, studentDisputeView } = require("../utils/disputeHelpers");
const { move } = require("../utils/bookingHelpers");
const { uploadImage, deleteImage } = require("../utils/imageUpload");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

const populateForStudent = [
  { path: "booking", select: "service date time" },
  { path: "artisan", select: "user", populate: { path: "user", select: "fullName" } },
];

// Explains why a booking can't be reported right now
const whyNotReportable = (b) => {
  if (b.status === "accepted") {
    return "You can report a problem once the scheduled time has passed";
  }
  if (["completed", "confirmed"].includes(b.status)) {
    return `The ${C.DISPUTE_WINDOW_HOURS}-hour window to report a problem has closed`;
  }
  if (b.status === "disputed") return "A problem has already been reported for this booking";
  return `A problem can't be reported for a booking that is "${b.status.replace("_", " ")}"`;
};

// POST /api/user/bookings/:id/dispute   (form-data: category, reason, evidence)
exports.create = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const body = req.body || {};

    const category = typeof body.category === "string" ? body.category : "";
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Please choose what went wrong" });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < C.DISPUTE_MIN_REASON) {
      return res.status(400).json({
        message: `Please describe the problem (at least ${C.DISPUTE_MIN_REASON} characters)`,
      });
    }
    if (reason.length > C.DISPUTE_MAX_REASON) {
      return res.status(400).json({
        message: `The description can be at most ${C.DISPUTE_MAX_REASON} characters`,
      });
    }

    const files = req.files || [];
    if (files.length > C.MAX_DISPUTE_PHOTOS) {
      return res.status(400).json({ message: `You can add at most ${C.MAX_DISPUTE_PHOTOS} photos` });
    }

    const booking = await Booking.findOne({ _id: id, user: req.user._id });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (await Dispute.exists({ booking: booking._id })) {
      return res.status(409).json({ message: "A problem has already been reported for this booking" });
    }
    if (!canReportBooking(booking)) {
      return res.status(409).json({ message: whyNotReportable(booking) });
    }

    // Upload the photos only after every check has passed
    const evidence = await Promise.all(
      files.map((f) =>
        uploadImage(f.buffer, "disputes", {
          transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
        })
      )
    );
    const cleanUp = () => Promise.all(evidence.map((p) => deleteImage(p.publicId)));

    let dispute;
    try {
      dispute = await Dispute.create({
        booking: booking._id,
        raisedBy: req.user._id,
        artisan: booking.artisan,
        category,
        reason,
        evidence,
        bookingStatusBefore: booking.status,
      });
    } catch (err) {
      await cleanUp();
      if (err.code === 11000) {
        return res.status(409).json({ message: "A problem has already been reported for this booking" });
      }
      throw err;
    }

    // Freeze the booking. If this fails, undo the dispute.
    const result = await move({
      id: booking._id,
      owner: { user: req.user._id },
      from: [booking.status],
      to: "disputed",
      by: req.user._id,
      note: "The student reported a problem",
    });
    if (!result.booking) {
      await Dispute.deleteOne({ _id: dispute._id });
      await cleanUp();
      return res.status(result.code).json({ message: result.message });
    }

    // If the student had already tapped "Job done", put the money back on hold
    await Payment.updateOne(
      { booking: booking._id, status: "released" },
      { $set: { status: "held" }, $unset: { releasedAt: 1 } }
    );

    const ap = await ArtisanProfile.findById(booking.artisan).select("user");
    if (ap) {
      notify(ap.user, {
        type: "dispute_opened",
        title: "A problem was reported",
        message: `${publicName(req.user.fullName)} reported a problem with ${booking.service.name}. Please give your side.`,
        link: `/artisan/disputes/${dispute._id}`,
      });
    }
    notify.notifyAdmins({
      type: "dispute_opened",
      title: "New dispute",
      message: `${booking.service.name}: ${category.replace("_", " ")}`,
      link: `/admin/disputes/${dispute._id}`,
    });

    res.status(201).json({
      message: "Your report was sent. Our team will review it and the payment stays on hold.",
      dispute: { id: dispute._id, status: dispute.status },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/disputes
exports.list = async (req, res, next) => {
  try {
    const disputes = await Dispute.find({ raisedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate(populateForStudent);

    res.json({ disputes: disputes.map(studentDisputeView) });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/disputes/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Dispute not found" });

    const dispute = await Dispute.findOne({ _id: id, raisedBy: req.user._id }).populate(
      populateForStudent
    );
    if (!dispute) return res.status(404).json({ message: "Dispute not found" });

    res.json({ dispute: studentDisputeView(dispute) });
  } catch (err) {
    next(err);
  }
};