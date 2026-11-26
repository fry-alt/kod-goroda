// Сигнальный сервер для WebRTC: участники обмениваются через него SDP и ICE-кандидатами,
// а само видео и звук идут напрямую между браузерами (или через TURN, если он настроен).
import { WebSocketServer } from 'ws';
import { userFromCookieHeader, sameOrigin } from './auth.js';
import * as S from './service.js';
import { setRoomActivity } from './review.js';
import { setPush, setOnline } from './live.js';
import { typing as dmTyping, REACTIONS } from './messages.js';
import { attachDialectumRtc } from './dialectum-rtc.js';
import { connectRoomPhotos, clearRoomPhotos } from './room-photos.js';

export const CHAT_MAX = 500; // символов в сообщении
const CHAT_KEEP = 100; // сообщений в памяти на комнату
const CHAT_RATE = [8, 10_000]; // не больше 8 сообщений за 10 секунд с одного подключения
const TYPING_EVERY = 3000;
const REPLY_PREVIEW = 120;

/** Одна строка без управляющих символов, до CHAT_MAX. */
export const cleanChat = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);

function chatAllowed(ws, now = Date.now()) {
  ws.chatTimes = (ws.chatTimes ?? []).filter((t) => now - t < CHAT_RATE[1]);
  if (ws.chatTimes.length >= CHAT_RATE[0]) return false;
  ws.chatTimes.push(now);
  return true;
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const dialectum = attachDialectumRtc();
  /** groupId → Map<userId, { ws, mic, cam }> */
  const rooms = new Map();
  // Чат во время звонка: живёт только в памяти, пока в комнате кто-то есть, в базу не пишется.
  /** groupId → [{ id, from, text, at }] (последние CHAT_KEEP) */
  const chats = new Map();
  /** Добавить сообщение в чат звонка и разослать всем в комнате. */
  function postChat(groupId, room, from, fields) {
    const list = chats.get(groupId) ?? [];
    const item = { id: (list.at(-1)?.id ?? 0) + 1, from, ...fields, at: Date.now() };
    list.push(item);
    if (list.length > CHAT_KEEP) list.shift();
    chats.set(groupId, list);
    broadcast(room, { type: 'chat', ...item });
  }
  connectRoomPhotos({
    has: (groupId, userId) => rooms.get(groupId)?.has(userId) ?? false,
    // В text подпись или «Фото»: приложение для iPhone фото пока не показывает и выведет этот текст.
    post: (groupId, userId, photo, caption) => postChat(groupId, rooms.get(groupId), userId, { text: cleanChat(caption) || 'Фото', photo }),
  });
  // Когда закрыть звонок (с учётом продлений): в этот момент всех выводим из комнаты.
  /** groupId → closesAt */
  const closes = new Map();
  // Разбор разговора не начинается, пока в комнате кто-то есть.
  setRoomActivity((groupId) => (rooms.get(groupId)?.size ?? 0) > 0);
  // Все открытые вкладки человека (комната и «живое» подключение приложения) — для личных сообщений.
  /** userId → Set<ws> */
  const online = new Map();
  setPush((userId, obj) => {
    for (const ws of online.get(userId) ?? []) send(ws, obj);
  });
  setOnline(() => [...online.keys()]);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/dialectum/ws') return dialectum.upgrade(req, socket, head);
    if (url.pathname !== '/ws') return socket.destroy();
    if (!sameOrigin(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const user = userFromCookieHeader(req.headers.cookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.cookie = req.headers.cookie; // чтобы в heartbeat проверять, что сессия ещё жива
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('error', () => {}); // слишком большой кадр: ws сам закроет соединение, без обработчика падает весь процесс
    ws.isAlive = true;
    const mine = online.get(ws.user.id) ?? new Set();
    mine.add(ws);
    online.set(ws.user.id, mine);
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      try {
        handle(ws, msg);
      } catch (err) {
        console.error('signaling', err);
      }
    });
    ws.on('close', () => {
      leave(ws);
      const set = online.get(ws.user.id);
      set?.delete(ws);
      if (set && !set.size) online.delete(ws.user.id);
    });
  });

  // Раз в 25 секунд проверяем, что соединения живы, и обновляем «последний раз был в комнате».
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      // Вышел из аккаунта, сменил пароль или удалил аккаунт — сессии больше нет, и сокет не должен
      // получать личные сообщения и сигналы звонка до перезагрузки страницы.
      if (!userFromCookieHeader(ws.cookie)) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
      if (ws.groupId) S.markSeen(ws.groupId, ws.user.id);
    }
  }, 25_000);
  // Время вышло и продлевать не стали — звонок заканчивается у всех сразу.
  const closer = setInterval(() => {
    const now = Date.now();
    for (const [groupId, at] of closes) {
      if (now < at) continue;
      closes.delete(groupId);
      for (const [, entry] of rooms.get(groupId) ?? []) {
        send(entry.ws, { type: 'ended' });
        leave(entry.ws);
      }
    }
  }, 1000);
  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(closer);
  });

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  function broadcast(room, obj, exceptId) {
    for (const [id, entry] of room) if (id !== exceptId) send(entry.ws, obj);
  }

  // Согласие на разбор видят все участники группы: и в звонке, и на экране перед входом.
  // Вкладку, открытую в комнате другой группы, не трогаем.
  function pushReview(groupId, review) {
    for (const id of Object.keys(review.consents)) {
      for (const ws of online.get(Number(id)) ?? []) {
        if (!ws.groupId || ws.groupId === groupId) send(ws, { type: 'review', groupId, ...review });
      }
    }
  }

  function handle(ws, msg) {
    const room = ws.groupId ? rooms.get(ws.groupId) : null;
    const me = ws.user.id;

    switch (msg.type) {
      case 'join': {
        const groupId = Number(msg.groupId);
        let access;
        try {
          access = S.roomAccess(groupId, me);
        } catch (err) {
          return send(ws, { type: 'error', message: err.message });
        }
        leave(ws);
        if (!rooms.has(groupId)) rooms.set(groupId, new Map());
        const target = rooms.get(groupId);

        // Тот же человек открыл комнату во второй вкладке — старое подключение закрываем.
        const previous = target.get(me);
        if (previous && previous.ws !== ws) {
          send(previous.ws, { type: 'replaced' });
          previous.ws.groupId = null;
          previous.ws.close();
        }

        const entry = { ws, mic: msg.mic !== false, cam: msg.cam !== false };
        target.set(me, entry);
        ws.groupId = groupId;
        ws.questionsCount = access.questionsCount;
        closes.set(groupId, access.call.closesAt);
        S.markJoined(groupId, me);

        // Выбор на экране перед входом: согласен ли на разбор разговора.
        const review =
          S.reviewEnabled() && typeof msg.review === 'boolean' ? S.setReviewConsent(groupId, me, msg.review) : S.reviewState(groupId);

        send(ws, {
          type: 'joined',
          you: me,
          question: access.question,
          chat: chats.get(groupId) ?? [],
          review,
          call: access.call,
          peers: [...target].filter(([id]) => id !== me).map(([id, e]) => ({ id, mic: e.mic, cam: e.cam })),
        });
        broadcast(target, { type: 'peer-joined', id: me, mic: entry.mic, cam: entry.cam }, me);
        pushReview(groupId, review);
        break;
      }

      // Из звонка — для своей комнаты, с экрана перед входом — для groupId (пока комната открыта).
      case 'review': {
        if (!S.reviewEnabled()) break;
        const groupId = room ? ws.groupId : Number(msg.groupId);
        if (!room) {
          try {
            S.roomAccess(groupId, me);
          } catch (err) {
            return send(ws, { type: 'error', message: err.message });
          }
        }
        pushReview(groupId, S.setReviewConsent(groupId, me, !!msg.on));
        break;
      }

      // «Продлить» на предложении в конце звонка: хватает согласия одного участника.
      case 'extend': {
        if (!room) break;
        const { call, extended } = S.extendCall(ws.groupId, me);
        closes.set(ws.groupId, call.closesAt);
        if (extended) broadcast(room, { type: 'call', ...call, by: me });
        else send(ws, { type: 'call', ...call });
        break;
      }

      case 'signal': {
        const target = room?.get(Number(msg.to));
        if (target) send(target.ws, { type: 'signal', from: me, data: msg.data });
        break;
      }

      case 'state': {
        const entry = room?.get(me);
        if (!entry) break;
        entry.mic = !!msg.mic;
        entry.cam = !!msg.cam;
        broadcast(room, { type: 'state', id: me, mic: entry.mic, cam: entry.cam }, me);
        break;
      }

      case 'question': {
        if (!room) break;
        const index = S.setQuestion(ws.groupId, msg.index, ws.questionsCount);
        broadcast(room, { type: 'question', index, by: me });
        break;
      }

      case 'chat': {
        if (!room) break;
        const text = cleanChat(msg.text);
        if (!text) break;
        if (!chatAllowed(ws)) return send(ws, { type: 'chat-limit' });
        // Ответ на сообщение этой же комнаты; чужой или несуществующий id просто игнорируем.
        const original = (chats.get(ws.groupId) ?? []).find((c) => c.id === Number(msg.replyTo));
        const reply = original
          ? { id: original.id, from: original.from, text: original.text.slice(0, REPLY_PREVIEW), ...(original.photo ? { photo: true } : {}) }
          : null;
        postChat(ws.groupId, room, me, { text, ...(reply ? { reply } : {}) });
        break;
      }

      // Реакция на сообщение чата звонка: одна на человека, повтор снимает, другая заменяет.
      case 'chat-react': {
        if (!room) break;
        const item = (chats.get(ws.groupId) ?? []).find((c) => c.id === Number(msg.id));
        if (!item || !REACTIONS.includes(msg.emoji)) break;
        if (!chatAllowed(ws)) return send(ws, { type: 'chat-limit' });
        const mine = item.reactions?.find((r) => r.by.includes(me));
        for (const r of item.reactions ?? []) r.by = r.by.filter((id) => id !== me);
        if (mine?.emoji !== msg.emoji) {
          const group = item.reactions?.find((r) => r.emoji === msg.emoji);
          if (group) group.by.push(me);
          else (item.reactions ??= []).push({ emoji: msg.emoji, by: [me] });
        }
        item.reactions = item.reactions?.filter((r) => r.by.length);
        if (!item.reactions?.length) delete item.reactions;
        broadcast(room, { type: 'chat-update', ...item });
        break;
      }

      // «Печатает…» в звонке: остальным не чаще раза в 3 секунды.
      case 'chat-typing': {
        if (!room) break;
        const now = Date.now();
        if (now - (ws.typingAt ?? 0) < TYPING_EVERY) break;
        ws.typingAt = now;
        broadcast(room, { type: 'chat-typing', from: me }, me);
        break;
      }

      // «Печатает…» в личной переписке.
      case 'dm-typing':
        dmTyping(me, Number(msg.to));
        break;

      case 'leave':
        leave(ws);
        break;
    }
  }

  function leave(ws) {
    const groupId = ws.groupId;
    if (!groupId) return;
    ws.groupId = null;
    const room = rooms.get(groupId);
    if (!room) return;
    const entry = room.get(ws.user.id);
    if (entry && entry.ws === ws) {
      room.delete(ws.user.id);
      S.markSeen(groupId, ws.user.id);
      broadcast(room, { type: 'peer-left', id: ws.user.id });
    }
    if (!room.size) {
      rooms.delete(groupId);
      closes.delete(groupId);
      chats.delete(groupId); // все вышли — переписка звонка исчезает
      clearRoomPhotos(groupId);
    }
  }

  return wss;
}
