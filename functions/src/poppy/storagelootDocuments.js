// Discovery documents for storageloot.shop: poppy.json, the OAuth metadata,
// and the OpenAPI description of its API. Its own issuer, scopes, and API,
// separate from hunapuka.com's (documents.js).

const { STORAGELOOT, PROTOCOL_VERSION, PATHS, DEVICE_GRANT } = require("./config");
const { TEXT_MAX, REQUEST_PLATFORMS } = require("../messages");

const { ORIGIN, DOMAIN, NAME, SCOPES } = STORAGELOOT;
const scopeNames = Object.keys(SCOPES);

function poppyJson() {
  const scopes = {};
  const hints = {};
  for (const name of scopeNames) {
    scopes[name] = SCOPES[name].description;
    hints[name] = SCOPES[name].hints;
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    organization: { name: NAME, domain: DOMAIN, logo_uri: `${ORIGIN}/logo512.png` },
    auth: { issuer: ORIGIN, scopes, scope_hints: hints },
    apis: [
      {
        type: "openapi",
        url: `${ORIGIN}${PATHS.openapi}`,
        description:
          "A marketplace of second-hand items. Browse and search active listings with " +
          "a verified Session header alone. With the person's approval: read their " +
          "conversations with buyers and sellers (messages:read), and ask a seller about " +
          "an item, make an offer, ask them to list it on eBay or Craigslist, or reply " +
          "(messages:send). Without signing in, the same message endpoints act for a " +
          "guest account kept for the person behind your Session (your client_id and " +
          "its user). Accepting or declining offers is left to the person.",
      },
    ],
    // Anonymous, read-only pages of active listings for the agent's browser.
    web: { browser_session_endpoint: `${ORIGIN}${PATHS.browserSession}` },
  };
}

function protectedResourceMetadata(resource = ORIGIN) {
  return {
    resource,
    authorization_servers: [ORIGIN],
    scopes_supported: scopeNames,
    bearer_methods_supported: ["header"],
  };
}

function authorizationServerMetadata() {
  return {
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}${PATHS.authorize}`,
    token_endpoint: `${ORIGIN}${PATHS.token}`,
    revocation_endpoint: `${ORIGIN}${PATHS.revoke}`,
    device_authorization_endpoint: `${ORIGIN}${PATHS.device}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", DEVICE_GRANT],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopeNames,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "PS384"],
    revocation_endpoint_auth_methods_supported: ["private_key_jwt"],
    revocation_endpoint_auth_signing_alg_values_supported: ["ES256", "PS384"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    protected_resources: [ORIGIN],
  };
}

