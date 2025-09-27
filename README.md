# TruCycle Backend API

NestJS + TypeORM (Postgres/PostGIS) + Swagger skeleton for TruCycle.

## Quick Start

1) Prereqs
- Node.js 18+
- One of:
  - Docker Desktop (recommended path), or
  - Local/hosted Postgres with PostGIS (non‑Docker path)

2) Configure env
- Copy `.env.example` to `.env`.
- Ensure `ENABLE_DB=true` when you have a database available (local or hosted).

### Option A: With Docker (Postgres + PostGIS)

3) Start database
```
docker compose up -d
```

4) Install deps
```
npm install
```

5) Run migrations (creates PostGIS extension)
```
npm run migration:run
```

6) Start API
```
npm run start:dev
```
- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Option B: Without Docker (local or hosted Postgres)

3) Install Postgres + PostGIS
- Windows: Install PostgreSQL (EDB installer) and add PostGIS via Stack Builder.
- macOS: `brew install postgresql@15 postgis` (or use Postgres.app with PostGIS).
- Ubuntu/Debian: `sudo apt install postgresql-15 postgresql-15-postgis-3`

4) Create database and (optionally) a user
```
# Example using default superuser `postgres`
psql -U postgres -h localhost -c "CREATE DATABASE trucycle;"
# (Optional) create a dedicated user and grant access
psql -U postgres -h localhost -c "CREATE USER trucycle_user WITH PASSWORD 'strongpassword';"
psql -U postgres -h localhost -d trucycle -c "GRANT ALL PRIVILEGES ON DATABASE trucycle TO trucycle_user;"
```
- Note: The migration will run `CREATE EXTENSION IF NOT EXISTS postgis`, but the PostGIS extension must be installed in the cluster (step 3) for this to work.

5) Configure `.env`
- Set `ENABLE_DB=true`.
- Point `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` to your instance.
- For hosted providers (e.g., Supabase/Neon), set `DB_SSL=true`.

6) Install deps and run migrations
```
npm install
npm run migration:run
```

7) Start API
```
npm run start:dev
```
- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Notes on hosted Postgres
- Supabase includes PostGIS; after creating a project, ensure `CREATE EXTENSION postgis;` (the migration also attempts this).
- Some providers require SSL; `DB_SSL=true` is usually sufficient (they use trusted certs).

## Notes
- All geometry columns use SRID 4326 (per architecture doc).
- Mutating routes will adopt Idempotency-Key in future iterations.
- Modules created: auth, users, items, claims, shops, qr, search, notifications, admin, media, addresses, orders.

## API Response & Error Handling
- Success envelope: `{ status: 'success', message: 'OK', data: <payload> }` (applied by a global interceptor). Routes can override `message`.
- Error envelope: `{ status: 'error', message: <reason>, data: null }` (applied by a global exception filter).
- Throw `HttpException` (e.g., `BadRequestException`, `UnauthorizedException`) from handlers; the global filter formats output.

## Auth (JWT)
- Endpoints:
  - `POST /auth/register` { first_name, last_name, email, password, role? } → returns `{ status: 'success', message: 'User registered successfully.', data: { user: { id, firstName, lastName, email, status } } }`. A verification email is sent via Resend.
  - `POST /auth/login` { email, password } → returns `{ status: 'success', message: 'OK', data: { user, token } }`.
- Roles: `customer`, `collector`, `facility`, `admin`, `finance`, `partner`.
- Env vars: `JWT_SECRET`, `JWT_EXPIRES_IN`, `APP_BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM` (see `.env.example`).

### Registration Request Example

```
POST /auth/register
Content-Type: application/json

{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane.doe@example.com",
  "password": "a-strong-password-123"
}
```

Response (201):

```
{
  "status": "success",
  "message": "User registered successfully.",
  "data": {
    "user": {
      "id": "a1b2c3d4-e5f6-...",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane.doe@example.com",
      "status": "pending"
    }
  }
}
```

