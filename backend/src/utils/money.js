// 3000 -> "₦3,000"
const naira = (value) => `₦${Number(value || 0).toLocaleString("en-NG")}`;

module.exports = { naira };