const BASE_URL = "https://api.paystack.co";

// Naira -> kobo (100 kobo = ₦1)
const toKobo = (naira) => Math.round(Number(naira) * 100);

// Sends one request to Paystack and returns its "data" part

// Reads the secret key and cleans it up
const getSecretKey = () =>
  String(process.env.PAYSTACK_SECRET_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

// Sends one request to Paystack and returns its "data" part
const request = async (method, path, body) => {
  const secretKey = getSecretKey();

  if (!secretKey) {
    const err = new Error("Payments are not set up yet");
    err.status = 500;
    throw err;
  }
  if (!secretKey.startsWith("sk_")) {
    console.error("PAYSTACK_SECRET_KEY should start with sk_test_ or sk_live_. Check backend/.env");
  }

  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const err = new Error("We couldn't reach the payment service. Please try again.");
    err.status = 502;
    err.detail = error.message;
    throw err;
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.status === false) {
    console.error("Paystack error:", res.status, json.message);
    const notFound = res.status === 404;
    const err = new Error(
      notFound ? "Payment not found" : "The payment service had a problem. Please try again."
    );
    err.status = notFound ? 404 : 502;
    err.detail = json.message || `HTTP ${res.status}`;
    throw err;
  }

  return json.data;
};

// Asks Paystack for a payment page
const initializeTransaction = ({ email, amount, reference, callbackUrl, metadata }) =>
  request("POST", "/transaction/initialize", {
    email,
    amount: toKobo(amount),
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
    metadata,
  });

// Asks Paystack "what happened to this payment?"
const verifyTransaction = (reference) =>
  request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);

// Asks Paystack to send money back
const refundTransaction = (reference, amount) =>
  request("POST", "/refund", { transaction: reference, amount: toKobo(amount) });

// Reads back the extra info we attached (our booking ID)
const readMetadata = (data) => {
  let meta = data && data.metadata;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch (err) {
      meta = {};
    }
  }
  return meta && typeof meta === "object" ? meta : {};
};

// The bank list is remembered for a day, so we don't ask Paystack every time
let bankCache = { at: 0, banks: [] };

const listBanks = async () => {
  const fresh = Date.now() - bankCache.at < 24 * 60 * 60 * 1000;
  if (fresh && bankCache.banks.length > 0) return bankCache.banks;

  const banks = await request("GET", "/bank?country=nigeria&perPage=200");
  bankCache = { at: Date.now(), banks };
  return banks;
};

// Asks Paystack: whose account is this?
const resolveAccount = (accountNumber, bankCode) =>
  request(
    "GET",
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );

module.exports = {
  initializeTransaction,
  verifyTransaction,
  refundTransaction,
  readMetadata,
  getSecretKey,
  listBanks,
  resolveAccount,
};