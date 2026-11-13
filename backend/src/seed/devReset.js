require("dotenv").config();
const mongoose = require("mongoose");
const {
  User, ArtisanProfile, Booking, Payment, Payout, Review, Dispute,
  Message, Notification, Report, RoleRequest, SlotLock, AuditLog,
} = require("../models");

(async () => {
  try {
    if (process.env.NODE_ENV === "production") {
      console.log("Not allowed in production");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    const dbName = mongoose.connection.name;

    if (/prod|live/i.test(dbName)) {
      console.log(`Refusing: "${dbName}" looks like a live database`);
      process.exit(1);
    }

    if (!process.argv.includes("--yes")) {
      console.log(`This deletes ALL test data in the database "${dbName}" (admins and job roles are kept).`);
      console.log("To go ahead, run: npm run dev:reset -- --yes");
      process.exit(0);
    }

    const collections = {
      Booking, Payment, Payout, Review, Dispute, Message, Notification,
      Report, RoleRequest, SlotLock, AuditLog, ArtisanProfile,
    };
    for (const [name, Model] of Object.entries(collections)) {
      const result = await Model.deleteMany({});
      console.log(`${name}: ${result.deletedCount} deleted`);
    }

    const users = await User.deleteMany({ role: { $ne: "admin" } });
    console.log(`Users (not admins): ${users.deletedCount} deleted`);

    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();