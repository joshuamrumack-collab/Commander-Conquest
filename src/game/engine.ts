import { sound } from '../audio';
import {
  ClusterConnection,
  FactionDef,
  MapSizeKey,
  NetCommanderState,
  NetGameState,
  NetOutpostState,
  NetPlayerInput,
  NetUnitState,
  OutpostCluster,
  SharedMapData,
  SkillKey,
  UnitStats,
  UnitTypeKey,
  Vec2
} from '../types';
import { CAPTURE_TIME, COMMANDER_SPEED, FACTIONS, MAP_CONFIGS, SKILLS, UNIT_TYPES } from './constants';
import { generateSharedMapData } from './mapGenerator';

export class Vector implements Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  add(v: Vec2): Vector {
    return new Vector(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vector {
    return new Vector(this.x - v.x, this.y - v.y);
  }

  mul(n: number): Vector {
    return new Vector(this.x * n, this.y * n);
  }

  div(n: number): Vector {
    return n === 0 ? new Vector(0, 0) : new Vector(this.x / n, this.y / n);
  }

  mag(): number {
    return Math.hypot(this.x, this.y);
  }

  magSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): Vector {
    const m = this.mag();
    return m === 0 ? new Vector(0, 0) : this.div(m);
  }

  dist(v: Vec2): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  limit(max: number): Vector {
    const mSq = this.magSq();
    if (mSq > max * max) {
      return this.normalize().mul(max);
    }
    return this;
  }
}

export class Particle {
  pos: Vector;
  vel: Vector;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  type: 'spark' | 'smoke';

  constructor(x: number, y: number, color: string, speed: number, size: number, life: number, type: 'spark' | 'smoke' = 'spark') {
    this.pos = new Vector(x, y);
    const ang = Math.random() * Math.PI * 2;
    this.vel = new Vector(Math.cos(ang), Math.sin(ang)).mul(speed * (0.6 + Math.random() * 0.8));
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
    this.type = type;
  }

