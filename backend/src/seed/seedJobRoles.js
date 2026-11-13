require("dotenv").config();
const mongoose = require("mongoose");
const { JobRole } = require("../models");
const { keyOf } = require("../utils/jobRoles");

const ROLES = [
  ["Electrician", "Electrical"],
  ["Plumber", "Plumbing"],
  ["Baker", "Baking"],
  ["Caterer", "Baking"],
  ["Interior decor", "Decor"],
  ["Painter", "Decor"],
  ["Generator repair", "Repairs"],
  ["Phone repair", "Repairs"],
  ["Carpenter", "Repairs"],
  ["Hair stylist", "Beauty"],
  ["Barber", "Beauty"],
  ["Makeup artist", "Beauty"],
  ["Tailor", "Other"],
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    let added = 0;
    for (const [name, category] of ROLES) {
      const nameKey = keyOf(name);
      if (await JobRole.exists({ nameKey })) continue;
      await JobRole.create({ name, nameKey, category });
      added += 1;
    }

    console.log(`Job roles added: ${added}. Already there: ${ROLES.length - added}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();