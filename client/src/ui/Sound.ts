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

  // Synthesize dynamic ground footsteps based on runnability speed penalty types
  public static playStep(type: string, speedFactor: number) {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      let duration = 0.10;
      let volume = 0.012 * Math.min(1.6, speedFactor + 0.3);

      if (type === 'path') {
        // Crunchy gravel/dirt scrape
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.Q.setValueAtTime(3.5, now);
        duration = 0.08;
      } else if (type === 'water') {
        // Wet sloshing
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(260, now);
        duration = 0.18;
        volume *= 1.8;
      } else if (type === 'thicket') {
        // Snapping twigs and dry leaves rustling
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(750, now);
        filter.Q.setValueAtTime(1.8, now);
        duration = 0.14;
        volume *= 1.4;

        // Add high pitch snap crackle click
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(700 + Math.random() * 900, now);
        oscGain.gain.setValueAtTime(volume * 1.4, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);
      } else {
        // field / forest / walk: soft grass swishing rustle
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(450, now);
        filter.Q.setValueAtTime(2.0, now);
        duration = 0.11;
      }

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      bufferSource.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      bufferSource.start(now);
      bufferSource.stop(now + duration);
    } catch (err) {
      // Fail silently
    }
  }

  // Synthesize low-frequency dry rolling thunder cracks with echoes
  public static playThunder() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      // 1. Initial rumble crack
      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(110, now);
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);

      bufferSource.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      bufferSource.start(now);
      bufferSource.stop(now + 2.8);

      // 2. Rolling echo delay
      const echoDelay = ctx.createDelay();
      echoDelay.delayTime.setValueAtTime(0.35, now);

      const echoGain = ctx.createGain();
      echoGain.gain.setValueAtTime(0.35, now);

      gain.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(ctx.destination);
    } catch (err) {
      // Fail silently
    }
  }

  // Synthesize short physical click on manual compass bezel rotation
  public static playDialClick() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1300, now);

      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.015);
    } catch (err) {
      // Fail silently
    }
  }

  // Synthesize success chime when magnetic needle aligns with Silva orienting arrow
  public static playLockChime() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const playBell = (freq: number, volume: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.26);
      };

      playBell(880, 0.07);
      playBell(1320, 0.035);
    } catch (err) {
      // Fail silently
    }
  }

  // Synthesize athletic grunt and woody scrape sounds during hurdles/vaulting
  public static playVault() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      // 1. Scrape brush scrape friction
      const scrape = ctx.createBufferSource();
      scrape.buffer = this.getNoiseBuffer(ctx);
      const scrapeFilter = ctx.createBiquadFilter();
      scrapeFilter.type = 'bandpass';
      scrapeFilter.frequency.setValueAtTime(1000, now);
      scrapeFilter.Q.setValueAtTime(2.0, now);

      const scrapeGain = ctx.createGain();
      scrapeGain.gain.setValueAtTime(0.035, now);
      scrapeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      scrape.connect(scrapeFilter);
      scrapeFilter.connect(scrapeGain);
      scrapeGain.connect(ctx.destination);
      scrape.start(now);
      scrape.stop(now + 0.32);

      // 2. Vocal effort grunt (descending sawtooth with lowpass)
      const grunt = ctx.createOscillator();
      grunt.type = 'sawtooth';
      grunt.frequency.setValueAtTime(95, now);
      grunt.frequency.exponentialRampToValueAtTime(70, now + 0.24);

      const gruntFilter = ctx.createBiquadFilter();
      gruntFilter.type = 'lowpass';
      gruntFilter.frequency.setValueAtTime(150, now);

      const gruntGain = ctx.createGain();
      gruntGain.gain.setValueAtTime(0.06, now);
      gruntGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      grunt.connect(gruntFilter);
      gruntFilter.connect(gruntGain);
      gruntGain.connect(ctx.destination);

      grunt.start(now);
      grunt.stop(now + 0.24);
    } catch (err) {
      // Fail silently
    }
  }

  // Synthesize gravel/soil sliding friction noise
  public static playSlideScrape() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const scrape = ctx.createBufferSource();
      scrape.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750 + Math.random() * 400, now);
      filter.Q.setValueAtTime(1.6, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.038, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      scrape.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      scrape.start(now);
      scrape.stop(now + 0.12);
    } catch (err) {
      // Fail silently
    }
  }
}

