const mongoose = require("mongoose");
const { User, ArtisanProfile } = require("../models");
const { toCard } = require("../utils/artisanPublic");

// GET /api/user/saved
exports.getSaved = async (req, res, next) => {
  try {
    const profiles = await ArtisanProfile.find({
      _id: { $in: req.user.savedArtisans },
      status: "approved",
    }).populate("user", "fullName isActive");

    const saved = new Set(req.user.savedArtisans.map(String));
    const artisans = profiles
      .filter((p) => p.user && p.user.isActive)
      .map((p) => toCard(p, p.user.fullName, saved));

    res.json({ artisans });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/saved/:artisanId
exports.saveArtisan = async (req, res, next) => {
  try {
    const { artisanId } = req.params;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const artisan = await ArtisanProfile.findOne({ _id: artisanId, status: "approved" });
    if (!artisan) return res.status(404).json({ message: "Artisan not found" });

    // $addToSet never adds the same artisan twice
    await User.updateOne({ _id: req.user._id }, { $addToSet: { savedArtisans: artisan._id } });
    res.json({ message: "Artisan saved", isSaved: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/user/saved/:artisanId
exports.unsaveArtisan = async (req, res, next) => {
  try {
    const { artisanId } = req.params;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    await User.updateOne({ _id: req.user._id }, { $pull: { savedArtisans: artisanId } });
    res.json({ message: "Artisan removed from saved", isSaved: false });
  } catch (err) {
    next(err);
  }
};