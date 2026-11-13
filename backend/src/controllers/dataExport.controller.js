const {
  ArtisanProfile, Booking, Payment, Payout, Review, Message,
  Dispute, Report, Notification, RoleRequest,
} = require("../models");

const LIMIT = 1000;

const newest = { createdAt: -1 };

// GET /api/account/export   (the person's own data, as a file)
exports.download = async (req, res, next) => {
  try {
    const user = req.user;

    const data = {
      exportedAt: new Date(),
      note: "This file holds the personal data UNN Artisans keeps about you. It never includes passwords, your encrypted NIN, full bank numbers, or other people's private details.",
      account: {
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        hostel: user.hostel || null,
        schoolEmail: user.schoolEmail || null,
        joinedAt: user.createdAt,
        emailVerified: user.isEmailVerified,
        termsVersion: user.termsVersion || null,
        termsAcceptedAt: user.termsAcceptedAt || null,
        emailPreferences: user.emailPrefs || null,
      },
      recentLogins: (user.loginHistory || []).map((h) => ({ at: h.at, ip: h.ip || null, device: h.device || null })),
    };

    const [notifications, messagesSent, reportsMade] = await Promise.all([
      Notification.find({ user: user._id }).sort(newest).limit(200).select("type title message createdAt").lean(),
      Message.find({ sender: user._id }).sort(newest).limit(LIMIT).select("booking text image.url createdAt").lean(),
      Report.find({ reporter: user._id }).sort(newest).limit(200).select("reason details status createdAt").lean(),
    ]);
    data.notifications = notifications;
    data.messagesSent = messagesSent;
    data.reportsMade = reportsMade;

    if (user.role === "user") {
      const [bookings, payments, reviews, disputes] = await Promise.all([
        Booking.find({ user: user._id }).sort(newest).limit(LIMIT).select("service price date time status createdAt").lean(),
        Payment.find({ user: user._id }).sort(newest).limit(LIMIT).select("amount refundedAmount status reference paidAt").lean(),
        Review.find({ user: user._id }).sort(newest).limit(LIMIT).select("rating comment artisanReply createdAt").lean(),
        Dispute.find({ raisedBy: user._id }).sort(newest).limit(200).select("category reason status resolution refundAmount createdAt").lean(),
      ]);
      data.student = {
        savedArtisansCount: (user.savedArtisans || []).length,
        blockedCount: (user.blockedUsers || []).length,
        bookings,
        payments,
        reviewsWritten: reviews,
        problemsReported: disputes,
      };
    }

    if (user.role === "artisan") {
      const profile = await ArtisanProfile.findOne({ user: user._id }).select("+accountNumber").lean();
      if (profile) {
        const [bookings, payments, payouts, reviews, disputes, roleRequests] = await Promise.all([
          Booking.find({ artisan: profile._id }).sort(newest).limit(LIMIT).select("service price date time status createdAt").lean(),
          Payment.find({ artisan: profile._id }).sort(newest).limit(LIMIT).select("amount platformFee artisanAmount refundedAmount status paidAt").lean(),
          Payout.find({ artisan: profile._id }).sort(newest).limit(200).select("amount status bankName accountLast4 paidAt transferReference createdAt").lean(),
          Review.find({ artisan: profile._id, isHidden: false }).sort(newest).limit(LIMIT).select("rating comment artisanReply createdAt").lean(),
          Dispute.find({ artisan: profile._id }).sort(newest).limit(200).select("category reason status resolution refundAmount createdAt").lean(),
          RoleRequest.find({ user: user._id }).sort(newest).limit(50).select("currentOccupation requestedOccupation reason status adminNote createdAt").lean(),
        ]);

        data.artisan = {
          profile: {
            occupation: profile.occupation,
            category: profile.category,
            bio: profile.bio || "",
            address: profile.address,
            baseArea: profile.baseArea || null,
            serviceAreas: profile.serviceAreas || [],
            startingPrice: profile.startingPrice,
            bufferMinutes: profile.bufferMinutes,
            status: profile.status,
            ratingAverage: profile.ratingAverage,
            ratingCount: profile.ratingCount,
            jobsCompleted: profile.jobsCompleted,
            joinedAt: profile.createdAt,
            nin: "Stored encrypted. Contact support if you need to see it.",
            bank: { bankName: profile.bankName, accountLast4: String(profile.accountNumber || "").slice(-4) },
            services: (profile.services || []).map((s) => ({
              name: s.name,
              description: s.description || "",
              price: s.price,
              durationMinutes: s.durationMinutes,
              isActive: s.isActive,
            })),
            portfolio: (profile.portfolio || []).map((i) => ({ url: i.url, caption: i.caption || "" })),
          },
          bookings,
          earnings: payments,
          payouts,
          reviewsReceived: reviews,
          disputesAboutYou: disputes,
          roleChangeRequests: roleRequests,
        };
      }
    }

    res.setHeader("Content-Disposition", 'attachment; filename="my-unn-artisans-data.json"');
    res.json(data);
  } catch (err) {
    next(err);
  }
};