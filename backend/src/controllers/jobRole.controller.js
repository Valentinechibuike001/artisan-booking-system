const mongoose = require("mongoose");
const { JobRole, ArtisanProfile } = require("../models");
const C = require("../utils/constants");
const { cleanName, keyOf, occupationFilter } = require("../utils/jobRoles");
const { logAction } = require("../utils/audit");

const roleView = (r, artisanCount) => ({
  id: r._id,
  name: r.name,
  category: r.category,
  isActive: r.isActive,
  artisanCount,
});

// GET /api/browse/roles   (public: fills the sign-up dropdown)
exports.publicList = async (req, res, next) => {
  try {
    const roles = await JobRole.find({ isActive: true }).sort({ name: 1 });
    res.json({ roles: roles.map((r) => ({ id: r._id, name: r.name, category: r.category })) });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/job-roles
exports.list = async (req, res, next) => {
  try {
    const [roles, usage] = await Promise.all([
      JobRole.find().sort({ category: 1, name: 1 }),
      ArtisanProfile.aggregate([
        { $group: { _id: { $toLower: { $trim: { input: "$occupation" } } }, count: { $sum: 1 } } },
      ]),
    ]);

    const usageMap = new Map(usage.map((u) => [u._id, u.count]));
    res.json({
      roles: roles.map((r) => roleView(r, usageMap.get(r.nameKey) || 0)),
      categories: C.CATEGORIES,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/job-roles   { name, category }
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = cleanName(body.name);
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: "The name must be 2 to 40 characters" });
    }
    if (!C.CATEGORIES.includes(body.category)) {
      return res.status(400).json({ message: "Please choose a category" });
    }

    let role;
    try {
      role = await JobRole.create({ name, nameKey: keyOf(name), category: body.category });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ message: "That job role already exists" });
      throw err;
    }

    await logAction(req, "jobrole.create", {
      targetType: "jobrole",
      targetId: role._id,
      summary: `Added job role ${role.name} (${role.category})`,
    });

    res.status(201).json({ message: "Job role added", role: roleView(role, 0) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/job-roles/:id   { name?, category?, isActive? }
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Job role not found" });

    const role = await JobRole.findById(id);
    if (!role) return res.status(404).json({ message: "Job role not found" });

    const body = req.body || {};
    const oldName = role.name;
    let renamedOrMoved = false;

    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (name.length < 2 || name.length > 40) {
        return res.status(400).json({ message: "The name must be 2 to 40 characters" });
      }
      const nameKey = keyOf(name);
      if (nameKey !== role.nameKey && (await JobRole.exists({ nameKey }))) {
        return res.status(409).json({ message: "That job role already exists" });
      }
      if (name !== role.name) {
        role.name = name;
        role.nameKey = nameKey;
        renamedOrMoved = true;
      }
    }

    if (body.category !== undefined) {
      if (!C.CATEGORIES.includes(body.category)) {
        return res.status(400).json({ message: "Please choose a valid category" });
      }
      if (body.category !== role.category) {
        role.category = body.category;
        renamedOrMoved = true;
      }
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be true or false" });
      }
      role.isActive = body.isActive;
    }

    try {
      await role.save();
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ message: "That job role already exists" });
      throw err;
    }

    // A new name or category is copied to every artisan using this role
    let artisansUpdated = 0;
    if (renamedOrMoved) {
      const result = await ArtisanProfile.updateMany(occupationFilter(oldName), {
        $set: { occupation: role.name, category: role.category },
      });
      artisansUpdated = result.modifiedCount;
    }

    await logAction(req, "jobrole.update", {
      targetType: "jobrole",
      targetId: role._id,
      summary: `Updated job role ${oldName}`,
      meta: { now: { name: role.name, category: role.category, isActive: role.isActive }, artisansUpdated },
    });

    res.json({
      message: "Job role updated",
      role: roleView(role, artisansUpdated),
      artisansUpdated,
    });
  } catch (err) {
    next(err);
  }
};