export const dataFlowParticleVertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out float vAlpha;

uniform mat3 uProjectionMatrix;
uniform float uTime;
uniform float uSpeed;
uniform float uParticleSize;

void main(void) {
  vUV = aUV;
  float progress = fract(aUV.x + uTime * uSpeed);
  vAlpha = sin(progress * 3.14159) * 0.8 + 0.2;
  vec2 pos = aPosition;
  gl_Position = vec4((uProjectionMatrix * vec3(pos, 1.0)).xy, 0.0, 1.0);
  gl_PointSize = uParticleSize * (0.5 + 0.5 * sin(progress * 6.28318));
}
`;

export const dataFlowParticleFragment = /* glsl */ `
in vec2 vUV;
in float vAlpha;
out vec4 finalColor;

uniform vec3 uParticleColor;
uniform float uGlobalAlpha;

void main(void) {
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);
  if (dist > 0.5) discard;

  float alpha = smoothstep(0.5, 0.1, dist) * vAlpha * uGlobalAlpha;
  finalColor = vec4(uParticleColor, alpha);
}
`;
