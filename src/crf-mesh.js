const PRESET_COLORS = [
  '#ef5030', '#4b85f9', '#60e62b', '#ff76df', '#77ffeb', '#faf73e',
  '#ffb350', '#1be5a9', '#875cff', '#c6eb40', '#3d9df1', '#f557a9'
];

const EPS = 1e-9;

function v4(x = 0, y = 0, z = 0, w = 0) { return [x, y, z, w]; }
function add4(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; }
function sub4(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]]; }
function mul4(a, s) { return [a[0] * s, a[1] * s, a[2] * s, a[3] * s]; }
function dot4(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }
function len4(a) { return Math.hypot(a[0], a[1], a[2], a[3]); }
function norm4(a) { const l = len4(a); return l > EPS ? mul4(a, 1 / l) : v4(); }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a) { const l = len3(a); return l > EPS ? mul3(a, 1 / l) : [0, 0, 0]; }
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function cross4(p1, p2, p3) {
  const x = p1[1] * p2[2] * p3[3]
          + p1[3] * p2[1] * p3[2]
          + p1[2] * p2[3] * p3[1]
          - p1[3] * p2[2] * p3[1]
          - p1[1] * p2[3] * p3[2]
          - p1[2] * p2[1] * p3[3];
  const y = -p1[2] * p2[3] * p3[0]
          - p1[3] * p2[0] * p3[2]
          - p1[0] * p2[2] * p3[3]
          + p1[0] * p2[3] * p3[2]
          + p1[2] * p2[0] * p3[3]
          + p1[3] * p2[2] * p3[0];
  const z = p1[3] * p2[0] * p3[1]
          + p1[0] * p2[1] * p3[3]
          + p1[1] * p2[3] * p3[0]
          - p1[1] * p2[0] * p3[3]
          - p1[3] * p2[1] * p3[0]
          - p1[0] * p2[3] * p3[1];
  const w = -p1[0] * p2[1] * p3[2]
          - p1[1] * p2[2] * p3[0]
          - p1[2] * p2[0] * p3[1]
          + p1[2] * p2[1] * p3[0]
          + p1[0] * p2[2] * p3[1]
          + p1[1] * p2[0] * p3[2];
  return [x, y, z, w];
}

function reflect4(src, normal) {
  const scale = 2 * dot4(src, normal);
  return [
    src[0] - scale * normal[0],
    src[1] - scale * normal[1],
    src[2] - scale * normal[2],
    src[3] - scale * normal[3]
  ];
}

function rotate4(src, from, toHalf) {
  return reflect4(reflect4(src, from), toHalf);
}

function xyz4(a) {
  return [a[0], a[1], a[2]];
}

function computeLightingNormal(pos, another, face, normal4) {
  const wAxis = v4(0, 0, 0, 1);
  const roter = mul4(add4(normal4, wAxis), 0.5);

  let localPos = pos;
  let localAnother = another;
  let localFace = face;

  if (len4(roter) > 0.0001) {
    const rot = norm4(roter);
    localPos = rotate4(pos, rot, wAxis);
    localAnother = rotate4(another, rot, wAxis);
    localFace = rotate4(face, rot, wAxis);
  }

  return norm3(cross3(
    sub3(xyz4(localAnother), xyz4(localFace)),
    sub3(xyz4(localPos), xyz4(localFace))
  ));
}

function parseColor(hex) {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
    1
  ];
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function parseInlineColor(values) {
  if (!values || values.length < 3) return null;
  const [r, g, b, a = 1] = values;
  if (![r, g, b, a].every(Number.isFinite)) return null;

  const rgbScale = Math.max(Math.abs(r), Math.abs(g), Math.abs(b)) > 1 ? 255 : 1;
  const alphaScale = Math.abs(a) > 1 ? 255 : 1;
  return [
    clamp01(r / rgbScale),
    clamp01(g / rgbScale),
    clamp01(b / rgbScale),
    clamp01(a / alphaScale)
  ];
}

