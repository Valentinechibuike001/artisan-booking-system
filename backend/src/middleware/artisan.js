const { ArtisanProfile } = require("../models");

// Loads the logged-in artisan's profile onto req.profile
const loadArtisanProfile = async (req, res, next) => {
  try {
    const profile = await ArtisanProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: "Artisan profile not found" });
    req.profile = profile;
    next();
  } catch (err) {
    next(err);
  }
};

// Used on routes that need an approved artisan (accepting bookings, etc.)
const requireApproved = (req, res, next) => {
  const { status, rejectionReason, suspensionReason } = req.profile;

  if (status !== "approved") {
    const messages = {
      pending: "Your account is still waiting for approval",
      rejected: "Your account was not approved",
      suspended: "Your account is suspended",
    };
    return res.status(403).json({
      message: messages[status] || "Your account can't do this right now",
      status,
      rejectionReason: rejectionReason || null,
      suspensionReason: suspensionReason || null,
    });
  }
  next();
};

module.exports = { loadArtisanProfile, requireApproved };