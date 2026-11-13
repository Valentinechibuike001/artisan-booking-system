const router = require("express").Router();
const paystack = require("../utils/paystack");

// GET /api/banks   (public: fills the bank dropdown at sign-up and in the bank form)
router.get("/", async (req, res, next) => {
  try {
    const banks = await paystack.listBanks();

    const list = banks
      .filter((b) => b && b.name && b.code && b.active !== false && b.is_deleted !== true)
      .map((b) => ({ name: b.name, code: String(b.code) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ banks: list });
  } catch (err) {
    next(err);
  }
});

module.exports = router;