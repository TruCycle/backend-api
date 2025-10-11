# Messaging WebSocket Integration

This document explains how a frontend can integrate the realtime messaging features of this API using Socket.IO, plus the complementary HTTP endpoints for room and history management.

The messaging realtime namespace is `/messages` and uses Socket.IO 4.x.


## Authentication

All messaging connections require a valid JWT access token. You can provide the token to the WebSocket handshake in any of these ways:

- Handshake auth (recommended): `{ auth: { token: '<JWT>' } }`
- Query string: `...?token=<JWT>`
- HTTP header: `Authorization: Bearer <JWT>`

If the token is missing or invalid, the server rejects the connection.


## Connecting

Example with `socket.io-client` in a browser or SPA:

```ts
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = '<https://api.example.com>'; // same origin is also fine
const token = '<JWT_ACCESS_TOKEN>';

const socket: Socket = io(API_BASE_URL + '/messages', {
  auth: { token },
  transports: ['websocket'], // avoid long-polling
});

socket.on('connect', () => {
  console.log('Connected', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('WS error', err?.message || err);
});
```

Notes:
- CORS is controlled by `CORS_ORIGINS`. When unset or `*`, any origin is allowed.
- Cookies are not used for auth here (`credentials: false`), send the JWT as above.


## Data Models

Message view returned over WS and HTTP:

```ts
export type MessageDirection = 'incoming' | 'outgoing' | 'general';

export interface MessageViewModel {
  id: string;
  roomId: string;
  direction: MessageDirection; // computed per viewer
  category: 'direct' | 'general';
  imageUrl: string | null;      // present for image messages
  caption: string | null;       // optional caption/title
  text: string | null;          // present for direct/general text
  createdAt: string | Date;
  sender: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  } | null;                     // null for system messages
}
```

Room summary used across endpoints:

```ts
export interface ActiveRoomViewModel {
  id: string;
  participants: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    online: boolean; // realtime presence
  }>;
  lastMessage: MessageViewModel | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
```


## Client → Server Events

- `room:join`
  - Payload: `{ otherUserId: string }`
  - Effect: Ensures a direct room exists with the other user and joins the socket to that room.
  - Server response event: `room:joined` with `ActiveRoomViewModel`.

  Example:
  ```ts
  socket.once('room:joined', (room: ActiveRoomViewModel) => {
    console.log('Room ready', room.id);
  });
  socket.emit('room:join', { otherUserId: '<other-user-uuid>' });
  ```

- `message:send`
  - Payload:
    ```ts
    interface SendMessageFilePayload {
      name: string; // original file name
      type: string; // mime type, must start with 'image/'
      data: string; // base64-encoded content (no data: prefix)
    }
    interface SendMessagePayload {
      roomId: string;
      text?: string;  // direct text OR caption when files are present
      files?: SendMessageFilePayload[]; // only images are accepted
    }
    ```
  - Behavior:
    - If `files` is provided: each image is saved as its own message. When `text` is also present, it is used as the caption for the first image.
    - If only `text` is provided: a direct text message is created.
  - Server response event: `message:sent` with either the created message (primary) or `{ success: true }` when only attachments are sent (your UI should rely on subsequent `message:new` events).

  Example (send text + optional images):
  ```ts
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function sendMessage(roomId: string, text?: string, attachments: File[] = []) {
    const files = await Promise.all(
      attachments.map(async (f) => ({ name: f.name, type: f.type || 'application/octet-stream', data: await fileToBase64(f) }))
    );

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for ack'));
      }, 4000);

      function onSent() { cleanup(); resolve(); }
      function cleanup() { clearTimeout(timeout); socket.off('message:sent', onSent); }

      socket.once('message:sent', onSent);
      socket.emit('message:send', { roomId, text, files });
    });
  }
  ```

Constraints:
- Attachments must be images (`type` begins with `image/`).
- For large images, prefer the HTTP upload endpoint (below) to avoid huge base64 payloads over WS.


## Server → Client Events

- `message:new` — A new message in a room you participate in.
  - Payload: `MessageViewModel` (direction is computed per recipient)
- `room:activity` — Room activity timestamp changed.
  - Payload: `{ roomId: string, updatedAt: string }`
- `room:cleared` — Room history cleared.
  - Payload: `{ roomId: string }`
