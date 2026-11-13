const COLLAPSE = /(\d)[\s.\-()]+(?=\d)/g; // joins "0801 234-5678" into "08012345678"
const NIGERIAN_NUMBER = /(?:\+?234|0)[789][01]\d{8}/;
const LONG_NUMBER = /\d{11,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const APP_WORDS = /\b(whats\s?app|telegram)\b/i;

const CONTACT_BLOCKED_MESSAGE =
  "For your safety, please don't share phone numbers or contact details until the artisan accepts the booking.";

// Does this text contain a phone number, an email address or a messaging app name?
const containsContactInfo = (text) => {
  const original = String(text || "");
  const squeezed = original.replace(COLLAPSE, "$1");
  return (
    NIGERIAN_NUMBER.test(squeezed) ||
    LONG_NUMBER.test(squeezed) ||
    EMAIL.test(original) ||
    APP_WORDS.test(original)
  );
};

module.exports = { containsContactInfo, CONTACT_BLOCKED_MESSAGE };