Notes:
- New users are created with status `pending` and receive a verification email containing a time‑limited token. Until verified, login may be rejected if not `active`.
- Email delivery uses Resend; set `RESEND_API_KEY` and `MAIL_FROM`. Links use `APP_BASE_URL`.

## Resend Verification
- Endpoint: `POST /auth/resend-verification` — resends a verification link to a user with status `pending` only. Always returns a generic success response to avoid email enumeration.
- Request body:
```
POST /auth/resend-verification
Content-Type: application/json

{
  "email": "new.user@example.com"
}
```
- Response (201 Created):
```
{
  "status": "success",
  "message": "Verification email sent successfully.",
  "data": null
}
```
- Security: Rate-limit this endpoint and do not disclose whether an email exists or its status.

## Forget Password
- Endpoint: `POST /auth/forget-password` — sends a password reset link to the user if the account exists and is eligible. Always returns a generic success response to prevent email enumeration.
- Request body:
```
POST /auth/forget-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```
- Response (201 Created):
```
{
  "status": "success",
  "message": "Reset password email sent successfully.",
  "data": null
}
```
- Behavior:
  - If the email corresponds to an existing account that is not deleted, a time-limited reset token is generated and emailed.
  - The reset link format: `${APP_BASE_URL}/auth/reset-password?token=<jwt>`
  - Token type is `reset` and expires in `1h` by default. You may override via `JWT_RESET_EXPIRES_IN`.
- Security:
  - Returns the same response regardless of whether the email exists.
  - Consider adding rate-limiting and email delivery monitoring.

## Reset Password
- Endpoint: `POST /auth/reset-password` — resets a user's password using a time-limited reset token.
- Request body:
```
POST /auth/reset-password
Content-Type: application/json

{
  "token": "<reset-token>",
  "new_password": "new-StrongP@ssw0rd"
}
```
- Response (201 Created):
```
{
  "status": "success",
  "message": "Password changed successfully.",
  "data": null
}
```
- Behavior:
  - Accepts only tokens issued for password resets (type `reset`), rejects invalid/mismatched/expired tokens with a generic error.
  - The API derives the user from the token subject; no uid is needed in the request body.
  - Updates the user's password. Accounts marked `deleted` or `suspended` are rejected.
- Security:
  - Return generic errors for invalid/expired tokens.
  - Rate-limit this endpoint to reduce brute force attempts.

## Verify User
- Endpoint: `POST /auth/verify` — verifies a user using a time‑limited verification token and activates the account if pending. Returns fresh access and refresh tokens.
- Request body:
```
POST /auth/verify
Content-Type: application/json

{
  "token": "<verification-token>"
}
```
- Response (200 OK):
```
{
  "status": "success",
  "message": "Verification successfully.",
  "data": {
    "user": {
      "id": "a1b2c3d4-e5f6-...",
      "firstName": "name",
      "lastName": "name",
      "email": "new.user@example.com",
      "status": "active"
    },
    "tokens": {
      "accessToken": "<jwt>",
      "refreshToken": "<jwt>",
      "accessTokenExpiry": "2025-01-01T12:00:00.000Z",
      "refreshTokenExpiry": "2025-02-01T12:00:00.000Z"
    }
  }
}
```
- Behavior:
  - Accepts only tokens issued for verification (type `verify`), rejects invalid/mismatched/expired tokens with a generic error.
  - If the user is `pending`, sets status to `active`. If already `active`, still succeeds and returns tokens.
  - Suspended or deleted accounts are not eligible for verification.
- Security: Return generic errors for invalid/expired tokens to avoid leaking account state. Rate-limit this endpoint.

## Login
- Endpoint: `POST /auth/login` — authenticates a user with email and password and returns access and refresh tokens. User must be `active`.
- Request body:
```
POST /auth/login
Content-Type: application/json

{
  "email": "existing.user@example.com",
  "password": "my-correct-password"
}
```
- Response (200 OK):
```
{
  "status": "success",
  "message": "Login successful.",
  "data": {
    "user": { "id": "...", "firstName": "name", "lastName": "name", "email": "existing.user@example.com", "status": "active" },
    "tokens": {
      "accessToken": "<jwt>",
      "refreshToken": "<jwt>",
      "accessTokenExpiry": "2025-01-01T12:00:00.000Z",
      "refreshTokenExpiry": "2025-02-01T12:00:00.000Z"
    }
  }
}
```
- Security: lock accounts on repeated failures, rate-limit, and return generic "Invalid credentials" to avoid information leakage.

