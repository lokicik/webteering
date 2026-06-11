import { loadSettings } from '../game/Settings';

export type SoundChannel = 'ambience' | 'sfx' | 'music';

export class Sound {
  private static ctx: AudioContext | null = null;
  private static noiseBuffer: AudioBuffer | null = null;
  private static windSource: AudioBufferSourceNode | null = null;
  private static windGain: GainNode | null = null;
  private static windInterval: any = null;

  private static masterFilter: BiquadFilterNode | null = null;
  private static masterGain: GainNode | null = null;
  private static buses: Partial<Record<SoundChannel, GainNode>> = {};

  public static hasContext(): boolean {
    return this.ctx !== null;
  }

  private static getMasterFilter(): BiquadFilterNode {
    const ctx = this.getContext();
    if (!this.masterFilter) {
      this.masterFilter = ctx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.setValueAtTime(20000, ctx.currentTime);
      this.masterFilter.connect(ctx.destination);
    }
    return this.masterFilter;
  }

  private static getMasterGain(): GainNode {
    const ctx = this.getContext();
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(loadSettings().masterVol, ctx.currentTime);
      this.masterGain.connect(this.getMasterFilter());
    }
    return this.masterGain;
  }

  private static getBus(channel: SoundChannel): GainNode {
    const ctx = this.getContext();
    let bus = this.buses[channel];
    if (!bus) {
      bus = ctx.createGain();
      const s = loadSettings();
      const vol = channel === 'ambience' ? s.ambienceVol : channel === 'music' ? s.musicVol : s.sfxVol;
      bus.gain.setValueAtTime(vol, ctx.currentTime);
      bus.connect(this.getMasterGain());
      this.buses[channel] = bus;
    }
    return bus;
  }

  public static setMasterVolume(v: number) {
    // Pre-gesture there is no context yet; the lazy bus build reads persisted settings
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  public static setChannelVolume(channel: SoundChannel, v: number) {
    const bus = this.buses[channel];
    if (!this.ctx || !bus) return;
    bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // --- 3D SPATIAL AUDIO (remote runners, world events) ---
  private static listenerX = 0;
  private static listenerY = 0;
  private static listenerZ = 0;

  // Called once per frame with the camera transform. Never force-creates the
  // AudioContext (pre-gesture the browser would reject it anyway).
  public static updateListener(
    px: number, py: number, pz: number,
    fx: number, fy: number, fz: number,
    ux: number, uy: number, uz: number
  ) {
    this.listenerX = px;
    this.listenerY = py;
    this.listenerZ = pz;
    if (!this.ctx) return;
    const listener = this.ctx.listener as any;
    const t = this.ctx.currentTime;
    try {
      if (listener.positionX) {
        listener.positionX.setTargetAtTime(px, t, 0.05);
        listener.positionY.setTargetAtTime(py, t, 0.05);
        listener.positionZ.setTargetAtTime(pz, t, 0.05);
        listener.forwardX.setTargetAtTime(fx, t, 0.05);
        listener.forwardY.setTargetAtTime(fy, t, 0.05);
        listener.forwardZ.setTargetAtTime(fz, t, 0.05);
        listener.upX.setTargetAtTime(ux, t, 0.05);
        listener.upY.setTargetAtTime(uy, t, 0.05);
        listener.upZ.setTargetAtTime(uz, t, 0.05);
      } else if (listener.setPosition) {
        // Safari fallback (deprecated API)
        listener.setPosition(px, py, pz);
        listener.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch (err) {
      // Fail silently
    }
  }

  private static createPanner(x: number, y: number, z: number): PannerNode {
    const ctx = this.getContext();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.5;
    panner.positionX.setValueAtTime(x, ctx.currentTime);
    panner.positionY.setValueAtTime(y, ctx.currentTime);
    panner.positionZ.setValueAtTime(z, ctx.currentTime);
    return panner;
  }

  private static distanceToListener(x: number, y: number, z: number): number {
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Positional footstep for remote runners
  public static playStepAt(type: string, speedFactor: number, x: number, y: number, z: number) {
    try {
      if (!this.ctx) return; // no context until the local player makes a gesture
      if (this.distanceToListener(x, y, z) > 50) return;
      const panner = this.createPanner(x, y, z);
      panner.connect(this.getBus('sfx'));
      this.playStepInto(panner, type, speedFactor);
    } catch (err) {
      // Fail silently
    }
  }

  // Positional SI-station beep for remote punches
  public static playPunchAt(x: number, y: number, z: number) {
    try {
      if (!this.ctx) return;
      if (this.distanceToListener(x, y, z) > 60) return;
      const panner = this.createPanner(x, y, z);
      panner.connect(this.getBus('sfx'));
      this.playPunchInto(panner);
    } catch (err) {
      // Fail silently
    }
  }

  public static updateFilter(isSwimming: boolean, stamina: number) {
    try {
      const ctx = this.getContext();
      const filter = this.getMasterFilter();
      
      let targetFreq = 20000;
      let targetQ = 1.0;
      
      if (isSwimming) {
        // Submerged underwater muffled effect
        targetFreq = 420;
        targetQ = 2.5;
      } else if (stamina < 35.0) {
        // Exhaustion resonant low-pass sweep
        const factor = stamina / 35.0; // 0.0 to 1.0
        targetFreq = 500 + factor * 1500; // sweep between 500Hz and 2000Hz
        targetQ = 2.5 - factor * 1.5;
      }
      
      const now = ctx.currentTime;
      filter.frequency.setTargetAtTime(targetFreq, now, 0.15);
      filter.Q.setTargetAtTime(targetQ, now, 0.15);
    } catch (err) {
      // Fail silently
    }
  }

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
      this.playPunchInto(this.getBus('sfx'));
    } catch (err) {
      console.warn('Web Audio synthesis failed.', err);
    }
  }

  private static playPunchInto(destination: AudioNode) {
    const ctx = this.getContext();
    const playBeep = (delay: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, ctx.currentTime + delay); // High-pitched electronic beep

      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.08); // short decay

      osc.connect(gain);
      gain.connect(destination);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.08);
    };

    playBeep(0);
    playBeep(0.09); // Double beep!
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
      gain.connect(this.getBus('sfx'));

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
      gain.connect(this.getBus('sfx'));

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
      gain.connect(this.getBus('sfx'));

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
      this.windGain.connect(this.getBus('ambience'));

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
      inhaleGain.connect(this.getBus('ambience'));
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
      exhaleGain.connect(this.getBus('ambience'));
      exhaleSource.start(now + exhaleOffset);
      exhaleSource.stop(now + exhaleOffset + breathDuration * 1.25);
    } catch (err) {
      console.warn('Breathing synthesis failed', err);
    }
  }

  // Synthesize dynamic ground footsteps based on runnability speed penalty types
  public static playStep(type: string, speedFactor: number) {
    try {
      this.playStepInto(this.getBus('sfx'), type, speedFactor);
    } catch (err) {
      // Fail silently
    }
  }

  private static playStepInto(destination: AudioNode, type: string, speedFactor: number) {
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
      oscGain.connect(destination);
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
    gain.connect(destination);

    bufferSource.start(now);
    bufferSource.stop(now + duration);
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
      gain.connect(this.getBus('ambience'));
      bufferSource.start(now);
      bufferSource.stop(now + 2.8);

      // 2. Rolling echo delay
      const echoDelay = ctx.createDelay();
      echoDelay.delayTime.setValueAtTime(0.35, now);

      const echoGain = ctx.createGain();
      echoGain.gain.setValueAtTime(0.35, now);

      gain.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(this.getBus('ambience'));
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
      gain.connect(this.getBus('sfx'));

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
        gain.connect(this.getBus('sfx'));

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
      scrapeGain.connect(this.getBus('sfx'));
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
      gruntGain.connect(this.getBus('sfx'));

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
      gain.connect(this.getBus('sfx'));

      scrape.start(now);
      scrape.stop(now + 0.12);
    } catch (err) {
      // Fail silently
    }
  }

  // Beautiful Ambient Synthesized Soundtrack (Sine Wave Chord Pad Progression)
  private static soundtrackInterval: any = null;
  public static startSoundtrack(track?: 'ambient' | 'chill' | 'upbeat') {
    try {
      const ctx = this.getContext();
      const activeTrack = track || 'ambient';

      if (this.soundtrackInterval) {
        clearInterval(this.soundtrackInterval);
        this.soundtrackInterval = null;
      }

      const chords = [
        [220.00, 329.63, 440.00, 659.25], // A Minor
        [261.63, 329.63, 523.25, 783.99], // C Major
        [349.23, 440.00, 523.25, 698.46], // F Major
        [293.66, 349.23, 587.33, 880.00]  // D Minor
      ];
      let chordIndex = 0;

      const playChord = () => {
        const now = ctx.currentTime;
        
        let chordsList = chords;
        if (activeTrack === 'chill') {
          chordsList = [
            [261.63, 392.00, 523.25, 587.33], // C9
            [311.13, 466.16, 622.25, 698.46], // Eb9
            [349.23, 523.25, 698.46, 783.99], // F9
            [293.66, 440.00, 587.33, 659.25]  // G9
          ];
        } else if (activeTrack === 'upbeat') {
          chordsList = [
            [196.00, 293.66, 392.00, 493.88], // G Major
            [220.00, 329.63, 440.00, 554.37], // A Major
            [293.66, 440.00, 587.33, 739.99], // D Major
            [261.63, 329.63, 523.25, 659.25]  // C Major
          ];
        }

        const activeChord = chordsList[chordIndex];
        chordIndex = (chordIndex + 1) % chordsList.length;

        // Trigger each note in the chord pad
        activeChord.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);

          // Soft slow attack & release to simulate breathing analog pads
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.012 - (idx * 0.001), now + 1.2); // soft swell
          gain.gain.setValueAtTime(0.012 - (idx * 0.001), now + 3.2);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 4.8); // gentle fade

          osc.connect(gain);
          gain.connect(this.getBus('music'));

          osc.start(now);
          osc.stop(now + 4.8);
        });
      };

      // Trigger first note immediately and loop
      playChord();
      this.soundtrackInterval = setInterval(playChord, 5000);
    } catch (err) {
      console.warn('Soundtrack synthesis failed', err);
    }
  }

  public static stopSoundtrack() {
    if (this.soundtrackInterval) {
      clearInterval(this.soundtrackInterval);
      this.soundtrackInterval = null;
    }
  }
}

