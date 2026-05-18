import * as THREE from 'three';
import { buildRenderMeshFromOFF, meshToJson, roundMesh } from './crf-mesh.js';
import { crfVertexShader, crfFragmentShader } from './crf-shader.js';
import { CRFControls4D } from './controls4d.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const canvas = $('viewer');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xf4f4f4, 1);

const scene = new THREE.Scene();
const defaultFov3 = 38;
let zoom = clampZoom(params.get('zoom') ?? 0);

function getBaseFov3() {
  return defaultFov3 * Math.pow(2, -zoom);
}

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(8, Math.max(0, n));
}

const camera = new THREE.PerspectiveCamera(getBaseFov3(), 1, 0.01, 100);
camera.position.set(0, 0, 7);
camera.lookAt(0, 0, 0);

const stereoCamera = new THREE.StereoCamera();
stereoCamera.eyeSep = Number(params.get('eyeSep') ?? 0.3);
stereoCamera.aspect = 0.5;

const stereoFocusPoint = new THREE.Vector3(0, 0, 0);
const cameraWorldPos = new THREE.Vector3();

function updateStereoFocus() {
  camera.getWorldPosition(cameraWorldPos);
  camera.focus = cameraWorldPos.distanceTo(stereoFocusPoint);
}

const startTime = performance.now() * 0.001;
const autoRot1Speed = getNumberParam('autoRot1Speed', 0);
const autoRot2Speed = getNumberParam('autoRot2Speed', 0);
const uniforms = {
  uFoV: { value: Number(params.get('fov') ?? 0) },
  uFilter: { value: Number(params.get('filter') ?? -90) },
  uAxis1: { value: getVector4Param('axis1', new THREE.Vector4(1, 0, 0, 0), true) },
  uAxis2: { value: getVector4Param('axis2', new THREE.Vector4(0, 1, 0, 0), true) },
  uAxis3: { value: getVector4Param('axis3', new THREE.Vector4(0, 0, 1, 0), true) },
  uAxis4: { value: getVector4Param('axis4', new THREE.Vector4(0, 0, 0, 1), true) },
  uAutoRot1From: { value: getVector4Param('autoRot1From', new THREE.Vector4(0, 0, 0, -1), true) },
  uAutoRot1To: { value: getVector4Param('autoRot1To', new THREE.Vector4(1, 0, 0, 0), true) },
  uAutoRot1Speed: { value: autoRot1Speed },
  uAutoRot1Time: { value: startTime },
  uAutoRot2From: { value: getVector4Param('autoRot2From', new THREE.Vector4(1, 0, 0, 0), true) },
  uAutoRot2To: { value: getVector4Param('autoRot2To', new THREE.Vector4(0, 0, 1, 0), true) },
  uAutoRot2Speed: { value: autoRot2Speed },
  uAutoRot2Time: { value: startTime },
  uTime: { value: startTime },
  uLightDir: { value: new THREE.Vector3(0.45, 0.6, 0.7).normalize() }
};

const material = new THREE.ShaderMaterial({
  vertexShader: crfVertexShader,
  fragmentShader: crfFragmentShader,
  uniforms,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: true
});

let meshObject = null;
let currentMeshData = null;
const controls = new CRFControls4D(canvas, uniforms);

const fovSlider = $('fov');
const filterSlider = $('filter');
const zoomSlider = $('zoom');
const arcballToggle = $('arcball');
const fovValue = $('fovValue');
const filterValue = $('filterValue');
const zoomValue = $('zoomValue');
const stereoSelect = $('stereo');
const statusEl = $('status');
const statsEl = $('stats');
const urlInput = $('url');

fovSlider.value = uniforms.uFoV.value;
zoomSlider.value = zoom;
filterSlider.value = uniforms.uFilter.value;
stereoSelect.value = params.get('stereo') ?? 'off';
arcballToggle.checked = params.get('arcball') === '1';
controls.setUseArcball(arcballToggle.checked);
updateLabels();

fovSlider.addEventListener('input', () => {
  uniforms.uFoV.value = Number(fovSlider.value);
  updateLabels();
});
filterSlider.addEventListener('input', () => {
  uniforms.uFilter.value = Number(filterSlider.value);
  updateLabels();
});
zoomSlider.addEventListener('input', () => {
  setZoom(zoomSlider.value);
});
stereoSelect.addEventListener('change', () => {});
arcballToggle.addEventListener('change', () => {
  controls.setUseArcball(arcballToggle.checked);
});
$('resetRotation').addEventListener('click', () => controls.reset());
$('loadUrl').addEventListener('click', () => loadFromUrl(urlInput.value.trim()));
$('fileInput').addEventListener('change', event => loadFromFile(event.target.files?.[0]));
$('downloadMesh').addEventListener('click', downloadCurrentMesh);