const json = (schema) => ({ "application/json": { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const idParam = (name, description) => ({ name, in: "path", required: true, schema: { type: "string" }, description });

function openApi() {
  // `{}`: or no access token at all, acting for the agent's guest.
  const read = [{ storageloot: ["messages:read"] }, {}];
  const sendScope = [{ storageloot: ["messages:send"] }, {}];
  const errors = {
    400: {
      description:
        "The Poppy-Session or Poppy-Version header is missing or invalid, or (with no access " +
        "token) the agent is not approved for guests.",
    },
    401: { description: "No access token, or it is expired or revoked. See WWW-Authenticate." },
    403: { description: "The access token lacks the scope this operation needs." },
  };
  const sessionOnly = {
    400: { description: "A verified Poppy-Session header from an approved agent is required." },
  };

  const Listing = {
    type: "object",
    required: ["id", "title", "price_cents", "currency", "url"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      price_cents: { type: "integer", description: "Asking price in the smallest unit (cents)." },
      currency: { type: "string" },
      condition: { type: "string", enum: ["new", "like_new", "good", "fair", "poor"] },
      category: { type: "string" },
      photos: { type: "array", items: { type: "string", format: "uri" } },
      seller_name: { type: "string" },
      url: { type: "string", format: "uri", description: "The listing's page for people." },
      created_at: { type: "string", format: "date-time" },
    },
  };
  const Message = {
    type: "object",
    required: ["id", "from", "kind", "text"],
    properties: {
      id: { type: "string" },
      from: { type: "string", enum: ["you", "them"], description: "Whether the person you act for sent it." },
      role: { type: "string", enum: ["buyer", "seller"] },
      kind: { type: "string", enum: ["inquiry", "offer", "listing_request", "reply"] },
      text: { type: "string" },
      offer: {
        type: "object",
        properties: {
          amount_cents: { type: "integer" },
          currency: { type: "string" },
          status: { type: "string", enum: ["pending", "accepted", "declined"] },
        },
      },
      platform: { type: "string", enum: REQUEST_PLATFORMS },
      via_agent: { type: "boolean" },
      created_at: { type: "string", format: "date-time" },
    },
  };
  const Conversation = {
    type: "object",
    required: ["id", "listing", "role"],
    properties: {
      id: { type: "string" },
      listing: {
        type: "object",
        properties: { id: { type: "string" }, title: { type: "string" }, url: { type: "string", format: "uri" } },
      },
      role: { type: "string", enum: ["buyer", "seller"], description: "The person's side of this conversation." },
      other_party: { type: "string", description: "The other person's display name." },
      last_message: { type: "string" },
      last_message_at: { type: "string", format: "date-time" },
      last_from: { type: "string", enum: ["you", "them"] },
      unread: { type: "boolean", description: "The other side wrote since the person last looked." },
      messages: { type: "array", items: ref("Message"), description: "Only when getting one conversation." },
    },
  };
  const Posted = {
    type: "object",
    required: ["conversation_id", "message_id"],
    properties: { conversation_id: { type: "string" }, message_id: { type: "string" } },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "StorageLoot marketplace",
      version: "1.0.0",
      description:
        "Browse StorageLoot's active listings, and handle the person's conversations " +
        "with buyers and sellers. Each conversation is about one listing, between its " +
        "seller and one buyer. Listings need only a verified Poppy-Session header; " +
        "conversations need an access token with messages:read or messages:send. " +
        "Called with no Authorization header, the conversation endpoints act for a guest: " +
        "an account StorageLoot keeps for the person your verified Session names (your " +
        "client_id and the Session's user), made by its first message to a seller. A guest " +
        "has only the conversations it started, and the seller sees that it is a guest. " +
        "Guests are open to approved agents only. " +
        "Messages an agent sends are shown to the other side as sent by an agent. " +
        "Agents cannot accept or decline offers. Amounts are in cents.",
    },
    servers: [{ url: `${ORIGIN}${PATHS.api}` }],
    paths: {
      "/listings": {
        get: {
          operationId: "listListings",
          security: [],
          summary: "List or search active listings",
          description: "No access token needed: send only the Poppy-Session header.",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Text to find in titles and descriptions." },
            { name: "category", in: "query", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Matching active listings, newest first.",
              content: json({
                type: "object",
                properties: { listings: { type: "array", items: ref("Listing") }, total: { type: "integer" } },
              }),
            },
            ...sessionOnly,
          },
        },
      },
      "/listings/{id}": {
        get: {
          operationId: "getListing",
          security: [],
          summary: "Get one active listing",
          parameters: [idParam("id", "The listing's id.")],
          responses: {
            200: { description: "The listing.", content: json(ref("Listing")) },
            404: { description: "No active listing with that id." },
            ...sessionOnly,
          },
        },
      },
      "/listings/{id}/messages": {
        post: {
          operationId: "messageSeller",
          security: sendScope,
          summary: "Ask about a listing, make an offer, or ask the seller to list it elsewhere",
          description:
            "Writes to the listing's seller as the person, starting their conversation " +
            "about this listing or adding to it. Check with the person before making an " +
            "offer: it is a real offer the seller can accept.",
          parameters: [idParam("id", "The listing's id.")],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["kind"],
              properties: {
                kind: { type: "string", enum: ["inquiry", "offer", "listing_request"] },
                text: { type: "string", maxLength: TEXT_MAX, description: "Required for an inquiry; optional otherwise." },
                offer_amount: { type: "integer", minimum: 1, description: "For an offer: the amount in cents." },
                currency: { type: "string", description: "For an offer. Defaults to the listing's currency." },
                platform: { type: "string", enum: REQUEST_PLATFORMS, description: "For a listing_request." },
              },
            }),
          },
          responses: {
            201: { description: "Sent.", content: json(ref("Posted")) },
            404: { description: "No active listing with that id." },
            409: { description: "The listing is the person's own." },
            422: { description: "A field is missing or invalid." },
            429: { description: "This agent has sent too many messages in the last hour." },
            ...errors,
          },
        },
      },
      "/conversations": {
        get: {
          operationId: "listConversations",
          security: read,
          summary: "List the person's conversations, newest first",
          responses: {
            200: {
              description: "The conversations, as buyer and as seller.",
              content: json({ type: "object", properties: { conversations: { type: "array", items: ref("Conversation") } } }),
            },
            ...errors,
          },
        },
      },
      "/conversations/{id}": {
        get: {
          operationId: "getConversation",
          security: read,
          summary: "Get one conversation with its messages",
          parameters: [idParam("id", "The conversation's id.")],
          responses: {
            200: { description: "The conversation and its messages, oldest first.", content: json(ref("Conversation")) },
            404: { description: "No conversation with that id that the person is part of." },
            ...errors,
          },
        },
      },
      "/conversations/{id}/messages": {
        post: {
          operationId: "reply",
          security: sendScope,
          summary: "Reply in one of the person's conversations",
          parameters: [idParam("id", "The conversation's id.")],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["text"],
              properties: { text: { type: "string", minLength: 1, maxLength: TEXT_MAX } },
            }),
          },
          responses: {
            201: { description: "Sent.", content: json(ref("Posted")) },
            404: { description: "No conversation with that id that the person is part of." },
            422: { description: "text is missing or too long." },
            429: { description: "This agent has sent too many messages in the last hour." },
            ...errors,
          },
        },
      },
    },
    components: {
      schemas: { Listing, Message, Conversation, Posted },
      securitySchemes: {
        storageloot: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${ORIGIN}${PATHS.authorize}`,
              tokenUrl: `${ORIGIN}${PATHS.token}`,
              refreshUrl: `${ORIGIN}${PATHS.token}`,
              scopes: Object.fromEntries(scopeNames.map((n) => [n, SCOPES[n].description])),
            },
          },
        },
      },
    },
  };
}

module.exports = { poppyJson, protectedResourceMetadata, authorizationServerMetadata, openApi };
