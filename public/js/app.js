'use strict';
/* Vaza de Boteco — cliente. O servidor é a autoridade; aqui só se desenha o estado e se enviam intenções. */

const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VALS = '4567QJKA23', SUITS = '♦♠♥♣';
const AB = [
  { n: 'Mão Boa', i: '🛡️', d: 'Se errar a aposta, não perde cartas nesta rodada.' },
  { n: 'Carta Marcada', i: '👁️', d: 'Revela uma carta de um adversário.' },
  { n: 'Ás na Manga', i: '🃏', d: 'Troca uma carta da sua mão com a reserva.' },
  { n: 'Pé Frio', i: '🥶', d: 'A próxima carta de um adversário fica fraca.' },
  { n: 'Saideira', i: '🍻', d: 'Sua próxima vaza vencida rende +1 tento.' },
  { n: 'Cerveja Gelada', i: '🧊', d: 'Você ganha 1 carta (máximo 5).' },
];
const AVS = ['🤠', '👵', '🧔', '😎', '🦜', '🐆', '🪗', '🌵'];
const SEATC = ['#12e07f', '#ffd43b', '#4d8bff', '#ff7a45'];
const POS = { 2: ['t'], 3: ['l', 'r'], 4: ['l', 't', 'r'] };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem('vdb.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vdb.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
};

let so = null, S = null, ROOMS = [], ONLINE = 0, CHAT = [], NAME = store.get('nick', '');
let sel = null, unread = 0, chatOpen = false, connected = false, lastWin = 0, rollKey = -1, resKey = '';
let prev = { phase: '', trick: 0, myTurn: false, tk: '', round: 0 };
let dl = { tk: '', total: 0, end: 0 };
const JOIN = new URLSearchParams(location.search).get('sala');
const col = i => SEATC[i % 4];

/* ---------- utilidades de interface ---------- */
function toast(msg, info) {
  const t = document.createElement('div'); t.className = 'toast' + (info ? ' info' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3200);
}
function showModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
const avHtml = (av, c, cls = '') => `<span class="av ${cls}" style="--c:${c}">${AVS[av % AVS.length]}</span>`;
const lives = n => Array.from({ length: 5 }, (_, i) => `<i class="lf ${i < n ? 'on' : ''}"></i>`).join('');
function cardHtml(c) {
  const v = VALS[c.r], s = SUITS[c.s];
  return `<div class="pc ${c.s % 2 === 0 ? 'red' : ''} ${S && c.r === S.man ? 'man' : ''} ${c.w ? 'weak' : ''}"><span class="ci tl"><b>${v}</b><i>${s}</i></span><span class="pip">${s}</span><span class="ci br"><b>${v}</b><i>${s}</i></span></div>`;
}
const backHtml = (o = 0) => `<div class="pc back" style="--o:${o}"></div>`;

function showScreen(name) {
  ['splash', 'browser', 'lobby', 'game'].forEach(n => { $('#' + n).hidden = n !== name; });
  const chat = $('#chat');
  if (name === 'lobby') { $('#lobChat').appendChild(chat); chat.classList.add('docked'); chat.classList.remove('open'); }
  else { document.body.appendChild(chat); chat.classList.remove('docked'); chat.classList.toggle('open', chatOpen && name === 'game'); }
  $('#btnChat').hidden = name !== 'game';
  Aud.setEnergy(name === 'game' ? 1 : 0);
}

