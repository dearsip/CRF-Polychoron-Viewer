export const crfVertexShader = /* glsl */`
attribute vec4 aPosition4;
attribute vec4 aAnother4;
attribute vec4 aFace4;
attribute vec4 aNormal4;
attribute vec4 aColor;

uniform float uFoV;
uniform float uFilter;
uniform vec4 uAxis1;
uniform vec4 uAxis2;
uniform vec4 uAxis3;
uniform vec4 uAxis4;
uniform vec4 uAutoRot1From;
uniform vec4 uAutoRot1To;
uniform float uAutoRot1Speed;
uniform float uAutoRot1Time;
uniform vec4 uAutoRot2From;
uniform vec4 uAutoRot2To;
uniform float uAutoRot2Speed;
uniform float uAutoRot2Time;
uniform float uTime;
uniform vec3 uLightDir;

varying vec4 vColor;

vec4 reflect4(vec4 src, vec4 normal) {
  return src - 2.0 * dot(src, normal) * normal;
}

vec4 rotate4(vec4 src, vec4 from, vec4 tohalf) {
  return reflect4(reflect4(src, from), tohalf);
}

vec4 rotI(vec4 src, vec4 rot) {
  return rotate4(src, rot, vec4(0.0, 0.0, 0.0, 1.0));
}

vec4 applyAxis(vec4 p) {
  return mat4(
    uAxis1,
    uAxis2,
    uAxis3,
    uAxis4
  ) * p;
}

vec4 applyAutoRotation(vec4 p) {
  float deltaTime1 = uTime - uAutoRot1Time;
  float deltaTime2 = uTime - uAutoRot2Time;
  vec4 to1 = normalize(cos(uAutoRot1Speed * deltaTime1) * uAutoRot1From + sin(uAutoRot1Speed * deltaTime1) * uAutoRot1To);
  vec4 to2 = normalize(cos(uAutoRot2Speed * deltaTime2) * uAutoRot2From + sin(uAutoRot2Speed * deltaTime2) * uAutoRot2To);
  return rotate4(rotate4(p, uAutoRot1From, to1), uAutoRot2From, to2);
}

void main() {
  float theta = radians(uFoV) * 0.5;
  float distanceR = sin(theta);

  vec4 cellPos = applyAutoRotation(applyAxis(aNormal4));
  bool hiddenByFoV = cellPos.w + position.x * distanceR > -1e-9 * cos(theta);
  cellPos = cellPos * position.x;
  vec3 projected = cellPos.xyz;
  if (abs(theta) > 1e-7) {
    projected = cellPos.xyz / ((cellPos.w + 1.0 / distanceR) * tan(theta));
  }
  bool hiddenByFilter = projected.z > -sin(radians(uFilter)) - 1e-9;
  if (hiddenByFoV || hiddenByFilter) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vColor = vec4(0.0);
    return;
  }

  vec4 localPos = aPosition4;
  vec4 localAnother = aAnother4;
  vec4 localFace = aFace4;
  vec4 roter = (aNormal4 + vec4(0.0, 0.0, 0.0, 1.0)) * 0.5;
  if (length(roter) > 0.0001) {
    roter = normalize(roter);
    localPos = rotI(aPosition4, roter);
    localAnother = rotI(aAnother4, roter);
    localFace = rotI(aFace4, roter);
  }

  vec3 normal = normalize(cross((localAnother - localFace).xyz, (localPos - localFace).xyz));
  float diff = abs(dot(normal, normalize(uLightDir)));

  vec4 p = applyAutoRotation(applyAxis(aPosition4));
  projected = p.xyz;
  if (abs(theta) > 1e-7) {
    projected = p.xyz / ((p.w + 1.0 / distanceR) * tan(theta));
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(projected, 1.0);
  vColor = aColor * (diff * 0.5 + 0.7) + vec4(1.0) * max(diff - 0.6, 0.0);
}
`;

export const crfFragmentShader = /* glsl */`
varying vec4 vColor;

void main() {
  vec4 col = gl_FrontFacing ? vColor : vColor * 0.4 + vec4(0.2, 0.2, 0.2, 0.0);
  gl_FragColor = vec4(col.rgb, 1.0);
}
`;
