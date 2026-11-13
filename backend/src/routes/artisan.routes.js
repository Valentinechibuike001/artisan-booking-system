const router = require("express").Router();
const upload = require("../middleware/upload");
const { loadArtisanProfile, requireApproved } = require("../middleware/artisan");
const artisan = require("../controllers/artisan.controller");
const bookings = require("../controllers/artisanBooking.controller");
const artisanReviews = require("../controllers/artisanReview.controller");
const artisanDisputes = require("../controllers/artisanDispute.controller");
const reports = require("../controllers/report.controller");
const blocks = require("../controllers/block.controller");
const earnings = require("../controllers/earnings.controller");
const roleRequests = require("../controllers/roleRequest.controller");
const receipts = require("../controllers/receipt.controller");

router.get("/ping", (req, res) => res.json({ part: "artisan", ok: true }));

// Everything below needs the artisan's profile loaded
router.use(loadArtisanProfile);

router.get("/profile", artisan.getMyProfile);
router.put("/profile", artisan.updateProfile);
router.put("/bank", artisan.updateBank);
router.patch("/availability", artisan.setAvailability);
router.put("/buffer", artisan.setBuffer);
router.post("/resubmit", artisan.resubmit);

router.post("/services", artisan.addService);
router.put("/services/:serviceId", artisan.updateService);
router.delete("/services/:serviceId", artisan.deleteService);

router.put("/schedule", artisan.setSchedule);
router.post("/blocked-dates", artisan.addBlockedDates);
router.delete("/blocked-dates/:date", artisan.removeBlockedDate);

router.post("/avatar", upload.single("avatar"), artisan.uploadAvatar);
router.post("/portfolio", upload.array("images", 5), artisan.addPortfolio);
router.delete("/portfolio/:imageId", artisan.deletePortfolioImage);

// Bookings (acting on them needs an approved account)
router.get("/bookings", bookings.listBookings);
router.get("/bookings/stats", bookings.stats); // must stay above "/bookings/:id"
router.get("/bookings/:id", bookings.getBooking);
router.post("/bookings/:id/accept", requireApproved, bookings.accept);
router.post("/bookings/:id/decline", requireApproved, bookings.decline);
router.post("/bookings/:id/complete", requireApproved, bookings.complete);
router.post("/bookings/:id/cancel", requireApproved, bookings.cancel);

// Reviews
router.get("/reviews", artisanReviews.list);
router.put("/reviews/:reviewId/reply", artisanReviews.reply);
router.post("/reviews/:reviewId/flag", artisanReviews.flag);

// Disputes (an artisan can always respond, even if suspended)
router.get("/disputes", artisanDisputes.list);
router.get("/disputes/:id", artisanDisputes.getOne);
router.post("/disputes/:id/respond", upload.array("evidence", 3), artisanDisputes.respond);

// Reporting and blocking students
router.post("/bookings/:id/report-student", reports.reportStudent);
router.post("/bookings/:id/block-student", blocks.artisanBlock);
router.get("/blocks", blocks.artisanList);
router.delete("/blocks/:userId", blocks.artisanUnblock);

// Earnings
router.get("/earnings", earnings.summary);
router.get("/earnings/payments", earnings.payments);
router.get("/earnings/payouts", earnings.payouts);
// Job role change requests
router.get("/role-requests", roleRequests.list);
router.post("/role-requests", requireApproved, roleRequests.create);
router.post("/role-requests/:id/cancel", roleRequests.cancel);
// Money statement for one job
router.get("/bookings/:id/statement", receipts.artisanStatement);

module.exports = router;