const router = require("express").Router();
const notifications = require("../controllers/notification.controller");

router.get("/", notifications.list);
router.get("/unread-count", notifications.unreadCount); // must stay above "/:id" routes
router.post("/read-all", notifications.markAllRead);
router.patch("/:id/read", notifications.markRead);
router.delete("/:id", notifications.remove);

module.exports = router;