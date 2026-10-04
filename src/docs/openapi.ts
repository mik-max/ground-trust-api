// OpenAPI 3 description of the REST API, served by swagger-ui-express at
// /api/docs (see app.ts). Hand-written rather than generated from JSDoc so
// the route files stay as they are — keep this in step when a route changes.

const ASPECTS = ["power", "water", "security", "roads_flooding", "accessibility"];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const ok = (description: string, schema: object) => ({ description, ...json(schema) });
const err = (description: string) => ({ description, ...json(ref("Error")) });
const idParam = (description: string) => ({ name: "id", in: "path", required: true, description, schema: { type: "string" } });
const auth = [{ bearerAuth: [] }];

const AUTH_ERRORS = { 401: err("Missing or invalid token"), 403: err("Forbidden for this role") };

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "GroundTrust API",
    version: "1.0.0",
    description:
      "REST API for the resident-sourced environmental intelligence platform. " +
      "Use **POST /auth/login** to get a token, then click **Authorize** and paste it to call protected endpoints.",
  },
  servers: [{ url: "/api" }],
  tags: [
    { name: "Auth", description: "Sign up and sign in (email or Google)" },
    { name: "Areas", description: "Public area profiles and resident reviews" },
    { name: "Verification", description: "GPS-based resident verification" },
    { name: "Uploads", description: "Voice review audio upload" },
    { name: "Geocode", description: "Location search (OpenStreetMap Nominatim)" },
    { name: "Government", description: "Flagged areas for government authority accounts" },
    { name: "Admin", description: "Moderation and government authority account provisioning" },
    { name: "Internal", description: "Administrator maintenance triggers" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      Aspect: { type: "string", enum: ASPECTS },
      Band: { type: "string", enum: ["poor", "fair", "good", "excellent"] },
      Confidence: { type: "string", enum: ["low", "medium", "high"] },
      ModerationStatus: { type: "string", enum: ["approved", "pending", "rejected"] },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          fullName: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["resident", "government", "admin"] },
        },
      },
      AuthResponse: { type: "object", properties: { token: { type: "string" }, user: ref("User") } },
      Area: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          geoCentroidLat: { type: "number" },
          geoCentroidLng: { type: "number" },
          geoRadiusMeters: { type: "integer" },
          status: ref("ModerationStatus"),
        },
      },
      AspectEvidence: {
        type: "object",
        description: "Trust-weighted score for one aspect, always shown with its contributor count and confidence",
        properties: {
          aspect: ref("Aspect"),
          score: { type: "number", nullable: true, minimum: 1, maximum: 5 },
          band: { allOf: [ref("Band")], nullable: true },
          N: { type: "integer", description: "Number of distinct contributors" },
          confidence: ref("Confidence"),
        },
      },
      OverallEvidence: {
        type: "object",
        properties: {
          score: { type: "number", nullable: true },
          band: { allOf: [ref("Band")], nullable: true },
          N: { type: "integer" },
          confidence: ref("Confidence"),
        },
      },
      Ratings: {
        type: "object",
        description: "Structured 1–5 rating per aspect; at least one is required",
        properties: Object.fromEntries(ASPECTS.map((a) => [a, { type: "integer", minimum: 1, maximum: 5 }])),
        example: { power: 2, water: 3, security: 4 },
      },
      ReviewInput: {
        type: "object",
        required: ["ratings"],
        properties: {
          ratings: ref("Ratings"),
          originalText: { type: "string", description: "Optional comment, in any supported language" },
          originalLanguage: { type: "string", description: "Optional language override; otherwise detected" },
          originalAudioRef: { type: "string", description: "URL returned by POST /uploads/audio", example: "/uploads/audio/abc123.webm" },
        },
      },
      NlpAspect: {
        type: "object",
        properties: {
          aspect: ref("Aspect"),
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      Review: {
        type: "object",
        properties: {
          id: { type: "string" },
          areaId: { type: "string" },
          userId: { type: "string" },
          originalText: { type: "string", nullable: true },
          originalLanguage: { type: "string", nullable: true },
          originalAudioRef: { type: "string", nullable: true, description: "Only returned to government authority accounts" },
          translatedText: { type: "string", nullable: true },
          submittedAt: { type: "string", format: "date-time" },
          ratingPower: { type: "integer", nullable: true },
          ratingWater: { type: "integer", nullable: true },
          ratingSecurity: { type: "integer", nullable: true },
          ratingRoadsFlooding: { type: "integer", nullable: true },
          ratingAccessibility: { type: "integer", nullable: true },
          nlpAspects: { type: "array", nullable: true, items: ref("NlpAspect") },
          trustWeightAtSubmission: { type: "number" },
          moderationStatus: ref("ModerationStatus"),
        },
      },
      Residency: {
        type: "object",
        properties: {
          userId: { type: "string" },
          areaId: { type: "string" },
          verificationTier: { type: "string", enum: ["tier0", "tier1", "tier2", "tier3"] },
          confirmedSince: { type: "string", format: "date-time", nullable: true },
          trustWeight: { type: "number" },
        },
      },
      Flag: {
        type: "object",
        properties: {
          id: { type: "string" },
          areaId: { type: "string" },
          area: ref("Area"),
          aspect: ref("Aspect"),
          triggeredAt: { type: "string", format: "date-time" },
          consecutiveWeeksBelowThreshold: { type: "integer" },
          resolved: { type: "boolean" },
          responseStatus: { type: "string", enum: ["unacknowledged", "acknowledged", "in_progress"] },
          responseNote: { type: "string", nullable: true },
          respondedAt: { type: "string", format: "date-time", nullable: true },
          respondedBy: {
            type: "object",
            nullable: true,
            properties: { id: { type: "string" }, fullName: { type: "string" } },
          },
        },
      },
      Decision: {
        type: "object",
        required: ["decision"],
        properties: { decision: { type: "string", enum: ["approved", "rejected"] } },
      },
    },
  },
  paths: {
    "/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Register a resident account",
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["fullName", "email", "password"],
            properties: { fullName: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string" } },
          }),
        },
        responses: { 201: ok("Account created", ref("AuthResponse")), 400: err("Missing fields"), 409: err("Email already registered") },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in with email and password",
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["email", "password"],
            properties: { email: { type: "string", example: "resident@example.com" }, password: { type: "string", example: "password123" } },
          }),
        },
        responses: { 200: ok("Signed in", ref("AuthResponse")), 400: err("Missing fields"), 401: err("Invalid email or password") },
      },
    },
    "/auth/google": {
      post: {
        tags: ["Auth"],
        summary: "Sign in or sign up with a Google ID token",
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["credential"],
            properties: { credential: { type: "string", description: "Google ID token" }, isSignup: { type: "boolean" } },
          }),
        },
        responses: {
          200: ok("Signed in", ref("AuthResponse")),
          400: err("Missing credential"),
          401: err("Invalid Google credential"),
          404: err("No account for this Google email (sign up first)"),
          503: err("Google sign-in is not configured"),
        },
      },
    },
    "/areas": {
      get: {
        tags: ["Areas"],
        summary: "List approved areas with their evidence summary",
        parameters: [{ name: "query", in: "query", schema: { type: "string" }, description: "Filter by name, city or state" }],
        responses: { 200: ok("Areas", { type: "object", properties: { areas: { type: "array", items: ref("Area") } } }) },
      },
      post: {
        tags: ["Areas"],
        summary: "Propose a new area (starts pending administrator approval), optionally with a review",
        security: auth,
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["name", "city", "state", "geoCentroidLat", "geoCentroidLng"],
            properties: {
              name: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              geoCentroidLat: { type: "number" },
              geoCentroidLng: { type: "number" },
              geoRadiusMeters: { type: "integer", minimum: 300, maximum: 5000, default: 2000 },
              review: ref("ReviewInput"),
            },
          }),
        },
        responses: {
          201: ok("Area proposed", { type: "object", properties: { area: ref("Area"), review: { allOf: [ref("Review")], nullable: true } } }),
          400: err("Validation error"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/areas/nearest": {
      get: {
        tags: ["Areas"],
        summary: "Find the approved area containing a coordinate",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number" } },
          { name: "lng", in: "query", required: true, schema: { type: "number" } },
        ],
        responses: {
          200: ok("Matching area, or null", { type: "object", properties: { area: { allOf: [ref("Area")], nullable: true } } }),
          400: err("lat and lng are required"),
        },
      },
    },
    "/areas/{id}": {
      get: {
        tags: ["Areas"],
        summary: "Area profile: overall and per-aspect evidence",
        parameters: [idParam("Area ID")],
        responses: {
          200: ok("Area profile", {
            type: "object",
            properties: { area: ref("Area"), overall: ref("OverallEvidence"), aspects: { type: "array", items: ref("AspectEvidence") } },
          }),
          404: err("Area not found"),
        },
      },
    },
    "/areas/{id}/reviews": {
      get: {
        tags: ["Areas"],
        summary: "Paginated approved reviews for an area",
        description: "Original voice recordings are included only for government authority accounts.",
        parameters: [idParam("Area ID"), { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }],
        responses: {
          200: ok("Reviews", {
            type: "object",
            properties: {
              reviews: { type: "array", items: ref("Review") },
              page: { type: "integer" },
              pageSize: { type: "integer" },
              total: { type: "integer" },
            },
          }),
          404: err("Area not found"),
        },
      },
      post: {
        tags: ["Areas"],
        summary: "Submit a review (structured ratings plus optional text or voice comment)",
        description: "Text comments start pending until the automated moderation check clears them. Translation and aspect/sentiment classification run in the background.",
        security: auth,
        parameters: [idParam("Area ID")],
        requestBody: { required: true, ...json(ref("ReviewInput")) },
        responses: {
          201: ok("Review created", { type: "object", properties: { review: ref("Review") } }),
          400: err("Validation error"),
          404: err("Area not found"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/verification/status": {
      get: {
        tags: ["Verification"],
        summary: "The signed-in resident's verification tier and progress per reviewed area",
        security: auth,
        responses: { 200: ok("Residencies", { type: "object", properties: { residencies: { type: "array", items: ref("Residency") } } }), ...AUTH_ERRORS },
      },
    },
    "/verification/gps-sample": {
      post: {
        tags: ["Verification"],
        summary: "Record a GPS presence check (raw coordinates are not stored)",
        security: auth,
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["areaId", "lat", "lng"],
            properties: { areaId: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } },
          }),
        },
        responses: {
          200: ok("Updated residency", { type: "object", properties: { residency: ref("Residency") } }),
          400: err("Missing or invalid coordinates"),
          404: err("Area not found"),
          422: err("Location is outside this area"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/uploads/audio": {
      post: {
        tags: ["Uploads"],
        summary: "Upload a voice review recording",
        security: auth,
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", properties: { audio: { type: "string", format: "binary" } } } } },
        },
        responses: {
          201: ok("Stored; pass the URL as originalAudioRef", { type: "object", properties: { url: { type: "string" } } }),
          400: err("No file, wrong type, or too large"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/geocode/search": {
      get: {
        tags: ["Geocode"],
        summary: "Search real-world locations in Lagos State",
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Up to 6 results (empty on no match or upstream failure)", {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: { type: "object", properties: { label: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } } },
              },
            },
          }),
        },
      },
    },
    "/gov/flags": {
      get: {
        tags: ["Government"],
        summary: "Unresolved flags that have persisted for the minimum number of weeks",
        security: auth,
        parameters: [{ name: "aspect", in: "query", schema: ref("Aspect") }],
        responses: { 200: ok("Flags", { type: "object", properties: { flags: { type: "array", items: ref("Flag") } } }), ...AUTH_ERRORS },
      },
    },
    "/gov/flags/{id}": {
      get: {
        tags: ["Government"],
        summary: "One flag with its area and government response",
        security: auth,
        parameters: [idParam("Flag ID")],
        responses: { 200: ok("Flag", { type: "object", properties: { flag: ref("Flag") } }), 404: err("Flag not found"), ...AUTH_ERRORS },
      },
    },
    "/gov/flags/{id}/response": {
      patch: {
        tags: ["Government"],
        summary: "Acknowledge a flag or mark action as in progress",
        description: "Records the government authority's response and an optional note. It never resolves the flag; only residents' recovering scores do.",
        security: auth,
        parameters: [idParam("Flag ID")],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", enum: ["acknowledged", "in_progress"] },
              note: { type: "string", example: "Police patrols scheduled from next week" },
            },
          }),
        },
        responses: {
          200: ok("Updated flag", { type: "object", properties: { flag: ref("Flag") } }),
          400: err("Invalid status or note"),
          404: err("Flag not found"),
          409: err("Flag already resolved"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/admin/government-accounts": {
      get: {
        tags: ["Admin"],
        summary: "List government authority accounts",
        security: auth,
        responses: { 200: ok("Accounts", { type: "object", properties: { accounts: { type: "array", items: ref("User") } } }), ...AUTH_ERRORS },
      },
      post: {
        tags: ["Admin"],
        summary: "Create a government authority account",
        security: auth,
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["fullName", "email", "password"],
            properties: { fullName: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string" } },
          }),
        },
        responses: {
          201: ok("Created", { type: "object", properties: { account: ref("User") } }),
          400: err("Missing fields"),
          409: err("Email already registered"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/reviews/{id}/report": {
      post: {
        tags: ["Areas"],
        summary: "Report a review as false, offensive or spam (queued for an administrator; does not hide it)",
        security: auth,
        parameters: [idParam("Review ID")],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["reason"],
            properties: {
              reason: { type: "string", enum: ["false_information", "offensive", "spam", "other"] },
              note: { type: "string", maxLength: 500 },
            },
          }),
        },
        responses: {
          201: ok("Reported", { type: "object", properties: { report: { type: "object" } } }),
          400: err("Invalid reason or note, or reporting your own review"),
          404: err("Review not found"),
          409: err("Already reported by this user"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/admin/reviews/pending": {
      get: {
        tags: ["Admin"],
        summary: "Reviews awaiting moderation",
        security: auth,
        responses: { 200: ok("Pending reviews", { type: "object", properties: { reviews: { type: "array", items: ref("Review") } } }), ...AUTH_ERRORS },
      },
    },
    "/admin/reviews/{id}/moderate": {
      post: {
        tags: ["Admin"],
        summary: "Approve or reject a pending review",
        security: auth,
        parameters: [idParam("Review ID")],
        requestBody: { required: true, ...json(ref("Decision")) },
        responses: {
          200: ok("Moderated", { type: "object", properties: { review: ref("Review") } }),
          400: err("Invalid decision"),
          404: err("Review not found"),
          409: err("Already moderated"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/admin/reviews/reported": {
      get: {
        tags: ["Admin"],
        summary: "Reviews with unresolved reports from users, with each report's reason",
        security: auth,
        responses: { 200: ok("Reported reviews", { type: "object", properties: { reviews: { type: "array", items: ref("Review") } } }), ...AUTH_ERRORS },
      },
    },
    "/admin/reviews/{id}/reports/resolve": {
      post: {
        tags: ["Admin"],
        summary: "Keep a reported review (resolve its reports) or remove it (reject it and recompute scores)",
        security: auth,
        parameters: [idParam("Review ID")],
        requestBody: {
          required: true,
          ...json({ type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["keep", "remove"] } } }),
        },
        responses: {
          200: ok("Resolved", { type: "object", properties: { review: ref("Review") } }),
          400: err("Invalid decision"),
          404: err("Review not found"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/admin/areas/pending": {
      get: {
        tags: ["Admin"],
        summary: "Resident-proposed areas awaiting approval, with duplicate/spam signals",
        security: auth,
        responses: { 200: ok("Pending areas", { type: "object", properties: { areas: { type: "array", items: ref("Area") } } }), ...AUTH_ERRORS },
      },
    },
    "/admin/areas/{id}/moderate": {
      post: {
        tags: ["Admin"],
        summary: "Approve or reject a resident-proposed area",
        security: auth,
        parameters: [idParam("Area ID")],
        requestBody: { required: true, ...json(ref("Decision")) },
        responses: {
          200: ok("Moderated", { type: "object", properties: { area: ref("Area") } }),
          400: err("Invalid decision"),
          404: err("Area not found"),
          409: err("Already moderated"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/internal/nlp/process": {
      post: {
        tags: ["Internal"],
        summary: "Re-run the NLP pipeline on one review",
        security: auth,
        requestBody: { required: true, ...json({ type: "object", required: ["reviewId"], properties: { reviewId: { type: "string" } } }) },
        responses: {
          200: ok("Processed review", { type: "object", properties: { review: ref("Review") } }),
          400: err("reviewId is required"),
          404: err("Review not found"),
          ...AUTH_ERRORS,
        },
      },
    },
    "/internal/recompute-all": {
      post: {
        tags: ["Internal"],
        summary: "Recompute every area/aspect score and flag streak now",
        security: auth,
        responses: { 200: ok("Done", { type: "object", properties: { ok: { type: "boolean" } } }), ...AUTH_ERRORS },
      },
    },
  },
};
