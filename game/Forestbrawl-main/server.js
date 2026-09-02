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
  { shape: 'wolf', color: '#6b4932', outline: '#28170d', eyes: '#ffcc66', typeName: '🐺 Kurt', radius: 46, hp: 300, dmg: 28, speed: 28, wanderSpeed: 14, xpReward: 80, goldReward: 35 },
  { shape: 'scorpion', color: '#4a2818', outline: '#1a0d06', eyes: '#ff4400', typeName: '🦂 Akrep', radius: 52, hp: 520, dmg: 46, speed: 22, wanderSpeed: 12, xpReward: 150, goldReward: 65 },
  { shape: 'bear', color: '#4a2f1b', outline: '#1a1008', eyes: '#ffaa00', typeName: '🐻 Ayı', radius: 65, hp: 950, dmg: 72, speed: 21, wanderSpeed: 11, xpReward: 320, goldReward: 140 },
  { shape: 'spider', color: '#2a1a38', outline: '#0f0814', eyes: '#ff1100', typeName: '🕷️ Örümcek', radius: 48, hp: 380, dmg: 34, speed: 26, wanderSpeed: 13, xpReward: 100, goldReward: 45 },
];
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'forest-data.json');
const authSecret = process.env.AUTH_SECRET || 'forestbrawl-auth-secret-change-me';
let worldSeed = Math.floor(Math.random() * 0x7fffffff);
let nextMobId = 1;
const airdrops = new Map();
let nextAirdropId = 1;
let currentBountyId = null;
let lastAirdropSpawn = 0;

const QUESTS_LIST = [
  { id: 'q_wolf_5', title: 'Kurt Avcısı', desc: '5 vahşi kurt öldür', icon: '🐺', key: 'wolves', target: 5, rewardCoins: 250, rewardXp: 200 },
  { id: 'q_bear_2', title: 'Büyük Ayı Terbiyecisi', desc: '2 orman ayısı alt et', icon: '🐻', key: 'bears', target: 2, rewardCoins: 500, rewardXp: 400 },
  { id: 'q_scorpion_3', title: 'Çöl Akrebi Avcısı', desc: '3 akrep yok et', icon: '🦂', key: 'scorpions', target: 3, rewardCoins: 350, rewardXp: 250 },
  { id: 'q_spider_3', title: 'Mağara Örümceği', desc: '3 zehirli örümcek öldür', icon: '🕷️', key: 'spiders', target: 3, rewardCoins: 300, rewardXp: 220 },
  { id: 'q_pvp_kill_1', title: 'İlk Kan', desc: '1 düşman oyuncu katlet', icon: '⚔️', key: 'kills', target: 1, rewardCoins: 400, rewardXp: 300 },
  { id: 'q_bounty_king_1', title: 'Kral Katili', desc: '1 Altın Kralı devir', icon: '👑', key: 'kingKills', target: 1, rewardCoins: 650, rewardXp: 500 },
  { id: 'q_airdrop_1', title: 'Hazine Avcısı', desc: '1 Airdrop Sandığı aç', icon: '📦', key: 'airdrops', target: 1, rewardCoins: 350, rewardXp: 300 },
  { id: 'q_build_15', title: 'Usta Mimar', desc: '15 savunma yapısı inşa et', icon: '🪵', key: 'buildings', target: 15, rewardCoins: 200, rewardXp: 150 },
  { id: 'q_gold_1000', title: 'Zengin Savaşçı', desc: 'Toplam 1000 Altına ulaş', icon: '💎', key: 'gold', target: 1000, rewardCoins: 500, rewardXp: 400 }
];

const RANKS = [0, 500, 1500, 3500, 7000, 12000, 20000, 35000, 60000, 100000, 180000, 300000];
const RANK_NAMES = ['Tohum', 'Taş', 'Köylü', 'Acemi', 'Savaşçı', 'Muhafız', 'Ateş Efendisi', 'Kristal', 'Fırtına', 'Gece Hanı', 'Efsane', 'Tanrısal'];
const RANK_ICONS = ['🌱', '🪨', '🪵', '🏹', '⚔️', '🛡️', '🔥', '💎', '🌪️', '🌙', '👑', '✨'];

function rankInfo(xp) {
  let rankId = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i]) rankId = i;
    else break;
  }
  const currentMin = RANKS[rankId];
  const isMaxRank = rankId >= RANKS.length - 1;
  const nextMin = isMaxRank ? currentMin : RANKS[rankId + 1];
  const xpProgress = isMaxRank ? 1 : Math.max(0, Math.min(1, (xp - currentMin) / (nextMin - currentMin)));
  const xpToNextRank = isMaxRank ? 0 : Math.max(0, nextMin - xp);
  return {
    rankId,
    level: rankId + 1,
    name: RANK_NAMES[rankId] || 'Tohum',
    icon: RANK_ICONS[rankId] || '🌱',
    nextIcon: RANK_ICONS[Math.min(rankId + 1, RANK_ICONS.length - 1)] || '🌱',
    minXP: currentMin,
    nextMinXP: nextMin,
    xpProgress: Math.round(xpProgress * 100) / 100,
    xpToNextRank
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

let accountData = { users: {}, clans: {}, leaderboard: {}, recentDeaths: [], nextId: 1 };

function loadAccountData() {
  const tryLoadFrom = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content || !content.trim()) return null;
      return JSON.parse(content);
    } catch (e) {
      console.warn(`Failed reading JSON from ${filePath}:`, e.message);
      return null;
    }
  };

  let parsed = tryLoadFrom(dataFile) || tryLoadFrom(dataFile + '.bak');
  if (parsed && typeof parsed === 'object') {
    const rawUsers = parsed.users || {};
    const cleanUsers = {};
    for (const [k, u] of Object.entries(rawUsers)) {
      if (u && typeof u === 'object' && u.username && (u.hash || u.password)) {
        const uKey = String(u.username).trim().toLowerCase();
        cleanUsers[uKey] = {
          id: u.id || 1,
          username: u.username,
          email: u.email || '',
          salt: u.salt || '',
          hash: u.hash || '',
          rankId: rankInfo(Number(u.xp || 0)).rankId,
          xp: Math.max(0, Number(u.xp || 0)),
          coins: Math.max(0, Number(u.coins ?? u.gold ?? 1500)),
          gold: Math.max(0, Number(u.coins ?? u.gold ?? 1500)),
          kills: Math.max(0, Number(u.kills || 0)),
          deaths: Math.max(0, Number(u.deaths || 0)),
          games: Math.max(0, Number(u.gamesPlayed || u.games || 0)),
          gamesPlayed: Math.max(0, Number(u.gamesPlayed || u.games || 0)),
          score: Math.max(0, Number(u.score || 0)),
          bestScore: Math.max(0, Number(u.bestScore || u.score || 0)),
          timePlayed: Math.max(0, Number(u.timePlayed || 0)),
          ownedItems: Array.isArray(u.ownedItems) ? [...new Set(u.ownedItems)] : [],
          equippedItems: (u.equippedItems && typeof u.equippedItems === 'object') ? { ...u.equippedItems } : {},
          questProgress: (u.questProgress && typeof u.questProgress === 'object') ? { ...u.questProgress } : {},
          claimedQuests: Array.isArray(u.claimedQuests) ? [...new Set(u.claimedQuests)] : [],
          createdAt: u.createdAt || Date.now(),
          lastLoginAt: u.lastLoginAt || Date.now()
        };
      }
    }
    accountData = {
      users: cleanUsers,
      clans: parsed.clans || {},
      leaderboard: parsed.leaderboard || {},
      recentDeaths: Array.isArray(parsed.recentDeaths) ? parsed.recentDeaths : [],
      nextId: Math.max(parsed.nextId || 1, Object.keys(cleanUsers).length + 1)
    };
    console.log(`[Database] Loaded ${Object.keys(cleanUsers).length} users and ${Object.keys(accountData.clans).length} clans.`);
  } else {
    console.log('[Database] Starting with fresh database.');
    accountData = { users: {}, clans: {}, leaderboard: {}, recentDeaths: [], nextId: 1 };
  }
}