function toColor4(value) {
  if (Array.isArray(value)) return parseInlineColor(value) ?? [1, 1, 1, 1];
  return parseColor(value);
}

function dataLines(text) {
  return text
    .split(/\r?\n/g)
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

export function parseOFF(text) {
  const lines = dataLines(text);
  let cursor = 0;
  const header = lines[cursor++];
  if (header !== 'OFF' && header !== '4OFF') {
    throw new Error('Invalid OFF file: first data line must be OFF or 4OFF.');
  }

  const dim = header === 'OFF' ? 3 : 4;
  const counts = lines[cursor++].split(/\s+/).map(Number);
  const vertexCount = counts[0];
  const faceCount = counts[1];
  const edgeCount = counts[2] ?? 0;
  const cellCount = dim === 4 ? (counts[3] ?? 0) : 0;

  const vertices3 = new Array(vertexCount);
  const vertices4 = new Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const p = lines[cursor++].split(/\s+/).map(Number);
    if (dim === 3) {
      vertices3[i] = [p[0], p[1], p[2]];
      vertices4[i] = [p[0], p[1], 0, p[2]];
    } else {
      vertices3[i] = [p[0], p[1], p[2]];
      vertices4[i] = [p[0], p[1], p[2], p[3]];
    }
  }

  let center = v4();
  for (const p of vertices4) center = add4(center, p);
  center = mul4(center, 1 / vertexCount);
  if (len4(center) > 0.01) {
    for (let i = 0; i < vertexCount; i++) {
      vertices4[i] = sub4(vertices4[i], center);
      if (dim === 3) vertices3[i] = sub3(vertices3[i], [center[0], center[1], center[3]]);
    }
  }

  let r = 0;
  for (const p of vertices4) r = Math.max(len4(p), r);
  r = 1 / r;
  for (let i = 0; i < vertexCount; i++) {
    vertices4[i] = mul4(vertices4[i], r);
    vertices3[i] = mul3(vertices3[i], r);
  }

  const faces = new Array(faceCount);
  const faceCenters = new Array(faceCount);
  const faceTypes = new Array(faceCount);
  const faceColors = new Array(faceCount).fill(null);
  const faceTypeList = [];

  for (let i = 0; i < faceCount; i++) {
    const parts = lines[cursor++].split(/\s+/).map(Number);
    const n = parts[0];
    faces[i] = parts.slice(1, 1 + n);
    faceColors[i] = parseInlineColor(parts.slice(1 + n));

    let type = faceTypeList.indexOf(n);
    if (type < 0) {
      type = faceTypeList.length;
      faceTypeList.push(n);
    }
    faceTypes[i] = type;

    let c = v4();
    for (const vi of faces[i]) c = add4(c, vertices4[vi]);
    faceCenters[i] = mul4(c, 1 / n);
  }

  const cellFaces = new Array(cellCount);
  const cells = new Array(cellCount);
  const cellCenters = new Array(cellCount);
  const cellTypes = new Array(cellCount);
  const cellColors = new Array(cellCount).fill(null);
  const cellTypeList = [];

  for (let i = 0; i < cellCount; i++) {
    const parts = lines[cursor++].split(/\s+/).map(Number);
    const n = parts[0];
    cellFaces[i] = parts.slice(1, 1 + n);
    cellColors[i] = parseInlineColor(parts.slice(1 + n));

    const histogram = new Array(32).fill(0);
    for (const fi of cellFaces[i]) histogram[Math.min(faces[fi].length, 31)]++;
    const key = histogram.join(',');
    let type = cellTypeList.indexOf(key);
    if (type < 0) {
      type = cellTypeList.length;
      cellTypeList.push(key);
    }
    cellTypes[i] = type;

    const vertexSet = new Set();
    for (const fi of cellFaces[i]) for (const vi of faces[fi]) vertexSet.add(vi);
    cells[i] = [...vertexSet];
    let c = v4();
    for (const vi of cells[i]) c = add4(c, vertices4[vi]);
    cellCenters[i] = mul4(c, 1 / cells[i].length);
  }

  return {
    dim,
    r,
    vertices3,
    vertices4,
    faces,
    faceCenters,
    faceTypes,
    faceColors,
    cellFaces,
    cells,
    cellCenters,
    cellTypes,
    cellColors,
    edgeCount
  };
}

