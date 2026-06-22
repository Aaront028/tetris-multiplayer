let ctx: AudioContext | null = null;
let enabled = localStorage.getItem("battle-sound") === "1";

function getCtx() {
  if (!enabled) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
  localStorage.setItem("battle-sound", value ? "1" : "0");
}

function tone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

export function playLineClear() {
  [440, 554, 659, 784].forEach((freq, i) => {
    window.setTimeout(() => tone(freq, 0.12, "square", 0.1), i * 70);
  });
}

export function playLock() {
  tone(180, 0.04, "triangle", 0.05);
}

export function playGarbage() {
  tone(90, 0.18, "sawtooth", 0.12);
}

export function playWin() {
  [523, 659, 784, 1047].forEach((freq, i) => {
    window.setTimeout(() => tone(freq, 0.2, "sine", 0.14), i * 120);
  });
}

export function playLose() {
  [330, 262, 196].forEach((freq, i) => {
    window.setTimeout(() => tone(freq, 0.25, "sine", 0.12), i * 150);
  });
}

export function playCountdownTick() {
  tone(520, 0.09, "sine", 0.1);
}

export function playCountdownGo() {
  tone(880, 0.14, "square", 0.12);
}