loadAccountData();
for (const clan of Object.values(accountData.clans || {})) clans.set(clan.id, clan);

let _saveTimeout = null;
function saveAccountData(immediate = false) {
  const doSave = () => {
    try {
      accountData.users = { ...(accountData.users || {}) };
      accountData.clans = Object.fromEntries(clans);
      const dataStr = JSON.stringify(accountData, null, 2);
      const tmpFile = dataFile + '.tmp';
      const bakFile = dataFile + '.bak';

      // Atomic write to tmp file
      fs.writeFileSync(tmpFile, dataStr, 'utf8');

      // Backup current file if exists
      if (fs.existsSync(dataFile)) {
        try { fs.copyFileSync(dataFile, bakFile); } catch(e) {}
      }

      // Rename tmp to dataFile
      fs.renameSync(tmpFile, dataFile);
    } catch (error) {
      try {
        fs.writeFileSync(dataFile, JSON.stringify(accountData, null, 2), 'utf8');
      } catch (err2) {
        console.warn('Could not save account data:', err2.message);
      }
    }
  };

  if (immediate) {
    if (_saveTimeout) { clearTimeout(_saveTimeout); _saveTimeout = null; }
    doSave();
  } else {
    if (!_saveTimeout) {
      _saveTimeout = setTimeout(() => {
        _saveTimeout = null;
        doSave();
      }, 250);
    }
  }
}

// Auto-save every 20 seconds and on process exit
setInterval(() => saveAccountData(true), 20000);
process.on('SIGINT', () => { saveAccountData(true); process.exit(0); });
process.on('SIGTERM', () => { saveAccountData(true); process.exit(0); });
process.on('exit', () => { saveAccountData(true); });

function publicUser(user) {
  const rInfo = rankInfo(user.xp || 0);
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    rankId: rInfo.rankId,
    rankName: rInfo.name,
    rankIcon: rInfo.icon,
    nextRankName: rInfo.rankId < RANKS.length - 1 ? RANK_NAMES[rInfo.rankId + 1] : null,
    nextRankIcon: rInfo.nextIcon,
    level: rInfo.level,
    score: user.score || 0,
    bestScore: user.bestScore || user.score || 0,
    kills: user.kills || 0,
    deaths: user.deaths || 0,
    games: user.games || user.gamesPlayed || 0,
    gamesPlayed: user.gamesPlayed || user.games || 0,
    timePlayed: user.timePlayed || 0,
    xp: user.xp || 0,
    xpProgress: rInfo.xpProgress,
    xpToNextRank: rInfo.xpToNextRank,
    ownedItems: user.ownedItems || [],
    equippedItems: user.equippedItems || {},
    coins: user.coins ?? 1500,
    gold: user.coins ?? 1500,
    questProgress: user.questProgress || {},
    claimedQuests: user.claimedQuests || [],
    quests: QUESTS_LIST
  };
}

function profileResponse(user) {
  const rank = rankInfo(user.xp || 0);
  const nextRank = rank.rankId < RANKS.length - 1 ? { id: rank.rankId + 1, name: RANK_NAMES[rank.rankId + 1], minXP: rank.nextMinXP } : null;
  return {
    user: publicUser(user),
    rank,
    nextRank,
    level: rank.level,
    xp: user.xp || 0,
    xpProgress: rank.xpProgress,
    xpToNextRank: rank.xpToNextRank,
    currentRankIcon: rank.icon,
    nextRankIcon: rank.nextIcon,
    nextRankName: rank.rankId < RANKS.length - 1 ? RANK_NAMES[rank.rankId + 1] : null
  };
}

function usernameKey(username) { return String(username || '').trim().toLowerCase(); }

