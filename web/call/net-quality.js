// Качество связи в звонке по статистике WebRTC (getStats).
// «up» — то, что уходит от нас (потери видит собеседник), «down» — то, что приходит к нам.
// Так понятно, кому помогает выключить камеру: при плохой отдаче — себе, при плохом приёме — собеседнику.

const LIMITS = {
  loss: [0.03, 0.1], // доля потерянных пакетов
  jitter: [0.04, 0.1], // разброс задержки звука, с
  rtt: [0.4, 0.8], // время туда-обратно, с
};
const RANK = { good: 0, weak: 1, poor: 2 };
const LEVELS = ['good', 'weak', 'poor'];

const levelOf = (value, [weak, poor]) => (value == null || Number.isNaN(value) ? 0 : value >= poor ? 2 : value >= weak ? 1 : 0);

/** Срез статистики: что изменилось с прошлого опроса. counters — накопленные счётчики для следующего раза. */
export function readStats(report, prev = {}) {
  const stats = [...report.values()];
  const transport = stats.find((s) => s.type === 'transport' && s.selectedCandidatePairId);
  const pair = transport
    ? report.get(transport.selectedCandidatePairId)
    : stats.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
  let lost = 0;
  let received = 0;
  let jitter = null;
  let upLoss = null;
  let remoteRtt = null;
  for (const s of stats) {
    if (s.type === 'inbound-rtp') {
      lost += s.packetsLost ?? 0;
      received += s.packetsReceived ?? 0;
      if (s.kind === 'audio' && s.jitter != null) jitter = s.jitter;
    } else if (s.type === 'remote-inbound-rtp') {
      if (s.fractionLost != null) upLoss = Math.max(upLoss ?? 0, s.fractionLost);
      if (s.roundTripTime != null) remoteRtt = Math.max(remoteRtt ?? 0, s.roundTripTime);
    }
  }
  const dLost = lost - (prev.lost ?? lost);
  const dTotal = dLost + received - (prev.received ?? received);
  return {
    sample: {
      rtt: pair?.currentRoundTripTime ?? remoteRtt,
      upLoss,
      downLoss: dTotal >= 20 ? Math.max(0, dLost) / dTotal : null, // на паре пакетов доля ничего не значит
      jitter,
    },
    counters: { lost, received },
  };
}

/** Оценка одного среза: good | weak | poor и с какой стороны беда. */
export function grade({ rtt, upLoss, downLoss, jitter }) {
  const up = levelOf(upLoss, LIMITS.loss);
  const down = Math.max(levelOf(downLoss, LIMITS.loss), levelOf(jitter, LIMITS.jitter));
  const level = Math.max(up, down, levelOf(rtt, LIMITS.rtt));
  const side = !level ? null : up && down ? 'both' : up ? 'up' : down ? 'down' : 'both';
  return { level: LEVELS[level], side };
}

/**
 * Сглаживание по последним срезам (опрос раз в 2 секунды), чтобы значок не мигал от одного всплеска:
 * два плохих из четырёх — «слабая»; два «так себе» — или связь скачет туда-сюда — «нестабильна».
 */
export function createNetTracker() {
  const hist = [];
  return {
    push(g) {
      hist.push(g);
      if (hist.length > 8) hist.shift();
      const last = hist.slice(-4);
      const bad = last.filter((h) => h.level !== 'good');
      let flips = 0;
      for (let i = 1; i < hist.length; i++) if ((hist[i].level === 'good') !== (hist[i - 1].level === 'good')) flips++;
      const level = last.filter((h) => h.level === 'poor').length >= 2 ? 'poor' : bad.length >= 2 || flips >= 3 ? 'weak' : 'good';
      if (level === 'good') return { level, side: null };
      const sides = new Set(hist.filter((h) => h.side).map((h) => h.side));
      const side = sides.has('both') || (sides.has('up') && sides.has('down')) ? 'both' : sides.has('up') ? 'up' : 'down';
      return { level, side };
    },
  };
}

export const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);
export const rankOf = (level) => RANK[level] ?? 0;
