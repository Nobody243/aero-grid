'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

export type EditTool =
  | 'cursor'
  | 'building'
  | 'nfz'
  | 'target'
  | 'depot'
  | 'erase'
  // 'perturbation' is used by /learn's manual generalization mode. Same
  // hit semantics as 'building' but the hover ghost is amber so it
  // matches how placed perturbations render (with addedBuildings).
  | 'perturbation';

interface CityCanvasProps {
  buildings: number[][];
  nfz: number[][];
  targets: number[][];
  depot?: number[];
  showGrid?: boolean;
  activeRoute?: number[][];
  exploredCells?: number[][];
  currentPath?: number[][];
  completedPaths?: number[][][];
  dronePos?: number[];
  droneTrail?: number[][];
  highlightTarget?: number;
  className?: string;
  label?: string;
  batteryLevel?: number;

  // Edit-mode additions (all optional, fully backwards compatible).
  editMode?: boolean;
  activeTool?: EditTool;
  onCellClick?: (x: number, y: number, button: 0 | 2) => void;
  unreachableTargets?: number[];
  blockedTargets?: number[];
  disabled?: boolean;

  // Atmospheric overlay used during the mission's weather phase. Each
  // sub-effect only kicks in once its respective metric crosses the threshold.
  weatherOverlay?: { wind: number; visibility: number; rainfall: number };

  // Q-Learning training visualization: per-cell max-Q value. Renders as a
  // signed two-tone heatmap between the explored-cells layer and the NFZ
  // layer (so under buildings, never over them). Cells with q === 0 are
  // skipped — they represent unvisited states.
  qTableHeatmap?: number[][];

  // Buildings flagged as "added during generalization". Rendered with the
  // same fill as regular buildings but with an amber outline so the user
  // sees which cells were not in the training environment.
  addedBuildings?: number[][];
}

const GRID_SIZE = 40;
const CELL_SIZE = 14;
const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;

const TOOL_PREVIEW: Record<
  EditTool,
  { kind: 'cell' | 'circle' | 'none'; fill: string; stroke: string }
> = {
  cursor:       { kind: 'none',   fill: '',                       stroke: ''           },
  building:     { kind: 'cell',   fill: 'rgba(36, 54, 80, 0.55)', stroke: '#3a5078'    },
  nfz:          { kind: 'cell',   fill: 'rgba(224,53,53,0.18)',   stroke: '#cc2222'    },
  target:       { kind: 'circle', fill: 'rgba(255,204,0,0.35)',   stroke: '#ffcc00'    },
  depot:        { kind: 'cell',   fill: 'rgba(0,212,90,0.18)',    stroke: '#00d45a'    },
  erase:        { kind: 'cell',   fill: 'rgba(255,255,255,0.10)', stroke: '#a0b4d0'    },
  perturbation: { kind: 'cell',   fill: 'rgba(26, 37, 64, 0.55)', stroke: 'rgba(255, 170, 0, 0.70)' },
};

// ── Weather overlay (atmosphere; targets/buildings stay readable underneath) ──
// Each sub-effect: threshold gate + opacity proportional to severity. Tuned so
// the Storm preset (wind 65 / vis 0.8 / rain 18) reads as unmistakably bad
// weather, while moderate conditions stay gentle. Storm opacities: fog 0.50,
// wind 0.55, rain 0.65 — explicitly above the floor the user wants to see.
const WeatherOverlay: React.FC<{ conditions: { wind: number; visibility: number; rainfall: number } }> = ({ conditions }) => {
  const { wind, visibility, rainfall } = conditions;
  const showWind = wind > 30;
  const showFog = visibility < 4;
  const showRain = rainfall > 5;
  if (!showWind && !showFog && !showRain) return null;
  return (
    <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
      {showFog && (
        <div
          className="absolute inset-0 bg-[#a0b4d0]"
          style={{ opacity: Math.min(0.50, ((4 - visibility) / 4) * 0.65) }}
          aria-hidden
        />
      )}
      {showWind && (
        <div
          className="absolute inset-y-0 -left-1/4 -right-1/4 weather-wind"
          style={{ opacity: Math.min(0.60, (wind - 30) / 50) }}
          aria-hidden
        />
      )}
      {showRain && (
        <div
          className="absolute -inset-y-4 inset-x-0 weather-rain"
          style={{ opacity: Math.min(0.70, (rainfall - 5) / 15) }}
          aria-hidden
        />
      )}
    </div>
  );
};

