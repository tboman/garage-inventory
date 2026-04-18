const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { XMLParser } = require("fast-xml-parser");
const { getValidEbayAccessToken, EbayAuthError } = require("./ebayTokens");

const TRADING_API_URL = "https://api.ebay.com/ws/api.dll";
const COMPAT_LEVEL = "1349";
const SITE_ID = "0";

const ALLOWED_SORTS = new Set([
  "TimeLeft",
  "BestMatch",
  "CurrentPrice",
  "StartTime",
  "EndTime",
  "Title",
]);

function buildRequestXml({ pageNumber, entriesPerPage, sort }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>${sort}</Sort>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function readMoney(node) {
  if (node == null) return { amount: null, currency: null };
  if (typeof node === "object") {
    return {
      amount: node["#text"] != null ? Number(node["#text"]) : null,
      currency: node["@_currencyID"] || null,
    };
  }
  return { amount: Number(node), currency: null };
}

function mapItem(item) {
  const price = readMoney(item?.SellingStatus?.CurrentPrice);
  return {
    itemId: String(item.ItemID ?? ""),
    title: item.Title ?? "",
    price: price.amount,
    currency: price.currency,
    quantity: item.Quantity != null ? Number(item.Quantity) : null,
    quantitySold:
      item?.SellingStatus?.QuantitySold != null
        ? Number(item.SellingStatus.QuantitySold)
        : null,
    timeLeft: item.TimeLeft ?? null,
    listingType: item.ListingType ?? null,
    viewItemUrl: item?.ListingDetails?.ViewItemURL ?? null,
    galleryUrl: item?.PictureDetails?.GalleryURL ?? null,
    startTime: item?.ListingDetails?.StartTime ?? null,
    endTime: item?.ListingDetails?.EndTime ?? null,
  };
}

exports.getActiveEbayListings = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const uid = request.auth.uid;
  const pageNumber = Math.max(1, Math.floor(Number(request.data?.pageNumber) || 1));
  const entriesPerPage = Math.min(
    200,
    Math.max(1, Math.floor(Number(request.data?.entriesPerPage) || 50))
  );
  const sortRaw = request.data?.sort || "TimeLeft";
  const sort = ALLOWED_SORTS.has(sortRaw) ? sortRaw : "TimeLeft";

  let accessToken;
  try {
    accessToken = await getValidEbayAccessToken(uid);
  } catch (e) {
    if (e instanceof EbayAuthError) {
      if (e.code === "not-linked") {
        throw new HttpsError("failed-precondition", "ebay-not-linked");
      }
      if (e.code === "refresh-expired" || e.code === "refresh-failed") {
        throw new HttpsError("failed-precondition", "ebay-needs-relink");
      }
    }
    console.error("Unexpected ebay token error:", e);
    throw new HttpsError("internal", "Failed to get eBay access token.");
  }

  const body = buildRequestXml({ pageNumber, entriesPerPage, sort });

  const res = await fetch(TRADING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body,
  });

  const xmlText = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const parsed = parser.parse(xmlText);
  const response = parsed?.GetMyeBaySellingResponse || {};
  const ack = response.Ack;

  if (ack !== "Success" && ack !== "Warning") {
    const firstError = asArray(response.Errors)[0] || {};
    const errorCode = String(firstError.ErrorCode || "");
    const message =
      firstError.LongMessage || firstError.ShortMessage || "eBay call failed.";
    console.error("eBay Trading API error:", errorCode, message);
    if (
      errorCode === "931" ||
      errorCode === "932" ||
      errorCode === "21916984" ||
      /token/i.test(message) ||
      /scope/i.test(message)
    ) {
      throw new HttpsError("failed-precondition", "ebay-needs-relink");
    }
    throw new HttpsError("internal", message);
  }

  const activeList = response.ActiveList || {};
  const items = asArray(activeList?.ItemArray?.Item).map(mapItem);
  const pg = activeList.PaginationResult || {};

  return {
    items,
    pagination: {
      pageNumber,
      entriesPerPage,
      totalPages: Number(pg.TotalNumberOfPages || 1),
      totalEntries: Number(pg.TotalNumberOfEntries || items.length),
    },
  };
});
