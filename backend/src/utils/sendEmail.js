const nodemailer = require("nodemailer");

let transporter; // created the first time we need it, then reused

// Uses your own mail provider if SMTP_HOST is set, otherwise Gmail
const getTransporter = () => {
  if (!transporter) {
    if (process.env.SMTP_HOST) {
      const port = Number(process.env.SMTP_PORT) || 587;
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    } else {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
    }
  }
  return transporter;
};

// The "From" line on every email
const sender = () => process.env.EMAIL_FROM || `"UNN Artisans" <${process.env.EMAIL_USER}>`;

// Makes text safe to put inside an HTML email
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sendOtpEmail = async (to, name, otp, purpose = "verify") => {
  const minutes = process.env.OTP_EXPIRES_MINUTES || 10;

  const copy = {
    verify: {
      subject: "Your UNN Artisans verification code",
      intro: "Your verification code is:",
      footer: `It expires in ${minutes} minutes. If you didn't sign up, ignore this email.`,
    },
    reset: {
      subject: "Reset your UNN Artisans password",
      intro: "Use this code to reset your password:",
      footer: `It expires in ${minutes} minutes. If you didn't ask to reset your password, ignore this email. Your password is unchanged.`,
    },
    email_change: {
      subject: "Confirm your new email address",
      intro: "Use this code to confirm your new email address:",
      footer: `It expires in ${minutes} minutes. If you didn't ask to change your email, ignore this email.`,
    },
  }[purpose] || {
    subject: "Your UNN Artisans code",
    intro: "Your code is:",
    footer: `It expires in ${minutes} minutes.`,
  };

  await getTransporter().sendMail({
    from: sender(),
    to,
    subject: copy.subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px">
        <h2>Hi ${escapeHtml(name)},</h2>
        <p>${copy.intro}</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px">${escapeHtml(otp)}</p>
        <p>${copy.footer}</p>
      </div>`,
  });
};

// A short email about something that happened on the person's account
const sendNotificationEmail = async (to, name, { title, message, link }) => {
  const url = `${process.env.CLIENT_URL || ""}${link || ""}`;

  await getTransporter().sendMail({
    from: sender(),
    to,
    subject: title,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px">
        <h2>Hi ${escapeHtml(name)},</h2>
        <p style="font-size:16px">${escapeHtml(message)}</p>
        <p>
          <a href="${escapeHtml(url)}" style="background:#1f6feb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">
            Open UNN Artisans
          </a>
        </p>
        <p style="color:#777777;font-size:12px">You received this email because of activity on your UNN Artisans account.</p>
      </div>`,
  });
};

module.exports = { sendOtpEmail, sendNotificationEmail };