import { Controls } from '../game/Controls';

const JOYSTICK_RADIUS = 50; // px of travel for full deflection
const TOUCH_LOOK_SENSITIVITY = 0.004; // rad per px of drag

// Virtual joystick + drag-look + action buttons for touch devices.
// Wires the #mobile-controls overlay that already exists in index.html.
export class TouchControls {
  private controls: Controls;
  private joystickPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private thumb: HTMLDivElement | null = null;

  public static isTouchDevice(): boolean {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  constructor(controls: Controls) {
    this.controls = controls;

    const overlay = document.getElementById('mobile-controls');
    const joystick = document.getElementById('joystick-container');
    if (!overlay || !joystick) return;

    this.initJoystick(joystick);
    this.initLookZone(overlay);
    this.initButtons();
  }

  private initJoystick(joystick: HTMLElement) {
    joystick.style.touchAction = 'none';

    this.thumb = document.createElement('div');
    this.thumb.className = 'joystick-thumb';
    joystick.appendChild(this.thumb);

    joystick.addEventListener('pointerdown', (e) => {
      if (this.joystickPointerId !== null) return;
      this.joystickPointerId = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      const rect = joystick.getBoundingClientRect();
      this.joyCenterX = rect.left + rect.width / 2;
      this.joyCenterY = rect.top + rect.height / 2;
      this.updateJoystick(e.clientX, e.clientY);
    });

    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joystickPointerId) return;
      this.updateJoystick(e.clientX, e.clientY);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.joystickPointerId) return;
      this.joystickPointerId = null;
      this.controls.setJoystickVector(0, 0);
      if (this.thumb) this.thumb.style.transform = 'translate(-50%, -50%)';
    };
    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);
  }

  private updateJoystick(clientX: number, clientY: number) {
    let dx = clientX - this.joyCenterX;
    let dy = clientY - this.joyCenterY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOYSTICK_RADIUS) {
      dx = (dx / len) * JOYSTICK_RADIUS;
      dy = (dy / len) * JOYSTICK_RADIUS;
    }
    // Screen-up drag means forward (+y joystick convention)
    this.controls.setJoystickVector(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
    if (this.thumb) {
      this.thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }

  private initLookZone(overlay: HTMLElement) {
    const zone = document.createElement('div');
    zone.id = 'look-zone';
    overlay.appendChild(zone);

    zone.addEventListener('pointerdown', (e) => {
      if (this.lookPointerId !== null || e.pointerId === this.joystickPointerId) return;
      this.lookPointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointerId) return;
      const dx = e.clientX - this.lastLookX;
      const dy = e.clientY - this.lastLookY;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      const scale = TOUCH_LOOK_SENSITIVITY * (this.controls.mouseSensitivity / 0.0022);
      this.controls.applyLookDelta(dx * scale, dy * scale);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointerId) return;
      this.lookPointerId = null;
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
  }

  private initButtons() {
    // Buttons re-dispatch the keyboard codes the game already listens for
    const press = (code: string) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 100);
    };

    document.getElementById('btn-mobile-punch')?.addEventListener('click', () => press('KeyE'));
    document.getElementById('btn-mobile-map')?.addEventListener('click', () => press('KeyM'));
  }
}
