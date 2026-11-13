const C = require("./constants");

// Older accounts that accepted terms before we tracked versions count as version 1.0
const acceptedVersion = (user) => user.termsVersion || (user.termsAcceptedAt ? "1.0" : null);

// Should the app ask this person to accept the current Terms and Privacy Policy?
const needsTerms = (user) => user.role !== "admin" && acceptedVersion(user) !== C.LEGAL_VERSION;

module.exports = { acceptedVersion, needsTerms };