  update(dt: number) {
    this.pos = this.pos.add(this.vel.mul(dt * 60));
    this.life -= dt;
    if (this.type === 'smoke') {
      this.size += dt * 8; // Smoke puffs billow outwards
      this.vel = this.vel.mul(0.95);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class RingEffect {
  pos: Vector;
  color: string;
  maxRadius: number;
  duration: number;
  life: number;

  constructor(x: number, y: number, color: string, maxRadius: number, duration: number) {
    this.pos = new Vector(x, y);
    this.color = color;
    this.maxRadius = maxRadius;
    this.duration = duration;
    this.life = duration;
  }

  update(dt: number) {
    this.life -= dt;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.life <= 0) return;
    const progress = 1 - this.life / this.duration;
    const curR = this.maxRadius * progress;
    const alpha = Math.max(0, this.life / this.duration);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 4 * (1 - progress) + 1;
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, curR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export class Projectile {
  pos: Vector;
  vel: Vector;
  type: UnitTypeKey;
  sourceFaction: number;
  damage: number;
  traveled = 0;
  maxTravelDist: number;
  active = true;
  targetPos: Vector;

  constructor(x: number, y: number, target: { pos: Vector }, source: Unit) {
    this.pos = new Vector(x, y);
    this.type = source.type;
    this.sourceFaction = source.factionId;
    this.damage = source.stats.dmg;
    this.targetPos = new Vector(target.pos.x, target.pos.y);

    const speed = this.type === 'cannon' ? 6 : 14;
    const dir = this.targetPos.sub(this.pos);
    this.vel = dir.normalize().mul(speed);
    this.maxTravelDist = source.stats.range + 120;
  }

  update(dt: number, engine: GameEngine) {
    const step = this.vel.mul(dt * 60);
    this.pos = this.pos.add(step);
    this.traveled += step.mag();

    // Shield check
    for (const sh of engine.shields) {
      if (sh.factionId !== this.sourceFaction && this.pos.dist(sh.pos) <= sh.radius) {
        engine.createSparks(this.pos.x, this.pos.y, '#06b6d4', 6);
        this.active = false;
        return;
      }
    }

    // Hit test or range expiration
    if (this.traveled >= this.maxTravelDist || this.pos.dist(this.targetPos) < 12) {
      this.active = false;
      if (this.type === 'cannon') {
        engine.createExplosion(this.pos.x, this.pos.y, UNIT_TYPES.cannon.aoe || 80, '#f97316');
        sound.playCannon();
        // AoE Damage
        const aoe = UNIT_TYPES.cannon.aoe || 80;
        for (const u of engine.units) {
          if (u.factionId !== this.sourceFaction && u.hp > 0 && u.pos.dist(this.pos) <= aoe) {
            u.takeDamage(this.damage, engine);
          }
        }
      } else {
        // Musket hit
        engine.createSparks(this.pos.x, this.pos.y, '#fde047', 4);
        for (const u of engine.units) {
          if (u.factionId !== this.sourceFaction && u.hp > 0 && u.pos.dist(this.pos) <= u.radius + 6) {
            u.takeDamage(this.damage, engine);
            break;
          }
        }
      }
    }
  }
}

export class Commander {
  factionId: number;
  color: string;
  keys: FactionDef['keys'];
  isAI: boolean;
  isRemoteHuman = false;
  pos: Vector;
  vel: Vector = new Vector(0, 0);
  targetPos: Vector | null = null;
  radius = 14;

  skill1: SkillKey;
  skill2: SkillKey;
  cooldown1 = 0;
  cooldown2 = 0;

  activeBanner: Vector | null = null;
  bannerTimer = 0;

  aiTarget: Vector | null = null;
  aiTimer = 0;

  lastSkillCast: { slot: 1 | 2; seq: number } | null = null;
  skillCastSeq = 0;

  constructor(faction: FactionDef, isAI: boolean, startX: number, startY: number, skills: [SkillKey, SkillKey]) {
    this.factionId = faction.id;
    this.color = faction.color;
    this.keys = faction.keys;
    this.isAI = isAI;
    this.pos = new Vector(startX, startY);
    this.skill1 = skills[0] || 'rally';
    this.skill2 = skills[1] || 'banner';
  }

  update(dt: number, engine: GameEngine) {
    if (this.cooldown1 > 0) this.cooldown1 -= dt;
    if (this.cooldown2 > 0) this.cooldown2 -= dt;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.activeBanner = null;
      }
    }

    // Remote Human: Controlled by peer over network
    if (this.isRemoteHuman) {
      if (this.targetPos) {
        const diff = this.targetPos.sub(this.pos);
        const dist = diff.mag();
        if (dist > 3) {
          const step = diff.normalize().mul(Math.min(dist, COMMANDER_SPEED * dt * 60));
          this.pos = this.pos.add(step);
        } else {
          this.pos = this.targetPos;
        }
      } else if (this.vel.magSq() > 0) {
        this.pos = this.pos.add(this.vel.mul(dt * 60));
      }

      this.pos.x = Math.max(this.radius + 20, Math.min(engine.width - this.radius - 20, this.pos.x));
      this.pos.y = Math.max(this.radius + 20, Math.min(engine.height - this.radius - 20, this.pos.y));
      return;
    }

    let accel = new Vector(0, 0);

    if (this.isAI) {
      this.updateAI(dt, engine);
      if (this.aiTarget) {
        const dir = this.aiTarget.sub(this.pos);
        if (dir.magSq() > 100) {
          accel = dir.normalize().mul(COMMANDER_SPEED);
        }
      }
    } else {
      // Local human controls
      if (engine.isOnline && engine.myFactionId === this.factionId) {
        // Online multiplayer: local player can use WASD or Arrow Keys
        if (engine.keys['KeyW'] || engine.keys['ArrowUp']) accel.y -= 1;
        if (engine.keys['KeyS'] || engine.keys['ArrowDown']) accel.y += 1;
        if (engine.keys['KeyA'] || engine.keys['ArrowLeft']) accel.x -= 1;
        if (engine.keys['KeyD'] || engine.keys['ArrowRight']) accel.x += 1;

        if ((engine.keys['KeyQ'] || engine.keys['Comma']) && this.cooldown1 <= 0) this.castSkill(1, engine);
        if ((engine.keys['KeyE'] || engine.keys['Period']) && this.cooldown2 <= 0) this.castSkill(2, engine);
      } else if (!engine.isOnline) {
        // Local couch multiplayer: use assigned faction hotkeys
        if (engine.keys[this.keys.up]) accel.y -= 1;
        if (engine.keys[this.keys.down]) accel.y += 1;
        if (engine.keys[this.keys.left]) accel.x -= 1;
        if (engine.keys[this.keys.right]) accel.x += 1;

        if (engine.keys[this.keys.abil1] && this.cooldown1 <= 0) this.castSkill(1, engine);
        if (engine.keys[this.keys.abil2] && this.cooldown2 <= 0) this.castSkill(2, engine);
      }

      if (accel.magSq() > 0) {
        accel = accel.normalize().mul(COMMANDER_SPEED);
      }
    }

    this.pos = this.pos.add(accel.mul(dt * 60));
    this.pos.x = Math.max(this.radius + 20, Math.min(engine.width - this.radius - 20, this.pos.x));
    this.pos.y = Math.max(this.radius + 20, Math.min(engine.height - this.radius - 20, this.pos.y));
    this.vel = accel;
  }

  updateAI(dt: number, engine: GameEngine) {
    if (this.cooldown1 <= 0 && Math.random() < 0.02) this.castSkill(1, engine);
    if (this.cooldown2 <= 0 && Math.random() < 0.02) this.castSkill(2, engine);

    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 2 + Math.random() * 2.5;

      // Find nearest enemy or unowned outpost
      let bestOp: Outpost | null = null;
      let bestDist = Infinity;
      for (const op of engine.outposts) {
        if (op.owner !== this.factionId) {
          const d = this.pos.dist(op.pos);
          if (d < bestDist) {
            bestDist = d;
            bestOp = op;
          }
        }
      }

      if (bestOp) {
        this.aiTarget = bestOp.pos;
      } else {
        // Attack enemy commander
        let enemyCmd: Commander | null = null;
        let enemyDist = Infinity;
        for (const c of engine.commanders) {
          if (c.factionId !== this.factionId) {
            const d = this.pos.dist(c.pos);
            if (d < enemyDist) {
              enemyDist = d;
              enemyCmd = c;
            }
          }
        }
        this.aiTarget = enemyCmd ? enemyCmd.pos : null;
      }
    }
  }

  castSkill(slot: 1 | 2, engine: GameEngine) {
    const skillKey = slot === 1 ? this.skill1 : this.skill2;
    const def = SKILLS[skillKey];

    if (slot === 1) this.cooldown1 = def.cd;
    else this.cooldown2 = def.cd;

    this.lastSkillCast = { slot, seq: ++this.skillCastSeq };

    if (skillKey === 'rally') {
      sound.playRally();
      engine.rings.push(new RingEffect(this.pos.x, this.pos.y, '#10b981', 260, 0.6));
      for (const u of engine.units) {
        if (u.factionId === this.factionId && this.pos.dist(u.pos) <= 260) {
          u.hp = Math.min(u.stats.hp, u.hp + 20);
          u.buffTimer = 5.0;
          engine.createSparks(u.pos.x, u.pos.y, '#10b981', 6);
        }
      }
    } else if (skillKey === 'banner') {
      this.activeBanner = new Vector(this.pos.x, this.pos.y);
      this.bannerTimer = 10;
      engine.rings.push(new RingEffect(this.pos.x, this.pos.y, this.color, 160, 0.5));
      engine.createSmokePuff(this.pos.x, this.pos.y, '#ebdcc0', 6);
    } else if (skillKey === 'overdrive') {
      engine.overdrives.push({ pos: new Vector(this.pos.x, this.pos.y), life: 10, factionId: this.factionId });
      engine.rings.push(new RingEffect(this.pos.x, this.pos.y, def.color, 160, 0.5));
    } else if (skillKey === 'shield') {
      engine.shields.push({ pos: new Vector(this.pos.x, this.pos.y), life: 8, radius: 125, factionId: this.factionId });
    } else if (skillKey === 'blitz') {
      engine.rings.push(new RingEffect(this.pos.x, this.pos.y, def.color, 260, 0.6));
      for (const u of engine.units) {
        if (u.factionId === this.factionId) {
          u.blitzTimer = 5.0;
          engine.createSparks(u.pos.x, u.pos.y, def.color, 4);
        }
      }
    } else if (skillKey === 'dummy') {
      engine.units.push(new Unit(this.pos.x, this.pos.y, this.factionId, 'dummy'));
      engine.createSmokePuff(this.pos.x, this.pos.y, '#a8a29e', 8);
    }
  }
}

export class Unit {
  pos: Vector;
  vel: Vector = new Vector(0, 0);
  factionId: number;
  type: UnitTypeKey;
  stats: UnitStats;
  hp: number;
  radius: number;
  color: string;
  attackCooldown = 0;
  buffTimer = 0;
  blitzTimer = 0;

