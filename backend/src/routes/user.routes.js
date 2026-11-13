const router = require("express").Router();
const upload = require("../middleware/upload");
const user = require("../controllers/user.controller");
const booking = require("../controllers/booking.controller");
const payment = require("../controllers/payment.controller");
const reviews = require("../controllers/review.controller");
const disputes = require("../controllers/dispute.controller");
const reports = require("../controllers/report.controller");
const blocks = require("../controllers/block.controller");
const receipts = require("../controllers/receipt.controller");

router.get("/ping", (req, res) => res.json({ part: "user", ok: true }));

// Saved artisans
router.get("/saved", user.getSaved);
router.post("/saved/:artisanId", user.saveArtisan);
router.delete("/saved/:artisanId", user.unsaveArtisan);

// Bookings
router.post("/bookings", booking.createBooking);
router.get("/bookings", booking.listMyBookings);
router.get("/bookings/stats", booking.myStats); // must stay above "/bookings/:id"
router.get("/bookings/:id", booking.getBooking);
router.post("/bookings/:id/cancel", booking.cancelBooking);
router.post("/bookings/:id/confirm", booking.confirmBooking);

// Payments
router.post("/bookings/:id/pay", payment.initiate);
router.get("/payments/verify", payment.verify);

// Reviews
router.post("/bookings/:id/review", upload.array("photos", 3), reviews.createReview);
router.put("/reviews/:reviewId", reviews.updateReview);

// Disputes ("Report problem")
router.post("/bookings/:id/dispute", upload.array("evidence", 4), disputes.create);
router.get("/disputes", disputes.list);
router.get("/disputes/:id", disputes.getOne);

// Reporting and blocking artisans
router.post("/artisans/:artisanId/report", reports.reportArtisan);
router.get("/blocks", blocks.studentList);
router.post("/blocks", blocks.studentBlock);
router.delete("/blocks/:artisanId", blocks.studentUnblock);
// Receipts
router.get("/bookings/:id/receipt", receipts.userReceipt);

// Helpful votes on reviews
router.post("/reviews/:reviewId/helpful", reviews.markHelpful);
router.delete("/reviews/:reviewId/helpful", reviews.unmarkHelpful);


module.exports = router;