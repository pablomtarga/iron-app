/* IRON · servidor próprio
   Sincroniza treinos entre aparelhos com login por passkey (WebAuthn), sem senha.
   Tudo fica em arquivos JSON dentro de DATA_DIR (a pasta que você monta no Docker). */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public'));
/* origens permitidas (separadas por vírgula). Vazio = aceita o endereço que o navegador estiver usando. */
const ORIGINS = (process.env.ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const ALLOW_SIGNUP = String(process.env.ALLOW_SIGNUP || 'false') === 'true';
const RP_NAME = process.env.RP_NAME || 'IRON';
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 90);
const MAX_BODY = process.env.MAX_BODY || '8mb';

try { fs.mkdirSync(path.join(DATA_DIR, 'store'), { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); }
catch (e) {
  console.error(`Não consegui gravar em ${DATA_DIR} (${e.code}).`);
  console.error('No Docker: crie a pasta antes com "mkdir -p data" e rode com o seu usuário (PUID/PGID no .env).');
  process.exit(1);
}
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

/* ---------- armazenamento em arquivo (escrita atômica) ---------- */
function writeJSON(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
let DB = readJSON(USERS_FILE, { users: {} });
const saveDB = () => writeJSON(USERS_FILE, DB);
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE); }
catch { SECRET = crypto.randomBytes(32); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

/* ---------- token de sessão assinado (HMAC) ---------- */
const b64 = b => Buffer.from(b).toString('base64url');
function makeToken(uid) {
  const body = b64(JSON.stringify({ u: uid, e: Date.now() + TOKEN_DAYS * 864e5 }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), c = Buffer.from(good);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!d.u || d.e < Date.now() || !DB.users[d.u]) return null;
    return d.u;
  } catch { return null; }
}
const authUser = req => readToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

/* ---------- limite simples de tentativas ---------- */
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path, now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
    arr.push(now); hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 600000)) hits.delete(k); }, 600000).unref();

/* ---------- desafios do WebAuthn (curta duração, em memória) ---------- */
const challenges = new Map();
function putChallenge(data) {
  const rid = crypto.randomBytes(16).toString('base64url');
  challenges.set(rid, { ...data, exp: Date.now() + 5 * 60000 });
  return rid;
}
function takeChallenge(rid) {
  const c = challenges.get(rid); challenges.delete(rid);
  return c && c.exp > Date.now() ? c : null;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k); }, 60000).unref();

/* origem e rpID vêm do cabeçalho Origin (o navegador é quem sabe onde a passkey nasce) */
function originInfo(req) {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  if (!origin) return null;
  let u; try { u = new URL(origin); } catch { return null; }
  /* lista ORIGINS definida: só ela vale. Vazia: só aceita o próprio endereço deste servidor (app servido daqui) */
  const ok = ORIGINS.length ? ORIGINS.includes(origin) : (!!req.headers.host && u.host === req.headers.host);
  return ok ? { origin, rpID: u.hostname } : null;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: MAX_BODY }));
