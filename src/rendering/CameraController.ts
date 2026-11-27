import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec2, Vec3 } from '@core/Types';

export type CameraMode = 'world' | 'creature_pov';

export interface CreaturePovPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly eyeHeight: number;
  readonly bobOffset: number;
  /** Optional gentle lateral footstep weight-shift sway (meters, perpendicular to heading). */
  readonly swayOffset?: number;
  readonly alive: boolean;
}

const WORLD_FOV = 46;
const WORLD_NEAR = 0.22;
const POV_FOV = 64;
const POV_NEAR = 0.12;

/**
 * Smooth spectator camera controller supporting:
 * - Orbital world exploration (drag, scroll, WASD/arrows, cinematic drift)
 * - Invisible circular soft-boundary easing that keeps the endless horizon seamless
 * - Smooth fly-to transitions and third-person follow lock
 * - First-person Creature Eye View (POV) with drag look-around and seamless return to world view
 */
export class CameraController {
  readonly controls: OrbitControls;
  cinematicDrift = false;

  private softBoundaryRadius = 504;
  private maxBoundaryRadius = 560;
  private worldSize = 1120;
  private mode: CameraMode = 'world';
  private readonly keys = new Set<string>();
  private desiredTarget: THREE.Vector3 | null = null;
  private desiredPosition: THREE.Vector3 | null = null;
  private followProvider: (() => Vec3 | null) | null = null;

  // Creature Eye-View (POV) state
  private povProvider: (() => CreaturePovPose | null) | null = null;
  private povLookYaw = 0;
  private povLookPitch = -0.04;
  private povSmoothedHeading = 0;
  private povHeadingVel = 0;
  private povSmoothedBob = 0;
  private povSmoothedSway = 0;
  private povInitialized = false;
  private povDragging = false;
  private povLastPointerX = 0;
  private povLastPointerY = 0;
  private savedWorldPos: THREE.Vector3 | null = null;
  private savedWorldTarget: THREE.Vector3 | null = null;
  private readonly tmpNextTarget = new THREE.Vector3();
  private readonly tmpDelta = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpMove = new THREE.Vector3();

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: () => void;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.maxPolarAngle = Math.PI * 0.468;
    this.controls.minPolarAngle = 0.18;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 1550;
    this.controls.panSpeed = 0.9;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.95;

    this.camera.position.set(42, 34, 52);
    this.controls.target.set(0, 2, 0);
    this.controls.update();

