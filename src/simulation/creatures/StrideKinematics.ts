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

export interface FootTrajectorySample {
  /** Sole fore-aft offset relative to baseFootZ in local bodyGroup units (+Z = forward, -Z = back). */
  readonly zRel: number;
  /** Sole vertical lift above the ground plane in local bodyGroup units (0 during stance). */
  readonly yLift: number;
  /** True while the foot is planted in ground contact (moving backward at exact -1:1 body speed). */
  readonly inStance: boolean;
}

export interface HopCycleSample extends FootTrajectorySample {
  /** Ballistic vertical hop arc offset for bodyGroup in local units (0 during ground push-off). */
  readonly bodyHopLocalY: number;
  /** Normalized crouch compression in [0, 1] during ground contact before launch. */
  readonly crouch: number;
}

export interface FootPose {
  readonly rotX: number;
  readonly hipY: number;
  readonly hipZ: number;
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