export const CityCanvas: React.FC<CityCanvasProps> = ({
  buildings,
  nfz,
  targets,
  depot,
  showGrid = true,
  activeRoute,
  exploredCells,
  currentPath,
  completedPaths,
  dronePos,
  droneTrail,
  highlightTarget,
  className = '',
  label = 'CITY GRID — 40×40',
  batteryLevel = 100,
  editMode = false,
  activeTool = 'cursor',
  onCellClick,
  unreachableTargets,
  blockedTargets,
  disabled = false,
  weatherOverlay,
  qTableHeatmap,
  addedBuildings,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);

  const isPaintingRef = useRef(false);
  const lastPaintedRef = useRef<string | null>(null);

  // Pulse animation lives in a ref, NOT React state. The depot halo and
  // target rings are the only readers, and they read inside the imperative
  // draw routine. Going through setState here cascaded into a re-render
  // storm once two CityCanvas instances were mounted simultaneously (the
  // side-by-side replay on /learn). The draw routine is invoked from the
  // rAF below; setting pulse in state would also have caused the parent
  // re-render machinery to fire 60-120 times/sec for no React-visible
  // change.
  const pulseRef = useRef(0);
  // The latest draw closure, re-bound by the draw-setup effect below
  // whenever props change. Called once per rAF frame.
  const drawRef = useRef<(() => void) | null>(null);

  // rAF: drives pulse + canvas redraw. Mount-only; never restarts.
  useEffect(() => {
    let animFrame: number;
    const tick = (time: number) => {
      pulseRef.current = (Math.sin(time / 200) + 1) / 2;
      drawRef.current?.();
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, []);


  // Value-equality guard. dronePos arrives as a freshly-allocated array
  // on every parent render (fractional interpolation in /learn produces
  // a new [x, y] each frame). Without this check setCoords fired every
  // frame even when the integer cell didn't change, causing ~120
  // pointless re-renders per second across the dual canvases.
  //
  // The two coord values are pulled out to plain locals so the deps
  // array is always four primitive slots — never a conditional dep,
  // never an inline property access that could be mistaken for a
  // dynamically-sized list during HMR.
  const coordsX = coords.x;
  const coordsY = coords.y;
  useEffect(() => {
    let nextX: number | null = null;
    let nextY: number | null = null;
    if (dronePos) {
      nextX = Math.round(dronePos[0]);
      nextY = Math.round(dronePos[1]);
    } else if (hoverCell) {
      nextX = hoverCell.x;
      nextY = hoverCell.y;
    }
    if (nextX === null || nextY === null) return;
    if (nextX !== coordsX || nextY !== coordsY) {
      setCoords({ x: nextX, y: nextY });
    }
  }, [dronePos, hoverCell, coordsX, coordsY]);

  // ── Mouse-to-grid translation ────────────────────────────────────────

  const cellFromEvent = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) return null;
    const x = Math.floor((px / rect.width) * GRID_SIZE);
    const y = Math.floor((py / rect.height) * GRID_SIZE);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null;
    return { x, y };
  }, []);

  const dragEnabled = activeTool === 'building' || activeTool === 'nfz' || activeTool === 'erase';

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!editMode || disabled) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const button = (e.button === 2 ? 2 : 0) as 0 | 2;
    onCellClick?.(cell.x, cell.y, button);
    lastPaintedRef.current = `${cell.x},${cell.y}`;
    if (button === 0 && dragEnabled) {
      isPaintingRef.current = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!editMode) return;
    const cell = cellFromEvent(e);
    setHoverCell(cell);
    if (disabled || !cell || !isPaintingRef.current) return;
    const key = `${cell.x},${cell.y}`;
    if (key === lastPaintedRef.current) return;
    lastPaintedRef.current = key;
    onCellClick?.(cell.x, cell.y, 0);
  };

  const stopPainting = () => {
    isPaintingRef.current = false;
    lastPaintedRef.current = null;
  };

  const handleMouseLeave = () => {
    stopPainting();
    setHoverCell(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!editMode) return;
    e.preventDefault();
  };

  // ── Draw ────────────────────────────────────────────────────────────
  // This effect REGISTERS the draw routine via drawRef; it doesn't draw
  // directly. The rAF loop above invokes drawRef.current() once per frame
  // so the canvas redraw rate matches the pulse animation rate (60fps)
  // without going through React state. Two mounted instances cost two
  // imperative draws per frame instead of two React update cycles.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawRef.current = () => {
      // Read the latest pulse value from the ref each invocation; the
      // closure captures the rest of the props from this effect's scope.
      const pulse = pulseRef.current;

    // Draw order, back to front:
    //   1. Background       2. Grid              3. Explored cells (A* debug)
    //   4. NFZ volumes      5. Completed paths   6. BUILDINGS (opaque obstacles)
    //   7. Active route     8. Current path      9. Drone trail
    //  10. Drone           11. Targets          12. Depot
    //  13. Edit hover ghost
    // Buildings are physical obstacles — they sit on top of all path/explored
    // overlays and below the drone + UI markers (which fly above the skyline).
    const drawPath = (path: number[][], colorWide: string, colorMid: string, colorThin: string) => {
      if (path.length < 2) return;
      const widths = [6, 3, 1.5];
      const colors = [colorWide, colorMid, colorThin];
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = widths[i];
        ctx.beginPath();
        ctx.moveTo(path[0][0] * CELL_SIZE + CELL_SIZE / 2, path[0][1] * CELL_SIZE + CELL_SIZE / 2);
        path.forEach((p) => ctx.lineTo(p[0] * CELL_SIZE + CELL_SIZE / 2, p[1] * CELL_SIZE + CELL_SIZE / 2));
        ctx.stroke();
      }
    };

    // 1. Background
    ctx.fillStyle = '#040810';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 2. Grid
    if (showGrid) {
      ctx.strokeStyle = '#0d1625';
      ctx.lineWidth = 1;
      for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, 0);
        ctx.lineTo(i * CELL_SIZE, CANVAS_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL_SIZE);
        ctx.lineTo(CANVAS_SIZE, i * CELL_SIZE);
        ctx.stroke();
      }
    }

    // 3. Explored cells (A* search footprint — under everything physical)
    if (exploredCells) {
      ctx.fillStyle = '#0a2a50';
      exploredCells.forEach(([x, y]) => {
        ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      });
    }

    // 3.5 Q-Learning heatmap (visual story of /learn). Two-tone signed
    //     ramp: negative Q reads as blue ("the agent explored here and
    //     learned to avoid it"), positive Q reads as teal ("policy
    //     river — high-value cells the agent prefers"). Normalized
    //     against the min/max of the snapshot so the contrast scales
    //     with how much the agent has learned.
    if (qTableHeatmap && qTableHeatmap.length > 0) {
      // Compute min/max once. The snapshot is at most 40x40 = 1600 cells
      // so a single pass is trivial; we don't memoize across renders
      // because the snapshot changes every ~300 ms during training.
      let minQ = 0;
      let maxQ = 0;
      const buildingSet = new Set<string>();
      buildings.forEach(([x, y]) => buildingSet.add(`${x},${y}`));
      const nfzKeySet = new Set<string>();
      nfz.forEach(([x, y]) => nfzKeySet.add(`${x},${y}`));
      for (let x = 0; x < qTableHeatmap.length; x++) {
        const col = qTableHeatmap[x];
        for (let y = 0; y < col.length; y++) {
          const q = col[y];
          if (q < minQ) minQ = q;
          if (q > maxQ) maxQ = q;
        }
      }
      const absMin = Math.abs(minQ) || 1;
      const absMax = Math.abs(maxQ) || 1;
      for (let x = 0; x < qTableHeatmap.length; x++) {
        const col = qTableHeatmap[x];
        for (let y = 0; y < col.length; y++) {
          const q = col[y];
          if (q === 0) continue;
          const key = `${x},${y}`;
          if (buildingSet.has(key) || nfzKeySet.has(key)) continue;
          if (q < 0) {
            const a = (q / -absMin) * 0.4; // q is negative → a is positive
            ctx.fillStyle = `rgba(0, 168, 255, ${a})`;
          } else {
            const a = (q / absMax) * 0.55;
            ctx.fillStyle = `rgba(0, 221, 180, ${a})`;
          }
          ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        }
      }
    }

    // 4. NFZ — translucent fill, cluster-outline-only stroke (no checkerboard)
    ctx.fillStyle = 'rgba(204, 34, 34, 0.15)';
    nfz.forEach(([x, y]) => {
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
    const nfzSet = new Set<string>();
    nfz.forEach(([x, y]) => nfzSet.add(`${x},${y}`));
    ctx.strokeStyle = 'rgba(204, 34, 34, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    nfz.forEach(([x, y]) => {
      const left = x * CELL_SIZE + 0.5;
      const top = y * CELL_SIZE + 0.5;
      const right = left + CELL_SIZE - 1;
      const bottom = top + CELL_SIZE - 1;
      if (!nfzSet.has(`${x - 1},${y}`)) { ctx.moveTo(left, top - 0.5); ctx.lineTo(left, bottom + 0.5); }
      if (!nfzSet.has(`${x + 1},${y}`)) { ctx.moveTo(right, top - 0.5); ctx.lineTo(right, bottom + 0.5); }
      if (!nfzSet.has(`${x},${y - 1}`)) { ctx.moveTo(left - 0.5, top); ctx.lineTo(right + 0.5, top); }
      if (!nfzSet.has(`${x},${y + 1}`)) { ctx.moveTo(left - 0.5, bottom); ctx.lineTo(right + 0.5, bottom); }
    });
    ctx.stroke();

    // 5. Completed paths — flight history, visually subordinate to physical
    //    obstacles. Renders UNDER buildings so the skyline never reads as
    //    "tinted by where the drone has been."
    if (completedPaths) {
      completedPaths.forEach((path) =>
        drawPath(path, 'rgba(0, 221, 180, 0.12)', 'rgba(0, 221, 180, 0.45)', '#00ddb4'),
      );
    }

    // 6. Buildings — solid opaque obstacles. Drawn AFTER explored cells and
    //    completed paths so nothing visually tints the rooftops. Buildings
    //    in `addedBuildings` (generalization mode) get an amber outline so
    //    the user can see which cells were perturbed in after training.
    //
    //    Two cases produce addedBuildings entries:
    //      - Comparison view (after Run): the perturbed city's buildings
    //        list already includes the added cells, so the first pass picks
    //        them up directly.
    //      - Manual placement view (before Run): the cells live only in
    //        addedBuildings — they're not in the source city's buildings
    //        yet. A second pass draws them so the user sees the placement
    //        the instant they click.
    const addedSet = new Set<string>();
    if (addedBuildings) {
      addedBuildings.forEach(([x, y]) => addedSet.add(`${x},${y}`));
    }
    const existingBuildingSet = new Set<string>();
    buildings.forEach(([x, y]) => existingBuildingSet.add(`${x},${y}`));

    const drawBuilding = (x: number, y: number, isAdded: boolean) => {
      const rx = 2;
      const bx = x * CELL_SIZE + 1;
      const by = y * CELL_SIZE + 1;
      const bw = CELL_SIZE - 2;
      const bh = CELL_SIZE - 2;
      ctx.fillStyle = '#1a2540';
      ctx.strokeStyle = isAdded ? 'rgba(255, 170, 0, 0.70)' : '#243650';
      ctx.lineWidth = isAdded ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(bx + rx, by);
      ctx.lineTo(bx + bw - rx, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rx);
      ctx.lineTo(bx + bw, by + bh - rx);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rx, by + bh);
      ctx.lineTo(bx + rx, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rx);
      ctx.lineTo(bx, by + rx);
      ctx.quadraticCurveTo(bx, by, bx + rx, by);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    buildings.forEach(([x, y]) => {
      drawBuilding(x, y, addedSet.has(`${x},${y}`));
    });

    if (addedBuildings) {
      addedBuildings.forEach(([x, y]) => {
        if (!existingBuildingSet.has(`${x},${y}`)) {
          drawBuilding(x, y, true);
        }
      });
    }

    // 7. Active route (GA dashed preview during /optimize phase) — planned
    //    route conceptually above the skyline; renders over buildings.
    if (activeRoute && activeRoute.length > 1) {
      ctx.strokeStyle = 'rgba(0, 168, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(activeRoute[0][0] * CELL_SIZE + CELL_SIZE / 2, activeRoute[0][1] * CELL_SIZE + CELL_SIZE / 2);
      activeRoute.forEach((p) => ctx.lineTo(p[0] * CELL_SIZE + CELL_SIZE / 2, p[1] * CELL_SIZE + CELL_SIZE / 2));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 8. Current A* path — drone is flying this NOW, above buildings.
    if (currentPath && currentPath.length > 1) {
      ctx.strokeStyle = '#00a8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(currentPath[0][0] * CELL_SIZE + CELL_SIZE / 2, currentPath[0][1] * CELL_SIZE + CELL_SIZE / 2);
      currentPath.forEach((p) => ctx.lineTo(p[0] * CELL_SIZE + CELL_SIZE / 2, p[1] * CELL_SIZE + CELL_SIZE / 2));
      ctx.stroke();
    }

    // 9. Drone trail
    if (droneTrail) {
      droneTrail.forEach(([x, y], i) => {
        const radius = 2 * (i / droneTrail.length);
        const alpha = (i / droneTrail.length) * 0.5;
        ctx.fillStyle = `rgba(0, 204, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 10. Drone
    if (dronePos) {
      const dx = dronePos[0] * CELL_SIZE + CELL_SIZE / 2;
      const dy = dronePos[1] * CELL_SIZE + CELL_SIZE / 2;
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 204, 255, 0.25)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dx, dy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00ccff';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 11. Targets — UI markers, always on top of paths and drone.
    const unreachableSet = new Set(unreachableTargets ?? []);
    const blockedSet = new Set(blockedTargets ?? []);
    targets.forEach(([x, y], idx) => {
      const cx = x * CELL_SIZE + CELL_SIZE / 2;
      const cy = y * CELL_SIZE + CELL_SIZE / 2;
      const isCompleted = idx < (highlightTarget ?? -1);
      const isActive = idx === highlightTarget;
      const isBlocked = blockedSet.has(idx);
      const isUnreachable = unreachableSet.has(idx);

      if (isActive) {
        ctx.beginPath();
        ctx.arc(cx, cy, (CELL_SIZE / 2 - 2) * (1 + pulse * 0.4), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 204, 0, ${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (isUnreachable) {
        ctx.beginPath();
        ctx.arc(cx, cy, (CELL_SIZE / 2 + 1) * (1 + pulse * 0.5), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(224, 53, 53, ${0.4 + (1 - pulse) * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, CELL_SIZE / 2 - 3, 0, Math.PI * 2);
      ctx.fillStyle = isCompleted ? 'rgba(255, 204, 0, 0.4)' : isBlocked ? 'rgba(255, 204, 0, 0.35)' : '#ffcc00';
      ctx.fill();

      ctx.fillStyle = '#040810';
      ctx.font = 'bold 8px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((idx + 1).toString(), cx, cy);

      if (isBlocked) {
        ctx.strokeStyle = '#e03535';
        ctx.lineWidth = 1.5;
        const r = CELL_SIZE / 2 - 2;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
      }
    });

    // 12. Depot — UI marker, always on top.
    if (depot) {
      const dcx = depot[0] * CELL_SIZE + CELL_SIZE / 2;
      const dcy = depot[1] * CELL_SIZE + CELL_SIZE / 2;
      const HALF = 11; // 22-px square (~1.6 cells)

      // Soft halo — subtle, doesn't compete with active-target pulse.
      ctx.beginPath();
      ctx.arc(dcx, dcy, HALF + 6 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 212, 90, ${0.06 + (1 - pulse) * 0.08})`;
      ctx.fill();

      // Marker
      ctx.fillStyle = 'rgba(0, 212, 90, 0.20)';
      ctx.strokeStyle = '#00d45a';
      ctx.lineWidth = 1.5;
      ctx.fillRect(dcx - HALF, dcy - HALF, HALF * 2, HALF * 2);
      ctx.strokeRect(dcx - HALF + 0.5, dcy - HALF + 0.5, HALF * 2 - 1, HALF * 2 - 1);

      // Central "D"
      ctx.fillStyle = '#00d45a';
      ctx.font = 'bold 12px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('D', dcx, dcy);

      // "DEPOT" caption below the marker (or above if too close to bottom)
      const labelBelowY = dcy + HALF + 9;
      const labelY = labelBelowY < CANVAS_SIZE - 4 ? labelBelowY : dcy - HALF - 9;
      ctx.fillStyle = 'rgba(0, 212, 90, 0.75)';
      ctx.font = 'bold 8px JetBrains Mono';
      ctx.fillText('DEPOT', dcx, labelY);
    }

    // 13. Edit-mode hover ghost (last, so it sits above content).
    //     Special case for the perturbation tool: hovering an already-placed
    //     cell swaps to a red "click to remove" treatment, matching the
    //     toggle semantics of handleManualCellClick in /learn.
    if (editMode && hoverCell && !disabled) {
      const hoverKey = `${hoverCell.x},${hoverCell.y}`;
      const isPerturbationRemove = activeTool === 'perturbation' && addedSet.has(hoverKey);
      const preview = isPerturbationRemove
        ? { kind: 'cell' as const, fill: 'rgba(224, 53, 53, 0.25)', stroke: '#e03535' }
        : TOOL_PREVIEW[activeTool];
      if (preview.kind === 'cell') {
        ctx.fillStyle = preview.fill;
        ctx.fillRect(hoverCell.x * CELL_SIZE + 1, hoverCell.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.strokeStyle = preview.stroke;
        ctx.lineWidth = isPerturbationRemove ? 1.5 : 1;
        ctx.strokeRect(hoverCell.x * CELL_SIZE + 0.5, hoverCell.y * CELL_SIZE + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
      } else if (preview.kind === 'circle') {
        const cx = hoverCell.x * CELL_SIZE + CELL_SIZE / 2;
        const cy = hoverCell.y * CELL_SIZE + CELL_SIZE / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL_SIZE / 2 - 3, 0, Math.PI * 2);
        ctx.fillStyle = preview.fill;
        ctx.fill();
        ctx.strokeStyle = preview.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    };
    return () => { drawRef.current = null; };
  }, [
    // `pulse` intentionally NOT in deps — pulseRef updates 60fps and the
    // rAF tick reads the ref directly. Adding it would trigger a re-bind
    // (and re-run) of the draw closure 60 times per second.
    buildings, nfz, targets, depot, showGrid, activeRoute, exploredCells,
    currentPath, completedPaths, dronePos, droneTrail, highlightTarget,
    editMode, activeTool, hoverCell, unreachableTargets, blockedTargets, disabled,
    qTableHeatmap, addedBuildings,
  ]);

  return (
    <div
      ref={wrapperRef}
      className={`relative group ${className}`}
      style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
    >
      {/* Atmospheric overlay (only during /mission weather phase) */}
      {weatherOverlay && <WeatherOverlay conditions={weatherOverlay} />}

      {/* Scanline Overlay */}
      <div className="scanlines" />

      {/* Corner Brackets */}
      <div className="hud-corner hud-corner-tl" />
      <div className="hud-corner hud-corner-tr" />
      <div className="hud-corner hud-corner-bl" />
      <div className="hud-corner hud-corner-br" />

      {/* Canvas Label */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 text-[9px] font-mono font-bold text-[#00ddb4] opacity-70 tracking-[3px] uppercase whitespace-nowrap">
        {label}
      </div>

      {/* Coordinate Display */}
      <div className="absolute bottom-3 right-4 z-20 text-[9px] font-mono text-[#00ddb4] opacity-60">
        X:{coords.x.toString().padStart(2, '0')} · Y:{coords.y.toString().padStart(2, '0')}
      </div>

      {/* Battery Vignette (Fly Page only) — only triggers below the planning
          headroom band so a healthy mission landing at ~25% doesn't show alarm. */}
      <div
        className={`absolute inset-0 z-[15] pointer-events-none transition-all duration-1000 ${batteryLevel < 10 ? 'animate-pulse' : ''}`}
        style={{
          boxShadow: 'inset 0 0 60px rgba(224,53,53,0.3)',
          opacity: batteryLevel < 20 ? (batteryLevel < 10 ? 0.8 : 0.5) : 0,
        }}
      />

      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className={`block bg-[#040810] ${editMode ? (disabled ? 'cursor-wait' : activeTool === 'cursor' ? 'cursor-default' : 'cursor-crosshair') : ''}`}
        onMouseDown={editMode ? handleMouseDown : undefined}
        onMouseMove={editMode ? handleMouseMove : undefined}
        onMouseUp={editMode ? stopPainting : undefined}
        onMouseLeave={editMode ? handleMouseLeave : undefined}
        onContextMenu={editMode ? handleContextMenu : undefined}
      />
    </div>
  );
};
