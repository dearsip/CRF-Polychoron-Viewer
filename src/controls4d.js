import * as THREE from 'three';

function arr(v) { return [v.x, v.y, v.z, v.w]; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w; }
function reflect(src, normal) { return src.clone().addScaledVector(normal, -2 * dot(src, normal)); }
function rotateByReflection(src, from, tohalf) { return reflect(reflect(src, from), tohalf); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export class CRFControls4D {
  constructor(domElement, uniforms, options = {}) {
    this.domElement = domElement;
    this.uniforms = uniforms;
    this.axes = [
      uniforms.uAxis1.value,
      uniforms.uAxis2.value,
      uniforms.uAxis3.value,
      uniforms.uAxis4.value
    ];
    this.pointerMap = new Map();
    this.gestureChannel = null;
    this.dragSpeed = 0.002;
    this.wheelZoomSpeed = options.wheelZoomSpeed ?? 0.002;
    this.pinchZoomSpeed = options.pinchZoomSpeed ?? 1.0;
    this.getZoom = options.getZoom ?? (() => 0);
    this.setZoom = options.setZoom ?? (() => {});
    this.minAutoSpeed = 0.03;
    this.maxAutoSpeed = 10.0;
    this.lastAutoCandidate = null;
    this.contextHandler = event => event.preventDefault();
    this.autoReleaseGrace = 0.03;
    this.arcballMaxRadius = 0.8;
    this.useArcball = true;

    domElement.addEventListener('contextmenu', this.contextHandler);
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerUp);
    domElement.addEventListener('pointercancel', this.onPointerUp);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('contextmenu', this.contextHandler);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
  }

  now() {
    return performance.now() * 0.001;
  }

  setUseArcball(enabled) {
    this.useArcball = Boolean(enabled);
  }

  reset() {
    this.axes[0].set(1, 0, 0, 0);
    this.axes[1].set(0, 1, 0, 0);
    this.axes[2].set(0, 0, 1, 0);
    this.axes[3].set(0, 0, 0, 1);
    this.stopAutoRotation();
  }

  stopAutoRotation() {
    this.uniforms.uAutoRot1Speed.value = 0;
    this.uniforms.uAutoRot2Speed.value = 0;
    const t = this.now();
    this.uniforms.uAutoRot1Time.value = t;
    this.uniforms.uAutoRot2Time.value = t;
  }

  commitAutoRotation(channel) {
    const t = this.now();
    if (channel === 1) {
      this.commitAutoRotationChannel(1, t, 0);
      this.commitAutoRotationChannel(2, t, 1);
    }
    else {
      this.commitAutoRotationChannel(1, t, 1);
      this.commitAutoRotationChannel(2, t, 0);
    }
  }

  commitAutoRotationChannel(channel, t = this.now(), cont) {
    const from = this.uniforms[`uAutoRot${channel}From`].value;
    const to = this.uniforms[`uAutoRot${channel}To`].value;
    const speedUniform = this.uniforms[`uAutoRot${channel}Speed`];
    const timeUniform = this.uniforms[`uAutoRot${channel}Time`];
    const speed = speedUniform.value;
    if (Math.abs(speed) > 1e-7) {
      const elapsed = t - timeUniform.value;
      const tohalf = from.clone().multiplyScalar(Math.cos(speed * elapsed))
        .addScaledVector(to, Math.sin(speed * elapsed))
        .normalize();
      for (const axis of this.axes) axis.copy(rotateByReflection(axis, from, tohalf));
    }
    speedUniform.value = speed * cont;
    timeUniform.value = t;
  }

  onPointerDown = (event) => {
    this.domElement.setPointerCapture(event.pointerId);
    const willBeMultiTouch = this.pointerMap.size >= 1;
    const isRightButton = event.button === 2 || (event.buttons & 2) !== 0;
    const nextChannel = (this.gestureChannel === 2 || willBeMultiTouch || isRightButton) ? 2 : 1;

    if (this.gestureChannel !== nextChannel) {
      this.commitAutoRotation(nextChannel);
      this.gestureChannel = nextChannel;
    }
    this.pointerMap.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      lastTime: this.now(),
      arcball: this.useArcball ? this.getArcballFromPointer(event) : null
    });
    this.lastAutoCandidate = null;
  };

  onPointerMove = (event) => {
    const prev = this.pointerMap.get(event.pointerId);
    if (!prev) return;

    const active = this.pointerMap.size;
    const now = this.now();
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    const dt = Math.max(1 / 240, now - prev.lastTime);
    const channel = this.getGestureChannel(prev, event, active);
    if (channel === 2 && active >= 2 && this.handlePinchZoom(event, prev, now, dt)) { return; }

    prev.x = event.clientX;
    prev.y = event.clientY;
    prev.lastTime = now;

    if (Math.abs(dx) + Math.abs(dy) < 0.0001) return;

    if (channel === 2) {
      this.rotate4D(dx, dy, dt, prev.arcball);
    } else {
      this.rotate3D(dx, dy, dt, prev.arcball);
    }
  };

  onPointerUp = (event) => {
    const prev = this.pointerMap.get(event.pointerId);
    this.pointerMap.delete(event.pointerId);
    try { this.domElement.releasePointerCapture(event.pointerId); } catch (_) {}

    if (prev && this.pointerMap.size === 0 && this.lastAutoCandidate) {
      const age = this.now() - this.lastAutoCandidate.time;

      if (age <= this.autoReleaseGrace) {
        this.startAutoRotation(this.lastAutoCandidate);
      }

      this.lastAutoCandidate = null;
      this.gestureChannel = null;
      this.activeManualChannel = null;
    } else if (this.pointerMap.size === 0) {
      this.gestureChannel = null;
      this.activeManualChannel = null;
    }
  };

  getArcballFromPointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);

    let x = (event.clientX - (rect.left + rect.width * 0.5)) / radius;
    let y = -((event.clientY - (rect.top + rect.height * 0.5)) / radius);
    const rawR = Math.hypot(x, y);

    if (rawR < 1e-7) {
      return { ux: 1, uy: 0, s: 0, c: 1 };
    }

    const r = Math.min(rawR / this.arcballMaxRadius, 1);

    return {
      ux: x / rawR,
      uy: y / rawR,
      s: r,
      c: Math.sqrt(Math.max(0, 1 - r * r))
    };
  }

  applyArcballTilt(v, arcball, depthIndex) {
    if (!arcball || Math.abs(arcball.s) < 1e-7) return v.clone();

    const a = arr(v);
    const radial = a[0] * arcball.ux + a[1] * arcball.uy;
    const tangentialX = a[0] - radial * arcball.ux;
    const tangentialY = a[1] - radial * arcball.uy;
    const depth = a[depthIndex];

    // Rotate in the plane spanned by screen-radial direction and depth axis.
    // This maps depthAxis -> s * radial + c * depthAxis.
    const tiltedRadial = arcball.c * radial + arcball.s * depth;
    const tiltedDepth = -arcball.s * radial + arcball.c * depth;

    a[0] = tangentialX + tiltedRadial * arcball.ux;
    a[1] = tangentialY + tiltedRadial * arcball.uy;
    a[depthIndex] = tiltedDepth;
    return new THREE.Vector4(a[0], a[1], a[2], a[3]);
  }

  getGestureChannel(prev, event, activePointerCount) {
    if (this.gestureChannel === 2) return 2;

    const shouldPromoteTo4D = activePointerCount >= 2 || prev.button === 2 || (event.buttons & 2) !== 0;
    if (shouldPromoteTo4D) {
      this.commitAutoRotation(2);
      this.gestureChannel = 2;
      this.lastAutoCandidate = null;
      return 2;
    }

    if (this.gestureChannel == null) this.gestureChannel = 1;
    return this.gestureChannel;
  }

  addZoom(delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-7) return;
    this.setZoom(this.getZoom() + delta);
  }

  handlePinchZoom(event, prev, now, dt) {
    if (this.pointerMap.size < 2) return false;

    const moved = this.pointerMap.get(event.pointerId);
    const otherEntry = [...this.pointerMap.entries()].find(([id]) => id !== event.pointerId);
    if (!moved || !otherEntry) return false;

    const other = otherEntry[1];
    const a = {
      oldX: prev.x,
      oldY: prev.y,
      newX: event.clientX,
      newY: event.clientY
    };
    const b = {
      oldX: other.x,
      oldY: other.y,
      newX: other.x,
      newY: other.y
    };
    const oldDistance = Math.hypot(a.oldX - b.oldX, a.oldY - b.oldY);
    const newDistance = Math.hypot(a.newX - b.newX, a.newY - b.newY);

    let zoomChanged = false;
    if (oldDistance > 1e-3 && newDistance > 1e-3) {
      // zoom is logarithmic: doubling the finger distance increases zoom by 1.
      const zoomDelta = Math.log2(newDistance / oldDistance) * this.pinchZoomSpeed;
      if (Math.abs(zoomDelta) > 1e-7) {
        this.addZoom(zoomDelta);
        zoomChanged = true;
      }
    }

    const oldCenterX = (a.oldX + b.oldX) * 0.5;
    const oldCenterY = (a.oldY + b.oldY) * 0.5;
    const newCenterX = (a.newX + b.newX) * 0.5;
    const newCenterY = (a.newY + b.newY) * 0.5;
    const centerDx = newCenterX - oldCenterX;
    const centerDy = newCenterY - oldCenterY;

    prev.x = event.clientX;
    prev.y = event.clientY;
    prev.lastTime = now;

    if (Math.abs(centerDx) + Math.abs(centerDy) >= 0.0001) {
      this.rotate4D(centerDx, centerDy, dt);
    } else if (zoomChanged) {
      // Pure pinch should not reuse an old flick candidate as inertia.
      this.lastAutoCandidate = null;
    }

    return true;
  }

  onWheel = (event) => {
    event.preventDefault();
    this.addZoom(-event.deltaY * this.wheelZoomSpeed);
  };

  rotate4D(dx, dy, dt, arcball) {
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return;
    const dir = new THREE.Vector3(dx / len, -dy / len, 0);
    const angle = len * this.dragSpeed;

    const from = this.applyArcballTilt(new THREE.Vector4(dir.x, dir.y, 0, 0), arcball, 2).normalize();
    const to = this.applyArcballTilt(new THREE.Vector4(0, 0, 0, 1), arcball, 2).normalize();
    const tohalf = from.clone().multiplyScalar(Math.cos(angle)).addScaledVector(to, Math.sin(angle)).normalize();

    for (const axis of this.axes) axis.copy(rotateByReflection(axis, from, tohalf));

    this.lastAutoCandidate = {
      channel: 2,
      from,
      to,
      speed: clamp(angle / dt, this.minAutoSpeed, this.maxAutoSpeed),
      time: this.now()
    };
  }

  rotate3D(dx, dy, dt, arcball) {
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return;
    const dir = new THREE.Vector3(-dx / len, dy / len, 0);
    const angle = len * this.dragSpeed;

    const from = this.applyArcballTilt(new THREE.Vector4(dir.x, dir.y, 0, 0), arcball, 2).normalize();
    const to = this.applyArcballTilt(new THREE.Vector4(0, 0, 1, 0), arcball, 2).normalize();
    const tohalf = from.clone().multiplyScalar(Math.cos(angle)).addScaledVector(to, Math.sin(angle)).normalize();

    for (const axis of this.axes) axis.copy(rotateByReflection(axis, from, tohalf));

    this.lastAutoCandidate = {
      channel: 1,
      from,
      to,
      speed: clamp(angle / dt, this.minAutoSpeed, this.maxAutoSpeed),
      time: this.now()
    };
  }

  rotatePlaneManual(i, j, angle) {
    for (const axis of this.axes) {
      const a = arr(axis);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const ai = a[i];
      const aj = a[j];
      a[i] = ai * c - aj * s;
      a[j] = ai * s + aj * c;
      axis.set(a[0], a[1], a[2], a[3]);
    }
  }

  startAutoRotation(candidate) {
    const speed = candidate.speed;
    if (!Number.isFinite(speed) || Math.abs(speed) < this.minAutoSpeed) return;

    const channel = candidate.channel;
    this.uniforms[`uAutoRot${channel}From`].value.copy(candidate.from).normalize();
    this.uniforms[`uAutoRot${channel}To`].value.copy(candidate.to).normalize();
    this.uniforms[`uAutoRot${channel}Speed`].value = speed;
    this.uniforms[`uAutoRot${channel}Time`].value = this.now();
  }
}
