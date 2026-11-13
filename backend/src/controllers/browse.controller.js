const mongoose = require("mongoose");
const { ArtisanProfile, Review } = require("../models");
const { publicName, toCard } = require("../utils/artisanPublic");
const C = require("../utils/constants");
const { isValidDateStr } = require("../utils/time");
const { listSlots } = require("../utils/slots");

const CATEGORIES = C.CATEGORIES;

const SORTS = {
  rating: { ratingAverage: -1, ratingCount: -1, _id: 1 },
  price_low: { startingPrice: 1, _id: 1 },
  price_high: { startingPrice: -1, _id: 1 },
  jobs: { jobsCompleted: -1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
};

// Makes user text safe to use inside a regular expression
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const savedSetFor = (req) =>
  req.user ? new Set(req.user.savedArtisans.map(String)) : null;

// Which of these reviews has the logged-in person marked as helpful?
const myHelpful = async (req, reviews) => {
  if (!req.user || reviews.length === 0) return null;
  const rows = await Review.find({
    _id: { $in: reviews.map((r) => r._id) },
    helpfulBy: req.user._id,
  }).select("_id");
  return new Set(rows.map((r) => String(r._id)));
};

const reviewCard = (r, mine) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment || "",
  photos: (r.photos || []).map((x) => x.url),
  reviewer: publicName(r.user ? r.user.fullName : ""),
  artisanReply: r.artisanReply && r.artisanReply.text ? r.artisanReply : null,
  helpfulCount: r.helpfulCount || 0,
  helpedByMe: mine ? mine.has(String(r._id)) : false,
  createdAt: r.createdAt,
});

