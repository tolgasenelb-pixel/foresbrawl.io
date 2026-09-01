const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, 'game');
const players = new Map();
const buildings = new Map();
const parties = new Map();
const clans = new Map();
const sessions = new Map();
const mobs = new Map();
const mobHitCooldowns = new Map();
const MOB_TYPES = [
  { shape: 'spider', color: '#181028', outline: '#080410', eyes: '#ff3300', typeName: 'Orman Orumcegi', radius: 46, hp: 108, dmg: 26 },
  { shape: 'wolf', color: '#6b4932', outline: '#28170d', eyes: '#ffcc66', typeName: 'Kurt', radius: 38, hp: 88, dmg: 22 },
  { shape: 'elephant', color: '#71808a', outline: '#26323a', eyes: '#d9f3ff', typeName: 'Fil', radius: 68, hp: 330, dmg: 38 },
];
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'forest-data.json');
const authSecret = process.env.AUTH_SECRET || 'forestbrawl-auth-secret-change-me';
let worldSeed = Math.floor(Math.random() * 0x7fffffff);
let nextMobId = 1;

let accountData = { users: {}, clans: {}, nextId: 1 };
try {
  if (fs.existsSync(dataFile)) {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    accountData = {
      users: parsed.users || {},
      clans: parsed.clans || {},
      nextId: parsed.nextId || 1
    };
  }
} catch (error) {
  console.warn('Could not load account data:', error.message);
  accountData = { users: {}, clans: {}, nextId: 1 };
}
for (const clan of Object.values(accountData.clans || {})) clans.set(clan.id, clan);

function saveAccountData() {
  try {
    accountData.clans = Object.fromEntries(clans);
    fs.writeFileSync(dataFile, JSON.stringify(accountData, null, 2));
  }
  catch (error) { console.warn('Could not save account data:', error.message); }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, rankId: rankInfo(user.xp || 0).rankId,
    score: user.score || 0, kills: user.kills || 0, games: user.games || 0,
    gamesPlayed: user.gamesPlayed || user.games || 0, deaths: user.deaths || 0,
    bestScore: user.bestScore || user.score || 0, timePlayed: user.timePlayed || 0,
    xp: user.xp || 0, ownedItems: user.ownedItems || [], equippedItems: user.equippedItems || {}, coins: user.coins ?? 1500 };
}

const RANKS = [0, 1000, 3000, 8000, 20000, 50000, 120000, 280000, 600000, 1200000, 2500000, 5000000];
const RANK_NAMES = ['Tohum', 'Taş', 'Köylü', 'Acemi', 'Savaşçı', 'Muhafız', 'Ateş Efendisi', 'Kristal', 'Fırtına', 'Gece Hanı', 'Efsane', 'Tanrısal'];
function rankInfo(xp) {
  let rankId = 0;
  for (let i = 0; i < RANKS.length; i++) { if (xp >= RANKS[i]) rankId = i; else break; }
  const next = RANKS[rankId + 1];
  return { rankId, name: RANK_NAMES[rankId], minXP: RANKS[rankId], nextMinXP: next || RANKS[rankId], xpProgress: next ? Math.max(0, Math.min(1, (xp - RANKS[rankId]) / (next - RANKS[rankId]))) : 1, xpToNextRank: next ? Math.max(0, next - xp) : 0 };
}
function profileResponse(user) {
  const rank = rankInfo(user.xp || 0);
  const nextRank = rank.rankId < RANKS.length - 1 ? { id: rank.rankId + 1, name: RANK_NAMES[rank.rankId + 1], minXP: rank.nextMinXP } : null;
  return { user: publicUser(user), rank, nextRank, level: rank.rankId + 1, xp: user.xp || 0, xpProgress: rank.xpProgress, xpToNextRank: rank.xpToNextRank };
}

function getAuthUser(request) {
  try {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let username = sessions.get(token);
    if (!username && token.includes('.')) {
      const [encodedName, signature] = token.split('.');
      if (encodedName && signature) {
        const expected = crypto.createHmac('sha256', authSecret).update(encodedName).digest('base64url');
        if (signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          username = Buffer.from(encodedName, 'base64url').toString('utf8');
        }
      }
    }
    return username ? accountData.users[usernameKey(username)] : null;
  } catch {
    return null;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 100000) reject(new Error('payload too large')); });
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid json')); } });
    request.on('error', reject);
  });
}

function usernameKey(username) { return String(username || '').trim().toLowerCase(); }

function createToken(user) {
  const encodedName = Buffer.from(user.username, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(encodedName).digest('base64url');
  const token = `${encodedName}.${signature}`;
  sessions.set(token, usernameKey(user.username));
  return token;
}

function persistPlayerScore(player) {
  const user = accountData.users[usernameKey(player.name)];
  if (!user) return;
  user.score = Math.max(user.score || 0, player.score || 0);
  user.kills = Math.max(user.kills || 0, player.kills || 0);
  saveAccountData();
}

function leaderboard(tab) {
  const users = Object.values(accountData.users || {});
  return users.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 100).map(user => ({
    name: user.username, score: user.score || 0, rankId: user.rankId || 0,
  }));
}

