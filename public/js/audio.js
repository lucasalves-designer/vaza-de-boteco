'use strict';
/* Trilha e efeitos sintetizados no navegador (Web Audio). Nenhum arquivo de áudio.
   Baião em sol maior, 120 bpm, 16 compassos (A + B): zabumba, triângulo, baixo,
   sanfona (melodia, acordes em contratempo e pad) e reverb de salão. */
const Aud = (() => {
  const A = { ctx: null, music: null, sfx: null, verb: null, nb: null, mv: 0.6, sv: 0.8, energy: 0, nextT: 0, bar: 0, timer: null };
  const mf = n => 440 * Math.pow(2, (n - 69) / 12);
  const S8 = 0.25; // colcheia

  // --- harmonia ---
  const CH = {
    G: { r: 43, f: 50, n: [59, 62, 67] }, C: { r: 48, f: 55, n: [60, 64, 67] }, Em: { r: 40, f: 47, n: [59, 64, 67] },
    Am: { r: 45, f: 52, n: [57, 60, 64] }, D7: { r: 50, f: 57, n: [57, 60, 62, 66] },
  };
  const PROG = ['G', 'G', 'C', 'C', 'G', 'Em', 'D7', 'G', 'C', 'C', 'G', 'G', 'Am', 'D7', 'G', 'D7'];
  // melodia: [nota midi, início (colcheias), duração (colcheias)]
  const MEL = [[
    [[74, 0, 1], [76, 1, 1], [79, 2, 2], [78, 4, 1], [76, 5, 1], [74, 6, 2]],
    [[71, 0, 1], [74, 1, 1], [79, 2, 2], [76, 4, 1], [74, 5, 1], [71, 6, 2]],
    [[72, 0, 1], [76, 1, 1], [79, 2, 2], [76, 4, 1], [72, 5, 1], [76, 6, 2]],
    [[72, 0, 2], [74, 2, 1], [76, 3, 1], [74, 4, 2], [72, 6, 2]],
    [[71, 0, 1], [74, 1, 1], [79, 2, 2], [78, 4, 1], [74, 5, 1], [71, 6, 2]],
    [[71, 0, 1], [76, 1, 1], [79, 2, 2], [76, 4, 1], [71, 5, 1], [67, 6, 2]],
    [[74, 0, 1], [72, 1, 1], [69, 2, 1], [66, 3, 1], [69, 4, 2], [72, 6, 2]],
    [[67, 0, 2], [71, 2, 2], [74, 4, 4]],
  ], [
    [[79, 0, 1], [79, 1, 1], [79, 2, 1], [76, 3, 1], [72, 4, 2], [76, 6, 2]],
    [[76, 0, 1], [79, 1, 1], [84, 2, 2], [79, 4, 2], [76, 6, 2]],
    [[79, 0, 1], [79, 1, 1], [79, 2, 1], [74, 3, 1], [71, 4, 2], [74, 6, 2]],
    [[76, 0, 1], [74, 1, 1], [71, 2, 2], [74, 4, 2], [79, 6, 2]],
    [[76, 0, 1], [76, 1, 1], [76, 2, 1], [72, 3, 1], [69, 4, 2], [72, 6, 2]],
    [[78, 0, 1], [78, 1, 1], [78, 2, 1], [74, 3, 1], [72, 4, 2], [69, 6, 2]],
    [[71, 0, 1], [74, 1, 1], [79, 2, 2], [74, 4, 2], [71, 6, 2]],
    [[69, 0, 1], [72, 1, 1], [74, 2, 1], [78, 3, 1], [81, 4, 2], [78, 6, 2]],
  ]];

  // --- ligações ---
  function impulse(ctx, sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function toMusic(node, wet) {
    node.connect(A.music);
    if (wet) { const g = A.ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(A.verb); }
  }
  function toSfx(node) { node.connect(A.sfx); }
  function nz(t, d, type, freq, q, v, music, wet) {
    const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = A.nb; f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); music ? toMusic(g, wet || 0) : toSfx(g);
    s.start(t, Math.random() * 1.5); s.stop(t + d + 0.02);
  }
  function tone(t, f0, f1, d, v, type, music, wet) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d * 0.8);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); music ? toMusic(g, wet || 0) : toSfx(g); o.start(t); o.stop(t + d + 0.03);
  }

  // --- instrumentos ---
  function sanfona(f, t, d, v) {
    const c = A.ctx, g = c.createGain(), lp = c.createBiquadFilter(), pk = c.createBiquadFilter(), trem = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 3400; pk.type = 'peaking'; pk.frequency.value = 1150; pk.gain.value = 6; pk.Q.value = 0.8;
    [-9, 0, 9].forEach((cents, i) => {
      const o = c.createOscillator(), og = c.createGain();
      o.type = i === 1 ? 'square' : 'sawtooth'; o.frequency.value = f; o.detune.value = cents; og.gain.value = i === 1 ? 0.35 : 0.5;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + d + 0.1);
    });
    const lfo = c.createOscillator(), lg = c.createGain(); // fole: leve tremolo
    trem.gain.value = 0.86; lfo.frequency.value = 5.4; lg.gain.value = 0.12; lfo.connect(lg); lg.connect(trem.gain); lfo.start(t); lfo.stop(t + d + 0.1);
    lp.connect(pk); pk.connect(trem); trem.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.028);
    g.gain.setValueAtTime(v * 0.9, t + Math.max(0.04, d - 0.09)); g.gain.linearRampToValueAtTime(0.0001, t + d);
    toMusic(g, 0.26);
  }
  const zabLow = (t, v) => { tone(t, 135, 52, 0.34, v, 'sine', true, 0.08); nz(t, 0.05, 'lowpass', 420, 1, v * 0.5, true, 0); };
  const zabHigh = (t, v) => { tone(t, 260, 170, 0.13, v, 'triangle', true, 0.06); nz(t, 0.06, 'bandpass', 1500, 1.2, v * 0.8, true, 0.05); };
  function tri(t, open, v) {
    nz(t, open ? 0.17 : 0.035, 'highpass', open ? 6500 : 7600, 0.7, v, true, open ? 0.25 : 0.04);
    if (open) { tone(t, 5400, 5400, 0.2, v * 0.18, 'sine', true, 0.2); tone(t, 7300, 7300, 0.16, v * 0.12, 'sine', true, 0.2); }
  }
  function bass(f, t, d, v) {
    const c = A.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f / 2; lp.type = 'lowpass'; lp.frequency.value = 520;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp); o2.connect(lp); lp.connect(g); toMusic(g, 0.05); o.start(t); o2.start(t); o.stop(t + d + 0.03); o2.stop(t + d + 0.03);
  }

  function schedBar(t, bar, loop) {
    const E = A.energy, ch = CH[PROG[bar]], vs = 0.6 + 0.4 * E;
    for (let s = 0; s < 16; s++) { // triângulo em semicolcheias, aberto no contratempo
      const open = s % 4 === 2, acc = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.7 : 0.45;
      tri(t + s * S8 / 2, open, (open ? 0.05 : 0.026) * acc * vs);
    }
    [0, 3, 4].forEach(st => zabLow(t + st * S8, (st === 0 ? 0.5 : 0.36) * vs));       // baião: 1 · e do 2 · 3
    [2, 6].forEach(st => zabHigh(t + st * S8, 0.28 * vs));
    if (bar % 4 === 3) zabHigh(t + 7 * S8, 0.2 * vs);
    [[0, ch.r], [3, ch.f], [4, ch.r], [6, ch.f]].forEach(([st, n]) => bass(mf(n), t + st * S8, S8 * 0.9, 0.3 * vs));
    [2, 6].forEach(st => ch.n.forEach(n => sanfona(mf(n), t + st * S8, S8 * 0.55, 0.02 * vs)));
    ch.n.forEach(n => sanfona(mf(n - 12), t, S8 * 7.6, 0.011));
    if (A.bar >= 2) {
      const sec = bar < 8 ? 0 : 1;
      if (E > 0 || sec === 0) {
        MEL[sec][bar % 8].forEach(([n, st, d]) => {
          const tt = t + st * S8;
          if (d >= 2) sanfona(mf(n - 2), tt - 0.07, 0.07, 0.028); // apojatura
          sanfona(mf(n), tt, d * S8 * 0.96, 0.068);
          if (loop % 2 === 1) sanfona(mf(n - 12), tt, d * S8 * 0.96, 0.028);
        });
      }
    }
  }
  function sched() {
    const c = A.ctx; if (!c || c.state !== 'running') return;
    if (A.mv <= 0.001) { A.nextT = c.currentTime + 0.2; return; }
    while (A.nextT < c.currentTime + 0.7) { schedBar(A.nextT, A.bar % 16, Math.floor(A.bar / 16)); A.nextT += 8 * S8; A.bar++; }
  }

  // --- efeitos ---
  const FX = {
    click: t => tone(t, 780, 520, 0.05, 0.12, 'triangle'),
    pop: t => { tone(t, 620, 980, 0.07, 0.1, 'sine'); },
    card: t => { nz(t, 0.07, 'bandpass', 2200, 0.9, 0.5); tone(t, 170, 90, 0.09, 0.3, 'sine'); },
    deal: t => { for (let i = 0; i < 5; i++) nz(t + i * 0.07, 0.05, 'bandpass', 2600, 1, 0.3); },
    tick: (t, i) => tone(t, 700 + (i || 0) * 18, 700 + (i || 0) * 18, 0.03, 0.14, 'square'),
    land: t => { [67, 71, 74, 79].forEach((n, i) => { tone(t + i * 0.07, mf(n + 12), mf(n + 12), 0.5, 0.14, 'triangle'); }); nz(t, 0.25, 'highpass', 5000, 0.7, 0.18); },
    thump: t => tone(t, 150, 60, 0.2, 0.3, 'sine'),
    turn: t => { tone(t, mf(88), mf(88), 0.18, 0.1, 'sine'); tone(t + 0.1, mf(83), mf(83), 0.25, 0.1, 'sine'); },
    win: t => { [67, 71, 74, 79, 83].forEach((n, i) => tone(t + i * 0.08, mf(n), mf(n), 0.35, 0.14, 'triangle')); },
    lose: t => { tone(t, 260, 70, 0.5, 0.22, 'sawtooth'); },
    fan: t => { [67, 71, 74, 79, 74, 79, 83, 86].forEach((n, i) => tone(t + i * 0.09, mf(n), mf(n), 0.4, 0.14, 'triangle')); },
  };

  return {
    init() {
      if (A.ctx) { A.ctx.resume(); return; }
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const c = A.ctx = new C();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(c.destination);
      const master = c.createGain(); master.gain.value = 0.9; master.connect(comp);
      A.music = c.createGain(); A.music.gain.value = A.mv * 1.5; A.music.connect(master);
      A.sfx = c.createGain(); A.sfx.gain.value = A.sv; A.sfx.connect(master);
      const rv = c.createConvolver(); rv.buffer = impulse(c, 1.9, 2.6);
      const wet = c.createGain(); wet.gain.value = 0.8; A.verb = c.createGain(); A.verb.connect(rv); rv.connect(wet); wet.connect(A.music);
      A.nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = A.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      A.nextT = c.currentTime + 0.15; A.timer = setInterval(sched, 200);
      document.addEventListener('visibilitychange', () => { if (document.hidden) c.suspend(); else { c.resume(); A.nextT = c.currentTime + 0.2; } });
    },
    ready: () => !!A.ctx,
    setMusic(v) { A.mv = v; if (A.music) A.music.gain.setTargetAtTime(v * 1.5, A.ctx.currentTime, 0.05); },
    setSfx(v) { A.sv = v; if (A.sfx) A.sfx.gain.setTargetAtTime(v, A.ctx.currentTime, 0.05); },
    setEnergy(e) { A.energy = e; },
    play(name, arg) { if (!A.ctx || A.sv <= 0.001 || !FX[name]) return; FX[name](A.ctx.currentTime + 0.01, arg); },
    vols: () => ({ music: A.mv, sfx: A.sv }),
  };
})();