  constructor(x: number, y: number, factionId: number, type: UnitTypeKey) {
    this.pos = new Vector(x, y);
    this.factionId = factionId;
    this.type = type;
    this.stats = { ...UNIT_TYPES[type] };
    this.hp = this.stats.hp;
    this.radius = this.stats.radius;
    this.color = FACTIONS[factionId].color;
  }

  takeDamage(amount: number, engine: GameEngine) {
    this.hp -= amount;
    if (this.hp <= 0) {
      engine.createSparks(this.pos.x, this.pos.y, '#ef4444', 6);
    }
  }

  update(dt: number, engine: GameEngine) {
    if (this.type === 'dummy') return;

    if (this.buffTimer > 0) this.buffTimer -= dt;
    if (this.blitzTimer > 0) this.blitzTimer -= dt;
    this.attackCooldown -= dt;

    const myCmd = engine.commanders.find((c) => c.factionId === this.factionId);
    if (!myCmd) return;

    // Find nearest enemy unit
    let nearestEnemy: Unit | null = null;
    let nearestDistSq = Infinity;
    for (const other of engine.units) {
      if (other.factionId !== this.factionId && other.hp > 0) {
        const dSq = this.pos.sub(other.pos).magSq();
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestEnemy = other;
        }
      }
    }

    const sepForce = this.calcSeparation(engine);
    let steering = new Vector(0, 0);

