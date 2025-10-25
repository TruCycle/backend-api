# Notifications WebSocket Integration

This document explains how a frontend can integrate realtime in-app notifications using Socket.IO, plus the complementary HTTP endpoints for listing notifications, unread-count badges, and filtering unread items.

- Namespace: `/notifications` (Socket.IO 4.x)
- Delivery: Server emits `notification:new` to all active sockets for a user
- Persistence: Every notification is stored in the `notification` table, with `read` and `readAt` fields

## Authentication

All connections require a valid JWT access token. You can provide the token in any of these ways during the handshake:

1) Socket auth payload (preferred)

```ts
const socket = io(API_BASE_URL + '/notifications', {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

2) Query string token

```ts
const socket = io(API_BASE_URL + '/notifications?token=' + encodeURIComponent(accessToken), { transports: ['websocket'] });
```

3) Authorization header (if your client library supports it)

```ts
const socket = io(API_BASE_URL + '/notifications', {
  extraHeaders: { Authorization: `Bearer ${accessToken}` },
  transports: ['websocket'],
});
```

## Notification Model

TypeScript view returned over WS and HTTP:

```ts
export interface NotificationViewModel {
  id: string;
  type: string;           // e.g. 'item.claim.request'
  title: string;          // short title for UI
  body: string | null;    // optional body text
  data: any | null;       // extra routing payload (e.g., itemId)
  read: boolean;          // read status
  readAt: string | null;  // ISO timestamp
  createdAt: string;      // ISO timestamp
}
```

Common `type` values implemented:
- `item.claim.request`
- `item.claim.approved`
- `item.collection`
- `dropin.created`
- `dropoff.created`
- `pickup.created`
- `general`

## Server -> Client Events

- `notification:new` — delivered whenever a notification is created for the user.

```ts
socket.on('notification:new', (n: NotificationViewModel) => {
  // update badge counts, list views, and optionally toast
});
```

## Client -> Server Events

- `notification:read` — marks one or more notifications as read.

Payloads:

```ts
// Single
socket.emit('notification:read', { id: '<uuid>' });

// Multiple
socket.emit('notification:read', { ids: ['<uuid1>','<uuid2>'] });

// Ack
socket.once('notification:read:ack', ({ count }) => {
  console.log('Marked read:', count);
});
```

## HTTP Endpoints

- `GET /notifications` — lists recent notifications for the current user (newest first).
  - Query params:
    - `unread=true|false` (optional) — filter by unread only when `true`.
    - `limit=1..100` (optional, default 50)

Example:

```http
GET /notifications?unread=true&limit=50
Authorization: Bearer <JWT>
```

Response:

```json
[
  {
    "id": "...",
    "type": "item.claim.request",
    "title": "New claim request",
    "body": "Your item \"Bike\" has a new claim request.",
    "data": { "itemId": "..." },
    "read": false,
    "readAt": null,
    "createdAt": "2025-10-07T12:34:56.000Z"
  }
]
```

- `GET /notifications/unread-count` — returns the unread badge count for the current user.

Example:

```http
GET /notifications/unread-count
Authorization: Bearer <JWT>
```

Response:

```json
{ "count": 3 }
```

## Client Setup (Example)

```ts
import { io, Socket } from 'socket.io-client';

export type NotificationViewModel = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

const socket: Socket = io(API_BASE_URL + '/notifications', {
  auth: { token: accessToken },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('Notifications connected', socket.id));
socket.on('notification:new', (n: NotificationViewModel) => {
  // push into local store/UI
});

function markRead(ids: string[]) {
  socket.emit('notification:read', { ids });
}
```

## Flow Summary

1. Client connects to `/notifications` with JWT.
2. When server-side events occur, backend creates a notification, persists it, and emits `notification:new`.
3. Client updates UI state and may immediately call `notification:read` to mark items as read.
4. On app start or reconnect, client should call `GET /notifications?unread=true` to load any missed notifications and `GET /notifications/unread-count` to initialize badge count.

Tip: Maintain a local unread count; decrement when you mark messages read via `notification:read`, and periodically reconcile with `GET /notifications/unread-count`.

## Notes

- Delivery is best-effort realtime via WebSocket; persistence means notifications are not lost when offline.
- The same JWT as the REST API is used for the WS handshake.
- CORS origins follow the server's global CORS env configuration.

## Domain Triggers (Server)

The backend emits and stores notifications for these events:
- `item.claim.request`: when a collector creates a claim request (donor and collector are notified).
- `item.claim.approved`: when a donor/admin approves a claim (collector is notified).
- `item.collection`: when a claim is completed/collection recorded (donor and collector are notified).
- `dropoff.created`: when a drop-off is recorded as part of completion (donor is notified).
- `dropin.created`: when an item is created with a donation drop-off location (shop owner and donor are notified), or when a completion happens at a shop (shop owner notified).
- `pickup.created`: reserved for future pickup orders.
