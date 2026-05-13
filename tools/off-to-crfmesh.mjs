#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { buildRenderMeshFromOFF, roundMesh, meshToJson } from '../src/crf-mesh.js';

function usage() {
  console.log(`Usage:
  node tools/off-to-crfmesh.mjs input.4off output.crfmesh.json [--pretty]

The output is a pre-expanded render mesh for the browser viewer. It keeps the same
per-vertex 4D attributes that the Unity importer stored in UV0..UV3 and color.`);
}

const args = process.argv.slice(2);
if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(args.length < 2 ? 1 : 0);
}

const [input, output] = args;
const pretty = args.includes('--pretty');
const name = basename(input).replace(/\.(4?off)$/i, '');

try {
  const off = await readFile(input, 'utf8');
  const mesh = roundMesh(buildRenderMeshFromOFF(off, { name }), 6);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, meshToJson(mesh, pretty), 'utf8');
  const s = mesh.stats;
  console.log(`Wrote ${output}`);
  console.log(`draw vertices=${s.vertices}, triangles=${s.triangles}, source vertices=${s.sourceVertices}, faces=${s.sourceFaces}, cells=${s.sourceCells}`);
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