async function handleApi(request, response, requestPath) {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); response.end(); return true; }
  if (!requestPath.startsWith('/api/')) return false;
  if (requestPath === '/api/health' && request.method === 'GET') { sendJson(response, 200, { ok: true, online: io.engine.clientsCount }); return true; }

  let body = {};
  if (request.method !== 'GET') { try { body = await readJson(request); } catch { sendJson(response, 400, { error: 'Geçersiz istek.' }); return true; } }

  if (requestPath === '/api/auth/register' && request.method === 'POST') {
    const username = String(body.username || '').trim();
    const key = usernameKey(username);
    if (!/^[a-zA-Z0-9_ TürkÇĞİÖŞÜçğıöşü-]{3,20}$/.test(username)) { sendJson(response, 400, { error: 'Kullanıcı adı 3-20 karakter olmalı.' }); return true; }
    if (!body.password || String(body.password).length < 4) { sendJson(response, 400, { error: 'Şifre en az 4 karakter olmalı.' }); return true; }
    if (accountData.users[key]) { sendJson(response, 409, { error: 'Bu kullanıcı adı zaten kayıtlı.' }); return true; }
    const password = hashPassword(String(body.password));
    const user = { id: accountData.nextId++, username, email: String(body.email || '').trim(), ...password, rankId: 0, xp: 0, score: 0, kills: 0, deaths: 0, games: 0, gamesPlayed: 0, bestScore: 0, timePlayed: 0, coins: 1500, ownedItems: [], equippedItems: {} };
    accountData.users[key] = user; saveAccountData();
    sendJson(response, 201, { token: createToken(user), user: publicUser(user) }); return true;
  }
  if (requestPath === '/api/auth/login' && request.method === 'POST') {
    const user = accountData.users[usernameKey(body.username)];
    const password = String(body.password || '');
    const check = user && hashPassword(password, user.salt).hash;
    if (!user || !check || !crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(user.hash, 'hex'))) { sendJson(response, 401, { error: 'Kullanıcı adı veya şifre hatalı.' }); return true; }
    sendJson(response, 200, { token: createToken(user), user: publicUser(user) }); return true;
  }
  if (requestPath === '/api/auth/me' && request.method === 'GET') { const user = getAuthUser(request); if (!user) sendJson(response, 401, { error: 'Oturum geçersiz.' }); else sendJson(response, 200, { user: publicUser(user) }); return true; }
  if (requestPath === '/api/auth/logout' && request.method === 'POST') { const token = String(request.headers.authorization || '').replace(/^Bearer\s+/, ''); sessions.delete(token); sendJson(response, 200, { ok: true }); return true; }
  if (requestPath === '/api/leaderboard' && request.method === 'GET') { sendJson(response, 200, { entries: leaderboard(new URL(request.url, 'http://localhost').searchParams.get('tab')) }); return true; }
  if (requestPath === '/api/leaderboard/submit' && request.method === 'POST') {
    const submittedUser = getAuthUser(request) || accountData.users[usernameKey(body.name)];
    if (submittedUser) {
      submittedUser.score = Math.max(submittedUser.score || 0, Number(body.score) || 0);
      submittedUser.kills = Math.max(submittedUser.kills || 0, Number(body.kills) || 0);
      submittedUser.bestScore = Math.max(submittedUser.bestScore || 0, Number(body.score) || 0);
      submittedUser.rankId = rankInfo(submittedUser.xp || 0).rankId;
      saveAccountData();
    }
    sendJson(response, 200, { ok: true }); return true;
  }

  const user = getAuthUser(request);
  if (requestPath === '/api/profile' && request.method === 'GET') { if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' }); else sendJson(response, 200, profileResponse(user)); return true; }
  if (requestPath === '/api/profile/xp' && request.method === 'POST') {
    if (!user) { sendJson(response, 401, { error: 'Oturum gerekli.' }); return true; }
    const gainedXp = Math.max(0, Math.min(5000, Number(body.xp) || 0));
    const previousRank = rankInfo(user.xp || 0).rankId;
    user.xp = (user.xp || 0) + gainedXp;
    user.kills = (user.kills || 0) + Math.max(0, Number(body.kills) || 0);
    user.deaths = (user.deaths || 0) + Math.max(0, Number(body.deaths) || 0);
    user.gamesPlayed = (user.gamesPlayed || user.games || 0) + 1;
    user.games = user.gamesPlayed;
    user.timePlayed = (user.timePlayed || 0) + Math.max(0, Number(body.timePlayed) || 0);
    user.score = Math.max(user.score || 0, Number(body.score) || 0);
    user.bestScore = Math.max(user.bestScore || 0, Number(body.score) || 0);
    user.coins = (user.coins || 0) + Math.max(0, Number(body.coins) || 0);
    const currentRank = rankInfo(user.xp);
    user.rankId = currentRank.rankId;
    saveAccountData();
    sendJson(response, 200, { ...profileResponse(user), newXp: user.xp, rankUp: currentRank.rankId > previousRank, newRankName: currentRank.name });
    return true;
  }
  if (requestPath === '/api/shop/owned' && request.method === 'GET') { if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' }); else sendJson(response, 200, publicUser(user)); return true; }
  if (requestPath === '/api/shop/sync' && request.method === 'POST') { if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' }); else { user.ownedItems = Array.isArray(body.ownedItems) ? [...new Set(body.ownedItems)] : user.ownedItems; user.equippedItems = body.equippedItems && typeof body.equippedItems === 'object' ? body.equippedItems : user.equippedItems; user.coins = Math.max(0, Number(body.coins) || 0); saveAccountData(); sendJson(response, 200, publicUser(user)); } return true; }
  if (requestPath === '/api/shop/equip' && request.method === 'PUT') { if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' }); else { user.equippedItems = { ...user.equippedItems, [String(body.category || '')]: String(body.itemId || '') }; saveAccountData(); sendJson(response, 200, { equippedItems: user.equippedItems }); } return true; }
  if (requestPath === '/api/shop/buy' && request.method === 'POST') { if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' }); else { const itemId = String(body.itemId || ''); const cost = Math.max(0, Number(body.cost) || 0); if (!itemId || user.coins < cost) sendJson(response, 400, { error: 'Yetersiz altın.' }); else { user.coins -= cost; user.ownedItems = [...new Set([...(user.ownedItems || []), itemId])]; saveAccountData(); sendJson(response, 200, { newCoins: user.coins, ownedItems: user.ownedItems }); } } return true; }
  sendJson(response, 404, { error: 'API endpoint bulunamadı.' }); return true;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
  handleApi(request, response, requestPath).then(handled => {
    if (handled) return;
    serveStatic(request, response, requestPath);
  }).catch(error => {
    console.error('Request error:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Sunucu hatası.' });
  });
});

function serveStatic(request, response, requestPath) {
  let relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  if (relative.startsWith('game/')) relative = relative.slice(5);
  else if (relative.startsWith('game\\')) relative = relative.slice(5);
  if (relative === '') relative = 'index.html';

  let filePath = path.resolve(root, relative);
  if (!fs.existsSync(filePath)) {
    const fallbackPath = path.resolve(__dirname, requestPath.replace(/^\/+/, ''));
    if (fs.existsSync(fallbackPath)) filePath = fallbackPath;
  }

  if (!filePath.startsWith(root) && !filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(data);
  });
}

const io = new Server(server, {
  path: '/api/socket.io',
  cors: { origin: true, credentials: true },
});

function compactState(state) {
  const score = Number(state.score ?? state.sc ?? 0) || 0;
  return {
    n: state.name || 'Oyuncu', sk: state.skin || 'default', x: state.x || 0, y: state.y || 0,
    a: state.angle || 0, hp: state.hp ?? 100, mhp: state.maxHp ?? 100, w: state.weapon || 1,
    atk: Boolean(state.isAttacking), k: state.kills || 0, xp: state.xp || 0, g: state.gold || 0,
    sc: score, at: state.axeTier || 0, st: state.swordTier || 0, rk: state.rankId || 0,
    color: state.color || '#8B5E3A', team: state.team || '', clanId: state.clanId || '', clanTag: state.clanTag || '', acc: state.acc || {}, vx: state.vx || 0, vy: state.vy || 0,
    bx: typeof state.buildX === 'number' ? state.buildX : null, by: typeof state.buildY === 'number' ? state.buildY : null,
    sq: state.stateSeq || 0, tm: state.stateAt || Date.now(),
  };
}

function publicClan(clan) {
  return { id: clan.id, name: clan.name, tag: clan.tag, ownerId: clan.ownerId, ownerName: clan.ownerName,
    members: (clan.members || []).map(member => ({ id: member.id, name: member.name })) };
}

function emitClanUpdate(clan) {
  io.to(`clan:${clan.id}`).emit('clan_update', publicClan(clan));
}

function leaveClan(socket, notify = true) {
  const player = players.get(socket.id);
  const clanId = player?.clanId || socket.data.clanId;
  const clan = clanId ? clans.get(clanId) : null;
  if (!clan) return;
  clan.members = (clan.members || []).filter(member => member.id !== socket.id);
  socket.leave(`clan:${clan.id}`);
  if (clan.ownerId === socket.id) {
    clan.ownerId = clan.members[0]?.id || null;
    clan.ownerName = clan.members[0]?.name || null;
    if (!clan.ownerId) clans.delete(clan.id);
  }
  if (player) { player.clanId = ''; player.clanTag = ''; }
  socket.data.clanId = '';
  saveAccountData();
  if (clans.has(clan.id)) emitClanUpdate(clan);
  if (notify) socket.emit('clan_left');
}

function broadcastOnlineCount() {
  io.emit('online_count', io.engine.clientsCount);
}

function relayToOthers(socket, event, payload) {
  socket.broadcast.emit(event, payload);
}

const MAX_MOBS = 8;
const MOB_RADIUS = 32;
const MOB_AGGRO_RANGE = 320;
const MOB_SPEED = 26;
const MOB_WANDER_SPEED = 14;
const MOB_CHASE_TIMEOUT = 5000;

function publicMob(mob) {
  return {
    id: mob.id, x: Math.round(mob.x), y: Math.round(mob.y), vx: Math.round(mob.vx * 10) / 10,
    vy: Math.round(mob.vy * 10) / 10, hp: mob.hp, maxHp: mob.maxHp, radius: mob.radius,
    color: mob.color, outline: mob.outline, shape: mob.shape, eyes: mob.eyes,
    typeName: mob.typeName, dmg: mob.dmg, xpReward: mob.xpReward, goldReward: mob.goldReward,
    isBoss: false,
  };
}

function createMob(anchorX, anchorY) {
  const type = MOB_TYPES[(nextMobId - 1) % MOB_TYPES.length];
  const angle = Math.random() * Math.PI * 2;
  const distance = 260 + Math.random() * 520;
  const maxCoord = 4300;
  const x = Math.max(-maxCoord, Math.min(maxCoord, anchorX + Math.cos(angle) * distance));
  const y = Math.max(-maxCoord, Math.min(maxCoord, anchorY + Math.sin(angle) * distance));
  const mob = {
    id: `mob-${nextMobId++}`, x, y, vx: 0, vy: 0, radius: type.radius || MOB_RADIUS,
    hp: type.hp, maxHp: type.hp, color: type.color, outline: type.outline, shape: type.shape,
    eyes: type.eyes, typeName: type.typeName, dmg: type.dmg, xpReward: 25, goldReward: 5,
    nextAttackAt: 0, wanderAngle: angle, targetId: null, chaseUntil: 0,
  };
  mobs.set(mob.id, mob);
  return mob;
}

function ensureMobs(anchorX = 0, anchorY = 0) {
  while (mobs.size < MAX_MOBS) createMob(anchorX, anchorY);
}

function broadcastMobIds() {
  if (players.size > 0) io.emit('mob_ids', [...mobs.keys()]);
}

// The server owns mob positions so every connected player renders the same world.
setInterval(() => {
  if (players.size === 0) return;
  ensureMobs();
  const changed = [];
  const now = Date.now();
  for (const mob of mobs.values()) {
    let target = mob.targetId ? players.get(mob.targetId) : null;
    if (!target || (target.hp ?? 0) <= 0) {
      mob.targetId = null;
      target = null;
    }
    if (!target) {
      let nearestDistance = MOB_AGGRO_RANGE * MOB_AGGRO_RANGE;
      for (const candidate of players.values()) {
        if ((candidate.hp ?? 0) <= 0) continue;
        const dx = candidate.x - mob.x, dy = candidate.y - mob.y;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) { target = candidate; nearestDistance = distance; }
      }
      if (target) {
        mob.targetId = target.id;
        mob.chaseUntil = now + MOB_CHASE_TIMEOUT;
      }
    }
    const targetDistance = target ? ((target.x - mob.x) ** 2 + (target.y - mob.y) ** 2) : Infinity;
    if (target && now < mob.chaseUntil) {
      const distance = Math.sqrt(targetDistance) || 1;
      mob.vx = (target.x - mob.x) / distance * MOB_SPEED;
      mob.vy = (target.y - mob.y) / distance * MOB_SPEED;
      if (distance < 70 && now >= mob.nextAttackAt) {
        target.hp = Math.max(0, (target.hp ?? 250) - mob.dmg);
        mob.nextAttackAt = now + 900;
        mob.chaseUntil = now + MOB_CHASE_TIMEOUT;
        io.to(target.id).emit('mob_attack', { dmg: mob.dmg, hp: target.hp, typeName: mob.typeName });
        io.emit('players', { [target.id]: compactState(target) });
      }
    } else {
      mob.targetId = null;
      if (Math.random() < 0.04) mob.wanderAngle += (Math.random() - 0.5) * 1.2;
      mob.vx = Math.cos(mob.wanderAngle) * MOB_WANDER_SPEED;
      mob.vy = Math.sin(mob.wanderAngle) * MOB_WANDER_SPEED;
    }
    mob.x += mob.vx;
    mob.y += mob.vy;
    changed.push(publicMob(mob));
  }
  if (changed.length) io.emit('mob_states', changed);
}, 100);