/* ---------- conexão ---------- */
function setConn(text, bad) {
  const c = $('#conn'); c.textContent = text; c.classList.toggle('bad', !!bad);
  $('#nameForm button').disabled = !connected;
}
function connect() {
  if (typeof io !== 'function') {
    setConn(location.protocol === 'file:' ? 'Você abriu o arquivo direto. Rode o servidor (npm start) e abra http://localhost:3000.' : 'Servidor não respondeu. Rode npm start e abra o endereço dele.', true);
    return;
  }
  so = io();
  so.on('connect', () => { connected = true; setConn('Conectado ✔'); });
  so.on('connect_error', () => { connected = false; setConn('Sem conexão com o servidor. Rode npm start e abra http://localhost:3000.', true); });
  so.on('disconnect', () => {
    connected = false; S = null; closeRoll(); closeModal(); showScreen('splash');
    setConn('Conexão perdida. Reconectando…', true);
  });
  so.on('rooms', p => { ROOMS = p.list; ONLINE = p.online; renderBrowser(); });
  so.on('state', s => { const old = S; S = s; onState(old); });
  so.on('left', () => { S = null; CHAT = []; closeRoll(); closeModal(); chatOpen = false; showScreen('browser'); renderBrowser(); });
  so.on('err', m => toast(m));
  so.on('chat:hist', list => { CHAT = list.slice(); unread = 0; renderChat(); });
  so.on('chat', m => {
    CHAT.push(m); if (CHAT.length > 80) CHAT.shift(); appendMsg(m);
    const mine = S && m.who === S.players[S.me].name;
    if (!m.sys && !mine) { Aud.play('pop'); if (!chatOpen && S && S.phase !== 'lobby') { unread++; renderUnread(); } }
  });
}

/* ---------- abertura e salas ---------- */
function enterLobbyArea() {
  Aud.init(); Aud.setEnergy(0);
  $('#whoName').textContent = NAME; $('#whoAv').textContent = AVS[[...NAME].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVS.length];
  if (JOIN) { so.emit('join', { code: JOIN, name: NAME }); history.replaceState(null, '', location.pathname); }
  else { showScreen('browser'); so.emit('rooms'); }
}
function renderBrowser() {
  $('#online').textContent = `${ONLINE} online`;
  const ul = $('#roomList');
  if (!ROOMS.length) { ul.innerHTML = '<li class="empty"><b>Nenhuma sala aberta</b><span>Crie a primeira e chame a galera pelo código.</span></li>'; return; }
  ul.innerHTML = ROOMS.map(r => {
    const open = r.phase === 'lobby' && r.count < r.max;
    const dots = Array.from({ length: r.max }, (_, i) => `<i class="${i < r.count ? 'on' : ''}"></i>`).join('');
    const label = r.phase !== 'lobby' ? 'Em jogo' : r.count >= r.max ? 'Lotada' : 'Entrar';
    return `<li class="room"><div class="ri"><b>${esc(r.name)}</b><span>Anfitrião: ${esc(r.host)} · ${r.count}/${r.max}</span></div><div class="dots" aria-hidden="true">${dots}</div><span class="st ${r.phase === 'lobby' ? 'wait' : 'live'}">${r.phase === 'lobby' ? 'Aguardando' : 'Em jogo'}</span><button class="btn ${open ? 'primary' : 'ghost'} sm" data-join="${r.code}" ${open ? '' : 'disabled'}>${label}</button></li>`;
  }).join('');
}

/* ---------- lobby ---------- */
function renderLobby() {
  const P = S.players;
  $('#lobName').textContent = S.room; $('#lobCount').textContent = `${P.length}/${S.max} jogadores`; $('#lobCode').textContent = S.code;
  $('#slots').innerHTML = Array.from({ length: S.max }, (_, i) => {
    const p = P[i];
    if (!p) return '<div class="slot open">Vaga aberta</div>';
    return `<div class="slot ${i === S.me ? 'self' : ''}" style="--c:${col(i)}">${avHtml(p.av, col(i), 'lg')}<div><b>${esc(p.name)}</b><small>${p.host ? '👑 Anfitrião' : p.bot ? '🤖 Bot' : i === S.me ? 'Você' : 'Jogador'}</small></div>${S.host && p.bot ? `<button class="x" data-rm="${i}" aria-label="Remover bot">✕</button>` : ''}</div>`;
  }).join('');
  $('#lobActions').innerHTML = S.host
    ? `<button class="btn ghost" id="addBot" ${P.length >= S.max ? 'disabled' : ''}>+ Bot</button><button class="btn primary big" id="startBtn" ${P.length < 2 ? 'disabled' : ''}>Começar partida</button>`
    : '<small>Aguardando o anfitrião começar…</small>';
}

