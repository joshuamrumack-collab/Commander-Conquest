export interface Vec2 {
  x: number;
  y: number;
}

export type UnitTypeKey = 'soldier' | 'horse' | 'cannon' | 'dummy';

export interface UnitStats {
  type: UnitTypeKey;
  hp: number;
  dmg: number;
  range: number;
  aggroRange: number;
  speed: number;
  spawnRate: number;
  radius: number;
  aoe?: number;
  name: string;
  historicalTitle: string;
}

export type SkillKey = 'rally' | 'banner' | 'overdrive' | 'shield' | 'blitz' | 'dummy';

export interface SkillDef {
  id: SkillKey;
  name: string;
  frenchTitle: string;
  cd: number;
  color: string;
  desc: string;
  lore: string;
}

export interface FactionDef {
  id: number;
  name: string;
  empire: string;
  color: string;
  secondaryColor: string;
  goldColor: string;
  emblem: string;
  keys: {
    up: string;
    down: string;
    left: string;
    right: string;
    abil1: string;
    abil2: string;
  };
}

export type PlayerType = 'human' | 'ai' | 'none';

export interface PlayerSetup {
  type: PlayerType;
  skills: [SkillKey, SkillKey];
}

export type MapSizeKey = 'small' | 'medium' | 'large';

export interface MapSizeConfig {
  name: string;
  theater: string;
  width: number;
  height: number;
  outposts: number;
  description: string;
}

export interface OutpostCluster {
  id: number;
  outpostIndices: number[];
  controllingFaction: number | null;
}

export interface ClusterConnection {
  from: number;
  to: number;
  clusterId: number;
}

export interface OutpostData {
  id: number;
  x: number;
  y: number;
  type: UnitTypeKey;
  clusterId: number;
}

export interface SharedMapData {
  seed: number;
  mapSize: MapSizeKey;
  width: number;
  height: number;
  outposts: OutpostData[];
  clusters: OutpostCluster[];
  clusterConnections: ClusterConnection[];
}

export interface NetCommanderState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  bannerX: number | null;
  bannerY: number | null;
  cd1: number;
  cd2: number;
}

export interface NetOutpostState {
  id: number;
  owner: number | null;
  capProg: number;
  capFaction: number | null;
}

export interface NetUnitState {
  id: number;
  x: number;
  y: number;
  f: number; // factionId
  t: UnitTypeKey;
  hp: number;
}

export interface NetGameState {
  tick: number;
  updatedAt: number;
  commanders: NetCommanderState[];
  outposts: NetOutpostState[];
  units: NetUnitState[];
  winner: number | null | 'draw';
}

export interface NetPlayerInput {
  factionId: number;
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  activeBanner: Vec2 | null;
  skillCast?: { slot: 1 | 2; seq: number } | null;
  updatedAt: number;
}

