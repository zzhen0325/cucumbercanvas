export const glowFilterVertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 / uOutputTexture.y * uOutputTexture.z) - 1.0;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

export const glowFilterFragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
uniform float uGlowRadius;
uniform float uPulseSpeed;

void main(void) {
  vec4 texColor = texture(uTexture, vTextureCoord);

  float pulse = 0.5 + 0.5 * sin(uTime * uPulseSpeed);
  float intensity = uGlowIntensity * (0.7 + 0.3 * pulse);

  vec4 glow = vec4(0.0);
  float totalWeight = 0.0;
  const int SAMPLES = 8;
  float radius = uGlowRadius / 100.0;

  for (int i = 0; i < SAMPLES; i++) {
    float angle = float(i) * 6.28318 / float(SAMPLES);
    vec2 offset = vec2(cos(angle), sin(angle)) * radius;
    vec4 sample_ = texture(uTexture, vTextureCoord + offset);
    float weight = 1.0 - float(i) / float(SAMPLES);
    glow += sample_ * weight;
    totalWeight += weight;
  }
  glow /= totalWeight;

  vec3 glowContrib = uGlowColor * glow.a * intensity;
  finalColor = texColor + vec4(glowContrib, glow.a * intensity * 0.5);
}
`;
