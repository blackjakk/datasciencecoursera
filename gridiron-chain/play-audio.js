// ─── Audio system (Web Audio API, synth-based SFX) ─────────────────────────
// Procedurally-synthesized stadium sound effects. No external audio files —
// keeps the vanilla-script-tag architecture intact. Browsers require a user
// gesture to start the AudioContext, so we lazy-init on the first call.
//
// API:
//   GCAudio.play("snap")     — short click cue at play start
//   GCAudio.play("whistle")  — referee whistle at play end / score
//   GCAudio.play("hit")      — low-frequency thud on big collisions
//   GCAudio.play("cheer")    — crowd roar swell on touchdowns / big plays
//   GCAudio.crowd.start()    — begin the ambient crowd hum loop
//   GCAudio.crowd.stop()
//   GCAudio.setEnabled(false) — global mute
//
// Each SFX uses Web Audio nodes (oscillators, noise buffers, filters,
// envelopes) tuned to sound like its stadium counterpart without sampling.

const GCAudio = (() => {
  let ctx = null;
  let masterGain = null;
  let crowdNode = null;
  let crowdGain = null;
  let enabled = true;

  function _ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  // Resume on first user gesture (autoplay policy). One-shot listener.
  function _attachUnlock() {
    const unlock = () => {
      const c = _ensureCtx();
      if (c && c.state === "suspended") c.resume().catch(() => {});
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown",     unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown",     unlock, { once: true });
  }
  if (typeof window !== "undefined") _attachUnlock();

  // Reusable noise buffer (1 second of white noise) — sliced by individual
  // SFX via BufferSource start/stop timing.
  let _noiseBuf = null;
  function _noiseBuffer() {
    if (_noiseBuf) return _noiseBuf;
    const c = _ensureCtx();
    if (!c) return null;
    _noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return _noiseBuf;
  }

  // ── SFX synthesizers ──────────────────────────────────────────────────
  function _playSnap() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Short, sharp tonal click with body — like a snap impact + helmet thunk.
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.07);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain).connect(masterGain);
    osc.start(t); osc.stop(t + 0.1);
  }

  function _playWhistle() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Tweet-tweet referee whistle — narrow-band high-pitched chirp w/ vibrato.
    const osc = c.createOscillator();
    const gain = c.createGain();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 2400;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.20, t + 0.02);
    gain.gain.setValueAtTime(0.20, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(gain).connect(masterGain);
    osc.start(t); lfo.start(t);
    osc.stop(t + 0.32); lfo.stop(t + 0.32);
  }

  function _playHit() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Heavy low-frequency thud — band-passed noise burst + sub-tone tail.
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 180;
    filt.Q.value = 1.2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 0.25);
    // Sub-tone tail for extra weight
    const sub = c.createOscillator();
    const subG = c.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(75, t);
    sub.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    subG.gain.setValueAtTime(0.35, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    sub.connect(subG).connect(masterGain);
    sub.start(t); sub.stop(t + 0.22);
  }

  function _playCheer() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Crowd roar — band-passed noise with a swelling envelope. 1.6s wide,
    // peaks around 0.6s in.
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 900;
    filt.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.42, t + 0.6);
    gain.gain.linearRampToValueAtTime(0.0001, t + 1.6);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 1.7);
  }

  // ── Ambient crowd hum (looping low-level murmur) ──────────────────────
  function _crowdStart() {
    const c = _ensureCtx(); if (!c) return;
    if (crowdNode) return; // already running
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 700;
    filt.Q.value = 0.5;
    const g = c.createGain();
    g.gain.value = 0.06;
    src.connect(filt).connect(g).connect(masterGain);
    src.start();
    crowdNode = src;
    crowdGain = g;
  }
  function _crowdStop() {
    if (!crowdNode) return;
    const c = ctx;
    if (c && crowdGain) {
      const t = c.currentTime;
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
      crowdGain.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      try { crowdNode.stop(t + 0.55); } catch (_) {}
    } else {
      try { crowdNode.stop(); } catch (_) {}
    }
    crowdNode = null;
    crowdGain = null;
  }

  function play(name) {
    if (!enabled) return;
    if (!_ensureCtx()) return;
    if (ctx.state === "suspended") return; // wait for user gesture
    try {
      if (name === "snap")    _playSnap();
      else if (name === "whistle") _playWhistle();
      else if (name === "hit")     _playHit();
      else if (name === "cheer")   _playCheer();
    } catch (_) {}
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) _crowdStop();
  }
  function isEnabled() { return enabled; }

  return {
    play,
    crowd: { start: _crowdStart, stop: _crowdStop },
    setEnabled,
    isEnabled,
  };
})();
