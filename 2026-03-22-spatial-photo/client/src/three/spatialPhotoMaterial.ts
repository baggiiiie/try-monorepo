import * as THREE from 'three';

export function createSpatialPhotoMaterial(): THREE.ShaderMaterial {
  const uniforms = {
    uColorMap: { value: null },
    uDepthMap: { value: null },
    uPointer: { value: new THREE.Vector2() },
    uTexelSize: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uDepthStrength: { value: 0.68 },
    uMotionRange: { value: 0.018 },
    uEdgeSmoothing: { value: 0.45 },
    uShowDepth: { value: 0 },
    uShowBase: { value: 0 }
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uColorMap;
      uniform sampler2D uDepthMap;
      uniform vec2 uPointer;
      uniform vec2 uTexelSize;
      uniform float uDepthStrength;
      uniform float uMotionRange;
      uniform float uEdgeSmoothing;
      uniform float uShowDepth;
      uniform float uShowBase;

      varying vec2 vUv;

      float readDepth(vec2 uv) {
        return texture2D(uDepthMap, clamp(uv, vec2(0.0), vec2(1.0))).r;
      }

      void main() {
        float rawDepth = readDepth(vUv);
        float depth = smoothstep(0.02, 0.98, rawDepth);

        if (uShowDepth > 0.5) {
          gl_FragColor = vec4(vec3(depth), 1.0);
          return;
        }

        if (uShowBase > 0.5) {
          gl_FragColor = texture2D(uColorMap, vUv);
          return;
        }

        vec2 motion = uPointer * uMotionRange;
        vec2 uvOffset = motion * depth * uDepthStrength;
        vec2 warpedUv = clamp(vUv - uvOffset, vec2(0.0), vec2(1.0));

        float depthDx = readDepth(vUv + vec2(uTexelSize.x, 0.0)) - readDepth(vUv - vec2(uTexelSize.x, 0.0));
        float depthDy = readDepth(vUv + vec2(0.0, uTexelSize.y)) - readDepth(vUv - vec2(0.0, uTexelSize.y));
        float edgeAmount = clamp(length(vec2(depthDx, depthDy)) * 18.0, 0.0, 1.0);

        vec2 feather = motion * mix(0.002, 0.016, clamp(uEdgeSmoothing, 0.0, 1.0)) * (0.35 + depth * 0.65);
        vec4 baseSample = texture2D(uColorMap, warpedUv);
        vec4 fillA = texture2D(uColorMap, clamp(warpedUv - feather, vec2(0.0), vec2(1.0)));
        vec4 fillB = texture2D(uColorMap, clamp(warpedUv + feather * 0.65, vec2(0.0), vec2(1.0)));
        vec4 fillC = texture2D(uColorMap, clamp(warpedUv - feather * 0.35, vec2(0.0), vec2(1.0)));

        float featherMix = clamp(uEdgeSmoothing, 0.0, 1.0) * mix(0.2, 1.0, edgeAmount);
        vec4 softened = (baseSample + fillA + fillB + fillC) * 0.25;

        gl_FragColor = vec4(mix(baseSample.rgb, softened.rgb, featherMix), 1.0);
      }
    `
  });
}
