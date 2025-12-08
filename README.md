# TruCycle Backend API

A comprehensive circular economy platform built with NestJS, TypeORM, PostgreSQL/PostGIS, and Socket.IO. This API powers a marketplace for exchanging, donating, and recycling items while tracking environmental impact and rewarding sustainable behavior.

## Table of Contents

1. [Prerequisites & Quick Start](#prerequisites--quick-start)
2. [Environment Variables Reference](#environment-variables-reference)
3. [How The Application Works](#how-the-application-works)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Notifications & Email System](#notifications--email-system)
6. [Important Notes & Caveats](#important-notes--caveats)
7. [Handover Information](#handover-information)

---

## Prerequisites & Quick Start

### Prerequisites

- **Node.js 18+** - JavaScript runtime
- **PostgreSQL 15+ with PostGIS extension** - Spatial database
- **Docker Desktop** (recommended) or local PostgreSQL installation

### Quick Setup

1) **Clone and configure environment**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env and set ENABLE_DB=true
   # Configure other required variables (see Environment Variables section)
   ```

2) **Choose your database setup**

   **Option A: Docker (Recommended)**
   ```bash
   # Start PostgreSQL with PostGIS
   docker compose up -d
   
   # Install Node dependencies
   npm install
   
   # Run database migrations
   npm run migration:run
   ```

   **Option B: Local/Hosted PostgreSQL**
   ```bash
   # Install PostgreSQL + PostGIS
   # - Windows: Use EDB installer + Stack Builder for PostGIS
   # - macOS: brew install postgresql@15 postgis
   # - Linux: sudo apt install postgresql-15 postgresql-15-postgis-3
   
   # Create database
   psql -U postgres -c "CREATE DATABASE trucycle;"
   
   # Update .env with your database credentials
   # DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
   # Set DB_SSL=true for hosted providers (Supabase, Neon, etc.)
   
   # Install dependencies and run migrations
   npm install
   npm run migration:run
   ```

3) **Start the API**
   ```bash
   npm run start:dev
   ```
   
   - Swagger Documentation: http://localhost:3000/docs
   - OpenAPI Spec: http://localhost:3000/openapi.json
   - Messaging Test UI: http://localhost:3000/public/test/messages

---

## Environment Variables Reference

This section details all environment variables needed to run TruCycle. Copy `.env.example` to `.env` and configure these values.

### Core Application Settings

```bash
NODE_ENV=development        # Environment: development | production | test
PORT=3000                   # Port the API listens on
APP_BASE_URL=http://localhost:3000  # Base URL for email links and QR codes
```

**Purpose**: Controls basic application behavior, logging, and URL generation for verification emails and QR code content.

### Database Configuration

```bash
ENABLE_DB=true             # Set to 'true' to enable TypeORM/PostgreSQL
DB_HOST=localhost          # Database server hostname
DB_PORT=5432              # PostgreSQL port (default: 5432)
DB_USER=postgres          # Database username
DB_PASS=postgres          # Database password
DB_NAME=trucycle          # Database name
DB_SSL=false              # Enable SSL for hosted databases (true for Supabase/Neon)
DB_LOGGING=false          # Enable TypeORM SQL query logging
TYPEORM_SYNC=false        # Auto-sync schema (dev only, use migrations in production)
```

**Purpose**: Connects the API to PostgreSQL. The PostGIS extension is required for geospatial queries (item locations, nearby search, service zones).

**Account Setup**:
- **Local**: Install PostgreSQL and create a database with the PostGIS extension
- **Supabase**: Create a project at https://supabase.com (includes PostGIS, set `DB_SSL=true`)
- **Neon**: Create a database at https://neon.tech (supports PostGIS, set `DB_SSL=true`)

### Authentication (JWT)

```bash
JWT_SECRET=change-me-to-secure-random-string   # Secret key for signing JWTs
JWT_EXPIRES_IN=7d                               # Access token expiration (e.g., 1h, 7d)
JWT_RESET_EXPIRES_IN=1h                         # Password reset token expiration
```

**Purpose**: Controls authentication tokens. Users receive JWT access tokens on login that must be included in `Authorization: Bearer <token>` headers.

**Security**: 
- Generate a strong random secret: `openssl rand -base64 32`
- Never commit secrets to version control
- Use short-lived access tokens (1h-24h) in production

### Email Service (Resend)

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx    # API key from Resend dashboard
MAIL_FROM="TruCycle <no-reply@trucycle.app>"  # Sender email address
```

**Purpose**: Sends transactional emails (account verification, password reset, nearby item alerts).

**Account Setup**:
1. Sign up at https://resend.com
2. Verify your domain (or use their test domain for development)
3. Generate an API key from the dashboard
4. Set `RESEND_API_KEY` in your `.env`

**Emails Sent**:
- **Account Verification**: Sent on registration with a time-limited token link
- **Password Reset**: Sent when user requests password reset
- **Nearby Item Alerts**: Optional email to users within radius of new listings

**Caveats**:
- Free tier: 100 emails/day, 3,000/month
- Test emails only work with verified domains in production
- Rate limit the forgot password endpoint to prevent abuse

### Image & QR Code Storage (Cloudinary)

```bash
CLOUDINARY_CLOUD_NAME=your-cloud-name    # Your Cloudinary cloud name
CLOUDINARY_API_KEY=123456789             # API key from Cloudinary dashboard
CLOUDINARY_API_SECRET=abcdef123456       # API secret
CLOUDINARY_QR_FOLDER=qrs                 # Folder for QR code images (optional)
CLOUDINARY_MESSAGE_FOLDER=messages       # Folder for chat images (optional)
ITEM_QR_BASE_URL=https://res.cloudinary.com/your-cloud/image/upload/qrs  # Base URL for QR images
```

**Purpose**: Stores QR code images (for item tracking) and chat message attachments.

**Account Setup**:
1. Sign up at https://cloudinary.com
2. Get credentials from Dashboard > Account Details
3. Set cloud name, API key, and API secret

**What Gets Uploaded**:
- **QR Codes**: Generated PNG images for each item listing (used by facility staff for scanning)
- **Chat Images**: Photos sent in direct messages between users
- **Item Photos**: (if implementing media upload endpoints)

**Caveats**:
- Free tier: 25 GB storage, 25 GB monthly bandwidth
- QR codes are auto-generated when items are created
- Chat images are uploaded when users send image messages via WebSocket or HTTP

### CO2 Impact Estimation (Climatiq)

```bash
CLIMATIQ_API_KEY=your-climatiq-key                    # API key from Climatiq
CLIMATIQ_EMISSION_FACTOR_ID=waste-type_recycling_...  # Emission factor ID
CLIMATIQ_API_URL=https://api.climatiq.io/data/v1/estimate
MONTHLY_CO2_SAVINGS_GOAL_KG=50                       # Monthly savings target
```

**Purpose**: Estimates CO2 savings for recycled/donated items based on weight and volume.

**Account Setup**:
1. Sign up at https://www.climatiq.io/
2. Browse the emission factors catalog to find appropriate IDs for your use case
3. Copy your API key from the dashboard

**How It Works**:
- When items are created with weight/dimensions, the system estimates CO2 impact
- Uses Climatiq's emission factors database for accurate calculations
- Stored in the `co2_saved_kg` field on items
- Aggregated for user impact metrics

**Caveats**:
- Optional: If not configured, CO2 fields remain `null`
- Free tier: 1,000 API calls/month
- Choose emission factors appropriate for your item categories

### Rewards System

```bash
REWARDS_CURRENCY=PTS                # Currency code (3 characters, e.g., PTS, TRU, ECO)
REWARD_CLAIM_COLLECTOR=10           # Points awarded to collector on claim completion
REWARD_CLAIM_DONOR=5                # Points awarded to donor on claim completion
```

**Purpose**: Gamifies the platform by rewarding users with points for sustainable behavior.

**How It Works**:
- Users automatically get a wallet on first reward
- Collectors earn points when they complete item pickups
- Donors earn points when their items are collected
- Points are tracked in a ledger for audit trail
- Idempotent: Duplicate rewards are prevented via unique constraints

**Caveats**:
- Rewards are currently symbolic (no redemption system yet)
- Currency code is stored and displayed in the wallet
- Future iterations may add redemption, leaderboards, etc.

### Nearby Item Alerts

```bash
NEARBY_ITEM_ALERT_RADIUS_KM=20           # Radius to search for nearby users (km)
NEARBY_ITEM_ALERT_MAX_RECIPIENTS=200     # Max number of users to email per item
```

**Purpose**: Automatically emails users when new items are listed near their location.

**How It Works**:
- When an item is created with `active` or `awaiting_collection` status
- System finds users within the specified radius
- Sends email notification to up to MAX_RECIPIENTS users
- Uses user's address or last known location

**Caveats**:
- Requires Resend API key to be configured
- High values may trigger rate limits
- Consider implementing user preferences to opt-in/out

### CORS Settings

```bash
CORS_ORIGINS=*    # Allowed origins (* for development, specific domains for production)
```

**Purpose**: Controls which domains can access the API from browsers.

**Production**: Set to specific domains, e.g., `https://app.trucycle.com,https://admin.trucycle.com`

### OpenStreetMap Geocoding (Optional)

```bash
OSM_SEARCH_URL=https://nominatim.openstreetmap.org/search
OSM_USER_AGENT=TruCycle/1.0
OSM_TIMEOUT_MS=5000
```

**Purpose**: Converts addresses to coordinates (latitude/longitude) for geospatial features.

**How It Works**:
- When creating items or addresses, the system geocodes the postcode/address
- Validates coordinates fall within active service zones (e.g., London)
- Uses OpenStreetMap's free Nominatim service

**Caveats**:
- OSM has usage limits; for high volume, consider self-hosting Nominatim
- Set a meaningful user agent to comply with OSM usage policy
- Geocoding failures result in validation errors

---

## How The Application Works

### System Overview

TruCycle is a circular economy platform that connects donors, collectors, and recycling facilities. The system supports three main item flows:

1. **Exchange**: Direct peer-to-peer item exchange (no drop-off needed)
2. **Donate**: Items dropped off at partner shops, then claimed by collectors
3. **Recycle**: Items sent to recycling facilities for processing

### User Roles & Permissions

- **customer**: Can list items, claim items, send messages
- **collector**: Like customer but can claim items for pickup
- **facility**: Shop staff who scan QR codes for drop-offs and pickups
- **partner**: Shop owners who manage their drop-off locations
- **admin**: Full system access, can approve claims and manage users
- **finance**: (Reserved for financial operations)

### Item Lifecycle & State Machines

Items transition through different states based on their pickup option:

#### Exchange Flow
```
draft → active → claimed → complete
```
- User creates item with `pickup_option=exchange`
- Starts in `draft`, moves to `active` when published
- Collector claims it → `claimed`
- Item is collected via QR scan or `/items/:id/collect` → `complete`

#### Donate Flow
```
draft → pending_dropoff → awaiting_collection → claimed → complete
                 ↓ (if rejected)
              rejected
```
- User creates item with `pickup_option=donate` and `dropoff_location_id`
- Starts in `pending_dropoff`
- Facility staff scans QR code at drop-off:
  - **Accept** → `awaiting_collection`
  - **Reject** → `rejected` (with reason)
- Collector claims item → `claimed`
- Item is collected → `complete`

#### Recycle Flow
```
draft → pending_recycle → pending_recycle_processing → recycled
```
- User creates item with `pickup_option=recycle`
- Facility scans `RECYCLE_IN` → `pending_recycle_processing`
- Facility scans `RECYCLE_OUT` → `recycled`

### Claims Workflow

1. **Collector creates claim** (`POST /claims`) → status: `pending_approval`
   - Validates item is `active` or `awaiting_collection`
   - Prevents duplicate claims and self-claims
   - Sends notification to donor

2. **Admin approves claim** (`PATCH /claims/:id/approve`) → status: `approved`
   - Item status changes to `claimed`
   - Sends notification to collector

3. **Item is collected** (via QR scan or `/items/:id/collect`) → claim: `complete`, item: `complete`
   - Records scan event
   - Triggers rewards for both donor and collector
   - Sends completion notifications

### QR Code Workflow

QR codes enable facility staff to track items without logging into accounts.

**Scan Types**:

| Scan Type | Who | When | Effect |
|-----------|-----|------|--------|
| `ITEM_VIEW` | Anyone | Any time | Read-only view of item status |
| `DROP_OFF_IN` | Facility staff | Donor drops off item | Accept → `awaiting_collection` or Reject → `rejected` |
| `CLAIM_OUT` | Facility staff | Collector picks up | Claim completed, rewards issued |
| `RECYCLE_IN` | Facility staff | Item arrives for recycling | → `pending_recycle_processing` |
| `RECYCLE_OUT` | Facility staff | Recycling complete | → `recycled` |

**QR Code Content**:
- Contains URL: `{APP_BASE_URL}/qr/item/{itemId}/view`
- PNG stored in Cloudinary
- Accessible via `item.qr_code` field

### Geospatial Features

The system uses PostGIS for location-based features:

- **Service Zones**: Defines areas where the service operates (e.g., London)
- **Nearby Search**: Find items within N km of a location using `ST_DWithin`
- **Geocoding**: Converts postcodes to coordinates using OpenStreetMap
- **Validation**: Ensures all addresses fall within active service zones

All coordinates use **SRID 4326** (WGS 84 - standard GPS coordinates).

### Messaging & Real-Time Chat

Users can communicate via 1-on-1 chat rooms:

- **HTTP endpoints**: Create rooms, send messages, upload images
- **WebSocket (Socket.IO)**: Real-time messaging, presence, typing indicators
- **Image uploads**: Automatically uploaded to Cloudinary
- **Presence tracking**: In-memory tracking of online users

See detailed documentation in the Messaging section below.

### Notifications System

Two types of notifications:

1. **In-app notifications**: Stored in database, delivered via WebSocket
2. **Email notifications**: Sent via Resend for important events

**Triggers**:
- New claim request
- Claim approved
- Item collected
- Nearby items listed
- Drop-off/pickup events

### Rewards & Gamification

- **Wallets**: Each user has a wallet (auto-created on first reward)
- **Ledger**: Audit trail of all point transactions
- **Earnings**:
  - Collector: 10 points per completed claim (configurable)
  - Donor: 5 points per completed claim (configurable)
- **Idempotency**: Prevents duplicate rewards via unique constraints

---

## API Endpoints Reference

### Authentication Endpoints

All authentication endpoints return standardized response envelopes:
```json
{
  "status": "success",
  "message": "OK",
  "data": { ... }
}
```

#### Register New User

**`POST /auth/register`**

Create a new user account. Sends verification email.
**Request Body**:
```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane.doe@example.com",
  "password": "StrongP@ssw0rd123",
  "role": "customer"  // Optional: customer (default), collector, partner
}
```

**Response** (201 Created):
```json
{
  "status": "success",
  "message": "User registered successfully.",
  "data": {
    "user": {
      "id": "uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane.doe@example.com",
      "status": "pending"
    }
  }
}
```

**Notes**:
- New users start with `status=pending`
- Verification email sent with time-limited token
- Users must verify before logging in (enforced at login)

**Caveats**:
- Email must be unique
- Password should meet minimum complexity requirements
- Rate limit this endpoint to prevent abuse

---

#### Login

**`POST /auth/login`**

Authenticate with email and password. Returns JWT tokens.

**Request Body**:
```json
{
  "email": "jane.doe@example.com",
  "password": "StrongP@ssw0rd123"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane.doe@example.com",
      "status": "active"
    },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "eyJhbG...",
      "accessTokenExpiry": "2025-01-01T12:00:00.000Z",
      "refreshTokenExpiry": "2025-02-01T12:00:00.000Z"
    }
  }
}
```

**Notes**:
- Only `active` users can log in
- Returns both access and refresh tokens
- Include `Authorization: Bearer <accessToken>` in subsequent requests

**Caveats**:
- Returns generic "Invalid credentials" on any failure (prevents email enumeration)
- Implement account locking after N failed attempts
- Rate limit this endpoint

---

#### Verify Email

**`POST /auth/verify`**

Verify user email with token from email link. Activates account.

**Request Body**:
```json
{
  "token": "verification-jwt-token"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "Verification successfully.",
  "data": {
    "user": { "id": "uuid", "status": "active", ... },
    "tokens": { "accessToken": "...", ... }
  }
}
```

**Notes**:
- Token expires after configured time (default: 24h)
- Changes user status from `pending` to `active`
- Returns tokens so user can immediately access the app

---

#### Resend Verification Email

**`POST /auth/resend-verification`**

Resend verification email to a pending user.

**Request Body**:
```json
{
  "email": "jane.doe@example.com"
}
```

**Response** (201 Created):
```json
{
  "status": "success",
  "message": "Verification email sent successfully.",
  "data": null
}
```

**Notes**:
- Always returns success (prevents email enumeration)
- Only sends email if user exists and status is `pending`
- Rate limit aggressively

---

#### Forgot Password

**`POST /auth/forget-password`**

Request password reset link.

**Request Body**:
```json
{
  "email": "jane.doe@example.com"
}
```

**Response** (201 Created):
```json
{
  "status": "success",
  "message": "Reset password email sent successfully.",
  "data": null
}
```

**Notes**:
- Always returns success (prevents email enumeration)
- Email contains reset link: `{APP_BASE_URL}/auth/reset-password?token={jwt}`
- Token expires in 1h (configurable via `JWT_RESET_EXPIRES_IN`)

---

#### Reset Password

**`POST /auth/reset-password`**

Reset password using token from email.

**Request Body**:
```json
{
  "token": "reset-jwt-token",
  "new_password": "NewStrongP@ssw0rd456"
}
```

**Response** (201 Created):
```json
{
  "status": "success",
  "message": "Password changed successfully.",
  "data": null
}
```

**Notes**:
- Token must be valid and unexpired
- Returns generic error for invalid tokens
- Rate limit this endpoint

---

#### Get Current User

**`GET /auth/me`**

Get authenticated user profile.

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "User retrieved successfully.",
  "data": {
    "user": {
      "id": "uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane.doe@example.com",
      "status": "active"
    }
  }
}
```

---

### Items Endpoints

#### Create Item Listing

**`POST /items`**

Create a new item listing. Auto-geocodes address and validates service zone.

**Auth**: Required (Bearer token)

**Request Body**:
```json
{
  "title": "Vintage Wooden Dining Table",
  "description": "Solid oak dining table, seats 6-8 people.",
  "condition": "good",
  "category": "furniture",
  "address_line": "10 Downing Street, London",
  "postcode": "SW1A 2AA",
  "images": [
    {
      "url": "https://example.com/table.jpg",
      "altText": "Table front view"
    }
  ],
  "pickup_option": "donate",  // exchange, donate, or recycle
  "dropoff_location_id": "shop-uuid",  // Required for donate
  "delivery_preferences": "home_pickup",
  "metadata": {
    "weight_kg": 50,
    "dimensions_cm": "180x90x75",
    "material": "oak wood"
  }
}
```

**Response** (201 Created):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "item-uuid",
    "title": "Vintage Wooden Dining Table",
    "status": "pending_dropoff",  // Depends on pickup_option
    "pickup_option": "donate",
    "location": {
      "address_line": "10 Downing Street, London",
      "postcode": "SW1A 2AA",
      "latitude": 51.5034,
      "longitude": -0.1276
    },
    "qr_code": "https://res.cloudinary.com/...item-uuid.png",
    "created_at": "2025-09-25T12:00:00.000Z"
  }
}
```

**Initial Status by Pickup Option**:
- `exchange` → `active`
- `donate` → `pending_dropoff`
- `recycle` → `pending_recycle`

**Notes**:
- Address is geocoded using OpenStreetMap
- Coordinates validated against active service zones
- QR code automatically generated and uploaded to Cloudinary
- Max 10 images per item
- CO2 estimation calculated if weight/dimensions provided and Climatiq configured

**Caveats**:
- Geocoding may timeout (5s default); use valid UK postcodes
- Rejections if location outside service zone
- `dropoff_location_id` required for `donate` items

---

#### List Items (Public Search)

**`GET /items`**

Search for items near a location.

**Auth**: None (public endpoint)

**Query Parameters**:
- `lat` (number, required*): Latitude
- `lng` (number, required*): Longitude
- `postcode` (string, required*): UK postcode (alternative to lat/lng)
- `radius` (number, optional): Search radius in km (default: 5, max: 50)
- `status` (string, optional): Filter by status (default: `active`)
- `category` (string, optional): Filter by category
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Results per page (default: 10, max: 50)

*Either `lat`+`lng` OR `postcode` required

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "search_origin": { "lat": 51.5072, "lng": -0.1276, "radius_km": 5 },
    "items": [
      {
        "id": "item-uuid",
        "title": "Vintage Wooden Dining Table",
        "status": "active",
        "distance_km": 1.2,
        "pickup_option": "donate",
        "qr_code": "https://...",
        "images": ["https://..."],
        "created_at": "2025-09-25T12:00:00Z"
      }
    ]
  }
}
```

**Notes**:
- Results sorted by distance (closest first)
- Distances rounded to 0.1 km
- Only returns items in public states (active, awaiting_collection, etc.)
- Donor identity hidden for privacy

---

#### Get Item Details

**`GET /items/:id`**

Get detailed information about a specific item.

**Auth**: None (public endpoint)

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "item-uuid",
    "title": "Vintage Wooden Dining Table",
    "description": "Solid oak dining table...",
    "status": "active",
    "location": {
      "postcode": "SW1A 2AA",
      "latitude": 51.5034,
      "longitude": -0.1276
    },
    "qr_code": "https://...",
    "scan_events": [
      {
        "scan_type": "DROP_OFF_IN",
        "shop_id": "shop-uuid",
        "scanned_at": "2025-09-26T09:00:00Z"
      }
    ],
    "images": [{ "url": "https://...", "alt_text": "..." }],
    "pickup_option": "exchange",
    "metadata": { "weight_kg": 50, ... },
    "created_at": "2025-09-25T12:00:00Z"
  }
}
```

**Notes**:
- Returns 404 if item not found or not in public state
- Includes recent scan events (max 25)
- Full address hidden, only postcode shown

---

#### Update Item

**`PATCH /items/:id`**

Update item details (owner only).

**Auth**: Required (must be item owner)

**Request Body** (all fields optional):
```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "condition": "fair",
  "category": "furniture",
  "address_line": "New address",
  "postcode": "EC1A 1BB",
  "delivery_preferences": "drop_off_only",
  "metadata": { "updated": "data" },
  "images": [{ "url": "https://...", "altText": "..." }],
  "dropoff_location_id": "shop-uuid"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "item-uuid",
    "title": "Updated Title",
    "condition": "fair",
    ...
  }
}
```

**Notes**:
- Only owner can update
- Updating address triggers re-geocoding and service zone validation
- Cannot update items that have progressed beyond certain states

---

#### Delete Item

**`DELETE /items/:id`**

Delete an item listing (owner only).

**Auth**: Required (must be item owner)

**Response**: 204 No Content

**Notes**:
- Only draft/active items can be deleted
- Protects items in processing/completed states

---

#### Collect Item (Non-QR)

**`POST /items/:id/collect`**

Mark item as collected without scanning QR code.

**Auth**: Required (donor, collector, or facility staff)

**Request Body**:
```json
{
  "shop_id": "shop-uuid"  // Required if item has dropoff_location_id
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "item_id": "item-uuid",
    "claim_id": "claim-uuid",
    "status": "complete",
    "completed_at": "2025-09-26T10:30:00.000Z"
  }
}
```

**Notes**:
- Completes the active claim
- Records `CLAIM_OUT` scan event
- Triggers rewards for both parties
- Sends completion notifications

---

### Claims Endpoints

#### Create Claim

**`POST /claims`**

Claim an available item for collection.

**Auth**: Required (collector or admin role)

**Request Body**:
```json
{
  "item_id": "item-uuid"
}
```

**Response** (201 Created):
```json
{
  "id": "claim-uuid",
  "item_id": "item-uuid",
  "collector_id": "user-uuid",
  "status": "pending_approval",
  "created_at": "2025-09-25T12:10:00Z"
}
```

**Notes**:
- Only `active` or `awaiting_collection` items can be claimed
- One active claim per item
- Cannot claim own items
- Sends notification to donor

**Caveats**:
- Returns 409 if item already claimed
- Returns 403 if user tries to claim own item

---

#### Approve Claim

**`PATCH /claims/:id/approve`**

Approve a pending claim (admin only).

**Auth**: Required (admin role)

**Response** (200 OK):
```json
{
  "id": "claim-uuid",
  "status": "approved",
  "approved_at": "2025-09-25T12:15:00Z"
}
```

**Notes**:
- Changes claim status to `approved`
- Changes item status to `claimed`
- Sends notification to collector

---

### QR Code Endpoints

All QR endpoints require authentication. Staff roles (`facility`, `partner`, `admin`) can perform scans.

#### View Item via QR

**`GET /qr/item/:itemId/view`**

View item status (read-only, records audit entry).

**Auth**: Required

**Response** (200 OK):
```json
{
  "id": "item-uuid",
  "status": "awaiting_collection",
  "pickup_option": "donate",
  "qr_code": "https://...",
  "claim": {
    "id": "claim-uuid",
    "status": "approved",
    "collector_id": "user-uuid"
  },
  "scan_events": [...]
}
```

---

#### Drop-Off Scan

**`POST /qr/item/:itemId/dropoff-in`**

Record item drop-off at shop (facility staff only).

**Auth**: Required (facility, admin role)

**Request Body**:
```json
{
  "shop_id": "shop-uuid",
  "action": "accept"  // or "reject"
  // If reject:
  // "reason": "Item too damaged"
}
```

**Response** (200 OK) - Accept:
```json
{
  "scan_result": "accepted",
  "scan_type": "DROP_OFF_IN",
  "item_status": "awaiting_collection",
  "scanned_at": "2025-09-26T09:00:00Z",
  "scan_events": [...]
}
```

**Response** (200 OK) - Reject:
```json
{
  "scan_result": "rejected",
  "scan_type": "DROP_OFF_IN",
  "item_status": "rejected",
  "rejection_reason": "Item too damaged",
  "scanned_at": "2025-09-26T09:05:00Z",
  "scan_events": [...]
}
```

**Notes**:
- `shop_id` must match item's `dropoff_location_id`
- Accept: `pending_dropoff` → `awaiting_collection`
- Reject: `pending_dropoff` → `rejected`

---

#### Claim Out Scan

**`POST /qr/item/:itemId/claim-out`**

Record collector picking up item (facility staff or collector).

**Auth**: Required (facility, admin, or assigned collector)

**Request Body**:
```json
{
  "shop_id": "shop-uuid"
}
```

**Response** (200 OK):
```json
{
  "scan_result": "completed",
  "scan_type": "CLAIM_OUT",
  "status": "complete",
  "completed_at": "2025-09-26T10:30:00Z",
  "scan_events": [...]
}
```

**Notes**:
- Completes claim
- Item status → `complete`
- Triggers rewards
- Sends notifications

---

#### Recycle In Scan

**`POST /qr/item/:itemId/recycle-in`**

Record item entering recycling facility.

**Auth**: Required (partner, facility, admin role)

**Request Body**:
```json
{
  "shop_id": "facility-uuid"
}
```

**Response** (200 OK):
```json
{
  "id": "item-uuid",
  "status": "pending_recycle_processing",
  "recycle_in_at": "2025-09-25T14:05:00Z",
  "shop_id": "facility-uuid",
  "scan_events": [...]
}
```

---

#### Recycle Out Scan

**`POST /qr/item/:itemId/recycle-out`**

Record recycling completion.

**Auth**: Required (partner, facility, admin role)

**Request Body**:
```json
{
  "shop_id": "facility-uuid"
}
```

**Response** (200 OK):
```json
{
  "id": "item-uuid",
  "status": "recycled",
  "recycle_out_at": "2025-09-25T16:45:00Z",
  "shop_id": "facility-uuid",
  "scan_events": [...]
}
```

---

### Shops Endpoints

#### Create Shop

**`POST /shops`**

Register a drop-off location (partner or admin only).

**Auth**: Required (partner, admin role)

**Request Body**:
```json
{
  "name": "TruCycle Hub Camden",
  "phone_number": "+442012345678",
  "address_line": "123 High Street, Camden",
  "postcode": "NW1 8AB",
  "latitude": 51.5390,
  "longitude": -0.1426,
  "opening_hours": "Mon-Fri 9am-5pm",
  "acceptable_categories": ["furniture", "electronics"],
  "operational_notes": "Ring bell for access"
}
```

**Response** (201 Created):
```json
{
  "id": "shop-uuid",
  "name": "TruCycle Hub Camden",
  "phone_number": "+442012345678",
  "address_line": "123 High Street, Camden",
  "postcode": "NW1 8AB",
  "latitude": 51.5390,
  "longitude": -0.1426,
  "opening_hours": "Mon-Fri 9am-5pm",
  "acceptable_categories": ["furniture", "electronics"],
  "operational_notes": "Ring bell for access",
  "active": true
}
```

---

#### List My Shops

**`GET /shops/me`**

Get shops owned by authenticated user.

**Auth**: Required (partner, admin role)

**Response** (200 OK):
```json
[
  {
    "id": "shop-uuid",
    "name": "TruCycle Hub Camden",
    ...
  }
]
```

---

#### Get Shop Details

**`GET /shops/:id`**

Get public details of a shop.

**Auth**: None (public endpoint)

**Response** (200 OK):
```json
{
  "id": "shop-uuid",
  "name": "TruCycle Hub Camden",
  "address_line": "123 High Street, Camden",
  "postcode": "NW1 8AB",
  "latitude": 51.5390,
  "longitude": -0.1426,
  "opening_hours": "Mon-Fri 9am-5pm",
  "acceptable_categories": ["furniture", "electronics"],
  "operational_notes": "Ring bell for access"
}
```

---

#### Find Nearby Shops

**`GET /shops/nearby`**

Search for shops near a location.

**Auth**: None (public endpoint)

**Query Parameters**:
- `lon` (number, required): Longitude
- `lat` (number, required): Latitude
- `radius_m` (number, optional): Radius in meters (default: 5000, max: 50000)

**Response** (200 OK):
```json
[
  {
    "id": "shop-uuid",
    "name": "TruCycle Hub Camden",
    "phone_number": "+442012345678",
    "address_line": "123 High Street, Camden",
    "postcode": "NW1 8AB",
    "latitude": 51.5390,
    "longitude": -0.1426,
    "operational_notes": "Ring bell for access",
    "opening_hours": "Mon-Fri 9am-5pm",
    "acceptable_categories": ["furniture", "electronics"],
    "distanceMeters": 450
  }
]
```

---

#### Update Shop

**`PATCH /shops/:id`**

Update shop details (owner or admin only).

**Auth**: Required (owner or admin)

**Request Body** (all fields optional):
```json
{
  "name": "Updated Name",
  "phone_number": "+442087654321",
  "address_line": "New Address",
  "postcode": "NW1 9ZZ",
  "latitude": 51.5400,
  "longitude": -0.1430,
  "opening_hours": "Mon-Sat 9am-6pm",
  "acceptable_categories": ["all"],
  "operational_notes": "Updated notes",
  "active": true
}
```

---

#### Delete Shop (Soft Archive)

**`DELETE /shops/:id`**

Soft-delete a shop (sets active=false).

**Auth**: Required (owner or admin)

**Response**: 204 No Content

---

### Messaging & Chat Endpoints

#### Create or Get Room

**`POST /messages/rooms`**

Ensure a chat room exists between two users.

**Auth**: Required

**Request Body**:
```json
{
  "otherUserId": "other-user-uuid"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "room-uuid",
    "participants": [
      {
        "id": "user-1-uuid",
        "firstName": "Ada",
        "lastName": "Lovelace",
        "profileImageUrl": null,
        "online": true
      },
      {
        "id": "user-2-uuid",
        "firstName": "Grace",
        "lastName": "Hopper",
        "profileImageUrl": null,
        "online": false
      }
    ],
    "lastMessage": {...},
    "createdAt": "2024-05-30T09:12:00.000Z",
    "updatedAt": "2024-06-01T13:45:00.000Z"
  }
}
```

---

#### List Active Rooms

**`GET /messages/rooms/active`**

Get all chat rooms for authenticated user.

**Auth**: Required

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": [
    {
      "id": "room-uuid",
      "participants": [...],
      "lastMessage": {...},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

#### Get Room Messages

**`GET /messages/rooms/:roomId/messages`**

Get paginated messages from a room.

**Auth**: Required

**Query Parameters**:
- `limit` (number, optional): Messages per page (default: 20)
- `cursor` (string, optional): Last message ID from previous page

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "messages": [
      {
        "id": "msg-uuid",
        "roomId": "room-uuid",
        "direction": "incoming",  // or "outgoing"
        "category": "direct",
        "imageUrl": null,
        "caption": null,
        "text": "Hello!",
        "createdAt": "2024-06-01T13:45:00.000Z",
        "sender": {...}
      }
    ],
    "nextCursor": "msg-uuid-or-null"
  }
}
```

---

#### Search Room Messages

**`GET /messages/rooms/:roomId/search`**

Search messages in a room.

**Auth**: Required

**Query Parameters**:
- `query` (string, required): Search term (min 3 characters)

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "messages": [...]
  }
}
```

