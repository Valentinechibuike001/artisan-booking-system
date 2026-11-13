const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const upload = require("../middleware/upload");
const { restrictTo } = require("../middleware/auth");
const account = require("../controllers/account.controller");
const security = require("../controllers/accountSecurity.controller");
const dataExport = require("../controllers/dataExport.controller");

// Each limiter keeps its own count, per person (not per internet connection)
const makeLimiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    keyGenerator: (req) => String(req.user._id),
    message: { message: "Too many attempts. Please try again in a few minutes." },
  });

const strict = makeLimiter(5);    // password, email change, delete account
const moderate = makeLimiter(10); // log out everywhere, data download

router.get("/profile", account.getProfile);
router.put("/profile", account.updateProfile);

router.post("/avatar", restrictTo("user"), upload.single("avatar"), account.uploadAvatar);
router.delete("/avatar", restrictTo("user"), account.removeAvatar);

router.put("/password", strict, account.changePassword);

router.get("/preferences", account.getPreferences);
router.put("/preferences", account.updatePreferences);

router.post("/accept-terms", account.acceptTerms);

// Security
router.get("/sessions", security.sessions);
router.post("/logout-all", moderate, security.logoutAll);
router.post("/email/request", strict, security.requestEmailChange);
router.post("/email/confirm", security.confirmEmailChange);

// Your data
router.get("/export", moderate, dataExport.download);

router.delete("/", strict, restrictTo("user", "artisan"), account.deleteAccount);

module.exports = router;