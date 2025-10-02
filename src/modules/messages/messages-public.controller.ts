import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';

@ApiExcludeController()
@Controller('public/test')
export class MessagesPublicController {
  @SkipResponseEnvelope()
  @Get('messages')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getTester(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Messaging Tester</title>
    <link
      href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      rel="stylesheet"
      integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
      crossorigin="anonymous"
    />
    <style>
      body {
        background-color: #f5f5f5;
      }
      .message-bubble {
        max-width: 75%;
      }
      .message-bubble.outgoing {
        margin-left: auto;
        background-color: #0d6efd;
        color: #fff;
      }
      .message-bubble.incoming {
        margin-right: auto;
        background-color: #ffffff;
        color: #212529;
        border: 1px solid rgba(0, 0, 0, 0.1);
      }
      .message-bubble.general {
        margin: 0 auto;
        background-color: #ffc107;
        color: #212529;
      }
      .message-timestamp {
        font-size: 0.75rem;
        opacity: 0.8;
      }
      .message-caption {
        font-size: 0.85rem;
        opacity: 0.85;
      }
      .message-text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .chat-window {
        height: 70vh;
        overflow-y: auto;
      }
      .presence-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        margin-right: 6px;
      }
    </style>
  </head>
  <body>
    <div class="container-fluid py-3">
      <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h1 class="h3 mb-0">Messaging Tester</h1>
          <p class="text-muted small mb-0">
            Use your API token to explore messaging rooms and exchange messages.
          </p>
        </div>
        <form id="tokenForm" class="d-flex gap-2 align-items-center">
          <label for="tokenInput" class="form-label mb-0 me-1 fw-semibold">Auth token</label>
          <input
            id="tokenInput"
            type="text"
            class="form-control form-control-sm"
            placeholder="Paste JWT access token"
            autocomplete="off"
            spellcheck="false"
            style="min-width: 280px"
          />
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </form>
      </div>

      <div id="alertPlaceholder"></div>

      <div class="row g-3">
        <div class="col-lg-4">
          <div class="card shadow-sm h-100">
            <div class="card-header bg-white">
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-semibold">Rooms</span>
                <div class="btn-group btn-group-sm" role="group">
                  <button id="refreshRooms" class="btn btn-outline-primary">Refresh</button>
                  <button id="clearState" class="btn btn-outline-secondary">Reset</button>
                </div>
              </div>
            </div>
            <div class="card-body">
              <form id="newRoomForm" class="input-group input-group-sm mb-3">
                <input
                  type="text"
                  class="form-control"
                  placeholder="Other user ID"
                  id="otherUserId"
                  autocomplete="off"
                />
                <button class="btn btn-success" type="submit">Open</button>
              </form>
              <div class="list-group" id="roomsList"></div>
            </div>
          </div>
        </div>
        <div class="col-lg-8">
          <div class="card shadow-sm h-100">
            <div class="card-header bg-white d-flex justify-content-between align-items-center">
              <div>
                <span class="fw-semibold" id="activeRoomTitle">No room selected</span>
                <div class="small text-muted" id="activeRoomMeta"></div>
              </div>
              <div class="btn-group btn-group-sm" role="group">
                <button id="loadOlder" class="btn btn-outline-primary" disabled>Load older</button>
                <button id="refreshMessages" class="btn btn-outline-primary" disabled>Refresh</button>
              </div>
            </div>
            <div class="card-body d-flex flex-column">
              <div id="messagesList" class="chat-window flex-grow-1"></div>
              <form id="messageForm" class="mt-3">
                <div class="mb-2">
                  <label class="form-label small mb-1" for="messageTitle">Title (optional)</label>
                  <input type="text" class="form-control" id="messageTitle" autocomplete="off" />
                </div>
                <div class="mb-2">
                  <label class="form-label small mb-1" for="messageText">Message</label>
                  <textarea class="form-control" id="messageText" rows="3" placeholder="Write a general message"></textarea>
                </div>
                <div class="d-flex justify-content-between align-items-center">
                  <div class="form-text">Messages are sent as general/system messages.</div>
                  <button type="submit" class="btn btn-primary">Send</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const STORAGE_KEY = 'messagesTesterState';
        const state = {
          token: '',
          rooms: [],
          selectedRoomId: null,
          messages: {},
          nextCursor: {},
        };