    this.onKeyDownBound = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (
        this.mode === 'world' &&
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
          e.code,
        )
      ) {
        this.followProvider = null;
        this.desiredTarget = null;
        this.desiredPosition = null;
      }
    };
    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    this.onPointerDownBound = (e: PointerEvent) => {
      if (this.mode !== 'creature_pov' || e.button !== 0) return;
      this.povDragging = true;
      this.povLastPointerX = e.clientX;
      this.povLastPointerY = e.clientY;
    };
    this.onPointerMoveBound = (e: PointerEvent) => {
      if (this.mode !== 'creature_pov' || !this.povDragging) return;
      const dx = e.clientX - this.povLastPointerX;
      const dy = e.clientY - this.povLastPointerY;
      this.povLastPointerX = e.clientX;
      this.povLastPointerY = e.clientY;

      this.povLookYaw = THREE.MathUtils.clamp(this.povLookYaw - dx * 0.0055, -2.2, 2.2);
      this.povLookPitch = THREE.MathUtils.clamp(this.povLookPitch - dy * 0.0045, -0.68, 0.85);
    };
    this.onPointerUpBound = () => {
      this.povDragging = false;
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    domElement.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);

    this.controls.addEventListener('start', () => {
      this.desiredPosition = null;
      this.desiredTarget = null;
    });
  }

  /** Scales soft circular exploration boundaries and zoom ceiling to match the current world size. */
  setWorldSize(worldSize: number): void {
    this.worldSize = worldSize;
    this.softBoundaryRadius = worldSize * 0.45;
    this.maxBoundaryRadius = worldSize * 0.5;
    this.controls.maxDistance = Math.max(320, worldSize * 1.38);
  }

  getMode(): CameraMode {
    return this.mode;
  }

  isInCreaturePov(): boolean {
    return this.mode === 'creature_pov';
  }

  /** Dynamic focal plane distance for the Distance Focus Blur post-processing pass. */
  getFocusDistance(): number {
    if (this.mode === 'creature_pov') {
      return 16.0;
    }
    return this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * World-space focus anchor for directional shadow frustums, local weather/fireflies,
   * and hearth light prioritization. In Creature Eye View, tracks a point ahead of the
   * creature along its horizontal gaze instead of the paused World View orbit target.
   */
  getFocusTarget(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    if (this.mode === 'creature_pov') {
      const yaw = this.povSmoothedHeading + this.povLookYaw;
      const ahead = 16.0;
      return out.set(
        this.camera.position.x + Math.sin(yaw) * ahead,
        this.camera.position.y,
        this.camera.position.z + Math.cos(yaw) * ahead,
      );
    }
    return out.copy(this.controls.target);
  }

  /** Enters first-person eye view of a creature. */
  enterCreaturePov(provider: () => CreaturePovPose | null): void {
    if (this.mode !== 'creature_pov') {
      this.savedWorldPos = this.camera.position.clone();
      this.savedWorldTarget = this.controls.target.clone();
    }
    this.mode = 'creature_pov';
    this.followProvider = null;
    this.desiredPosition = null;
    this.desiredTarget = null;
    this.controls.enabled = false;
    this.povProvider = provider;
    this.povLookYaw = 0;
    this.povLookPitch = -0.04;
    this.povHeadingVel = 0;
    this.povSmoothedBob = 0;
    this.povSmoothedSway = 0;
    this.povInitialized = false;
    this.povDragging = false;

    this.camera.fov = POV_FOV;
    this.camera.near = POV_NEAR;
    this.camera.updateProjectionMatrix();
  }

  /** Exits first-person eye view and smoothly restores the orbital world camera. */
  exitCreaturePov(restoreSavedView = true): void {
    if (this.mode !== 'creature_pov') return;
    this.mode = 'world';
    this.povProvider = null;
    this.povDragging = false;
    this.povHeadingVel = 0;
    this.povSmoothedBob = 0;
    this.povSmoothedSway = 0;
    this.povInitialized = false;
    this.controls.enabled = true;

    this.camera.fov = WORLD_FOV;
    this.camera.near = WORLD_NEAR;
    this.camera.updateProjectionMatrix();

    if (restoreSavedView && this.savedWorldPos && this.savedWorldTarget) {
      this.desiredPosition = this.savedWorldPos.clone();
      this.desiredTarget = this.savedWorldTarget.clone();
      this.controls.target.copy(this.camera.position);
      this.controls.update();
    } else {
      this.resetOverview();
    }
  }

  flyTo(target: Vec2, heightY = 2.0, distance = 22): void {
    if (this.mode === 'creature_pov') {
      this.exitCreaturePov(false);
    }
    this.followProvider = null;
    this.desiredTarget = new THREE.Vector3(target.x, heightY, target.z);
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    if (dir.lengthSq() < 0.001) dir.set(0.6, 0.55, 0.6).normalize();
    dir.y = Math.max(0.45, Math.min(0.75, dir.y));
    dir.normalize();
    this.desiredPosition = this.desiredTarget.clone().addScaledVector(dir, distance);
  }

  follow(provider: (() => Vec3 | null) | null, initialCameraPos?: Vec3): void {
    if (this.mode === 'creature_pov' && provider) {
      this.exitCreaturePov(false);
    }
    this.followProvider = provider;
    this.desiredTarget = null;
    this.desiredPosition = null;
    if (provider && initialCameraPos) {
      const pos = provider();
      if (pos) {
        this.controls.target.set(pos.x, pos.y + 0.9, pos.z);
        this.camera.position.set(initialCameraPos.x, initialCameraPos.y, initialCameraPos.z);
        this.controls.update();
      }
    }
  }

  isFollowing(): boolean {
    return this.followProvider !== null;
  }

  resetOverview(): void {
    if (this.mode === 'creature_pov') {
      this.exitCreaturePov(false);
    }
    this.followProvider = null;
    // Frame the sea in the foreground (+Z), amorphous heartland in the middle, and craggy alpine range in the back (-Z)
    this.desiredTarget = new THREE.Vector3(0, 10, -25);
    this.desiredPosition = new THREE.Vector3(
      this.worldSize * 0.14,
      this.worldSize * 0.58,
      this.worldSize * 0.78,
    );
  }

  getWorldViewState(): { position: Vec3; target: Vec3; cinematicDrift: boolean } {
    const pos = this.mode === 'creature_pov' && this.savedWorldPos ? this.savedWorldPos : this.camera.position;
    const tgt = this.mode === 'creature_pov' && this.savedWorldTarget ? this.savedWorldTarget : this.controls.target;
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      target: { x: tgt.x, y: tgt.y, z: tgt.z },
      cinematicDrift: this.cinematicDrift,
    };
  }

  setWorldViewState(view: { position: Vec3; target: Vec3; cinematicDrift?: boolean }): void {
    if (this.mode === 'creature_pov') {
      this.exitCreaturePov(false);
    }
    this.followProvider = null;
    this.desiredPosition = null;
    this.desiredTarget = null;
    this.camera.position.set(view.position.x, view.position.y, view.position.z);
    this.controls.target.set(view.target.x, view.target.y, view.target.z);
    if (view.cinematicDrift !== undefined) {
      this.cinematicDrift = view.cinematicDrift;
    }
    this.controls.update();
  }

  update(dt: number): void {
    if (this.mode === 'creature_pov') {
      this.updateCreaturePov(dt);
      return;
    }

    // 1. Follow locked creature or settlement (third-person)
    if (this.followProvider) {
      const pos = this.followProvider();
      if (pos) {
        const nextTarget = this.tmpNextTarget.set(pos.x, pos.y + 0.9, pos.z);
        const delta = this.tmpDelta.subVectors(nextTarget, this.controls.target);
        const lerpAmt = 1 - Math.exp(-6.5 * Math.max(0, Math.min(dt, 0.1)));
        this.controls.target.addScaledVector(delta, lerpAmt);
        this.camera.position.addScaledVector(delta, lerpAmt);
      } else {
        this.followProvider = null;
      }
    }

    // 2. Smooth fly-to transition
    if (this.desiredTarget && this.desiredPosition) {
      const alpha = Math.min(1, dt * 4.5);
      this.controls.target.lerp(this.desiredTarget, alpha);
      this.camera.position.lerp(this.desiredPosition, alpha);
      if (
        this.controls.target.distanceTo(this.desiredTarget) < 0.35 &&
        this.camera.position.distanceTo(this.desiredPosition) < 0.8
      ) {
        this.desiredTarget = null;
        this.desiredPosition = null;
      }
    }

    // 3. Keyboard WASD / Arrow panning relative to camera yaw (scales smoothly with zoom altitude)
    if (this.keys.size > 0) {
      const camDist = this.camera.position.distanceTo(this.controls.target);
      const panSpeed = (32 + camDist * 0.52) * dt;
      const forward = this.tmpForward;
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = this.tmpRight.crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
      const move = this.tmpMove.set(0, 0, 0);

      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right);

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(panSpeed);
        this.camera.position.add(move);
        this.controls.target.add(move);
      }
    }

    // 4. Optional slow cinematic spectator orbit
    if (this.cinematicDrift && !this.desiredPosition) {
      const offset = this.tmpDelta.subVectors(this.camera.position, this.controls.target);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dt * 0.085);
      this.camera.position.copy(this.controls.target).add(offset);
    }

    // 5. Invisible circular soft boundary: gently cushions target back toward the valley without hard edges
    const tx = this.controls.target.x;
    const tz = this.controls.target.z;
    const radialDist = Math.hypot(tx, tz);
    if (radialDist > this.softBoundaryRadius && radialDist > 0.001) {
      const clampedR = Math.min(radialDist, this.maxBoundaryRadius);
      const springT = Math.min(1, dt * 2.8);
      const targetR = THREE.MathUtils.lerp(clampedR, this.softBoundaryRadius, springT * 0.55);
      const scale = targetR / radialDist;
      const newX = tx * scale;
      const newZ = tz * scale;
      const pullX = newX - tx;
      const pullZ = newZ - tz;
      this.controls.target.x = newX;
      this.controls.target.z = newZ;
      this.camera.position.x += pullX;
      this.camera.position.z += pullZ;
    }

    this.controls.update();
  }

  private updateCreaturePov(dt: number): void {
    const pose = this.povProvider?.();
    if (!pose || !pose.alive) {
      return;
    }

    const safeDt = Math.max(0.001, Math.min(dt, 0.08));

    if (!this.povInitialized) {
      this.povSmoothedHeading = pose.heading;
      this.povHeadingVel = 0;
      this.povSmoothedBob = pose.bobOffset;
      this.povSmoothedSway = pose.swayOffset ?? 0;
      this.camera.position.set(
        pose.x + Math.sin(pose.heading) * 0.25,
        pose.y + pose.eyeHeight + pose.bobOffset,
        pose.z + Math.cos(pose.heading) * 0.25,
      );
      this.povInitialized = true;
    } else {
      let err = pose.heading - this.povSmoothedHeading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;

      // Critically damped angular spring filters micro-jitter while keeping turns fluid and overshoot-free
      const omega = 5.4;
      const x0 = -err;
      const v0 = this.povHeadingVel;
      const expTerm = Math.exp(-omega * safeDt);
      const temp = (v0 + omega * x0) * safeDt;
      const nextX = (x0 + temp) * expTerm;
      let nextVel = (v0 - omega * temp) * expTerm;
      let step = nextX - x0;
      const maxStep = 3.2 * safeDt;
      if (Math.abs(step) > maxStep) {
        const sign = step >= 0 ? 1 : -1;
        step = sign * maxStep;
        nextVel = sign * 3.2;
      }
      this.povHeadingVel = nextVel;
      this.povSmoothedHeading += step;
      while (this.povSmoothedHeading > Math.PI) this.povSmoothedHeading -= Math.PI * 2;
      while (this.povSmoothedHeading < -Math.PI) this.povSmoothedHeading += Math.PI * 2;

      if (!this.povDragging) {
        this.povLookYaw *= Math.exp(-0.22 * safeDt);
      }

      this.povSmoothedBob += (pose.bobOffset - this.povSmoothedBob) * (1 - Math.exp(-7.0 * safeDt));
      const desiredSway = pose.swayOffset ?? 0;
      this.povSmoothedSway += (desiredSway - this.povSmoothedSway) * (1 - Math.exp(-7.0 * safeDt));

      const fwdX = Math.sin(this.povSmoothedHeading);
      const fwdZ = Math.cos(this.povSmoothedHeading);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const targetX = pose.x + fwdX * 0.28 + rightX * this.povSmoothedSway;
      const targetY = pose.y + pose.eyeHeight + this.povSmoothedBob;
      const targetZ = pose.z + fwdZ * 0.28 + rightZ * this.povSmoothedSway;

      const xzLerp = 1 - Math.exp(-9.5 * safeDt);
      const yLerp = 1 - Math.exp(-6.5 * safeDt);
      this.camera.position.x += (targetX - this.camera.position.x) * xzLerp;
      this.camera.position.y += (targetY - this.camera.position.y) * yLerp;
      this.camera.position.z += (targetZ - this.camera.position.z) * xzLerp;
    }

    const yaw = this.povSmoothedHeading + this.povLookYaw;
    const pitch = this.povLookPitch;
    const lookDist = 14;
    const cosPitch = Math.cos(pitch);
    const lookX = this.camera.position.x + Math.sin(yaw) * cosPitch * lookDist;
    const lookY = this.camera.position.y + Math.sin(pitch) * lookDist;
    const lookZ = this.camera.position.z + Math.cos(yaw) * cosPitch * lookDist;

    this.camera.lookAt(lookX, lookY, lookZ);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    this.controls.dispose();
  }
}
