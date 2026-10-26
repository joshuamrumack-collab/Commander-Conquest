import { ClusterConnection, MapSizeKey, OutpostCluster, OutpostData, SharedMapData, UnitTypeKey } from '../types';
import { MAP_CONFIGS } from './constants';

export class SeededRandom {
  private s: number;
  constructor(seed = 1234567) {
    this.s = Math.floor(Math.abs(seed)) || 1234567;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export function generateSharedMapData(sizeKey: MapSizeKey, customSeed?: number): SharedMapData {
  const seed = customSeed !== undefined ? customSeed : Math.floor(Math.random() * 900000 + 100000);
  const rng = new SeededRandom(seed);
  const cfg = MAP_CONFIGS[sizeKey];
  const width = cfg.width;
  const height = cfg.height;

  const outposts: OutpostData[] = [];
  const types: UnitTypeKey[] = ['soldier', 'soldier', 'horse', 'horse', 'cannon'];
  let attempts = 0;
  let spawned = 0;

  while (spawned < cfg.outposts && attempts < 1200) {
    attempts++;
    const px = Math.round(180 + rng.next() * (width - 360));
    const py = Math.round(180 + rng.next() * (height - 360));

    let tooClose = false;
    for (const op of outposts) {
      const dx = op.x - px;
      const dy = op.y - py;
      if (dx * dx + dy * dy < 320 * 320) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      const type = types[spawned % types.length];
      outposts.push({
        id: spawned,
        x: px,
        y: py,
        type,
        clusterId: 0
      });
      spawned++;
    }
  }

  // Partition outposts into random spatial clusters of at most 4 (2 to 4 outposts per cluster)
  const n = outposts.length;
  let remaining = n;
  const clusterSizes: number[] = [];

  while (remaining > 0) {
    if (remaining === 5) {
      clusterSizes.push(3, 2);
      remaining = 0;
    } else if (remaining === 3) {
      clusterSizes.push(3);
      remaining = 0;
    } else if (remaining === 2) {
      clusterSizes.push(2);
      remaining = 0;
    } else if (remaining === 4) {
      clusterSizes.push(4);
      remaining = 0;
    } else {
      const size = rng.next() > 0.45 ? 4 : 3;
      clusterSizes.push(size);
      remaining -= size;
    }
  }

  const unassigned = new Set<number>(outposts.map((_, i) => i));
  const clusters: OutpostCluster[] = [];
  const clusterConnections: ClusterConnection[] = [];

  clusterSizes.forEach((targetSize, cId) => {
    if (unassigned.size === 0) return;
    const seedIdx = Array.from(unassigned)[0];
    unassigned.delete(seedIdx);
    const clusterIndices = [seedIdx];

    while (clusterIndices.length < targetSize && unassigned.size > 0) {
      let bestCandidate = -1;
      let bestDist = Infinity;
      for (const candidate of unassigned) {
        for (const member of clusterIndices) {
          const dx = outposts[candidate].x - outposts[member].x;
          const dy = outposts[candidate].y - outposts[member].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestDist) {
            bestDist = d;
            bestCandidate = candidate;
          }
        }
      }
      if (bestCandidate !== -1) {
        unassigned.delete(bestCandidate);
        clusterIndices.push(bestCandidate);
      } else {
        break;
      }
    }

    for (const idx of clusterIndices) {
      outposts[idx].clusterId = cId;
    }

    clusters.push({
      id: cId,
      outpostIndices: clusterIndices,
      controllingFaction: null
    });

    // Generate connected lines within this cluster (at most 4 outposts)
    if (clusterIndices.length === 2) {
      clusterConnections.push({ from: clusterIndices[0], to: clusterIndices[1], clusterId: cId });
    } else if (clusterIndices.length === 3) {
      clusterConnections.push(
        { from: clusterIndices[0], to: clusterIndices[1], clusterId: cId },
        { from: clusterIndices[1], to: clusterIndices[2], clusterId: cId },
        { from: clusterIndices[2], to: clusterIndices[0], clusterId: cId }
      );
    } else if (clusterIndices.length === 4) {
      clusterConnections.push(
        { from: clusterIndices[0], to: clusterIndices[1], clusterId: cId },
        { from: clusterIndices[1], to: clusterIndices[2], clusterId: cId },
        { from: clusterIndices[2], to: clusterIndices[3], clusterId: cId },
        { from: clusterIndices[3], to: clusterIndices[0], clusterId: cId }
      );
    }
  });

  // Assign any leftover outpost to closest cluster with < 4 outposts
  if (unassigned.size > 0) {
    for (const leftOver of unassigned) {
      const availableCluster = clusters.find((c) => c.outpostIndices.length < 4);
      if (availableCluster) {
        const prevMember = availableCluster.outpostIndices[availableCluster.outpostIndices.length - 1];
        availableCluster.outpostIndices.push(leftOver);
        outposts[leftOver].clusterId = availableCluster.id;
        clusterConnections.push({ from: prevMember, to: leftOver, clusterId: availableCluster.id });
      }
    }
  }

  return {
    seed,
    mapSize: sizeKey,
    width,
    height,
    outposts,
    clusters,
    clusterConnections
  };
}
