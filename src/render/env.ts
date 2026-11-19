import * as THREE from 'three';

/**
 * Late-afternoon sun: low enough for long, readable shadows and warm light,
 * high enough that streets between tall buildings are not in permanent shade.
 */
export const SUN_DIR = new THREE.Vector3(-0.6, 0.44, 0.42).normalize();
/** Haze colour at the horizon (linear). The fog and the sky's horizon band share it. */
const HAZE = new THREE.Color(0.62, 0.66, 0.7);

// ------------------------------------------------------------------ colour grade
/**
 * Filmic tone mapping plus a colour grade, installed as three's CustomToneMapping.
 * It runs inside every material's own shader (and in OutputPass), so phones get
 * the cinematic look without an extra full-screen pass.
 * ACES fit, then in display space: gentle S-curve, cool shadows / warm highlights,
 * a little extra saturation.
 */
const GRADE = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  color = ACESFilmicToneMapping( color );
  vec3 p = pow( max( color, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
  p = mix( p, p * p * ( 3.0 - 2.0 * p ), 0.2 );
  float l = dot( p, vec3( 0.2126, 0.7152, 0.0722 ) );
  p *= mix( vec3( 0.955, 0.995, 1.05 ), vec3( 1.04, 1.0, 0.95 ), smoothstep( 0.12, 0.8, l ) );
  float l2 = dot( p, vec3( 0.2126, 0.7152, 0.0722 ) );
  p = mix( vec3( l2 ), p, 1.12 );
  return pow( clamp( p, 0.0, 1.0 ), vec3( 2.2 ) );
}`;
const CUSTOM_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
if (THREE.ShaderChunk.tonemapping_pars_fragment.includes(CUSTOM_STUB))
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(CUSTOM_STUB, GRADE);

/** Renderer settings that go with the grade above. */
export function setupToneMapping(r: THREE.WebGLRenderer): void {
  r.toneMapping = THREE.CustomToneMapping;
  r.toneMappingExposure = 1.0;
}

/**
 * Clock for ambient motion (drifting clouds, swaying leaves). Tests freeze it
 * so that "standing still gives a perfectly still picture" stays measurable.
 */
export const ambient = { frozen: false, t: 0 };
export function ambientTime(): number {
  if (!ambient.frozen) ambient.t = performance.now() / 1000;
  return ambient.t;
}

// ------------------------------------------------------------------ sky
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  #include <fog_pars_vertex>
  void main() {
    vDir = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 p = projectionMatrix * mvPosition;
    gl_Position = p.xyww;
    #include <fog_vertex>
  }`;

/**
 * Physically inspired sky: Rayleigh-like blue gradient, Mie glow round the sun,
 * a warm band on the sun's side of the horizon, a sun disc, and drifting
 * fbm cumulus lit from the sun side. Near the horizon it fades into the fog
 * colour, so far buildings melt into the sky without a seam.
 */
const SKY_FRAG = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 haze;
  uniform float time;
  uniform float clouds;
  varying vec3 vDir;
  #include <fog_pars_fragment>
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float mu = dot(d, sunDir);
    float hp = clamp(h, 0.0, 1.0);
    vec3 zenith = vec3(0.085, 0.2, 0.48);
    vec3 col = mix(haze * 1.05, zenith, pow(hp, 0.42));
    // warm scattering on the sun side of the horizon
    float side = pow(max(mu * 0.5 + 0.5, 0.0), 3.0);
    col += vec3(0.95, 0.5, 0.2) * pow(1.0 - hp, 5.0) * side * 0.55;
    // Mie glow and aureole
    float m = max(mu, 0.0);
    col += vec3(1.0, 0.78, 0.5) * (pow(m, 10.0) * 0.45 + pow(m, 120.0) * 1.2);
    // sun disc with a soft limb
    col += vec3(1.0, 0.9, 0.75) * smoothstep(0.99955, 0.99985, mu) * 30.0;
    // clouds: a flat layer projected onto the dome, lit from the sun side
    if (clouds > 0.0 && h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 0.9 + vec2(time * 0.004, time * 0.0015);
      float c = fbm(uv);
      float cov = smoothstep(0.5, 0.78, c);
      float lit = clamp((c - fbm(uv + sunDir.xz * 0.06)) * 5.0 + 0.55, 0.0, 1.0);
      vec3 cc = mix(vec3(0.42, 0.46, 0.55), vec3(1.15, 1.06, 0.96), lit);
      cc += vec3(1.0, 0.65, 0.35) * pow(m, 5.0) * 0.6;
      col = mix(col, cc, cov * smoothstep(0.0, 0.22, h) * clouds);
    }
    // below the horizon: haze
    col = mix(col, haze * 0.8, smoothstep(0.0, -0.12, h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #ifdef USE_FOG
      // fogColor is in the same space as the fogged scene: blend the horizon band into it
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, (1.0 - smoothstep(-0.02, 0.16, h)) * 0.9);
    #endif
  }`;

export function makeSky(withClouds = true): THREE.Mesh {
  const geo = new THREE.SphereGeometry(600, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        sunDir: { value: SUN_DIR.clone() },
        haze: { value: HAZE.clone() },
        time: { value: 0 },
        clouds: { value: withClouds ? 1 : 0 },
      },
    ]),
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  // clouds drift slowly; the sky follows the camera so it never clips
  mesh.onBeforeRender = (_r, _s, camera) => {
    mat.uniforms.time.value = ambientTime();
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

export interface Lights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  flash: THREE.PointLight;
}

export function makeLights(scene: THREE.Scene): Lights {
  // Most ambient light comes from the sky environment map (scene.environment);
  // the hemisphere only adds a little blue sky fill and warm ground bounce.
  const hemi = new THREE.HemisphereLight(0xa9c8ff, 0x7a6450, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd6a8, 4.2);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  const cam = sun.shadow.camera;
  cam.left = -42; cam.right = 42; cam.top = 42; cam.bottom = -42;
  cam.near = 1; cam.far = 260;
  scene.add(sun);
  scene.add(sun.target);
  // Single shared muzzle-flash light. Kept in the scene permanently so the
  // light count never changes (that would recompile every shader).
  const flash = new THREE.PointLight(0xffb060, 0, 7, 2);
  scene.add(flash);
  // exponential haze: aerial perspective that thickens with distance
  scene.fog = new THREE.FogExp2(HAZE.clone().multiplyScalar(1.12), 0.0046);
  return { sun, hemi, flash };
}

const _right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
const _up = new THREE.Vector3().crossVectors(SUN_DIR, _right).normalize();
const _c = new THREE.Vector3();

/**
 * Moves the shadow frustum with the camera focus. The centre is snapped to
 * whole shadow-map texels in the light's own plane, so shadow edges don't
 * crawl or shimmer while the player walks.
 */
export function updateSun(l: Lights, focus: THREE.Vector3): void {
  const size = l.sun.shadow.camera.right - l.sun.shadow.camera.left;
  const texel = size / Math.max(1, l.sun.shadow.mapSize.x);
  const a = Math.round(focus.dot(_right) / texel) * texel;
  const b = Math.round(focus.dot(_up) / texel) * texel;
  _c.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(SUN_DIR, focus.dot(SUN_DIR));
  l.sun.target.position.copy(_c);
  l.sun.position.copy(_c).addScaledVector(SUN_DIR, 120);
  l.sun.target.updateMatrixWorld();
}

/**
 * Image-based lighting from the same sky (clouds off: they would make the
 * ambient light blotchy). A dark-ish ground hemisphere gives the bounce.
 */
export function makeEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const sky = makeSky(false);
  sky.onBeforeRender = () => {};
  (sky.material as THREE.ShaderMaterial).depthTest = false;
  s.add(sky);
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  groundGeo.rotateX(-Math.PI / 2);
  const g = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x4a443d }));
  g.position.y = -5;
  s.add(g);
  // a few bright "building" faces so reflections are not just sky and floor
  const wall = new THREE.MeshBasicMaterial({ color: 0x8d8a84 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(40, 30 + (i % 3) * 20, 40), wall);
    b.position.set(Math.cos(a) * 160, 10, Math.sin(a) * 160);
    s.add(b);
  }
  const rt = pm.fromScene(s, 0.02, 0.1, 1000);
  pm.dispose();
  return rt.texture;
}
