// Видеокомната на WebRTC: полносвязная сеть (mesh) на 2–3 участника.
// Сигнализация — через WebSocket нашего сервера. Кто подключился позже, тот и звонит
// уже сидящим в комнате, поэтому встречных предложений (glare) не возникает.

import { readStats, grade, createNetTracker } from './net-quality.js';

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };

/** Дорожка выбранного устройства; null, если включить его не вышло. */
export async function getDeviceTrack(kind, deviceId) {
  const base = kind === 'audio' ? AUDIO : VIDEO;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ [kind]: { ...base, deviceId: { exact: deviceId } } });
    return stream.getTracks()[0];
  } catch {
    return null;
  }
}

export async function getLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, error: 'Браузер не даёт доступ к камере. Нужен HTTPS или localhost.' };
  const audio = AUDIO;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: VIDEO,
    });
    return { stream, error: null };
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      return { stream, error: 'Камера недоступна — ты в комнате только со звуком.' };
    } catch {
      return { stream: null, error: 'Нет доступа к микрофону и камере.' };
    }
  }
}

export class Room {
  /**
   * on: {
   *   status(state)            — 'connecting' | 'connected' | 'reconnecting' | 'closed'
   *   presence(id, online, st) — участник вошёл/вышел
   *   remote(id, stream)       — пришёл медиапоток участника
   *   peerState(id, {mic,cam}) — участник выключил микрофон/камеру
   *   connection(id, state)    — состояние RTCPeerConnection
   *   quality(id, {level, side}) — качество связи с участником: good | weak | poor (net-quality.js)
   *   question(index)          — текущий вопрос сменился
   *   review({consents, all})  — кто в группе согласился на разбор разговора
   *   chat(list, {history})     — сообщения чата звонка (при входе — вся история комнаты)
   *   chatLimit()               — слишком часто пишешь, сообщение не отправлено
   *   call({endsAt, closesAt, next, extensions, by}) — время звонка с учётом продлений
   *   ended()                  — время вышло, звонок закрыт для всех
   *   fatal(message)           — комната недоступна
   * }
   */
  constructor({ groupId, name, iceServers, local, review = null, on }) {
    this.groupId = groupId;
    this.name = name;
    this.iceServers = iceServers;
    this.local = local;
    this.on = on;
    this.peers = new Map();
    this.early = new Map();
    // Микрофон и камеру могли выключить ещё на экране перед входом.
    this.mic = !!local?.getAudioTracks().some((t) => t.enabled);
    this.cam = !!local?.getVideoTracks().some((t) => t.enabled);
    this.review = review;
    this.stopped = false;
    this.retry = 0;
    this.ws = null;
    this.statsTimer = null;
  }

  start() {
    this.connect();
    this.statsTimer = setInterval(() => this.pollStats(), 2000);
  }

  async pollStats() {
    for (const [id, peer] of this.peers) {
      if (peer.pc.connectionState !== 'connected') continue;
      const report = await peer.pc.getStats().catch(() => null);
      if (!report || this.peers.get(id) !== peer) continue;
      const { sample, counters } = readStats(report, peer.counters);
      peer.counters = counters;
      const net = peer.tracker.push(grade(sample));
      if (net.level !== peer.net.level || net.side !== peer.net.side) {
        peer.net = net;
        this.on.quality?.(id, net);
      }
    }
  }

