const { Dispute, ArtisanProfile } = require("../models");
const C = require("./constants");
const notify = require("./notify");

const DAY = 24 * 60 * 60 * 1000;

// Called after an admin decides a dispute in the student's favour.
// Warns the admins when an artisan keeps losing disputes, and can suspend them.
const checkDisputeRate = async (artisanId) => {
  try {
    const since = new Date(Date.now() - C.DISPUTE_RATE_DAYS * DAY);
    const upheld = await Dispute.countDocuments({
      artisan: artisanId,
      status: "resolved",
      resolution: "refund_user",
      resolvedAt: { $gte: since },
    });
    if (upheld < C.DISPUTE_ALERT_THRESHOLD) return;

    const profile = await ArtisanProfile.findById(artisanId).populate("user", "fullName");
    if (!profile || !profile.user) return;

    let suspended = false;
    if (C.AUTO_SUSPEND_UPHELD_DISPUTES > 0 && upheld >= C.AUTO_SUSPEND_UPHELD_DISPUTES) {
      const reason = `Suspended automatically after ${upheld} disputes decided in students' favour in ${C.DISPUTE_RATE_DAYS} days.`;
      const result = await ArtisanProfile.findOneAndUpdate(
        { _id: artisanId, status: "approved" },
        { $set: { status: "suspended", suspensionReason: reason, reviewedAt: new Date() } },
        { new: true }
      );
      if (result) {
        suspended = true;
        notify(profile.user._id, {
          type: "artisan_suspended",
          title: "Your account was suspended",
          message: `Reason: ${reason} Please contact support.`,
          link: "/artisan/dashboard",
        });
      }
    }

    notify.notifyAdmins({
      type: "risk_alert",
      title: "Artisan with repeated disputes",
      message: `${profile.user.fullName} has ${upheld} disputes decided against them in ${C.DISPUTE_RATE_DAYS} days.${suspended ? " They were suspended automatically." : ""}`,
      link: `/admin/artisans/${artisanId}`,
    });
  } catch (err) {
    console.error("Dispute rate check failed:", err.message);
  }
};

module.exports = { checkDisputeRate };