- `room:deleted` — Room deleted.
  - Payload: `{ roomId: string }`
- `presence:update` — A participant’s presence changed.
  - Payload: `{ userId: string, online: boolean }`
- `room:joined` — Response to `room:join`.
- `message:sent` — Ack for `message:send`.

Tip: Update room previews and ordering when you receive `message:new` or `room:activity`.


## Complementary HTTP Endpoints

All endpoints below require `Authorization: Bearer <JWT>`.

- POST `/messages/rooms` — Ensure direct room exists
  - Body: `{ otherUserId: string }`
  - Returns: `ActiveRoomViewModel`
- GET `/messages/rooms/active` — List user’s active rooms
  - Returns: `ActiveRoomViewModel[]`
- GET `/messages/rooms/:roomId/messages?limit=50&cursor=<messageId>` — Paginated history
  - Returns: `{ messages: MessageViewModel[], nextCursor: string | null }`
- GET `/messages/rooms/:roomId/search?query=term` — Full‑text search in room
  - Returns: `MessageViewModel[]`
- POST `/messages/rooms/:roomId/messages/general` — Send a general/system message
  - Body: `{ title?: string, text: string }`
  - Returns: `MessageViewModel`
- POST `/messages/rooms/:roomId/messages/image` — Upload an image message
  - Multipart form: field `image` (binary), optional `caption`
  - Returns: `MessageViewModel`
- DELETE `/messages/rooms/:roomId/messages` — Clear room history
  - Returns: `{ success: true }` and emits `room:cleared`
- DELETE `/messages/rooms/:roomId` — Delete room and its messages
  - Returns: `{ success: true }` and emits `room:deleted`


## Typical Client Flow

1. Authenticate and obtain a JWT.
2. Connect a Socket.IO client to `/<namespace>`: `io(API_BASE_URL + '/messages', { auth: { token } })`.
3. Open or create a room via WS (`room:join`) or HTTP (`POST /messages/rooms`).
4. Load message history via HTTP (`GET /messages/rooms/:id/messages`).
5. Send new messages:
   - Text or small image(s) via WS (`message:send`).
   - Large images via HTTP upload for better reliability.
6. Listen for realtime updates: `message:new`, `presence:update`, `room:activity`.


## Presence

- Presence is tracked per connected sockets; a user is considered online when they have ≥1 active connection.
- The server broadcasts `presence:update` on connect/disconnect events.


## Built‑in Tester (for quick validation)

- Open `GET /public/test/messages` in a browser while the API is running.
- Paste a valid JWT token, open a room, and exchange messages.
- The tester uses the same events and endpoints as described here.


## Troubleshooting

- Connection immediately closes: ensure the JWT is sent (auth token, query param, or `Authorization` header).
- No `message:new` after attachments: the ack may be `{ success: true }`; rely on subsequent `message:new` broadcasts.
- Mixed content errors when loading `imageUrl`: ensure your app is served over HTTPS; images are uploaded to Cloudinary using secure URLs when configured.
- CORS errors: configure `CORS_ORIGINS` to include your frontend origin.


## Example Minimal Integration (React‑like pseudo‑code)

```ts
const socket = io(API_BASE_URL + '/messages', { auth: { token }, transports: ['websocket'] });

useEffect(() => {
  function onNew(m: MessageViewModel) { setMessages((prev) => [...prev, m]); }
  function onPresence(p: { userId: string; online: boolean }) { updatePresence(p); }

  socket.on('message:new', onNew);
  socket.on('presence:update', onPresence);
  return () => { socket.off('message:new', onNew); socket.off('presence:update', onPresence); };
}, []);

async function openRoom(otherUserId: string) {
  return new Promise<ActiveRoomViewModel>((resolve, reject) => {
    const to = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 2500);
    function onJoined(room: ActiveRoomViewModel) { cleanup(); resolve(room); }
    function cleanup() { clearTimeout(to); socket.off('room:joined', onJoined); }
    socket.once('room:joined', onJoined);
    socket.emit('room:join', { otherUserId });
  });
}

async function send(roomId: string, text?: string, files: File[] = []) {
  // see sendMessage() example above
}
```

That’s it — with the connection, events, and endpoints above you can integrate realtime 1:1 messaging, attachments, presence, and history in any frontend.

