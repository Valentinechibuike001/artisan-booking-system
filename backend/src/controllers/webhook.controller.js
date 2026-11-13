const crypto = require("crypto");
const { processSuccessfulCharge } = require("../utils/paymentProcessor");
const { getSecretKey } = require("../utils/paystack");

// Is this message really from Paystack?
const signatureIsValid = (rawBody, signature) => {
  const secretKey = getSecretKey();
  if (!rawBody || !signature || !secretKey) return false;

  const expected = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// POST /api/payments/webhook
exports.paystackWebhook = async (req, res) => {
  if (!signatureIsValid(req.rawBody, req.headers["x-paystack-signature"])) {
    return res.status(401).json({ message: "Invalid signature" });
  }

  try {
    const event = req.body;
    if (event && event.event === "charge.success" && event.data && event.data.status === "success") {
      await processSuccessfulCharge(event.data);
    }
    res.sendStatus(200); // tell Paystack we got it
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(500); // Paystack will try again later
  }
};