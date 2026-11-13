const router = require("express").Router();
const C = require("../utils/constants");

// GET /api/legal   (public: the app uses these links in sign-up and in the footer)
router.get("/", (req, res) => {
  const site = String(process.env.CLIENT_URL || "").replace(/\/$/, "");
  res.json({
    version: C.LEGAL_VERSION,
    termsUrl: `${site}/terms`,
    privacyUrl: `${site}/privacy`,
    refundPolicyUrl: `${site}/refund-policy`,
  });
});

module.exports = router;