/* ---------- partida ---------- */
function dirOf(seat) {
  const n = S.players.length, rel = (seat - S.me + n) % n;
  return rel === 0 ? 'b' : POS[n][rel - 1];
}
function onState(old) {
  if (S.phase === 'lobby') { closeRoll(); closeModal(); resKey = ''; rollKey = -1; showScreen('lobby'); renderLobby(); prev = { phase: 'lobby', trick: 0, myTurn: false, tk: '', round: 0 }; return; }
  if (!old || old.phase === 'lobby') { showScreen('game'); sel = null; }
  if (S.tk !== dl.tk) dl = { tk: S.tk, total: S.ms, end: Date.now() + S.ms };
  renderGame();
  const myTurn = (S.phase === 'play' && S.turn === S.me) || (S.phase === 'bid' && S.bidTurn === S.me);
  if (S.phase === 'roll' && prev.round !== S.round) Aud.play('deal');
  if (S.trick.length > prev.trick) Aud.play('card');
  if (myTurn && !prev.myTurn) { Aud.play('turn'); if (navigator.vibrate) navigator.vibrate(60); }
  prev = { phase: S.phase, trick: S.trick.length, myTurn, tk: S.tk, round: S.round };
}
function renderGame() {
  const n = S.players.length, me = S.me, M = S.players[me], dead = M.cards <= 0;
  $('#gRoom').textContent = S.room; $('#gRound').textContent = S.round; $('#gTentos').textContent = S.tentos;
  $('#gMan').textContent = VALS[S.man]; $('#gVira').innerHTML = S.vira ? cardHtml(S.vira) : '';
  const vc = $('#gVira .pc'); if (vc) { vc.style.setProperty('--cw', '34px'); vc.classList.remove('man'); }

  // adversários
  ['l', 't', 'r'].forEach(p => { $('#seat-' + p).innerHTML = ''; });
  for (let k = 1; k < n; k++) {
    const i = (me + k) % n, p = S.players[i], pos = POS[n][k - 1], c = col(i);
    const act = S.turn === i || S.bidTurn === i, isDead = p.cards <= 0;
    const timer = act && dl.total > 0 ? timerHtml() : '';
    const pwr = isDead ? '' : (S.phase === 'roll' && p.abk != null) ? `<span class="pwr" title="${AB[p.abk].n}">${AB[p.abk].i}</span>` : p.used === false ? '<span class="pwr" title="Poder pronto">⚡</span>' : '';
    const rev = S.rev && S.rev.seat === i ? `<div class="rev">${cardHtml(S.rev.c)}</div>` : '';
    const fan = Array.from({ length: p.hand }, (_, j) => backHtml(j - (p.hand - 1) / 2)).join('');
    $('#seat-' + pos).innerHTML = `<div class="sp ${act ? 'act' : ''} ${isDead ? 'dead' : ''}" style="--c:${c}">${avHtml(p.av, c)}<div class="nm">${esc(p.name)}${p.bot ? '<em>BOT</em>' : ''}${p.gone ? '<em>SAIU</em>' : ''}</div><div class="lives">${lives(p.cards)}</div><div class="stat"><span>Aposta <b>${p.bid ?? '–'}</b></span><span>Vazas <b>${p.won}</b></span></div><div class="fan">${fan}</div>${pwr}${rev}${timer}</div>`;
  }
  $$('.seat').forEach(el => { el.hidden = !el.innerHTML; });

  syncTrick(); syncHand(); renderMe(); renderAbility(); renderBid();

  // dica
  const myTurn = S.phase === 'play' && S.turn === me, myBid = S.phase === 'bid' && S.bidTurn === me;
  const nm = i => (S.players[i] ? S.players[i].name : '');
  let msg = '';
  if (dead && S.phase !== 'result') msg = 'Você foi eliminado. Assista ao resto da partida!';
  else if (S.phase === 'roll') msg = 'Sorteando habilidades…';
  else if (S.phase === 'bid') msg = myBid ? 'Sua vez de apostar' : `${nm(S.bidTurn)} está apostando…`;
  else if (S.phase === 'play') msg = myTurn ? 'Sua vez! Escolha uma carta' : S.turn < 0 ? 'Apurando a vaza…' : `Vez de ${nm(S.turn)}`;
  else msg = 'Fim da rodada';
  const h = $('#hint'); h.textContent = msg; h.classList.toggle('yours', myTurn || myBid);

  if (S.phase === 'roll') { closeModal(); if (rollKey !== S.round) startRoll(); }
  else closeRoll();
  if (S.phase === 'result') showResult(); else if (resKey) { resKey = ''; closeModal(); }
  $('#chatLog').innerHTML = S.log.slice().reverse().map(l => `<div class="m">${esc(l)}</div>`).join('');
}
function timerHtml() {
  const left = Math.max(0, dl.end - Date.now());
  if (left <= 0) return '';
  return `<div class="tmr"><i style="animation-duration:${dl.total}ms;animation-delay:-${dl.total - left}ms"></i></div>`;
}
function renderMe() {
  const M = S.players[S.me], c = col(S.me), act = (S.phase === 'play' && S.turn === S.me) || (S.phase === 'bid' && S.bidTurn === S.me);
  const el = $('#me'); el.style.setProperty('--c', c); el.classList.toggle('act', act);
  el.innerHTML = `${avHtml(M.av, c)}<div><b>${esc(M.name)}</b><div class="lives">${lives(M.cards)}</div></div><div class="stat"><span>Aposta <b>${M.bid ?? '–'}</b></span><span>Vazas <b>${M.won}</b></span></div>${act && dl.total > 0 ? timerHtml() : ''}`;
}
function syncTrick() {
  const host = $('#trick'), keep = new Set();
  if (S.winSeat >= 0) lastWin = S.winSeat;
  S.trick.forEach(t => {
    const id = 'tc' + t.p; keep.add(id);
    let el = host.querySelector('#' + id);
    if (!el) {
      el = document.createElement('div'); el.id = id; el.className = 'tcard d-' + dirOf(t.p);
      el.innerHTML = cardHtml(t.c) + `<span class="tlab">${esc(S.players[t.p].name)}</span>`; host.appendChild(el);
    }
    el.classList.toggle('win', S.winSeat === t.p);
    el.classList.toggle('lose', S.winSeat >= 0 && S.winSeat !== t.p);
  });
  $$('.tcard', host).forEach(el => {
    if (keep.has(el.id) || el.classList.contains('out')) return;
    el.id = ''; el.classList.add('out', 'to-' + dirOf(lastWin)); setTimeout(() => el.remove(), 400);
  });
}
function syncHand() {
  const host = $('#hand'), keys = S.hand.map(c => c.r + '-' + c.s), n = S.hand.length;
  $$('.hc', host).forEach(el => { if (!keys.includes(el.dataset.k)) el.remove(); });
  if (sel && !keys.includes(sel)) sel = null;
  S.hand.forEach((c, i) => {
    const k = keys[i]; let el = host.querySelector(`.hc[data-k="${k}"]`);
    if (!el) {
      el = document.createElement('div'); el.className = 'hc deal'; el.dataset.k = k; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.innerHTML = cardHtml(c); el.style.animationDelay = (i * 80) + 'ms';
      el.addEventListener('click', () => onHandClick(el));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHandClick(el); } });
    }
    if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
    const o = i - (n - 1) / 2;
    el.style.setProperty('--o', o); el.style.setProperty('--ty', (Math.abs(o) * 5) + 'px');
    el.firstChild.classList.toggle('man', c.r === S.man);
    el.setAttribute('aria-label', `${VALS[c.r]} de ${['ouros', 'espadas', 'copas', 'paus'][c.s]}`);
    el.classList.toggle('sel', sel === k);
  });
  const myTurn = S.phase === 'play' && S.turn === S.me;
  host.className = myTurn ? 'on' : 'off';
  const pb = $('#playBtn'); pb.hidden = !myTurn; pb.disabled = !sel;
}
function onHandClick(el) {
  if (!(S.phase === 'play' && S.turn === S.me)) { toast('Ainda não é a sua vez.'); return; }
  if (sel === el.dataset.k) return playSel();
  sel = el.dataset.k; Aud.play('click'); syncHand();
}
function playSel() {
  if (!sel) return;
  const idx = S.hand.findIndex(c => c.r + '-' + c.s === sel);
  if (idx < 0) return;
  so.emit('play', idx); sel = null;
}
function renderBid() {
  const box = $('#bidbox');
  if (!(S.phase === 'bid' && S.bidTurn === S.me)) { box.hidden = true; box.innerHTML = ''; return; }
  if (!box.hidden && box.dataset.k === S.tk) return;
  box.dataset.k = S.tk; box.hidden = false;
  box.innerHTML = `<h3>Quantas vazas você faz?</h3><div class="bnums">${Array.from({ length: S.hand.length + 1 }, (_, v) => `<button ${v === S.forbid ? 'disabled' : ''} data-bid="${v}">${v}</button>`).join('')}</div>${S.forbid >= 0 ? `<small>O ${S.forbid} está proibido: a soma das apostas não pode dar ${S.T}.</small>` : ''}`;
}
function renderAbility() {
  const el = $('#abCard'), a = S.ab;
  if (!a || S.players[S.me].cards <= 0) { el.innerHTML = ''; return; }
  const A = AB[a.k];
  el.innerHTML = `<div class="ab ${a.used ? 'used' : ''}"><div class="ab-ic">${A.i}</div><div class="ab-tx"><b>${A.n}</b><span>${A.d}</span></div><button id="abBtn" class="btn gold sm" ${S.canUse ? '' : 'disabled'}>${a.used ? 'Usada' : S.phase === 'play' && S.turn === S.me ? 'Usar poder' : 'Na sua vez'}</button></div>`;
}
function useAbility() {
  if (!S.canUse) return;
  if (S.ab.k === 3) {
    if (S.targets.length > 1) {
      showModal(`<div class="mbox"><h2>Quem fica de pé frio?</h2><div class="tg">${S.targets.map(i => `<button data-target="${i}">${avHtml(S.players[i].av, col(i), 'sm')} ${esc(S.players[i].name)}</button>`).join('')}</div><p><button class="btn ghost sm" data-close>Cancelar</button></p></div>`);
    } else so.emit('ability', S.targets[0]);
  } else so.emit('ability');
}

