import { FactionDef, MapSizeConfig, MapSizeKey, SkillDef, SkillKey, UnitStats, UnitTypeKey } from '../types';

export const FACTIONS: FactionDef[] = [
  {
    id: 0,
    name: 'Red Faction',
    empire: 'Red Faction',
    color: '#ef4444',
    secondaryColor: '#991b1b',
    goldColor: '#fbbf24',
    emblem: '🦅',
    keys: {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      abil1: 'KeyQ',
      abil2: 'KeyE'
    }
  },
  {
    id: 1,
    name: 'Blue Faction',
    empire: 'Blue Faction',
    color: '#3b82f6',
    secondaryColor: '#1e40af',
    goldColor: '#93c5fd',
    emblem: '🦁',
    keys: {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      abil1: 'Comma',
      abil2: 'Period'
    }
  },
  {
    id: 2,
    name: 'Green Faction',
    empire: 'Green Faction',
    color: '#10b981',
    secondaryColor: '#065f46',
    goldColor: '#a7f3d0',
    emblem: '🌲',
    keys: {
      up: 'KeyI',
      down: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
      abil1: 'KeyU',
      abil2: 'KeyO'
    }
  },
  {
    id: 3,
    name: 'Yellow Faction',
    empire: 'Yellow Faction',
    color: '#f59e0b',
    secondaryColor: '#92400e',
    goldColor: '#fde68a',
    emblem: '☀️',
    keys: {
      up: 'Numpad8',
      down: 'Numpad5',
      left: 'Numpad4',
      right: 'Numpad6',
      abil1: 'Numpad7',
      abil2: 'Numpad9'
    }
  }
];

export const FACTION_HOTKEY_LABELS: Record<number, { move: string; abil1: string; abil2: string }> = {
  0: { move: 'W A S D', abil1: 'Q', abil2: 'E' },
  1: { move: 'Arrow Keys', abil1: ',', abil2: '.' },
  2: { move: 'I J K L', abil1: 'U', abil2: 'O' },
  3: { move: 'Num 8 4 5 6', abil1: 'Num 7', abil2: 'Num 9' }
};

export const MAP_CONFIGS: Record<MapSizeKey, MapSizeConfig> = {
  small: {
    name: 'Small',
    theater: 'Small Map',
    width: 1600,
    height: 1200,
    outposts: 6,
    description: 'Small battlefield with 6 outposts.'
  },
  medium: {
    name: 'Medium',
    theater: 'Medium Map',
    width: 2400,
    height: 1800,
    outposts: 10,
    description: 'Medium battlefield with 10 outposts.'
  },
  large: {
    name: 'Large',
    theater: 'Large Map',
    width: 3200,
    height: 2400,
    outposts: 15,
    description: 'Large battlefield with 15 outposts.'
  }
};

export const UNIT_TYPES: Record<UnitTypeKey, UnitStats> = {
  soldier: {
    type: 'soldier',
    name: 'Soldier',
    historicalTitle: 'Soldier',
    hp: 30,
    dmg: 5,
    range: 480,
    aggroRange: 550,
    speed: 1.8,
    spawnRate: 3,
    radius: 6
  },
  horse: {
    type: 'horse',
    name: 'Horse',
    historicalTitle: 'Horse',
    hp: 50,
    dmg: 18,
    range: 25,
    aggroRange: 640,
    speed: 3.2,
    spawnRate: 7,
    radius: 10
  },
  cannon: {
    type: 'cannon',
    name: 'Cannon',
    historicalTitle: 'Cannon',
    hp: 45,
    dmg: 35,
    range: 960,
    aggroRange: 1050,
    speed: 0.9,
    spawnRate: 14,
    radius: 14,
    aoe: 80
  },
  dummy: {
    type: 'dummy',
    name: 'Capture Dummy',
    historicalTitle: 'Capture Dummy',
    hp: 50,
    dmg: 0,
    range: 0,
    aggroRange: 0,
    speed: 0,
    spawnRate: 999,
    radius: 8
  }
};

export const SKILLS: Record<SkillKey, SkillDef> = {
  rally: {
    id: 'rally',
    name: 'Rally',
    frenchTitle: 'Rally',
    cd: 15,
    color: '#22c55e',
    desc: 'Heal and buff nearby units.',
    lore: 'Heal and buff nearby units.'
  },
  banner: {
    id: 'banner',
    name: 'Drop Banner',
    frenchTitle: 'Drop Banner',
    cd: 25,
    color: '#3b82f6',
    desc: 'Units hold and defend a location.',
    lore: 'Units hold and defend a location.'
  },
  overdrive: {
    id: 'overdrive',
    name: 'Overdrive',
    frenchTitle: 'Overdrive',
    cd: 30,
    color: '#eab308',
    desc: 'Double nearby outpost spawn rate (10s).',
    lore: 'Double nearby outpost spawn rate (10s).'
  },
  shield: {
    id: 'shield',
    name: 'Dome Shield',
    frenchTitle: 'Dome Shield',
    cd: 20,
    color: '#06b6d4',
    desc: 'Block projectiles (8s).',
    lore: 'Block projectiles (8s).'
  },
  blitz: {
    id: 'blitz',
    name: 'Blitz',
    frenchTitle: 'Blitz',
    cd: 25,
    color: '#a855f7',
    desc: 'Double speed for all units (5s).',
    lore: 'Double speed for all units (5s).'
  },
  dummy: {
    id: 'dummy',
    name: 'Capture Dummy',
    frenchTitle: 'Capture Dummy',
    cd: 20,
    color: '#64748b',
    desc: 'Stationary unit to capture outposts.',
    lore: 'Stationary unit to capture outposts.'
  }
};

export const CAPTURE_TIME = 10;
export const COMMANDER_SPEED = 2.5;
