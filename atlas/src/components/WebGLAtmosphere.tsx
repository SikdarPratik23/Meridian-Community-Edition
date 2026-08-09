import { useEffect, useRef } from 'react';
import type { Scene } from '../features/welcome/scene';

/**
 * The optional GPU atmosphere layer — the only part of the backdrop that uses
 * the graphics hardware directly (WebGL2), enabled at the High/Ultra graphics
 * tiers. It renders, in a single fragment shader over one full-screen triangle:
 *
 *   - drifting volumetric haze (fbm noise), denser toward the horizon and in
 *     storms, and
 *   - soft light shafts + a bloom emanating from the sun/moon,
 *
 * blended additively over the hybrid SVG + canvas scene beneath it. It adds real
 * depth and moving light that CSS/2D can't cheaply do.
 *
 * It is deliberately NOT the default renderer. The hybrid scene is always drawn;
 * this only layers on top when the user chooses High/Ultra AND the device has
 * WebGL2. If WebGL2 is missing or the context is lost, it simply renders nothing
 * and the hybrid look stands on its own — no visual gap.
 *
 * Guardrails mirror ParticleField: skipped under prefers-reduced-motion, paused
 * on a hidden tab, DPR capped (a shader is fragment-bound, so pixels are the
 * cost), and it reads the scene live from a ref so weather/day-night changes
 * never restart the GL program. Purely decorative: pointer-events off,
 * aria-hidden.
 */

const VERT = `#version 300 es
// A single big triangle covering the screen — no vertex buffers needed.
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 frag;
uniform float uTime;
uniform vec2  uRes;
uniform vec2  uSun;      // light position, normalised (x right, y up)
uniform float uNight;
uniform float uStorm;
uniform float uWind;
uniform float uHasLight; // 0 while precipitating (sun/moon hidden)
uniform float uIntensity;
uniform vec3  uTint;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  float t = uTime * 0.02;

  // Volumetric haze — drifting fbm, thicker near the horizon (lower third).
  vec2 drift = vec2(t * (0.6 + uWind * 1.8), t * 0.12);
  float haze = smoothstep(0.35, 0.92, fbm(p * vec2(2.2, 3.4) + drift));
  float horizon = smoothstep(0.78, 0.12, vUv.y);
  float hazeA = haze * horizon * (0.09 + 0.22 * uStorm) * uIntensity;

  // Light shafts radiating from the sun/moon, plus a soft bloom around it.
  vec2 sun = vec2(uSun.x * aspect, uSun.y);
  vec2 d = p - sun;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  float rays = pow(smoothstep(0.3, 1.0, fbm(vec2(ang * 3.0, dist * 2.2 - t * 1.1))), 2.0);
  float falloff = smoothstep(1.15, 0.0, dist);
  float shaftK = mix(0.5, 0.2, uNight) * uHasLight * (1.0 - 0.6 * uStorm);
  float shafts = rays * falloff * shaftK * uIntensity;
  float glow = smoothstep(0.45, 0.0, dist) * 0.3 * uHasLight * uIntensity * (1.0 - 0.5 * uStorm);

  vec3 col = uTint * (shafts + glow + hazeA * 0.8);
  float alpha = clamp(shafts * 0.7 + glow * 0.55 + hazeA, 0.0, 0.6);
  frag = vec4(col, alpha);
}`;

function tintFor(scene: Scene): [number, number, number] {
  if (scene.storm) return [0.66, 0.7, 0.8];
  if (scene.mode === 'rain') return [0.62, 0.72, 0.86];
  if (scene.mode === 'snow') return [0.86, 0.9, 0.98];
  if (scene.night) return [0.62, 0.72, 1.0];
  if (scene.mode === 'clouds') return [0.82, 0.84, 0.88];
  return [1.0, 0.82, 0.5]; // clear day — warm gold
}

export default function WebGLAtmosphere({ scene, intensity }: { scene: Scene; intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(scene);
  useEffect(() => { sceneRef.current = scene; });

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
    });
    if (!gl) return; // no WebGL2 — the hybrid scene already carries the look

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('Atmosphere shader failed:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('Atmosphere link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uTime = u('uTime'), uRes = u('uRes'), uSun = u('uSun'), uNight = u('uNight');
    const uStorm = u('uStorm'), uWind = u('uWind'), uHasLight = u('uHasLight');
    const uIntensity = u('uIntensity'), uTint = u('uTint');

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive — light adds, never darkens

    const parent = canvas.parentElement!;
    let W = 0, H = 0;
    const resize = () => {
      // A fragment shader's cost is per-pixel, so cap DPR tighter than the 2D
      // layers — this keeps Ultra smooth without visibly softening the haze.
      const dpr = Math.min(1.75, window.devicePixelRatio || 1);
      W = parent.clientWidth;
      H = parent.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const isMobile = W < 640;
    // On phones the light sits in the very top-right corner; on desktop it's
    // inset from the right (matching the CSS sun/moon position).
    const sunPos: [number, number] = isMobile ? [0.9, 0.9] : [0.72, 0.82];

    const start = performance.now();
    let raf = 0;
    const frame = () => {
      const s = sceneRef.current;
      const time = (performance.now() - start) / 1000;
      const tint = tintFor(s);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uSun, sunPos[0], sunPos[1]);
      gl.uniform1f(uNight, s.night ? 1 : 0);
      gl.uniform1f(uStorm, s.storm ? 1 : 0);
      gl.uniform1f(uWind, s.wind);
      gl.uniform1f(uHasLight, s.mode === 'rain' || s.mode === 'snow' ? 0 : 1);
      gl.uniform1f(uIntensity, intensity);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    const drawOnce = () => {
      // Reduced motion: one static frame, no loop.
      const s = sceneRef.current;
      const tint = tintFor(s);
      gl.uniform1f(uTime, 0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uSun, sunPos[0], sunPos[1]);
      gl.uniform1f(uNight, s.night ? 1 : 0);
      gl.uniform1f(uStorm, s.storm ? 1 : 0);
      gl.uniform1f(uWind, 0.2);
      gl.uniform1f(uHasLight, s.mode === 'rain' || s.mode === 'snow' ? 0 : 1);
      gl.uniform1f(uIntensity, intensity);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const startLoop = () => { if (!raf && !reducedMotion) raf = requestAnimationFrame(frame); };
    const stopLoop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const onVisibility = () => (document.hidden ? stopLoop() : startLoop());

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { resize(); if (reducedMotion) drawOnce(); }, 150);
    };

    // If the GPU drops the context (tab backgrounded on mobile, driver reset),
    // stop cleanly rather than spamming errors; the hybrid scene remains.
    const onContextLost = (e: Event) => { e.preventDefault(); stopLoop(); };

    canvas.addEventListener('webglcontextlost', onContextLost);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    if (reducedMotion) drawOnce();
    else if (!document.hidden) startLoop();

    return () => {
      stopLoop();
      window.clearTimeout(resizeTimer);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (vao) gl.deleteVertexArray(vao);
    };
    // Re-create only if the reduced-motion preference or intensity (tier) changes;
    // scene updates flow through sceneRef without restarting the GL program.
  }, [reducedMotion, intensity]);

  return <canvas ref={canvasRef} className="hs-canvas atmos-canvas" aria-hidden="true" />;
}
