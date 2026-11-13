const jwt = require("jsonwebtoken");
const { User } = require("../models");
const { isSuper } = require("../utils/adminLevel");

// Was this login token made before the person changed their password or logged out everywhere?
const tokenIsStale = (decoded, user) => {
  const times = [user.passwordChangedAt, user.sessionsValidFrom]
    .filter(Boolean)
    .map((d) => Math.floor(d.getTime() / 1000));
  if (times.length === 0) return false;
  return decoded.iat < Math.max(...times);
};

// Checks the login token and loads the user
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
    if (!token) return res.status(401).json({ message: "Please log in" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Account not found or disabled" });
    }

    if (tokenIsStale(decoded, user)) {
      return res.status(401).json({ message: "Please log in again" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expired, please log in again" });
  }
};

// Only lets certain roles through: restrictTo("admin")
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "You don't have access to this" });
  }
  next();
};

// Like protect, but never blocks: attaches req.user if a valid token is sent
const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user && user.isActive && !tokenIsStale(decoded, user)) req.user = user;
    }
  } catch (err) {
    // bad or expired token: carry on as a guest
  }
  next();
};

// Lets only super admins through
const requireSuper = (req, res, next) => {
  if (!isSuper(req.user)) {
    return res.status(403).json({ message: "Only a super admin can do this" });
  }
  next();
};

module.exports = { protect, restrictTo, optionalAuth, requireSuper };