setInterval(broadcastMobIds, 2000);

// Realtime leaderboard update every 3s
setInterval(() => {
  if (players.size === 0) return;
  const list = [...players.values()]
    .map(p => ({ id: p.id, name: p.name || 'Oyuncu', score: p.score || 0, kills: p.kills || 0 }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);
  io.emit('live_lb', list);
}, 3000);

io.on('connection', (socket) => {
  socket.emit('online_count', io.engine.clientsCount);
  socket.on('join', (data = {}) => {
    const initialScore = Number(data.score ?? data.sc ?? 0) || 0;
    const state = { ...data, name: data.name || 'Oyuncu', hp: data.hp ?? 250, maxHp: data.maxHp ?? 250, score: initialScore, sc: initialScore, id: socket.id, clanId: '', clanTag: '', wood: 50, stone: 30, apples: 5 };
    const requestedClan = clans.get(String(data.clanId || ''));
    const clanMember = requestedClan?.members?.find(member => member.name === state.name);
    if (requestedClan && clanMember) {
      clanMember.id = socket.id;
      requestedClan.ownerId = requestedClan.ownerName === state.name ? socket.id : requestedClan.ownerId;
      state.clanId = requestedClan.id;
      state.clanTag = requestedClan.tag;
      socket.join(`clan:${requestedClan.id}`);
    }
    players.set(socket.id, state);
    ensureMobs(state.x || 0, state.y || 0);
    const others = Object.fromEntries([...players].filter(([id]) => id !== socket.id).map(([id, player]) => [id, compactState(player)]));
    socket.emit('welcome', { id: socket.id, players: others, buildings: Object.fromEntries(buildings), worldSeed, resHp: {}, mobs: [...mobs.values()].map(publicMob), isHost: players.size === 1 });
    socket.emit('mob_ids', [...mobs.keys()]);
    socket.broadcast.emit('player_join', { id: socket.id, state: compactState(state) });
    broadcastOnlineCount();
  });

  socket.on('state', (data = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (player.trappedBy) {
      const b = buildings.get(player.trappedBy);
      if (b && (b.hp ?? 100) > 0) {
        data.x = b.x;
        data.y = b.y;
        data.vx = 0;
        data.vy = 0;
      } else {
        player.trappedBy = null;
      }
    }
    for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'isAttacking', 'weapon', 'axeTier', 'swordTier', 'team', 'color', 'skin', 'acc', 'buildX', 'buildY', 'maxHp', 'score', 'sc', 'kills', 'gold', 'wood', 'stone', 'apples', 'xp', 'rankId']) {
      if (data[key] !== undefined) player[key] = data[key];
    }
    const incomingScore = Number(data.score ?? data.sc ?? player.score ?? 0) || 0;
    player.score = Math.max(player.score || 0, incomingScore);
    if (typeof data.sc !== 'undefined') player.sc = Number(data.sc) || 0;
    if (typeof data.seq === 'number' && data.seq > (player.stateSeq || 0)) player.stateSeq = data.seq;
    player.stateAt = Date.now();
    socket.emit('self_state', { x: player.x, y: player.y, hp: player.hp, sc: player.score, g: player.gold, wood: player.wood || 0, stone: player.stone || 0, apples: player.apples || 0, seq: data.seq });
    socket.broadcast.volatile.emit('players', { [socket.id]: compactState(player) });
  });

  socket.on('swing', (data = {}) => {
    const attacker = players.get(socket.id);
    if (!attacker || attacker.hp <= 0) return;
    const weapon = Number(data.weapon) === 2 ? 2 : 1;
    const range = weapon === 2 ? 140 : 128;
    const spread = weapon === 2 ? Math.PI / 3.25 : Math.PI / 2.57;
    const tier = Math.max(0, Math.min(5, Number(weapon === 2 ? data.swordTier : data.axeTier) || 0));
    const multiplier = [1, 1.5, 2.2, 3.5, 5, 8][tier];
    const damage = Math.min(120, Math.round((weapon === 2 ? 30 : 22) * multiplier));
    const angle = Number(data.angle) || 0;
    const attackerX = Number(data.x) || 0, attackerY = Number(data.y) || 0;
    attacker.x = attackerX; attacker.y = attackerY; attacker.angle = angle;
    for (const [targetId, target] of players) {
      if (targetId === socket.id || target.hp <= 0) continue;
      if ((attacker.clanId && attacker.clanId === target.clanId) || (attacker.team && target.team && attacker.team === target.team)) continue;
      const dx = (Number(target.x) || 0) - attackerX, dy = (Number(target.y) || 0) - attackerY;
      if (Math.hypot(dx, dy) > range + 56) continue;
      let difference = Math.abs(Math.atan2(dy, dx) - angle);
      if (difference > Math.PI) difference = Math.PI * 2 - difference;
      if (difference > spread) continue;
      target.hp = Math.max(0, (target.hp ?? 250) - damage);
      io.to(targetId).emit('pvp_hit', { dmg: damage, fromName: attacker.name || 'Oyuncu' });
      io.to(targetId).emit('self_state', { hp: target.hp });
      io.emit('players', { [targetId]: compactState(target) });
      socket.emit('pvp_confirm', { targetId, dmg: damage, targetName: target.name || 'Oyuncu' });
      if (target.hp <= 0) {
        target.kills = target.kills || 0;
        attacker.kills = (attacker.kills || 0) + 1;
        attacker.score = (attacker.score || 0) + 150;
        io.to(targetId).emit('pvp_killed', { byName: attacker.name || 'Oyuncu' });
        socket.emit('pvp_kill_confirm', { targetId, targetName: target.name || 'Oyuncu' });
        io.emit('pvp_kill_feed', { killer: attacker.name || 'Oyuncu', victim: target.name || 'Oyuncu', streak: attacker.kills });
        persistPlayerScore(attacker);
      }
      break;
    }
  });

  socket.on('arrow_hit', (data = {}) => {
    const attacker = players.get(socket.id);
    const target = players.get(data.targetId);
    if (!attacker || !target || attacker.hp <= 0 || target.hp <= 0) return;
    if ((attacker.clanId && attacker.clanId === target.clanId) || (attacker.team && target.team && attacker.team === target.team)) return;
    const damage = Math.max(1, Math.min(140, Number(data.dmg) || 30));
    target.hp = Math.max(0, (target.hp ?? 250) - damage);
    io.to(data.targetId).emit('pvp_hit', { dmg: damage, fromName: attacker.name || 'Oyuncu' });
    io.to(data.targetId).emit('self_state', { hp: target.hp });
    io.emit('players', { [data.targetId]: compactState(target) });
    socket.emit('pvp_confirm', { targetId: data.targetId, dmg: damage, targetName: target.name || 'Oyuncu' });
    if (target.hp <= 0) {
      target.kills = target.kills || 0;
      attacker.kills = (attacker.kills || 0) + 1;
      attacker.score = (attacker.score || 0) + 150;
      io.to(data.targetId).emit('pvp_killed', { byName: attacker.name || 'Oyuncu' });
      socket.emit('pvp_kill_confirm', { targetId: data.targetId, targetName: target.name || 'Oyuncu' });
      io.emit('pvp_kill_feed', { killer: attacker.name || 'Oyuncu', victim: target.name || 'Oyuncu', streak: attacker.kills });
      persistPlayerScore(attacker);
    }
  });

  socket.on('spike_hit', (data = {}) => {
    const owner = players.get(socket.id);
    const target = players.get(data.targetId);
    if (!target || target.hp <= 0) return;
    if (owner && ((owner.clanId && owner.clanId === target.clanId) || (owner.team && target.team && owner.team === target.team))) return;
    const damage = Math.max(1, Math.min(180, Number(data.dmg) || 60));
    target.hp = Math.max(0, (target.hp ?? 250) - damage);
    io.to(data.targetId).emit('pvp_hit', { dmg: damage, fromName: owner?.name || 'Diken' });
    io.to(data.targetId).emit('self_state', { hp: target.hp });
    io.emit('players', { [data.targetId]: compactState(target) });
    socket.emit('spike_dmg_confirm', { targetId: data.targetId, dmg: damage, targetName: target.name || 'Oyuncu' });
    if (target.hp <= 0 && owner) {
      target.kills = target.kills || 0;
      owner.kills = (owner.kills || 0) + 1;
      owner.score = (owner.score || 0) + 150;
      io.to(data.targetId).emit('pvp_killed', { byName: owner.name || 'Diken' });
      socket.emit('pvp_kill_confirm', { targetId: data.targetId, targetName: target.name || 'Oyuncu' });
      io.emit('pvp_kill_feed', { killer: owner.name || 'Diken', victim: target.name || 'Oyuncu', streak: owner.kills });
      persistPlayerScore(owner);
    }
  });

  socket.on('trap_touch', (data = {}) => {
    const owner = players.get(socket.id);
    const target = players.get(data.victimId);
    if (!target || target.hp <= 0) return;
    if (owner && ((owner.clanId && owner.clanId === target.clanId) || (owner.team && target.team && owner.team === target.team))) return;
    target.trappedBy = data.buildingId;
    const b = buildings.get(data.buildingId);
    if (b) { target.x = b.x; target.y = b.y; }
    io.to(data.victimId).emit('trap_caught', { buildingId: data.buildingId });
    io.emit('trap_triggered', { buildingId: data.buildingId, victimId: data.victimId });
  });

  socket.on('trap_owner_push', (data = {}) => {
    if (data.victimId) io.to(data.victimId).emit('trap_victim_push', data);
  });

  socket.on('train_board', () => {
    const player = players.get(socket.id);
    socket.emit('train_boarded', { x: player?.x || 0, y: player?.y || 0 });
    relayToOthers(socket, 'train_boarded', { id: socket.id });
  });

  socket.on('train_exit', () => {
    socket.emit('train_exited');
    relayToOthers(socket, 'train_exited', { id: socket.id });
  });

  socket.on('res_hit', (data = {}) => {
    relayToOthers(socket, 'res_sync', { idx: data.idx, shake: true });
  });

  socket.on('mob_hit_req', (data = {}) => {
    const player = players.get(socket.id);
    const mob = mobs.get(String(data.mobId || ''));
    if (!player || !mob || mob.hp <= 0) return;
    const now = Date.now();
    const hitKey = `${socket.id}:${mob.id}`;
    if (now - (mobHitCooldowns.get(hitKey) || 0) < 100) return;
    mobHitCooldowns.set(hitKey, now);
    const damage = Math.max(1, Math.min(120, Number(data.dmg) || 0));
    mob.hp = Math.max(0, mob.hp - damage);
    if (mob.hp > 0) return;
    mobs.delete(mob.id);
    io.emit('mob_dead', { id: mob.id });
    socket.emit('mob_kill_reward', { xp: mob.xpReward, gold: mob.goldReward, score: Math.round(mob.xpReward * 0.75 + mob.goldReward * 3), typeName: mob.typeName });
  });

  socket.on('mob_trap_hit', (data = {}) => {
    relayToOthers(socket, 'mob_trapped', data);
  });

  socket.on('chat', (data = {}) => io.emit('chat', { name: players.get(socket.id)?.name || 'Oyuncu', msg: String(data.msg || '').slice(0, 200), id: socket.id }));
  socket.on('ping_req', (data) => socket.emit('pong_res', data));
  socket.on('respawn', () => {
    const player = players.get(socket.id);
    if (!player) return;
    player.hp = player.maxHp ?? 250;
    player.x = 0; player.y = 0;
    player.trappedBy = null;
    socket.emit('own_respawn', { x: 0, y: 0 });
    socket.broadcast.emit('player_respawn', { id: socket.id, state: compactState(player) });
    socket.broadcast.emit('players', { [socket.id]: compactState(player) });
  });
  socket.on('eat_apple', () => {
    const player = players.get(socket.id);
    if (player) player.hp = Math.min(player.maxHp ?? 250, (player.hp ?? 0) + 30);
    socket.emit('self_state', { hp: player?.hp ?? 250 });
  });

  for (const event of ['pvp_hit', 'pvp_confirm', 'pvp_kill_confirm', 'pvp_killed', 'player_dead', 'pvp_kill_feed', 'kill_streak', 'server_announce', 'build_limit_reached', 'bounty_update', 'bounty_kill_reward', 'trap_triggered', 'spike_dmg_confirm', 'boost_received', 'res_sync', 'res_respawn', 'mob_spawn', 'mob_states', 'mob_states_b', 'mob_ids', 'mob_kill_reward', 'mob_killed_broadcast', 'mob_update', 'mob_trapped', 'boss_telegraph', 'mob_trap_freed', 'mob_dead', 'mob_attack', 'spike_push', 'trap_victim_push', 'trap_victim_freed', 'train_tick', 'train_state', 'train_hit', 'train_boarded', 'train_board_denied', 'train_exited']) {
    socket.on(event, (data) => relayToOthers(socket, event, { ...(data || {}), fromId: socket.id }));
  }

  const SERVER_BUILD_LIMITS = { 3: 25, 4: 7, 5: 12, 6: 8, 7: 4, 8: 35, 9: 12, 10: 4 };

  socket.on('place_building', (data = {}) => {
    const bType = Number(data.type) || 3;
    const limit = SERVER_BUILD_LIMITS[bType] || 25;
    let ownedCount = 0;
    for (const b of buildings.values()) {
      if (b.ownerId === socket.id && Number(b.type) === bType && (b.hp === undefined || b.hp > 0)) {
        ownedCount++;
      }
    }
    if (ownedCount >= limit) {
      socket.emit('build_limit_reached', { type: bType, count: ownedCount, limit, clientId: data.id });
      return;
    }

    const id = data.id || `${socket.id}-${Date.now()}`;
    const owner = players.get(socket.id);
    const building = { ...data, ownerId: socket.id, ownerClanId: owner?.clanId || '' };
    buildings.set(id, building);
    socket.emit('build_ack', { clientId: data.id, serverId: id });
    io.emit('build', { id, building: { ...building } });
  });
  socket.on('build', (data = {}) => {
    if (data.id) {
      const bType = Number(data.building?.type) || 3;
      const limit = SERVER_BUILD_LIMITS[bType] || 25;
      let ownedCount = 0;
      for (const b of buildings.values()) {
        if (b.ownerId === socket.id && Number(b.type) === bType && (b.hp === undefined || b.hp > 0)) {
          ownedCount++;
        }
      }
      if (ownedCount >= limit) {
        socket.emit('build_limit_reached', { type: bType, count: ownedCount, limit, clientId: data.id });
        return;
      }
      const building = { ...data.building, ownerId: socket.id, ownerClanId: players.get(socket.id)?.clanId || '' };
      buildings.set(data.id, building);
      relayToOthers(socket, 'build', { id: data.id, building });
    }
  });
  socket.on('build_destroy', ({ id } = {}) => {
    buildings.delete(id);
    io.emit('build_destroy', { id });
    io.emit('trap_freed', { buildingId: id });
    for (const p of players.values()) {
      if (p.trappedBy === id) p.trappedBy = null;
    }
  });
  socket.on('building_hit', ({ id, dmg } = {}) => {
    const building = buildings.get(id);
    if (!building) return;
    building.hp = Math.max(0, (building.hp ?? building.maxHp ?? 100) - Math.max(1, Math.min(120, Number(dmg) || 1)));
    io.emit('build_hp_update', { id, hp: building.hp });
    if (building.hp <= 0) {
      buildings.delete(id);
      io.emit('build_destroy', { id });
      io.emit('trap_freed', { buildingId: id });
      for (const p of players.values()) {
        if (p.trappedBy === id) p.trappedBy = null;
      }
    }
  });
  socket.on('build_hp_update', (data = {}) => {
    const building = buildings.get(data.id);
    const attacker = players.get(socket.id);
    if (building && attacker && building.ownerId !== socket.id && building.ownerClanId && building.ownerClanId === attacker.clanId) return;
    relayToOthers(socket, 'build_hp_update', data);
  });
  socket.on('build_tier_update', (data) => relayToOthers(socket, 'build_tier_update', data));
  socket.on('buildings_sync', () => socket.emit('buildings_sync', { buildings: Object.fromEntries(buildings) }));

  socket.on('clan_create', ({ name, tag, playerName } = {}) => {
    const player = players.get(socket.id) || { name: String(playerName || 'Oyuncu').trim() };
    if (!player || player.clanId || socket.data.clanId) return socket.emit('clan_error', { msg: 'Önce mevcut klanından ayrılmalısın.' });
    const cleanName = String(name || '').trim().slice(0, 20);
    const cleanTag = String(tag || '').trim().toUpperCase().replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '').slice(0, 4);
    if (cleanName.length < 3 || cleanTag.length < 2) return socket.emit('clan_error', { msg: 'Klan adı en az 3, etiket en az 2 karakter olmalı.' });
    const id = crypto.randomBytes(4).toString('hex');
    const clan = { id, name: cleanName, tag: cleanTag, ownerId: socket.id, ownerName: player.name, members: [{ id: socket.id, name: player.name }] };
    clans.set(id, clan); saveAccountData(); player.clanId = id; player.clanTag = cleanTag; socket.join(`clan:${id}`);
    socket.data.clanId = id; socket.data.clanName = player.name;
    socket.emit('clan_joined', publicClan(clan));
  });
  socket.on('clan_join', ({ id, playerName } = {}) => {
    const player = players.get(socket.id) || { name: String(playerName || 'Oyuncu').trim() };
    const clan = clans.get(String(id || '').toLowerCase());
    if (!player || !clan) return socket.emit('clan_error', { msg: 'Klan bulunamadı.' });
    if (player.clanId || socket.data.clanId) return socket.emit('clan_error', { msg: 'Zaten bir klandasın.' });
    if (clan.members.length >= 20) return socket.emit('clan_error', { msg: 'Klan dolu.' });
    clan.members.push({ id: socket.id, name: player.name }); player.clanId = clan.id; player.clanTag = clan.tag; socket.join(`clan:${clan.id}`);
    socket.data.clanId = clan.id; socket.data.clanName = player.name;
    saveAccountData(); emitClanUpdate(clan); socket.emit('clan_joined', publicClan(clan));
  });
  socket.on('clan_kick', ({ memberId } = {}) => {
    const player = players.get(socket.id); const clan = clans.get(player?.clanId);
    if (!clan || (clan.ownerId !== socket.id && clan.ownerName !== player.name) || !clan.members.some(member => member.id === memberId)) return;
    const target = players.get(memberId); if (target) { target.clanId = ''; target.clanTag = ''; io.sockets.sockets.get(memberId)?.leave(`clan:${clan.id}`); io.to(memberId).emit('clan_kicked'); }
    clan.members = clan.members.filter(member => member.id !== memberId); saveAccountData(); emitClanUpdate(clan);
  });
  socket.on('clan_leave', () => leaveClan(socket));
  socket.on('clan_get', () => { const clan = clans.get(players.get(socket.id)?.clanId || socket.data.clanId); if (clan) socket.emit('clan_joined', publicClan(clan)); });

  socket.on('party_create', ({ name } = {}) => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    parties.set(code, { code, members: [{ id: socket.id, name: name || 'Oyuncu' }], owner: socket.id });
    socket.join(`party:${code}`);
    socket.emit('party_created', parties.get(code));
  });
  socket.on('party_join', ({ code, name } = {}) => {
    const party = parties.get(String(code || '').toUpperCase());
    if (!party || party.members.length >= 8) return socket.emit('party_error', { msg: 'Parti bulunamadı veya dolu.' });
    if (party.members.some(member => member.id === socket.id)) return socket.emit('party_joined', party);
    party.members.push({ id: socket.id, name: name || 'Oyuncu' });
    socket.join(`party:${party.code}`);
    io.to(`party:${party.code}`).emit('party_update', party);
    socket.emit('party_joined', party);
  });
  socket.on('party_start', () => { for (const room of socket.rooms) if (room.startsWith('party:')) io.to(room).emit('party_game_start', { partyCode: room.slice(6) }); });
  socket.on('party_leave', () => {
    for (const room of socket.rooms) if (room.startsWith('party:')) {
      const party = parties.get(room.slice(6));
      if (party) {
        party.members = party.members.filter(member => member.id !== socket.id);
        if (party.owner === socket.id) party.owner = party.members[0]?.id || null;
        if (!party.members.length) parties.delete(party.code);
        else io.to(room).emit('party_update', party);
      }
      socket.leave(room);
    }
    socket.emit('party_left');
  });

  socket.on('disconnect', () => {
    for (const key of mobHitCooldowns.keys()) if (key.startsWith(`${socket.id}:`)) mobHitCooldowns.delete(key);
    const player = players.get(socket.id);
    leaveClan(socket, false);
    players.delete(socket.id);
    for (const [code, party] of parties) {
      const hadMember = party.members.some(member => member.id === socket.id);
      if (!hadMember) continue;
      party.members = party.members.filter(member => member.id !== socket.id);
      if (party.owner === socket.id) party.owner = party.members[0]?.id || null;
      if (!party.members.length) parties.delete(code);
      else io.to(`party:${code}`).emit('party_update', party);
    }
    socket.broadcast.emit('player_left', { id: socket.id, name: player?.name || 'Oyuncu' });
    broadcastOnlineCount();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ForestBrawl multiplayer server listening on http://localhost:${PORT}`);
});