const mongoose = require("mongoose");
const { Booking, Message, ArtisanProfile, Notification } = require("../models");
const { publicName } = require("../utils/artisanPublic");
const { dateKey } = require("../utils/time");
const { containsContactInfo, CONTACT_BLOCKED_MESSAGE } = require("../utils/contactFilter");
const { uploadImage, deleteImage } = require("../utils/imageUpload");
const notify = require("../utils/notify");

const MAX_LENGTH = 1000;
const UNPAID = ["awaiting_payment", "expired"];
const SEND_OPEN = ["pending", "accepted", "completed", "disputed"];
const CLOSED_TEXT = "Messaging is closed for this booking.";
const NOT_FOUND = { code: 404, message: "Conversation not found" };

// Ready-made messages the app can show as one-tap buttons
const QUICK_REPLIES = {
  artisan: [
    "I'm on my way.",
    "I've arrived.",
    "I'm running about 15 minutes late. Sorry!",
    "Can you send a photo of the problem?",
    "The job is finished. Please check and confirm.",
  ],
  user: [
    "I'm here and ready.",
    "Please come to the hostel gate.",
    "Can we move this to a later time today?",
    "Can you send a photo of your past work?",
    "Thank you!",
  ],
};

const snippet = (text, n = 80) => (text.length > n ? `${text.slice(0, n)}...` : text);
const imageOf = (u) => (u && u.avatar && u.avatar.url ? u.avatar.url : null);

const messageView = (m, me) => ({
  id: m._id,
  text: m.text || "",
  image: m.image && m.image.url ? m.image.url : null,
  mine: String(m.sender) === String(me),
  createdAt: m.createdAt,
  readAt: m.readAt || null,
});

// Finds the booking, checks the person is one of its two people, and works out
// whether they may still send messages
const loadChat = async (req, bookingId) => {
  if (!mongoose.isValidObjectId(bookingId)) return NOT_FOUND;

  const booking = await Booking.findById(bookingId)
    .populate("user", "fullName avatar blockedUsers isActive")
    .populate({
      path: "artisan",
      select: "user",
      populate: { path: "user", select: "fullName avatar blockedUsers isActive" },
    });

  const student = booking && booking.user;
  const artisan = booking && booking.artisan && booking.artisan.user;
  if (!booking || !student || !artisan || UNPAID.includes(booking.status)) return NOT_FOUND;

  const me = String(req.user._id);
  const isStudent = String(student._id) === me;
  const isArtisan = String(artisan._id) === me;
  if (!isStudent && !isArtisan) return NOT_FOUND; // strangers learn nothing

  const blocked =
    student.blockedUsers.some((id) => id.equals(artisan._id)) ||
    artisan.blockedUsers.some((id) => id.equals(student._id));
  const bothActive = student.isActive && artisan.isActive;

  const windowOpen =
    booking.status === "confirmed" &&
    booking.disputeWindowEndsAt &&
    booking.disputeWindowEndsAt > new Date();

  return {
    booking,
    other: isStudent ? artisan : student,
    canSend: !blocked && bothActive && Boolean(SEND_OPEN.includes(booking.status) || windowOpen),
    link: isStudent ? `/bookings/${booking._id}` : `/artisan/bookings/${booking._id}`,
    otherLink: isStudent ? `/artisan/bookings/${booking._id}` : `/bookings/${booking._id}`,
  };
};

// While the artisan hasn't accepted yet, contact details can't be shared
const contactProblem = (chat, text) =>
  chat.booking.status === "pending" && text && containsContactInfo(text)
    ? CONTACT_BLOCKED_MESSAGE
    : null;

// One unread "new message" notification per conversation, always showing the newest text
const tellOther = (req, chat, text) =>
  notify(chat.other._id, {
    type: "new_message",
    title: `New message from ${publicName(req.user.fullName)}`,
    message: text ? snippet(text) : "Sent you a photo",
    link: chat.otherLink,
    replaceUnread: true,
  });

// All of this person's paid bookings (students and artisans find theirs differently)
const myBookingIds = async (req) => {
  let filter;
  if (req.user.role === "artisan") {
    const profile = await ArtisanProfile.findOne({ user: req.user._id }).select("_id");
    if (!profile) return [];
    filter = { artisan: profile._id };
  } else {
    filter = { user: req.user._id };
  }

  const bookings = await Booking.find({ ...filter, status: { $nin: UNPAID } })
    .sort({ updatedAt: -1 })
    .limit(300)
    .select("_id");
  return bookings.map((b) => b._id);
};

// GET /api/messages/quick-replies
exports.quickReplies = (req, res) => {
  res.json({ replies: QUICK_REPLIES[req.user.role] || [] });
};

