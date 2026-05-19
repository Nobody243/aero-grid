'use client';

import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { Vector3Tuple } from 'three';

// True rim lighting: the building itself is matte near-black with no emissive.
// A single hairline runs ONLY along the four top edges — the catch-light a
// real architectural model would have. Nothing colors the top face.
export const Building: React.FC<{
  position: [number, number, number];
  width: number;
  depth: number;
  height: number;
}> = ({ position, width, depth, height }) => {
  const [x, , z] = position;

  // Closed rectangle of 4 points along the top perimeter, in world-local space.
  const topRim = useMemo<Vector3Tuple[]>(() => {
    const w2 = width / 2;
    const d2 = depth / 2;
    return [
      [-w2, height, -d2],
      [ w2, height, -d2],
      [ w2, height,  d2],
      [-w2, height,  d2],
      [-w2, height, -d2],
    ];
  }, [width, depth, height]);

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#141c2e" roughness={0.8} metalness={0.1} />
      </mesh>
      <Line
        points={topRim}
        color="#2a3a55"
        lineWidth={1}
        transparent
        opacity={0.6}
        toneMapped={false}
      />
    </group>
  );
};
