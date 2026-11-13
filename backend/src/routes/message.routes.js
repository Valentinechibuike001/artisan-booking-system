const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const upload = require("../middleware/upload");
const messages = require("../controllers/message.controller");
const reports = require("../controllers/report.controller");

// At most 20 messages per minute per person
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user._id),
  message: { message: "You're sending messages too fast. Please slow down." },
});

router.get("/", messages.inbox);
router.get("/unread-count", messages.unreadCount); // must stay above "/:bookingId"
router.get("/quick-replies", messages.quickReplies); // must stay above "/:bookingId"
router.get("/:bookingId", messages.getMessages);
router.post("/:bookingId", sendLimiter, messages.sendMessage);
router.post("/:bookingId/image", sendLimiter, upload.single("image"), messages.sendImage);
router.post("/:bookingId/:messageId/report", reports.reportMessage);

module.exports = router;