// GET /api/messages   (inbox: one row per conversation)
exports.inbox = async (req, res, next) => {
  try {
    const bookingIds = await myBookingIds(req);
    if (bookingIds.length === 0) return res.json({ conversations: [] });

    const rows = await Message.aggregate([
      { $match: { booking: { $in: bookingIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$booking",
          last: { $first: "$$ROOT" },
          unread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$sender", req.user._id] },
                    { $eq: [{ $ifNull: ["$readAt", null] }, null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { "last.createdAt": -1 } },
      { $limit: 50 },
    ]);

    const bookings = await Booking.find({ _id: { $in: rows.map((r) => r._id) } })
      .populate("user", "fullName avatar")
      .populate({
        path: "artisan",
        select: "user",
        populate: { path: "user", select: "fullName avatar" },
      });
    const byId = new Map(bookings.map((b) => [String(b._id), b]));
    const iAmStudent = req.user.role === "user";

    const conversations = rows
      .map((r) => {
        const b = byId.get(String(r._id));
        if (!b || !b.user || !b.artisan || !b.artisan.user) return null;
        const other = iAmStudent ? b.artisan.user : b.user;
        return {
          bookingId: b._id,
          other: { name: publicName(other.fullName), avatar: imageOf(other) },
          serviceName: b.service.name,
          status: b.status,
          unread: r.unread,
          last: {
            text: snippet(r.last.text || "Sent a photo"),
            mine: String(r.last.sender) === String(req.user._id),
            createdAt: r.last.createdAt,
          },
        };
      })
      .filter(Boolean);

    res.json({ conversations });
  } catch (err) {
    next(err);
  }
};

// GET /api/messages/unread-count
exports.unreadCount = async (req, res, next) => {
  try {
    const bookingIds = await myBookingIds(req);
    const unreadMessages = bookingIds.length
      ? await Message.countDocuments({
          booking: { $in: bookingIds },
          sender: { $ne: req.user._id },
          readAt: null,
        })
      : 0;
    res.json({ unreadMessages });
  } catch (err) {
    next(err);
  }
};

// GET /api/messages/:bookingId?limit=30&before=<messageId>
exports.getMessages = async (req, res, next) => {
  try {
    const chat = await loadChat(req, req.params.bookingId);
    if (!chat.booking) return res.status(chat.code).json({ message: chat.message });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
    const before = String(req.query.before || "");

    const filter = { booking: chat.booking._id };
    if (mongoose.isValidObjectId(before)) filter._id = { $lt: before };

    // Fetch one extra, so we know whether older messages exist
    const rows = await Message.find(filter).sort({ _id: -1 }).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // oldest first

    // Opening the newest page means the person has now seen everything sent to them
    if (!before) {
      await Message.updateMany(
        { booking: chat.booking._id, sender: { $ne: req.user._id }, readAt: null },
        { readAt: new Date() }
      );
      await Notification.updateMany(
        { user: req.user._id, type: "new_message", link: chat.link, isRead: false },
        { isRead: true }
      );
    }

    res.json({
      messages: page.map((m) => messageView(m, req.user._id)),
      hasMore,
      canSend: chat.canSend,
      closedReason: chat.canSend ? null : CLOSED_TEXT,
      contactSharingAllowed: chat.booking.status !== "pending",
      other: { name: publicName(chat.other.fullName), avatar: imageOf(chat.other) },
      booking: {
        id: chat.booking._id,
        status: chat.booking.status,
        serviceName: chat.booking.service.name,
        date: dateKey(chat.booking.date),
        time: chat.booking.time,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/messages/:bookingId   { "text": "..." }
exports.sendMessage = async (req, res, next) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ message: "Please type a message" });
    if (text.length > MAX_LENGTH) {
      return res.status(400).json({ message: `Messages can be at most ${MAX_LENGTH} characters` });
    }

    const chat = await loadChat(req, req.params.bookingId);
    if (!chat.booking) return res.status(chat.code).json({ message: chat.message });
    if (!chat.canSend) return res.status(403).json({ message: CLOSED_TEXT });

    const problem = contactProblem(chat, text);
    if (problem) return res.status(400).json({ message: problem, code: "contact_info_blocked" });

    const message = await Message.create({
      booking: chat.booking._id,
      sender: req.user._id,
      text,
    });

    tellOther(req, chat, text);
    res.status(201).json({ sent: messageView(message, req.user._id) });
  } catch (err) {
    next(err);
  }
};

// POST /api/messages/:bookingId/image   (form-data: image, optional text)
exports.sendImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Please choose an image" });

    const body = req.body || {};
    const caption = typeof body.text === "string" ? body.text.trim() : "";
    if (caption.length > MAX_LENGTH) {
      return res.status(400).json({ message: `Messages can be at most ${MAX_LENGTH} characters` });
    }

    const chat = await loadChat(req, req.params.bookingId);
    if (!chat.booking) return res.status(chat.code).json({ message: chat.message });
    if (!chat.canSend) return res.status(403).json({ message: CLOSED_TEXT });

    const problem = contactProblem(chat, caption);
    if (problem) return res.status(400).json({ message: problem, code: "contact_info_blocked" });

    // Upload only after every check has passed
    const image = await uploadImage(req.file.buffer, "chat", {
      transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
    });

    let message;
    try {
      message = await Message.create({
        booking: chat.booking._id,
        sender: req.user._id,
        text: caption,
        image,
      });
    } catch (err) {
      await deleteImage(image.publicId); // don't leave an unused photo behind
      throw err;
    }

    tellOther(req, chat, caption);
    res.status(201).json({ sent: messageView(message, req.user._id) });
  } catch (err) {
    next(err);
  }
};