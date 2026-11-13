const mongoose = require("mongoose");

const jobRoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    nameKey: { type: String, required: true, unique: true }, // lowercase copy that stops duplicates
    category: {
      type: String,
      enum: ["Electrical", "Plumbing", "Baking", "Decor", "Repairs", "Beauty", "Other"],
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JobRole", jobRoleSchema);