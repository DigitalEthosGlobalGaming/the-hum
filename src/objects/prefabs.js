// Built-in low-poly prop models, referenced from object JSON as { "type": "prefab", "name": ... }.
// Each part is a box: size [x,y,z], pos = centre [x,y,z] (object-local, y up, origin on the floor),
// optional rot [rx,ry,rz] in degrees, tint, texture (default proc:white), emissive.
// Front of an object faces -z (rot 0 = facing "north").

const FABRIC = '#3d4452';
const METAL = '#2a2a2a';
const WOOD = '#6f5b43';

export const prefabs = {
  office_chair: [
    { size: [0.5, 0.08, 0.48], pos: [0, 0.47, 0], tint: FABRIC },               // seat
    { size: [0.48, 0.5, 0.06], pos: [0, 0.8, 0.24], rot: [-8, 0, 0], tint: FABRIC }, // back
    { size: [0.05, 0.38, 0.05], pos: [0, 0.25, 0], tint: METAL },               // post
    { size: [0.62, 0.04, 0.06], pos: [0, 0.05, 0], tint: METAL },               // base
    { size: [0.06, 0.04, 0.62], pos: [0, 0.05, 0], tint: METAL },
    { size: [0.05, 0.05, 0.3], pos: [-0.27, 0.62, 0.02], tint: METAL },          // arms
    { size: [0.05, 0.05, 0.3], pos: [0.27, 0.62, 0.02], tint: METAL },
  ],
  office_desk: [
    { size: [1.4, 0.05, 0.7], pos: [0, 0.735, 0], tint: WOOD },                 // top
    { size: [0.04, 0.71, 0.66], pos: [-0.66, 0.355, 0], tint: WOOD },           // sides
    { size: [0.04, 0.71, 0.66], pos: [0.66, 0.355, 0], tint: WOOD },
    { size: [1.28, 0.45, 0.03], pos: [0, 0.45, 0.3], tint: '#5e4d39' },          // modesty panel
    { size: [0.4, 0.55, 0.6], pos: [0.44, 0.39, -0.02], tint: '#77654d' },       // drawer unit
    { size: [0.12, 0.02, 0.02], pos: [0.44, 0.55, -0.33], tint: METAL },         // handle
  ],
  wet_floor_sign: [
    { size: [0.3, 0.62, 0.02], pos: [0, 0.31, -0.07], rot: [12, 0, 0], tint: '#d9b313' },
    { size: [0.3, 0.62, 0.02], pos: [0, 0.31, 0.07], rot: [-12, 0, 0], tint: '#d9b313' },
    { size: [0.18, 0.08, 0.005], pos: [0, 0.4, -0.142], rot: [12, 0, 0], tint: '#1a1a1a' }, // pictogram block
  ],
  desk_lamp: [
    { size: [0.16, 0.03, 0.16], pos: [0, 0.015, 0], tint: METAL },
    { size: [0.025, 0.32, 0.025], pos: [0, 0.18, 0.02], rot: [-15, 0, 0], tint: METAL },
    { size: [0.14, 0.08, 0.12], pos: [0, 0.34, -0.06], rot: [25, 0, 0], tint: '#4a5a3a' },
    { size: [0.07, 0.02, 0.07], pos: [0, 0.3, -0.08], tint: '#fff3c0', emissive: 1 }, // bulb
  ],
};
