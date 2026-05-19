'use client';

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Building } from './Building';
import { Drone } from './Drone';

const GRID = 16;
const BUILDING_COUNT = 22;
const CAMERA_TARGET: [number, number, number] = [4, 0, 4];

// Tiny seeded RNG — deterministic city layout across reloads.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DRONE_WAYPOINTS = [
  new THREE.Vector3(2, 1.2, 2),
  new THREE.Vector3(5, 1.6, 4),
  new THREE.Vector3(9, 1.8, 5),
  new THREE.Vector3(12, 1.4, 7),
  new THREE.Vector3(13, 1.7, 11),
  new THREE.Vector3(9, 1.3, 13),
  new THREE.Vector3(5, 1.5, 12),
  new THREE.Vector3(3, 1.1, 9),
];

const TARGETS: [number, number, number][] = [
  [5, 0.4, 4],
  [9, 0.4, 5],
  [12, 0.4, 7],
  [13, 0.4, 11],
  [9, 0.4, 13],
  [5, 0.4, 12],
  [3, 0.4, 9],
  [7, 0.4, 9],
];

const NFZS = [
  { position: [7, 0, 6] as [number, number, number], radius: 1.3 },
  { position: [11, 0, 10] as [number, number, number], radius: 1.5 },
];

const DEPOT: [number, number, number] = [1, 0, 1];

const generateBuildings = (seed: number) => {
  const r = mulberry32(seed);
  const reserved = new Set<string>();
  const reserve = (x: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        reserved.add(`${Math.round(x) + dx},${Math.round(z) + dz}`);
  };
  reserve(DEPOT[0], DEPOT[2]);
  TARGETS.forEach((t) => reserve(t[0], t[2]));
  NFZS.forEach((n) => reserve(n.position[0], n.position[2]));
  DRONE_WAYPOINTS.forEach((w) => reserved.add(`${Math.round(w.x)},${Math.round(w.z)}`));

  const buildings: { position: [number, number, number]; width: number; depth: number; height: number }[] = [];
  let safety = 0;
  while (buildings.length < BUILDING_COUNT && safety < 500) {
    safety++;
    const gx = Math.floor(r() * GRID);
    const gz = Math.floor(r() * GRID);
    if (reserved.has(`${gx},${gz}`)) continue;
    reserved.add(`${gx},${gz}`);
    buildings.push({
      position: [gx, 0, gz],
      width:  0.72 + r() * 0.42,
      depth:  0.72 + r() * 0.42,
      height: 0.45 + Math.pow(r(), 1.6) * 2.1,
    });
  }
  return buildings;
};

export default function CityScene3D() {
  const buildings = useMemo(() => generateBuildings(11), []);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [9, 8, 9], fov: 32 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
    >
      <Scene buildings={buildings} />
    </Canvas>
  );
}

function Scene({ buildings }: { buildings: ReturnType<typeof generateBuildings> }) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[10, 15, 8]}
        intensity={1.3}
        color="#eef2f8"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={60}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      {/* Ground — lifted out of page-bg territory so it has a defined edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8, 0, 8]} receiveShadow>
        <planeGeometry args={[22, 22]} />
        <meshStandardMaterial color="#0d1828" roughness={0.95} metalness={0} />
      </mesh>

      <gridHelper args={[16, 16, '#1a2540', '#1a2540']} position={[8, 0.002, 8]} />

      {buildings.map((b, i) => (
        <Building key={i} {...b} />
      ))}

      {NFZS.map((n, i) => (
        <NoFlyZone key={i} position={n.position} radius={n.radius} />
      ))}

      <Depot position={DEPOT} />

      {TARGETS.map((pos, i) => (
        <Target key={i} position={pos} index={i} />
      ))}

      <Drone waypoints={DRONE_WAYPOINTS} />

      <OrbitControls
        target={CAMERA_TARGET}
        enablePan={false}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 3}
        minDistance={11}
        maxDistance={19}
        autoRotate
        autoRotateSpeed={0.4}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

// ── No-fly zone: translucent volume + sharp top-edge ring ──────────────

function NoFlyZone({ position, radius }: { position: [number, number, number]; radius: number }) {
  const ringPoints = useMemo<[number, number, number][]>(() => {
    const segs = 48;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push([Math.cos(a) * radius, 0.25, Math.sin(a) * radius]);
    }
    return pts;
  }, [radius]);

  return (
    <group position={position}>
      <mesh position={[0, 0.125, 0]}>
        <cylinderGeometry args={[radius, radius, 0.25, 48]} />
        <meshStandardMaterial
          color="#cc2222"
          emissive="#cc2222"
          emissiveIntensity={0.30}
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Line
        points={ringPoints}
        color="#cc2222"
        lineWidth={1.2}
        transparent
        opacity={0.6}
        toneMapped={false}
      />
    </group>
  );
}

// ── Depot: dark cap + pulsing green emissive ring at ground level ──────

function Depot({ position }: { position: [number, number, number] }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const mat = ringRef.current.material as THREE.MeshStandardMaterial;
    // Pulse around the new louder baseline (0.7 → 1.1). Reads as luminous
    // without bloom postprocessing.
    const k = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 2.4);
    mat.emissiveIntensity = 0.7 + k * 0.4;
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.12, 0.7]} />
        <meshStandardMaterial color="#141c2e" roughness={0.8} metalness={0.1} />
      </mesh>
      <mesh
        ref={ringRef}
        position={[0, 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.6, 0.025, 12, 48]} />
        <meshStandardMaterial
          color="#00d45a"
          emissive="#00d45a"
          emissiveIntensity={1.0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ── Target: floating gold ring, gentle bob, never grounded ─────────────

function Target({ position, index }: { position: [number, number, number]; index: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const baseY = position[1];
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = baseY + Math.sin(clock.getElapsedTime() + index * 0.5) * 0.05;
    ref.current.rotation.y += 0.004;
  });
  return (
    <mesh ref={ref} position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <torusGeometry args={[0.18, 0.02, 10, 36]} />
      <meshStandardMaterial
        color="#ffcc00"
        emissive="#ffcc00"
        emissiveIntensity={1.4}
        metalness={0}
        roughness={0.4}
        toneMapped={false}
      />
    </mesh>
  );
}
