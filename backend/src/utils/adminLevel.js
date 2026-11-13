// "super" or "support" for an admin, and null for anyone else
const levelOf = (user) => (user && user.role === "admin" ? user.adminLevel || "super" : null);

const isSuper = (user) => levelOf(user) === "super";

module.exports = { levelOf, isSuper };