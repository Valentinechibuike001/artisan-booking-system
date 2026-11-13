const { AuditLog } = require("../models");

// Records what an admin did. It never throws, so it can't break the real action.
const logAction = async (req, action, { targetType, targetId, summary, meta } = {}) => {
  try {
    await AuditLog.create({ admin: req.user._id, action, targetType, targetId, summary, meta });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};

module.exports = { logAction };