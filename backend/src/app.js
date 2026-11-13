const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const sanitizeBody = require("./middleware/sanitize");
const { protect, restrictTo, optionalAuth } = require("./middleware/auth");

const app = express();

// Behind a host like Render or Nginx, set TRUST_PROXY=1 so we see each visitor's real address
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

// The website addresses allowed to call this API
const allowedOrigins = [process.env.CLIENT_URL, ...String(process.env.CORS_ORIGINS || "").split(",")]
  .map((o) => String(o || "").trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  })
);
app.use(
  express.json({
    limit: "100kb",
    verify: (req, res, buf) => {
      req.rawBody = buf; // the Paystack webhook signature needs the untouched original text
    },
  })
);
// Newer Express versions leave req.body undefined when a request has no body
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
app.use(sanitizeBody);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Health check (never rate limited, so uptime monitors always get an answer)
app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "degraded",
    database: connected ? "connected" : "disconnected",
    message: "UNN Artisan API is running",
  });
});

// One shared limit for the whole API. The Paystack webhook is exempt.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 1500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith("/api/payments/webhook"),
  message: { message: "Too many requests. Please slow down and try again shortly." },
});
app.use("/api", apiLimiter);

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/payments", require("./routes/payment.routes"));
app.use("/api/legal", require("./routes/legal.routes"));
app.use("/api/banks", require("./routes/bank.routes"));
app.use("/api/browse", optionalAuth, require("./routes/browse.routes"));
app.use("/api/account", protect, require("./routes/account.routes"));
app.use("/api/notifications", protect, require("./routes/notification.routes"));
app.use("/api/messages", protect, restrictTo("user", "artisan"), require("./routes/message.routes"));
app.use("/api/user", protect, restrictTo("user"), require("./routes/user.routes"));
app.use("/api/artisan", protect, restrictTo("artisan"), require("./routes/artisan.routes"));
app.use("/api/admin", protect, restrictTo("admin"), require("./routes/admin.routes"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "The request body isn't valid JSON" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "The request is too large" });
  }
  if (err.name === "MulterError") {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image is too large (max 5MB)"
        : "Too many files or wrong field name";
    return res.status(400).json({ message });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid ID" });
  }
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((e) => e.message).join(", ");
    return res.status(400).json({ message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: "That value is already in use" });
  }

  console.error(err);
  res.status(err.status || 500).json({
    message: err.status ? err.message : "Something went wrong on our side",
  });
});

module.exports = app;