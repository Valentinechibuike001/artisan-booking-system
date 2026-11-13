const mongoose = require("mongoose");
const { User, ArtisanProfile, Booking } = require("../models");
const C = require("../utils/constants");
const { publicName } = require("../utils/artisanPublic");

const imageOf = (u) => (u && u.avatar && u.avatar.url ? u.avatar.url : null);


// GET /api/user/blocks
exports.studentList = async (req, res, next) => {
  try {
    const profiles = await ArtisanProfile.find({ user: { $in: req.user.blockedUsers } })
      .select("occupation avatar user")
      .populate("user", "fullName");

    res.json({
      blocked: profiles
        .filter((p) => p.user)
        .map((p) => ({
          artisanId: p._id,
          name: publicName(p.user.fullName),
          occupation: p.occupation,
          avatar: p.avatar && p.avatar.url ? p.avatar.url : null,
        })),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/blocks   { "artisanId": "..." }
exports.studentBlock = async (req, res, next) => {
  try {
    const artisanId = (req.body || {}).artisanId;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const profile = await ArtisanProfile.findById(artisanId).select("user");
    if (!profile) return res.status(404).json({ message: "Artisan not found" });

    const alreadyBlocked = req.user.blockedUsers.some((x) => x.equals(profile.user));
    if (!alreadyBlocked && req.user.blockedUsers.length >= C.MAX_BLOCKS) {
      return res.status(400).json({ message: `You can block at most ${C.MAX_BLOCKS} people` });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { blockedUsers: profile.user }, $pull: { savedArtisans: profile._id } }
    );

    res.json({ message: "Artisan blocked", isBlocked: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/user/blocks/:artisanId
exports.studentUnblock = async (req, res, next) => {
  try {
    const { artisanId } = req.params;
    if (!mongoose.isValidObjectId(artisanId)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const profile = await ArtisanProfile.findById(artisanId).select("user");
    if (!profile) return res.status(404).json({ message: "Artisan not found" });

    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: profile.user } });
    res.json({ message: "Artisan unblocked", isBlocked: false });
  } catch (err) {
    next(err);
  }
};

// ---------- Artisans block students ----------

// GET /api/artisan/blocks
exports.artisanList = async (req, res, next) => {
  try {
    const users = await User.find({ _id: { $in: req.user.blockedUsers } }).select(
      "fullName hostel avatar"
    );

    res.json({
      blocked: users.map((u) => ({
        id: u._id,
        name: publicName(u.fullName),
        hostel: u.hostel || null,
        avatar: imageOf(u),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/bookings/:id/block-student
exports.artisanBlock = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Booking not found" });

    const booking = await Booking.findOne({
      _id: id,
      artisan: req.profile._id,
      status: { $nin: ["awaiting_payment", "expired"] },
    }).select("user");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const alreadyBlocked = req.user.blockedUsers.some((x) => x.equals(booking.user));
    if (!alreadyBlocked && req.user.blockedUsers.length >= C.MAX_BLOCKS) {
      return res.status(400).json({ message: `You can block at most ${C.MAX_BLOCKS} people` });
    }

    await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: booking.user } });
    res.json({ message: "Student blocked", isBlocked: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/artisan/blocks/:userId
exports.artisanUnblock = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.status(404).json({ message: "Person not found" });

    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: userId } });
    res.json({ message: "Student unblocked", isBlocked: false });
  } catch (err) {
    next(err);
  }
};