---

#### Send Image Message

**`POST /messages/rooms/:roomId/messages/image`**

Upload and send an image message.

**Auth**: Required

**Request**: `multipart/form-data`
- `image` (file, required): Image file
- `caption` (string, optional): Image caption

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "msg-uuid",
    "roomId": "room-uuid",
    "direction": "outgoing",
    "category": "direct",
    "imageUrl": "https://res.cloudinary.com/.../image.jpg",
    "caption": "Proof of collection",
    "text": null,
    "createdAt": "2024-06-01T14:05:00.000Z",
    "sender": {...}
  }
}
```

**Notes**:
- Images automatically uploaded to Cloudinary
- Only image files accepted
- Rejects non-image uploads

---

#### Send General Message

**`POST /messages/rooms/:roomId/messages/general`**

Send a system/general message (like announcements).

**Auth**: Required

**Request Body**:
```json
{
  "title": "Pickup reminder",
  "text": "Our driver will arrive tomorrow between 9am and 11am."
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "msg-uuid",
    "roomId": "room-uuid",
    "direction": "general",
    "category": "general",
    "imageUrl": null,
    "caption": "Pickup reminder",
    "text": "Our driver will arrive tomorrow...",
    "createdAt": "2024-06-01T14:00:00.000Z",
    "sender": {...}
  }
}
```

---

#### Clear Room Messages

**`DELETE /messages/rooms/:roomId/messages`**

Delete all messages in a room.

**Auth**: Required

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": { "success": true }
}
```