    const hasBanner = myCmd.activeBanner !== null;
    const atBanner = hasBanner && this.pos.sub(myCmd.activeBanner!).magSq() <= 110 * 110;

    if (hasBanner) {
      if (!atBanner) {
        const seek = myCmd.activeBanner!.sub(this.pos).normalize().mul(this.stats.speed);
        steering = steering.add(seek).add(sepForce);
      } else {
        if (nearestEnemy && nearestDistSq < this.stats.aggroRange * this.stats.aggroRange) {
          const dist = Math.sqrt(nearestDistSq);
          if (dist <= this.stats.range) {
            steering = steering.add(sepForce.mul(1.5));
            this.attack(nearestEnemy, engine);
          } else {
            const seek = nearestEnemy.pos.sub(this.pos).normalize().mul(this.stats.speed);
            steering = steering.add(seek).add(sepForce);
          }
        } else {
          const dToBanner = this.pos.dist(myCmd.activeBanner!);
          if (dToBanner > 25) {
            const seek = myCmd.activeBanner!.sub(this.pos).normalize().mul(this.stats.speed * 0.2);
            steering = steering.add(seek).add(sepForce.mul(0.5));
          } else {
            steering = steering.add(sepForce.mul(0.5));
          }
        }
      }
    } else {
      if (nearestEnemy && nearestDistSq < this.stats.aggroRange * this.stats.aggroRange) {
        const dist = Math.sqrt(nearestDistSq);
        if (dist <= this.stats.range) {
          steering = steering.add(sepForce.mul(1.5));
          this.attack(nearestEnemy, engine);
        } else {
          const seek = nearestEnemy.pos.sub(this.pos).normalize().mul(this.stats.speed);
          steering = steering.add(seek).add(sepForce);
        }
      } else {
        // Follow Marshal in formation
        const distToCmd = this.pos.dist(myCmd.pos);
        if (distToCmd > 65) {
          const seek = myCmd.pos.sub(this.pos).normalize().mul(this.stats.speed);
          steering = steering.add(seek).add(sepForce);
        } else {
          steering = steering.add(sepForce.mul(0.5));
          steering = steering.add(myCmd.pos.sub(this.pos).normalize().mul(this.stats.speed * 0.2));
        }
      }
    }

    let speedMult = 1.0;
    if (this.buffTimer > 0) speedMult *= 1.4;
    if (this.blitzTimer > 0) speedMult *= 2.0;

    this.vel = steering.limit(this.stats.speed * speedMult);
    this.pos = this.pos.add(this.vel.mul(dt * 60));

    this.pos.x = Math.max(this.radius + 20, Math.min(engine.width - this.radius - 20, this.pos.x));
    this.pos.y = Math.max(this.radius + 20, Math.min(engine.height - this.radius - 20, this.pos.y));
  }

  calcSeparation(engine: GameEngine): Vector {
    let force = new Vector(0, 0);
    let count = 0;
    const desired = this.radius * 2.6;

    for (const u of engine.units) {
      if (u === this) continue;
      const d = this.pos.dist(u.pos);
      if (d > 0 && d < desired) {
        const diff = this.pos.sub(u.pos).normalize().div(d);
        force = force.add(diff);
        count++;
      }
    }

    if (count > 0) {
      force = force.div(count).normalize().mul(this.stats.speed * 1.2);
    }
    return force;
  }

