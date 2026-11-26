import { Room, getLocalMedia } from './room.js';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const groupId = params.get('room')?.trim();
const name = params.get('name')?.trim() || 'Участник';
const join = byId('join');
const leave = byId('leave');
const mic = byId('mic');
const cam = byId('cam');
const preview = byId('preview');
const message = byId('message');
const send = byId('send');
const messages = byId('messages');
const peers = new Map();
let room;

function status(text, connected = false) {
  const item = byId('status');
  item.textContent = text;
  item.dataset.connected = connected;
}

function notice(id, text) {
  const item = byId(id);
  item.textContent = text || '';
  item.hidden = !text;
}

function chatEnabled(enabled) {
  message.disabled = send.disabled = !enabled;
}

function removePeers() {
  for (const peer of peers.values()) peer.tile.remove();
  peers.clear();
  byId('waiting').hidden = false;
}

function updatePeer(id, state) {
  const peer = peers.get(id);
  if (!peer) return;
  Object.assign(peer, state);
  const devices = [peer.mic === false && 'микрофон выкл.', peer.cam === false && 'камера выкл.'].filter(Boolean);
  peer.caption.textContent = devices.length ? peer.name + ' (' + devices.join(', ') + ')' : peer.name;
  peer.video.style.opacity = peer.cam === false ? '0' : '';
}

function presence(id, online, state) {
  if (online) {
    const tile = document.createElement('figure');
    tile.className = 'peer';
    const video = document.createElement('video');
    video.autoplay = video.playsInline = true;
    const caption = document.createElement('figcaption');
    const name = state.name || 'Собеседник';
    tile.append(video, caption);
    peers.get(id)?.tile.remove();
    peers.set(id, { tile, video, caption, name });
    byId('peers').append(tile);
    updatePeer(id, state);
  } else {
    peers.get(id)?.tile.remove();
    peers.delete(id);
  }
  byId('waiting').hidden = peers.size > 0;
}

function renderChat(list, { history }) {
  if (history) messages.replaceChildren();
  for (const entry of list) {
    const li = document.createElement('li');
    const author = document.createElement('strong');
    author.textContent = entry.name || 'Участник';
    li.append(author, document.createTextNode('\n' + entry.text));
    messages.append(li);
  }
  messages.scrollTop = messages.scrollHeight;
}

function finish(text) {
  room?.stop();
  room = undefined;
  preview.srcObject = null;
  preview.hidden = true;
  removePeers();
  chatEnabled(false);
  mic.hidden = cam.hidden = leave.hidden = true;
  join.hidden = false;
  join.disabled = false;
  notice('media-status', '');
  status(text);
}

async function enter() {
  join.disabled = true;
  status('Подключение');
  let local;
  try {
    const response = await fetch('/api/call/ice');
    if (!response.ok) throw new Error('server');
    const { iceServers } = await response.json();
    const media = await getLocalMedia();
    local = media.stream;
    notice('media-status', media.error);
    preview.srcObject = local;
    preview.hidden = !local?.getVideoTracks().length;
    preview.style.visibility = '';
    messages.replaceChildren();
    notice('chat-status', '');
    room = new Room({ groupId, name, iceServers, local, on: {
      status(state) {
        chatEnabled(state === 'connected');
        if (state === 'reconnecting') removePeers();
        const labels = { connecting: 'Подключение', connected: 'Вы в звонке', reconnecting: 'Восстанавливаем соединение' };
        if (labels[state]) status(labels[state], state === 'connected');
      },
      presence,
      remote(id, stream) {
        const peer = peers.get(id);
        if (peer) peer.video.srcObject = stream;
      },
      peerState: updatePeer,
      chat: renderChat,
      chatLimit: () => notice('chat-status', 'Слишком много сообщений. Подождите несколько секунд.'),
      connection(id, state) {
        if (state === 'failed') notice('media-status', 'Не удалось передать видео или звук. Чат доступен.');
      },
      fatal(text) {
        finish(text);
        join.focus();
      },
    } });
    room.start();
    mic.hidden = !local?.getAudioTracks().length;
    cam.hidden = !local?.getVideoTracks().length;
    mic.setAttribute('aria-pressed', room.mic);
    cam.setAttribute('aria-pressed', room.cam);
    leave.hidden = false;
    join.hidden = true;
    leave.focus();
  } catch {
    local?.getTracks().forEach((track) => track.stop());
    finish('Не удалось открыть комнату. Попробуйте войти ещё раз.');
  }
}

join.addEventListener('click', enter);
leave.addEventListener('click', () => {
  finish('Вы вышли из звонка');
  join.focus();
});
mic.addEventListener('click', () => {
  room.setMic(!room.mic);
  mic.setAttribute('aria-pressed', room.mic);
});
cam.addEventListener('click', () => {
  room.setCam(!room.cam);
  cam.setAttribute('aria-pressed', room.cam);
  preview.style.visibility = room.cam ? '' : 'hidden';
});
byId('chat').addEventListener('submit', (event) => {
  event.preventDefault();
  const draft = message.value.trim();
  if (!draft) return;
  const sent = room?.sendChat(draft);
  notice('chat-status', sent ? '' : 'Сообщение не отправлено. Дождитесь соединения.');
  if (sent) message.value = '';
});
window.addEventListener('pagehide', () => room?.stop());

if (groupId) status('Комната ' + groupId);
else {
  join.disabled = true;
  status('Откройте звонок из карточки или кабинета стажёра.');
}