function createToken(user) {
  const payload = {
    u: user.username,
    id: user.id,
    iat: Date.now()
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(encoded).digest('base64url');
  const token = `${encoded}.${signature}`;
  sessions.set(token, usernameKey(user.username));
  return token;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const directUsername = sessions.get(token);
  if (directUsername && accountData.users[directUsername]) {
    return accountData.users[directUsername];
  }
  if (!token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', authSecret).update(encoded).digest('base64url');
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const decodedStr = Buffer.from(encoded, 'base64url').toString('utf8');
    let username = '';
    if (decodedStr.startsWith('{')) {
      const parsed = JSON.parse(decodedStr);
      username = parsed.u;
    } else {
      username = decodedStr;
    }
    const key = usernameKey(username);
    const user = accountData.users[key];
    if (user) {
      sessions.set(token, key);
      return user;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function getAuthUser(request) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (header || '');
  return verifyToken(token);
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

function recordDeathScore(name, score, gold, kills, timeAlive, userObj) {
  const cleanName = String(name || 'Oyuncu').trim().slice(0, 20) || 'Oyuncu';
  const numScore = Math.max(0, Number(score) || 0);
  const numGold = Math.max(0, Number(gold) || 0);
  const numKills = Math.max(0, Number(kills) || 0);
  const numTime = Math.max(0, Number(timeAlive) || 0);
  const now = Date.now();

  const user = userObj || null;
  if (user && user.username) {
    user.gold = Math.max(user.gold || 0, numGold);
    user.coins = Math.max(user.coins || 0, numGold);
    user.score = Math.max(user.score || 0, numScore);
    user.bestScore = Math.max(user.bestScore || 0, user.score, numScore);
    user.kills = (user.kills || 0) + numKills;
    user.deaths = (user.deaths || 0) + 1;
    user.gamesPlayed = (user.gamesPlayed || user.games || 0) + 1;
    user.games = user.gamesPlayed;
    user.timePlayed = (user.timePlayed || 0) + numTime;
    const runXp = numKills * 60 + Math.min(numTime * 2, 600) + (numScore > 0 ? Math.floor(Math.sqrt(numScore) * 8) : 0);
    user.xp = (user.xp || 0) + runXp;
    user.rankId = rankInfo(user.xp).rankId;
    saveAccountData(true);
  }

  if (!accountData.leaderboard) accountData.leaderboard = {};
  const leadKey = user ? usernameKey(user.username) : usernameKey(cleanName);
  const prev = accountData.leaderboard[leadKey];
  const userXp = user ? user.xp : (prev ? prev.score : numScore);
  const rInfo = rankInfo(userXp);

  const highestScore = prev ? Math.max(prev.score || 0, numScore) : numScore;
  const highestGold = prev ? Math.max(prev.gold || 0, numGold) : numGold;
  const highestKills = prev ? Math.max(prev.kills || 0, numKills) : numKills;

  accountData.leaderboard[leadKey] = {
    name: user ? user.username : cleanName,
    score: highestScore,
    gold: highestGold,
    kills: highestKills,
    rankId: rInfo.rankId,
    rankName: rInfo.name,
    lastScore: numScore,
    lastGold: numGold,
    lastKills: numKills,
    lastTimeAlive: numTime,
    lastDate: now,
    isRegistered: !!(user && user.hash)
  };

  if (!Array.isArray(accountData.recentDeaths)) accountData.recentDeaths = [];
  accountData.recentDeaths.unshift({
    name: user ? user.username : cleanName,
    score: numScore,
    gold: numGold,
    kills: numKills,
    rankId: rInfo.rankId,
    rankName: rInfo.name,
    timeAlive: numTime,
    date: now,
    isRegistered: !!(user && user.hash)
  });
  if (accountData.recentDeaths.length > 50) {
    accountData.recentDeaths.length = 50;
  }

  saveAccountData();
}

function persistPlayerScore(player) {
  if (!player || !player.name) return;
  recordDeathScore(player.name, player.score || player.gold, player.gold, player.kills, 0, player._authUser);
}

function leaderboard(tab) {
  if (tab === 'recent') {
    return (accountData.recentDeaths || []).slice(0, 50);
  }

  const allMap = new Map();
  // 1. Registered users
  for (const user of Object.values(accountData.users || {})) {
    const key = usernameKey(user.username);
    const rInfo = rankInfo(user.xp || 0);
    allMap.set(key, {
      name: user.username,
      score: Math.max(user.bestScore || 0, user.score || 0, user.gold || 0),
      gold: Number(user.gold || user.coins || 0),
      kills: Number(user.kills || 0),
      rankId: rInfo.rankId,
      rankName: rInfo.name,
      lastDate: user.lastLoginAt || Date.now(),
      isRegistered: true
    });
  }

  // 2. Guest leaderboard records
  for (const [key, entry] of Object.entries(accountData.leaderboard || {})) {
    if (!allMap.has(key)) {
      allMap.set(key, { ...entry });
    } else {
      const existing = allMap.get(key);
      existing.score = Math.max(existing.score, entry.score || 0);
      existing.gold = Math.max(existing.gold, entry.gold || 0);
      existing.kills = Math.max(existing.kills, entry.kills || 0);
    }
  }

  const list = [...allMap.values()];
  list.sort((a, b) => (b.score || 0) - (a.score || 0));
  return list.slice(0, 50);
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
    const initXp = Math.max(0, Math.min(50000, Number(body.initialXp) || 0));
    const initCoins = Math.max(1800, Number(body.initialGold || body.initialCoins || 1800));
    const user = {
      id: accountData.nextId++,
      username,
      email: String(body.email || '').trim(),
      ...password,
      rankId: rankInfo(initXp).rankId,
      xp: initXp,
      score: Math.max(0, Number(body.initialScore) || 0),
      kills: Math.max(0, Number(body.initialKills) || 0),
      deaths: 0,
      games: 0,
      gamesPlayed: 0,
      bestScore: Math.max(0, Number(body.initialScore) || 0),
      timePlayed: Math.max(0, Number(body.initialTime) || 0),
      coins: initCoins,
      gold: initCoins,
      ownedItems: Array.isArray(body.initialOwnedItems) ? [...new Set(body.initialOwnedItems)] : [],
      equippedItems: (body.initialEquippedItems && typeof body.initialEquippedItems === 'object') ? { ...body.initialEquippedItems } : {},
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
    accountData.users[key] = user;
    saveAccountData(true);
    sendJson(response, 201, { token: createToken(user), user: publicUser(user) });
    return true;
  }
  if (requestPath === '/api/auth/login' && request.method === 'POST') {
    const user = accountData.users[usernameKey(body.username)];
    const password = String(body.password || '');
    const check = user && user.hash && user.salt && hashPassword(password, user.salt).hash;
    if (!user || !check || !crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(user.hash, 'hex'))) {
      sendJson(response, 401, { error: 'Kullanıcı adı veya şifre hatalı.' });
      return true;
    }
    user.lastLoginAt = Date.now();
    saveAccountData();
    sendJson(response, 200, { token: createToken(user), user: publicUser(user) });
    return true;
  }
  if (requestPath === '/api/auth/me' && request.method === 'GET') {
    const user = getAuthUser(request);
    if (!user) sendJson(response, 401, { error: 'Oturum geçersiz.' });
    else sendJson(response, 200, { user: publicUser(user) });
    return true;
  }
  if (requestPath === '/api/auth/logout' && request.method === 'POST') {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/, '');
    sessions.delete(token);
    sendJson(response, 200, { ok: true });
    return true;
  }
  
  if (requestPath === '/api/leaderboard' && request.method === 'GET') {
    const tab = new URL(request.url, 'http://localhost').searchParams.get('tab') || 'all';
    sendJson(response, 200, {
      entries: leaderboard(tab),
      recent: leaderboard('recent'),
      top: leaderboard('all')
    });
    return true;
  }
  
  if (requestPath === '/api/leaderboard/submit' && request.method === 'POST') {
    const authUser = getAuthUser(request);
    const pName = body.name || (authUser ? authUser.username : 'Oyuncu');
    const pScore = Number(body.score || body.gold || 0);
    const pGold = Number(body.gold || body.coins || 0);
    const pKills = Number(body.kills || 0);
    const pTime = Number(body.timeAlive || body.timePlayed || 0);
    recordDeathScore(pName, pScore, pGold, pKills, pTime, authUser);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const user = getAuthUser(request);
  if (requestPath === '/api/profile' && request.method === 'GET') {
    if (!user) {
      sendJson(response, 401, { error: 'Oturum gerekli.' });
    } else {
      sendJson(response, 200, profileResponse(user));
    }
    return true;
  }
  if (requestPath === '/api/profile/xp' && request.method === 'POST') {
    if (!user) {
      const gainedXp = Math.max(0, Math.min(25000, Number(body.xp) || 0));
      const coinsEarned = Math.max(0, Number(body.coins ?? body.gold) || 0);
      sendJson(response, 200, { ok: true, isGuest: true, gainedXp, coinsEarned });
      return true;
    }
    const gainedXp = Math.max(0, Math.min(25000, Number(body.xp) || 0));
    const previousRank = rankInfo(user.xp || 0).rankId;
    user.xp = (user.xp || 0) + gainedXp;
    user.kills = (user.kills || 0) + Math.max(0, Number(body.kills) || 0);
    user.deaths = (user.deaths || 0) + Math.max(0, Number(body.deaths) || 0);
    user.gamesPlayed = (user.gamesPlayed || user.games || 0) + 1;
    user.games = user.gamesPlayed;
    user.timePlayed = (user.timePlayed || 0) + Math.max(0, Number(body.timePlayed) || 0);
    user.score = Math.max(user.score || 0, Number(body.score) || 0);
    user.bestScore = Math.max(user.bestScore || 0, user.score, Number(body.score) || 0);
    const coinsEarned = Math.max(0, Number(body.coins ?? body.gold) || 0);
    user.coins = (user.coins || 0) + coinsEarned;
    user.gold = user.coins;
    if (body.questProgress && typeof body.questProgress === 'object') {
      user.questProgress = user.questProgress || {};
      for (const [qKey, qVal] of Object.entries(body.questProgress)) {
        user.questProgress[qKey] = (user.questProgress[qKey] || 0) + Math.max(0, Number(qVal) || 0);
      }
    }
    const currentRank = rankInfo(user.xp);
    user.rankId = currentRank.rankId;
    
    recordDeathScore(user.username, user.score, user.coins, user.kills, user.timePlayed, user);
    saveAccountData(true);
    
    sendJson(response, 200, {
      ...profileResponse(user),
      newXp: user.xp,
      rankUp: currentRank.rankId > previousRank,
      newRankName: currentRank.name,
      newRankIcon: currentRank.icon
    });
    return true;
  }
  if (requestPath === '/api/quests/list' && request.method === 'GET') {
    sendJson(response, 200, {
      quests: QUESTS_LIST,
      user: user ? publicUser(user) : null
    });
    return true;
  }
  if (requestPath === '/api/quests/claim' && request.method === 'POST') {
    if (!user) {
      sendJson(response, 401, { error: 'Ödül almak için giriş yapmalısınız.' });
      return true;
    }
    const questId = String(body.questId || '');
    const quest = QUESTS_LIST.find(q => q.id === questId);
    if (!quest) {
      sendJson(response, 400, { error: 'Geçersiz görev.' });
      return true;
    }
    user.claimedQuests = user.claimedQuests || [];
    if (user.claimedQuests.includes(questId)) {
      sendJson(response, 400, { error: 'Bu ödül zaten alınmış.' });
      return true;
    }
    user.questProgress = user.questProgress || {};
    const currentProg = Number(user.questProgress[quest.key] || 0);
    if (currentProg < quest.target) {
      sendJson(response, 400, { error: 'Görev henüz tamamlanmadı.' });
      return true;
    }
    user.claimedQuests.push(questId);
    user.coins = (user.coins || 0) + quest.rewardCoins;
    user.gold = user.coins;
    user.xp = (user.xp || 0) + quest.rewardXp;
    user.rankId = rankInfo(user.xp).rankId;
    saveAccountData(true);
    sendJson(response, 200, {
      ok: true,
      message: `${quest.title} tamamlandı! +${quest.rewardCoins} Altın ve +${quest.rewardXp} XP kazandınız!`,
      claimedQuestId: questId,
      user: publicUser(user)
    });
    return true;
  }
  if (requestPath === '/api/shop/owned' && request.method === 'GET') {
    if (!user) sendJson(response, 401, { error: 'Oturum gerekli.' });
    else sendJson(response, 200, publicUser(user));
    return true;
  }
  if (requestPath === '/api/shop/sync' && request.method === 'POST') {
    if (!user) sendJson(response, 401, { error: 'Oturum gereklidir.' });
    else {
      if (Array.isArray(body.ownedItems)) {
        user.ownedItems = [...new Set([...(user.ownedItems || []), ...body.ownedItems])];
      }
      if (body.equippedItems && typeof body.equippedItems === 'object') {
        user.equippedItems = { ...user.equippedItems, ...body.equippedItems };
      }
      if (typeof body.coins === 'number' && body.coins >= 0) {
        user.coins = Math.max(user.coins || 0, body.coins);
        user.gold = user.coins;
      }
      saveAccountData(true);
      sendJson(response, 200, publicUser(user));
    }
    return true;
  }
  if (requestPath === '/api/shop/equip' && request.method === 'PUT') {
    if (!user) sendJson(response, 401, { error: 'Oturum gereklidir.' });
    else {
      const cat = String(body.category || '');
      const item = String(body.itemId || '');
      if (cat) {
        user.equippedItems = { ...(user.equippedItems || {}), [cat]: item };
        saveAccountData(true);
      }
      sendJson(response, 200, { success: true, equippedItems: user.equippedItems });
    }
    return true;
  }
  if (requestPath === '/api/shop/buy' && request.method === 'POST') {
    if (!user) sendJson(response, 401, { error: 'Oturum gereklidir.' });
    else {
      const itemId = String(body.itemId || '');
      const cost = Math.max(0, Number(body.cost) || 0);
      if (!itemId) {
        sendJson(response, 400, { error: 'Geçersiz eşya.' });
      } else if ((user.coins || 0) < cost) {
        sendJson(response, 400, { error: 'Yetersiz altın.' });
      } else {
        user.coins = (user.coins || 0) - cost;
        user.gold = user.coins;
        user.ownedItems = [...new Set([...(user.ownedItems || []), itemId])];
        saveAccountData(true);
        sendJson(response, 200, { success: true, newCoins: user.coins, ownedItems: user.ownedItems });
      }
    }
    return true;
  }
  sendJson(response, 404, { error: 'API endpoint bulunamadı.' });
  return true;
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

const MAX_MOBS = 32;
const MOB_RADIUS = 36;
const MOB_AGGRO_RANGE = 420;
const MOB_SPEED = 24;
const MOB_WANDER_SPEED = 12;
const MOB_CHASE_TIMEOUT = 6000;

function _makeMulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const serverObstacles = [];
(function initServerObstacles() {
  const rng = _makeMulberry32(0x4F524553);
  const r = 7200 * 0.90 * 0.98;
  for (let i = 0; i < 420; i++) {
    const x = (rng() * 2 - 1) * r;
    const y = (rng() * 2 - 1) * r;
    const typeRoll = rng();
    const radius = (typeRoll < 0.45 ? 42 : typeRoll < 0.75 ? 38 : 32) * 0.72;
    serverObstacles.push({ x, y, radius });
  }
})();

function publicMob(mob) {
  return {
    id: mob.id, x: Math.round(mob.x), y: Math.round(mob.y), vx: Math.round(mob.vx * 10) / 10,
    vy: Math.round(mob.vy * 10) / 10, angle: mob.angle !== undefined ? Math.round(mob.angle * 100) / 100 : 0,
    hp: mob.hp, maxHp: mob.maxHp, radius: mob.radius,
    color: mob.color, outline: mob.outline, shape: mob.shape, eyes: mob.eyes,
    typeName: mob.typeName, dmg: mob.dmg, xpReward: mob.xpReward, goldReward: mob.goldReward,
    state: mob.state || 'idle',
    isBoss: false,
  };
}

function findSafeMobSpawn() {
  const maxCoord = 3600;
  const minMobDist = 200;
  const minPlayerDist = 250;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = Math.round((Math.random() * 2 - 1) * maxCoord);
    const y = Math.round((Math.random() * 2 - 1) * maxCoord);
    let tooClose = false;
    for (const m of mobs.values()) {
      const dx = m.x - x, dy = m.y - y;
      if (dx * dx + dy * dy < minMobDist * minMobDist) { tooClose = true; break; }
    }
    if (!tooClose) {
      for (const p of players.values()) {
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < minPlayerDist * minPlayerDist) { tooClose = true; break; }
      }
    }
    if (!tooClose) return { x, y };
  }
  return { x: Math.round((Math.random() * 2 - 1) * 3200), y: Math.round((Math.random() * 2 - 1) * 3200) };
}

function createMob() {
  const type = MOB_TYPES[(nextMobId - 1) % MOB_TYPES.length];
  const { x, y } = findSafeMobSpawn();
  const angle = Math.random() * Math.PI * 2;
  const mob = {
    id: `mob-${nextMobId++}`, x, y, vx: 0, vy: 0, radius: type.radius || MOB_RADIUS,
    hp: type.hp, maxHp: type.hp, color: type.color, outline: type.outline, shape: type.shape,
    eyes: type.eyes, typeName: type.typeName, dmg: type.dmg,
    speed: type.speed || MOB_SPEED, wanderSpeed: type.wanderSpeed || MOB_WANDER_SPEED,
    xpReward: type.xpReward || 35, goldReward: type.goldReward || 15,
    nextAttackAt: 0, wanderAngle: angle, angle, targetId: null, chaseUntil: 0, state: 'walk',
  };
  mobs.set(mob.id, mob);
  io.emit('mob_spawn', publicMob(mob));
  return mob;
}

function ensureMobs() {
  while (mobs.size < MAX_MOBS) createMob();
}

function publicAirdrop(ad) {
  return {
    id: ad.id,
    x: ad.x,
    y: ad.y,
    hp: ad.hp,
    maxHp: ad.maxHp,
    gold: ad.gold,
    tier: ad.tier || 1,
    spawnedAt: ad.spawnedAt
  };
}

function spawnAirdrop() {
  if (airdrops.size >= 4) return;
  const x = Math.round((Math.random() * 2 - 1) * 3200);
  const y = Math.round((Math.random() * 2 - 1) * 3200);
  const tier = Math.random() < 0.3 ? 2 : 1;
  const gold = tier === 2 ? (350 + Math.floor(Math.random() * 250)) : (180 + Math.floor(Math.random() * 150));
  const hp = tier === 2 ? 500 : 300;
  const ad = {
    id: `airdrop-${nextAirdropId++}`,
    x, y, hp, maxHp: hp, gold, tier,
    spawnedAt: Date.now()
  };
  airdrops.set(ad.id, ad);
  io.emit('airdrop_spawn', publicAirdrop(ad));
}

function updateBounty() {
  if (players.size === 0) {
    if (currentBountyId) { currentBountyId = null; io.emit('bounty_update', { id: null }); }
    return;
  }
  let best = null;
  for (const [id, p] of players) {
    if ((p.hp ?? 0) <= 0) continue;
    const g = Number(p.gold ?? 0);
    const s = Number(p.score ?? 0);
    const val = g * 2 + s;
    if (!best || val > best.val) {
      best = { id, p, val, g };
    }
  }
  if (best && best.g >= 30) {
    if (currentBountyId !== best.id) {
      currentBountyId = best.id;
      io.emit('bounty_update', { id: best.id, name: best.p.name || 'Oyuncu', gold: best.g, bonus: 300 });
    }
  } else if (currentBountyId) {
    currentBountyId = null;
    io.emit('bounty_update', { id: null });
  }
}

function deletePlayerBuildings(playerId) {
  if (!playerId) return;
  const deletedIds = [];
  for (const [id, b] of buildings) {
    if (b.ownerId === playerId || b._ownerId === playerId) {
      buildings.delete(id);
      deletedIds.push(id);
    }
  }
  if (deletedIds.length > 0) {
    for (const id of deletedIds) {
      io.emit('build_destroy', { id });
      io.emit('trap_freed', { buildingId: id });
    }
    for (const p of players.values()) {
      if (p.trappedBy && deletedIds.includes(p.trappedBy)) {
        p.trappedBy = null;
      }
    }
  }
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
    if (mob.trappedBy) {
      const b = buildings.get(mob.trappedBy);
      if (b && (b.hp ?? 100) > 0 && now < (mob.trappedUntil || 0)) {
        mob.vx = 0;
        mob.vy = 0;
        mob.x = mob.trappedX ?? mob.x;
        mob.y = mob.trappedY ?? mob.y;
        changed.push(publicMob(mob));
        continue; // Mob is trapped in place — CANNOT chase or attack distant players!
      } else {
        mob.trappedBy = null;
        mob.trappedUntil = 0;
        io.emit('mob_freed', { mobId: mob.id });
      }
    }

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
      const spd = mob.speed || MOB_SPEED;
      mob.angle = Math.atan2(target.y - mob.y, target.x - mob.x);
      mob.vx = (target.x - mob.x) / distance * spd;
      mob.vy = (target.y - mob.y) / distance * spd;

      // Spider special ranged attack (distance 75 to 300, 5-second cooldown)
      if ((mob.shape === 'spider' || mob.shape === 'orumcek') && distance < 300 && distance > 70 && now >= (mob.nextWebAt || 0)) {
        mob.nextWebAt = now + 5000;
        mob.nextAttackAt = now + 1600;
        mob.chaseUntil = now + MOB_CHASE_TIMEOUT;
        mob.state = 'attack';
        const webDmg = 16;
        io.emit('mob_attack', {
          id: mob.id, targetId: target.id, dmg: webDmg,
          typeName: mob.typeName, shape: mob.shape, isWeb: true,
          x: mob.x, y: mob.y, angle: mob.angle, targetX: target.x, targetY: target.y
        });
      }
      // Melee attack for all mobs
      else if (distance < (mob.radius + 60) && now >= (mob.nextAttackAt || 0) && (now - (target.stateAt || 0) < 600)) {
        target.hp = Math.max(0, (target.hp ?? 250) - mob.dmg);
        mob.nextAttackAt = now + 1600;
        mob.chaseUntil = now + MOB_CHASE_TIMEOUT;
        mob.state = 'attack';
        io.emit('mob_attack', {
          id: mob.id, targetId: target.id, dmg: mob.dmg, hp: target.hp,
          typeName: mob.typeName, shape: mob.shape,
          x: mob.x, y: mob.y, angle: mob.angle, targetX: target.x, targetY: target.y
        });
        io.emit('players', { [target.id]: compactState(target) });
        if (target.hp <= 0) {
          deletePlayerBuildings(target.id);
          io.to(target.id).emit('pvp_killed', { byName: mob.typeName });
          io.emit('player_dead', { id: target.id });
        }
      } else if (mob.state === 'attack' && now >= (mob.nextAttackAt || 0) - 800) {
        mob.state = 'walk';
      }
    } else {
      mob.targetId = null;
      mob.state = 'walk';
      if (Math.random() < 0.06) mob.wanderAngle += (Math.random() - 0.5) * 1.4;
      const wspd = mob.wanderSpeed || MOB_WANDER_SPEED;
      if (mob.x > 3600) { mob.wanderAngle = Math.PI * (0.8 + Math.random() * 0.4); mob.x = 3590; }
      else if (mob.x < -3600) { mob.wanderAngle = Math.random() * 0.4 * Math.PI - 0.2 * Math.PI; mob.x = -3590; }
      if (mob.y > 3600) { mob.wanderAngle = -Math.PI * (0.3 + Math.random() * 0.4); mob.y = 3590; }
      else if (mob.y < -3600) { mob.wanderAngle = Math.PI * (0.3 + Math.random() * 0.4); mob.y = -3590; }
      mob.angle = mob.wanderAngle;
      mob.vx = Math.cos(mob.wanderAngle) * wspd;
      mob.vy = Math.sin(mob.wanderAngle) * wspd;
    }

    mob.x += mob.vx;
    mob.y += mob.vy;

    // Solid collision push-out against resources (trees, rocks, gold)
    for (let oi = 0; oi < serverObstacles.length; oi++) {
      const obs = serverObstacles[oi];
      const ox = mob.x - obs.x, oy = mob.y - obs.y;
      const oDist2 = ox * ox + oy * oy;
      const minODist = mob.radius + obs.radius;
      if (oDist2 < minODist * minODist && oDist2 > 0) {
        const oDist = Math.sqrt(oDist2) || 1;
        const push = minODist - oDist;
        mob.x += (ox / oDist) * push;
        mob.y += (oy / oDist) * push;
        const dot = mob.vx * (ox / oDist) + mob.vy * (oy / oDist);
        if (dot < 0) {
          mob.vx -= dot * (ox / oDist);
          mob.vy -= dot * (oy / oDist);
        }
      }
    }

    // Solid collision push-out against buildings
    for (const b of buildings.values()) {
      if (b.type === 5) continue; // Boost pad allows walkover
      if (b.type === 6 && (b.hp ?? 100) > 0) {
        // Trap capture check
        const tdx = mob.x - b.x, tdy = mob.y - b.y;
        if (tdx * tdx + tdy * tdy < 45 * 45) {
          mob.trappedBy = b.id;
          mob.trappedX = b.x; mob.trappedY = b.y;
          mob.trappedUntil = now + 4000;
          io.emit('mob_trapped', { mobId: mob.id, buildingId: b.id });
          break;
        }
      }
      const bdx = mob.x - b.x, bdy = mob.y - b.y;
      const bdist2 = bdx * bdx + bdy * bdy;
      const minBdist = mob.radius + (b.type === 8 ? 42 : 36);
      if (bdist2 < minBdist * minBdist && bdist2 > 0) {
        const bdist = Math.sqrt(bdist2) || 1;
        const push = minBdist - bdist;
        mob.x += (bdx / bdist) * push;
        mob.y += (bdy / bdist) * push;
        if (b.type === 3 && (b.hp ?? 100) > 0) { // Spike damage
          const spikeTier = b.tier || 0;
          const spikeDmg = [45, 75, 110, 160, 220, 300][spikeTier] || 45;
          mob.hp = Math.max(0, mob.hp - spikeDmg);
          io.emit('mob_update', { id: mob.id, hp: mob.hp, maxHp: mob.maxHp, hitFlash: 8 });
          if (mob.hp <= 0) {
            mobs.delete(mob.id);
            const ownerId = b.ownerId || b._ownerId;
            io.emit('mob_dead', { id: mob.id, killerId: ownerId });
            const owner = players.get(ownerId);
            if (owner) {
              owner.gold = (owner.gold || 0) + (mob.goldReward || 20);
              owner.score = (owner.score || 0) + (mob.goldReward || 20) * 3;
              persistPlayerScore(owner);
            }
          }
          break;
        }
      }
    }

    mob.x = Math.max(-3650, Math.min(3650, mob.x));
    mob.y = Math.max(-3650, Math.min(3650, mob.y));

    changed.push(publicMob(mob));
  }
  if (changed.length) io.emit('mob_states', changed);
}, 100);