  attack(target: Unit, engine: GameEngine) {
    if (this.attackCooldown > 0) return;
    const mult = this.buffTimer > 0 ? 0.6 : 1.0;

    if (this.type === 'horse') {
      // Cavalry Sabre Slash
      target.takeDamage(this.stats.dmg, engine);
      engine.createSparks(target.pos.x, target.pos.y, '#ffffff', 5);
      this.attackCooldown = 0.9 * mult;
    } else if (this.type === 'soldier') {
      // Musket Volley
      sound.playMusket();
      engine.createSmokePuff(this.pos.x, this.pos.y, '#e2e8f0', 4);
      engine.projectiles.push(new Projectile(this.pos.x, this.pos.y, target, this));
      this.attackCooldown = 1.15 * mult;
    } else if (this.type === 'cannon') {
      // Grand Battery Blast
      sound.playCannon();
      engine.createSmokePuff(this.pos.x, this.pos.y, '#94a3b8', 8);
      engine.projectiles.push(new Projectile(this.pos.x, this.pos.y, target, this));
      this.attackCooldown = 2.8 * mult;
    }
  }
}

export class Outpost {
  pos: Vector;
  spawnType: UnitTypeKey;
  owner: number | null = null;
  captureProgress = 0;
  capturingFaction: number | null = null;
  radius = 80;
  spawnTimer = 0;
  clusterId = 0;
  clusterBonusActive = false;

  constructor(x: number, y: number, spawnType: UnitTypeKey, clusterId = 0) {
    this.pos = new Vector(x, y);
    this.spawnType = spawnType;
    this.clusterId = clusterId;
  }

  update(dt: number, engine: GameEngine) {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let factionsPresent = 0;
    let soleFaction: number | null = null;

    for (const u of engine.units) {
      if (u.pos.dist(this.pos) <= this.radius) {
        if (counts[u.factionId] === 0) factionsPresent++;
        counts[u.factionId]++;
        soleFaction = u.factionId;
      }
    }

    if (factionsPresent === 1 && soleFaction !== null) {
      if (this.owner !== soleFaction) {
        if (this.capturingFaction !== soleFaction) {
          if (this.captureProgress > 0) {
            this.captureProgress -= dt / (CAPTURE_TIME / 2);
            if (this.captureProgress <= 0) {
              this.captureProgress = 0;
              this.capturingFaction = soleFaction;
            }
          } else {
            this.capturingFaction = soleFaction;
          }
        } else {
          this.captureProgress += dt / CAPTURE_TIME;
          if (this.captureProgress >= 1) {
            this.owner = this.capturingFaction;
            this.captureProgress = 0;
            this.capturingFaction = null;
            this.spawnTimer = 0;
            sound.playCapture();
            engine.createExplosion(this.pos.x, this.pos.y, 50, FACTIONS[this.owner].color);
          }
        }
      } else {
        if (this.captureProgress > 0) {
          this.captureProgress -= dt / CAPTURE_TIME;
          if (this.captureProgress <= 0) {
            this.captureProgress = 0;
            this.capturingFaction = null;
          }
        }
      }
    } else if (factionsPresent === 0) {
      if (this.captureProgress > 0 && this.owner !== this.capturingFaction) {
        this.captureProgress -= dt / (CAPTURE_TIME * 2);
        if (this.captureProgress <= 0) {
          this.captureProgress = 0;
          this.capturingFaction = null;
        }
      }
    }

    // Production
    if (this.owner !== null) {
      let spawnMult = 1.0;
      for (const ov of engine.overdrives) {
        if (ov.factionId === this.owner && this.pos.dist(ov.pos) <= 160) {
          spawnMult = 2.0;
          break;
        }
      }

      // If a player controls all outposts in a cluster, production increases by 1.5x
      const clusterMult = this.clusterBonusActive ? 1.5 : 1.0;

      this.spawnTimer += dt * spawnMult * clusterMult;
      const rate = UNIT_TYPES[this.spawnType].spawnRate;
      if (this.spawnTimer >= rate) {
        this.spawnTimer = 0;
        const spawnX = this.pos.x + (Math.random() - 0.5) * 35;
        const spawnY = this.pos.y + (Math.random() - 0.5) * 35;
        engine.units.push(new Unit(spawnX, spawnY, this.owner, this.spawnType));
        engine.createSmokePuff(spawnX, spawnY, '#e8dec2', 4);
      }
    }
  }
}

export class GameEngine {
  active = false;
  time = 0;
  mapSize: MapSizeKey = 'small';
  width = 1600;
  height = 1200;
  mapSeed = 12345;
  isOnline = false;
  isHost = true;
  myFactionId = 0;
  tickCount = 0;

