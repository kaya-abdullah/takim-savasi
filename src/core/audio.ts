import type { SoundProfile } from '../data/weapons';

/** All sounds are synthesised with WebAudio: no audio files to ship. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private recent = 0;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  private ok(): boolean {
    return this.enabled && !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  private out(vol: number, pan: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master!);
    } else g.connect(this.master!);
    return g;
  }

  private noiseBurst(dest: AudioNode, cutoff: number, decay: number, gain: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private tone(dest: AudioNode, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** dist in metres from listener (0 = own gun); pan -1..1. */
  shot(p: SoundProfile, dist = 0, pan = 0): void {
    if (!this.ok()) return;
    // cap simultaneous distant shots to keep mobile CPUs happy
    const now = this.ctx!.currentTime;
    if (dist > 0) {
      if (now - this.recent < 0.03) return;
      this.recent = now;
    }
    const vol = dist <= 0 ? 1 : Math.min(0.8, 9 / (9 + dist));
    if (vol < 0.04) return;
    const dest = this.out(vol, pan);
    const far = dist > 25;
    if (p.laser) {
      this.tone(dest, p.freq * 3, p.freq * 0.6, p.decay, p.gain * 0.6, 'sawtooth');
      this.tone(dest, p.freq * 2, p.freq * 0.4, p.decay * 1.2, p.gain * 0.4, 'square');
      return;
    }
    this.noiseBurst(dest, far ? p.noise * 0.4 : p.noise, p.decay, p.gain);
    this.tone(dest, p.freq, p.freq * 0.35, p.decay * 0.8, p.gain * 0.9, 'triangle');
  }

  explosion(dist: number, pan: number): void {
    if (!this.ok()) return;
    const vol = Math.min(1, 14 / (14 + dist));
    const dest = this.out(vol, pan);
    this.noiseBurst(dest, 1800, 1.1, 1.0);
    this.tone(dest, 70, 25, 0.9, 1.0, 'sine');
  }

  hit(): void {
    if (!this.ok()) return;
    this.tone(this.out(0.35, 0), 1800, 1400, 0.05, 0.5, 'square');
  }
  headshot(): void {
    if (!this.ok()) return;
    const d = this.out(0.35, 0);
    this.tone(d, 2400, 2000, 0.06, 0.5, 'square');
    this.tone(d, 3200, 2800, 0.05, 0.3, 'square', 0.04);
  }
  kill(): void {
    if (!this.ok()) return;
    const d = this.out(0.5, 0);
    this.tone(d, 880, 880, 0.09, 0.5, 'triangle');
    this.tone(d, 1320, 1320, 0.16, 0.5, 'triangle', 0.08);
  }
  coin(): void {
    if (!this.ok()) return;
    const d = this.out(0.35, 0);
    this.tone(d, 1568, 1568, 0.08, 0.4, 'square');
    this.tone(d, 2093, 2093, 0.18, 0.35, 'square', 0.07);
  }
  hurt(): void {
    if (!this.ok()) return;
    const d = this.out(0.5, 0);
    this.noiseBurst(d, 600, 0.15, 0.6);
    this.tone(d, 160, 90, 0.15, 0.4, 'sine');
  }
  reload(): void {
    if (!this.ok()) return;
    const d = this.out(0.4, 0);
    this.noiseBurst(d, 3000, 0.04, 0.6, 'highpass');
    const ctx = this.ctx!;
    setTimeout(() => { if (this.ctx === ctx && this.ok()) this.noiseBurst(d, 2500, 0.05, 0.7, 'highpass'); }, 350);
  }
  empty(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.out(0.3, 0), 4000, 0.03, 0.5, 'highpass');
  }
  click(): void {
    if (!this.ok()) return;
    this.tone(this.out(0.25, 0), 900, 600, 0.05, 0.4, 'sine');
  }
  buy(): void {
    if (!this.ok()) return;
    const d = this.out(0.45, 0);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(d, f, f, 0.14, 0.4, 'triangle', i * 0.07));
  }
  jump(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.out(0.15, 0), 900, 0.1, 0.5);
  }
  whoosh(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.out(0.35, 0), 2500, 0.18, 0.7, 'bandpass');
  }
  stab(): void {
    if (!this.ok()) return;
    const d = this.out(0.5, 0);
    this.noiseBurst(d, 900, 0.12, 0.8);
    this.tone(d, 220, 90, 0.12, 0.5, 'square');
  }
  clink(dist: number, pan: number): void {
    if (!this.ok() || dist > 30) return;
    const d = this.out(Math.min(0.5, 6 / (6 + dist)), pan);
    this.tone(d, 2600, 2400, 0.05, 0.4, 'triangle');
    this.tone(d, 3900, 3700, 0.04, 0.2, 'sine');
  }
  streak(level: number): void {
    if (!this.ok()) return;
    const d = this.out(0.55, 0);
    const base = [523, 659, 784, 1047, 1319, 1568].slice(0, 3 + Math.min(3, level));
    base.forEach((f, i) => { this.tone(d, f, f, 0.18, 0.4, 'square', i * 0.06); this.tone(d, f / 2, f / 2, 0.22, 0.3, 'triangle', i * 0.06); });
  }
  win(): void {
    if (!this.ok()) return;
    const d = this.out(0.5, 0);
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(d, f, f, 0.3, 0.35, 'triangle', i * 0.12));
  }
  lose(): void {
    if (!this.ok()) return;
    const d = this.out(0.5, 0);
    [392, 349, 311, 262].forEach((f, i) => this.tone(d, f, f, 0.35, 0.35, 'triangle', i * 0.18));
  }
}

export const audio = new Audio();
