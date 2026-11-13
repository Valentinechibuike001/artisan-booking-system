const mongoose = require("mongoose");
const { Review, ArtisanProfile } = require("../models");

// Works out an artisan's average stars and review count from their visible reviews
const recalcArtisanRating = async (artisanId) => {
  const id = new mongoose.Types.ObjectId(String(artisanId));

  const [row] = await Review.aggregate([
    { $match: { artisan: id, isHidden: false } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  await ArtisanProfile.updateOne(
    { _id: id },
    {
      ratingAverage: row ? Math.round(row.average * 100) / 100 : 0,
      ratingCount: row ? row.count : 0,
    }
  );
};

module.exports = { recalcArtisanRating };