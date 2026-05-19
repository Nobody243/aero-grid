import heapq, math
from typing import List, Tuple, Optional, Set, Dict

GRID_SIZE = 40
Point = Tuple[int, int]
DIRECTIONS = [(0,1,1.0),(0,-1,1.0),(1,0,1.0),(-1,0,1.0),(1,1,1.414),(1,-1,1.414),(-1,1,1.414),(-1,-1,1.414)]

def octile_distance(a, b):
    dx, dy = abs(a[0]-b[0]), abs(a[1]-b[1])
    return max(dx,dy) + (math.sqrt(2)-1)*min(dx,dy)

def manhattan_distance(a, b):
    return abs(a[0]-b[0]) + abs(a[1]-b[1])

def euclidean_distance(a, b):
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)

HEURISTICS = {
    "octile": octile_distance,
    "manhattan": manhattan_distance,
    "euclidean": euclidean_distance,
}

class AStarPathfinder:
    def __init__(self, buildings, no_fly_zones, heuristic: str = "octile"):
        self.blocked = buildings | no_fly_zones
        if heuristic not in HEURISTICS:
            raise ValueError(f"Unknown heuristic '{heuristic}'. Choose from {list(HEURISTICS)}")
        self.heuristic_name = heuristic
        self.h = HEURISTICS[heuristic]
    def _in_bounds(self, p):
        return 0 <= p[0] < GRID_SIZE and 0 <= p[1] < GRID_SIZE
    def find_path(self, start, goal):
        open_heap = [(0.0, 0.0, start)]
        g_score = {start: 0.0}
        parent  = {start: None}
        closed  = set()
        open_set = {start}
        explored = []
        while open_heap:
            f, g, current = heapq.heappop(open_heap)
            open_set.discard(current)
            if current in closed: continue
            closed.add(current); explored.append(current)
            if current == goal:
                path = []
                node = goal
                while node is not None:
                    path.append(node); node = parent[node]
                path.reverse()
                return path, {"explored": explored, "path_length": round(g,2), "nodes_explored": len(explored)}
            for dx, dy, cost in DIRECTIONS:
                nb = (current[0]+dx, current[1]+dy)
                if not self._in_bounds(nb) or nb in self.blocked or nb in closed: continue
                tg = g + cost
                if tg < g_score.get(nb, float("inf")):
                    g_score[nb] = tg
                    heapq.heappush(open_heap, (tg + self.h(nb, goal), tg, nb))
                    parent[nb] = current; open_set.add(nb)
        return None, {"explored": explored, "nodes_explored": len(explored)}

def build_city(seed: int = 7, building_count: int = 15):
    import random
    rng = random.Random(seed)
    buildings = set()
    for _ in range(building_count):
        bx, by = rng.randint(1,37), rng.randint(1,37)
        for dx in range(rng.randint(1,3)):
            for dy in range(rng.randint(1,3)):
                buildings.add((bx+dx, by+dy))
    nfz = set()
    for x1,y1,x2,y2 in [(10,10,13,13),(25,5,28,8),(20,25,24,28)]:
        for x in range(x1,x2+1):
            for y in range(y1,y2+1):
                nfz.add((x,y))
    nfz -= buildings
    return buildings, nfz