/* CORS: só pras origens que você liberou (ou a mesma origem do app servido aqui) */
app.use((req, res, next) => {
  const o = (req.headers.origin || '').replace(/\/$/, '');
  let sameHost = false;
  try { sameHost = !!(o && req.headers.host && new URL(o).host === req.headers.host); } catch { /* Origin inválido */ }
  if (o && (sameHost || ORIGINS.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
const findByName = name => Object.values(DB.users).find(u => u.username === name);
const userOpen = () => ALLOW_SIGNUP || Object.keys(DB.users).length === 0;

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'iron-selfhost', signup: userOpen(), users: Object.keys(DB.users).length }));

/* ---- cadastro da passkey ---- */
app.post('/api/register/options', limit(20, 600000), async (req, res) => {
  try {
    const oi = originInfo(req); if (!oi) return res.status(403).json({ error: 'Origem não permitida.' });
    const name = slug(req.body && req.body.username);
    if (!name) return res.status(400).json({ error: 'Escolha um nome de usuário (letras e números).' });
    let user = findByName(name), isNew = false;
    if (user) {
      if (authUser(req) !== user.id) return res.status(403).json({ error: 'Esse usuário já existe. Entre com a passkey para adicionar outro aparelho.' });
    } else {
      if (!userOpen()) return res.status(403).json({ error: 'Cadastro fechado neste servidor.' });
      isNew = true;
      user = { id: crypto.randomBytes(16).toString('base64url'), username: name, passkeys: [], createdAt: Date.now() };
    }
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: oi.rpID, userName: user.username, userID: isoBase64URL.toBuffer(user.id),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map(p => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    const rid = putChallenge({ kind: 'reg', challenge: options.challenge, user, isNew, origin: oi.origin, rpID: oi.rpID });
    res.json({ rid, options });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao iniciar o cadastro.' }); }
});
app.post('/api/register/verify', limit(20, 600000), async (req, res) => {
  try {
    const c = takeChallenge(req.body && req.body.rid);
    if (!c || c.kind !== 'reg') return res.status(400).json({ error: 'Pedido expirado. Tente de novo.' });
    const v = await verifyRegistrationResponse({
      response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID,
    });
    if (!v.verified) return res.status(400).json({ error: 'Passkey não confirmada.' });
    const cr = v.registrationInfo.credential;
    const stored = c.isNew ? c.user : DB.users[c.user.id];
    if (!stored) return res.status(400).json({ error: 'Usuário não encontrado.' });
    stored.passkeys.push({
      id: cr.id, publicKey: isoBase64URL.fromBuffer(cr.publicKey), counter: cr.counter,
      transports: cr.transports || [], createdAt: Date.now(),
    });
    DB.users[stored.id] = stored; saveDB();
    res.json({ token: makeToken(stored.id), username: stored.username });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Não consegui confirmar a passkey.' }); }
});

/* ---- login ---- */
app.post('/api/login/options', limit(30, 600000), async (req, res) => {
  try {
    const oi = originInfo(req); if (!oi) return res.status(403).json({ error: 'Origem não permitida.' });
    const name = slug(req.body && req.body.username);
    const user = name ? findByName(name) : null;
    const options = await generateAuthenticationOptions({
      rpID: oi.rpID, userVerification: 'preferred',
      allowCredentials: user ? user.passkeys.map(p => ({ id: p.id, transports: p.transports })) : [],
    });
    const rid = putChallenge({ kind: 'auth', challenge: options.challenge, origin: oi.origin, rpID: oi.rpID });
    res.json({ rid, options });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao iniciar o login.' }); }
});
app.post('/api/login/verify', limit(30, 600000), async (req, res) => {
  try {
    const c = takeChallenge(req.body && req.body.rid);
    if (!c || c.kind !== 'auth') return res.status(400).json({ error: 'Pedido expirado. Tente de novo.' });
    const credId = req.body.response && req.body.response.id;
    let owner = null, pk = null;
    for (const u of Object.values(DB.users)) { const f = u.passkeys.find(p => p.id === credId); if (f) { owner = u; pk = f; break; } }
    if (!owner) return res.status(400).json({ error: 'Passkey desconhecida neste servidor.' });
    const v = await verifyAuthenticationResponse({
      response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID,
      credential: { id: pk.id, publicKey: isoBase64URL.toBuffer(pk.publicKey), counter: pk.counter, transports: pk.transports },
    });
    if (!v.verified) return res.status(400).json({ error: 'Passkey não confirmada.' });
    pk.counter = v.authenticationInfo.newCounter; saveDB();
    res.json({ token: makeToken(owner.id), username: owner.username });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Não consegui confirmar a passkey.' }); }
});

/* ---- dados ---- */
const dataFile = uid => path.join(DATA_DIR, 'store', uid.replace(/[^A-Za-z0-9_-]/g, '') + '.json');
app.get('/api/me', (req, res) => {
  const uid = authUser(req); if (!uid) return res.status(401).json({ error: 'Sessão expirada.' });
  res.json({ username: DB.users[uid].username, passkeys: DB.users[uid].passkeys.length });
});
app.get('/api/data', (req, res) => {
  const uid = authUser(req); if (!uid) return res.status(401).json({ error: 'Sessão expirada.' });
  res.json({ payload: readJSON(dataFile(uid), null) });
});
app.put('/api/data', (req, res) => {
  const uid = authUser(req); if (!uid) return res.status(401).json({ error: 'Sessão expirada.' });
  const p = req.body && req.body.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return res.status(400).json({ error: 'Dados inválidos.' });
  writeJSON(dataFile(uid), p);
  res.json({ ok: true, at: Date.now() });
});

/* ---- o próprio app (opcional): se existir ./public, serve o PWA daqui ---- */
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h',
    setHeaders: (res, f) => { if (/(index\.html|sw\.js)$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.listen(PORT, () => {
  console.log(`IRON servidor próprio em http://localhost:${PORT}  ·  dados em ${DATA_DIR}`);
  console.log(ORIGINS.length ? `Origens liberadas: ${ORIGINS.join(', ')}` : 'ORIGINS vazio: só vale o app aberto neste mesmo endereço. Se o app estiver em outro site (ex.: GitHub Pages), coloque o endereço dele em ORIGINS.');
  console.log(userOpen() ? 'Cadastro aberto.' : 'Cadastro fechado (já existe usuário). Use ALLOW_SIGNUP=true pra abrir.');
});