// GET /api/browse
exports.browse = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 24);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const category = String(req.query.category || "");
    const area = String(req.query.area || "").trim().slice(0, 50);
    const sort = SORTS[req.query.sort] || SORTS.rating;

    // Only approved artisans with at least one active service are shown
    const match = { status: "approved", services: { $elemMatch: { isActive: true } } };
    if (CATEGORIES.includes(category)) match.category = category;
    if (req.query.available === "true") match.isAvailable = true;
    if (area) match.serviceAreas = { $regex: `^${escapeRegex(area)}$`, $options: "i" };

    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    if (minPrice > 0 || maxPrice > 0) {
      match.startingPrice = {};
      if (minPrice > 0) match.startingPrice.$gte = minPrice;
      if (maxPrice > 0) match.startingPrice.$lte = maxPrice;
    }

    const pipeline = [
      { $match: match },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "owner" } },
      { $unwind: "$owner" },
      { $match: { "owner.isActive": true } },
    ];

    // Hide people this student blocked, and artisans who blocked this student
    if (req.user) {
      pipeline.push({
        $match: {
          "owner._id": { $nin: [...req.user.blockedUsers] },
          "owner.blockedUsers": { $ne: req.user._id },
        },
      });
    }

    // Every word typed must match something (name, job, services, bio or category)
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
    if (words.length) {
      pipeline.push({
        $match: {
          $and: words.map((w) => {
            const rx = new RegExp(escapeRegex(w), "i");
            return {
              $or: [
                { occupation: rx },
                { category: rx },
                { bio: rx },
                { "services.name": rx },
                { "owner.fullName": rx },
              ],
            };
          }),
        },
      });
    }

    pipeline.push(
      { $sort: sort },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                occupation: 1,
                category: 1,
                bio: 1,
                startingPrice: 1,
                ratingAverage: 1,
                ratingCount: 1,
                jobsCompleted: 1,
                isAvailable: 1,
                ninVerified: 1,
                addressVerified: 1,
                baseArea: 1,
                serviceAreas: 1,
                avatar: 1,
                "owner.fullName": 1,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      }
    );

    const [result] = await ArtisanProfile.aggregate(pipeline);
    const total = result.total[0] ? result.total[0].count : 0;
    const saved = savedSetFor(req);

    res.json({
      artisans: result.items.map((p) => toCard(p, p.owner.fullName, saved)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/browse/meta  (filter options for the Browse page)
exports.meta = async (req, res, next) => {
  try {
    const areas = await ArtisanProfile.distinct("serviceAreas", { status: "approved" });
    areas.sort((a, b) => a.localeCompare(b));
    res.json({ categories: CATEGORIES, areas, sorts: Object.keys(SORTS) });
  } catch (err) {
    next(err);
  }
};

// GET /api/browse/:id  (full artisan profile page)
exports.getArtisan = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const p = await ArtisanProfile.findOne({ _id: id, status: "approved" }).populate(
      "user",
      "fullName isActive blockedUsers"
    );
    if (!p || !p.user || !p.user.isActive) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    if (req.user) {
      const iBlockedThem = req.user.blockedUsers.some((x) => x.equals(p.user._id));
      const theyBlockedMe = p.user.blockedUsers.some((x) => x.equals(req.user._id));
      if (iBlockedThem || theyBlockedMe) {
        return res.status(404).json({ message: "Artisan not found" });
      }
    }

    const [reviews, breakdownRows] = await Promise.all([
      Review.find({ artisan: p._id, isHidden: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user", "fullName"),
      Review.aggregate([
        { $match: { artisan: p._id, isHidden: false } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),
    ]);

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    breakdownRows.forEach((r) => (breakdown[r._id] = r.count));

    const mine = await myHelpful(req, reviews);
    const today = new Date().toISOString().slice(0, 10);
    const saved = savedSetFor(req);

    res.json({
      artisan: {
        ...toCard(p, p.user.fullName, saved),
        bio: p.bio || "", // full bio on the profile page
        services: p.services
          .filter((s) => s.isActive)
          .map((s) => ({
            id: s._id,
            name: s.name,
            description: s.description,
            price: s.price,
            durationMinutes: s.durationMinutes || C.DEFAULT_DURATION_MINUTES,
          })),
        portfolio: p.portfolio.map((i) => ({ id: i._id, url: i.url, caption: i.caption })),
        weeklySchedule: p.weeklySchedule,
        blockedDates: p.blockedDates
          .map((d) => d.toISOString().slice(0, 10))
          .filter((d) => d >= today),
        memberSince: p.createdAt,
      },
      reviews: reviews.map((r) => reviewCard(r, mine)),
      ratingBreakdown: breakdown,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/browse/:id/reviews?page=1&sort=helpful
exports.getReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 10;
    const filter = { artisan: id, isHidden: false };
    const sortBy =
      req.query.sort === "helpful"
        ? { helpfulCount: -1, createdAt: -1, _id: -1 }
        : { createdAt: -1, _id: -1 };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "fullName"),
      Review.countDocuments(filter),
    ]);

    const mine = await myHelpful(req, reviews);

    res.json({
      reviews: reviews.map((r) => reviewCard(r, mine)),
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/browse/:id/availability?date=2026-11-09&serviceId=...
exports.getAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const date = String(req.query.date || "");
    const serviceId = String(req.query.serviceId || "");

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Artisan not found" });
    }
    if (!isValidDateStr(date)) {
      return res.status(400).json({ message: "Date must look like 2026-11-09" });
    }
    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: "Please choose a service" });
    }

    const p = await ArtisanProfile.findOne({ _id: id, status: "approved" });
    if (!p) return res.status(404).json({ message: "Artisan not found" });

    const service = p.services.id(serviceId);
    if (!service || !service.isActive) {
      return res.status(400).json({ message: "That service is no longer available" });
    }
    const durationMinutes = service.durationMinutes || C.DEFAULT_DURATION_MINUTES;

    if (!p.isAvailable) {
      return res.json({
        date,
        durationMinutes,
        slots: [],
        reason: "This artisan is not taking bookings right now",
      });
    }
    res.json({ date, durationMinutes, ...(await listSlots(p, date, durationMinutes)) });
  } catch (err) {
    next(err);
  }
};