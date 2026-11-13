const mongoose = require("mongoose");
const { Notification } = require("../models");

const view = (n) => ({
  id: n._id,
  type: n.type,
  title: n.title,
  message: n.message || "",
  link: n.link || null,
  isRead: n.isRead,
  createdAt: n.createdAt,
});

// GET /api/notifications?unread=true&page=1&limit=20
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = { user: req.user._id };
    if (req.query.unread === "true") filter.isRead = false;

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.json({
      notifications: items.map(view),
      page,
      total,
      pages: Math.ceil(total / limit),
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/unread-count
exports.unreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json({ unreadCount });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const n = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!n) return res.status(404).json({ message: "Notification not found" });

    res.json({ notification: view(n) });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );
    res.json({ message: "All notifications marked as read", updated: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/:id
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const result = await Notification.deleteOne({ _id: id, user: req.user._id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification deleted" });
  } catch (err) {
    next(err);
  }
};