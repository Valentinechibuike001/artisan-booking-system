require("dotenv").config();
const mongoose = require("mongoose");
const { User } = require("../models/Index");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing) {
      console.log("Admin already exists:", email);
      process.exit(0);
    }

    await User.create({
      fullName: process.env.ADMIN_NAME || "Admin",
      phone: "00000000000",
      email,
      password: process.env.ADMIN_PASSWORD,
      role: "admin",
      isEmailVerified: true,
    });

    console.log("Admin created:", email);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();