## Get Authenticated User
- Endpoint: `GET /auth/me` — retrieves the basic profile for the user associated with the provided bearer JWT.
- Auth: Requires `Authorization: Bearer <accessToken>` header.
- Request body: none
- Response (200 OK):
```
{
  "status": "success",
  "message": "User retrieved successfully.",
  "data": {
    "user": {
      "id": "a1b2c3d4-e5f6-...",
      "firstName": "name",
      "lastName": "name",
      "email": "new.user@example.com",
      "status": "active"
    }
  }
}
```
- Security: Protected by JWT; returns only non-sensitive fields. Use short‑lived access tokens and rotate refresh tokens regularly.

## Item Listings

### State Machine Overview
- **Exchange**: `draft -> active -> claimed -> complete`
- **Donate**: `draft -> pending_dropoff -> awaiting_collection -> claimed -> complete` (rejection path `pending_dropoff -> rejected`)
- **Recycle**: `draft -> pending_recycle -> pending_recycle_processing -> recycled`
- **Scan events**:
  - `DROP_OFF_IN` (accept): `pending_dropoff -> awaiting_collection` executed by shop attendant
  - `DROP_OFF_IN` (reject): `pending_dropoff -> rejected` with a captured reason
  - `CLAIM_OUT`: `claimed -> complete` captured at hand-off
  - `RECYCLE_IN`: `pending_recycle -> pending_recycle_processing`
  - `RECYCLE_OUT`: `pending_recycle_processing -> recycled`

### Create Item (`POST /items`)
- Auth: Requires `Authorization: Bearer <accessToken>`.
- Purpose: Donors publish inventory that starts in the correct state based on pickup option, with geocoded coordinates persisted into PostGIS for downstream logistics and search.
- Request body example:
```
{
  "title": "Vintage Wooden Dining Table",
  "description": "Solid oak dining table, seats 6-8 people. Minor scratches but in good condition.",
  "condition": "good",
  "category": "furniture",
  "address_line": "10 Downing Street, London",
  "postcode": "SW1A 2AA",
  "images": [
    {
      "url": "https://example.com/item1_img1.jpg",
      "altText": "Dining table front view"
    }
  ],
  "pickup_option": "donate",
  "dropoff_location_id": "4c2b8db4-2d15-4c8e-92d2-81248b14d455",
  "delivery_preferences": "home_pickup",
  "metadata": {
    "weight_kg": 50,
    "dimensions_cm": "180x90x75",
    "material": "oak wood"
  }
}
```
- Response (201 Created):
```
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "9f5c2c8e",
    "title": "Vintage Wooden Dining Table",
    "status": "pending_dropoff",
    "pickup_option": "donate",
    "location": {
      "address_line": "10 Downing Street, London",
      "postcode": "SW1A 2AA",
      "latitude": 51.5034,
      "longitude": -0.1276
    },
    "qr_code": "https://cdn.trucycle.com/qrs/item-9f5c2c8e.png",
    "created_at": "2025-09-25T12:00:00.000Z"
  }
}
```
- Behavior & security notes:
  - Input is trimmed, constrained (images = 10 unique URLs) and stored with minimal metadata (`jsonb`) to mitigate injection.
  - `pickup_option=donate` enforces `dropoff_location_id` and seeds the `pending_dropoff` state; `recycle` begins in `pending_recycle`; `exchange` begins in `active`.
  - Addresses are forward-geocoded via OpenStreetMap, terminated after a short timeout, and validated against the active service zone polygon before persistence.
  - Coordinates are saved both as `latitude`/`longitude` floats and as a `geometry(Point, 4326)` column for spatial queries.
  - QR codes default to `https://cdn.trucycle.com/qrs/item-<id>.png`; override via `ITEM_QR_BASE_URL` if a different CDN is required.
