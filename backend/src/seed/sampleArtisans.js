require("dotenv").config();
const mongoose = require("mongoose");
const { User, ArtisanProfile } = require("../models");
const { encrypt, hashValue } = require("../utils/encryption");

const SAMPLE_EMAIL = /@sample\.test$/;

const SAMPLES = [
  {
    fullName: "Emeka Okafor", occupation: "Electrician", category: "Electrical",
    rating: 4.8, jobs: 32, baseArea: "Odenigwe, Nsukka",
    areas: ["Hall 3", "Odenigwe", "Hostel B"],
    bio: "House and hostel wiring, sockets, lighting and generator changeover. Available weekdays after lectures.",
     services: [["Socket repair", 3000, 60], ["Lighting installation", 6000, 120], ["Full room wiring", 25000, 240]],
  },
  {
    fullName: "Ngozi Agu", occupation: "Baker", category: "Baking",
    rating: 4.9, jobs: 21, baseArea: "Nsukka town",
    areas: ["Nsukka town", "Hall 3"],
    bio: "Custom cakes, small chops and pastries for birthdays and hostel events.",
        services: [["Birthday cake", 5000, 120], ["Small chops platter", 8000, 180]],
  },
  {
    fullName: "Chidi Bassey", occupation: "Plumber", category: "Plumbing",
    rating: 4.6, jobs: 18, baseArea: "Ama Hostel, Nsukka",
    areas: ["Ama Hostel", "Hostel B"], available: false,
    bio: "Leaking taps, blocked drains and water tank fittings.",
        services: [["Fix leaking tap", 2500, 60], ["Unblock drain", 4000, 90]],
  },
  {
    fullName: "Amaka Eze", occupation: "Interior decor", category: "Decor",
    rating: 4.7, jobs: 9, baseArea: "Odenigwe, Nsukka",
    areas: ["Odenigwe", "Nsukka town"],
    bio: "Room makeovers, curtains and event decoration on a student budget.",
        services: [["Room makeover", 10000, 240], ["Event decoration", 20000, 240]],
  },
  {
    fullName: "Tobenna Udeh", occupation: "Generator repair", category: "Repairs",
    rating: 4.5, jobs: 27, baseArea: "Nsukka town",
    areas: ["Nsukka town", "Hall 3", "Ama Hostel"],
    bio: "Servicing and repair of small petrol generators and phone screens.",
        services: [["Generator service", 4000, 90], ["Generator repair", 9000, 180]],
  },
  {
    fullName: "Ifeoma Kalu", occupation: "Hair stylist", category: "Beauty",
    rating: 4.9, jobs: 40, baseArea: "Odenigwe, Nsukka",
    areas: ["Odenigwe", "Hostel B", "Hall 3"],
    bio: "Braids, weaving and natural hair styling. I come to your hostel.",
       services: [["Braids", 3500, 180], ["Weave install", 6000, 180]],
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    if (process.argv.includes("--remove")) {
      const users = await User.find({ email: SAMPLE_EMAIL }).select("_id");
      const ids = users.map((u) => u._id);
      await ArtisanProfile.deleteMany({ user: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
      console.log(`Removed ${ids.length} sample artisans`);
      process.exit(0);
    }

    for (let i = 0; i < SAMPLES.length; i++) {
      const s = SAMPLES[i];
      const email = `${s.fullName.split(" ")[0].toLowerCase()}@sample.test`;

      if (await User.findOne({ email })) {
        console.log("Already exists:", email);
        continue;
      }

      const nin = String(70000000000 + i);
      const user = await User.create({
        fullName: s.fullName,
        phone: `0801000000${i}`,
        email,
        password: "password123",
        role: "artisan",
        isEmailVerified: true,
        termsAcceptedAt: new Date(),
      });

      await ArtisanProfile.create({
        user: user._id,
        nin: encrypt(nin),
        ninHash: hashValue(nin),
        address: `${s.baseArea} (sample address)`,
        baseArea: s.baseArea,
        serviceAreas: s.areas,
        occupation: s.occupation,
        category: s.category,
        bio: s.bio,
        services: s.services.map(([name, price, durationMinutes]) => ({ name, price, durationMinutes })),
        startingPrice: Math.min(...s.services.map(([, price]) => price)),
        bankName: "GTBank",
        accountNumber: `01234567${String(i).padStart(2, "0")}`,
        isAvailable: s.available !== false,
        weeklySchedule: [1, 2, 3, 4, 5].map((day) => ({ day, from: "16:00", to: "20:00" })),
        status: "approved",
        ninVerified: true,
        addressVerified: true,
        ratingAverage: s.rating,
        ratingCount: Math.round(s.jobs * 0.6),
        jobsCompleted: s.jobs,
      });

      console.log("Created:", email);
    }

    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();