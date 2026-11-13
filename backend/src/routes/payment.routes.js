const router = require("express").Router();
const webhook = require("../controllers/webhook.controller");

router.post("/webhook", webhook.paystackWebhook);

module.exports = router;