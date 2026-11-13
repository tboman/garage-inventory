const {
  ORIGIN,
  DOMAIN,
  ISSUER,
  PROTOCOL_VERSION,
  SCOPES,
  PATHS,
  NAME_MAX,
  DESCRIPTION_MAX,
} = require("./config");

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
          "A person's home inventory: list or search their items and see which " +
          "container each one is stored in, and add, rename, or move items. " +
          "Needs sign-in. No photos and no deleting.",
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

const itemResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
});

const writeFields = {
  name: { type: "string", minLength: 1, maxLength: NAME_MAX },
  description: { type: "string", maxLength: DESCRIPTION_MAX },
  location_id: {
    type: ["string", "null"],
    description: "The id of the container to put the item in, or null for the top level.",
  },
};

function openApi() {
  const read = [{ hunapuka: ["inventory:read"] }];
  const write = [{ hunapuka: ["inventory:write"] }];
  const errors = {
    401: { description: "No access token, or it is expired or revoked. See WWW-Authenticate." },
    403: { description: "The access token lacks the scope this operation needs." },
    400: { description: "The Poppy-Session or Poppy-Version header is missing or invalid." },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "HunaPuka inventory",
      version: "1.0.0",
      description:
        "The signed-in person's home inventory. An inventory is a tree: any item " +
        "can contain other items (a garage holds a shelf, the shelf holds a box). " +
        "Reading needs the inventory:read scope; adding, editing, and moving " +
        "items needs inventory:write. Items cannot be deleted and photos are " +
        "not available through this API.",
    },
    servers: [{ url: `${ORIGIN}${PATHS.api}` }],
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          security: read,
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
        post: {
          operationId: "createItem",
          security: write,
          summary: "Add an item to the person's inventory",
          description:
            "Creates an item at the top level or inside a container. Send an " +
            "Idempotency-Key header so a retried request does not add it twice.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              schema: { type: "string", maxLength: 200 },
              description: "A unique value for this creation. Repeating it returns the same item.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["name"], properties: writeFields },
              },
            },
          },
          responses: {
            201: itemResponse("The new item."),
            200: itemResponse("The item an earlier request with this Idempotency-Key created."),
            422: { description: "A field is invalid, or location_id names no item." },
            ...errors,
          },
        },
      },
      "/items/{id}": {
        patch: {
          operationId: "updateItem",
          security: write,
          summary: "Rename an item, edit its description, or move it",
          description:
            "Changes only the fields sent. Set location_id to move the item " +
            "into another container, or to null for the top level. An item " +
            "cannot be moved into itself or into something it contains.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", minProperties: 1, properties: writeFields },
              },
            },
          },
          responses: {
            200: itemResponse("The item after the change."),
            404: { description: "No item with that id in this inventory." },
            422: { description: "A field is invalid, or the move is not possible." },
            ...errors,
          },
        },
        get: {
          operationId: "getItem",
          security: read,
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
