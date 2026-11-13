const C = require("./constants");
const { cleanName, findRole } = require("./jobRoles");

// Works out which job role and category to save. Returns { error } or { name, category }.
const resolveRole = async (typedName, category) => {
  const typed = cleanName(typedName);
  if (typed.length < 2 || typed.length > 40) {
    return { error: "The job role must be 2 to 40 characters" };
  }

  const role = await findRole(typed);
  if (role) {
    if (!role.isActive) {
      return { error: "That job role is switched off. Turn it on first, or choose another." };
    }
    return { name: role.name, category: role.category };
  }

  if (C.CATEGORIES.includes(category)) return { name: typed, category };
  return {
    error: "That job role isn't on the list. Choose a category for it, or add it to Job roles first.",
  };
};

// Saves the new role on the artisan's profile and keeps a history entry
const applyRole = async (profile, { name, category }, adminId, note) => {
  const before = { occupation: profile.occupation, category: profile.category };
  if (before.occupation === name && before.category === category) {
    return { changed: false, before };
  }

  profile.roleHistory.push({
    from: before.occupation,
    to: name,
    fromCategory: before.category,
    toCategory: category,
    by: adminId,
    note,
  });
  if (profile.roleHistory.length > 20) {
    profile.roleHistory.splice(0, profile.roleHistory.length - 20); // keep the latest 20
  }

  profile.occupation = name;
  profile.category = category;
  await profile.save();
  return { changed: true, before };
};

module.exports = { resolveRole, applyRole };