- Configuration bits (optional environment variables):
  - `OSM_SEARCH_URL` (defaults to the public Nominatim endpoint)
  - `OSM_USER_AGENT` (set to satisfy OSM usage policy; falls back to a TruCycle identifier)
  - `OSM_TIMEOUT_MS` (geocoder request timeout, default 5000 ms)
  - `ITEM_QR_BASE_URL` (base URL for generated QR image links)

### Retrieve Items (`GET /items`)
- Purpose: Query public listings near a point with optional status/category filters. Falls back to postcode geocoding when coordinates are missing.
- Auth: None (public, read-only).
- Required location: Provide either `lat`/`lng` pair or `postcode` (UK-style) so the service can geocode a search origin.
- Optional query: `radius` (km, default 5, max 50), `status` (defaults to `active` and restricted to public states), `category` (case-insensitive exact match), `page` (default 1), `limit` (default 10, max 50).
- Distance ordering: Results are sorted by proximity with distances rounded to the nearest 0.1 km.
- Safety: Inputs are clamped to mitigate wide scans; responses omit donor identifiers, cap image lists to five vetted HTTPS URLs, and fall back to deterministic QR code URLs when missing.
- Example request:
```
GET /items?lat=51.5072&lng=-0.1276&radius=5&status=active&category=furniture&page=1&limit=10
```
- Response (200 OK):
```
{
  "status": "success",
  "message": "OK",
  "data": {
    "search_origin": { "lat": 51.5072, "lng": -0.1276, "radius_km": 5 },
    "items": [
      {
        "id": "9f5c2c8e",
        "title": "Vintage Wooden Dining Table",
        "status": "active",
        "distance_km": 1.2,
        "pickup_option": "donate",
        "qr_code": "https://cdn.trucycle.com/qrs/item-9f5c2c8e.png",
        "images": ["https://example.com/item1_img1.jpg"],
        "created_at": "2025-09-25T12:00:00Z"
      }
    ]
  }
}
```

### Retrieve Item Detail (`GET /items/{id}`)
- Purpose: Fetch a single public listing with location, media, metadata, and recent scan events.
- Auth: None (public, read-only).
- Availability: Only items in public states (active/pending logistics) are returned; others respond with 404 to avoid leaking private listings.
- Response payload trims address details to postcode, rounds coordinates to stored precision, surfaces up to five vetted HTTPS image URLs, and falls back to deterministic QR URLs if missing.
- Scan events (max 25) are ordered newest-first and include scan type, optional shop ID, and ISO timestamps; the list silently returns empty if the audit table is unavailable.
- Response (200 OK):
```
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "9f5c2c8e",
    "title": "Vintage Wooden Dining Table",
    "description": "Solid oak dining table, seats 6-8 people.",
    "status": "active",
    "location": {
      "postcode": "SW1A 2AA",
      "latitude": 51.5034,
      "longitude": -0.1276
    },
    "qr_code": "https://cdn.trucycle.com/qrs/item-9f5c2c8e.png",
    "scan_events": [
      {
        "scan_type": "DROP_OFF_IN",
        "shop_id": "4c2b8db4",
        "scanned_at": "2025-09-26T09:00:00Z"
      }
    ],
    "images": [
      {
        "url": "https://example.com/item1_img1.jpg",
        "alt_text": "Dining table front view"
      }
    ],
    "pickup_option": "exchange",
    "metadata": {
      "weight_kg": 50,
      "dimensions_cm": "180x90x75",
      "material": "oak wood"
    },
    "created_at": "2025-09-25T12:00:00Z"
  }
}
```