function computeFacetNormals(model) {
  const { dim, faces, vertices3, vertices4, cellFaces, cellCenters } = model;

  if (dim === 3) {
    return faces.map(face => {
      let n = norm3(cross3(
        sub3(vertices3[face[1]], vertices3[face[0]]),
        sub3(vertices3[face[2]], vertices3[face[0]])
      ));
      if (dot3(n, vertices3[face[0]]) < 0) n = mul3(n, -1);
      return [n[0], n[1], 0, n[2]];
    });
  }

  return cellFaces.map((cf, ci) => {
    const f0 = faces[cf[0]];
    const p1 = f0[0];
    const p2 = f0[1];
    const p3 = f0[2];

    const a = sub4(vertices4[p2], vertices4[p1]);
    const b = sub4(vertices4[p3], vertices4[p1]);

    let best = v4();
    let bestLen = 0;

    for (const fi of cf) {
      for (const p4 of faces[fi]) {
        const c = sub4(vertices4[p4], vertices4[p1]);
        const raw = cross4(a, b, c);
        const l = len4(raw);

        if (l > bestLen) {
          bestLen = l;
          best = mul4(raw, 1 / l);
        }
      }
    }

    if (bestLen < 1e-10) {
      console.warn('Degenerate cell normal:', ci, cf);
      return v4();
    }

    if (dot4(best, vertices4[p1]) < 0) best = mul4(best, -1);

    return best;
  });
}

export function buildRenderMeshFromOFF(text, options = {}) {
  return buildRenderMesh(parseOFF(text), options);
}

