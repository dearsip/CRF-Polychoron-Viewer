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
uniform vec4 uAutoRot2From;
uniform vec4 uAutoRot2To;
uniform float uAutoRot2Speed;
uniform float uTime;
uniform float uRotTime;
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
  //return vec4(dot(uAxis1, p), dot(uAxis2, p), dot(uAxis3, p), dot(uAxis4, p));
  return mat4(
    uAxis1,
    uAxis2,
    uAxis3,
    uAxis4
  ) * p;
}

void main() {
  float deltaTime = uTime - uRotTime;
  vec4 to1 = cos(uAutoRot1Speed * deltaTime) * uAutoRot1From + sin(uAutoRot1Speed * deltaTime) * uAutoRot1To;
  vec4 to2 = cos(uAutoRot2Speed * deltaTime) * uAutoRot2From + sin(uAutoRot2Speed * deltaTime) * uAutoRot2To;

  float theta = radians(uFoV) * 0.5;
  float distanceR = sin(theta);

  vec4 cellPos = rotate4(rotate4(applyAxis(aNormal4), uAutoRot1From, to1), uAutoRot2From, to2);
  bool hiddenByFoV = cellPos.w + position.x * distanceR > -1e-9 * cos(theta);
  bool hiddenByFilter = cellPos.z > -sin(radians(uFilter)) - 1e-9;
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

  vec4 p = rotate4(rotate4(applyAxis(aPosition4), uAutoRot1From, to1), uAutoRot2From, to2);
  vec3 projected = p.xyz;
  if (abs(theta) > 1e-7) {
    projected = p.xyz / ((p.w + 1.0 / distanceR) * tan(theta));
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(projected, 1.0);
  vColor = aColor * (diff * 0.7 + 0.5) + vec4(1.0) * max(diff - 0.7, 0.0);
}
`;

export const crfFragmentShader = /* glsl */`
varying vec4 vColor;

void main() {
  vec4 col = gl_FrontFacing ? vColor : vColor * 0.4 + vec4(0.2, 0.2, 0.2, 0.0);
  gl_FragColor = vec4(col.rgb, 1.0);
}
`;
