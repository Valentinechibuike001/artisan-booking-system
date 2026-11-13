// Removes dangerous keys from the request body, in place.
// Keys starting with "$" or containing "." are used in database attacks.
const clean = (value, depth = 0) => {
  if (depth > 6 || value === null || typeof value !== "object") return;

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || key === "__proto__") {
      delete value[key];
      continue;
    }
    clean(value[key], depth + 1);
  }
};

module.exports = (req, res, next) => {
  if (req.body && typeof req.body === "object") clean(req.body);
  next();
};