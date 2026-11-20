/**
 * Unified input: touch (virtual joystick + look drag + on-screen buttons)
 * and keyboard/mouse for desktop testing.
 */
export type Btn = 'fire' | 'aim' | 'jump' | 'reload' | 'switch' | 'grenade' | 'knife' | 'crouch' | 'vehicle' | 'tank' | 'jet' | 'bandage';

export class Input {
  moveX = 0; // -1..1 (right +)
  moveY = 0; // -1..1 (forward +)
  lookDX = 0; // accumulated pixels
  lookDY = 0;
  private held = new Set<Btn>();
  private pressed = new Set<Btn>();
  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  aimToggle = false;
  enabled = false;
  pointerLocked = false;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  readonly isTouch: boolean;

  constructor(layer: HTMLElement, private canvas: HTMLCanvasElement) {
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    layer.appendChild(this.joyBase);

    layer.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked && this.enabled) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      if (e.button === 0) this.press('fire');
      if (e.button === 2) this.aimToggle = !this.aimToggle;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('fire');
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    if (this.isTouch) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      /* not available (e.g. headless tests) */
    }
  }
  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  press(b: Btn): void {
    if (!this.held.has(b)) this.pressed.add(b);
    this.held.add(b);
    if (b === 'aim') this.aimToggle = !this.aimToggle;
  }
  release(b: Btn): void {
    this.held.delete(b);
  }
  isHeld(b: Btn): boolean {
    return this.held.has(b);
  }
  /** True once per press. */
  consume(b: Btn): boolean {
    const had = this.pressed.has(b);
    this.pressed.delete(b);
    return had;
  }

  /** Called by on-screen buttons that should also steer the view while held. */
  trackLook(e: PointerEvent): void {
    this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  reset(): void {
    this.held.clear();
    this.pressed.clear();
    this.keys.clear();
    this.joyId = null;
    this.lookIds.clear();
    this.joyVec.x = this.joyVec.y = 0;
    this.joyBase.style.display = 'none';
    this.lookDX = this.lookDY = 0;
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (!this.pointerLocked) this.requestPointerLock();
      return;
    }
    e.preventDefault();
    const w = window.innerWidth;
    if (e.clientX < w * 0.4 && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.display = 'block';
      this.joyBase.style.left = e.clientX + 'px';
      this.joyBase.style.top = e.clientY + 'px';
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    } else {
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerId === this.joyId) {
      const R = 60;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        // drag the base along so the stick never "sticks" at the edge
        this.joyOrigin.x += (dx / l) * (l - R);
        this.joyOrigin.y += (dy / l) * (l - R);
        this.joyBase.style.left = this.joyOrigin.x + 'px';
        this.joyBase.style.top = this.joyOrigin.y + 'px';
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      this.joyVec.x = dx / R;
      this.joyVec.y = -dy / R;
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const lp = this.lookIds.get(e.pointerId);
    if (lp) {
      this.lookDX += e.clientX - lp.x;
      this.lookDY += e.clientY - lp.y;
      lp.x = e.clientX;
      lp.y = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyVec.x = this.joyVec.y = 0;
      this.joyBase.style.display = 'none';
    }
    this.lookIds.delete(e.pointerId);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.code;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!this.enabled) return;
    const map: Record<string, Btn> = {
      Space: 'jump', KeyR: 'reload', KeyQ: 'switch', KeyF: 'fire', KeyG: 'grenade', KeyV: 'knife',
      KeyC: 'crouch', ControlLeft: 'crouch', KeyX: 'vehicle', KeyT: 'tank', KeyY: 'jet', KeyH: 'bandage',
    };
    const b = map[k];
    if (b) {
      if (down) this.press(b);
      else this.release(b);
    }
    if (k === 'KeyE' && down) this.aimToggle = !this.aimToggle;
  }

  /** Combines joystick and WASD into moveX/moveY. Call once per frame. */
  poll(): void {
    let x = this.joyVec.x, y = this.joyVec.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.moveX = x;
    this.moveY = y;
  }

  takeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return r;
  }

  sprintHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  keyDown(code: string): boolean {
    return this.keys.has(code);
  }
}
