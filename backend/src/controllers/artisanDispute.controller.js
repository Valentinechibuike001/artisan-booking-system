const mongoose = require("mongoose");
const { Dispute } = require("../models");
const C = require("../utils/constants");
const { artisanDisputeView } = require("../utils/disputeHelpers");
const { uploadImage, deleteImage } = require("../utils/imageUpload");
const { publicName } = require("../utils/artisanPublic");
const notify = require("../utils/notify");

const MAX_RESPONSE = 1000;
const MAX_RESPONSE_PHOTOS = 3;

const populateForArtisan = [
  { path: "booking", select: "service date time" },
  { path: "raisedBy", select: "fullName" },
];

// GET /api/artisan/disputes?status=open
exports.list = async (req, res, next) => {
  try {
    const filter = { artisan: req.profile._id };
    if (["open", "resolved"].includes(req.query.status)) filter.status = req.query.status;

    const disputes = await Dispute.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate(populateForArtisan);

    res.json({ disputes: disputes.map(artisanDisputeView) });
  } catch (err) {
    next(err);
  }
};

// GET /api/artisan/disputes/:id
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Dispute not found" });

    const dispute = await Dispute.findOne({ _id: id, artisan: req.profile._id }).populate(
      populateForArtisan
    );
    if (!dispute) return res.status(404).json({ message: "Dispute not found" });

    res.json({ dispute: artisanDisputeView(dispute) });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/disputes/:id/respond   (form-data: text, evidence)
exports.respond = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Dispute not found" });

    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < C.DISPUTE_MIN_REASON) {
      return res.status(400).json({
        message: `Please explain your side (at least ${C.DISPUTE_MIN_REASON} characters)`,
      });
    }
    if (text.length > MAX_RESPONSE) {
      return res.status(400).json({ message: `Your response can be at most ${MAX_RESPONSE} characters` });
    }

    const files = req.files || [];
    if (files.length > MAX_RESPONSE_PHOTOS) {
      return res.status(400).json({ message: `You can add at most ${MAX_RESPONSE_PHOTOS} photos` });
    }

    const existing = await Dispute.findOne({ _id: id, artisan: req.profile._id });
    if (!existing) return res.status(404).json({ message: "Dispute not found" });
    if (existing.status !== "open") {
      return res.status(409).json({ message: "This dispute has already been resolved" });
    }
    if (existing.artisanResponse && existing.artisanResponse.text) {
      return res.status(409).json({ message: "You have already responded to this dispute" });
    }

    const evidence = await Promise.all(
      files.map((f) =>
        uploadImage(f.buffer, "disputes", {
          transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
        })
      )
    );

    // Only one response can win this update, even if two requests arrive together
    const updated = await Dispute.findOneAndUpdate(
      { _id: id, artisan: req.profile._id, status: "open", "artisanResponse.text": { $exists: false } },
      {
        $set: {
          "artisanResponse.text": text,
          "artisanResponse.respondedAt": new Date(),
          "artisanResponse.evidence": evidence,
        },
      },
      { new: true }
    );

    if (!updated) {
      await Promise.all(evidence.map((p) => deleteImage(p.publicId)));
      return res.status(409).json({ message: "This dispute can no longer take a response" });
    }

    notify(updated.raisedBy, {
      type: "dispute_response",
      title: "The artisan responded",
      message: `${publicName(req.user.fullName)} has given their side of the problem you reported.`,
      link: `/disputes/${updated._id}`,
    });
    notify.notifyAdmins({
      type: "dispute_response",
      title: "Dispute response received",
      message: "The artisan has responded to an open dispute.",
      link: `/admin/disputes/${updated._id}`,
    });

    res.json({ message: "Your response was sent to our team" });
  } catch (err) {
    next(err);
  }
};