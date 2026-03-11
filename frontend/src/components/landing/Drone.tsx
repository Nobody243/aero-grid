'use client';

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

const LOOP_SECONDS = 20;
const STATIC_PATH_SAMPLES = 96;
const TRAIL_LENGTH = 40;

// Quad-rotor sketch + fading travel trail. The full loop path is rendered
// statically (bloom + sharp pass) so you can read the route at rest; the
// trail is a short fading tail that lags behind the body.
export const Drone: React.FC<{ waypoints: THREE.Vector3[] }> = ({ waypoints }) => {
  const droneRef = useRef<THREE.Group>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trailRef = useRef<any>(null);

  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(waypoints, true, 'catmullrom', 0.4),
    [waypoints],
  );

  // Full loop sampled once — used by both the bloom layer and the sharp core.
  const staticPath = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= STATIC_PATH_SAMPLES; i++) {
      out.push(curve.getPointAt(i / STATIC_PATH_SAMPLES));
    }
    return out;
  }, [curve]);

  // Reusable flat buffer for the trail's setPositions call.
  const trailBuffer = useMemo(() => new Float32Array(TRAIL_LENGTH * 3), []);
  // Vertex colors fade the tail from full cyan to near-black (against a dark
  // ground that reads as "the trail is dissolving" without alpha gradients).
  // Initial array doubles as drei's `vertexColors` prop so the underlying
  // LineMaterial is created with per-vertex coloring enabled.
  const trailVertexColors = useMemo<[number, number, number][]>(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const k = 1 - i / TRAIL_LENGTH;
      out.push([0, 0.8 * k, 1.0 * k]);
    }
    return out;
  }, []);
  const trailColorBuffer = useMemo(() => {
    const c = new Float32Array(TRAIL_LENGTH * 3);
    trailVertexColors.forEach((rgb, i) => {
      c[i * 3 + 0] = rgb[0];
      c[i * 3 + 1] = rgb[1];
      c[i * 3 + 2] = rgb[2];
    });
    return c;
  }, [trailVertexColors]);

  // Seed the trail with the first curve points so the geometry is non-empty
  // before the first frame.
  const trailSeed = useMemo(() => staticPath.slice(0, TRAIL_LENGTH), [staticPath]);

  useFrame(({ clock }) => {
    const t = (clock.getElapsedTime() % LOOP_SECONDS) / LOOP_SECONDS;
    const head = curve.getPointAt(t);
    if (droneRef.current) {
      droneRef.current.position.copy(head);
      const ahead = curve.getPointAt((t + 0.012) % 1);
      droneRef.current.lookAt(ahead);
    }
    // Walk the trail BACKWARDS from the current head along the curve.
    // Spacing of 0.004 of curve length keeps the trail compact regardless of
    // animation speed.
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const tt = (t - i * 0.004 + 1) % 1;
      const p = curve.getPointAt(tt);
      trailBuffer[i * 3 + 0] = p.x;
      trailBuffer[i * 3 + 1] = p.y;
      trailBuffer[i * 3 + 2] = p.z;
    }
    if (trailRef.current?.geometry) {
      trailRef.current.geometry.setPositions(Array.from(trailBuffer));
      trailRef.current.geometry.setColors?.(Array.from(trailColorBuffer));
    }
  });

  return (
    <>
      {/* Static loop — two passes for a soft bloom around a sharp core.
          Without postprocessing bloom the opacities must run hotter so the
          path holds visual weight against the now-lighter ground plane. */}
      <Line
        points={staticPath}
        color="#00ddb4"
        lineWidth={4}
        transparent
        opacity={0.25}
        toneMapped={false}
      />
      <Line
        points={staticPath}
        color="#00ddb4"
        lineWidth={2}
        transparent
        opacity={1.0}
        toneMapped={false}
      />

      {/* Active trail — short, fading via vertex colors */}
      <Line
        ref={trailRef}
        points={trailSeed}
        vertexColors={trailVertexColors}
        lineWidth={2.5}
        transparent
        opacity={0.9}
        toneMapped={false}
      />

      {/* Drone body — flat quad-rotor sketch */}
      <group ref={droneRef}>
        <mesh castShadow>
          <boxGeometry args={[0.18, 0.04, 0.18]} />
          <meshStandardMaterial color="#1a2336" roughness={0.6} metalness={0.35} />
        </mesh>
        {/* Four rotor dots at the corners — the only thing that glows */}
        {[
          [ 0.09, 0,  0.09],
          [-0.09, 0,  0.09],
          [ 0.09, 0, -0.09],
          [-0.09, 0, -0.09],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]}>
            <sphereGeometry args={[0.04, 10, 10]} />
            <meshStandardMaterial
              color="#00ccff"
              emissive="#00ccff"
              emissiveIntensity={1.8}
              toneMapped={false}
            />
          </mesh>
        ))}
        <pointLight color="#00ccff" intensity={0.55} distance={3.2} decay={1.8} />
      </group>
    </>
  );
};
