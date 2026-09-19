/**
 * 鹈鹕骑行——WebAudio 芯片音乐 + 音效（零音频资产，全部程序合成）。
 *
 * 音乐：132 BPM 八小节循环（C-G-Am-F 走向），方波主旋律 + 三角波贝斯 +
 *       噪声镲片 + 软底鼓，lookahead 调度器保证节奏不掉。
 * 音效：起跳 / 吃鱼 / 金鱼 / 撞击 / 结束，各自一条合成路径。
 * 纪律：AudioContext 必须等用户手势后才创建（浏览器自动播放策略）；
 *       缺 WebAudio 的环境全部静默降级（不抛错）。
 */

type SfxName = "jump" | "fish" | "golden" | "hit" | "over" | "click";

/** 八小节贝斯根音（MIDI：C3=48） */
const BASS_ROOTS = [48, 43, 45, 41, 48, 43, 41, 43];
/** 八小节主旋律，每小节 8 个八分音符，0 = 休止（MIDI：C5=72） */
const LEAD: number[][] = [
  [76, 79, 84, 79, 76, 79, 81, 79],
  [74, 79, 83, 79, 74, 79, 83, 86],
  [72, 76, 81, 76, 84, 83, 81, 76],
  [81, 77, 72, 77, 81, 84, 81, 77],
  [76, 79, 84, 88, 86, 84, 79, 76],
  [86, 83, 79, 83, 86, 83, 79, 74],
  [81, 84, 89, 88, 84, 81, 77, 81],
  [79, 83, 86, 83, 79, 74, 71, 0],
];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private playing = false;
  private muted = false;

  /** 创建 / 唤醒 AudioContext——必须在用户手势里调用；不可用返回 false */
  ensure(): boolean {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.16;
        this.musicGain.connect(this.master);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.5;
        this.sfxGain.connect(this.master);
        // 共享噪声缓冲（镲片 / 撞击）
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const ch = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return true;
    } catch {
      return false;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  startMusic(): void {
    if (!this.ensure() || this.playing || !this.ctx) return;
    this.playing = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  stopMusic(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  sfx(name: SfxName): void {
    if (!this.ensure() || !this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case "jump":
        this.sweep("square", 300, 680, t, 0.14, 0.16);
        break;
      case "fish":
        this.sweep("sine", 880, 1320, t, 0.09, 0.14);
        this.tone("sine", 1760, t + 0.06, 0.08, 0.1);
        break;
      case "golden": {
        [1047, 1319, 1568, 2093].forEach((f, i) => {
          this.tone("triangle", f, t + i * 0.07, 0.14, 0.15);
        });
        break;
      }
      case "hit":
        this.noise(t, 0.25, 0.3, "lowpass", 240);
        this.sweep("sawtooth", 220, 55, t, 0.3, 0.2);
        break;
      case "over":
        [660, 523, 392, 262].forEach((f, i) => {
          this.tone("triangle", f, t + i * 0.17, 0.2, 0.16);
        });
        break;
      case "click":
        this.tone("square", 880, t, 0.05, 0.08);
        break;
    }
  }

  dispose(): void {
    this.stopMusic();
    try {
      void this.ctx?.close();
    } catch {
      /* 已关闭 */
    }
    this.ctx = null;
  }

  // ── 音乐调度 ──

  private schedule(): void {
    if (!this.ctx) return;
    const stepDur = 60 / 132 / 4; // 132 BPM 的十六分音符
    while (this.nextNoteTime < this.ctx.currentTime + 0.28) {
      this.playStep(this.step, this.nextNoteTime);
      this.step = (this.step + 1) % 128;
      this.nextNoteTime += stepDur;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16) % 8;
    const pos = step % 16;
    if (pos === 0 || pos === 8) this.kick(t);
    if (pos === 4 || pos === 12) this.noise(t, 0.07, 0.06, "bandpass", 1800);
    if (pos % 4 === 2) this.noise(t, 0.03, 0.035, "highpass", 6000);
    if (BASS_STEPS.includes(pos)) {
      const fifth = pos === 6 || pos === 14;
      this.tone("triangle", mtof(BASS_ROOTS[bar] + (fifth ? 7 : 0)), t, 0.18, 0.2, this.musicGain);
    }
    if (pos % 2 === 0) {
      const m = LEAD[bar][pos / 2];
      if (m > 0) this.tone("square", mtof(m), t, 0.16, 0.05, this.musicGain);
    }
  }

  // ── 合成原语 ──

  private tone(
    type: OscillatorType, freq: number, t: number, dur: number, gain: number,
    dest: GainNode | null = null,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest ?? this.sfxGain ?? this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private sweep(
    type: OscillatorType, f0: number, f1: number, t: number, dur: number, gain: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.sfxGain ?? this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private kick(t: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g);
    g.connect(this.musicGain ?? this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private noise(
    t: number, dur: number, gain: number,
    filterType: BiquadFilterType, freq: number,
  ): void {
    if (!this.ctx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain ?? this.ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