const app = document.querySelector('.app');
const btn = document.getElementById('toggleBtn');

let isClosed = params.get('panel') === 'hide';

function updatePanel() {
  app.classList.toggle('closed', isClosed);
  btn.textContent = isClosed ? '❮' : '❯';

  window.dispatchEvent(new Event('resize'));
}

updatePanel();

btn.addEventListener('click', () => {
  isClosed = !isClosed;
  updatePanel();
});
$('exportUrl').addEventListener('click', exportUrl);

function updateLabels() {
  fovValue.textContent = Number(uniforms.uFoV.value).toFixed(1);
  filterValue.textContent = Number(uniforms.uFilter.value).toFixed(1);
  zoomValue.textContent = zoom.toFixed(2);
}

function setZoom(value) {
  zoom = clampZoom(value);
  zoomSlider.value = zoom;
  updateLabels();
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function numberToParam(n, digits = 6) {
  if (!Number.isFinite(n)) return '0';
  return String(Number(n.toFixed(digits)));
}

function vectorToParam(v) {
  return [v.x, v.y, v.z, v.w]
    .map(n => numberToParam(n))
    .join(',');
}

function setAutoRotationParams(next, channel) {
  const from = uniforms[`uAutoRot${channel}From`].value;
  const to = uniforms[`uAutoRot${channel}To`].value;
  const speed = uniforms[`uAutoRot${channel}Speed`].value;

  next.set(`autoRot${channel}From`, vectorToParam(from));
  next.set(`autoRot${channel}To`, vectorToParam(to));
  next.set(`autoRot${channel}Speed`, numberToParam(speed));
  next.set('arcball', arcballToggle.checked ? '1' : '0');
}

function updateUrlParams() {
  const next = new URLSearchParams();

  next.set('fov', String(Number(uniforms.uFoV.value.toFixed(1))));
  next.set('filter', String(Number(uniforms.uFilter.value.toFixed(1))));
  next.set('zoom', String(Number(zoom.toFixed(2))));
  next.set('stereo', stereoSelect.value);

  next.set('axis1', vectorToParam(uniforms.uAxis1.value));
  next.set('axis2', vectorToParam(uniforms.uAxis2.value));
  next.set('axis3', vectorToParam(uniforms.uAxis3.value));
  next.set('axis4', vectorToParam(uniforms.uAxis4.value));

  setAutoRotationParams(next, 1);
  setAutoRotationParams(next, 2);

  if (urlInput.value.trim()) {
    next.set('mesh', urlInput.value.trim());
  }

  const newUrl = `${location.pathname}?${next.toString()}`;
  history.replaceState(null, '', newUrl);
}

async function exportUrl() {
  updateUrlParams();

  const url = location.href;

  try {
    await navigator.clipboard.writeText(url);
    setStatus('Export URL copied to clipboard.');
  } catch {
    setStatus(url);
  }
}

function getNumberParam(name, fallback) {
  const raw = params.get(name);
  if (raw == null) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.warn(`Invalid ${name} parameter`);
    return fallback;
  }

  return value;
}

function getVector4Param(name, fallback, normalize = false) {
  const raw = params.get(name);

  if (!raw) return fallback.clone();

  const values = raw
    .split(',')
    .map(v => Number(v.trim()));

  if (values.length !== 4 || values.some(v => !Number.isFinite(v))) {
    console.warn(`Invalid ${name} parameter`);
    return fallback.clone();
  }

  const result = new THREE.Vector4(...values);
  if (normalize) {
    if (result.lengthSq() < 1e-12) {
      console.warn(`Invalid ${name} parameter: zero vector`);
      return fallback.clone();
    }
    result.normalize();
  }

  return result;
}

