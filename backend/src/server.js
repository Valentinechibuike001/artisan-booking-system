require("dotenv").config();
const { checkEnv } = require("./config/env");
checkEnv();

const mongoose = require("mongoose");
const app = require("./app");
const connectDB = require("./config/db");
require("./models");
const { startBookingJobs } = require("./jobs/bookingJobs");
const { startReminderJobs } = require("./jobs/reminderJobs");
const { startAdminJobs } = require("./jobs/adminJobs");

const PORT = process.env.PORT || 5000;
let server;

connectDB().then(() => {
  server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  startBookingJobs();
  startReminderJobs();
  startAdminJobs();
});

// A promise that failed and was never handled: print it, but keep running
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

// A crash we can't recover from: print it and stop (a host like Render restarts us)
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

// Stop politely when the host asks us to: finish current requests, close the database
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down...`);
  setTimeout(() => process.exit(1), 10000).unref(); // give up waiting after 10 seconds

  const closeDb = () => mongoose.connection.close().finally(() => process.exit(0));
  if (server) server.close(closeDb);
  else closeDb();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));



