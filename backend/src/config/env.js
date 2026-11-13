const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "CLIENT_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "PAYSTACK_SECRET_KEY",
];

const isEmpty = (key) => !String(process.env[key] || "").trim();

// Email works with either your own provider (SMTP_*) or Gmail (EMAIL_*)
const emailKeys = () => (process.env.SMTP_HOST ? ["SMTP_USER", "SMTP_PASS"] : ["EMAIL_USER", "EMAIL_PASS"]);

// Checks the .env settings when the server starts, so a mistake shows up straight away
const checkEnv = () => {
  const production = process.env.NODE_ENV === "production";
  const fatal = [];
  const warnings = [];

  const missing = [...REQUIRED, ...emailKeys()].filter(isEmpty);
  if (missing.length > 0) {
    const message = `Missing settings: ${missing.join(", ")}`;
    (production ? fatal : warnings).push(message);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(String(process.env.ENCRYPTION_KEY || ""))) {
    fatal.push("ENCRYPTION_KEY must be exactly 64 hex characters (see Step 2.1)");
  }

  if (production) {
    if (String(process.env.JWT_SECRET || "").length < 32) {
      fatal.push("JWT_SECRET is too short. Use at least 32 random characters.");
    }
    if (/localhost|127\.0\.0\.1/.test(String(process.env.MONGO_URI || ""))) {
      fatal.push("MONGO_URI points to your own computer. Use your Atlas connection string.");
    }
    if (!String(process.env.CLIENT_URL || "").startsWith("https://")) {
      warnings.push("CLIENT_URL should start with https:// in production");
    }
    if (!String(process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_live_")) {
      warnings.push("PAYSTACK_SECRET_KEY is not a live key. Real payments will not work (fine for staging).");
    }
    if (!process.env.TRUST_PROXY) {
      warnings.push("TRUST_PROXY is not set. Rate limits will see every visitor as one person. Set TRUST_PROXY=1 on Render.");
    }
    if (!process.env.SMTP_HOST) {
      warnings.push("You are sending email through Gmail, which allows only a few hundred emails a day. Use a mail provider before launch.");
    }
    if (process.env.SMTP_HOST && isEmpty("EMAIL_FROM")) {
      warnings.push("EMAIL_FROM is not set. Set it to something like: UNN Artisans <noreply@yourdomain.com>");
    }
  }

  warnings.forEach((w) => console.warn("Warning:", w));

  if (fatal.length > 0) {
    fatal.forEach((f) => console.error("Fatal:", f));
    process.exit(1);
  }
};

module.exports = { checkEnv };