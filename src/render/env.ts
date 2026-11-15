import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.52, 0.42).normalize();
const HORIZON = new THREE.Color(0xf3c99a);
const ZENITH = new THREE.Color(0x2f6fb8);

export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR.clone() },
      horizon: { value: HORIZON.clone() },
      zenith: { value: ZENITH.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, horizon, zenith;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        col = mix(col, horizon * 0.75, smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.45;
        col += vec3(1.0, 0.9, 0.7) * pow(s, 900.0) * 6.0;
        // soft streaky clouds
        float c = sin(vDir.x * 9.0 + vDir.z * 4.0) * sin(vDir.z * 7.0 - vDir.x * 3.0);
        c = smoothstep(0.35, 0.9, c) * smoothstep(0.05, 0.3, h) * (1.0 - smoothstep(0.5, 0.9, h));
        col = mix(col, vec3(1.0, 0.93, 0.85), c * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export interface Lights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  flash: THREE.PointLight;
}

export function makeLights(scene: THREE.Scene): Lights {
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6b5a48, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b8, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const cam = sun.shadow.camera;
  cam.left = -42; cam.right = 42; cam.top = 42; cam.bottom = -42;
  cam.near = 1; cam.far = 260;
  scene.add(sun);
  scene.add(sun.target);
  // Single shared muzzle-flash light. Kept in the scene permanently so the
  // light count never changes (that would recompile every shader).
  const flash = new THREE.PointLight(0xffb060, 0, 9, 2);
  scene.add(flash);
  scene.fog = new THREE.Fog(HORIZON.clone().multiplyScalar(0.92), 60, 260);
  return { sun, hemi, flash };
}

/** Moves the shadow frustum with the camera focus, snapped to texels to avoid shimmer. */
export function updateSun(l: Lights, focus: THREE.Vector3): void {
  const size = l.sun.shadow.camera.right - l.sun.shadow.camera.left;
  const texel = size / Math.max(1, l.sun.shadow.mapSize.x);
  const fx = Math.round(focus.x / texel) * texel;
  const fz = Math.round(focus.z / texel) * texel;
  l.sun.target.position.set(fx, 0, fz);
  l.sun.position.set(fx + SUN_DIR.x * 120, SUN_DIR.y * 120, fz + SUN_DIR.z * 120);
  l.sun.target.updateMatrixWorld();
}

export function makeEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const sky = makeSky();
  (sky.material as THREE.ShaderMaterial).depthTest = false;
  s.add(sky);
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  groundGeo.rotateX(-Math.PI / 2);
  const g = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x5a5249 }));
  g.position.y = -5;
  s.add(g);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  return rt.texture;
}
