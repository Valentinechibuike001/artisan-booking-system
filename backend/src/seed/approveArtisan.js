require("dotenv").config();
const mongoose = require("mongoose");
const { User, ArtisanProfile } = require("../models");

(async () => {
  try {
    const email = (process.argv[2] || "").toLowerCase();
    if (!email) {
      console.log('Usage: npm run approve:artisan -- "email@example.com"');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    const user = await User.findOne({ email, role: "artisan" });
    if (!user) {
      console.log("No artisan found with that email");
      process.exit(1);
    }

    await ArtisanProfile.updateOne(
      { user: user._id },
      { status: "approved", ninVerified: true, addressVerified: true, reviewedAt: new Date() }
    );

    console.log("Approved:", email);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();