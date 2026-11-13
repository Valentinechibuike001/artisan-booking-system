const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { protect } = require("../middleware/auth.js");
const auth = require("../controllers/auth.controller.js");

// Max 30 requests per 15 minutes per IP on these routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { message: "Too many attempts. Please try again later." },
});

router.post("/register", authLimiter, auth.register);
router.post("/verify-otp", authLimiter, auth.verifyOtp);
router.post("/resend-otp", authLimiter, auth.resendOtp);
router.post("/login", authLimiter, auth.login);
router.post("/forgot-password", authLimiter, auth.forgotPassword);
router.post("/reset-password", authLimiter, auth.resetPassword);
router.get("/me", protect, auth.me);

module.exports = router;