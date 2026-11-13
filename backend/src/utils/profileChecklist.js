// Each item: [key, label shown to people, test that says whether it is done]
const ITEMS = [
  ["photo", "Profile photo", (p) => Boolean(p.avatar && p.avatar.url)],
  ["bio", "About you (at least 20 characters)", (p) => (p.bio || "").trim().length >= 20],
  ["services", "At least one active service", (p) => (p.services || []).some((s) => s.isActive)],
  ["schedule", "Working hours", (p) => (p.weeklySchedule || []).some((d) => d.enabled)],
  ["portfolio", "At least one portfolio photo", (p) => (p.portfolio || []).length > 0],
  ["areas", "Areas you serve", (p) => (p.serviceAreas || []).length > 0],
];

// Works out how complete an artisan's profile is
const profileChecklist = (profile) => {
  const items = ITEMS.map(([key, label, test]) => ({ key, label, done: Boolean(test(profile)) }));
  const doneCount = items.filter((i) => i.done).length;

  return {
    items,
    percent: Math.round((doneCount / items.length) * 100),
    missing: items.filter((i) => !i.done).map((i) => i.label),
  };
};

module.exports = { profileChecklist };