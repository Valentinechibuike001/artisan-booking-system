// Short names people use, mapped to the start of Paystack's official bank name
const ALIASES = {
  gtbank: "guaranty trust",
  gtb: "guaranty trust",
  gtco: "guaranty trust",
  uba: "united bank for africa",
  firstbank: "first bank of nigeria",
  fcmb: "first city monument",
  zenith: "zenith",
  access: "access bank",
  opay: "paycom",
  stanbic: "stanbic ibtc",
};

// "GT-Bank  PLC" -> "gt bank plc"
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Finds the bank in Paystack's list from the name the artisan typed
const findBank = (banks, bankName) => {
  const typed = norm(bankName);
  if (!typed) return null;
  const target = ALIASES[typed.replace(/ /g, "")] || typed;

  const matches = (banks || []).filter((b) => {
    const name = norm(b.name);
    return name.includes(target) || (name.length >= 4 && target.includes(name));
  });
  if (matches.length === 0) return null;

  // If several match (Access Bank and Access Bank (Diamond)), take the shortest name
  return matches.sort((a, b) => a.name.length - b.name.length)[0];
};

const tokens = (name) => norm(name).split(" ").filter((t) => t.length >= 2);

// Compares the name registered on the app with the name the bank gave us
const compareNames = (registered, accountName) => {
  const mine = tokens(registered);
  const theirs = new Set(tokens(accountName));
  if (mine.length === 0 || theirs.size === 0) return "mismatch";

  const hits = mine.filter((t) => theirs.has(t)).length;
  if (hits >= 2 || (mine.length === 1 && hits === 1)) return "match";
  return hits === 1 ? "partial" : "mismatch";
};

module.exports = { findBank, compareNames };