export function buildRenderMesh(model, options = {}) {
  const colors = (options.colors ?? PRESET_COLORS).map(toColor4);
  const facetNormals = computeFacetNormals(model);

  const position = [];
  const position4 = [];
  const lightingNormal = [];
  const normal4 = [];
  const color = [];
  const indices = [];

  function pushVertex(boundRadius, pos, normal, lightNormal, col) {
    position.push(boundRadius, boundRadius, boundRadius);
    position4.push(...pos);
    lightingNormal.push(...lightNormal);
    normal4.push(...normal);
    color.push(...col);
  }

  let allVertexCount = 0;
  const { dim, r, vertices4, faces, faceCenters, faceTypes, faceColors, cellFaces, cells, cellCenters, cellTypes, cellColors } = model;

  if (dim === 3) {
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const fc = faceCenters[i];
      let p = len4(sub4(vertices4[face[0]], fc));
      p = Math.max((p - 0.1 * r) / p, 0.85);
      const pe = (p - (1 - p) * 2) / p;
      const col = faceColors[i] ?? colors[faceTypes[i] % colors.length];
      const n = facetNormals[i];
      const boundRadius = dot4(n, fc);
      const outerPositions = [];
      const innerPositions = [];

      for (const vi of face) {
        const pos = add4(mul4(vertices4[vi], p), mul4(fc, 1 - p));
        outerPositions.push(pos);
        innerPositions.push(add4(mul4(pos, pe), mul4(fc, 1 - pe)));
      }

      for (let k = 0; k < face.length; k++) {
        const next = (k + 1) % face.length;
        pushVertex(
          boundRadius,
          outerPositions[k],
          n,
          computeLightingNormal(outerPositions[k], outerPositions[next], fc, n),
          col
        );
        pushVertex(
          boundRadius,
          innerPositions[k],
          n,
          computeLightingNormal(innerPositions[k], innerPositions[next], fc, n),
          col
        );
      }

      for (let k = 0; k < face.length - 1; k++) {
        indices.push(allVertexCount + 2 * k, allVertexCount + 2 * k + 1, allVertexCount + 2 * k + 3);
        indices.push(allVertexCount + 2 * k, allVertexCount + 2 * k + 3, allVertexCount + 2 * k + 2);
      }
      indices.push(allVertexCount + 2 * face.length - 2, allVertexCount + 2 * face.length - 1, allVertexCount + 1);
      indices.push(allVertexCount + 2 * face.length - 2, allVertexCount + 1, allVertexCount);

      allVertexCount += 2 * face.length;
    }
  } else {
    for (let i = 0; i < cellFaces.length; i++) {
      let p = len4(sub4(vertices4[cells[i][0]], cellCenters[i]));
      p = Math.max((p - 0.1 * r) / p, 0.85);
      const n = facetNormals[i];
      const boundRadius = dot4(n, cellCenters[i]);
      const col = cellColors[i] ?? colors[cellTypes[i] % colors.length];

      for (const fi of cellFaces[i]) {
        const face = faces[fi];
        const fc = faceCenters[fi];
        let pe = len4(sub4(vertices4[face[0]], fc)) * p;
        pe = Math.max((pe - 0.1 * r) / pe, 0.85);
        const orient = dot4(vertices4[face[1]], cross4(cellCenters[i], fc, vertices4[face[0]])) > 0;
        const ordered = orient ? face : [...face].reverse();

        const outerPositions = [];
        const innerPositions = [];
        for (const vi of ordered) {
          const pos = add4(mul4(vertices4[vi], p), mul4(cellCenters[i], 1 - p));
          outerPositions.push(pos);
          innerPositions.push(add4(mul4(pos, pe), mul4(fc, 1 - pe)));
        }

        for (let k = 0; k < face.length; k++) {
          const next = (k + 1) % face.length;
          pushVertex(
            boundRadius,
            outerPositions[k],
            n,
            computeLightingNormal(outerPositions[k], outerPositions[next], fc, n),
            col
          );
          pushVertex(
            boundRadius,
            innerPositions[k],
            n,
            computeLightingNormal(innerPositions[k], innerPositions[next], fc, n),
            col
          );
        }

        for (let k = 0; k < face.length - 1; k++) {
          indices.push(allVertexCount + 2 * k, allVertexCount + 2 * k + 1, allVertexCount + 2 * k + 3);
          indices.push(allVertexCount + 2 * k, allVertexCount + 2 * k + 3, allVertexCount + 2 * k + 2);
        }
        indices.push(allVertexCount + 2 * face.length - 2, allVertexCount + 2 * face.length - 1, allVertexCount + 1);
        indices.push(allVertexCount + 2 * face.length - 2, allVertexCount + 1, allVertexCount);

        allVertexCount += 2 * face.length;
      }
    }
  }

  return {
    version: 1,
    name: options.name ?? 'CRF polytope',
    source: 'crf-three-viewer',
    attributes: {
      position,
      position4,
      lightingNormal,
      normal4,
      color
    },
    indices,
    stats: {
      dim: model.dim,
      vertices: position.length / 3,
      triangles: indices.length / 3,
      sourceVertices: model.vertices4.length,
      sourceFaces: model.faces.length,
      sourceCells: model.cellFaces.length,
      coloredFaces: model.faceColors?.filter(Boolean).length ?? 0,
      coloredCells: model.cellColors?.filter(Boolean).length ?? 0
    }
  };
}

export function roundMesh(mesh, digits = 6) {
  const f = 10 ** digits;
  const rounded = structuredClone(mesh);
  for (const key of Object.keys(rounded.attributes)) {
    rounded.attributes[key] = rounded.attributes[key].map(x => Math.round(x * f) / f);
  }
  return rounded;
}

export function meshToJson(mesh, pretty = false) {
  return JSON.stringify(mesh, null, pretty ? 2 : 0);
}
