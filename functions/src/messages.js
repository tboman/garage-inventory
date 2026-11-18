// StorageLoot messages: what a message may contain, and how a buyer's request
// to list an item on another marketplace becomes a placeholder record.
//
// The web app writes messages straight to Firestore, checked by
// firestore.rules. Agents write them through the poppyStorageloot function
// with the admin SDK, which bypasses the rules, so the same checks live here.
// Keep the two in step.

const TEXT_MAX = 2000;
const PREVIEW_MAX = 140;
const OFFER_MAX_CENTS = 100000000;

// What a buyer can ask the seller to list on; the assisted listing flows for
// these come later.
const REQUEST_PLATFORMS = ["ebay", "craigslist"];
// Every marketplace StorageLoot tracks listings on.
const MARKETPLACES = {
  ebay: "eBay",
  nextdoor: "Nextdoor",
  facebook: "Facebook Marketplace",
  craigslist: "Craigslist",
};
const MARKETPLACE_STATUSES = ["requested", "planned", "in_progress", "listed", "ended"];

// Only the buyer starts these; either side may reply.
const BUYER_KINDS = ["inquiry", "offer", "listing_request"];

class MessageError extends Error {}

// Checks a message a person (or their agent) wants to send, in the role they
// hold in the conversation, and returns the fields to store. Throws
// MessageError with a message fit to show the sender.
function validateMessage({ role, kind, text, offerAmount, currency, platform }) {
  if (!["buyer", "seller"].includes(role)) throw new MessageError("Unknown role.");
  const body = typeof text === "string" ? text.trim() : text === undefined || text === null ? "" : null;
  if (body === null) throw new MessageError("text must be a string.");
  if (body.length > TEXT_MAX) throw new MessageError(`text must be at most ${TEXT_MAX} characters.`);

  if (kind === "reply" || kind === "inquiry") {
    if (kind === "inquiry" && role !== "buyer") throw new MessageError("Only the buyer sends an inquiry.");
    if (!body) throw new MessageError("text is required.");
    return { kind, text: body };
  }
  if (kind === "offer") {
    if (role !== "buyer") throw new MessageError("Only the buyer makes an offer.");
    if (!Number.isInteger(offerAmount) || offerAmount <= 0 || offerAmount > OFFER_MAX_CENTS) {
      throw new MessageError("offer_amount must be a whole number of cents above 0.");
    }
    const cur = currency === undefined ? "USD" : currency;
    if (typeof cur !== "string" || !/^[A-Z]{3}$/.test(cur)) throw new MessageError("currency must be a 3-letter code.");
    return { kind, text: body, offerAmount, currency: cur, offerStatus: "pending" };
  }
  if (kind === "listing_request") {
    if (role !== "buyer") throw new MessageError("Only the buyer asks for a listing.");
    if (!REQUEST_PLATFORMS.includes(platform)) {
      throw new MessageError(`platform must be one of: ${REQUEST_PLATFORMS.join(", ")}.`);
    }
    return { kind, text: body, platform };
  }
  throw new MessageError(`kind must be one of: ${[...BUYER_KINDS, "reply"].join(", ")}.`);
}

function formatCents(cents, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// The one-line summary the message board shows for a conversation.
function previewOf(message) {
  let line = message.text;
  if (message.kind === "offer") {
    line = `Offer: ${formatCents(message.offerAmount, message.currency)}` + (message.text ? ` · ${message.text}` : "");
  } else if (message.kind === "listing_request") {
    line = `Asked to list it on ${MARKETPLACES[message.platform]}` + (message.text ? ` · ${message.text}` : "");
  }
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
}

const conversationId = (listingId, buyerUid) => `${listingId}_${buyerUid}`;

// The placeholder a listing request leaves on listings/{id}/marketplaces/{platform}.
// `existing` is the current record or null; `now` is whatever timestamp type
// the caller stores. A record the seller has moved on (planned, listed...)
// keeps its status; only the request count and time change.
function placeholderAfterRequest(existing, now) {
  const count = existing && Number.isInteger(existing.requestCount) ? existing.requestCount : 0;
  return {
    status: existing && MARKETPLACE_STATUSES.includes(existing.status) ? existing.status : "requested",
    requestCount: count + 1,
    lastRequestedAt: now,
    updatedAt: now,
  };
}

module.exports = {
  TEXT_MAX,
  PREVIEW_MAX,
  REQUEST_PLATFORMS,
  MARKETPLACES,
  MARKETPLACE_STATUSES,
  BUYER_KINDS,
  MessageError,
  validateMessage,
  previewOf,
  formatCents,
  conversationId,
  placeholderAfterRequest,
};
