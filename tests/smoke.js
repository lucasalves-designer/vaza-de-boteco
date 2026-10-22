// Teste de ponta a ponta: 2 humanos + 2 bots, lista de salas, sala privada, chat e partida completa.
// Rode com: npm test
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 3457, URL = `http://localhost:${PORT}`;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, FAST: '1' }, stdio: 'inherit' });
const end = (ok, m) => { console.log(ok ? 'OK:' : 'FALHA:', m); srv.kill(); process.exit(ok ? 0 : 1); };
const check = (c, m) => { if (!c) end(false, m); else console.log('  ✔', m); };
setTimeout(() => end(false, 'timeout'), 120000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(30); } return null; };

function human(name) {
  const h = { name, S: null, rooms: [], chat: [], errs: [], sawRoll: false, rolledAll: false, maxHand: 0 };
  h.sock = io(URL);
  h.sock.on('rooms', p => { h.rooms = p.list; });
  h.sock.on('chat', m => h.chat.push(m));
  h.sock.on('err', m => h.errs.push(m));
  h.sock.on('state', s => {
    h.S = s; h.maxHand = Math.max(h.maxHand, s.hand.length);
    if (s.phase === 'roll') { h.sawRoll = true; h.rolledAll = s.players.filter(p => p.cards > 0).every(p => p.abk != null); }
    if (!h.auto) return;
    if (s.phase === 'bid' && s.bidTurn === s.me) { let v = 0; while (v === s.forbid) v++; h.sock.emit('bid', v); }
    else if (s.phase === 'play' && s.turn === s.me) { if (s.canUse && Math.random() < .5) h.sock.emit('ability', s.targets[0]); else h.sock.emit('play', 0); }
    else if (s.phase === 'result' && s.host && !s.over) setTimeout(() => h.sock.emit('next'), 50);
  });
  return h;
}

(async () => {
  await wait(900);
  const A = human('Ana'), B = human('Bruno'), C = human('Carla');
  const E = human('Observador'); // fica no saguão: recebe as atualizações da lista de salas durante a partida
  await until(() => A.sock.connected && B.sock.connected && C.sock.connected && E.sock.connected);

  console.log('Salas');
  check(A.rooms.length === 0, 'lista começa vazia');
  A.sock.emit('create', { name: 'Ana', room: 'Mesa Teste', max: 4, priv: false });
  await until(() => A.S);
  check(A.S.phase === 'lobby' && A.S.host && A.S.room === 'Mesa Teste', 'Ana criou a sala e é anfitriã');
  const listed = await until(() => B.rooms.find(r => r.name === 'Mesa Teste'));
  check(!!listed, 'sala pública aparece na lista de quem está fora dela');
  C.sock.emit('create', { name: 'Carla', room: 'Segredo', max: 2, priv: true });
  await until(() => C.S);
  await wait(400);
  check(!B.rooms.find(r => r.name === 'Segredo'), 'sala privada não aparece na lista');

  B.sock.emit('join', { code: listed.code, name: 'Bruno' });
  await until(() => B.S && B.S.players.length === 2);
  check(B.S.players.length === 2 && !B.S.host, 'Bruno entrou pela lista');
  B.sock.emit('join', { code: 'ZZZZ', name: 'x' }); // já está em sala: ignorado
  const err = human('Intruso'); await until(() => err.sock.connected);
  err.sock.emit('join', { code: 'ZZZZ', name: 'x' });
  check(await until(() => err.errs.length), 'código inválido devolve erro');
  err.sock.close();

  console.log('Chat');
  A.sock.emit('chat', 'oi <b>galera</b>');
  await until(() => B.chat.find(m => !m.sys));
  const m = B.chat.find(m => !m.sys);
  check(m && m.who === 'Ana' && !m.text.includes('<'), 'mensagem chega aos outros e é sanitizada');
  check(!C.chat.find(m => !m.sys), 'chat não vaza para outra sala');
  A.sock.emit('chat', 'rápido demais');
  check(await until(() => A.errs.find(e => /devagar/.test(e))), 'limite de velocidade do chat');

  console.log('Partida');
  A.sock.emit('addBot'); A.sock.emit('addBot');
  await until(() => A.S.players.length === 4);
  check(A.S.players.length === 4, 'anfitrião adicionou 2 bots (4/4)');
  const listed2 = await until(() => B.rooms.length === 0 || (B.S && true));
  A.auto = B.auto = true;
  A.sock.emit('start');
  await until(() => A.sawRoll && B.sawRoll);
  check(A.sawRoll && A.rolledAll, 'fase de sorteio revela a habilidade de todos');
  check(A.S.hand.length === 5, 'cada jogador começa com 5 cartas');
  const over = await until(() => A.S && A.S.over && A.S.phase === 'result', 100000);
  check(!!over, `partida terminou (rodada ${A.S && A.S.round}), vencedor: ${A.S && A.S.winner}`);
  check(A.S.winner && A.maxHand <= 5, 'há um vencedor e ninguém passou de 5 cartas');
  check(E.rooms.some(r => r.name === 'Mesa Teste' && r.phase === 'game'), 'observador no saguão viu a sala "Em jogo" e o servidor continuou de pé');
  check(A.S.res && A.S.res.length >= 2, 'resultado da rodada traz o detalhamento');

  console.log('Saída');
  A.auto = B.auto = false;
  A.sock.emit('next');
  await until(() => A.S.phase === 'lobby');
  check(A.S.phase === 'lobby', 'host volta ao lobby');
  B.sock.emit('leave');
  await until(() => A.S.players.filter(p => !p.bot).length === 1);
  check(A.S.players.filter(p => !p.bot).length === 1, 'Bruno saiu e a sala continua');
  A.sock.emit('leave'); C.sock.emit('leave');
  await wait(600);
  end(true, 'tudo certo');
})();
