/**
 * PS1-style shader patches for Three.js
 * Based on https://romanliutikov.com/blog/ps1-style-graphics-in-threejs
 *
 * Patches THREE.ShaderChunk globals before any materials compile:
 *  1. Vertex snapping   → project_vertex
 *  2. Affine UV mapping → uv_pars_vertex / uv_pars_fragment / project_vertex / map_fragment
 *  3. Dithering + 15-bit posterization → common (functions) + ShaderLib.physical (call site)
 */

import * as THREE from "three"

let applied = false

export function applyPS1Shaders() {
  if (applied) return
  applied = true

  // ─── 1. VERTEX SNAPPING + AFFINE UV PREP ─────────────────────────────────
  // Appended to project_vertex (runs after gl_Position is set + mvPosition exists)
  THREE.ShaderChunk.project_vertex += /* glsl */ `

  // ── PS1: vertex snap to integer pixel grid ──────────────────────────────
  {
    vec2 ps1Res = vec2(320.0, 240.0);
    gl_Position.xyz /= gl_Position.w;
    gl_Position.xy   = floor(ps1Res * gl_Position.xy) / ps1Res;
    gl_Position.xyz *= gl_Position.w;
  }

  // ── PS1: scale vMapUv by affine factor (perspective-incorrect mapping) ──
  #ifdef USE_MAP
  {
    float ps1Dist = length(mvPosition.xyz);
    vAffine = ps1Dist + (gl_Position.w * 8.0) / max(ps1Dist, 0.001) * 0.5;
    vMapUv *= vAffine;
  }
  #endif
`

  // ─── 2. vAffine VARYING DECLARATIONS ─────────────────────────────────────
  THREE.ShaderChunk.uv_pars_vertex += /* glsl */ `
  #ifdef USE_MAP
    varying float vAffine;
  #endif
`

  THREE.ShaderChunk.uv_pars_fragment += /* glsl */ `
  #ifdef USE_MAP
    varying float vAffine;
  #endif
`

  // ─── 3. AFFINE UV CORRECTION IN FRAGMENT ─────────────────────────────────
  // Divide vMapUv back by vAffine to undo affine distortion per-fragment
  THREE.ShaderChunk.map_fragment = THREE.ShaderChunk.map_fragment.replace(
    /texture2D\(\s*map\s*,\s*vMapUv\s*\)/g,
    "texture2D( map, vMapUv / vAffine )"
  )

  // ─── 4. DITHERING / 15-BIT POSTERIZATION FUNCTIONS → common ──────────────
  // Added to common so they compile into every shader (no-op until called)
  THREE.ShaderChunk.common += /* glsl */ `

  // ════════════════════ PS1 DITHERING ════════════════════════════════════════
  vec4 ps1_RGBtoYUV(vec4 rgba) {
    vec4 yuva;
    yuva.r  = rgba.r * 0.2126 + 0.7152 * rgba.g + 0.0722 * rgba.b;
    yuva.g  = (rgba.b - yuva.r) / 1.8556;
    yuva.b  = (rgba.r - yuva.r) / 1.5748;
    yuva.a  = rgba.a;
    yuva.gb += 0.5;
    return yuva;
  }

  vec4 ps1_YUVtoRGB(vec4 yuva) {
    yuva.gb -= 0.5;
    return vec4(
      yuva.r                               + yuva.b * 1.5748,
      yuva.r + yuva.g * -0.187324          + yuva.b * -0.468124,
      yuva.r + yuva.g * 1.8556,
      yuva.a
    );
  }

  float ps1_channelError(float col, float lo, float hi) {
    float range = abs(lo - hi);
    return range < 0.0001 ? 0.0 : abs(col - lo) / range;
  }

  float ps1_bayer8x8(vec2 pos, float scale, float brightness) {
    int x = int(mod(pos.x / scale, 8.0));
    int y = int(mod(pos.y / scale, 8.0));
    const float r0[8] = float[8]( 0.0,32.0, 8.0,40.0, 2.0,34.0,10.0,42.0);
    const float r1[8] = float[8](48.0,16.0,56.0,24.0,50.0,18.0,58.0,26.0);
    const float r2[8] = float[8](12.0,44.0, 4.0,36.0,14.0,46.0, 6.0,38.0);
    const float r3[8] = float[8](60.0,28.0,52.0,20.0,62.0,30.0,54.0,22.0);
    const float r4[8] = float[8]( 3.0,35.0,11.0,43.0, 1.0,33.0, 9.0,41.0);
    const float r5[8] = float[8](51.0,19.0,59.0,27.0,49.0,17.0,57.0,25.0);
    const float r6[8] = float[8](15.0,47.0, 7.0,39.0,13.0,45.0, 5.0,37.0);
    const float r7[8] = float[8](63.0,31.0,55.0,23.0,61.0,29.0,53.0,21.0);
    float d;
    if      (x == 0) d = r0[y];
    else if (x == 1) d = r1[y];
    else if (x == 2) d = r2[y];
    else if (x == 3) d = r3[y];
    else if (x == 4) d = r4[y];
    else if (x == 5) d = r5[y];
    else if (x == 6) d = r6[y];
    else             d = r7[y];
    return brightness < (d + 1.0) / 64.0 ? 0.0 : 1.0;
  }

  vec4 ps1_dither(vec2 pos, vec4 color, float depth, float scale) {
    vec4 yuv  = ps1_RGBtoYUV(color);
    vec4 lo   = floor(yuv * depth) / depth;
    vec4 hi   = ceil (yuv * depth) / depth;
    yuv.x = mix(lo.x, hi.x, ps1_bayer8x8(pos, scale, ps1_channelError(yuv.x, lo.x, hi.x)));
    yuv.y = mix(lo.y, hi.y, ps1_bayer8x8(pos, scale, ps1_channelError(yuv.y, lo.y, hi.y)));
    yuv.z = mix(lo.z, hi.z, ps1_bayer8x8(pos, scale, ps1_channelError(yuv.z, lo.z, hi.z)));
    return ps1_YUVtoRGB(yuv);
  }
  // ═══════════════════════════════════════════════════════════════════════════
`

  // ─── 5. APPLY DITHERING TO EVERY BUILT-IN MATERIAL ──────────────────────
  // dithering_fragment is the last chunk of the basic/lambert/phong/standard/
  // physical fragment shaders, so this runs on the final display colour (after
  // tone mapping + sRGB): 15-bit colour (31 levels/channel) with an 8×8 Bayer
  // dither, like the PS1's framebuffer. (It used to patch a line that moved into
  // opaque_fragment in newer three, so it silently never applied.)
  THREE.ShaderChunk.dithering_fragment += /* glsl */ `
  gl_FragColor = ps1_dither(gl_FragCoord.xy, gl_FragColor, 31.0, 1.0);
`
}
