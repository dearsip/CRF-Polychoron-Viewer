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
const baseFov = 38;
const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.01, 100);
camera.position.set(0, 0, 7);
camera.lookAt(0, 0, 0);

const stereoCamera = new THREE.StereoCamera();
stereoCamera.eyeSep = Number(params.get('eyeSep') ?? 0.3);
stereoCamera.aspect = 0.5;

const uniforms = {
  uFoV: { value: Number(params.get('fov') ?? 0) },
  uFilter: { value: Number(params.get('filter') ?? -90) },
  uAxis1: { value: getAxisVector('axis1', new THREE.Vector4(1, 0, 0, 0)) },
  uAxis2: { value: getAxisVector('axis2', new THREE.Vector4(0, 1, 0, 0)) },
  uAxis3: { value: getAxisVector('axis3', new THREE.Vector4(0, 0, 1, 0)) },
  uAxis4: { value: getAxisVector('axis4', new THREE.Vector4(0, 0, 0, 1)) },
  uAutoRot1From: { value: new THREE.Vector4(0, 0, 0, -1) },
  uAutoRot1To: { value: new THREE.Vector4(1, 0, 0, 0) },
  uAutoRot1Speed: { value: 0 },
  uAutoRot2From: { value: new THREE.Vector4(1, 0, 0, 0) },
  uAutoRot2To: { value: new THREE.Vector4(0, 1, 0, 0) },
  uAutoRot2Speed: { value: 0 },
  uTime: { value: 0 },
  uRotTime: { value: 0 },
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
const fovValue = $('fovValue');
const filterValue = $('filterValue');
const stereoSelect = $('stereo');
const statusEl = $('status');
const statsEl = $('stats');
const urlInput = $('url');

fovSlider.value = uniforms.uFoV.value;
filterSlider.value = uniforms.uFilter.value;
stereoSelect.value = params.get('stereo') ?? 'off';
updateLabels();

fovSlider.addEventListener('input', () => {
  uniforms.uFoV.value = Number(fovSlider.value);
  updateLabels();
});
filterSlider.addEventListener('input', () => {
  uniforms.uFilter.value = Number(filterSlider.value);
  updateLabels();
});
stereoSelect.addEventListener('change', () => {});
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
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function vectorToParam(v) {
  return [v.x, v.y, v.z, v.w]
    .map(n => Number(n.toFixed(6)))
    .join(',');
}

function updateUrlParams() {
  const next = new URLSearchParams(location.search);

  next.set('fov', String(Number(uniforms.uFoV.value.toFixed(1))));
  next.set('filter', String(Number(uniforms.uFilter.value.toFixed(1))));
  next.set('stereo', stereoSelect.value);

  next.set('axis1', vectorToParam(uniforms.uAxis1.value));
  next.set('axis2', vectorToParam(uniforms.uAxis2.value));
  next.set('axis3', vectorToParam(uniforms.uAxis3.value));
  next.set('axis4', vectorToParam(uniforms.uAxis4.value));

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

function getAxisVector(name, fallback) {
  const raw = params.get(name);

  if (!raw) return fallback;

  const values = raw
    .split(',')
    .map(v => Number(v.trim()));

  if (values.length !== 4 || values.some(v => Number.isNaN(v))) {
    console.warn(`Invalid ${name} parameter`);
    return fallback;
  }

  return new THREE.Vector4(...values);
}

function createGeometry(data) {
  const a = data.attributes;
  const vertexCount = a.position.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(a.position), 3));
  geometry.setAttribute('aPosition4', new THREE.BufferAttribute(new Float32Array(a.position4), 4));
  geometry.setAttribute('aAnother4', new THREE.BufferAttribute(new Float32Array(a.another4), 4));
  geometry.setAttribute('aFace4', new THREE.BufferAttribute(new Float32Array(a.face4), 4));
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
  const needsResize = canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
                      canvas.height !== Math.floor(height * renderer.getPixelRatio());
  if (needsResize) renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return { width, height };
}

function setCameraForViewport(viewW, viewH) {
  camera.aspect = viewW / viewH;

  if (viewW < viewH) {
    const fovRad = THREE.MathUtils.degToRad(baseFov);
    const adjustedFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * (viewH / viewW));
    camera.fov = THREE.MathUtils.radToDeg(adjustedFovRad);
  } else {
    camera.fov = baseFov;
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
