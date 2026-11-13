const { ORIGIN, DOMAIN, ISSUER, PROTOCOL_VERSION, SCOPES, PATHS } = require("./config");

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
    organization: {
      name: "HunaPuka",
      domain: DOMAIN,
      logo_uri: `${ORIGIN}/logo512.png`,
    },
    auth: { issuer: ISSUER, scopes, scope_hints: hints },
    apis: [
      {
        type: "openapi",
        url: `${ORIGIN}${PATHS.openapi}`,
        description:
          "Read a person's home inventory: list or search their items and see " +
          "which container each one is stored in. Needs sign-in. No photos.",
      },
    ],
    // The website is a signed-in single-page app with nothing for a signed-out
    // visitor, so agents are asked to use the API instead of browsing.
    web: { disabled: true },
  };
}

function protectedResourceMetadata() {
  return {
    resource: ORIGIN,
    authorization_servers: [ISSUER],
    scopes_supported: scopeNames,
    bearer_methods_supported: ["header"],
  };
}

function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ORIGIN}${PATHS.authorize}`,
    token_endpoint: `${ORIGIN}${PATHS.token}`,
    revocation_endpoint: `${ORIGIN}${PATHS.revoke}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
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

const itemSchema = {
  type: "object",
  required: ["id", "name", "location_id", "path", "child_count"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    location_id: {
      type: ["string", "null"],
      description: "The id of the container this item is in, or null at the top level.",
    },
    path: {
      type: "array",
      items: { type: "string" },
      description:
        "Names of the containers this item is inside, outermost first. " +
        "Empty for a top-level item.",
    },
    child_count: {
      type: "integer",
      description: "How many items are directly inside this one. Above 0 means it is a container.",
    },
    created_at: { type: "string", format: "date-time" },
  },
};

function openApi() {
  const security = [{ hunapuka: ["inventory:read"] }];
  const errors = {
    401: { description: "No access token, or it is expired or revoked. See WWW-Authenticate." },
    403: { description: "The access token lacks the inventory:read scope." },
    400: { description: "The Poppy-Session or Poppy-Version header is missing or invalid." },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "HunaPuka inventory",
      version: "1.0.0",
      description:
        "Read-only access to the signed-in person's home inventory. An inventory " +
        "is a tree: any item can contain other items (a garage holds a shelf, " +
        "the shelf holds a box). Photos are not available through this API.",
    },
    servers: [{ url: `${ORIGIN}${PATHS.api}` }],
    security,
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          summary: "List or search the person's inventory items",
          description:
            "Returns every item by default. Use `q` to find where something is " +
            "stored, or `location_id` to see what is inside one container.",
          parameters: [
            {
              name: "q",
              in: "query",
              schema: { type: "string" },
              description: "Case-insensitive text to find in item names and descriptions.",
            },
            {
              name: "location_id",
              in: "query",
              schema: { type: "string" },
              description:
                "Only items directly inside this container. Use `root` for top-level items.",
            },
          ],
          responses: {
            200: {
              description: "The matching items.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["items", "total"],
                    properties: {
                      items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/items/{id}": {
        get: {
          operationId: "getItem",
          summary: "Get one inventory item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "The item.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Item" } },
              },
            },
            404: { description: "No item with that id in this inventory." },
            ...errors,
          },
        },
      },
    },
    components: {
      schemas: { Item: itemSchema },
      securitySchemes: {
        hunapuka: {
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

module.exports = {
  poppyJson,
  protectedResourceMetadata,
  authorizationServerMetadata,
  openApi,
};
