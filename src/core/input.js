// Action-based input (keys come from content/config.json so they can be remapped).
// Mouse look prefers pointer lock; if the browser or an iframe sandbox refuses it,
// falls back to click-and-drag look automatically.
export class Input {
  constructor(canvas, keyMap) {
    this.canvas = canvas;
    this.keyMap = keyMap;           // action → [codes]
    this.down = new Set();          // codes held
    this.pressed = new Set();       // actions pressed this frame (edge)
    this.lookDX = 0;
    this.lookDY = 0;
    this.dragging = false;
    this.pointerLock = { supported: 'requestPointerLock' in canvas, state: 'idle', error: '' };
    this.mode = 'lock';             // 'lock' | 'drag'

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.press(e.code);
      if (this.isGameKey(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    // Mouse buttons are codes "Mouse0" (left), "Mouse2" (right); wheel is "WheelUp"/"WheelDown"
    // (edge-only). In the click-drag look fallback the left button is look, so it never fires actions.
    canvas.addEventListener('mousedown', (e) => { if (this.locked) this.press('Mouse' + e.button); });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (!this.locked && this.mode === 'lock') return;
      this.press(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
      this.down.delete(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: true });

    addEventListener('mousemove', (e) => {
      if (this.locked || (this.mode === 'drag' && this.dragging)) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('mousedown', () => {
      this.dragging = true;
      if (this.mode === 'lock' && !this.locked) this.requestLock();
    });
    addEventListener('mouseup', () => { this.dragging = false; });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLock.state = this.locked ? 'locked' : 'unlocked';
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed('pointerlockerror event'));
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  requestLock() {
    if (!this.pointerLock.supported) return this.lockFailed('not supported');
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch((err) => this.lockFailed(err?.name || String(err)));
    } catch (err) {
      this.lockFailed(err?.name || String(err));
    }
  }

  lockFailed(reason) {
    this.pointerLock.state = 'failed';
    this.pointerLock.error = reason;
    this.mode = 'drag';
  }

  press(code) {
    this.down.add(code);
    for (const [action, codes] of Object.entries(this.keyMap)) {
      if (codes.includes(code)) this.pressed.add(action);
    }
  }

  isGameKey(code) {
    return Object.values(this.keyMap).some((c) => c.includes(code));
  }

  // A tap shorter than one frame still counts as held for that frame.
  held(action) {
    return this.pressed.has(action) || (this.keyMap[action]?.some((c) => this.down.has(c)) ?? false);
  }
  wasPressed(action) { return this.pressed.has(action); }

  // Call at end of frame.
  endFrame() {
    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
  }
}
