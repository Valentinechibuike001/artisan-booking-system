const crypto = require("crypto");

const getKey = () => Buffer.from(process.env.ENCRYPTION_KEY, "hex");

// Turns "12345678901" into unreadable text for the database
const encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
};

// Turns it back (only the admin NIN check will use this)
const decrypt = (payload) => {
  const [iv, tag, data] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]).toString("utf8");
};

// One-way fingerprint, used to detect the same NIN being registered twice
const hashValue = (value) =>
  crypto.createHmac("sha256", process.env.ENCRYPTION_KEY).update(String(value)).digest("hex");

module.exports = { encrypt, decrypt, hashValue };