  players: Array<{ id: number; name: string; isAI: boolean; skills: [SkillKey, SkillKey] }> = [];
  commanders: Commander[] = [];
  units: Unit[] = [];
  outposts: Outpost[] = [];
  clusters: OutpostCluster[] = [];
  clusterConnections: ClusterConnection[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  rings: RingEffect[] = [];
  overdrives: Array<{ pos: Vector; life: number; factionId: number }> = [];
  shields: Array<{ pos: Vector; life: number; radius: number; factionId: number }> = [];
  keys: Record<string, boolean> = {};

  onEndGame?: (winnerId: number | null) => void;

  constructor() {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  createSparks(x: number, y: number, color: string, count = 5) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color, 2 + Math.random() * 3, 2, 0.25));
    }
  }

  createSmokePuff(x: number, y: number, color: string, count = 6) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color, 0.8 + Math.random() * 1.5, 3 + Math.random() * 4, 0.5 + Math.random() * 0.4, 'smoke'));
    }
  }

  createExplosion(x: number, y: number, radius: number, color: string) {
    for (let i = 0; i < 16; i++) {
      this.particles.push(new Particle(x, y, color, 2 + Math.random() * 5, 3 + Math.random() * 4, 0.4 + Math.random() * 0.3));
      this.particles.push(new Particle(x, y, '#64748b', 1 + Math.random() * 3, 4 + Math.random() * 7, 0.5 + Math.random() * 0.5, 'smoke'));
    }
  }

  start(
    sizeKey: MapSizeKey,
    playerConfigs: Array<{ type: 'human' | 'ai' | 'none'; skills: [SkillKey, SkillKey] }>,
    sharedMapData?: SharedMapData,
    myFactionId = 0,
    isOnline = false,
    isHost = true
  ) {
    this.isOnline = isOnline;
    this.isHost = isHost;
    this.myFactionId = myFactionId;
    this.players = [];
    this.commanders = [];
    this.units = [];
    this.projectiles = [];
    this.particles = [];
    this.rings = [];
    this.overdrives = [];
    this.shields = [];
    this.keys = {};
    this.time = 0;
    this.tickCount = 0;

    playerConfigs.forEach((cfg, idx) => {
      if (cfg.type !== 'none') {
        const faction = FACTIONS[idx];
        const isAI = cfg.type === 'ai';
        let skills = [...cfg.skills] as [SkillKey, SkillKey];
        if (isAI) {
          const allSkills = Object.keys(SKILLS) as SkillKey[];
          skills = allSkills.sort(() => 0.5 - Math.random()).slice(0, 2) as [SkillKey, SkillKey];
        }
        this.players.push({
          id: faction.id,
          name: faction.name,
          isAI,
          skills
        });
      }
    });

    if (this.players.length < 2) return false;

    // Load shared map data (guaranteed identical outposts, clusters, connections)
    if (sharedMapData) {
      this.mapSeed = sharedMapData.seed;
      this.mapSize = sharedMapData.mapSize;
      this.width = sharedMapData.width;
      this.height = sharedMapData.height;
      this.outposts = sharedMapData.outposts.map((o) => new Outpost(o.x, o.y, o.type, o.clusterId));
      this.clusters = JSON.parse(JSON.stringify(sharedMapData.clusters));
      this.clusterConnections = JSON.parse(JSON.stringify(sharedMapData.clusterConnections));
    } else {
      const generated = generateSharedMapData(sizeKey);
      this.mapSeed = generated.seed;
      this.mapSize = generated.mapSize;
      this.width = generated.width;
      this.height = generated.height;
      this.outposts = generated.outposts.map((o) => new Outpost(o.x, o.y, o.type, o.clusterId));
      this.clusters = generated.clusters;
      this.clusterConnections = generated.clusterConnections;
    }

    const corners = [
      { x: 180, y: 180 },
      { x: this.width - 180, y: this.height - 180 },
      { x: this.width - 180, y: 180 },
      { x: 180, y: this.height - 180 }
    ];

    this.players.forEach((p, idx) => {
      const spawn = corners[idx % corners.length];
      const cmd = new Commander(FACTIONS[p.id], p.isAI, spawn.x, spawn.y, p.skills);
      if (isOnline) {
        if (p.isAI) {
          cmd.isAI = true;
          cmd.isRemoteHuman = false;
        } else if (p.id === myFactionId) {
          cmd.isAI = false;
          cmd.isRemoteHuman = false; // Local Human Player
        } else {
          cmd.isAI = false;
          cmd.isRemoteHuman = true; // Remote Human Player
        }
      }
      this.commanders.push(cmd);

      // Spawn initial 3 Voltigeurs
      for (let i = 0; i < 3; i++) {
        const sx = cmd.pos.x + (Math.random() - 0.5) * 40;
        const sy = cmd.pos.y + (Math.random() - 0.5) * 40;
        this.units.push(new Unit(sx, sy, p.id, 'soldier'));
      }
    });

    this.active = true;
    return true;
  }

  castPlayerSkill(factionId: number, slot: 1 | 2) {
    const cmd = this.commanders.find((c) => c.factionId === factionId);
    if (!cmd) return;
    if (slot === 1 && cmd.cooldown1 <= 0) {
      cmd.castSkill(1, this);
    } else if (slot === 2 && cmd.cooldown2 <= 0) {
      cmd.castSkill(2, this);
    }
  }

  getNetGameState(tick: number): NetGameState {
    return {
      tick,
      updatedAt: Date.now(),
      commanders: this.commanders.map((c) => ({
        id: c.factionId,
        x: Math.round(c.pos.x),
        y: Math.round(c.pos.y),
        vx: Math.round(c.vel.x * 10) / 10,
        vy: Math.round(c.vel.y * 10) / 10,
        hp: 100,
        bannerX: c.activeBanner ? Math.round(c.activeBanner.x) : null,
        bannerY: c.activeBanner ? Math.round(c.activeBanner.y) : null,
        cd1: Math.round(c.cooldown1 * 10) / 10,
        cd2: Math.round(c.cooldown2 * 10) / 10
      })),
      outposts: this.outposts.map((o, idx) => ({
        id: idx,
        owner: o.owner,
        capProg: Math.round(o.captureProgress * 100) / 100,
        capFaction: o.capturingFaction
      })),
      units: this.units.map((u, idx) => ({
        id: idx,
        x: Math.round(u.pos.x),
        y: Math.round(u.pos.y),
        f: u.factionId,
        t: u.type,
        hp: Math.round(u.hp)
      })),
      winner: null
    };
  }

  applyNetGameState(snapshot: NetGameState) {
    if (!this.active) return;

    // Sync outposts
    if (snapshot.outposts) {
      snapshot.outposts.forEach((netOp) => {
        const op = this.outposts[netOp.id];
        if (op) {
          op.owner = netOp.owner;
          op.captureProgress = netOp.capProg;
          op.capturingFaction = netOp.capFaction;
        }
      });
    }

    // Sync commanders
    if (snapshot.commanders) {
      snapshot.commanders.forEach((netCmd) => {
        const cmd = this.commanders.find((c) => c.factionId === netCmd.id);
        if (cmd) {
          if (cmd.isRemoteHuman || (cmd.isAI && !this.isHost)) {
            cmd.targetPos = new Vector(netCmd.x, netCmd.y);
            cmd.vel = new Vector(netCmd.vx, netCmd.vy);
            if (netCmd.bannerX !== null && netCmd.bannerY !== null) {
              cmd.activeBanner = new Vector(netCmd.bannerX, netCmd.bannerY);
              cmd.bannerTimer = 10;
            } else {
              cmd.activeBanner = null;
            }
          }
          cmd.cooldown1 = netCmd.cd1;
          cmd.cooldown2 = netCmd.cd2;
        }
      });
    }

    // Reconcile units for guest
    if (!this.isHost && snapshot.units) {
      const netUnits = snapshot.units;
      while (this.units.length < netUnits.length) {
        const nu = netUnits[this.units.length];
        this.units.push(new Unit(nu.x, nu.y, nu.f, nu.t));
      }
      while (this.units.length > netUnits.length) {
        this.units.pop();
      }
      for (let i = 0; i < netUnits.length; i++) {
        const nu = netUnits[i];
        const u = this.units[i];
        u.factionId = nu.f;
        u.type = nu.t;
        u.hp = nu.hp;
        u.pos.x += (nu.x - u.pos.x) * 0.45;
        u.pos.y += (nu.y - u.pos.y) * 0.45;
      }
    }
  }

  applyNetPlayerInput(input: NetPlayerInput) {
    const cmd = this.commanders.find((c) => c.factionId === input.factionId);
    if (!cmd) return;
    if (cmd.isRemoteHuman) {
      cmd.targetPos = new Vector(input.x, input.y);
      cmd.vel = new Vector(input.vx, input.vy);
      if (input.activeBanner) {
        cmd.activeBanner = new Vector(input.activeBanner.x, input.activeBanner.y);
        cmd.bannerTimer = 10;
      }
      if (input.skillCast) {
        cmd.castSkill(input.skillCast.slot, this);
      }
    }
  }

  getLocalPlayerInput(playerId: string): NetPlayerInput | null {
    const cmd = this.commanders.find((c) => c.factionId === this.myFactionId);
    if (!cmd) return null;
    const input: NetPlayerInput = {
      factionId: this.myFactionId,
      playerId,
      x: Math.round(cmd.pos.x),
      y: Math.round(cmd.pos.y),
      vx: Math.round(cmd.vel.x * 10) / 10,
      vy: Math.round(cmd.vel.y * 10) / 10,
      activeBanner: cmd.activeBanner ? { x: Math.round(cmd.activeBanner.x), y: Math.round(cmd.activeBanner.y) } : null,
      skillCast: cmd.lastSkillCast,
      updatedAt: Date.now()
    };
    cmd.lastSkillCast = null;
    return input;
  }

  update(dt: number) {
    if (!this.active) return;
    this.time += dt;

    // Commanders
    this.commanders.forEach((c) => c.update(dt, this));

    // Units
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      u.update(dt, this);
      if (u.hp <= 0) {
        this.units.splice(i, 1);
      }
    }

    // Outpost Cluster Synergy Check
    this.updateClusters();

    // Outposts
    this.outposts.forEach((o) => o.update(dt, this));

    // Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt, this);
      if (!p.active) this.projectiles.splice(i, 1);
    }

    // Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.update(dt);
      if (r.life <= 0) this.rings.splice(i, 1);
    }

    // Overdrives
    for (let i = this.overdrives.length - 1; i >= 0; i--) {
      this.overdrives[i].life -= dt;
      if (this.overdrives[i].life <= 0) this.overdrives.splice(i, 1);
    }

    // Shields
    for (let i = this.shields.length - 1; i >= 0; i--) {
      this.shields[i].life -= dt;
      if (this.shields[i].life <= 0) this.shields.splice(i, 1);
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    this.checkWinCondition();
    this.checkPhaseMusic();
  }

  updateClusters() {
    for (const cluster of this.clusters) {
      if (cluster.outpostIndices.length === 0) continue;
      const firstOwner = this.outposts[cluster.outpostIndices[0]]?.owner;
      let allSame = firstOwner !== null && firstOwner !== undefined;

      if (allSame) {
        for (let i = 1; i < cluster.outpostIndices.length; i++) {
          const idx = cluster.outpostIndices[i];
          if (this.outposts[idx]?.owner !== firstOwner) {
            allSame = false;
            break;
          }
        }
      }

      cluster.controllingFaction = allSame ? (firstOwner as number) : null;
      for (const idx of cluster.outpostIndices) {
        if (this.outposts[idx]) {
          this.outposts[idx].clusterBonusActive = allSame;
        }
      }
    }
  }

  checkWinCondition() {
    if (this.time <= 5) return;

    const aliveFactions = new Set<number>();
    this.units.forEach((u) => aliveFactions.add(u.factionId));
    this.outposts.forEach((o) => {
      if (o.owner !== null) aliveFactions.add(o.owner);
      if (o.capturingFaction !== null) aliveFactions.add(o.capturingFaction);
    });

    // Remove eliminated commanders
    for (let i = this.commanders.length - 1; i >= 0; i--) {
      if (!aliveFactions.has(this.commanders[i].factionId)) {
        this.createExplosion(this.commanders[i].pos.x, this.commanders[i].pos.y, 60, this.commanders[i].color);
        this.commanders.splice(i, 1);
      }
    }

    const playerIds = this.players.map((p) => p.id);
    let aliveCount = 0;
    let lastAlive: number | null = null;

    for (const id of playerIds) {
      if (aliveFactions.has(id)) {
        aliveCount++;
        lastAlive = id;
      }
    }

    if (aliveCount <= 1) {
      this.active = false;
      if (this.onEndGame) {
        this.onEndGame(lastAlive);
      }
    }
  }

  checkPhaseMusic() {
    if (this.time <= 5) return;
    const total = this.outposts.length;
    let maxOwned = 0;
    const counts: Record<number, number> = {};

    this.outposts.forEach((o) => {
      if (o.owner !== null) {
        counts[o.owner] = (counts[o.owner] || 0) + 1;
        if (counts[o.owner] > maxOwned) maxOwned = counts[o.owner];
      }
    });

    if (maxOwned / total >= 0.7) {
      sound.setIntensity('stress');
    } else {
      sound.setIntensity('normal');
    }
  }
}