### Update Item (`PATCH /items/{id}`)
- Purpose: Authenticated donors adjust listing fields such as title, condition, postcode, delivery preferences, images, and structured metadata without recreating the listing.
- Auth: Requires `Authorization: Bearer <accessToken>`.
- Permissions: Only the listing owner can edit; requests are rejected for items that have progressed beyond recyclable/collection processing states.
- Location safety: Updating `address_line` or `postcode` triggers re-geocoding and a fresh service-zone check; updates outside supported polygons are blocked.
- Allowed body fields: `title`, `description`, `condition`, `category`, `address_line`, `postcode`, `delivery_preferences`, `metadata`, `images`, `dropoff_location_id`.
- Response (200 OK):
```
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "9f5c2c8e",
    "title": "Updated Dining Table",
    "condition": "fair",
    "postcode": "EC1A 1BB",
    "latitude": 51.5202,
    "longitude": -0.0979,
    "updated_at": "2025-09-25T14:00:00Z"
  }
}
```

### Delete Item (`DELETE /items/{id}`)
- Purpose: Authenticated donors permanently remove draft or active listings when they are no longer available.
- Auth: Requires `Authorization: Bearer <accessToken>`.
- Permissions: Only the listing owner can delete; items that have moved beyond pickup/processing states are protected.
- Behavior: Deletes the item record and associated metadata; callers receive `204 No Content` on success.
- Response: No body (204).
### Create Claim (`POST /claims`)
- Purpose: Collectors reserve an active listing so logistics teams can review and approve fulfilment.
- Auth: Requires `Authorization: Bearer <accessToken>` with `collector` or `admin` role.
- Preconditions: Claimant must be `active`; only items marked `active` are eligible and a listing may have one open claim at a time.
- Safeguards: Rejects self-claims, duplicate claims, and attempts against inactive or non-public listings.
- Response (201 Created):
```
{
  "id": "f2a8471d",
  "item_id": "9f5c2c8e",
  "collector_id": "7b4b29de",
  "status": "pending_approval",
  "created_at": "2025-09-25T12:10:00Z"
}
```
## Create Address
- Endpoint: `POST /addresses` — creates a new user address and validates it lies within the active London service zone.
- Auth: Requires `Authorization: Bearer <accessToken>` header.
- Request body:
```
{
  "label": "Home",
  "line1": "221B Baker Street",
  "city": "London",
  "postcode": "NW1 6XE",
  "latitude": 51.523767,
  "longitude": -0.1585557,
  "is_default": true
}
```
- Notes:
  - `latitude` and `longitude` are required to place the point; the backend converts to `geometry(Point, 4326)`.
  - The payload accepts `is_default` and maps it to the internal `isDefault` field.
  - The address must fall inside the `London` service zone polygon; otherwise returns `400 Bad Request`.
- Response (201 Created):
```
{
  "status": "success",
  "message": "Address created successfully.",
  "data": {
    "id": "f6e5d4c3-...",
    "label": "Home",
    "line1": "221B Baker Street",
    "city": "London",
    "is_default": true
  }
}
```
- Security: JWT-protected; validates zone membership server-side; avoids exposing internal geometry details in the response.

## Create Pickup Order
- Endpoint: `POST /orders` — donors create a listing which generates a pickup order and one or more items. The order copies the origin address geometry for immutability. Matching is asynchronous.
- Auth: Requires `Authorization: Bearer <accessToken>` header.
- Request body:
```
{
  "origin_address_id": "f6e5d4c3-...",
  "notes": "Items are in the front garden, please be careful of the roses.",
  "items": [
    {
      "material_id": "e4f5a6b7-...",
      "category": "electronics.household",
      "qty": 2,
      "status": "great",
      "photos": [
        "s3-url-to-photo-1.jpg",
        "s3-url-to-photo-2.jpg"
      ],
      "weee_data": {
        "make": "Samsung",
        "model": "UE55RU7300"
      }
    }
  ]
}
```
- Response (202 Accepted):
```
{
  "status": "success",
  "message": "Your listing has been submitted and is pending review.",
  "data": {
    "id": "c1d2e3f4-...",
    "status": "requested",
    "placed_at": "2025-09-11T13:45:00.000Z",
    "items": [
      {
        "id": "g8h9i0j1-...",
        "declared_grade": "Great",
        "photos": ["s3-url-to-photo-1.jpg", "s3-url-to-photo-2.jpg"]
      }
    ]
  }
}
```
- Validation and behavior:
  - Requires at least one item; quantity must be positive.
  - Verifies the `origin_address_id` belongs to the authenticated user.
  - Ensures the point lies within the active London service zone; otherwise responds 400.
  - Stores item metadata (category, photos, declared grade/status, and `weee_data`) in a flexible JSONB field for future enrichment.
