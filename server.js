// Vaza de Boteco — servidor autoritativo (Express + Socket.IO).
// Salas, chat e partidas ficam em memória: reiniciar o processo apaga tudo.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_q, s) => s.send('ok'));
const srv = http.createServer(app);
const io = new Server(srv, { maxHttpBufferSize: 1e5 });

// ---------- configuração ----------
const PORT = process.env.PORT || 3000;
const MAXC = 5;          // cartas iniciais (e máximo): cada carta perdida é uma "vida"
const MAXP = 4;          // jogadores por mesa
const TURN_MS = 40000;   // tempo para apostar/jogar antes de entrar no automático
const REVEAL = true;     // true: o sorteio de habilidades é público durante a animação
const D = process.env.FAST ? 8 : 1; // acelera os atrasos nos testes
const AVATARS = 8;
const BOTS = ['Seu Zé', 'Dona Neide', 'Tio Chico', 'Mestre Gonzaga'];
const VALS = '4567QJKA23';

const rooms = new Map();      // código -> sala
const where = new Map();      // socket.id -> código
const lastChat = new Map();   // socket.id -> timestamp da última mensagem

// ---------- utilidades ----------
const rnd = n => Math.floor(Math.random() * n);
const clean = (t, n) => String(t ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const cs = c => VALS[c.r] + '♦♠♥♣'[c.s];
const sortHand = h => h.sort((a, b) => a.r * 4 + a.s - b.r * 4 - b.s);
const pw = (r, c) => c.w ? -100 + c.r * 4 + c.s : (c.r === r.man ? 1000 + c.s : c.r * 4 + c.s);
const newDeck = () => {
  const d = [];
  for (let r = 0; r < 10; r++) for (let s = 0; s < 4; s++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
};
const mkPlayer = (id, name, bot, av) => ({
  id, name, bot, av, host: false, gone: false,
  cards: MAXC, hand: [], bid: null, won: 0, ab: null, prot: false, weak: false, sai: false,
});
const glog = (r, t) => { r.log.unshift(t); r.log.length = Math.min(r.log.length, 30); };
const say = (r, m) => { m.t = Date.now(); r.chat.push(m); if (r.chat.length > 60) r.chat.shift(); io.to(r.code).emit('chat', m); };
const sys = (r, text) => say(r, { sys: true, text });
const nextSeat = (r, from, pred) => {
  const n = r.players.length;
  for (let k = 1; k <= n; k++) { const i = (((from + k) % n) + n) % n; if (pred(i)) return i; }
  return -1;
};
const hasCards = r => i => r.players[i].hand.length > 0;
const alive = r => r.players.filter(p => p.cards > 0).length;
const freeAvatar = r => {
  const used = new Set(r.players.map(p => p.av));
  const free = [...Array(AVATARS).keys()].filter(i => !used.has(i));
  return free.length ? free[rnd(free.length)] : rnd(AVATARS);
};
const uniqueName = (r, name) => {
  let n = name, k = 2;
  while (r.players.some(p => p.name === n)) n = `${name.slice(0, 15)} ${k++}`;
  return n;
};

// ---------- lista de salas ----------
function roomsPayload() {
  const list = [...rooms.values()].filter(r => !r.priv).map(r => ({
    code: r.code, name: r.name, max: r.max, count: r.players.length,
    host: (r.players.find(p => p.host) || {}).name || '', phase: r.phase === 'lobby' ? 'lobby' : 'game', created: r.created,
  })).sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.created - a.created);
  return { list, online: io.engine.clientsCount };
}
let rp = null;
function pushRooms() {
  if (rp) return;
  rp = setTimeout(() => { rp = null; io.to('browse').emit('rooms', roomsPayload()); }, 200);
}

// ---------- rodada ----------
function startRound(r) {
  const P = r.players;
  r.round++; r.played = 0;
  r.dealer = nextSeat(r, r.dealer, i => P[i].cards > 0);
  const d = newDeck();
  P.forEach(p => {
    p.hand = p.cards > 0 ? sortHand(d.splice(0, p.cards)) : [];
    p.bid = null; p.won = 0; p.prot = p.weak = p.sai = false;
    p.ab = p.cards > 0 ? { k: rnd(6), used: false } : null;
  });
  r.vira = d.pop(); r.man = (r.vira.r + 1) % 10; r.reserve = d;
  r.rev = null; r.trick = []; r.result = null; r.res = null; r.turn = -1; r.pw = -1;
  r.T = Math.max(...P.map(p => p.hand.length));
  r.order = [];
  let s = r.dealer;
  for (let k = 0; k < alive(r); k++) { s = nextSeat(r, s, i => P[i].cards > 0); r.order.push(s); }
  r.bidIdx = 0; r.leader = r.order[0];
  r.phase = 'roll'; r.tkey = '';
  clearTimeout(r.rollT);
  r.rollT = setTimeout(() => { if (r.phase === 'roll') { r.phase = 'bid'; upd(r); } }, (4000 + 600 * (alive(r) - 1)) / D);
  glog(r, `Rodada ${r.round}: vira ${cs(r.vira)}, manilha ${VALS[r.man]}.`);
  upd(r);
}

// Soma proibida: o último a apostar não pode fechar exatamente T vazas.
function forb(r) {
  if (r.phase !== 'bid' || r.bidIdx !== r.order.length - 1) return -1;
  const sum = r.players.reduce((a, p) => a + (p.bid ?? 0), 0), f = r.T - sum;
  return f >= 0 && f <= r.players[r.order[r.bidIdx]].hand.length ? f : -1;
}
function doBid(r, seat, v) {
  if (r.phase !== 'bid' || r.order[r.bidIdx] !== seat) return 'Não é sua vez de apostar.';
  const p = r.players[seat];
  if (!Number.isInteger(v) || v < 0 || v > p.hand.length) return 'Aposta inválida.';
  if (v === forb(r)) return `A soma das apostas não pode ser ${r.T}.`;
  p.bid = v; glog(r, `${p.name} apostou ${v}.`); r.bidIdx++;
  if (r.bidIdx === r.order.length) { r.phase = 'play'; startTrick(r); }
  upd(r); return null;
}
function startTrick(r) {
  const n = r.players.length; r.part = [];
  for (let k = 0; k < n; k++) { const i = (r.leader + k) % n; if (r.players[i].hand.length) r.part.push(i); }
  r.trick = []; r.turn = r.part[0]; r.pw = -1;
}
function doPlay(r, seat, i) {
  if (r.phase !== 'play' || r.turn !== seat) return 'Não é sua vez.';
  const p = r.players[seat];
  if (!Number.isInteger(i) || !p.hand[i]) return 'Carta inválida.';
  const c = { ...p.hand.splice(i, 1)[0], w: p.weak };
  p.weak = false; r.trick.push({ p: seat, c }); r.played++;
  if (r.trick.length === r.part.length) {
    r.turn = -1;
    let b = r.trick[0]; r.trick.forEach(t => { if (pw(r, t.c) > pw(r, b.c)) b = t; });
    r.pw = b.p;
    r.timer = setTimeout(() => resolve(r), 1700 / D);
  } else r.turn = r.part[r.trick.length];
  upd(r); return null;
}
function resolve(r) {
  const b = r.trick.find(t => t.p === r.pw), w = r.players[r.pw];
  w.won++; glog(r, `${w.name} levou a vaza com ${cs(b.c)}.`);
  if (w.sai) { w.sai = false; r.tentos++; glog(r, `Saideira! +1 tento (total ${r.tentos}).`); }
  r.trick = []; r.pw = -1;
  const nl = w.hand.length ? r.players.indexOf(w) : nextSeat(r, r.players.indexOf(w), hasCards(r));
  if (nl < 0) return settle(r);
  r.leader = nl; startTrick(r); upd(r);
}
function settle(r) {
  const out = [];
  r.res = [];
  r.players.forEach(p => {
    if (p.cards <= 0 && p.bid == null) return;
    const diff = Math.abs(p.bid - p.won), ok = diff === 0;
    let lost = 0;
    if (ok) out.push(`✅ ${p.name}: apostou ${p.bid}, fez ${p.won}. Acertou!`);
    else if (p.prot) out.push(`🛡️ ${p.name}: apostou ${p.bid}, fez ${p.won}. Mão Boa salvou!`);
    else {
      lost = Math.min(diff, p.cards); p.cards -= lost;
      out.push(`❌ ${p.name}: apostou ${p.bid}, fez ${p.won}. Perde ${lost} carta${lost > 1 ? 's' : ''}${p.cards ? '' : ' e está eliminado'}.`);
    }
    r.res.push({ name: p.name, av: p.av, bid: p.bid, won: p.won, ok, prot: !ok && p.prot, lost, left: p.cards, out: p.cards <= 0 });
  });
  r.result = out; out.slice().reverse().forEach(t => glog(r, t)); r.phase = 'result';
  if (alive(r) <= 1) { r.over = true; const w = r.players.find(p => p.cards > 0); r.winner = w ? w.name : null; }
  upd(r);
}

// ---------- habilidades ----------
const opps = (r, s) => r.players.map((_, i) => i).filter(i => i !== s && r.players[i].hand.length && r.players[i].cards > 0);
function canUse(r, s) {
  const p = r.players[s], a = p.ab;
  if (r.phase !== 'play' || r.turn !== s || !a || a.used) return false;
  if (a.k === 5) return p.cards < MAXC;
  if (a.k === 2) return r.reserve.length > 0 && p.hand.length > 0;
  if (a.k === 1 || a.k === 3) return opps(r, s).length > 0;
  return true;
}
function useAb(r, s, t) {
  if (!canUse(r, s)) return 'Poder indisponível agora.';
  const p = r.players[s], a = p.ab; let m = '';
  if (a.k === 3 && !opps(r, s).includes(t)) return 'Alvo inválido.';
  if (a.k === 0) { p.prot = true; m = 'está protegido (Mão Boa).'; }
  if (a.k === 1) { const o = opps(r, s), q = o[rnd(o.length)], h = r.players[q].hand; r.rev = { by: s, seat: q, c: h[rnd(h.length)] }; m = 'usou Carta Marcada.'; }
  if (a.k === 2) { const i = rnd(p.hand.length), old = p.hand[i]; p.hand[i] = r.reserve.shift(); r.reserve.push(old); sortHand(p.hand); m = 'trocou uma carta com a reserva.'; }
  if (a.k === 3) { r.players[t].weak = true; m = `deixou ${r.players[t].name} de pé frio.`; }
  if (a.k === 4) { p.sai = true; m = 'pediu a saideira.'; }
  if (a.k === 5) { p.cards++; m = 'tomou uma cerveja gelada (+1 carta).'; }
  a.used = true; glog(r, `${['🛡️', '👁️', '🃏', '🥶', '🍻', '🧊'][a.k]} ${p.name} ${m}`); upd(r); return null;
}

// ---------- bots e automático ----------
function botBid(r, s) {
  const p = r.players[s]; let e = 0;
  p.hand.forEach(c => { e += c.r === r.man ? 1 : c.r >= 7 ? .8 : c.r >= 6 ? .4 : .1; });
  const f = forb(r); let b = Math.max(0, Math.min(p.hand.length, Math.round(e)));
  if (b === f) b = b > 0 ? b - 1 : b + 1;
  return b;
}
function botPlay(r, s, auto) {
  const p = r.players[s];
  if (!auto && canUse(r, s) && Math.random() < .4) { const o = opps(r, s); useAb(r, s, o[rnd(o.length)]); }
  const h = p.hand, need = p.bid - p.won;
  const cur = r.trick.length ? Math.max(...r.trick.map(t => pw(r, t.c))) : -1e9;
  const idx = h.map((_, i) => i).sort((a, b) => pw(r, h[a]) - pw(r, h[b]));
  let pick;
  if (need > 0) { pick = idx.find(i => pw(r, h[i]) > cur); if (pick === undefined) pick = idx[0]; }
  else { const lo = idx.filter(i => pw(r, h[i]) < cur); pick = lo.length ? lo[lo.length - 1] : idx[0]; }
  doPlay(r, s, pick);
}
function act(r, actor, key, auto) {
  if (r.tkey !== key) return;
  if (auto) { const m = `${r.players[actor].name} demorou e jogou no automático.`; sys(r, '⏱ ' + m); glog(r, '⏱ ' + m); }
  if (r.phase === 'bid' && r.order[r.bidIdx] === actor) doBid(r, actor, botBid(r, actor));
  else if (r.phase === 'play' && r.turn === actor) botPlay(r, actor, auto);
}
// Agenda quem age agora. A chave só muda quando o turno muda: eventos de chat/poder não reiniciam o relógio.
function tick(r) {
  let actor = -1, key = '';
  if (r.phase === 'bid') { actor = r.order[r.bidIdx]; key = `b${r.round}:${r.bidIdx}`; }
  else if (r.phase === 'play' && r.turn >= 0) { actor = r.turn; key = `p${r.round}:${r.played}`; }
  if (key === r.tkey) return;
  clearTimeout(r.bt); clearTimeout(r.at);
  r.tkey = key; r.deadline = 0;
  if (actor < 0) return;
  if (r.players[actor].bot) r.bt = setTimeout(() => act(r, actor, key, false), (900 + rnd(700)) / D);
  else { r.deadline = Date.now() + TURN_MS; r.at = setTimeout(() => act(r, actor, key, true), TURN_MS / D); }
}

// ---------- estado enviado a cada jogador ----------
function view(r, seat) {
  const P = r.players, me = P[seat], inGame = r.phase !== 'lobby', roll = r.phase === 'roll';
  const actor = r.phase === 'bid' ? r.order[r.bidIdx] : r.turn;
  return {
    code: r.code, room: r.name, max: r.max, priv: r.priv, phase: r.phase, me: seat, host: me.host,
    round: r.round, tentos: r.tentos, T: r.T, over: !!r.over, winner: r.winner || null,
    players: P.map((p, i) => ({
      name: p.name, av: p.av, cards: p.cards, hand: p.hand.length, bid: p.bid, won: p.won,
      used: p.ab ? p.ab.used : null, bot: p.bot, gone: p.gone, host: p.host,
      abk: p.ab && (i === seat || (roll && REVEAL)) ? p.ab.k : null,
    })),
    hand: me.hand, ab: me.ab, canUse: inGame && canUse(r, seat),
    targets: me.ab && me.ab.k === 3 ? opps(r, seat) : [],
    vira: inGame ? r.vira : null, man: r.man, trick: r.trick || [], turn: r.turn, winSeat: r.pw ?? -1,
    bidTurn: r.phase === 'bid' ? r.order[r.bidIdx] : -1,
    forbid: r.phase === 'bid' && r.order[r.bidIdx] === seat ? forb(r) : -1,
    rev: r.rev && r.rev.by === seat ? r.rev : null,
    log: r.log.slice(0, 16), res: r.res, tk: r.tkey || '',
    ms: r.deadline && actor >= 0 && !P[actor].bot ? Math.max(0, r.deadline - Date.now()) : 0,
  };
}
function upd(r) {
  r.players.forEach((p, i) => { if (!p.bot && p.id) io.to(p.id).emit('state', view(r, i)); });
  tick(r); pushRooms();
}

// ---------- entrada e saída de salas ----------
function ensureHost(r) {
  if (r.players.some(p => p.host && !p.bot)) return;
  r.players.forEach(p => { p.host = false; });
  const h = r.players.find(p => !p.bot); if (h) h.host = true;
}
function destroy(r) {
  [r.bt, r.at, r.timer, r.rollT].forEach(clearTimeout);
  rooms.delete(r.code); pushRooms();
}
function leaveRoom(id) {
  const code = where.get(id); if (!code) return;
  where.delete(id);
  const sk = io.sockets.sockets.get(id);
  if (sk) { sk.leave(code); sk.join('browse'); }
  const r = rooms.get(code); if (!r) return;
  const i = r.players.findIndex(p => p.id === id); if (i < 0) return;
  const p = r.players[i];
  if (r.phase === 'lobby') r.players.splice(i, 1);
  else { p.bot = true; p.gone = true; p.id = null; glog(r, `${p.name} saiu; um bot assumiu o lugar.`); }
  sys(r, `${p.name} saiu da mesa.`);
  if (!r.players.some(x => !x.bot)) return destroy(r);
  ensureHost(r); upd(r);
}
function lobbyReset(r) {
  r.players = r.players.filter(p => !p.gone);
  r.players.forEach(p => { p.cards = MAXC; p.hand = []; p.ab = null; p.bid = null; p.won = 0; });
  r.phase = 'lobby'; r.over = false; r.winner = null; r.res = null; r.result = null; r.trick = []; r.tkey = '';
  ensureHost(r); upd(r);
}

io.on('connection', sock => {
  sock.join('browse');
  sock.emit('rooms', roomsPayload());
  pushRooms();
  const R = () => rooms.get(where.get(sock.id));
  const S = r => (r ? r.players.findIndex(p => p.id === sock.id) : -1);
  const err = m => sock.emit('err', m);
  const guard = fn => (...a) => { try { fn(...a); } catch (e) { console.error(e); err('Erro no servidor.'); } };
  const host = r => { const s = S(r); return s >= 0 && r.players[s].host; };
  const enter = (r, p) => {
    where.set(sock.id, r.code); sock.leave('browse'); sock.join(r.code);
    sock.emit('chat:hist', r.chat); sys(r, `${p.name} entrou na mesa.`); upd(r);
  };

  sock.on('rooms', () => sock.emit('rooms', roomsPayload()));

  sock.on('create', guard(o => {
    if (where.has(sock.id) || rooms.size >= 300) return;
    o = o && typeof o === 'object' ? o : { name: o };
    const name = clean(o.name, 18) || 'Jogador';
    let code;
    do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPRSTUVXZ'[rnd(21)]).join(''); } while (rooms.has(code));
    const r = {
      code, name: clean(o.room, 24) || `Mesa do ${name}`, max: Math.min(MAXP, Math.max(2, parseInt(o.max, 10) || MAXP)), priv: !!o.priv,
      players: [], phase: 'lobby', round: 0, tentos: 0, log: [], chat: [], dealer: -1, T: 0, created: Date.now(),
    };
    const p = mkPlayer(sock.id, name, false, rnd(AVATARS)); p.host = true;
    r.players.push(p); rooms.set(code, r); enter(r, p);
  }));

  sock.on('join', guard(o => {
    if (where.has(sock.id)) return;
    o = o && typeof o === 'object' ? o : {};
    const r = rooms.get(String(o.code || '').toUpperCase().trim());
    if (!r) return err('Mesa não encontrada. Confira o código.');
    if (r.phase !== 'lobby') return err('A partida já começou.');
    if (r.players.length >= r.max) return err('Mesa cheia.');
    const p = mkPlayer(sock.id, uniqueName(r, clean(o.name, 18) || 'Jogador'), false, freeAvatar(r));
    r.players.push(p); enter(r, p);
  }));

  sock.on('leave', guard(() => { leaveRoom(sock.id); sock.emit('left'); sock.emit('rooms', roomsPayload()); }));

  sock.on('addBot', guard(() => {
    const r = R(); if (!r || !host(r) || r.phase !== 'lobby' || r.players.length >= r.max) return;
    const nm = BOTS.find(b => !r.players.some(p => p.name === b)) || 'Bot';
    r.players.push(mkPlayer(null, nm, true, freeAvatar(r))); upd(r);
  }));
  sock.on('rmBot', guard(i => {
    const r = R(); if (!r || !host(r) || r.phase !== 'lobby') return;
    if (r.players[i] && r.players[i].bot) { r.players.splice(i, 1); upd(r); }
  }));

  sock.on('start', guard(() => {
    const r = R(); if (!r || !host(r) || r.phase !== 'lobby') return;
    if (r.players.length < 2) return err('Precisa de pelo menos 2 jogadores.');
    r.round = 0; r.tentos = 0; r.log = []; r.dealer = -1; r.over = false; r.winner = null;
    r.players.forEach(p => { p.cards = MAXC; });
    sys(r, 'A partida começou. Boa sorte!'); startRound(r);
  }));
  sock.on('next', guard(() => {
    const r = R(); if (!r || !host(r) || r.phase !== 'result') return;
    r.over ? lobbyReset(r) : startRound(r);
  }));

  sock.on('bid', guard(v => { const r = R(), s = S(r); if (!r || s < 0) return; const e = doBid(r, s, v); if (e) err(e); }));
  sock.on('play', guard(i => { const r = R(), s = S(r); if (!r || s < 0) return; const e = doPlay(r, s, i); if (e) err(e); }));
  sock.on('ability', guard(t => { const r = R(), s = S(r); if (!r || s < 0) return; const e = useAb(r, s, t); if (e) err(e); }));

  sock.on('chat', guard(t => {
    const r = R(), s = S(r); if (!r || s < 0) return;
    const now = Date.now();
    if (now - (lastChat.get(sock.id) || 0) < 500) return err('Calma! Mande as mensagens mais devagar.');
    const text = clean(t, 200); if (!text) return;
    lastChat.set(sock.id, now);
    say(r, { who: r.players[s].name, av: r.players[s].av, text });
  }));

  sock.on('disconnect', () => { leaveRoom(sock.id); lastChat.delete(sock.id); pushRooms(); });
});

srv.listen(PORT, () => console.log(`Vaza de Boteco no ar: http://localhost:${PORT}`));
