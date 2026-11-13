require("dotenv").config();
const mongoose = require("mongoose");
const { Booking } = require("../models");

(async () => {
  try {
    if (process.env.NODE_ENV === "production") {
      console.log("Not allowed in production");
      process.exit(1);
    }

    const id = process.argv[2];
    const hours = process.argv[3] === undefined ? -1 : Number(process.argv[3]);
    if (!mongoose.isValidObjectId(id) || !Number.isFinite(hours)) {
      console.log('Usage: npm run dev:timetravel -- "<bookingId>" [hours]');
      console.log("hours: negative = in the past (default -1), positive = in the future");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    const booking = await Booking.findById(id);
    if (!booking) {
      console.log("Booking not found");
      process.exit(1);
    }

    const duration = (booking.service && booking.service.durationMinutes) || 120;
    const startsAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    // The same moment on a Nigerian clock (UTC+1), for the date and time fields
    const wat = new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString();
    const day = wat.slice(0, 10);
    const time = wat.slice(11, 16);

    await Booking.updateOne(
      { _id: id },
      {
        startsAt,
        endsAt: new Date(startsAt.getTime() + duration * 60 * 1000),
        date: new Date(`${day}T00:00:00.000Z`),
        time,
        reminder24Sent: false,
        reminder2Sent: false,
      }
    );

    console.log(`Booking start moved to ${hours} hour(s) from now (${day} ${time})`);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();