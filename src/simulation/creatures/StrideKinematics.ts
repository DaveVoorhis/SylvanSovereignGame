import type { LocomotionKind } from '@core/Types';

/** Local vertical distance from hip pivot to flat foot sole in CreatureRenderer bodyGroup units. */
export const CREATURE_LEG_LENGTH = 0.27;

export interface StrideMetrics {
  /** Pace blend in [0, 1] (0 = calm stroll, ~0.55 = steady walk, 1 = brisk run). */
  readonly pace: number;
  /** Running blend in [0, 1] (0 = stroll/walk, 1 = full run). */
  readonly runFactor: number;
  /** Half of the foot's fore-aft ground-contact travel in local bodyGroup units (+halfStride -> -halfStride). */
  readonly halfStrideLocal: number;
  /** Fraction of one full stride cycle [0, 1) that each foot stays planted on the ground. */
  readonly dutyFactor: number;
  /** Peak swing-phase foot lift height above ground in local bodyGroup units. */
  readonly liftHeightLocal: number;
  /** Exact world-space horizontal distance covered per full 2π stride cycle for zero foot slip. */
  readonly cycleLengthWorld: number;
}

export interface MutableStrideMetrics {
  pace: number;
  runFactor: number;
  halfStrideLocal: number;
  dutyFactor: number;
  liftHeightLocal: number;
  cycleLengthWorld: number;
}

export interface FootTrajectorySample {
  /** Sole fore-aft offset relative to baseFootZ in local bodyGroup units (+Z = forward, -Z = back). */
  readonly zRel: number;
  /** Sole vertical lift above the ground plane in local bodyGroup units (0 during stance). */
  readonly yLift: number;
  /** True while the foot is planted in ground contact (moving backward at exact -1:1 body speed). */
  readonly inStance: boolean;
}

export interface MutableFootTrajectorySample {
  zRel: number;
  yLift: number;
  inStance: boolean;
}

export interface HopCycleSample extends FootTrajectorySample {
  /** Ballistic vertical hop arc offset for bodyGroup in local units (0 during ground push-off). */
  readonly bodyHopLocalY: number;
  /** Normalized crouch compression in [0, 1] during ground contact before launch. */
  readonly crouch: number;
}

export interface MutableHopCycleSample extends MutableFootTrajectorySample {
  bodyHopLocalY: number;
  crouch: number;
}

export interface FootPose {
  readonly rotX: number;
  readonly hipY: number;
  readonly hipZ: number;
}