function createGeometry(data) {
  const a = data.attributes;
  const vertexCount = a.position.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(a.position), 3));
  geometry.setAttribute('aPosition4', new THREE.BufferAttribute(new Float32Array(a.position4), 4));
  geometry.setAttribute('aLightingNormal', new THREE.BufferAttribute(new Float32Array(a.lightingNormal), 3));
  geometry.setAttribute('aNormal4', new THREE.BufferAttribute(new Float32Array(a.normal4), 4));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(a.color), 4));
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(new IndexArray(data.indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function setMesh(data, label = '') {
  currentMeshData = data;
  if (meshObject) {
    scene.remove(meshObject);
    meshObject.geometry.dispose();
  }
  meshObject = new THREE.Mesh(createGeometry(data), material);
  meshObject.frustumCulled = false;
  meshObject.scale.setScalar(Number(params.get('scale') ?? 2.0));
  scene.add(meshObject);

  const s = data.stats ?? {};
  statsEl.textContent = [
    data.name || label || 'CRF mesh',
    `draw vertices: ${s.vertices ?? data.attributes.position.length / 3}`,
    `triangles: ${s.triangles ?? data.indices.length / 3}`,
    s.sourceVertices != null ? `source vertices: ${s.sourceVertices}` : '',
    s.sourceFaces != null ? `faces: ${s.sourceFaces}` : '',
    s.sourceCells != null ? `cells: ${s.sourceCells}` : ''
  ].filter(Boolean).join(' / ');
}

async function loadFromUrl(url) {
  if (!url) return;
  try {
    setStatus(`Loading: ${url}`);
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    loadText(text, inferKind(url), url.split('/').pop() || url);
    setStatus('Loaded.');
  } catch (error) {
    console.error(error);
    setStatus(`Load failed: ${error.message}. External URLs must allow CORS.`, 'error');
  }
}

function loadText(text, kind, label) {
  if (kind === 'off') {
    const built = roundMesh(buildRenderMeshFromOFF(text, { name: label.replace(/\.off$/i, '') }), 6);
    setMesh(built, label);
    return;
  }
  const parsed = JSON.parse(text);
  if (!parsed.attributes || !parsed.indices) throw new Error('Not a .crfmesh.json file.');
  setMesh(parsed, label);
}

async function loadFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    loadText(text, inferKind(file.name), file.name);
    setStatus(`Loaded local file: ${file.name}`);
  } catch (error) {
    console.error(error);
    setStatus(`File load failed: ${error.message}`, 'error');
  }
}

function inferKind(url) {
  return /\.off(\?.*)?$/i.test(url) ? 'off' : 'mesh';
}

function downloadCurrentMesh() {
  if (!currentMeshData) return;
  const name = (currentMeshData.name || 'crfmesh').replace(/[^a-z0-9_-]+/gi, '_');
  const blob = new Blob([meshToJson(currentMeshData, false)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.crfmesh.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function resizeRenderer() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelRatio = renderer.getPixelRatio();
  const needsResize = canvas.width !== Math.floor(width * pixelRatio) ||
                      canvas.height !== Math.floor(height * pixelRatio);
  if (needsResize) renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return { width, height };
}

function setCameraForViewport(viewW, viewH) {
  camera.aspect = viewW / viewH;

  const baseFov3 = getBaseFov3();

  if (viewW < viewH) {
    const fovRad = THREE.MathUtils.degToRad(baseFov3);
    const adjustedFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * (viewH / viewW));
    camera.fov = THREE.MathUtils.radToDeg(adjustedFovRad);
  } else {
    camera.fov = baseFov3;
  }

  camera.updateProjectionMatrix();
}

function render() {
  const { width, height } = resizeRenderer();
  uniforms.uTime.value = performance.now() * 0.001;
  const mode = stereoSelect.value;

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.clear();

  if (mode === 'off') {
    setCameraForViewport(width, height);
    renderer.render(scene, camera);
  } else {
    stereoCamera.update(camera);
    const half = Math.floor(width / 2);
    setCameraForViewport(half, height);
    updateStereoFocus();
    const leftCamera = mode === 'cross' ? stereoCamera.cameraR : stereoCamera.cameraL;
    const rightCamera = mode === 'cross' ? stereoCamera.cameraL : stereoCamera.cameraR;

    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, half, height);
    renderer.setScissor(0, 0, half, height);
    renderer.render(scene, leftCamera);

    renderer.setViewport(half, 0, width - half, height);
    renderer.setScissor(half, 0, width - half, height);
    renderer.render(scene, rightCamera);
    renderer.setScissorTest(false);
  }
}
renderer.setAnimationLoop(render);

const defaultUrl = params.get('off') || params.get('mesh') || params.get('file') || './meshes/tesseract.crfmesh.json';
urlInput.value = defaultUrl;
loadFromUrl(defaultUrl);
