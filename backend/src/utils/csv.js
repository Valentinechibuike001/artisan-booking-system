// Makes one value safe to put in a CSV file
const cell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ can run as a formula in Excel, so we defuse it
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const toCsv = (headers, rows) =>
  [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");

// Sends the rows to the browser as a downloadable file
const sendCsv = (res, filename, headers, rows) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + toCsv(headers, rows)); // the first character helps Excel show ₦ correctly
};

module.exports = { sendCsv };