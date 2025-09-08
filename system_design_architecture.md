# TruCycle - System Design & Architecture (v1.0)

### Key for Backend API Engineers

This document outlines the system design and architecture of **TruCycle**, focusing on aspects critical for backend API engineers.

---

## 0) Stack Concretization

* **API/App**: NestJS (REST + Webhooks), `@nestjs/typeorm`
* **ORM**: TypeORM (DataSource, Migrations, Repositories)
* **DB**: PostgreSQL with PostGIS (`CREATE EXTENSION postgis;`)
* **Geo types**: `geometry(Point, 4326)`, `geometry(Polygon, 4326)` (store WGS84)
* **Cache/Queue**: Redis (BullMQ for jobs)
* **Objects**: S3/MinIO
* **Observability**: OpenTelemetry SDK + exporters, structured logs (`pino` / `winston`)

---

## 1) Geo & DB Conventions (Critical)

* **SRID**: Store everything in `EPSG:4326`.

  * For distance/area computations → cast temporarily to projected SRID (e.g., 3857/3395).
  * For most matching, `4326` with `ST_DWithin` is acceptable.

**Columns**

* `address.geom`: `geometry(Point, 4326)`
* `service_zone.geom`: `geometry(Polygon, 4326)`
* `facility.geom`: `geometry(Point, 4326)`
* `pickup_order.geom`: `geometry(Point, 4326)` (immutable copy of address at creation)

**Indexes**

```sql
CREATE INDEX service_zone_geom_gist ON service_zone USING GIST (geom);
CREATE INDEX address_geom_gist ON address USING GIST (geom);
CREATE INDEX facility_geom_gist ON facility USING GIST (geom);
```

* Optional: `collector_profile` live location (`geometry(Point,4326)` + GIST)

---

## 2) TypeORM Entity Shape (Decisions Only)

* Use **TypeORM enum** for statuses.
* `numeric(12,2)` for currency.
* `jsonb` for `rule_eval/params`.
* `timestamptz` for times.

### Key Entities for API Interaction

**user**

* `id uuid PK`, `email text unique`, `phone text index`, `password_hash text?`,
* `status enum('active','suspended','deleted')`, `created_at timestamptz`

**role**

* `id uuid PK`, `code enum('customer','collector','facility','admin','finance','partner')`

**address**

* `id uuid PK`, `user_id FK`, `label text`, `line1.. text`, `city/state/country text`,
* `geom geometry(Point,4326)`, `is_default boolean`

**service\_zone**

* `id uuid PK`, `name text`, `geom geometry(Polygon,4326)`, `active boolean`,
* `min_order_value numeric(12,2)`, `notes text`

**collector\_profile**

* `id uuid PK`, `user_id FK`, `vehicle_type text`, `capacity_kg numeric(10,2)`,
* `availability jsonb`, `current_zone_id uuid FK`, `rating_avg numeric(3,2)`,
* `is_online boolean`, `geom geometry(Point,4326)` (optional live location)

**material\_type**

* `id uuid PK`, `code text unique`, `name text`,
* `unit enum('kg','pcs')`, `base_rate numeric(12,4)`,
* `quality_grades jsonb`, `is_hazardous boolean`

**pickup\_order**

* `id uuid PK`, `customer_id uuid FK`, `origin_address_id uuid FK`,
* `status enum(...)`, `scheduled_at timestamptz`, `placed_at timestamptz`,
* `zone_id uuid FK`, `channel text`, `notes text`,
* `geom geometry(Point,4326)`, `cancel_reason text?`,
* `version int (optimistic lock)`

Composite index: `(status, zone_id, scheduled_at)`

**assignment**

* `id uuid PK`, `order_id uuid FK unique WHERE state in ('assigned','accepted')`,
* `collector_id uuid FK`, `assigned_at`, `accepted_at?`, `declined_at?`,
* `eta_minutes int`, `route_polyline text?`,
* `state enum('assigned','accepted','declined','expired')`

Index: `(collector_id, state)`

**collection\_event**

* `id uuid PK`, `order_id uuid FK`, `collector_id uuid FK`,
* `type enum('arrived','validated','loaded')`, `photos text[]`,
* `latlon geometry(Point,4326)`, `occurred_at`

**weigh\_in**

* `id uuid PK`, `order_id uuid FK`, `device_id text?`,
* `raw_total_kg numeric(12,3)`, `per_item jsonb`,
* `tamper_hash text`, `occurred_at`

**pricing\_snapshot**

* `id uuid PK`, `order_id uuid FK`, `rule_eval jsonb`,
* `subtotal numeric(12,2)`, `surcharges numeric(12,2)`, `discounts numeric(12,2)`,
* `total numeric(12,2)`, `currency char(3)`, `created_at`

**wallet**

* `id uuid PK`, `owner_user_id uuid FK`, `currency char(3)`,
* `available_amount numeric(14,2)`, `pending_amount numeric(14,2)`,
* `status enum('active','frozen')`

**ledger\_entry**

* `id uuid PK`, `wallet_id uuid FK`, `order_id uuid? FK`,
* `type enum('debit','credit')`, `amount numeric(14,2)`,
* `currency char(3)`, `balance_after numeric(14,2)`,
* `purpose enum(...)`, `ref text`, `created_at`

Index: `(wallet_id, created_at)`

**notification**

* `id uuid PK`, `user_id uuid FK`, `channel enum('push','sms','email','whatsapp')`,
* `template text`, `params jsonb`, `sent_at`,
* `status enum('queued','sent','failed')`

**outbox\_event (transactional outbox)**

* `id bigserial PK`, `aggregate text`, `aggregate_id uuid`, `event_name text`,
* `payload jsonb`, `created_at`, `published_at?`, `retry_count int default 0`

**idempotency\_key**

* `key text PK`, `request_hash text`, `response jsonb`, `created_at`

---

## 3) Geo Query Patterns (TypeORM QueryBuilder)

Backend engineers interact with these via **GeoService**.

* **Zone containment**

  ```sql
  WHERE ST_Contains(zone.geom, :orderPoint)
  ```

  `:orderPoint` → `ST_SetSRID(ST_MakePoint(lon, lat), 4326)`

* **Nearest collectors (online, capacity)**

  ```sql
  WHERE collector.is_online = true 
    AND collector.capacity_kg >= :kg
  ORDER BY ST_Distance(collector.geom, :orderPoint)
  ```

  Add:

  ```sql
  ST_DWithin(collector.geom, :orderPoint, :radiusDeg)
  ```

* **Distance surcharge**

  ```sql
  SELECT ST_Distance(
    ST_Transform(origin.geom, 3857), 
    ST_Transform(facility.geom, 3857)
  ) AS meters
  ```

---

## 4) State Machines with TypeORM (Safe Transitions)

* Model aggregates (Order, Assignment, Payout) with:

  * `version` (optimistic lock) on `pickup_order`.

**Transition process**

1. Begin transaction (`QueryRunner`).
2. `SELECT … FOR UPDATE` row by ID to lock.
3. Validate allowed transition (`currentStatus → nextStatus`).
4. Persist new status + write `outbox_event`.
5. Commit.

**Idempotency**

* Require `Idempotency-Key` header for mutating endpoints.
* Upsert into `idempotency_key` and return cached response on repeats.

---

## 5) Critical Flows (NestJS Module Responsibilities)

**A) Onboarding & KYC (IdentityModule)**

* OTP flow via `NotificationPort`.
* KYC upload → stores doc URLs in S3.