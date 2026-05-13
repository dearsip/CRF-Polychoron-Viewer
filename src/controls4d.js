import * as THREE from 'three';

function arr(v) { return [v.x, v.y, v.z, v.w]; }
function vec4(a) { return new THREE.Vector4(a[0], a[1], a[2], a[3]); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w; }
function reflect(src, normal) {
  return src.clone().addScaledVector(normal, -2 * dot(src, normal));
}
function rotateByReflection(src, from, tohalf) {
  return reflect(reflect(src, from), tohalf);
}
function rotatePlane(v, i, j, angle) {
  const a = arr(v);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ai = a[i];
  const aj = a[j];
  a[i] = ai * c - aj * s;
  a[j] = ai * s + aj * c;
  v.set(a[0], a[1], a[2], a[3]);
}

export class CRFControls4D {
  constructor(domElement, uniforms) {
    this.domElement = domElement;
    this.uniforms = uniforms;
    this.axes = [
      uniforms.uAxis1.value,
      uniforms.uAxis2.value,
      uniforms.uAxis3.value,
      uniforms.uAxis4.value
    ];
    this.pointerMap = new Map();
    this.primaryMode = 'xw-yw';
    this.secondaryMode = 'visible3d';
    this.dragSpeed = 0.006;
    this.wheelSpeed = 0.0015;

    domElement.addEventListener('contextmenu', e => e.preventDefault());
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerUp);
    domElement.addEventListener('pointercancel', this.onPointerUp);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('contextmenu', e => e.preventDefault());
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
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
  }

  onPointerDown = (event) => {
    this.domElement.setPointerCapture(event.pointerId);
    this.pointerMap.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      button: event.button
    });
    this.stopAutoRotation();
  };

  onPointerMove = (event) => {
    const prev = this.pointerMap.get(event.pointerId);
    if (!prev) return;

    const active = this.pointerMap.size;
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    prev.x = event.clientX;
    prev.y = event.clientY;

    if (Math.abs(dx) + Math.abs(dy) < 0.0001) return;

    if (active >= 2 || prev.button === 2 || event.buttons === 2) {
      this.rotate4D(dx, dy);
    } else {
      this.rotate3D(dx, dy);
    }
  };

  onPointerUp = (event) => {
    this.pointerMap.delete(event.pointerId);
    try { this.domElement.releasePointerCapture(event.pointerId); } catch (_) {}
  };

  onWheel = (event) => {
    event.preventDefault();
    this.stopAutoRotation();
    const angle = event.deltaY * this.wheelSpeed;
    for (const axis of this.axes) rotatePlane(axis, 2, 3, -angle);
  };

  rotate4D(dx, dy) {
    const sx = dx * this.dragSpeed;
    const sy = dy * this.dragSpeed;
    for (const axis of this.axes) {
      rotatePlane(axis, 0, 3, sx);
      rotatePlane(axis, 1, 3, -sy);
    }
  }

  rotate3D(dx, dy) {
    const sx = dx * this.dragSpeed;
    const sy = dy * this.dragSpeed;
    for (const axis of this.axes) {
      rotatePlane(axis, 0, 2, -sx);
      rotatePlane(axis, 1, 2, sy);
    }
  }
}