/* ---------- sorteio de habilidades ---------- */
function startRoll() {
  rollKey = S.round;
  const alive = S.players.map((p, i) => i).filter(i => S.players[i].cards > 0);
  const ov = $('#rollov'); ov.className = ''; ov.hidden = false;
  const L0 = 24, SPIN = 2300, STAG = 650, START = 350;
  ov.innerHTML = `<div class="roll-in"><h2 class="roll-t">Sorteio de habilidades</h2><p class="roll-s">Rodada ${S.round} — cada jogador recebe um poder de uso único</p><div class="reels">${alive.map(i => {
    const p = S.players[i], k = p.abk;
    const L = L0 + (k == null ? 0 : k);
    const items = Array.from({ length: L + 3 }, (_, j) => j === L ? (k == null ? '❔' : AB[k].i) : AB[j % 6].i);
    return `<div class="rl" style="--c:${col(i)}"><div class="rwin" data-i="${i}"><div class="strip" style="transform:translateY(0)">${items.map(s => `<div class="sym">${s}</div>`).join('')}</div></div>${avHtml(p.av, col(i), 'sm')}<div class="nm">${esc(p.name)}${i === S.me ? ' (você)' : ''}</div><div class="rname" id="rn${i}"></div></div>`;
  }).join('')}</div><div class="roll-me" id="rollMe"></div></div>`;
  alive.forEach((i, idx) => {
    const p = S.players[i], k = p.abk, L = L0 + (k == null ? 0 : k), win = $(`.rwin[data-i="${i}"]`, ov), strip = $('.strip', win);
    const delay = START + idx * STAG, rh = () => strip.firstElementChild.offsetHeight;
    strip.classList.add('spin');
    setTimeout(() => {
      if (rollKey !== S.round || $('#rollov').hidden) return;
      strip.style.transition = reduced ? 'none' : `transform ${SPIN}ms cubic-bezier(.12,.75,.18,1)`;
      strip.style.transform = `translateY(${-L * rh()}px)`;
      if (i === S.me && !reduced) for (let j = 1; j <= L; j += 2) setTimeout(() => Aud.play('tick', j), SPIN * (1 - Math.pow(1 - j / L, 1 / 3)));
    }, delay);
    setTimeout(() => {
      if (!$('#rollov') || $('#rollov').hidden) return;
      strip.classList.remove('spin'); win.classList.add('landed');
      const rn = $('#rn' + i);
      if (rn) { rn.innerHTML = k == null ? 'Secreta' : `${AB[k].n}`; rn.classList.add('on'); }
      Aud.play(i === S.me ? 'land' : 'thump');
      if (i === S.me && k != null) { const rm = $('#rollMe'); rm.innerHTML = `Sua habilidade: <b>${AB[k].i} ${AB[k].n}</b> — ${AB[k].d}`; rm.classList.add('on'); }
    }, delay + SPIN + 50);
  });
}
function closeRoll() {
  const ov = $('#rollov'); if (ov.hidden) return;
  ov.classList.add('out'); setTimeout(() => { if (ov.classList.contains('out')) { ov.hidden = true; ov.innerHTML = ''; ov.className = ''; } }, 360);
}