**Notes**:
- Emits `room:cleared` WebSocket event to both participants

---

#### Delete Room

**`DELETE /messages/rooms/:roomId`**

Delete a room and all its messages.

**Auth**: Required

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": { "success": true }
}
```

**Notes**:
- Emits `room:deleted` WebSocket event to both participants

---

### WebSocket API (Socket.IO)

**Namespace**: `/messages`  
**URL**: `http://localhost:3000/messages`

**Authentication**: Provide JWT token via:
- `auth: { token: '<jwt>' }` (recommended)
- Query string: `?token=<jwt>`
- Header: `Authorization: Bearer <jwt>`

**Connection Example** (JavaScript):
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/messages', {
  auth: { token: '<your-jwt-token>' },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('Connected:', socket.id));
socket.on('connect_error', (err) => console.error('Error:', err.message));
```

#### Client → Server Events

**`room:join`**

Join a room with another user.

**Emit**:
```javascript
socket.emit('room:join', { otherUserId: 'user-uuid' });
```

**Response**: `room:joined` event with ActiveRoomViewModel

---

**`message:send`**

Send a text message or images.

**Emit**:
```javascript
socket.emit('message:send', {
  roomId: 'room-uuid',
  text: 'Hello!',
  files: [
    {
      name: 'photo.jpg',
      type: 'image/jpeg',
      data: '<base64-encoded-image-data>'
    }
  ]
});
```

**Response**: `message:sent` event with created message

**Notes**:
- Text creates one message
- Each file creates separate image message
- Images auto-uploaded to Cloudinary
- Non-image files rejected

---

#### Server → Client Events

**`message:new`**

New message received.

**Payload**:
```json
{
  "id": "msg-uuid",
  "roomId": "room-uuid",
  "direction": "incoming",
  "category": "direct",
  "imageUrl": null,
  "caption": null,
  "text": "Hey, are we still on for tomorrow?",
  "createdAt": "2024-06-01T14:00:00.000Z",
  "sender": {...}
}
```

---

**`room:activity`**

Room updated (new message sent).

**Payload**:
```json
{
  "roomId": "room-uuid",
  "updatedAt": "2024-06-01T14:00:00.000Z"
}
```

---

**`presence:update`**

User online status changed.

**Payload**:
```json
{
  "userId": "user-uuid",
  "online": true
}
```

**Notes**:
- Emitted when user connects (online: true)
- Emitted when user's last socket disconnects (online: false)
- Presence is in-memory only (reset on server restart)

---

**`room:cleared`**

All messages in room deleted.

**Payload**:
```json
{
  "roomId": "room-uuid"
}
```

---

**`room:deleted`**

Room deleted.

**Payload**:
```json
{
  "roomId": "room-uuid"
}
```

---

### Notifications Endpoints

#### List Notifications

**`GET /notifications`**

Get notifications for authenticated user.

**Auth**: Required

**Query Parameters**:
- `unread` (boolean, optional): Filter unread only
- `limit` (number, optional): Results per page (default: 50, max: 100)

**Response** (200 OK):
```json
[
  {
    "id": "notif-uuid",
    "userId": "user-uuid",
    "type": "item.claim.request",
    "title": "New claim request",
    "body": "Your item \"Bike\" has a new claim request.",
    "data": { "itemId": "item-uuid" },
    "read": false,
    "readAt": null,
    "createdAt": "2025-10-07T12:34:56.000Z"
  }
]
```

---

#### Get Unread Count

**`GET /notifications/unread-count`**

Get count of unread notifications.

**Auth**: Required

**Response** (200 OK):
```json
{
  "count": 3
}
```

---

#### Send Notification (Admin/Testing)

**`POST /notifications/send`**

Manually send a notification.

**Auth**: Required

**Request Body**:
```json
{
  "userId": "user-uuid",
  "template": "WELCOME",
  "params": { "name": "Jane" }
}
```

**Response** (200 OK):
Returns created notification

---

### Rewards Endpoints

#### Get Wallet

**`GET /rewards/wallet`**

Get or create wallet for authenticated user.

**Auth**: Required

**Response** (200 OK):
```json
{
  "id": "wallet-uuid",
  "currency": "PTS",
  "availableAmount": 150.00,
  "pendingAmount": 0.00,
  "status": "active",
  "createdAt": "2025-09-01T10:00:00.000Z"
}
```

---

#### Get Ledger Entries

**`GET /rewards/ledger`**

Get transaction history for authenticated user.

**Auth**: Required

**Query Parameters**:
- `limit` (number, optional): Results (default: 50, max: 100)

**Response** (200 OK):
```json
[
  {
    "id": "entry-uuid",
    "type": "credit",
    "amount": 10.00,
    "currency": "PTS",
    "balanceAfter": 150.00,
    "purpose": "claim_complete_collector",
    "ref": "claim-uuid",
    "createdAt": "2025-09-25T12:30:00.000Z"
  }
]
```

---

### Reviews Endpoints

#### Create Review

**`POST /reviews`**

Create a review for another user.

**Auth**: Required

**Request Body**:
```json
{
  "reviewee_id": "user-uuid",
  "rating": 5,
  "comment": "Great experience, very professional!"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "review-uuid",
    "created_at": "2024-06-01T12:00:00.000Z"
  }
}
```

---

#### List Reviews for User

**`GET /users/:id/reviews`**

Get reviews and aggregate rating for a user.

**Auth**: None (public endpoint)

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "rating": 4.8,
    "reviews_count": 12,
    "reviews": [
      {
        "id": "review-uuid",
        "rating": 5,
        "comment": "Nice",
        "reviewer": { "id": "user-uuid", "name": "Jane Doe" },
        "created_at": "2024-06-01T10:00:00.000Z"
      }
    ]
  }
}
```

