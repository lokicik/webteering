export class Sound {
  private static ctx: AudioContext | null = null;
  private static noiseBuffer: AudioBuffer | null = null;
  private static windSource: AudioBufferSourceNode | null = null;
  private static windGain: GainNode | null = null;
  private static windInterval: any = null;

  private static getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume context if suspended (browser security policies)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Synthesize standard high-pitched SportIdent check-point beep-beep
  public static playPunch() {
    try {
      const ctx = this.getContext();
      const playBeep = (delay: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2200, ctx.currentTime + delay); // High-pitched electronic beep
        
        gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.08); // short decay
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.08);
      };

      playBeep(0);
      playBeep(0.09); // Double beep!
    } catch (err) {
      console.warn('Web Audio synthesis failed.', err);
    }
  }

  // Synthesize low-frequency out-of-order error buzz
  public static playError() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime); // Low buzz

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch (err) {
      console.warn(err);
    }
  }

  // Synthesize countdown tick or chime
  public static playTick(isGo = false) {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isGo ? 1600 : 1000, ctx.currentTime);

      gain.gain.setValueAtTime(isGo ? 0.2 : 0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isGo ? 0.35 : 0.08));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (isGo ? 0.35 : 0.08));
    } catch (err) {
      console.warn(err);
    }
  }

  private static getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
      this.noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    }
    return this.noiseBuffer;
  }

  public static playSplash() {
    try {
      const ctx = this.getContext();
      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, ctx.currentTime);
      filter.Q.setValueAtTime(2.0, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      bufferSource.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      bufferSource.start();
      bufferSource.stop(ctx.currentTime + 0.35);
    } catch (err) {
      console.warn('Splash sound synthesis failed', err);
    }
  }

  public static startWindAmbience() {
    try {
      const ctx = this.getContext();
      if (this.windSource) return;

      this.windSource = ctx.createBufferSource();
      this.windSource.buffer = this.getNoiseBuffer(ctx);
      this.windSource.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, ctx.currentTime);

      this.windGain = ctx.createGain();
      this.windGain.gain.setValueAtTime(0.03, ctx.currentTime);

      this.windSource.connect(filter);
      filter.connect(this.windGain);
      this.windGain.connect(ctx.destination);

      this.windSource.start();

      // Sweeping wind gusts
      const modulateWind = () => {
        if (!this.windGain || !this.windSource) return;
        const now = ctx.currentTime;
        filter.frequency.exponentialRampToValueAtTime(220 + Math.random() * 320, now + 2 + Math.random() * 2);
        this.windGain.gain.exponentialRampToValueAtTime(0.015 + Math.random() * 0.035, now + 2 + Math.random() * 2);
      };
      
      modulateWind();
      this.windInterval = setInterval(modulateWind, 3000);
    } catch (err) {
      console.warn('Wind synthesis failed', err);
    }
  }

  public static stopWindAmbience() {
    try {
      if (this.windInterval) {
        clearInterval(this.windInterval);
        this.windInterval = null;
      }
      if (this.windSource) {
        this.windSource.stop();
        this.windSource.disconnect();
        this.windSource = null;
      }
      if (this.windGain) {
        this.windGain.disconnect();
        this.windGain = null;
      }
    } catch (err) {
      console.warn(err);
    }
  }

  public static playSingleBreath(staminaFactor: number) {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      // Pitch and duration scale dynamically with fatigue levels
      const inhalePitch = 500 + (1.0 - staminaFactor) * 120; // 500Hz to 620Hz
      const exhalePitch = 280 + (1.0 - staminaFactor) * 80;  // 280Hz to 360Hz
      const breathDuration = 0.45 + staminaFactor * 0.2;      // 0.45s to 0.65s
      
      // Inhale
      const inhaleSource = ctx.createBufferSource();
      inhaleSource.buffer = this.getNoiseBuffer(ctx);
      const inhaleFilter = ctx.createBiquadFilter();
      inhaleFilter.type = 'bandpass';
      inhaleFilter.frequency.setValueAtTime(inhalePitch, now);
      inhaleFilter.Q.setValueAtTime(3.5, now);

      const inhaleGain = ctx.createGain();
      inhaleGain.gain.setValueAtTime(0.001, now);
      inhaleGain.gain.linearRampToValueAtTime(0.035, now + breathDuration * 0.4);
      inhaleGain.gain.exponentialRampToValueAtTime(0.001, now + breathDuration);

      inhaleSource.connect(inhaleFilter);
      inhaleFilter.connect(inhaleGain);
      inhaleGain.connect(ctx.destination);
      inhaleSource.start(now);
      inhaleSource.stop(now + breathDuration);

      // Exhale (follows inhale with slight overlap)
      const exhaleOffset = breathDuration * 0.95;
      const exhaleSource = ctx.createBufferSource();
      exhaleSource.buffer = this.getNoiseBuffer(ctx);
      const exhaleFilter = ctx.createBiquadFilter();
      exhaleFilter.type = 'bandpass';
      exhaleFilter.frequency.setValueAtTime(exhalePitch, now + exhaleOffset);
      exhaleFilter.Q.setValueAtTime(2.5, now + exhaleOffset);

      const exhaleGain = ctx.createGain();
      exhaleGain.gain.setValueAtTime(0.001, now + exhaleOffset);
      exhaleGain.gain.linearRampToValueAtTime(0.045, now + exhaleOffset + breathDuration * 0.45);
      exhaleGain.gain.exponentialRampToValueAtTime(0.001, now + exhaleOffset + breathDuration * 1.25);

      exhaleSource.connect(exhaleFilter);
      exhaleFilter.connect(exhaleGain);
      exhaleGain.connect(ctx.destination);
      exhaleSource.start(now + exhaleOffset);
      exhaleSource.stop(now + exhaleOffset + breathDuration * 1.25);
    } catch (err) {
      console.warn('Breathing synthesis failed', err);
    }
  }
}