setInterval(broadcastMobIds, 2000);

// Realtime leaderboard & bounty updates every 2s
setInterval(() => {
  if (players.size === 0) return;
  updateBounty();
  const list = [...players.values()]
    .map(p => ({
      id: p.id,
      name: p.name || 'Oyuncu',
      score: Number(p.gold ?? 0),
      gold: Number(p.gold ?? 0),
      kills: p.kills || 0
    }))
    .sort((a, b) => (b.gold - a.gold) || (b.score - a.score))
    .slice(0, 10);
  io.emit('live_lb', list);
}, 2000);

// Periodic Airdrop Treasure Chest event (every ~60-90s)
setInterval(() => {
  if (players.size > 0 && (Date.now() - lastAirdropSpawn > 75000 || airdrops.size === 0)) {
    lastAirdropSpawn = Date.now();
    spawnAirdrop();
  }
}, 30000);

// Auto-cleanup ONLY when socket is disconnected or player is dead.
// Never delete buildings or kick when player simply switches tabs!
setInterval(() => {
  if (players.size === 0) return;
  const now = Date.now();
  for (const [id, player] of players) {
    const socket = io.sockets.sockets.get(id);
    const isDisconnected = !socket || !socket.connected;
    const isDead = (player.hp ?? 0) <= 0;
    if (isDead || (isDisconnected && (now - (player.stateAt || now) > 60000))) {
      deletePlayerBuildings(id);
      players.delete(id);
      io.emit('player_dead', { id });
      io.emit('player_left', { id, name: player.name || 'Oyuncu' });
      broadcastOnlineCount();
    }
  }
}, 3000);