export interface MutableFootPose {
  rotX: number;
  hipY: number;
  hipZ: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function positiveMod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/**
 * Computes physically reconciled stride parameters so that during stance phase,
 * a planted foot sweeps backward at the exact same speed the creature moves forward.
 */
export function computeStrideMetricsInto(
  locomotion: LocomotionKind,
  gaitEffort: number,
  scaleXZ: number,
  out: MutableStrideMetrics,
): MutableStrideMetrics {
  const pace = clamp((gaitEffort - 0.32) / 0.96, 0, 1);
  const runFactor = clamp((gaitEffort - 0.95) / 0.4, 0, 1);
  const safeScale = Math.max(0.25, scaleXZ);

  out.pace = pace;
  out.runFactor = runFactor;
  if (locomotion === 'hop') {
    const halfStrideLocal = 0.19 + pace * 0.12;
    const dutyFactor = 0.36 - runFactor * 0.05;
    out.halfStrideLocal = halfStrideLocal;
    out.dutyFactor = dutyFactor;
    out.liftHeightLocal = 0.055 + pace * 0.055;
    out.cycleLengthWorld = (2 * halfStrideLocal * safeScale) / dutyFactor;
    return out;
  }
  if (locomotion === 'slither') {
    out.halfStrideLocal = 0.18 + pace * 0.08;
    out.dutyFactor = 0.5;
    out.liftHeightLocal = 0;
    out.cycleLengthWorld = (0.78 + pace * 0.22) * safeScale;
    return out;
  }
  const halfStrideLocal = 0.15 + pace * 0.15;
  const dutyFactor = 0.5 - runFactor * 0.04;
  out.halfStrideLocal = halfStrideLocal;
  out.dutyFactor = dutyFactor;
  out.liftHeightLocal = 0.044 + pace * 0.062;
  out.cycleLengthWorld = (2 * halfStrideLocal * safeScale) / dutyFactor;
  return out;
}

/** Allocation-free scalar helper returning exact world-space distance per 2π stride cycle. */
export function computeStrideCycleLengthWorld(
  locomotion: LocomotionKind,
  gaitEffort: number,
  scaleXZ: number,
): number {
  const pace = clamp((gaitEffort - 0.32) / 0.96, 0, 1);
  const runFactor = clamp((gaitEffort - 0.95) / 0.4, 0, 1);
  const safeScale = Math.max(0.25, scaleXZ);
  if (locomotion === 'hop') {
    return (2 * (0.19 + pace * 0.12) * safeScale) / (0.36 - runFactor * 0.05);
  }
  if (locomotion === 'slither') {
    return (0.78 + pace * 0.22) * safeScale;
  }
  return (2 * (0.15 + pace * 0.15) * safeScale) / (0.5 - runFactor * 0.04);
}

/**
 * Computes physically reconciled stride parameters so that during stance phase,
 * a planted foot sweeps backward at the exact same speed the creature moves forward.
 */
export function computeStrideMetrics(
  locomotion: LocomotionKind,
  gaitEffort: number,
  scaleXZ: number,
): StrideMetrics {
  const pace = clamp((gaitEffort - 0.32) / 0.96, 0, 1);
  const runFactor = clamp((gaitEffort - 0.95) / 0.4, 0, 1);
  const safeScale = Math.max(0.25, scaleXZ);

  if (locomotion === 'hop') {
    const halfStrideLocal = 0.19 + pace * 0.12;
    const dutyFactor = 0.36 - runFactor * 0.05;
    const liftHeightLocal = 0.055 + pace * 0.055;
    const cycleLengthWorld = (2 * halfStrideLocal * safeScale) / dutyFactor;
    return {
      pace,
      runFactor,
      halfStrideLocal,
      dutyFactor,
      liftHeightLocal,
      cycleLengthWorld,
    };
  }

  if (locomotion === 'slither') {
    const halfStrideLocal = 0.18 + pace * 0.08;
    const dutyFactor = 0.5;
    const cycleLengthWorld = (0.78 + pace * 0.22) * safeScale;
    return {
      pace,
      runFactor,
      halfStrideLocal,
      dutyFactor,
      liftHeightLocal: 0,
      cycleLengthWorld,
    };
  }

  // Bipedal ground locomotion (walk, scurry, ground-walking birds, land-walking amphibians/aquatics)
  const halfStrideLocal = 0.15 + pace * 0.15;
  const dutyFactor = 0.5 - runFactor * 0.04;
  const liftHeightLocal = 0.044 + pace * 0.062;
  const cycleLengthWorld = (2 * halfStrideLocal * safeScale) / dutyFactor;
  return {
    pace,
    runFactor,
    halfStrideLocal,
    dutyFactor,
    liftHeightLocal,
    cycleLengthWorld,
  };
}

/**
 * Samples one foot's local sole trajectory over a 2π stride cycle:
 * - phase = π/2 -> heel-strike (u = 0, foot forward at +halfStride, locked to ground)
 * - stance [0, dutyFactor): linear backward sweep at constant velocity matching ground motion
 * - swing [dutyFactor, 1): smooth elevated return arc back to +halfStride
 */
export function sampleFootTrajectoryInto(
  phaseRad: number,
  halfStrideLocal: number,
  dutyFactor: number,
  liftHeightLocal: number,
  out: MutableFootTrajectorySample,
): MutableFootTrajectorySample {
  const u = positiveMod((phaseRad - Math.PI * 0.5) / (Math.PI * 2), 1);

  if (u < dutyFactor) {
    const s = u / dutyFactor;
    out.zRel = halfStrideLocal * (1 - 2 * s);
    out.yLift = 0;
    out.inStance = true;
    return out;
  }

  const w = (u - dutyFactor) / (1 - dutyFactor);
  out.zRel = -halfStrideLocal * Math.cos(Math.PI * w);
  out.yLift = liftHeightLocal * Math.pow(Math.sin(Math.PI * w), 1.15);
  out.inStance = false;
  return out;
}

export function sampleFootTrajectory(
  phaseRad: number,
  halfStrideLocal: number,
  dutyFactor: number,
  liftHeightLocal: number,
): FootTrajectorySample {
  const u = positiveMod((phaseRad - Math.PI * 0.5) / (Math.PI * 2), 1);

  if (u < dutyFactor) {
    const s = u / dutyFactor;
    return {
      zRel: halfStrideLocal * (1 - 2 * s),
      yLift: 0,
      inStance: true,
    };
  }

  const w = (u - dutyFactor) / (1 - dutyFactor);
  return {
    zRel: -halfStrideLocal * Math.cos(Math.PI * w),
    yLift: liftHeightLocal * Math.pow(Math.sin(Math.PI * w), 1.15),
    inStance: false,
  };
}

/**
 * Samples a synchronized hopping cycle (rabbits & frogs):
 * - Ground contact [0, dutyFactor): hind feet locked 1:1 to ground while crouching to spring
 * - Airborne arc [dutyFactor, 1): parabolic ballistic hop while hind feet reach forward for landing
 */
export function sampleHopCycleInto(
  phaseRad: number,
  halfStrideLocal: number,
  dutyFactor: number,
  liftHeightLocal: number,
  hopBodyHeightLocal: number,
  out: MutableHopCycleSample,
): MutableHopCycleSample {
  const u = positiveMod((phaseRad - Math.PI * 0.5) / (Math.PI * 2), 1);

  if (u < dutyFactor) {
    const s = u / dutyFactor;
    out.zRel = halfStrideLocal * (1 - 2 * s);
    out.yLift = 0;
    out.bodyHopLocalY = 0;
    out.crouch = Math.sin(Math.PI * s);
    out.inStance = true;
    return out;
  }

  const w = (u - dutyFactor) / (1 - dutyFactor);
  const bodyHopLocalY = 4 * w * (1 - w) * hopBodyHeightLocal;
  out.zRel = -halfStrideLocal * Math.cos(Math.PI * w);
  out.yLift = bodyHopLocalY + Math.sin(Math.PI * w) * liftHeightLocal;
  out.bodyHopLocalY = bodyHopLocalY;
  out.crouch = 0;
  out.inStance = false;
  return out;
}

export function sampleHopCycle(
  phaseRad: number,
  halfStrideLocal: number,
  dutyFactor: number,
  liftHeightLocal: number,
  hopBodyHeightLocal: number,
): HopCycleSample {
  const u = positiveMod((phaseRad - Math.PI * 0.5) / (Math.PI * 2), 1);

  if (u < dutyFactor) {
    const s = u / dutyFactor;
    return {
      zRel: halfStrideLocal * (1 - 2 * s),
      yLift: 0,
      bodyHopLocalY: 0,
      crouch: Math.sin(Math.PI * s),
      inStance: true,
    };
  }

  const w = (u - dutyFactor) / (1 - dutyFactor);
  const bodyHopLocalY = 4 * w * (1 - w) * hopBodyHeightLocal;
  return {
    zRel: -halfStrideLocal * Math.cos(Math.PI * w),
    yLift: bodyHopLocalY + Math.sin(Math.PI * w) * liftHeightLocal,
    bodyHopLocalY,
    crouch: 0,
    inStance: false,
  };
}

/**
 * Inverse-kinematics placement for a foot pivot inside bodyGroup so that its sole contact point
 * (0, -CREATURE_LEG_LENGTH, 0) lands at exact rig.root-space coordinates (z = baseFootZ + zRel, y = yLift),
 * compensating identically for torso vertical bob (bobY), forward lean (tiltX), and squash/stretch scale.
 */
export function solveGroundedFootTransformInto(
  zRel: number,
  yLift: number,
  pace: number,
  baseFootZ: number,
  bobY: number,
  tiltX: number,
  scaleY: number,
  scaleXZ: number,
  out: MutableFootPose,
): MutableFootPose {
  const safeScaleY = Math.max(0.2, scaleY);
  const safeScaleXZ = Math.max(0.2, scaleXZ);

  const zRootTarget = safeScaleXZ * (baseFootZ + zRel);
  const yRootTarget = safeScaleY * yLift;

  const dy = yRootTarget - bobY;
  const dz = zRootTarget;
  const cosT = Math.cos(tiltX);
  const sinT = Math.sin(tiltX);
  const yScaled = dy * cosT + dz * sinT;
  const zScaled = -dy * sinT + dz * cosT;

  const yBg = yScaled / safeScaleY;
  const zBg = zScaled / safeScaleXZ;

  const rotFraction = 0.72 + pace * 0.1;
  const sinTheta = clamp((zRel * rotFraction) / CREATURE_LEG_LENGTH, -0.78, 0.78);
  const rotX = -Math.asin(sinTheta);

  const toeOffClearance = Math.max(0, Math.sin(rotX)) * 0.04;
  out.rotX = rotX;
  out.hipZ = zBg + CREATURE_LEG_LENGTH * Math.sin(rotX);
  out.hipY = yBg + CREATURE_LEG_LENGTH * Math.cos(rotX) + toeOffClearance;
  return out;
}

export function solveGroundedFootTransform(params: {
  readonly zRel: number;
  readonly yLift: number;
  readonly pace: number;
  readonly baseFootZ: number;
  readonly bobY: number;
  readonly tiltX: number;
  readonly scaleY: number;
  readonly scaleXZ: number;
}): FootPose {
  const { zRel, yLift, pace, baseFootZ, bobY, tiltX, scaleY, scaleXZ } = params;
  const safeScaleY = Math.max(0.2, scaleY);
  const safeScaleXZ = Math.max(0.2, scaleXZ);

  // Desired sole position in rig.root space (y = 0 is exact ground contact)
  const zRootTarget = safeScaleXZ * (baseFootZ + zRel);
  const yRootTarget = safeScaleY * yLift;

  // Invert bodyGroup's translation (bobY) and forward pitch (tiltX)
  const dy = yRootTarget - bobY;
  const dz = zRootTarget;
  const cosT = Math.cos(tiltX);
  const sinT = Math.sin(tiltX);
  const yScaled = dy * cosT + dz * sinT;
  const zScaled = -dy * sinT + dz * cosT;

  const yBg = yScaled / safeScaleY;
  const zBg = zScaled / safeScaleXZ;

  // Allocate stride reach cleanly between natural hip swing angle and subtle pelvis reach under the tunic
  const rotFraction = 0.72 + pace * 0.1;
  const sinTheta = clamp((zRel * rotFraction) / CREATURE_LEG_LENGTH, -0.78, 0.78);
  const rotX = -Math.asin(sinTheta);

  // Slight rear-stance clearance so forward-projecting toes stay flush on ground at toe-off
  const toeOffClearance = Math.max(0, Math.sin(rotX)) * 0.04;
  const hipZ = zBg + CREATURE_LEG_LENGTH * Math.sin(rotX);
  const hipY = yBg + CREATURE_LEG_LENGTH * Math.cos(rotX) + toeOffClearance;

  return { rotX, hipY, hipZ };
}
