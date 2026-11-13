const mongoose = require("mongoose");

// Finds the payments an artisan can be paid for right now.
// Pass an artisan ID to look at one artisan, or nothing for everyone.
const payablePipeline = (artisanId) => {
  const match = {
    status: { $in: ["released", "partially_refunded"] },
    payout: { $exists: false },
    artisanAmount: { $gt: 0 },
  };
  if (artisanId) match.artisan = new mongoose.Types.ObjectId(String(artisanId));

  return [
    { $match: match },
    { $lookup: { from: "bookings", localField: "booking", foreignField: "_id", as: "b" } },
    { $unwind: "$b" },
    {
      $match: {
        $or: [
          { status: "partially_refunded" },
          { "b.disputeWindowEndsAt": { $lte: new Date() } },
        ],
      },
    },
  ];
};

// Finds released payments still waiting for the 48-hour report window to close
const waitingPipeline = (artisanId) => {
  const match = { status: "released", payout: { $exists: false } };
  if (artisanId) match.artisan = new mongoose.Types.ObjectId(String(artisanId));

  return [
    { $match: match },
    { $lookup: { from: "bookings", localField: "booking", foreignField: "_id", as: "b" } },
    { $unwind: "$b" },
    {
      $match: {
        $or: [
          { "b.disputeWindowEndsAt": { $gt: new Date() } },
          { "b.disputeWindowEndsAt": { $exists: false } },
        ],
      },
    },
  ];
};

module.exports = { payablePipeline, waitingPipeline };