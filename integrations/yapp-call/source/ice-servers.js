const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * STUN — всем. TURN — только авторизованному участнику комнаты: с TURN_SECRET выдаём
 * временные логин и пароль по схеме TURN REST API (coturn --use-auth-secret), они живут 12 часов.
 */
export function iceServers(userId = null) {
  const servers = [{ urls: list(process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302') }];
  const turnUrls = list(process.env.TURN_URLS);
  if (!userId || !turnUrls.length) return servers;
  if (process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  } else if (process.env.TURN_USERNAME) {
    servers.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL || '' });
  }
  return servers;
}

api.get('/health', (req, res) => res.json({ ok: true }));
