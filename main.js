import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

// シーン
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

// カメラ
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.z = 3;

// レンダラー
const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 立方体
const geometry = new THREE.BoxGeometry(1, 1, 1);

const material = new THREE.MeshNormalMaterial();

const cube = new THREE.Mesh(geometry, material);

scene.add(cube);

// アニメーション
function animate() {
  requestAnimationFrame(animate);

  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;

  renderer.render(scene, camera);
}

animate();

// リサイズ対応
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});