  connect() {
    if (this.stopped) return;
    this.on.status?.(this.retry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/call/${encodeURIComponent(this.groupId)}?name=${encodeURIComponent(this.name || '')}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const join = { type: 'join', groupId: this.groupId, mic: this.mic, cam: this.cam };
      if (typeof this.review === 'boolean') join.review = this.review;
      this.send(join);
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handle(msg).catch((err) => console.error('room', err));
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.closeAllPeers();
      this.on.status?.('reconnecting');
      const delay = Math.min(1000 * 2 ** this.retry++, 10_000);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  async handle(msg) {
    switch (msg.type) {
      case 'joined':
        this.on.status?.('connected');
        this.on.question?.(msg.question);
        if (msg.review) this.on.review?.(msg.review);
        if (msg.call) this.on.call?.(msg.call);
        this.on.chat?.(msg.chat ?? [], { history: true });
        for (const p of msg.peers) {
          this.on.presence?.(p.id, true, p);
          this.call(p.id);
        }
        break;
      case 'peer-joined':
        // Участник мог переподключиться — старое соединение с ним больше не нужно.
        this.closePeer(msg.id);
        this.on.presence?.(msg.id, true, msg);
        break;
      case 'peer-left':
        this.closePeer(msg.id);
        this.on.presence?.(msg.id, false);
        break;
      case 'signal':
        await this.onSignal(msg.from, msg.data);
        break;
      case 'state':
        this.on.peerState?.(msg.id, { mic: msg.mic, cam: msg.cam });
        break;
      case 'question':
        this.on.question?.(msg.index);
        break;
      case 'review':
        this.on.review?.({ consents: msg.consents, paid: msg.paid, all: msg.all });
        break;
      case 'chat':
        this.on.chat?.([{ id: msg.id, from: msg.from, name: msg.name, text: msg.text, photo: msg.photo, at: msg.at, reply: msg.reply, reactions: msg.reactions }], { history: false });
        break;
      case 'chat-update':
        this.on.chatUpdate?.({ id: msg.id, from: msg.from, text: msg.text, photo: msg.photo, at: msg.at, reply: msg.reply, reactions: msg.reactions });
        break;
      case 'chat-typing':
        this.on.chatTyping?.(msg.from);
        break;
      case 'chat-limit':
        this.on.chatLimit?.();
        break;
      case 'call':
        this.on.call?.(msg);
        break;
      case 'ended':
        this.stop();
        this.on.ended?.();
        break;
      case 'replaced':
        this.stop({ keepMedia: true });
        this.on.fatal?.('Комната открыта в другой вкладке — здесь звонок остановлен.');
        break;
      case 'error':
        this.stop({ keepMedia: true });
        this.on.fatal?.(msg.message);
        break;
    }
  }

  createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, pending: this.early.get(id) ?? [], stream: null, initiator: false, answered: false, tracker: createNetTracker(), net: { level: 'good', side: null } };
    this.early.delete(id);
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'signal', to: id, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) peer.stream = e.streams[0];
      else {
        peer.stream ??= new MediaStream();
        peer.stream.addTrack(e.track);
      }
      this.on.remote?.(id, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      this.on.connection?.(id, pc.connectionState);
      if (pc.connectionState === 'failed' && peer.initiator) pc.restartIce();
    };
    return peer;
  }

  call(id) {
    const peer = this.createPeer(id);
    peer.initiator = true;
    const { pc } = peer;
    pc.onnegotiationneeded = async () => {
      try {
        await pc.setLocalDescription();
        this.send({ type: 'signal', to: id, data: { sdp: pc.localDescription } });
      } catch (err) {
        console.error('offer', err);
      }
    };
    const kinds = new Set();
    if (this.local) {
      for (const track of this.local.getTracks()) {
        pc.addTrack(track, this.local);
        kinds.add(track.kind);
      }
    }
    // Даже без своей камеры хотим видеть и слышать собеседника.
    for (const kind of ['audio', 'video']) if (!kinds.has(kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
  }

  async onSignal(from, data) {
    let peer = this.peers.get(from);
    if (data?.sdp) {
      if (data.sdp.type === 'offer') {
        if (!peer || peer.initiator) {
          this.closePeer(from);
          peer = this.createPeer(from);
        }
        await peer.pc.setRemoteDescription(data.sdp);
        if (!peer.answered && this.local) {
          for (const track of this.local.getTracks()) peer.pc.addTrack(track, this.local);
        }
        peer.answered = true;
        await peer.pc.setLocalDescription();
        this.send({ type: 'signal', to: from, data: { sdp: peer.pc.localDescription } });
      } else if (data.sdp.type === 'answer') {
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(data.sdp);
      }
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data?.candidate) {
      if (peer?.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else if (peer) peer.pending.push(data.candidate);
      else {
        if (!this.early.has(from)) this.early.set(from, []);
        this.early.get(from).push(data.candidate);
      }
    }
  }

  setMic(on) {
    this.mic = on;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.send({ type: 'state', mic: this.mic, cam: this.cam });
  }

  setCam(on) {
    this.cam = on;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.send({ type: 'state', mic: this.mic, cam: this.cam });
  }

  setReview(on) {
    this.review = on;
    this.send({ type: 'review', on });
  }

  extend() {
    this.send({ type: 'extend' });
  }

  setQuestion(index) {
    this.send({ type: 'question', index });
  }

  /** false — нет связи, сообщение не ушло. */
  sendChat(text, replyTo = null) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.send({ type: 'chat', text, replyTo });
    return true;
  }

  /** Реакция на сообщение чата: тот же emoji ещё раз - снять. */
  chatReact(id, emoji) {
    this.send({ type: 'chat-react', id, emoji });
  }

  chatTyping() {
    this.send({ type: 'chat-typing' });
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    this.peers.delete(id);
    if (peer.net.level !== 'good') this.on.quality?.(id, { level: 'good', side: null });
  }

  closeAllPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  stop({ keepMedia = false } = {}) {
    if (!this.stopped) {
      this.stopped = true;
      clearInterval(this.statsTimer);
      this.send({ type: 'leave' });
      this.ws?.close();
      this.closeAllPeers();
      this.on.status?.('closed');
    }
    if (!keepMedia) this.local?.getTracks().forEach((t) => t.stop());
  }
}