/* ---------- resultado ---------- */
function confetti() {
  if (reduced) return;
  const colors = ['#12e07f', '#ffd43b', '#3b82ff', '#e8352c', '#fff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i'); c.className = 'confetti';
    c.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % 5]};--dx:${(Math.random() - .5) * 240}px;animation-duration:${2.4 + Math.random() * 2.2}s;animation-delay:${Math.random() * .8}s`;
    document.body.appendChild(c); setTimeout(() => c.remove(), 6000);
  }
}
function showResult() {
  const key = `${S.round}:${S.host}:${S.over}`; if (key === resKey) return; resKey = key;
  const mine = S.res.find(r => r.name === S.players[S.me].name);
  const rows = S.res.map((r, i) => `<div class="rr ${r.ok ? 'ok' : r.prot ? 'prot' : 'bad'}" style="animation-delay:${i * 160}ms">${avHtml(r.av, col(Math.max(0, S.players.findIndex(p => p.name === r.name))), '')}<div><b>${esc(r.name)}</b><small>Apostou ${r.bid} · fez ${r.won}</small></div><span class="dl">${r.ok ? '✔ ACERTOU' : r.prot ? '🛡 PROTEGIDO' : `−${r.lost} carta${r.lost > 1 ? 's' : ''}${r.out ? ' · ELIMINADO' : ''}`}</span></div>`).join('');
  const meWon = S.over && S.winner === S.players[S.me].name;
  const head = S.over ? (S.winner ? `<div class="crown">👑</div><h2 class="${meWon ? 'win-t' : ''}">${meWon ? 'Você venceu!' : esc(S.winner) + ' venceu!'}</h2>` : '<h2>Deu empate!</h2>') : '<h2>Fim da rodada</h2>';
  const btn = S.host ? `<button class="btn primary big" data-next>${S.over ? 'Voltar ao lobby' : 'Próxima rodada'}</button>` : '<p>Aguardando o anfitrião…</p>';
  showModal(`<div class="mbox">${head}${rows}<div style="margin-top:14px">${btn}</div></div>`);
  if (mine) Aud.play(mine.ok || mine.prot ? 'win' : 'lose');
  if (meWon) { confetti(); Aud.play('fan'); }
}

/* ---------- chat ---------- */
function msgHtml(m) {
  if (m.sys) return `<div class="m sys">${esc(m.text)}</div>`;
  const own = S && m.who === S.players[S.me].name;
  return `<div class="m ${own ? 'own' : ''}"><span class="mn" style="color:${col(m.av)}">${esc(m.who)}</span>${esc(m.text)}</div>`;
}
function renderChat() { const b = $('#chatMsgs'); b.innerHTML = CHAT.map(msgHtml).join(''); b.scrollTop = b.scrollHeight; renderUnread(); }
function appendMsg(m) {
  const b = $('#chatMsgs'), near = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  b.insertAdjacentHTML('beforeend', msgHtml(m)); if (near || (S && m.who === S.players[S.me].name)) b.scrollTop = b.scrollHeight;
}
function renderUnread() { const u = $('#unread'); u.hidden = unread <= 0; u.textContent = unread > 9 ? '9+' : unread; }
function setChat(open) {
  chatOpen = open; $('#chat').classList.toggle('open', open);
  if (open) { unread = 0; renderUnread(); setTimeout(() => $('#chatIn').focus(), 280); const b = $('#chatMsgs'); b.scrollTop = b.scrollHeight; }
}

/* ---------- ajustes ---------- */
function openSettings() {
  const v = Aud.vols();
  showModal(`<div class="mbox"><h2>Som</h2><div class="sl"><label for="vm">Música</label><input id="vm" type="range" min="0" max="1" step=".05" value="${v.music}"></div><div class="sl"><label for="vs">Efeitos</label><input id="vs" type="range" min="0" max="1" step=".05" value="${v.sfx}"></div><p><button class="btn primary" data-close>Pronto</button></p></div>`);
  $('#vm').oninput = e => { Aud.init(); Aud.setMusic(+e.target.value); store.set('mv', +e.target.value); };
  $('#vs').oninput = e => { Aud.setSfx(+e.target.value); store.set('sv', +e.target.value); };
  $('#vs').onchange = () => Aud.play('click');
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.join) { so.emit('join', { code: t.dataset.join, name: NAME }); Aud.play('click'); }
  else if (t.dataset.bid !== undefined) { so.emit('bid', +t.dataset.bid); Aud.play('click'); }
  else if (t.dataset.target !== undefined) { so.emit('ability', +t.dataset.target); closeModal(); }
  else if (t.dataset.rm !== undefined) so.emit('rmBot', +t.dataset.rm);
  else if (t.dataset.next !== undefined) { so.emit('next'); closeModal(); }
  else if (t.dataset.close !== undefined) closeModal();
  else if (t.dataset.act === 'settings') openSettings();
  else if (t.id === 'abBtn') useAbility();
  else if (t.id === 'playBtn') playSel();
  else if (t.id === 'addBot') so.emit('addBot');
  else if (t.id === 'startBtn') so.emit('start');
  else if (t.id === 'refresh') so.emit('rooms');
  else if (t.id === 'btnChat') setChat(!chatOpen);
  else if (t.id === 'chatClose') setChat(false);
  else if (t.id === 'lobLeave') so.emit('leave');
  else if (t.id === 'btnLeave') { if (confirm('Sair da partida? Um bot assume o seu lugar.')) so.emit('leave'); }
  else if (t.id === 'copyCode') navigator.clipboard?.writeText(S.code).then(() => toast('Código copiado', true));
  else if (t.id === 'copyLink') navigator.clipboard?.writeText(`${location.origin}/?sala=${S.code}`).then(() => toast('Link copiado', true));
  else if (t.closest('.tabs')) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b === t));
    $('#chatMsgs').hidden = t.dataset.t !== 'msgs'; $('#chatLog').hidden = t.dataset.t !== 'log'; $('.quick').hidden = $('#chatForm').hidden = t.dataset.t !== 'msgs';
  } else if (t.closest('.quick')) { so.emit('chat', t.textContent); }
});
$('#nameForm').addEventListener('submit', e => {
  e.preventDefault(); NAME = $('#nick').value.trim().slice(0, 18); if (!NAME || !so) return;
  store.set('nick', NAME); enterLobbyArea();
});
$('#createForm').addEventListener('submit', e => {
  e.preventDefault();
  so.emit('create', { name: NAME, room: $('#cName').value, max: +$('input[name=cMax]:checked').value, priv: $('#cPriv').checked });
});
$('#codeForm').addEventListener('submit', e => { e.preventDefault(); const c = $('#cCode').value.trim(); if (c) so.emit('join', { code: c, name: NAME }); });
$('#chatForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#chatIn'); if (i.value.trim()) { so.emit('chat', i.value); i.value = ''; } });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !e.target.querySelector('[data-next]')) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#modal').hidden && !$('#modal [data-next]')) closeModal(); else if (chatOpen) setChat(false); }
  if (e.key === 'Enter' && S && S.phase === 'play' && sel && document.activeElement === document.body) playSel();
});

/* ---------- início ---------- */
(function init() {
  const mv = store.get('mv', .6), sv = store.get('sv', .8); Aud.setMusic(mv); Aud.setSfx(sv);
  $('#nick').value = NAME;
  $('#bunting').innerHTML = Array.from({ length: 80 }, (_, i) => `<span style="background:${['#0a8f3c', '#ffd400', '#1b4fa8', '#d7261e', '#f4f1e6'][i % 5]}"></span>`).join('');
  $('#bokeh').innerHTML = Array.from({ length: 12 }, (_, i) => { const s = 60 + Math.random() * 120; return `<i style="width:${s}px;height:${s}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;background:${['#12e07f', '#ffd43b', '#3b82ff', '#e8352c'][i % 4]};animation-duration:${14 + Math.random() * 12}s"></i>`; }).join('');
  showScreen('splash'); connect();
})();
