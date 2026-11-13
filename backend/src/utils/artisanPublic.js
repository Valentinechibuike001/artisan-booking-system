// "Emeka Okafor" -> "Emeka O."
const publicName = (fullName = "") => {
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "User";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

// The small card shown on Browse and Saved
const toCard = (p, ownerName, savedSet) => ({
  id: p._id,
  name: publicName(ownerName),
  avatar: p.avatar && p.avatar.url ? p.avatar.url : null,
  occupation: p.occupation,
  category: p.category,
  startingPrice: p.startingPrice,
  ratingAverage: Math.round((p.ratingAverage || 0) * 10) / 10,
  ratingCount: p.ratingCount || 0,
  jobsCompleted: p.jobsCompleted || 0,
  isAvailable: p.isAvailable,
  ninVerified: p.ninVerified,
  addressVerified: p.addressVerified,
  baseArea: p.baseArea || null,
  serviceAreas: p.serviceAreas || [],
  bio: p.bio ? p.bio.slice(0, 120) : "",
  isSaved: savedSet ? savedSet.has(String(p._id)) : false,
});

module.exports = { publicName, toCard };