io.on('connection', (socket) => {
  socket.emit('online_count', io.engine.clientsCount);

  socket.on('spectate', () => {
    socket.data.isSpectator = true;
    const currentPlayers = Object.fromEntries([...players].map(([id, player]) => [id, compactState(player)]));
    socket.emit('welcome', {
      id: socket.id,
      players: currentPlayers,
      buildings: Object.fromEntries(buildings),
      worldSeed,
      resHp: {},
      mobs: [...mobs.values()].map(publicMob),
      airdrops: [...airdrops.values()].map(publicAirdrop),
      bountyId: currentBountyId,
      isHost: false,
      isSpectator: true
    });
    socket.emit('mob_ids', [...mobs.keys()]);
  });

  socket.on('join', (data = {}) => {
    const authUser = verifyToken(data.token);
    socket.data.authUser = authUser || null;
    const playerName = authUser ? authUser.username : (String(data.name || 'Oyuncu').trim().slice(0, 20) || 'Oyuncu');
    const playerRankId = authUser ? rankInfo(authUser.xp || 0).rankId : Math.max(0, Math.min(11, Number(data.rankId || data.rk || 0)));
    const initialScore = Number(data.score ?? data.sc ?? 0) || 0;
    const state = {
      ...data,
      name: playerName,
      rk: playerRankId,
      rankId: playerRankId,
      hp: data.hp ?? 250,
      maxHp: data.maxHp ?? 250,
      score: initialScore,
      sc: initialScore,
      id: socket.id,
      clanId: '',
      clanTag: '',
      wood: 50,
      stone: 30,
      apples: 5,
      _authUser: authUser
    };
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
    socket.emit('welcome', {
      id: socket.id,
      players: others,
      buildings: Object.fromEntries(buildings),
      worldSeed,
      resHp: {},
      mobs: [...mobs.values()].map(publicMob),
      airdrops: [...airdrops.values()].map(publicAirdrop),
      bountyId: currentBountyId,
      isHost: players.size === 1
    });
    socket.emit('mob_ids', [...mobs.keys()]);
    socket.broadcast.emit('player_join', { id: socket.id, state: compactState(state) });
    broadcastOnlineCount();
    updateBounty();
  });

  socket.on('respawn', () => {
    let player = players.get(socket.id);
    const spawnPt = {
      x: Math.round((Math.random() * 2 - 1) * 3200),
      y: Math.round((Math.random() * 2 - 1) * 3200)
    };
    if (!player) {
      player = {
        id: socket.id,
        name: 'Oyuncu',
        hp: 250,
        maxHp: 250,
        score: 0,
        sc: 0,
        gold: 0,
        kills: 0,
        x: spawnPt.x,
        y: spawnPt.y,
        vx: 0,
        vy: 0,
        angle: 0,
        stateAt: Date.now()
      };
      players.set(socket.id, player);
    } else {
      player.hp = player.maxHp ?? 250;
      player.x = spawnPt.x;
      player.y = spawnPt.y;
      player.vx = 0;
      player.vy = 0;
      player.score = 0;
      player.sc = 0;
      player.kills = 0;
      player.gold = 0;
      player.trappedBy = null;
      player.stateAt = Date.now();
    }
    socket.emit('own_respawn', { x: spawnPt.x, y: spawnPt.y });
    socket.emit('self_state', { x: spawnPt.x, y: spawnPt.y, hp: player.hp, sc: player.score, g: player.gold });
    io.emit('player_respawn', { id: socket.id, state: compactState(player) });
    broadcastOnlineCount();
  });

  socket.on('state', (data = {}) => {
    let player = players.get(socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: data.name || 'Oyuncu',
        hp: data.hp ?? 250,
        maxHp: data.maxHp ?? 250,
        score: Number(data.score ?? data.sc ?? 0) || 0,
        sc: Number(data.score ?? data.sc ?? 0) || 0,
        gold: Number(data.gold ?? 0) || 0,
        kills: Number(data.kills ?? 0) || 0,
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        stateAt: Date.now()
      };
      players.set(socket.id, player);
    }
    if (player.trappedBy) {
      const b = buildings.get(player.trappedBy);
      if (b && (b.hp ?? 100) > 0) {
        data.vx = 0;
        data.vy = 0;
        data.x = player.trappedX ?? data.x;
        data.y = player.trappedY ?? data.y;
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
    socket.emit('self_state', { x: player.x, y: player.y, hp: player.hp, sc: player.score, g: player.gold, seq: data.seq });
    socket.broadcast.volatile.emit('players', { [socket.id]: compactState(player) });
  });

  socket.on('swing', (data = {}) => {
    let attacker = players.get(socket.id);
    if (!attacker) {
      attacker = { id: socket.id, name: 'Oyuncu', hp: 250, maxHp: 250, stateAt: Date.now() };
      players.set(socket.id, attacker);
    }
    if ((attacker.hp ?? 250) <= 0) attacker.hp = 250;
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
        deletePlayerBuildings(targetId);
        target.kills = target.kills || 0;
        attacker.kills = (attacker.kills || 0) + 1;
        attacker.score = (attacker.score || 0) + 150;
        if (currentBountyId && targetId === currentBountyId) {
          const bountyBonus = 300;
          attacker.gold = (attacker.gold || 0) + bountyBonus;
          attacker.score = (attacker.score || 0) + bountyBonus;
          socket.emit('bounty_kill_reward', { name: target.name || 'Oyuncu', bonus: bountyBonus });
          io.emit('bounty_killed_broadcast', { killer: attacker.name || 'Oyuncu', victim: target.name || 'Oyuncu', bonus: bountyBonus });
          currentBountyId = null;
          io.emit('bounty_update', { id: null });
        }
        io.to(targetId).emit('pvp_killed', { byName: attacker.name || 'Oyuncu' });
        io.emit('player_dead', { id: targetId });
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
      deletePlayerBuildings(data.targetId);
      target.kills = target.kills || 0;
      attacker.kills = (attacker.kills || 0) + 1;
      attacker.score = (attacker.score || 0) + 150;
      if (currentBountyId && data.targetId === currentBountyId) {
        const bountyBonus = 300;
        attacker.gold = (attacker.gold || 0) + bountyBonus;
        attacker.score = (attacker.score || 0) + bountyBonus;
        socket.emit('bounty_kill_reward', { name: target.name || 'Oyuncu', bonus: bountyBonus });
        io.emit('bounty_killed_broadcast', { killer: attacker.name || 'Oyuncu', victim: target.name || 'Oyuncu', bonus: bountyBonus });
        currentBountyId = null;
        io.emit('bounty_update', { id: null });
      }
      io.to(data.targetId).emit('pvp_killed', { byName: attacker.name || 'Oyuncu' });
      io.emit('player_dead', { id: data.targetId });
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
      deletePlayerBuildings(data.targetId);
      target.kills = target.kills || 0;
      owner.kills = (owner.kills || 0) + 1;
      owner.score = (owner.score || 0) + 150;
      if (currentBountyId && data.targetId === currentBountyId) {
        const bountyBonus = 300;
        owner.gold = (owner.gold || 0) + bountyBonus;
        owner.score = (owner.score || 0) + bountyBonus;
        socket.emit('bounty_kill_reward', { name: target.name || 'Oyuncu', bonus: bountyBonus });
        io.emit('bounty_killed_broadcast', { killer: owner.name || 'Diken', victim: target.name || 'Oyuncu', bonus: bountyBonus });
        currentBountyId = null;
        io.emit('bounty_update', { id: null });
      }
      io.to(data.targetId).emit('pvp_killed', { byName: owner.name || 'Diken' });
      io.emit('player_dead', { id: data.targetId });
      socket.emit('pvp_kill_confirm', { targetId: data.targetId, targetName: target.name || 'Oyuncu' });
      io.emit('pvp_kill_feed', { killer: owner.name || 'Diken', victim: target.name || 'Oyuncu', streak: owner.kills });
      persistPlayerScore(owner);
    }
  });

  socket.on('airdrop_hit', (data = {}) => {
    const ad = airdrops.get(String(data.id || ''));
    if (!ad || ad.hp <= 0) return;
    const player = players.get(socket.id);
    if (!player || player.hp <= 0) return;
    const dmg = Math.max(1, Math.min(100, Number(data.dmg) || 25));
    ad.hp = Math.max(0, ad.hp - dmg);
    io.emit('airdrop_hit_state', { id: ad.id, hp: ad.hp, maxHp: ad.maxHp });
    if (ad.hp <= 0) {
      airdrops.delete(ad.id);
      player.gold = (player.gold || 0) + ad.gold;
      player.score = (player.score || 0) + ad.gold;
      io.emit('airdrop_opened', {
        id: ad.id,
        x: ad.x,
        y: ad.y,
        openerId: socket.id,
        openerName: player.name || 'Oyuncu',
        gold: ad.gold,
        tier: ad.tier
      });
      persistPlayerScore(player);
    }
  });

  socket.on('trap_touch', (data = {}) => {
    const owner = players.get(socket.id);
    const target = players.get(data.victimId);
    if (!target || target.hp <= 0) return;
    if (owner && ((owner.clanId && owner.clanId === target.clanId) || (owner.team && target.team && owner.team === target.team))) return;
    target.trappedBy = data.buildingId;
    target.trappedX = target.x;
    target.trappedY = target.y;
    target.trappedUntil = Date.now() + 4000;
    target.vx = 0;
    target.vy = 0;
    io.to(data.victimId).emit('trap_caught', { buildingId: data.buildingId });
    io.emit('trap_triggered', { buildingId: data.buildingId, victimId: data.victimId, x: target.x, y: target.y });
  });

  socket.on('mob_trap_hit', (data = {}) => {
    const mob = mobs.get(String(data.mobId || ''));
    if (!mob || mob.hp <= 0) return;
    const b = buildings.get(String(data.buildingId || ''));
    if (b && (b.hp ?? 100) > 0) {
      mob.trappedBy = data.buildingId;
      mob.trappedUntil = Date.now() + 4000;
      mob.trappedX = mob.x;
      mob.trappedY = mob.y;
      mob.vx = 0;
      mob.vy = 0;
      mob.state = 'walk';
      mob.nextAttackAt = Date.now() + 3500; // Freeze attack while trapped
      io.emit('mob_trapped', { mobId: mob.id, buildingId: data.buildingId, x: mob.x, y: mob.y });
    }
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
  socket.on('ping_req', (data) => socket.emit('pong_res', typeof data === 'object' && data ? data : { t: data }));
  socket.on('player_dead', (data = {}) => {
    const pid = data.id || socket.id;
    const player = players.get(pid);
    if (player) {
      recordDeathScore(player.name, player.score || player.gold, player.gold, player.kills, data.timeAlive || 0);
    }
    deletePlayerBuildings(pid);
    relayToOthers(socket, 'player_dead', { id: pid });
  });
  socket.on('player_died', (data = {}) => {
    const pid = data.id || socket.id;
    const player = players.get(pid);
    if (player) {
      recordDeathScore(player.name, player.score || player.gold, player.gold, player.kills, data.timeAlive || 0);
    }
    deletePlayerBuildings(pid);
    relayToOthers(socket, 'player_dead', { id: pid });
  });
  socket.on('respawn', () => {
    const player = players.get(socket.id);
    if (!player) return;
    deletePlayerBuildings(socket.id);
    player.hp = player.maxHp ?? 250;
    const spawnX = Math.round((Math.random() * 2 - 1) * 2200);
    const spawnY = Math.round((Math.random() * 2 - 1) * 2200);
    player.x = spawnX; player.y = spawnY;
    player.trappedBy = null;
    socket.emit('own_respawn', { x: spawnX, y: spawnY });
    socket.broadcast.emit('player_respawn', { id: socket.id, state: compactState(player) });
    socket.broadcast.emit('players', { [socket.id]: compactState(player) });
  });
  socket.on('eat_apple', () => {
    const player = players.get(socket.id);
    if (player) player.hp = Math.min(player.maxHp ?? 250, (player.hp ?? 0) + 30);
    socket.emit('self_state', { hp: player?.hp ?? 250 });
  });

  socket.on('mob_hit_req', (data = {}) => {
    const mobId = String(data.mobId || '');
    const mob = mobs.get(mobId);
    if (!mob || mob.hp <= 0) return;
    let attacker = players.get(socket.id);
    if (!attacker) {
      attacker = { id: socket.id, name: 'Oyuncu', hp: 250, maxHp: 250, stateAt: Date.now() };
      players.set(socket.id, attacker);
    }
    const now = Date.now();
    const hitKey = `${socket.id}:${mob.id}`;
    if (now - (mobHitCooldowns.get(hitKey) || 0) < 40) return;
    mobHitCooldowns.set(hitKey, now);

    const dmg = Math.max(1, Math.min(180, Number(data.dmg) || 25));
    mob.hp = Math.max(0, mob.hp - dmg);
    mob.targetId = socket.id;
    mob.chaseUntil = now + MOB_CHASE_TIMEOUT;

    io.emit('mob_update', { id: mob.id, hp: mob.hp, maxHp: mob.maxHp, hitFlash: 8, targetId: socket.id });

    if (mob.hp <= 0) {
      mobs.delete(mob.id);
      io.emit('mob_dead', { id: mob.id, killerId: socket.id });
      socket.emit('mob_kill_reward', {
        xp: mob.xpReward || 35,
        gold: mob.goldReward || 15,
        score: Math.round((mob.xpReward || 35) * 0.75 + (mob.goldReward || 15) * 3),
        typeName: mob.typeName
      });
      io.emit('mob_killed_broadcast', { typeName: mob.typeName, killerName: attacker.name || 'Oyuncu' });
      setTimeout(() => {
        if (players.size > 0) ensureMobs();
      }, 4000 + Math.random() * 2000);
    }
  });

  for (const event of ['pvp_hit', 'pvp_confirm', 'pvp_kill_confirm', 'pvp_killed', 'pvp_kill_feed', 'kill_streak', 'server_announce', 'build_limit_reached', 'bounty_update', 'bounty_kill_reward', 'trap_triggered', 'spike_dmg_confirm', 'boost_received', 'res_sync', 'res_respawn', 'mob_spawn', 'mob_states', 'mob_states_b', 'mob_ids', 'mob_kill_reward', 'mob_killed_broadcast', 'mob_update', 'mob_trapped', 'boss_telegraph', 'mob_trap_freed', 'mob_dead', 'mob_attack', 'spike_push', 'trap_victim_push', 'trap_victim_freed', 'train_tick', 'train_state', 'train_hit', 'train_boarded', 'train_board_denied', 'train_exited']) {
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
    deletePlayerBuildings(socket.id);
    const player = players.get(socket.id);
    if (player && (player.score > 0 || player.gold > 0 || player.kills > 0)) {
      persistPlayerScore(player);
    }
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