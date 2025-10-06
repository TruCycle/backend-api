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
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script>
    <script
      src="https://cdn.socket.io/4.7.5/socket.io.min.js"
      integrity="sha384-2huaZvOR9iDzHqslqwpR87isEmrfxqyWOF7hr7BY6KG0+hVKLoEXMPUJw3ynWuhO"
      crossorigin="anonymous"
    ></script>
    <style>
      body {
        background-color: #f5f5f5;
      }
      .message-bubble {
        max-width: 75%;
        position: relative;
        border-radius: 16px;
        box-shadow: 0 1px 1px rgba(0,0,0,0.04);
      }
      .message-bubble.outgoing {
        margin-left: auto;
        background-color: #dcf8c6; /* WhatsApp-like green */
        color: #111;
        border: 1px solid #b2e59e;
      }
      .message-bubble.outgoing::after {
        content: '';
        position: absolute;
        right: -8px;
        top: 12px;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 8px 0 8px 8px;
        border-color: transparent transparent transparent #dcf8c6;
      }
      .message-bubble.incoming {
        margin-right: auto;
        background-color: #ffffff;
        color: #212529;
        border: 1px solid #e6e6e6;
      }
      .message-bubble.incoming::after {
        content: '';
        position: absolute;
        left: -8px;
        top: 12px;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 8px 8px 8px 0;
        border-color: transparent #ffffff transparent transparent;
      }
      .message-bubble.general {
        margin: 0 auto;
        background-color: #fff3cd; /* warning-100 */
        color: #664d03; /* warning-emphasis */
        border: 1px solid #ffe69c; /* warning-300 */
        max-width: 60%;
        font-size: 0.95rem;
      }
      .date-chip {
        display: inline-block;
        background: #e9ecef;
        color: #495057;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 0.75rem;
      }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
        align-items: start;
      }
      .image-grid.single {
        display: block;
        text-align: center;
      }
      .image-grid.single img {
        width: 75%;
        height: auto;
      }
      .image-grid img {
        width: 100%;
        height: auto;
        border-radius: 8px;
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
          <button type="button" id="openSystemMessage" class="btn btn-warning btn-sm">System Message</button>
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
                  <label class="form-label small mb-1" for="messageText">Message</label>
                  <textarea class="form-control" id="messageText" rows="3" placeholder="Write a direct message"></textarea>
                </div>
                <div class="mb-3">
                  <label class="form-label small mb-1" for="messageFiles">Attachments (images)</label>
                  <input type="file" class="form-control" id="messageFiles" accept="image/*" multiple />
                </div>
                <div class="d-flex justify-content-end align-items-center">
                  <button type="submit" class="btn btn-primary">Send</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- System Message Modal -->
    <div class="modal fade" id="systemMessageModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <form id="systemMessageForm" class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Send System Message</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label" for="systemMessageRoom">Room</label>
              <select id="systemMessageRoom" class="form-select"></select>
            </div>
            <div class="mb-3">
              <label class="form-label" for="systemMessageTitle">Title (optional)</label>
              <input type="text" id="systemMessageTitle" class="form-control" autocomplete="off" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="systemMessageText">Message</label>
              <textarea id="systemMessageText" class="form-control" rows="3" placeholder="Write a general/system message"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary">Send</button>
          </div>
        </form>
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
          currentUserId: null,
        };

        const WS_NAMESPACE = '/messages';
        let socket = null;

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
          messageText: document.getElementById('messageText'),
          messageFiles: document.getElementById('messageFiles'),
          loadOlder: document.getElementById('loadOlder'),
          refreshMessages: document.getElementById('refreshMessages'),
          openSystemMessage: document.getElementById('openSystemMessage'),
          systemMessageModal: document.getElementById('systemMessageModal'),
          systemMessageForm: document.getElementById('systemMessageForm'),
          systemMessageRoom: document.getElementById('systemMessageRoom'),
          systemMessageTitle: document.getElementById('systemMessageTitle'),
          systemMessageText: document.getElementById('systemMessageText'),
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
              currentUserId: state.currentUserId,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
          } catch (error) {
            console.warn('Unable to persist state', error);
          }
        }

        function connectSocket() {
          if (!state.token) return;
          try {
            if (socket) {
              socket.removeAllListeners();
              socket.disconnect();
            }
          } catch (_) {}

          const origin = window.location.origin;
          socket = window.io(origin + WS_NAMESPACE, {
            auth: { token: state.token },
            transports: ['websocket'],
          });

          socket.on('connect', () => {
            showAlert('WebSocket connected.', 'success');
            if (!state.rooms.length) {
              fetchRooms();
            }
          });

          socket.on('connect_error', (err) => {
            const message = (err && err.message) || 'WebSocket connection failed.';
            showAlert(message, 'danger');
          });

          socket.on('message:new', (message) => {
            if (!message || !message.roomId) return;
            const roomId = message.roomId;
            const list = state.messages[roomId] || [];
            list.push(message);
            state.messages[roomId] = deduplicateMessages(list);
            const idx = state.rooms.findIndex((r) => r.id === roomId);
            if (idx >= 0) {
              state.rooms[idx].updatedAt = message.createdAt;
              state.rooms[idx].lastMessage = message;
            }
            saveState();
            if (state.selectedRoomId === roomId) {
              renderActiveRoom();
            } else {
              renderRooms();
            }
          });

          socket.on('room:activity', (payload) => {
            const roomId = payload && payload.roomId;
            if (!roomId) return;
            const idx = state.rooms.findIndex((r) => r.id === roomId);
            if (idx >= 0) {
              state.rooms[idx].updatedAt = payload.updatedAt || new Date().toISOString();
              saveState();
              renderRooms();
              if (state.selectedRoomId === roomId) renderActiveRoom();
            }
          });

          socket.on('room:cleared', (payload) => {
            const roomId = payload && payload.roomId;
            if (!roomId) return;
            state.messages[roomId] = [];
            saveState();
            if (state.selectedRoomId === roomId) renderActiveRoom();
          });

          socket.on('room:deleted', (payload) => {
            const roomId = payload && payload.roomId;
            if (!roomId) return;
            state.rooms = state.rooms.filter((r) => r.id !== roomId);
            if (state.selectedRoomId === roomId) {
              state.selectedRoomId = null;
            }
            delete state.messages[roomId];
            delete state.nextCursor[roomId];
            saveState();
            renderRooms();
            renderActiveRoom();
          });

          socket.on('presence:update', (payload) => {
            const userId = payload && payload.userId;
            const online = !!(payload && payload.online);
            if (!userId) return;
            let changed = false;
            state.rooms.forEach((room) => {
              room.participants.forEach((p) => {
                if (p.id === userId && p.online !== online) {
                  p.online = online;
                  changed = true;
                }
              });
            });
            if (changed) {
              saveState();
              renderRooms();
              renderActiveRoom();
            }
          });
        }

        function populateSystemRoomsSelect() {
          const select = elements.systemMessageRoom;
          if (!select) return;
          select.innerHTML = '';
          const rooms = [...(state.rooms || [])].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          if (!rooms.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No rooms available';
            select.appendChild(opt);
            select.disabled = true;
            return;
          }
          select.disabled = false;
          for (const room of rooms) {
            const opt = document.createElement('option');
            opt.value = room.id;
            const title = room.participants
              .map((p) => \`\${p.firstName || ''} \${p.lastName || ''}\`.trim() || p.id)
              .join(' / ');
            opt.textContent = title || 'Room';
            select.appendChild(opt);
          }
          const current = state.selectedRoomId || rooms[0]?.id;
          if (current) select.value = current;
        }

        function openSystemMessageModal() {
          if (!state.token) {
            showAlert('Provide an auth token to send messages.', 'warning');
            return;
          }
          populateSystemRoomsSelect();
          elements.systemMessageTitle.value = '';
          elements.systemMessageText.value = '';
          const modal = bootstrap.Modal.getOrCreateInstance(elements.systemMessageModal);
          modal.show();
        }

        async function sendSystemMessage(roomId, title, text) {
          if (!roomId) {
            showAlert('Select a room first.', 'warning');
            return;
          }
          if (!text?.trim()) {
            showAlert('Message text is required to send.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const url = window.location.origin + '/messages/rooms/' + encodeURIComponent(roomId) + '/messages/general';
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...getAuthHeaders(),
              },
              body: JSON.stringify({ title: title?.trim() || undefined, text: text.trim() }),
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to send system message');
            }
            const modal = bootstrap.Modal.getOrCreateInstance(elements.systemMessageModal);
            modal.hide();
            showAlert('System message sent.', 'success');
          } catch (error) {
            showAlert(error.message || 'Unable to send system message.');
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
          const groups = groupMessagesForRender(items);

          let lastDayKey = null;
          groups.forEach((entry) => {
            const baseDate = new Date(entry.createdAt);
            const dayKey = baseDate.toDateString();
            if (dayKey !== lastDayKey) {
              const wrap = document.createElement('div');
              wrap.className = 'text-center my-2';
              const chip = document.createElement('span');
              chip.className = 'date-chip';
              chip.textContent = baseDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
              wrap.appendChild(chip);
              container.appendChild(wrap);
              lastDayKey = dayKey;
            }

            const directionClass = computeDirection(entry.firstMessage);
            const wrapper = document.createElement('div');
            wrapper.className = \`rounded-3 p-3 mb-3 message-bubble \${directionClass}\`;

            const header = document.createElement('div');
            header.className = 'd-flex justify-content-between align-items-center mb-2';
            const isGeneral = entry.firstMessage.category === 'general';
            const hasSender = !!entry.firstMessage.sender;
            const senderName = hasSender
              ? \`\${entry.firstMessage.sender.firstName || ''} \${entry.firstMessage.sender.lastName || ''}\`.trim() || entry.firstMessage.sender.id
              : 'System';
            const sender = document.createElement('strong');
            sender.textContent = senderName;
            header.appendChild(sender);
            if (isGeneral) {
              const badge = document.createElement('span');
              badge.className = hasSender ? 'badge bg-warning text-dark ms-2' : 'badge bg-dark ms-2';
              badge.textContent = hasSender ? 'General' : 'System';
              header.appendChild(badge);
            }
            const timestamp = document.createElement('span');
            timestamp.className = 'message-timestamp';
            timestamp.textContent = formatDate(entry.createdAt);
            header.appendChild(timestamp);
            wrapper.appendChild(header);

            if (entry.type === 'bundle') {
              const grid = document.createElement('div');
              grid.className = 'image-grid' + (entry.messages.length === 1 ? ' single' : '');
              entry.messages.forEach((m) => {
                if (!m.imageUrl) return;
                const img = document.createElement('img');
                img.src = m.imageUrl;
                img.alt = 'Attached image';
                grid.appendChild(img);
              });
              wrapper.appendChild(grid);
              const first = entry.messages[0];
              if (first.caption) {
                const caption = document.createElement('div');
                caption.className = 'message-caption fw-semibold mt-2';
                caption.textContent = first.caption;
                wrapper.appendChild(caption);
              }
            } else {
              const message = entry.firstMessage;
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
                const grid = document.createElement('div');
                grid.className = 'image-grid single';
                const img = document.createElement('img');
                img.src = message.imageUrl;
                img.alt = 'Attached image';
                grid.appendChild(img);
                wrapper.appendChild(grid);
              }
            }

            container.appendChild(wrapper);
          });

          container.scrollTop = container.scrollHeight;
        }

        function groupMessagesForRender(items) {
          const groups = [];
          const MAX_MS = 15000; // 15 seconds window to bundle images
          for (let i = 0; i < items.length; i++) {
            const m = items[i];
            if (m && m.imageUrl) {
              const bucket = [m];
              const dir = computeDirection(m);
              const senderId = m.sender?.id || '';
              const baseTime = new Date(m.createdAt).getTime();
              let j = i + 1;
              while (j < items.length) {
                const n = items[j];
                if (!n?.imageUrl) break;
                if (computeDirection(n) !== dir) break;
                if ((n.sender?.id || '') !== senderId) break;
                const t = new Date(n.createdAt).getTime();
                if (Math.abs(t - baseTime) > MAX_MS) break;
                bucket.push(n);
                j++;
              }
              i = j - 1;
              groups.push({
                type: 'bundle',
                createdAt: m.createdAt,
                firstMessage: m,
                messages: bucket,
              });
            } else {
              groups.push({
                type: 'single',
                createdAt: m.createdAt,
                firstMessage: m,
              });
            }
          }
          return groups;
        }

        function computeDirection(message) {
          try {
            if (!message) return 'incoming';
            if (message.category === 'general') return 'general';
            const senderId = message.sender && message.sender.id;
            if (senderId && state.currentUserId && senderId === state.currentUserId) return 'outgoing';
            return 'incoming';
          } catch (_) {
            return 'incoming';
          }
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
          const handleRoomJoined = async (room) => {
            if (!room || !room.id) return;
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
          };

          if (socket && socket.connected) {
            try {
              await new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                  if (settled) return;
                  settled = true;
                  socket.off('room:joined', onJoined);
                  reject(new Error('WebSocket join timed out'));
                }, 2500);
                const onJoined = async (room) => {
                  if (settled) return;
                  settled = true;
                  clearTimeout(timer);
                  socket.off('room:joined', onJoined);
                  await handleRoomJoined(room);
                  resolve();
                };
                socket.once('room:joined', onJoined);
                socket.emit('room:join', { otherUserId });
              });
              return;
            } catch (_) {
              // Fallback to HTTP
            }
          }

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
            await handleRoomJoined(payload.data);
          } catch (error) {
            showAlert(error.message || 'Unable to open room.');
          }
        }

        async function fetchMe() {
          if (!state.token) return;
          try {
            const response = await fetch(\`\${window.location.origin}/auth/me\`, {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...getAuthHeaders(),
              },
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') {
              throw new Error(payload?.message || 'Failed to fetch current user');
            }
            const id = payload?.data?.user?.id;
            if (id) {
              state.currentUserId = id;
              saveState();
            }
          } catch (error) {
            showAlert(error.message || 'Unable to fetch current user.', 'warning');
          }
        }

        async function sendMessage(text) {
          const roomId = state.selectedRoomId;
          if (!roomId) return;
          if (!socket || !socket.connected) {
            showAlert('WebSocket is not connected. Save token again or refresh.', 'warning');
            return;
          }
          const body = (text || '').trim();
          const filesInput = elements.messageFiles;
          const files = Array.from(filesInput?.files || []);
          if (!body && files.length === 0) {
            showAlert('Type a message or attach an image.', 'warning');
            return;
          }
          clearAlerts();
          try {
            const filePayload = await Promise.all(
              files.map(async (file) => ({
                name: file.name,
                type: file.type || 'application/octet-stream',
                data: await readFileAsBase64(file),
              })),
            );

            await new Promise((resolve, reject) => {
              let settled = false;
              const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error('Timed out sending over WebSocket.'));
              }, 4000);

              const onSent = () => {
                if (settled) return;
                settled = true;
                cleanup();
                elements.messageText.value = '';
                if (filesInput) filesInput.value = '';
                resolve();
              };

              function cleanup() {
                clearTimeout(timeout);
                socket.off('message:sent', onSent);
              }

              socket.once('message:sent', onSent);
              socket.emit('message:send', {
                roomId,
                text: body || undefined,
                files: filePayload,
              });
            });
          } catch (error) {
            showAlert(error.message || 'Unable to send message.');
          }
        }

        function readFileAsBase64(file) {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const result = reader.result;
                if (typeof result === 'string') {
                  // Strip data URL prefix if present
                  const comma = result.indexOf(',');
                  resolve(comma > -1 ? result.slice(comma + 1) : result);
                } else if (result instanceof ArrayBuffer) {
                  const bytes = new Uint8Array(result);
                  let binary = '';
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  resolve(btoa(binary));
                } else {
                  reject(new Error('Unsupported file reader result'));
                }
              } catch (e) {
                reject(e);
              }
            };
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            // Prefer readAsDataURL to keep type; will be stripped above
            reader.readAsDataURL(file);
          });
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

        elements.tokenForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          state.token = elements.tokenInput.value.trim();
          state.currentUserId = null;
          saveState();
          if (!state.token) {
            showAlert('Auth token cleared. Provide a token to interact with the API.', 'warning');
            return;
          }
          showAlert('Token saved locally.', 'success');
          await fetchMe();
          fetchRooms();
          connectSocket();
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
          state.currentUserId = null;
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
          const text = elements.messageText.value;
          await sendMessage(text);
        });

        elements.openSystemMessage.addEventListener('click', (event) => {
          event.preventDefault();
          openSystemMessageModal();
        });

        elements.systemMessageForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const roomId = elements.systemMessageRoom.value;
          const title = elements.systemMessageTitle.value;
          const text = elements.systemMessageText.value;
          await sendSystemMessage(roomId, title, text);
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
        if (state.token) {
          if (!state.currentUserId) {
            fetchMe();
          }
          connectSocket();
        }
      })();
    </script>
  </body>
</html>`;
  }
}
