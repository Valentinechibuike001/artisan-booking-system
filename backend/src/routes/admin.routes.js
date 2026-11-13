const router = require("express").Router();
const { requireSuper } = require("../middleware/auth");
const dashboard = require("../controllers/adminDashboard.controller");
const admins = require("../controllers/adminAdmins.controller");
const artisans = require("../controllers/adminArtisan.controller");
const roleRequests = require("../controllers/adminRoleRequest.controller");
const jobRoles = require("../controllers/jobRole.controller");
const disputes = require("../controllers/adminDispute.controller");
const payments = require("../controllers/adminPayment.controller");
const payouts = require("../controllers/adminPayout.controller");
const reports = require("../controllers/adminReport.controller");
const reviews = require("../controllers/adminReview.controller");
const students = require("../controllers/adminStudent.controller");
const bookings = require("../controllers/adminBooking.controller");
const exportsCtrl = require("../controllers/adminExport.controller");

router.get("/ping", (req, res) => res.json({ part: "admin", ok: true }));

// Only super admins can touch money, the audit log or the admin team
router.use("/payments", requireSuper);
router.use("/payouts", requireSuper);
router.use("/admins", requireSuper);
router.use("/audit-logs", requireSuper);

router.get("/dashboard", dashboard.stats);
router.get("/audit-logs", dashboard.auditLogs);

// Admin team
router.get("/admins", admins.list);
router.post("/admins", admins.create);
router.patch("/admins/:id", admins.update);

// Artisans (support can look, super admins decide)
router.get("/artisans", artisans.list);
router.get("/artisans/:id", artisans.getOne);
router.post("/artisans/:id/approve", requireSuper, artisans.approve);
router.post("/artisans/:id/reject", requireSuper, artisans.reject);
router.post("/artisans/:id/suspend", requireSuper, artisans.suspend);
router.post("/artisans/:id/reinstate", requireSuper, artisans.reinstate);
router.patch("/artisans/:id/verification", requireSuper, artisans.setVerification);
router.put("/artisans/:id/role", artisans.updateRole);

// Job role change requests
router.get("/role-requests", roleRequests.list);
router.get("/role-requests/:id", roleRequests.getOne);
router.post("/role-requests/:id/approve", roleRequests.approve);
router.post("/role-requests/:id/reject", roleRequests.reject);

// Job roles list
router.get("/job-roles", jobRoles.list);
router.post("/job-roles", requireSuper, jobRoles.create);
router.put("/job-roles/:id", requireSuper, jobRoles.update);

// Students
router.get("/students", students.list);
router.get("/students/:id", students.getOne);
router.post("/students/:id/suspend", students.suspend);
router.post("/students/:id/reinstate", students.reinstate);

// Bookings
router.get("/bookings", bookings.list);
router.get("/bookings/:id", bookings.getOne);

// Disputes (only super admins decide)
router.get("/disputes", disputes.list);
router.get("/disputes/:id", disputes.getOne);
router.post("/disputes/:id/resolve", requireSuper, disputes.resolve);

// Reports about people
router.get("/reports", reports.list);
router.get("/reports/:id", reports.getOne);
router.post("/reports/:id/resolve", reports.resolve);

// Reviews
router.get("/reviews", reviews.list);
router.post("/reviews/:id/hide", reviews.hide);
router.post("/reviews/:id/unhide", reviews.unhide);
router.post("/reviews/:id/dismiss-flag", reviews.dismissFlag);

// Payments (super admins only, see router.use above)
router.get("/payments/summary", payments.summary); // must stay above "/payments/:id"
router.get("/payments/export", exportsCtrl.payments); // must stay above "/payments/:id"
router.get("/payments", payments.list);
router.get("/payments/:id", payments.getOne);
router.post("/payments/:id/retry-refund", payments.retryRefund);
router.post("/payments/:id/refund-handled", payments.refundHandled);

// Payouts (super admins only, see router.use above)
router.get("/payouts/payable", payouts.payable); // must stay above "/payouts/:id"
router.get("/payouts/export", exportsCtrl.payouts); // must stay above "/payouts/:id"
router.post("/payouts", payouts.create);
router.get("/payouts", payouts.list);
router.get("/payouts/:id", payouts.getOne);
router.post("/payouts/:id/verify-account", payouts.verifyAccount);
router.post("/payouts/:id/mark-paid", payouts.markPaid);
router.post("/payouts/:id/cancel", payouts.cancel);

module.exports = router;