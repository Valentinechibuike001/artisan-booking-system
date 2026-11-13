const mongoose = require("mongoose");
const { Booking } = require("../models");
const { publicName } = require("./artisanPublic");
const { calcFees } = require("./payments");
const { dateKey } = require("./time");
const C = require("./constants");
const { canReportBooking } = require("./disputeHelpers");
const { releaseLocks, RELEASING } = require("./slotLocks");

// Phone numbers and room details are shared only once a job is accepted
const CONTACT_STATUSES = ["accepted", "completed", "confirmed", "disputed"];

const populateArtisan = {
  path: "artisan",
  select: "occupation avatar user",
  populate: { path: "user", select: "fullName phone" },
};
const populateStudent = { path: "user", select: "fullName phone hostel avatar" };

// Changes a booking's status in ONE database step, only if it is still in an
// allowed "from" status. This stops double taps and two people acting at once.
const transition = async ({ id, owner = {}, from, to, by, note, set = {} }) => {
  const booking = await Booking.findOneAndUpdate(
    { _id: id, status: { $in: from }, ...owner },
    {
      $set: { status: to, ...set },
      $push: { statusHistory: { status: to, at: new Date(), by, note } },
    },
    { new: true }
  );

  // A booking that will never happen gives its time slot back
  if (booking && RELEASING.includes(to)) await releaseLocks(booking._id);
  return booking;
};
// Same, but explains why when it fails
const move = async (opts) => {
  if (!mongoose.isValidObjectId(opts.id)) return { code: 404, message: "Booking not found" };
  const booking = await transition(opts);
  if (booking) return { booking };

  const current = await Booking.findOne({ _id: opts.id, ...(opts.owner || {}) }).select("status");
  if (!current) return { code: 404, message: "Booking not found" };
  return {
    code: 409,
    message: `This booking is currently "${current.status.replace("_", " ")}", so that action isn't possible`,
  };
};

// Refund percent when the STUDENT cancels a paid booking
const studentCancelPercent = (b) =>
  b.status === "accepted" &&
  b.startsAt.getTime() - Date.now() < C.FREE_CANCEL_HOURS * 60 * 60 * 1000
    ? C.LATE_CANCEL_REFUND_PERCENT
    : 100;

const timeline = (b) =>
  b.statusHistory.map((h) => ({ status: h.status, at: h.at, note: h.note || null }));

// What a STUDENT sees (b.artisan must be populated with populateArtisan)
const userView = (b, payment, review, dispute) => {
  const now = Date.now();
  const a = b.artisan;
  const owner = a && a.user;
  const contactOpen = CONTACT_STATUSES.includes(b.status);
  const canCancel =
    ["awaiting_payment", "pending"].includes(b.status) ||
    (b.status === "accepted" && b.startsAt.getTime() > now);

  return {
    id: b._id,
    status: b.status,
    createdAt: b.createdAt,
    artisan: a
      ? {
          id: a._id,
          name: publicName(owner ? owner.fullName : ""),
          occupation: a.occupation,
          avatar: a.avatar && a.avatar.url ? a.avatar.url : null,
          phone: contactOpen && owner ? owner.phone : null,
        }
      : null,
    service: b.service,
    date: dateKey(b.date),
    time: b.time,
    startsAt: b.startsAt,
    endsAt: b.endsAt || null,
    description: b.description,
    locationNote: b.locationNote || null,
     review: review ? { id: review._id, rating: review.rating } : null,
    canReview:
      b.status === "confirmed" &&
      !review &&
      (!b.confirmedAt ||
     now - b.confirmedAt.getTime() <= C.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    dispute: dispute ? { id: dispute._id, status: dispute.status } : null,
    canReport: !dispute && canReportBooking(b, now),
    price: b.price,
    payment: payment
      ?   {
          status: payment.status,
          amount: payment.amount,
          refundedAmount: payment.refundedAmount,
          refundStatus: payment.refundStatus,
        }
      : null,
    paymentDeadline: b.status === "awaiting_payment" ? b.paymentDeadline : null,
    canPay:
      b.status === "awaiting_payment" && !!b.paymentDeadline && b.paymentDeadline.getTime() > now,
    canCancel,
    cancelRefundPercent:
      canCancel && b.status !== "awaiting_payment" ? studentCancelPercent(b) : null,
    canConfirm:
      b.status === "completed" || (b.status === "accepted" && b.startsAt.getTime() <= now),
    disputeWindowEndsAt: b.disputeWindowEndsAt || null,
    timeline: timeline(b),
  };
};

// What an ARTISAN sees (b.user must be populated with populateStudent)
const artisanView = (b) => {
  const now = Date.now();
  const u = b.user;
  const contactOpen = CONTACT_STATUSES.includes(b.status);

  return {
    id: b._id,
    status: b.status,
    createdAt: b.createdAt,
    student: {
      name: publicName(u ? u.fullName : ""),
      hostel: u ? u.hostel || null : null,
      avatar: u && u.avatar && u.avatar.url ? u.avatar.url : null,
      phone: contactOpen && u ? u.phone : null,
    },
    service: b.service,
    date: dateKey(b.date),
    time: b.time,
    startsAt: b.startsAt,
     endsAt: b.endsAt || null,
    description: b.description,
    locationNote: contactOpen ? b.locationNote || null : null,
    price: b.price,
    youEarn: calcFees(b.price).artisanAmount,
    respondBy:
      b.status === "pending" && b.paidAt
        ? new Date(b.paidAt.getTime() + C.ARTISAN_RESPONSE_HOURS * 60 * 60 * 1000)
        : null,
    canAccept: b.status === "pending" && b.startsAt.getTime() > now,
    canDecline: b.status === "pending",
    canComplete: b.status === "accepted" && b.startsAt.getTime() <= now,
    canCancel: b.status === "accepted" && b.startsAt.getTime() > now,
    disputeWindowEndsAt: b.disputeWindowEndsAt || null,
    timeline: timeline(b),
  };
};

module.exports = {
  transition, move, studentCancelPercent, userView, artisanView,
  populateArtisan, populateStudent,
};