- Security: JWT-protected; validates ownership and zone server-side; does not disclose internal entity structure in responses.

## Search Listings (Collectors)
- Endpoint: `GET /orders/search` — find nearby active listings using geospatial search.
- Auth: Requires `Authorization: Bearer <accessToken>` and `collector` role.
- Query params:
  - `lat` (number, required): your latitude.
  - `lon` (number, required): your longitude.
  - `distance` (number, optional): search radius; defaults to 10.
  - `unit` (string, optional): `km` (default) or `mi`.
  - `category` (string, optional): category prefix filter, e.g., `electronics`.
- Response (200 OK):
```
{
  "status": "success",
  "message": "Listings retrieved.",
  "data": [
    {
      "id": "c1d2e3f4-...",
      "donor": {
        "username": "Jane D.",
        "rating": 4.8
      },
      "items_summary": "Samsung Television",
      "location": { "lat": 51.51, "lon": -0.13 },
      "distance_meters": 1500
    }
  ]
}
```
- Behavior and security:
  - Uses `ST_DWithin` with geography for accurate meter-based distance.
  - Limits precision of returned coordinates (~2 decimals) to avoid revealing exact donor location.
  - Currently returns a public display name "First L."; rating is not yet implemented and may be `null`.
  - Filters for active statuses; future changes may refine eligibility.










### Approve Claim (`PATCH /claims/{id}/approve`)
- Purpose: Admins transition pending claims into an approved state once logistics are confirmed.
- Auth: Requires `Authorization: Bearer <accessToken>` with the `admin` role.
- Preconditions: Claim must exist and remain `pending_approval`; conflicts return 409 instead of silently re-approving.
- Response (200 OK):
```
{
  "id": "f2a8471d",
  "status": "approved",
  "approved_at": "2025-09-25T12:15:00Z"
}
```

### QR Scan Workflow

#### Item View (`GET /qr/item/{item_id}/view`)
- Purpose: Provide attendants and logistics with the latest item state before taking action.
- Auth: Requires `Authorization: Bearer <accessToken>`; any active account may view.
- Response (200 OK):
```
{
  "id": "f2a8471d",
  "status": "awaiting_collection",
  "pickup_option": "donate",
  "qr_code": "https://cdn.trucycle.com/qrs/item-f2a8471d.png",
  "claim": {
    "id": "c2d3471d",
    "status": "approved",
    "collector_id": "fd51ef7e"
  },
  "scan_events": [
    { "scan_type": "VIEW", "shop_id": null, "scanned_at": "2025-09-25T12:58:00Z" }
  ]
}
```
- Behavior:
  - Records a `VIEW` scan event for traceability.
  - Returns the active claim (if any) so attendants can confirm eligibility before moving to the next step.

