// Headless world-layout core (see README.md). No DOM, no Three.js.
export {
  slotAtBlock, slotsInBlockRect, slotBlocks, slotSegments, slotSize, isSlotAnchor, parseSlotKey,
  segmentBlocks, segmentSlots, blockSideSegment, footprintPerimeter,
} from './herringbone.js';
export { PROFILES, CONNECTORS, DEFAULT_ZONES, connectorFor, ConnectorField, pickByHash } from './connectors.js';
export { rotateRoom, transformLayout, transformEdges, makePointMap, ALL_TRANSFORMS } from './transform.js';
export { prepareTemplates, parseEdgeSpec, stampBorders, layoutFootprint } from './templates.js';
export { generateFillerRoom } from './filler.js';
export { solveWfc } from './wfc.js';
export { createWorldLayout, layoutRegion, stitchCells, findSeamMismatches, reachability } from './layout.js';
export { CELLS_PER_BLOCK, CELL_M, BLOCK_M, CORE_LEGEND, isConnected, walkMask, floodFill } from './grid.js';
