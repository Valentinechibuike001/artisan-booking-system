const { publicName } = require("./artisanPublic");
const { dateKey } = require("./time");

const CATEGORIES = ["not_done", "poor_quality", "no_show", "overcharged", "damage", "other"];

// Can the student still report a problem with this booking?
const canReportBooking = (b, now = Date.now()) => {
  if (b.status === "accepted") return b.startsAt.getTime() <= now;
  if (["completed", "confirmed"].includes(b.status)) {
    return Boolean(b.disputeWindowEndsAt) && b.disputeWindowEndsAt.getTime() > now;
  }
  return false;
};

const urls = (list) => (list || []).map((p) => p.url);

const bookingSummary = (b) =>
  b
    ? {
        id: b._id,
        serviceName: b.service ? b.service.name : null,
        date: b.date ? dateKey(b.date) : null,
        time: b.time || null,
      }
    : null;

const responseView = (d) =>
  d.artisanResponse && d.artisanResponse.text
    ? {
        text: d.artisanResponse.text,
        photos: urls(d.artisanResponse.evidence),
        respondedAt: d.artisanResponse.respondedAt,
      }
    : null;

const resolutionView = (d) =>
  d.status === "resolved"
    ? {
        decision: d.resolution,
        refundAmount: d.refundAmount || 0,
        note: d.adminNote || null,
        resolvedAt: d.resolvedAt,
      }
    : null;

// What the STUDENT sees (d.booking and d.artisan.user must be populated)
const studentDisputeView = (d) => {
  const artisanUser = d.artisan && d.artisan.user;
  return {
    id: d._id,
    status: d.status,
    category: d.category,
    reason: d.reason,
    photos: urls(d.evidence),
    createdAt: d.createdAt,
    booking: bookingSummary(d.booking),
    artisan: { name: publicName(artisanUser ? artisanUser.fullName : "") },
    artisanResponse: responseView(d),
    resolution: resolutionView(d),
  };
};

// What the ARTISAN sees (d.booking and d.raisedBy must be populated)
const artisanDisputeView = (d) => ({
  id: d._id,
  status: d.status,
  category: d.category,
  reason: d.reason,
  photos: urls(d.evidence),
  createdAt: d.createdAt,
  booking: bookingSummary(d.booking),
  student: { name: publicName(d.raisedBy ? d.raisedBy.fullName : "") },
  needsResponse: d.status === "open" && !(d.artisanResponse && d.artisanResponse.text),
  myResponse: responseView(d),
  resolution: resolutionView(d),
});

module.exports = { CATEGORIES, canReportBooking, studentDisputeView, artisanDisputeView };