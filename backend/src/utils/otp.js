const crypto = require("crypto");

// Random 6-digit code, e.g. "482913"
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// We store a hash, never the code itself
const hashOtp = (otp) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(otp).digest("hex");

const verifyOtpHash = (otp, storedHash) => {
  const a = Buffer.from(hashOtp(otp));
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { generateOtp, hashOtp, verifyOtpHash };