#### Donor Drop-off (`POST /qr/item/{item_id}/dropoff-in`)
- Purpose: Shop attendants confirm that a donor handed the item over.
- Auth: Requires `Authorization: Bearer <accessToken>` with the `facility` role (admins may override).
- Request body:
```
{
  "shop_id": "4c2b8db4",
  "action": "accept"
}
```
- Alternate reject payload:
```
{
  "shop_id": "4c2b8db4",
  "action": "reject",
  "reason": "Item too damaged"
}
```
- Response (200 OK) when accepted:
```
{
  "scan_result": "accepted",
  "scan_type": "DROP_OFF_IN",
  "item_status": "awaiting_collection",
  "scanned_at": "2025-09-26T09:00:00Z",
  "scan_events": [
    { "scan_type": "DROP_OFF_IN", "shop_id": "4c2b8db4", "scanned_at": "2025-09-26T09:00:00Z" }
  ]
}
```
- Response (200 OK) when rejected:
```
{
  "scan_result": "rejected",
  "scan_type": "DROP_OFF_IN",
  "item_status": "rejected",
  "rejection_reason": "Item too damaged",
  "scanned_at": "2025-09-26T09:05:00Z",
  "scan_events": [
    { "scan_type": "DROP_OFF_IN", "shop_id": "4c2b8db4", "scanned_at": "2025-09-26T09:05:00Z" }
  ]
}
```
- Behavior:
  - Rejects mismatched scans unless the attendant's `shop_id` matches the item's stored `dropoff_location_id` (case-insensitive comparison).
  - Defaults the action to `accept`; when `action` is `reject`, a non-empty `reason` (<= 240 chars) is required and the item status transitions to `rejected`.
  - Accepted scans move `pending_dropoff` items to `awaiting_collection` and leave already accepted items untouched.
  - Each scan records a `DROP_OFF_IN` event for auditing, returned in the `scan_events` array.
#### Collector Pickup (`POST /qr/item/{item_id}/claim-out`)
- Purpose: Collectors or admins finalize an approved claim.
- Auth: Requires `Authorization: Bearer <accessToken>` with the `collector` role (admins may override).
- Request body:
```
{
  "shop_id": "shop-117"
}
```
- Response (200 OK):
```
{
  "id": "f2a8471d",
  "status": "complete",
  "completed_at": "2025-09-25T13:00:00Z",
  "scan_events": [
    { "scan_type": "CLAIM_OUT", "shop_id": "shop-117", "scanned_at": "2025-09-25T13:00:00Z" }
  ]
}
```
- Behavior:
  - Ensures the authenticated collector owns the claim (admins may override) and that the claim is already `approved`.
  - Marks the claim `complete`, stamps `completed_at`, transitions the item to `complete`, and records a `CLAIM_OUT` scan.

#### Recycle Pickup (`POST /qr/item/{item_id}/recycle-in`)
- Purpose: Logistics partners log that a recycle-bound item entered processing.
- Auth: Requires `Authorization: Bearer <accessToken>` with `partner` (or `facility`/`admin`) roles.
- Request body:
```
{
  "shop_id": "logi-hub-4"
}
```
- Response (200 OK):
```
{
  "id": "9a44ce12",
  "status": "pending_recycle_processing",
  "recycle_in_at": "2025-09-25T14:05:00Z",
  "shop_id": "logi-hub-4",
  "scan_events": [
    { "scan_type": "RECYCLE_IN", "shop_id": "logi-hub-4", "scanned_at": "2025-09-25T14:05:00Z" }
  ]
}
```
- Behavior:
  - Accepts only items created with the `recycle` pickup option and still in `pending_recycle`.
  - Moves the item to `pending_recycle_processing` and logs a `RECYCLE_IN` event; repeated scans short-circuit safely.

#### Recycle Complete (`POST /qr/item/{item_id}/recycle-out`)
- Purpose: Logistics teams confirm recycling is finished.
- Auth: Requires `Authorization: Bearer <accessToken>` with `partner` (or `facility`/`admin`) roles.
- Request body:
```
{
  "shop_id": "logi-hub-4"
}
```
- Response (200 OK):
```
{
  "id": "9a44ce12",
  "status": "recycled",
  "recycle_out_at": "2025-09-25T16:45:00Z",
  "shop_id": "logi-hub-4",
  "scan_events": [
    { "scan_type": "RECYCLE_OUT", "shop_id": "logi-hub-4", "scanned_at": "2025-09-25T16:45:00Z" }
  ]
}
```
- Behavior:
  - Requires the item to be in `pending_recycle_processing`; otherwise returns `409 Conflict`.
  - Sets the item status to `recycled` and records a `RECYCLE_OUT` scan, preserving an auditable event trail.
