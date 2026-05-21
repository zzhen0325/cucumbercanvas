export const containerBackgroundVertex = /* glsl */ `
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

export const containerBackgroundFragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uOpacity;
uniform float uGradientAngle;

void main(void) {
  vec4 texColor = texture(uTexture, vTextureCoord);

  float angle = uGradientAngle;
  vec2 dir = vec2(cos(angle), sin(angle));
  float t = dot(vTextureCoord, dir) * 0.5 + 0.5;

  float wave = sin(t * 3.14159 + uTime * 0.5) * 0.1;
  t = clamp(t + wave, 0.0, 1.0);

  vec3 gradient;
  if (t < 0.5) {
    gradient = mix(uColor1, uColor2, t * 2.0);
  } else {
    gradient = mix(uColor2, uColor3, (t - 0.5) * 2.0);
  }

  finalColor = vec4(gradient, uOpacity) * texColor.a + texColor * (1.0 - uOpacity);
}
`;
