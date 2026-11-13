const { User, ArtisanProfile } = require("../models");
const { uploadImage, deleteImage } = require("../utils/imageUpload");
const C = require("../utils/constants");
const notify = require("../utils/notify");
const { resolveBank } = require("../utils/banks");

const CATEGORIES = ["Electrical", "Plumbing", "Baking", "Decor", "Repairs", "Beauty", "Other"];
const MAX_SERVICES = 20;
const MAX_PORTFOLIO = 10;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "From ₦X" on Browse = the cheapest active service
const recalcStartingPrice = (profile) => {
  const prices = profile.services.filter((s) => s.isActive).map((s) => s.price);
  if (prices.length) profile.startingPrice = Math.min(...prices);
};

const parseDay = (str) => {
  if (typeof str !== "string" || !DATE_RE.test(str)) return null;
  const d = new Date(`${str}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayKey = (d) => d.toISOString().slice(0, 10);

const validPrice = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const validDuration = (value) => {
  const n = Number(value);
  return (
    Number.isInteger(n) &&
    n >= C.MIN_DURATION_MINUTES &&
    n <= C.MAX_DURATION_MINUTES &&
    n % C.DURATION_STEP_MINUTES === 0
  );
};
const DURATION_ERROR = `Duration must be ${C.MIN_DURATION_MINUTES} to ${C.MAX_DURATION_MINUTES} minutes, in steps of ${C.DURATION_STEP_MINUTES}`;

// ---------- Profile ----------

// GET /api/artisan/profile
exports.getMyProfile = async (req, res, next) => {
  try {
    const profile = await ArtisanProfile.findById(req.profile._id).select("+accountNumber");
    const data = profile.toObject();
    data.accountLast4 = profile.accountNumber.slice(-4); // never send the full number
    delete data.accountNumber;
    data.completeness = profileChecklist(profile);
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/artisan/profile

// PUT /api/artisan/profile

// PUT /api/artisan/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const { bio, occupation, category, address, baseArea, serviceAreas } = req.body;
    const p = req.profile;

    // Only an admin can change a job role. Sending the same value is fine.
    const roleChanged =
      (occupation !== undefined &&
        String(occupation).trim().toLowerCase() !== String(p.occupation).toLowerCase()) ||
      (category !== undefined && category !== p.category);
    if (roleChanged) {
      return res
        .status(403)
        .json({ message: "Only an admin can change your job role. Please send a change request instead." });
    }

    if (bio !== undefined) p.bio = String(bio).trim().slice(0, 500);

    if (address !== undefined) {
      const newAddress = String(address).trim();
      if (!newAddress) return res.status(400).json({ message: "Address cannot be empty" });
      if (newAddress !== p.address) {
        p.address = newAddress;
        p.addressVerified = false; // admin must verify the new address
      }
    }

    if (baseArea !== undefined) p.baseArea = String(baseArea).trim().slice(0, 60);

    if (serviceAreas !== undefined) {
      if (!Array.isArray(serviceAreas) || serviceAreas.length > 15) {
        return res.status(400).json({ message: "serviceAreas must be a list of up to 15 areas" });
      }
      const cleaned = [
        ...new Set(serviceAreas.map((a) => String(a).trim().slice(0, 50)).filter(Boolean)),
      ];
      p.serviceAreas = cleaned;
    }

    await p.save();
    res.json({ message: "Profile updated", profile: p });
  } catch (err) {
    next(err);
  }
};




// PUT /api/artisan/bank  (needs the password)
// PUT /api/artisan/bank  (needs the password)
exports.updateBank = async (req, res, next) => {
  try {
    const { currentPassword, bankName, bankCode, accountNumber } = req.body;

    if (!currentPassword || (!bankName && !bankCode) || !accountNumber) {
      return res.status(400).json({ message: "Password, bank and account number are required" });
    }
    if (!/^\d{10}$/.test(String(accountNumber))) {
      return res.status(400).json({ message: "Account number must be 10 digits" });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ message: "Incorrect password" });
    }

    const bank = await resolveBank({ bankCode, bankName });
    if (bank.error) return res.status(400).json({ message: bank.error });

    const update = { $set: { bankName: bank.name, accountNumber: String(accountNumber) } };
    if (bank.code) update.$set.bankCode = bank.code;
    else update.$unset = { bankCode: 1 };
    await ArtisanProfile.updateOne({ _id: req.profile._id }, update);

    res.json({
      message: "Bank details updated",
      bankName: bank.name,
      accountLast4: String(accountNumber).slice(-4),
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/artisan/availability
exports.setAvailability = async (req, res, next) => {
  try {
    const p = req.profile;
    const { isAvailable } = req.body;
    p.isAvailable = typeof isAvailable === "boolean" ? isAvailable : !p.isAvailable;
    await p.save();
    res.json({ message: p.isAvailable ? "You are now available" : "You are now unavailable", isAvailable: p.isAvailable });
  } catch (err) {
    next(err);
  }
};


// POST /api/artisan/services
// POST /api/artisan/services
exports.addService = async (req, res, next) => {
  try {
    const { name, description, price, durationMinutes } = req.body;
    const p = req.profile;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Service name is required" });
    }
    if (!validPrice(price)) {
      return res.status(400).json({ message: "Price must be a whole number more than 0" });
    }
    if (durationMinutes !== undefined && !validDuration(durationMinutes)) {
      return res.status(400).json({ message: DURATION_ERROR });
    }
    if (p.services.length >= MAX_SERVICES) {
      return res.status(400).json({ message: `You can list at most ${MAX_SERVICES} services` });
    }

    p.services.push({
      name: String(name).trim(),
      description: description ? String(description).trim() : undefined,
      price: Number(price),
      durationMinutes:
        durationMinutes !== undefined ? Number(durationMinutes) : C.DEFAULT_DURATION_MINUTES,
    });
    recalcStartingPrice(p);
    await p.save();

    res.status(201).json({ message: "Service added", services: p.services, startingPrice: p.startingPrice });
  } catch (err) {
    next(err);
  }
};

// PUT /api/artisan/services/:serviceId
// PUT /api/artisan/services/:serviceId
exports.updateService = async (req, res, next) => {
  try {
    const p = req.profile;
    const service = p.services.id(req.params.serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    const { name, description, price, durationMinutes, isActive } = req.body;

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: "Service name cannot be empty" });
      service.name = String(name).trim();
    }
    if (description !== undefined) service.description = String(description).trim();
    if (price !== undefined) {
      if (!validPrice(price)) {
        return res.status(400).json({ message: "Price must be a whole number more than 0" });
      }
      service.price = Number(price);
    }
    if (durationMinutes !== undefined) {
      if (!validDuration(durationMinutes)) {
        return res.status(400).json({ message: DURATION_ERROR });
      }
      service.durationMinutes = Number(durationMinutes);
    }
    if (isActive !== undefined) service.isActive = Boolean(isActive);

    recalcStartingPrice(p);
    await p.save();

    res.json({ message: "Service updated", services: p.services, startingPrice: p.startingPrice });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/artisan/services/:serviceId
exports.deleteService = async (req, res, next) => {
  try {
    const p = req.profile;
    const service = p.services.id(req.params.serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    p.services.pull(service._id);
    recalcStartingPrice(p);
    await p.save();

    res.json({ message: "Service removed", services: p.services, startingPrice: p.startingPrice });
  } catch (err) {
    next(err);
  }
};

// ---------- Schedule ----------

// PUT /api/artisan/schedule
exports.setSchedule = async (req, res, next) => {
  try {
    const { weeklySchedule } = req.body;
    if (!Array.isArray(weeklySchedule) || weeklySchedule.length > 7) {
      return res.status(400).json({ message: "weeklySchedule must be a list of up to 7 days" });
    }

    const seen = new Set();
    const cleaned = [];

    for (const entry of weeklySchedule) {
      const day = Number(entry.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ message: "Day must be 0 (Sunday) to 6 (Saturday)" });
      }
      if (seen.has(day)) {
        return res.status(400).json({ message: "Each day can only appear once" });
      }
      seen.add(day);

      const enabled = entry.enabled !== false;
      const from = entry.from || "09:00";
      const to = entry.to || "17:00";

      if (!TIME_RE.test(from) || !TIME_RE.test(to)) {
        return res.status(400).json({ message: "Times must look like 09:00 or 17:30" });
      }
      if (enabled && from >= to) {
        return res.status(400).json({ message: "End time must be after start time" });
      }
      cleaned.push({ day, enabled, from, to });
    }

    req.profile.weeklySchedule = cleaned;
    await req.profile.save();
    res.json({ message: "Schedule saved", weeklySchedule: req.profile.weeklySchedule });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/blocked-dates
exports.addBlockedDates = async (req, res, next) => {
  try {
    const { dates } = req.body;
    if (!Array.isArray(dates) || dates.length === 0 || dates.length > 60) {
      return res.status(400).json({ message: "Send a list of 1 to 60 dates" });
    }

    const p = req.profile;
    const existing = new Set(p.blockedDates.map(dayKey));
    const today = dayKey(new Date());
    const all = [...p.blockedDates];

    for (const str of dates) {
      const d = parseDay(str);
      if (!d) return res.status(400).json({ message: `Invalid date: ${str}. Use YYYY-MM-DD` });
      if (dayKey(d) < today) continue; // ignore past dates
      if (!existing.has(dayKey(d))) {
        all.push(d);
        existing.add(dayKey(d));
      }
    }

    p.blockedDates = all.sort((a, b) => a - b);
    await p.save();
    res.json({ message: "Dates blocked", blockedDates: p.blockedDates });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/artisan/blocked-dates/:date   (date = YYYY-MM-DD)
exports.removeBlockedDate = async (req, res, next) => {
  try {
    const d = parseDay(req.params.date);
    if (!d) return res.status(400).json({ message: "Use the date format YYYY-MM-DD" });

    const p = req.profile;
    p.blockedDates = p.blockedDates.filter((x) => dayKey(x) !== dayKey(d));
    await p.save();
    res.json({ message: "Date unblocked", blockedDates: p.blockedDates });
  } catch (err) {
    next(err);
  }
};

// ---------- Images ----------

// POST /api/artisan/avatar   (form field: avatar)
exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Please choose an image" });

    const result = await uploadImage(req.file.buffer, "avatars", {
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const oldId = req.profile.avatar && req.profile.avatar.publicId;
    req.profile.avatar = result;
    await req.profile.save();
    await User.findByIdAndUpdate(req.user._id, { avatar: result });
    await deleteImage(oldId); // remove the old photo only after the new one is saved

    res.json({ message: "Photo updated", avatar: result });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/portfolio   (form field: images, up to 5 at once)
exports.addPortfolio = async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ message: "Please choose at least one image" });

    const p = req.profile;
    if (p.portfolio.length + files.length > MAX_PORTFOLIO) {
      return res.status(400).json({ message: `You can have at most ${MAX_PORTFOLIO} portfolio photos` });
    }

    const uploaded = await Promise.all(
      files.map((f) =>
        uploadImage(f.buffer, "portfolio", {
          transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
        })
      )
    );

    const caption = files.length === 1 && req.body.caption ? String(req.body.caption).trim() : undefined;
    uploaded.forEach((img) => p.portfolio.push({ ...img, caption }));
    await p.save();

    res.status(201).json({ message: "Photos added", portfolio: p.portfolio });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/artisan/portfolio/:imageId
exports.deletePortfolioImage = async (req, res, next) => {
  try {
    const p = req.profile;
    const image = p.portfolio.id(req.params.imageId);
    if (!image) return res.status(404).json({ message: "Photo not found" });

    const publicId = image.publicId;
    p.portfolio.pull(image._id);
    await p.save();
    await deleteImage(publicId);

    res.json({ message: "Photo removed", portfolio: p.portfolio });
  } catch (err) {
    next(err);
  }
};

// POST /api/artisan/resubmit   (a rejected artisan asks for another review)
exports.resubmit = async (req, res, next) => {
  try {
    const p = req.profile;
    if (p.status !== "rejected") {
      return res.status(409).json({ message: "Only a rejected account can be sent for review again" });
    }

    const updated = await ArtisanProfile.findOneAndUpdate(
      { _id: p._id, status: "rejected" },
      { $set: { status: "pending" }, $unset: { rejectionReason: 1 } },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ message: "Your account can't be sent for review right now" });
    }

    notify.notifyAdmins({
      type: "artisan_resubmitted",
      title: "Artisan sent for review again",
      message: `${req.user.fullName} updated their details and asked for another review.`,
      link: `/admin/artisans/${p._id}`,
    });

    res.json({ message: "Sent for review again. We will check within 24 hours.", status: "pending" });
  } catch (err) {
    next(err);
  }
};
// PUT /api/artisan/buffer   { "bufferMinutes": 30 }
exports.setBuffer = async (req, res, next) => {
  try {
    const raw = (req.body || {}).bufferMinutes;
    const value =
      typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;

    if (!C.ALLOWED_BUFFERS.includes(value)) {
      return res
        .status(400)
        .json({ message: `The gap must be one of: ${C.ALLOWED_BUFFERS.join(", ")} minutes` });
    }

    req.profile.bufferMinutes = value;
    await req.profile.save();

    res.json({ message: "Saved. The new gap applies to new bookings.", bufferMinutes: value });
  } catch (err) {
    next(err);
  }
};