        const elements = {
          tokenForm: document.getElementById('tokenForm'),
          tokenInput: document.getElementById('tokenInput'),
          alertPlaceholder: document.getElementById('alertPlaceholder'),
          roomsList: document.getElementById('roomsList'),
          refreshRooms: document.getElementById('refreshRooms'),
          clearState: document.getElementById('clearState'),
          newRoomForm: document.getElementById('newRoomForm'),
          otherUserId: document.getElementById('otherUserId'),
          messagesList: document.getElementById('messagesList'),
          activeRoomTitle: document.getElementById('activeRoomTitle'),
          activeRoomMeta: document.getElementById('activeRoomMeta'),
          messageForm: document.getElementById('messageForm'),
          messageTitle: document.getElementById('messageTitle'),
          messageText: document.getElementById('messageText'),
          loadOlder: document.getElementById('loadOlder'),
          refreshMessages: document.getElementById('refreshMessages'),
        };

        function loadState() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              Object.assign(state, parsed);
            }
          } catch (error) {
            console.warn('Unable to load saved state', error);
          }
        }

        function saveState() {
          try {
            const snapshot = {
              token: state.token,
              rooms: state.rooms,
              selectedRoomId: state.selectedRoomId,
              messages: state.messages,
              nextCursor: state.nextCursor,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
          } catch (error) {
            console.warn('Unable to persist state', error);
          }
        }

        function clearAlerts() {
          elements.alertPlaceholder.innerHTML = '';
        }

        function showAlert(message, type = 'danger') {
          const wrapper = document.createElement('div');
          wrapper.className = \`alert alert-\${type} alert-dismissible fade show\`;
          wrapper.setAttribute('role', 'alert');
          wrapper.textContent = message;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn-close';
          button.setAttribute('data-bs-dismiss', 'alert');
          button.setAttribute('aria-label', 'Close');
          wrapper.appendChild(button);
          elements.alertPlaceholder.appendChild(wrapper);
        }

        function formatDate(value) {
          if (!value) return '';
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return value;
          return date.toLocaleString();
        }

        function getAuthHeaders() {
          if (!state.token) return {};
          return { Authorization: \`Bearer \${state.token}\` };
        }

        function renderRooms() {
          elements.roomsList.innerHTML = '';
          if (!state.rooms.length) {
            const empty = document.createElement('div');
            empty.className = 'text-muted small';
            empty.textContent = 'No rooms loaded yet. Use "Refresh" or open a room with another user.';
            elements.roomsList.appendChild(empty);
            return;
          }

          state.rooms
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .forEach((room) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = \`list-group-item list-group-item-action \${
                state.selectedRoomId === room.id ? 'active' : ''
              }\`;
              const title = room.participants
                .map((p) => \`\${p.firstName || ''} \${p.lastName || ''}\`.trim() || p.id)
                .join(' · ');
              const status = room.participants
                .map((p) => \`\${p.online ? '🟢' : '⚪️'} \${p.firstName || p.id.substring(0, 6)}\`)
                .join('  ');
              button.innerHTML = \`<div class="fw-semibold">\${escapeHtml(title || 'Room')}</div>
                <div class="small text-muted">\${escapeHtml(status)}</div>\`;
              button.addEventListener('click', () => selectRoom(room.id));
              elements.roomsList.appendChild(button);
            });
        }

        function renderActiveRoom() {
          const room = state.rooms.find((r) => r.id === state.selectedRoomId);
          if (!room) {
            elements.activeRoomTitle.textContent = 'No room selected';
            elements.activeRoomMeta.textContent = '';
            elements.messageForm.querySelector('button[type="submit"]').disabled = true;
            elements.loadOlder.disabled = true;
            elements.refreshMessages.disabled = true;
            elements.messagesList.innerHTML =
              '<div class="text-muted text-center mt-5">Select a room to view and send messages.</div>';
            return;
          }
          const participantNames = room.participants
            .map((p) => \`\${p.firstName || ''} \${p.lastName || ''}\`.trim() || p.id)
            .join(' · ');
          elements.activeRoomTitle.textContent = participantNames || 'Chat room';
          elements.activeRoomMeta.textContent = \`Created \${formatDate(room.createdAt)} · Updated \${formatDate(
            room.updatedAt,
          )}\`;
          elements.messageForm.querySelector('button[type="submit"]').disabled = false;
          elements.loadOlder.disabled = !state.nextCursor[room.id];
          elements.refreshMessages.disabled = false;
          renderMessages(room.id);
        }

        function renderMessages(roomId) {
          const container = elements.messagesList;
          container.innerHTML = '';
          const items = state.messages[roomId] || [];
          if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'text-muted text-center mt-5';
            empty.textContent = 'No messages to display yet.';
            container.appendChild(empty);
            return;
          }

          items.forEach((message) => {
            const wrapper = document.createElement('div');
            wrapper.className = \`rounded-3 p-3 mb-3 message-bubble \${message.direction}\`;
            const header = document.createElement('div');
            header.className = 'd-flex justify-content-between align-items-center mb-2';
            const senderName = message.sender
              ? \`\${message.sender.firstName || ''} \${message.sender.lastName || ''}\`.trim() || message.sender.id
              : 'System';
            const sender = document.createElement('strong');
            sender.textContent = \`\${senderName}\`;
            header.appendChild(sender);
            const timestamp = document.createElement('span');
            timestamp.className = 'message-timestamp';
            timestamp.textContent = formatDate(message.createdAt);
            header.appendChild(timestamp);
            wrapper.appendChild(header);

            if (message.caption) {
              const caption = document.createElement('div');
              caption.className = 'message-caption fw-semibold';
              caption.textContent = message.caption;
              wrapper.appendChild(caption);
            }

            if (message.text) {
              const text = document.createElement('div');
              text.className = 'message-text';
              text.textContent = message.text;
              wrapper.appendChild(text);
            }

            if (message.imageUrl) {
              const image = document.createElement('img');
              image.src = message.imageUrl;
              image.className = 'img-fluid rounded mt-2';
              image.alt = 'Attached image';
              wrapper.appendChild(image);
            }

            container.appendChild(wrapper);
          });

          container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(value) {
          if (value == null) return '';
          return value
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }

        async function fetchRooms() {
          if (!state.token) {
            showAlert('Provide an auth token to load rooms.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const response = await fetch(\`\${window.location.origin}/messages/rooms/active\`, {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...getAuthHeaders(),
              },
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to load rooms');
            }
            state.rooms = Array.isArray(payload.data) ? payload.data : [];
            saveState();
            renderRooms();
            renderActiveRoom();
          } catch (error) {
            showAlert(error.message || 'Unable to load rooms.');
          }
        }

        async function selectRoom(roomId) {
          if (state.selectedRoomId === roomId) {
            renderActiveRoom();
            return;
          }
          state.selectedRoomId = roomId;
          saveState();
          renderRooms();
          renderActiveRoom();
          await refreshMessages();
        }

        async function refreshMessages(useCursor = false) {
          const roomId = state.selectedRoomId;
          if (!roomId) return;
          if (!state.token) {
            showAlert('Provide an auth token to load messages.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const params = new URLSearchParams();
            params.set('limit', '50');
            if (useCursor && state.nextCursor[roomId]) {
              params.set('cursor', state.nextCursor[roomId]);
            }
            const response = await fetch(
              \`\${window.location.origin}/messages/rooms/\${encodeURIComponent(roomId)}/messages?\${params.toString()}\`,
              {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  ...getAuthHeaders(),
                },
              },
            );
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to load messages');
            }
            const { messages = [], nextCursor = null } = payload.data || {};
            if (useCursor) {
              const existing = state.messages[roomId] || [];
              const merged = [...messages, ...existing];
              state.messages[roomId] = deduplicateMessages(merged);
            } else {
              state.messages[roomId] = messages;
            }
            state.nextCursor[roomId] = nextCursor;
            saveState();
            renderActiveRoom();
          } catch (error) {
            showAlert(error.message || 'Unable to load messages.');
          }
        }

        async function createRoom(otherUserId) {
          if (!otherUserId) return;
          if (!state.token) {
            showAlert('Provide an auth token to create rooms.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const response = await fetch(\`\${window.location.origin}/messages/rooms\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...getAuthHeaders(),
              },
              body: JSON.stringify({ otherUserId }),
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to open room');
            }
            const room = payload.data;
            const existingIndex = state.rooms.findIndex((r) => r.id === room.id);
            if (existingIndex >= 0) {
              state.rooms[existingIndex] = room;
            } else {
              state.rooms.push(room);
            }
            state.selectedRoomId = room.id;
            saveState();
            renderRooms();
            renderActiveRoom();
            await refreshMessages();
            showAlert('Room is ready.', 'success');
          } catch (error) {
            showAlert(error.message || 'Unable to open room.');
          }
        }

        async function sendMessage(title, text) {
          const roomId = state.selectedRoomId;
          if (!roomId) return;
          if (!text?.trim()) {
            showAlert('Message text is required to send.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const response = await fetch(
              \`\${window.location.origin}/messages/rooms/\${encodeURIComponent(roomId)}/messages/general\`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  ...getAuthHeaders(),
                },
                body: JSON.stringify({ title: title?.trim() || undefined, text: text.trim() }),
              },
            );
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to send message');
            }
            const message = payload.data;
            const roomMessages = state.messages[roomId] || [];
            roomMessages.push(message);
            state.messages[roomId] = deduplicateMessages(roomMessages);
            const roomIndex = state.rooms.findIndex((room) => room.id === roomId);
            if (roomIndex >= 0) {
              state.rooms[roomIndex].updatedAt = message.createdAt;
              state.rooms[roomIndex].lastMessage = message;
            }
            saveState();
            elements.messageTitle.value = '';
            elements.messageText.value = '';
            renderActiveRoom();
          } catch (error) {
            showAlert(error.message || 'Unable to send message.');
          }
        }

        function deduplicateMessages(messages) {
          const seen = new Map();
          messages.forEach((msg) => {
            if (msg && msg.id) {
              seen.set(msg.id, msg);
            }
          });
          return Array.from(seen.values()).sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        }

        function hydrateUI() {
          elements.tokenInput.value = state.token || '';
          renderRooms();
          renderActiveRoom();
        }

        elements.tokenForm.addEventListener('submit', (event) => {
          event.preventDefault();
          state.token = elements.tokenInput.value.trim();
          saveState();
          if (!state.token) {
            showAlert('Auth token cleared. Provide a token to interact with the API.', 'warning');
            return;
          }
          showAlert('Token saved locally.', 'success');
          fetchRooms();
        });

        elements.refreshRooms.addEventListener('click', (event) => {
          event.preventDefault();
          fetchRooms();
        });

        elements.clearState.addEventListener('click', (event) => {
          event.preventDefault();
          localStorage.removeItem(STORAGE_KEY);
          state.token = '';
          state.rooms = [];
          state.selectedRoomId = null;
          state.messages = {};
          state.nextCursor = {};
          hydrateUI();
          showAlert('Saved state cleared. Token removed.', 'warning');
        });

        elements.newRoomForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const otherId = elements.otherUserId.value.trim();
            if (!otherId) {
              showAlert("Provide the other participant's user ID.", 'warning');
            return;
          }
          await createRoom(otherId);
        });

        elements.loadOlder.addEventListener('click', (event) => {
          event.preventDefault();
          refreshMessages(true);
        });

        elements.refreshMessages.addEventListener('click', (event) => {
          event.preventDefault();
          refreshMessages(false);
        });

        elements.messageForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const title = elements.messageTitle.value;
          const text = elements.messageText.value;
          await sendMessage(title, text);
        });

        loadState();
        hydrateUI();
        if (state.token && state.rooms.length) {
          renderRooms();
          renderActiveRoom();
        }
        if (state.token && !state.rooms.length) {
          fetchRooms();
        }
      })();
    </script>
  </body>
</html>`;
  }
}