---

### Users Endpoints

#### Update Profile

**`PATCH /users/me/profile`**

Update authenticated user's profile.

**Auth**: Required

**Request Body** (all fields optional, at least one required):
```json
{
  "first_name": "Ada",
  "last_name": "Lovelace",
  "phone": "+441234567890"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "id": "user-uuid",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "phone": "+441234567890"
  }
}
```

**Notes**:
- Omit fields to leave unchanged
- Send empty string to clear field (becomes null)
- Max lengths: first_name 100, last_name 100, phone 32

---

## Notifications & Email System

### Email Delivery (Resend)

The system uses **Resend** (https://resend.com) for transactional emails.

**Configuration**:
- `RESEND_API_KEY`: API key from Resend dashboard
- `MAIL_FROM`: Sender email address (must be verified domain)

**Emails Sent**:

1. **Account Verification** (on registration)
   - Template: Welcome message with verification link
   - Link format: `{APP_BASE_URL}/auth/verify?token={jwt}`
   - Token expires after configured time (default 24h)

2. **Password Reset** (on forgot password)
   - Template: Password reset instructions with link
   - Link format: `{APP_BASE_URL}/auth/reset-password?token={jwt}`
   - Token expires after 1h

3. **Nearby Item Alerts** (when items listed)
   - Sends to users within `NEARBY_ITEM_ALERT_RADIUS_KM`
   - Max `NEARBY_ITEM_ALERT_MAX_RECIPIENTS` per item
   - Contains item title, postcode, and link to view

**Caveats**:
- Resend free tier: 100 emails/day, 3,000/month
- Must verify domain in production
- Test emails only work with verified domains
- Rate limit password reset to prevent abuse
- Always returns success on forgot password (prevents enumeration)

---

### In-App Notifications

Notifications are stored in the database and delivered via WebSocket.

**Notification Types**:
- `item.claim.request`: New claim on item
- `item.claim.approved`: Claim approved
- `item.collection`: Item collected
- `dropin.created`: Drop-in recorded
- `dropoff.created`: Drop-off recorded
- `pickup.created`: Pickup scheduled
- `general`: Generic notification

**Delivery**:
1. **Database**: Persisted for historical record
2. **WebSocket**: Delivered in real-time if user online
3. **Email**: Some events may trigger emails (configurable)

**WebSocket Gateway** (`/notifications` namespace):
- Connects via Socket.IO with JWT authentication
- Emits `notification:new` when notification created
- Client maintains connection to receive updates

**Example** (JavaScript):
```javascript
const socket = io('http://localhost:3000/notifications', {
  auth: { token: '<jwt>' }
});

socket.on('notification:new', (notification) => {
  console.log('New notification:', notification);
  // Update UI, show toast, etc.
});
```

---

### Nearby Item Alerts

Automatically notifies users when items are listed near them.

**How It Works**:
1. When item created with `active` or `awaiting_collection` status
2. System queries users within `NEARBY_ITEM_ALERT_RADIUS_KM` of item location
3. Limits to `NEARBY_ITEM_ALERT_MAX_RECIPIENTS` users
4. Sends email to each user with item details

**Configuration**:
```bash
NEARBY_ITEM_ALERT_RADIUS_KM=20            # Search radius (km)
NEARBY_ITEM_ALERT_MAX_RECIPIENTS=200      # Max recipients per item
```

**Caveats**:
- Requires user locations to be stored (addresses or profiles)
- May trigger rate limits with high values
- Consider adding user preference to opt-in/out
- Uses Resend API (counts toward quota)

---

## Important Notes & Caveats

### Security Considerations

1. **Authentication**
   - Always use HTTPS in production
   - Keep JWT secrets secure and rotate periodically
   - Use short-lived access tokens (1h-24h)
   - Implement refresh token rotation
   - Rate limit login, registration, and password reset endpoints

2. **Authorization**
   - All protected endpoints verify JWT and user status
   - Role-based access control enforced at route level
   - Ownership checks prevent users from accessing others' resources
   - QR scan endpoints verify roles (facility, partner, admin)

3. **Input Validation**
   - All inputs validated with class-validator
   - SQL injection prevented via TypeORM parameterization
   - XSS prevented by escaping outputs
   - File uploads restricted to images only
   - Max file sizes enforced

4. **Secrets Management**
   - Never commit secrets to version control
   - Use environment variables for all sensitive data
   - Use `.env.example` as template
   - Consider using secret management service in production (AWS Secrets Manager, HashiCorp Vault)

---

### Service Zone Validation

All addresses and item locations must fall within active service zones.

**Current Service Zone**: London (seeded in migrations)

**How It Works**:
1. Address geocoded to coordinates (lat/lng)
2. Point-in-polygon check against service zone geometry
3. Rejects items/addresses outside service zone

**Extending Service Zones**:
- Add new zones via database: INSERT INTO `service_zone` table
- Geometry must be valid PostGIS polygon (SRID 4326)
- Mark zone as `active=true`

**Caveats**:
- Geocoding failures result in validation errors
- Use valid UK postcodes for best results
- OpenStreetMap may timeout (default 5s)
- Consider caching geocoding results

---

### Geocoding & PostGIS

**Geocoding Service**: OpenStreetMap Nominatim

**Configuration**:
```bash
OSM_SEARCH_URL=https://nominatim.openstreetmap.org/search
OSM_USER_AGENT=TruCycle/1.0
OSM_TIMEOUT_MS=5000
```

**PostGIS Requirements**:
- Extension must be installed in PostgreSQL cluster
- Migration creates extension if not exists
- All geometry uses SRID 4326 (WGS 84 GPS coordinates)
- Supports point-in-polygon, distance calculations, etc.

**Caveats**:
- OSM Nominatim has usage limits
- For high volume, self-host Nominatim
- Set meaningful user agent (OSM policy requirement)
- Geocoding may fail for invalid/ambiguous addresses
- Always validate coordinates fall within service zones

---

### Rate Limiting

**Recommended Rate Limits**:
- `POST /auth/login`: 5 req/min per IP
- `POST /auth/register`: 3 req/min per IP
- `POST /auth/forget-password`: 3 req/hr per email
- `POST /auth/resend-verification`: 3 req/hr per email
- `POST /items`: 10 req/min per user
- `POST /messages/rooms/:id/messages/image`: 10 req/min per user

**Implementation**:
- Not currently implemented in codebase
- Recommend using nginx rate limiting or API gateway
- Or add `@nestjs/throttler` package

---

### Idempotency

**Current Idempotency**:
- Rewards: Duplicate credits prevented via unique constraint on (wallet_id, purpose, ref)
- Messages: No built-in idempotency (consider adding Idempotency-Key header)

**Future Enhancements**:
- Add `Idempotency-Key` header support for mutating operations
- Store key + response for 24h
- Return cached response if key seen again

---

### Testing & Debugging

**Available Scripts**:
```bash
npm run test           # Run tests
npm run test:watch     # Watch mode
npm run test:cov       # With coverage
npm run lint           # ESLint
npm run format         # Prettier
npm run typecheck      # TypeScript checks
npm run start:dev      # Dev server with hot reload
```

**Swagger UI**:
- URL: http://localhost:3000/docs
- Interactive API documentation
- Test endpoints directly from browser
- Includes authentication (lock icon)

**Messaging Test Page**:
- URL: http://localhost:3000/public/test/messages
- Lightweight UI for testing chat
- Stores JWT in localStorage
- Useful for manual testing

**Database Access**:
```bash
# Docker
docker exec -it <container-name> psql -U postgres -d trucycle

# Local
psql -U postgres -d trucycle
```

**Common Debugging**:
```bash
# Check migrations status
npm run migration:run

# View database logs (Docker)
docker logs <postgres-container>

# Enable SQL logging
# Set DB_LOGGING=true in .env

# Check PostGIS extension
psql -d trucycle -c "SELECT PostGIS_version();"
```

---

## Handover Information

### Third-Party Service Dependencies

| Service | Purpose | Cost | Setup Link |
|---------|---------|------|------------|
| **Resend** | Email delivery | Free: 3K/mo | https://resend.com |
| **Cloudinary** | Image storage | Free: 25GB | https://cloudinary.com |
| **Climatiq** | CO2 estimation | Free: 1K calls/mo | https://climatiq.io |
| **OpenStreetMap** | Geocoding | Free (usage limits) | https://nominatim.openstreetmap.org |

**Optional Services**:
- Supabase/Neon for managed PostgreSQL
- Sentry for error tracking
- LogRocket for session replay
- DataDog/New Relic for monitoring

---

### Database Backup & Migrations

**Backup Strategy**:
```bash
# Full backup
pg_dump -U postgres -d trucycle > backup_$(date +%Y%m%d).sql

# Backup with Docker
docker exec <container> pg_dump -U postgres trucycle > backup.sql

# Restore
psql -U postgres -d trucycle < backup.sql
```

**Migration Management**:
- Migrations in `src/database/migrations/`
- Run migrations: `npm run migration:run`
- Create new migration: Add file with timestamp prefix
- Migrations run automatically on app start if `migrationsRun: true`

**Production Considerations**:
- Disable `TYPEORM_SYNC` in production (use migrations only)
- Test migrations on staging first
- Backup before running migrations
- Migrations run in transaction mode (`migrationsTransactionMode: 'each'`)

---

### Deployment Considerations

**Environment Variables**:
- Set all required variables (see Environment Variables section)
- Use secrets management service
- Never commit secrets

**Database**:
- Use managed PostgreSQL in production (AWS RDS, Supabase, Neon)
- Enable SSL (`DB_SSL=true`)
- Regular backups (daily recommended)
- PostGIS extension required

**Node.js**:
- Node 18+ required
- Build: `npm run build`
- Start: `npm run start` (production mode)
- Set `NODE_ENV=production`

**Recommended Stack**:
- **App**: AWS ECS, Google Cloud Run, or Heroku
- **Database**: AWS RDS PostgreSQL, Supabase, or Neon
- **Redis**: For session storage (future enhancement)
- **CDN**: CloudFlare for static assets
- **Monitoring**: Sentry, DataDog, or New Relic

**Docker Deployment**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
CMD ["node", "dist/main.js"]
```

---

### Monitoring & Logging

**Current Logging**:
- NestJS built-in logger
- Logs to console (stdout/stderr)
- SQL queries if `DB_LOGGING=true`

**Recommended Enhancements**:
- Add Sentry for error tracking
- Add structured logging (Winston or Pino)
- Log to external service (CloudWatch, Papertrail)
- Monitor API response times
- Track database query performance

**Health Check Endpoint**:
- Not currently implemented
- Recommend adding `/health` endpoint
- Check database connection
- Check external service availability

---

### Known Limitations

1. **Presence Tracking**
   - In-memory only (lost on server restart)
   - Not suitable for multi-server deployments
   - Solution: Use Redis for shared presence

2. **No Refresh Token Rotation**
   - Refresh tokens not yet implemented
   - Only access tokens issued
   - Solution: Implement refresh token flow

3. **No Rate Limiting**
   - Not implemented at application level
   - Solution: Add nginx rate limiting or @nestjs/throttler

4. **No Idempotency-Key Support**
   - Only rewards have idempotency via constraints
   - Solution: Add middleware to track idempotency keys

5. **Single Service Zone**
   - Only London currently configured
   - Solution: Add more zones via database inserts

6. **Email Preferences**
   - No user opt-out for nearby alerts
   - Solution: Add preferences table and UI

7. **No Search by Item Title/Description**
   - Only geospatial search implemented
   - Solution: Add full-text search (PostgreSQL or Elasticsearch)

---

### Future Enhancements

1. **Admin Dashboard**
   - Approve claims
   - Manage users
   - View analytics
   - Monitor system health

2. **Mobile App Integration**
   - iOS/Android apps
   - Push notifications
   - QR code scanning from mobile camera

3. **Payment Integration**
   - Stripe/PayPal for paid services
   - Reward redemption
   - Shop verification fees

4. **Advanced Search**
   - Full-text search
   - Filters by multiple criteria
   - Saved searches
   - Alerts for new matches

5. **Analytics Dashboard**
   - CO2 impact metrics
   - User engagement
   - Item lifecycle tracking
   - Geographic heatmaps

6. **Multi-Language Support**
   - i18n for API responses
   - Localized emails
   - Currency localization

7. **Enhanced Rewards**
   - Leaderboards
   - Badges/achievements
   - Reward redemption marketplace
   - Partner reward programs

---

## Additional Resources

- **Swagger Documentation**: http://localhost:3000/docs (when running)
- **System Architecture**: `doc/system_design_architecture.md`
- **Messaging Websocket Details**: `doc/messaging_websocket.md`
- **Notification Websocket Details**: `doc/notification_websocket.md`
- **NestJS Docs**: https://docs.nestjs.com
- **TypeORM Docs**: https://typeorm.io
- **PostGIS Docs**: https://postgis.net/docs/
- **Socket.IO Docs**: https://socket.io/docs/

---

## Support & Contact

For questions or issues with this project:
1. Check existing documentation (README, architecture docs)
2. Review Swagger API documentation at http://localhost:3000/docs
3. Check application logs for error messages and stack traces

---

## License

See LICENSE file for details.

---

**Last Updated**: December 8, 2025  
**Version**: 0.1.0  
**Maintainer**: TruCycle Development Team
