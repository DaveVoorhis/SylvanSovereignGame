export type BridgeStyle = 'timber_arch' | 'stone_arch';

export interface BridgeInstance {
  readonly id: string;
  readonly settlementId: string;
  readonly style: BridgeStyle;
  /** Dry home-side riverbank abutment coordinates */
  readonly startX: number;
  readonly startZ: number;
  readonly startY: number;
  /** Opposite dry riverbank abutment coordinates */
  readonly endX: number;
  readonly endZ: number;
  readonly endY: number;
  /** Midpoint over the waterway */
  readonly centerX: number;
  readonly centerZ: number;
  /** Parabolic crown rise above the abutment chord (meters) */
  readonly archHeight: number;
  /** Total deck length from abutment to abutment (meters) */
  readonly length: number;
  /** Walkable deck width (meters) */
  readonly width: number;
  /** Unit vector from start -> end in world XZ */
  readonly dirX: number;
  readonly dirZ: number;
  /** World Y rotation matching Three.js +Z forward (Math.atan2(dirX, dirZ)) */
  readonly yaw: number;
  progress: number; // 0..100
  completed: boolean;
}

/**
 * Exact arched deck elevation at normalized span position t in [0, 1].
 * Shared between headless creature elevation and 3D bridge geometry so feet
 * align cleanly with the planks and flagstones.
 */
export function sampleBridgeDeckY(bridge: BridgeInstance, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const baseY = bridge.startY + (bridge.endY - bridge.startY) * clamped;
  const arch = 4 * clamped * (1 - clamped) * bridge.archHeight;
  return baseY + arch;
}

/**
 * Returns the bridge deck Y if (x, z) lies on the bridge deck corridor, or null otherwise.
 */
export function getBridgeDeckHeightAt(
  bridge: BridgeInstance,
  x: number,
  z: number,
  widthPad = 0,
  lengthPad = 0.65,
): number | null {
  const rx = x - bridge.centerX;
  const rz = z - bridge.centerZ;
  const along = rx * bridge.dirX + rz * bridge.dirZ;
  const halfLen = bridge.length * 0.5 + lengthPad;
  if (Math.abs(along) > halfLen) return null;

  const across = -rx * bridge.dirZ + rz * bridge.dirX;
  const halfW = bridge.width * 0.5 + widthPad;
  if (Math.abs(across) > halfW) return null;

  const t = Math.max(0, Math.min(1, along / bridge.length + 0.5));
  return sampleBridgeDeckY(bridge, t);
}

/** True if (x, z) overlaps the bridge deck or its immediate bank approach ramps. */
export function isPointNearBridge(
  bridge: BridgeInstance,
  x: number,
  z: number,
  margin = 1.6,
): boolean {
  const rx = x - bridge.centerX;
  const rz = z - bridge.centerZ;
  const along = rx * bridge.dirX + rz * bridge.dirZ;
  if (Math.abs(along) > bridge.length * 0.5 + margin + 1.0) return false;
  const across = -rx * bridge.dirZ + rz * bridge.dirX;
  return Math.abs(across) <= bridge.width * 0.5 + margin;
}

export interface MutableBridgeApproach {
  nearX: number;
  nearZ: number;
  farX: number;
  farZ: number;
  nearDist: number;
}

/** Allocation-free bridge approach query writing into `out`. */
export function getBridgeApproachInto(
  bridge: BridgeInstance,
  x: number,
  z: number,
  out: MutableBridgeApproach,
): MutableBridgeApproach {
  const dStart = Math.hypot(bridge.startX - x, bridge.startZ - z);
  const dEnd = Math.hypot(bridge.endX - x, bridge.endZ - z);
  if (dStart <= dEnd) {
    out.nearX = bridge.startX;
    out.nearZ = bridge.startZ;
    out.farX = bridge.endX;
    out.farZ = bridge.endZ;
    out.nearDist = dStart;
  } else {
    out.nearX = bridge.endX;
    out.nearZ = bridge.endZ;
    out.farX = bridge.startX;
    out.farZ = bridge.startZ;
    out.nearDist = dEnd;
  }
  return out;
}

/** Returns the closer bank abutment and the far bank abutment for a given position. */
export function getBridgeApproach(
  bridge: BridgeInstance,
  x: number,
  z: number,
): { nearX: number; nearZ: number; farX: number; farZ: number; nearDist: number } {
  return getBridgeApproachInto(bridge, x, z, {
    nearX: 0,
    nearZ: 0,
    farX: 0,
    farZ: 0,
    nearDist: 0,
  });
}
