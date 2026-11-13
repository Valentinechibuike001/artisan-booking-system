const { JobRole } = require("../models");

// Makes text safe to use inside a regular expression
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "  Hair   stylist " -> "Hair stylist"
const cleanName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

// "Hair stylist" -> "hair stylist" (used to stop duplicates)
const keyOf = (name) => cleanName(name).toLowerCase();

const findRole = (name) => JobRole.findOne({ nameKey: keyOf(name) });

// A database filter that matches artisans whose job role is this name
const occupationFilter = (name) => ({
  occupation: { $regex: `^${escapeRegex(cleanName(name))}$`, $options: "i" },
});

module.exports = { cleanName, keyOf, findRole, occupationFilter, escapeRegex };