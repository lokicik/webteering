export class Sound {
  private static ctx: AudioContext | null = null;

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
}
