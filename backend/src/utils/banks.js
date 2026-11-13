const paystack = require("./paystack");
const { findBank } = require("./bankCheck");

// Works out the official bank name and code. Returns { name, code? } or { error }.
const resolveBank = async ({ bankCode, bankName }) => {
  const code =
    typeof bankCode === "string" || typeof bankCode === "number" ? String(bankCode).trim() : "";
  const name = typeof bankName === "string" ? bankName.trim().slice(0, 60) : "";
  if (!code && !name) return { error: "Please choose your bank" };

  // If Paystack's list can't be loaded, we carry on without it
  let banks = null;
  try {
    banks = await paystack.listBanks();
  } catch (err) {
    banks = null;
  }

  if (code) {
    if (banks) {
      const bank = banks.find((b) => String(b.code) === code);
      if (!bank) return { error: "Please choose your bank from the list" };
      return { name: bank.name, code: String(bank.code) };
    }
    if (name) return { name }; // list unavailable: keep the typed name
    return { error: "We couldn't load the bank list. Please try again in a moment." };
  }

  // Only a name was typed: try to find the matching bank so we can save its code
  const match = banks ? findBank(banks, name) : null;
  return match ? { name: match.name, code: String(match.code) } : { name };
};

module.exports = { resolveBank };