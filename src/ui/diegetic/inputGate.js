// Input gating for diegetic modes, done by wrapping the Input *instance* (src/core/input.js is
// untouched): while the notebook / an inspected paper is up, movement is ignored; while the
// pockets are open, mouse look and use/drop go to the pocket cursor; when exhausted, sprint is
// ignored. Other systems keep calling input.held()/wasPressed() as usual and simply see `false`.
// The diegetic UI reads the real state through gate.raw.
export function installInputGate(input) {
  const held = input.held.bind(input);
  const wasPressed = input.wasPressed.bind(input);
  const endFrame = input.endFrame.bind(input);
  const gate = {
    blocked: new Set(),
    blockLook: false,
    raw: { held, wasPressed },
    look: { x: 0, y: 0 },
  };
  input.held = (a) => (gate.blocked.has(a) ? false : held(a));
  input.wasPressed = (a) => (gate.blocked.has(a) ? false : wasPressed(a));

  // lookDX/lookDY: accumulate into our own store; read as 0 while look is blocked.
  // Input does `this.lookDX += m` (get, then set) and `this.lookDX = 0` in endFrame.
  const L = gate.look;
  L.x = input.lookDX || 0; L.y = input.lookDY || 0;
  const prop = (key, axis) => Object.defineProperty(input, key, {
    configurable: true,
    get: () => (gate.blockLook ? 0 : L[axis]),
    set: (v) => { L[axis] = gate.blockLook ? L[axis] + v : v; },
  });
  prop('lookDX', 'x');
  prop('lookDY', 'y');
  input.endFrame = () => { endFrame(); L.x = 0; L.y = 0; };
  return gate;
}
