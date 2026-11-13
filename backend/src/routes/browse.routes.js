const router = require("express").Router();
const browse = require("../controllers/browse.controller");
const jobRoles = require("../controllers/jobRole.controller");

router.get("/", browse.browse);
router.get("/meta", browse.meta);     // must stay above "/:id"
router.get("/roles", jobRoles.publicList); // must stay above "/:id"
router.get("/:id", browse.getArtisan);
router.get("/:id/reviews", browse.getReviews);
router.get("/:id/availability", browse.getAvailability);

module.exports = router;