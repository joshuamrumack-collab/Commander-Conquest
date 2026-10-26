import { FactionDef, Vec2, SkillKey } from '../types';
import { FACTIONS, SKILLS, UNIT_TYPES } from './constants';
import { Commander, GameEngine, Outpost, Projectile, Unit } from './engine';
import { SeededRandom } from './mapGenerator';

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private engine: GameEngine;
  private camera = { x: 0, y: 0, zoom: 1 };

  // Procedural map elements cached
  private terrainTrees: Array<{ x: number; y: number; r: number; type: number }> = [];
  private roads: Array<{ from: Vec2; to: Vec2 }> = [];
  private cachedMapSize = '';

  constructor(canvas: HTMLCanvasElement, engine: GameEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.engine = engine;
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.updateCamera();
  }

  updateCamera() {
    if (!this.engine.width || !this.engine.height) return;

    // Leave comfortable clearance for top HUD when playing so the entire map is 100% visible
    const topMargin = this.engine.active ? 74 : 20;
    const bottomMargin = 16;
    const sideMargin = 20;

    const availW = Math.max(100, window.innerWidth - sideMargin * 2);
    const availH = Math.max(100, window.innerHeight - topMargin - bottomMargin);

    const scaleX = availW / this.engine.width;
    const scaleY = availH / this.engine.height;
    const scale = Math.min(scaleX, scaleY);

    this.camera.zoom = scale;
    const mapW = this.engine.width * scale;
    const mapH = this.engine.height * scale;

    this.camera.x = (window.innerWidth - mapW) / 2;
    this.camera.y = topMargin + (availH - mapH) / 2;
  }

  generateTerrainDecorations(customSeed?: number) {
    const key = `${this.engine.width}x${this.engine.height}_${customSeed ?? this.engine.mapSeed ?? 0}`;
    if (this.cachedMapSize === key && this.terrainTrees.length > 0) return;
    this.cachedMapSize = key;

    this.terrainTrees = [];
    this.roads = [];

    // Connect outposts according to cluster connections
    for (const conn of this.engine.clusterConnections) {
      const opA = this.engine.outposts[conn.from];
      const opB = this.engine.outposts[conn.to];
      if (opA && opB) {
        this.roads.push({ from: opA.pos, to: opB.pos });
      }
    }

    // Generate clusters of vintage cartographic trees with deterministic seed
    const seed = customSeed ?? this.engine.mapSeed ?? 12345;
    const rng = new SeededRandom(seed);
    const ops = this.engine.outposts;
    const numClusters = Math.floor((this.engine.width * this.engine.height) / 180000);
    for (let c = 0; c < numClusters; c++) {
      const cx = 100 + rng.next() * (this.engine.width - 200);
      const cy = 100 + rng.next() * (this.engine.height - 200);

      // Avoid placing directly on outposts
      let onOutpost = false;
      for (const op of ops) {
        if (Math.hypot(cx - op.pos.x, cy - op.pos.y) < 180) {
          onOutpost = true;
          break;
        }
      }
      if (onOutpost) continue;

      const clusterCount = 5 + Math.floor(rng.next() * 8);
      for (let t = 0; t < clusterCount; t++) {
        this.terrainTrees.push({
          x: cx + (rng.next() - 0.5) * 80,
          y: cy + (rng.next() - 0.5) * 60,
          r: 6 + rng.next() * 7,
          type: rng.next() > 0.5 ? 1 : 2
        });
      }
    }
  }

  render(time: number) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Outer War Cabinet Room table background (deep mahogany velvet)
    ctx.fillStyle = '#100c0a';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    // 1. Draw Antique Cartographic War Campaign Map
    this.drawParchmentMap(time);

    // 2. Draw Vauban Star Bastions
    for (const outpost of this.engine.outposts) {
      this.drawVaubanOutpost(outpost, time);
    }

    // 3. Draw Ability Rings & Fields
    for (const ring of this.engine.rings) {
      ring.draw(ctx);
    }

    for (const ov of this.engine.overdrives) {
      this.drawOverdriveField(ov, time);
    }

    for (const sh of this.engine.shields) {
      this.drawShieldDome(sh, time);
    }

    // 4. Draw Active Regimental Banners
    for (const cmd of this.engine.commanders) {
      if (cmd.activeBanner) {
        this.drawRegimentalBanner(cmd.activeBanner, cmd.bannerTimer, cmd.factionId, time);
      }
    }

    // 5. Draw Entities (Units + Commanders), Y-sorted for depth
    const renderList: Array<{ y: number; draw: () => void }> = [];

    for (const unit of this.engine.units) {
      renderList.push({
        y: unit.pos.y,
        draw: () => this.drawUnit(unit, time)
      });
    }

    for (const cmd of this.engine.commanders) {
      renderList.push({
        y: cmd.pos.y,
        draw: () => this.drawCommander(cmd, time)
      });
    }

    renderList.sort((a, b) => a.y - b.y);
    for (const item of renderList) {
      item.draw();
    }

    // 6. Draw Projectiles & Particles
    for (const proj of this.engine.projectiles) {
      this.drawProjectile(proj, time);
    }

    for (const part of this.engine.particles) {
      part.draw(ctx);
    }

    // 7. Draw Map Outer Gilded Border & Cartographic Frame
    this.drawCartographicFrame(time);

    ctx.restore();
  }

  private drawParchmentMap(time: number) {
    const ctx = this.ctx;
    const mapW = this.engine.width;
    const mapH = this.engine.height;

    // Base Weathered Parchment gradient
    const grad = ctx.createRadialGradient(
      mapW * 0.5, mapH * 0.5, mapW * 0.1,
      mapW * 0.5, mapH * 0.5, mapW * 0.75
    );
    grad.addColorStop(0, '#f5ecd5'); // Soft warm parchment center
    grad.addColorStop(0.65, '#ebdcc0'); // Aged paper
    grad.addColorStop(0.95, '#d4be99'); // Burnished edges
    grad.addColorStop(1, '#a88f6c'); // Antiqued dark vignette

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, mapW, mapH);

    // Subtle paper grain & vintage campaign topography contours
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 95, 60, 0.08)';
    ctx.lineWidth = 1.2;

    // Topographical elevation contour curves
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      const cx = mapW * (0.2 + (i % 3) * 0.3);
      const cy = mapH * (0.25 + Math.floor(i / 3) * 0.35);
      const rx = 240 + i * 40;
      const ry = 180 + i * 30;
      ctx.ellipse(cx, cy, rx, ry, 0.2 * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Vintage Cartographic Coordinate Grid
    ctx.strokeStyle = 'rgba(120, 85, 45, 0.09)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([8, 8]);
    for (let x = 120; x < mapW; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapH);
      ctx.stroke();
    }
    for (let y = 120; y < mapH; y += 120) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(mapW, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Draw Outpost Cluster Connection Lines
    ctx.save();
    for (const conn of this.engine.clusterConnections) {
      const opA = this.engine.outposts[conn.from];
      const opB = this.engine.outposts[conn.to];
      if (!opA || !opB) continue;

      const cluster = this.engine.clusters[conn.clusterId];
      const isControlled = cluster && cluster.controllingFaction !== null;
      const faction = isControlled ? FACTIONS[cluster.controllingFaction!] : null;

      if (isControlled && faction) {
        // Glowing faction synergy line (+1.5x production active!)
        ctx.strokeStyle = faction.color;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.shadowColor = faction.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(opA.pos.x, opA.pos.y);
        ctx.lineTo(opB.pos.x, opB.pos.y);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(opA.pos.x, opA.pos.y);
        ctx.lineTo(opB.pos.x, opB.pos.y);
        ctx.stroke();

        // Traveling gold sparks between outposts
        const dist = opA.pos.dist(opB.pos);
        const flowSteps = Math.max(1, Math.floor(dist / 90));
        for (let p = 0; p < flowSteps; p++) {
          const t = ((time * 0.7 + p / flowSteps) % 1);
          const px = opA.pos.x + (opB.pos.x - opA.pos.x) * t;
          const py = opA.pos.y + (opB.pos.y - opA.pos.y) * t;

          ctx.fillStyle = faction.goldColor;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Midpoint badge indicating +1.5x
        const mx = (opA.pos.x + opB.pos.x) / 2;
        const my = (opA.pos.y + opB.pos.y) / 2;
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(mx - 18, my - 8, 36, 16);
        ctx.strokeStyle = faction.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mx - 18, my - 8, 36, 16);
        ctx.fillStyle = faction.goldColor;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('1.5x', mx, my + 1);
      } else {
        // Neutral / Contested tactical military connection line
        ctx.strokeStyle = 'rgba(145, 115, 80, 0.28)';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(opA.pos.x, opA.pos.y);
        ctx.lineTo(opB.pos.x, opB.pos.y);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(100, 75, 45, 0.45)';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(opA.pos.x, opA.pos.y);
        ctx.lineTo(opB.pos.x, opB.pos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // Draw Vintage Forest Clusters
    ctx.save();
    for (const tree of this.terrainTrees) {
      // Tree shadow
      ctx.fillStyle = 'rgba(90, 70, 45, 0.2)';
      ctx.beginPath();
      ctx.ellipse(tree.x + 3, tree.y + 4, tree.r, tree.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tree canopy (vintage olive-sepia botanical etching)
      ctx.fillStyle = tree.type === 1 ? '#5c6d48' : '#4a5b3a';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();

      // Delicate ink outline
      ctx.strokeStyle = '#324026';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Trunk
      ctx.fillStyle = '#6b5439';
      ctx.fillRect(tree.x - 1, tree.y + tree.r * 0.6, 2, 4);
    }
    ctx.restore();

    // Draw Campaign Compass Rose in a quiet area (top center-left)
    this.drawCompassRose(mapW * 0.15, mapH * 0.88, time);
  }

  private drawCompassRose(cx: number, cy: number, time: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);

    const radius = 55;

    // Compass outer brass ring
    ctx.strokeStyle = 'rgba(140, 100, 40, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(140, 100, 40, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
    ctx.stroke();

    // 8-Pointed Star Points
    const points = [
      { angle: 0, label: 'E' },
      { angle: Math.PI / 2, label: 'S' },
      { angle: Math.PI, label: 'W' },
      { angle: -Math.PI / 2, label: 'N' }
    ];

    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const isCard = i % 2 === 0;
      const len = isCard ? radius - 10 : radius - 22;

      ctx.save();
      ctx.rotate(a);

      // Half colored, half dark facet
      ctx.fillStyle = isCard ? 'rgba(175, 125, 40, 0.55)' : 'rgba(140, 100, 40, 0.3)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.lineTo(len * 0.5, -4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = isCard ? 'rgba(80, 50, 20, 0.55)' : 'rgba(60, 40, 15, 0.3)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.lineTo(len * 0.5, 4);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Cardinal Labels
    ctx.fillStyle = 'rgba(90, 60, 25, 0.7)';
    ctx.font = 'bold 11px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -radius - 12);
    ctx.fillText('S', 0, radius + 12);
    ctx.fillText('E', radius + 12, 0);
    ctx.fillText('W', -radius - 12, 0);

    // Fleur-de-lis arrow at North
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    ctx.moveTo(0, -radius + 4);
    ctx.lineTo(-5, -radius + 14);
    ctx.lineTo(0, -radius + 10);
    ctx.lineTo(5, -radius + 14);
    ctx.closePath();
    ctx.fill();

    // Center brass pivot
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawVaubanOutpost(outpost: Outpost, time: number) {
    const ctx = this.ctx;
    const pos = outpost.pos;
    const r = outpost.radius;
    const ownerFaction = outpost.owner !== null ? FACTIONS[outpost.owner] : null;
    const ownerColor = ownerFaction ? ownerFaction.color : '#8a7a65';
    const ownerGold = ownerFaction ? ownerFaction.goldColor : '#d4af37';

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // 1. Outer Earthwork Glacis & Moat (Vauban Star Fort Silhouette)
    const points = 8; // 8-point geometric star redoubt
    const outerR = r * 1.15;
    const innerR = r * 0.85;

    // Moat shadow
    ctx.fillStyle = 'rgba(70, 50, 30, 0.22)';
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const rad = i % 2 === 0 ? outerR + 10 : innerR + 6;
      const x = Math.cos(angle) * rad;
      const y = Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Star Bastion Masonry Stone Wall
    ctx.fillStyle = '#cfbe9e';
    ctx.strokeStyle = '#5a4632';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const rad = i % 2 === 0 ? outerR : innerR;
      const x = Math.cos(angle) * rad;
      const y = Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Star fort interior earthwork platform
    ctx.fillStyle = '#bda884';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 70, 45, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Regimental Capture Ring / Laurels
    if (outpost.captureProgress > 0) {
      const capFaction = outpost.capturingFaction !== null ? FACTIONS[outpost.capturingFaction] : null;
      const capColor = capFaction ? capFaction.color : '#ffffff';

      // Outer glowing siege ring
      ctx.save();
      ctx.beginPath();
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * outpost.captureProgress;
      ctx.arc(0, 0, r + 8, startAngle, endAngle);
      ctx.strokeStyle = capColor;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.shadowColor = capColor;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    }

    // Faction Perimeter Pennants / Cockades
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.setLineDash([8, 6]);
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Central Stone Citadel Keep (Enlarged)
    const keepR = 36;
    // Keep shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(5, 7, keepR, 0, Math.PI * 2);
    ctx.fill();

    // Keep Stone Walls
    const keepGrad = ctx.createRadialGradient(-6, -6, 4, 0, 0, keepR);
    keepGrad.addColorStop(0, '#f2e8d4');
    keepGrad.addColorStop(0.7, '#a89474');
    keepGrad.addColorStop(1, '#695741');
    ctx.fillStyle = keepGrad;
    ctx.beginPath();
    ctx.arc(0, 0, keepR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#423321';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Four Crenellated Bastion Turrets
    for (let t = 0; t < 4; t++) {
      const ang = (t * Math.PI) / 2 + Math.PI / 4;
      const tx = Math.cos(ang) * keepR * 0.95;
      const ty = Math.sin(ang) * keepR * 0.95;
      ctx.fillStyle = '#8f7b5e';
      ctx.beginPath();
      ctx.arc(tx, ty, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3d2e1c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 3. Central Production Core Emblem (Musket, Horse, Cannon) - SIGNIFICANTLY ENLARGED
    const coreR = 25;
    ctx.fillStyle = ownerFaction ? ownerColor : '#2c2218';
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ownerGold;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Large high-visibility Icon so you can instantly tell what type of outpost it is!
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;

    let icon = '⚔️';
    if (outpost.spawnType === 'horse') icon = '🐎';
    if (outpost.spawnType === 'cannon') icon = '💣';
    ctx.fillText(icon, 0, 2);
    ctx.shadowBlur = 0;

    // 4. Production Progress Radial Clockwork Indicator
    if (outpost.owner !== null) {
      const rate = UNIT_TYPES[outpost.spawnType].spawnRate;
      const prog = Math.min(1, outpost.spawnTimer / rate);
      ctx.beginPath();
      ctx.arc(0, 0, coreR + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
      ctx.strokeStyle = ownerGold;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Cluster Synergy 1.5x Production Active Visual
    if (outpost.clusterBonusActive) {
      // Golden synergy aura
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
      ctx.stroke();

      // Top 1.5x Speed Ribbon
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(-22, -keepR - 16, 44, 15);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-22, -keepR - 16, 44, 15);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('1.5x SPD', 0, -keepR - 8);
      ctx.restore();
    }

    // 5. Majestic Waving Regimental Silk Battle Standard
    const poleX = -24;
    const poleBaseY = -10;
    const poleTopY = -62;

    // Wooden flagpole
    ctx.strokeStyle = '#5a3818';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(poleX, poleBaseY);
    ctx.lineTo(poleX, poleTopY);
    ctx.stroke();

    // Golden Imperial Eagle Finial on top
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(poleX, poleTopY - 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6d1b';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (outpost.owner !== null) {
      // Waving silk flag
      const wave = Math.sin(time * 4 + pos.x * 0.05) * 5;
      const flagW = 28;
      const flagH = 18;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poleX, poleTopY);
      ctx.bezierCurveTo(
        poleX + flagW * 0.4, poleTopY - 2 + wave,
        poleX + flagW * 0.7, poleTopY + 2 - wave,
        poleX + flagW, poleTopY + wave * 0.5
      );
      ctx.lineTo(poleX + flagW - 4, poleTopY + flagH + wave * 0.5);
      ctx.bezierCurveTo(
        poleX + flagW * 0.7, poleTopY + flagH + 2 - wave,
        poleX + flagW * 0.4, poleTopY + flagH - 2 + wave,
        poleX, poleTopY + flagH
      );
      ctx.closePath();

      // Flag background in faction color
      ctx.fillStyle = ownerColor;
      ctx.fill();

      // Gold fringe border
      ctx.strokeStyle = ownerGold;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Faction emblem embroidered on flag
      if (ownerFaction) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px serif';
        ctx.textAlign = 'center';
        ctx.fillText(ownerFaction.emblem, poleX + flagW * 0.48, poleTopY + flagH * 0.65 + wave * 0.2);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  private drawCommander(cmd: Commander, time: number) {
    const ctx = this.ctx;
    const pos = cmd.pos;
    const faction = FACTIONS[cmd.factionId];
    const isMoving = cmd.vel.magSq() > 0.1;
    const marchBob = isMoving ? Math.sin(time * 12) * 2.5 : 0;

    ctx.save();
    ctx.translate(pos.x, pos.y + marchBob);

    // 1. Soft Elliptical Directional Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 8 - marchBob, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Marshal's Greatcoat / Body
    // Golden Epaulettes (left and right shoulder tassels)
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(-8, -1, 4, 0, Math.PI * 2);
    ctx.arc(8, -1, 4, 0, Math.PI * 2);
    ctx.fill();

    // Torso (Imperial uniform in faction color with gold bullion frogging)
    ctx.fillStyle = faction.color;
    ctx.beginPath();
    ctx.ellipse(0, 2, 9, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d1f14';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // White leather cross-sash & gold chest frogging
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(6, 8);
    ctx.stroke();

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1;
    for (let f = -2; f <= 5; f += 2.5) {
      ctx.beginPath();
      ctx.moveTo(-4, f);
      ctx.lineTo(4, f);
      ctx.stroke();
    }

    // 3. Head & Face
    ctx.fillStyle = '#f5d0b0';
    ctx.beginPath();
    ctx.arc(0, -6, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // 4. Iconic Napoleonic Bicorne Hat (worn sideways in the style of Bonaparte)
    const hatW = 20;
    const hatH = 8;
    const hatY = -12;

    ctx.save();
    // Black felt bicorne body
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.moveTo(-hatW, hatY + 2);
    ctx.quadraticCurveTo(-hatW * 0.5, hatY - hatH, 0, hatY - hatH * 0.7);
    ctx.quadraticCurveTo(hatW * 0.5, hatY - hatH, hatW, hatY + 2);
    ctx.quadraticCurveTo(0, hatY - 1, -hatW, hatY + 2);
    ctx.closePath();
    ctx.fill();

    // Golden bullion braid brim trim
    ctx.strokeStyle = '#e0b445';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Imperial Cockade (Tricolor / Faction roundel on hat)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(2, hatY - 3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = faction.color;
    ctx.beginPath();
    ctx.arc(2, hatY - 3, 2, 0, Math.PI * 2);
    ctx.fill();

    // Majestic Waving Feather Plume (Aigrette)
    const plumeWave = Math.sin(time * 6) * 3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, hatY - 4);
    ctx.quadraticCurveTo(5 + plumeWave, hatY - 14, 3 + plumeWave * 1.5, hatY - 18);
    ctx.stroke();
    ctx.restore();

    // 5. Drawn Arcane Marshal's Saber
    ctx.save();
    const saberAngle = isMoving ? Math.sin(time * 8) * 0.2 : 0;
    ctx.rotate(saberAngle);
    // Brass Hilt
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(8, 0, 3, 5);
    // Curved Steel Blade
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.quadraticCurveTo(14, -8, 17, -16);
    ctx.stroke();
    // Magical spark gleam at tip
    ctx.fillStyle = faction.goldColor;
    ctx.beginPath();
    ctx.arc(17, -16, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 6. Sovereign Ring of Valor & Dual Cooldown Gauges
    // Golden laurel aura beneath Marshal
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();

    // Dual Gilded Skill Medals (Cooldown indicators)
    const sk1 = SKILLS[cmd.skill1];
    const sk2 = SKILLS[cmd.skill2];
    const cd1Ratio = Math.max(0, cmd.cooldown1 / sk1.cd);
    const cd2Ratio = Math.max(0, cmd.cooldown2 / sk2.cd);

    // Left medal (Skill 1)
    ctx.fillStyle = cd1Ratio === 0 ? sk1.color : 'rgba(80, 70, 60, 0.7)';
    ctx.fillRect(-14, 18, 12, 4);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1;
    ctx.strokeRect(-14, 18, 12, 4);
    if (cd1Ratio > 0) {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-14, 18, 12 * (1 - cd1Ratio), 4);
    }

    // Right medal (Skill 2)
    ctx.fillStyle = cd2Ratio === 0 ? sk2.color : 'rgba(80, 70, 60, 0.7)';
    ctx.fillRect(2, 18, 12, 4);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 18, 12, 4);
    if (cd2Ratio > 0) {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(2, 18, 12 * (1 - cd2Ratio), 4);
    }

    ctx.restore();
  }

  private drawUnit(unit: Unit, time: number) {
    const ctx = this.ctx;
    const pos = unit.pos;
    const faction = FACTIONS[unit.factionId];
    const isMoving = unit.vel.magSq() > 0.05;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Shadows
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    if (unit.type === 'horse') {
      ctx.beginPath();
      ctx.ellipse(0, 6, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, 4, unit.radius, unit.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 1. Line Infantry / Voltigeur
    if (unit.type === 'soldier') {
      const marchLeg = isMoving ? Math.sin(time * 16) * 3 : 0;

      // Legs / Breeches
      ctx.fillStyle = '#f8fafc'; // White breeches
      ctx.fillRect(-3, 2, 2, 5 + marchLeg);
      ctx.fillRect(1, 2, 2, 5 - marchLeg);
      // Black gaiters
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(-3, 6 + marchLeg, 2, 2);
      ctx.fillRect(1, 6 - marchLeg, 2, 2);

      // Torso / Habit coat
      ctx.fillStyle = faction.color;
      ctx.fillRect(-4, -5, 8, 8);
      ctx.strokeStyle = '#1e1b18';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-4, -5, 8, 8);

      // White leather crossbelts ('X' on chest)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -5);
      ctx.lineTo(4, 3);
      ctx.moveTo(4, -5);
      ctx.lineTo(-4, 3);
      ctx.stroke();

      // Head
      ctx.fillStyle = '#f5d0b0';
      ctx.beginPath();
      ctx.arc(0, -7, 3, 0, Math.PI * 2);
      ctx.fill();

      // Napoleonic Shako Hat
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-3.5, -13, 7, 6);
      // Brass Shako plate & chin scale
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(-1.5, -10, 3, 2);
      // Colored Pompom on Shako
      ctx.fillStyle = faction.goldColor;
      ctx.beginPath();
      ctx.arc(0, -14, 2, 0, Math.PI * 2);
      ctx.fill();

      // Flintlock Musket with Fixed Bayonet
      ctx.fillStyle = '#5a3d28'; // Walnut stock
      ctx.fillRect(3, -9, 2, 14);
      ctx.fillStyle = '#94a3b8'; // Steel barrel
      ctx.fillRect(3.5, -14, 1.2, 7);
      // Bayonet
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(4, -14);
      ctx.lineTo(4.5, -19);
      ctx.lineTo(5, -14);
      ctx.closePath();
      ctx.fill();
    }
    // 2. Winged Cuirassier & Grand Hussar (Cavalry)
    else if (unit.type === 'horse') {
      const gallop = isMoving ? Math.sin(time * 18) * 3 : 0;
      ctx.translate(0, gallop);

      // Warhorse Body (Rich chestnut brown)
      ctx.fillStyle = '#633919';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Horse Head & Neck
      ctx.beginPath();
      ctx.ellipse(11, -5, 6, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Horse Mane & Tail
      ctx.fillStyle = '#2b1708';
      ctx.fillRect(-14, -2, 5, 2); // Tail
      ctx.fillRect(8, -8, 2, 5); // Mane

      // Faction Imperial Saddlecloth (Schabracke)
      ctx.fillStyle = faction.color;
      ctx.fillRect(-7, -4, 12, 8);
      ctx.strokeStyle = faction.goldColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, -4, 12, 8);

      // Rider: Steel Cuirass (Breastplate)
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(0, -7, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Crested Brass Dragoon Helmet with Horsehair Plume
      ctx.fillStyle = '#d4af37';
      ctx.beginPath();
      ctx.arc(1, -12, 4, 0, Math.PI * 2);
      ctx.fill();
      // Flowing horsehair plume
      ctx.strokeStyle = faction.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(1, -14);
      ctx.quadraticCurveTo(-4, -18, -8, -14);
      ctx.stroke();

      // Drawn Cavalry Sabre / Lance
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(2, -7);
      ctx.lineTo(16, -12);
      ctx.stroke();
    }
    // 3. Grand Battery 12-Pounder Gilded Cannon
    else if (unit.type === 'cannon') {
      // Twin Wooden Spoked Wheels
      ctx.fillStyle = '#5c4028';
      ctx.beginPath();
      ctx.arc(-7, 6, 7, 0, Math.PI * 2);
      ctx.arc(7, 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2d1f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Iron Rims
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-7, 6, 7, 0, Math.PI * 2);
      ctx.arc(7, 6, 7, 0, Math.PI * 2);
      ctx.stroke();

      // Heavy Carriage Wooden Trail
      ctx.fillStyle = '#785536';
      ctx.fillRect(-5, 0, 10, 8);

      // Cast Brass/Bronze Cannon Barrel with Cascabel & Muzzle Band
      const barrelGrad = ctx.createLinearGradient(-4, -16, 4, 10);
      barrelGrad.addColorStop(0, '#eab308');
      barrelGrad.addColorStop(0.5, '#ca8a04');
      barrelGrad.addColorStop(1, '#713f12');

      ctx.fillStyle = barrelGrad;
      ctx.beginPath();
      ctx.moveTo(-4, -14);
      ctx.lineTo(4, -14);
      ctx.lineTo(3, 8);
      ctx.lineTo(-3, 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Cascabel knob at rear
      ctx.fillStyle = '#ca8a04';
      ctx.beginPath();
      ctx.arc(0, 9, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Faction Regimental Ribbon
      ctx.fillStyle = faction.color;
      ctx.fillRect(-4, -2, 8, 3);
    }
    // 4. Wooden Decoy Scarecrow
    else if (unit.type === 'dummy') {
      // Wooden stand base
      ctx.fillStyle = '#60432c';
      ctx.fillRect(-6, 4, 12, 3);
      ctx.fillRect(-1.5, -10, 3, 16);

      // Crossed Straw Dummy Arms
      ctx.fillStyle = '#d4b483';
      ctx.fillRect(-8, -5, 16, 3);

      // Oversized Old Uniform Coat
      ctx.fillStyle = faction.color;
      ctx.fillRect(-6, -6, 12, 10);

      // Funny Straw Hat with Faction Cockade
      ctx.fillStyle = '#262626';
      ctx.fillRect(-6, -14, 12, 5);
      ctx.fillStyle = faction.goldColor;
      ctx.beginPath();
      ctx.arc(0, -15, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Health Bar (Antique Parchment style with green fill)
    if (unit.hp < unit.stats.hp) {
      const hpW = unit.radius * 2.4;
      const hpH = 3.5;
      const hpY = -unit.radius - 8;
      const hpRatio = Math.max(0, unit.hp / unit.stats.hp);

      ctx.fillStyle = 'rgba(26, 20, 16, 0.75)';
      ctx.fillRect(-hpW / 2, hpY, hpW, hpH);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-hpW / 2, hpY, hpW, hpH);

      ctx.fillStyle = hpRatio > 0.4 ? '#10b981' : '#ef4444';
      ctx.fillRect(-hpW / 2 + 0.5, hpY + 0.5, (hpW - 1) * hpRatio, hpH - 1);
    }

    // Buff Laurel Halo
    if (unit.buffTimer > 0) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, unit.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Blitz Flaming Charge Trail
    if (unit.blitzTimer > 0) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, unit.radius + 7, 0, Math.PI * 2);
      ctx.stroke();

      // Motion speed spark
      ctx.fillStyle = '#fde047';
      const sparkX = (Math.random() - 0.5) * 12;
      const sparkY = (Math.random() - 0.5) * 12;
      ctx.fillRect(sparkX, sparkY, 2, 2);
    }

    ctx.restore();
  }

  private drawRegimentalBanner(pos: Vec2, timer: number, factionId: number, time: number) {
    const ctx = this.ctx;
    const faction = FACTIONS[factionId];

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Golden Imperial Halo Aura on Ground
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.strokeStyle = faction.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = faction.color + '12';
    ctx.fill();

    // Ornate Golden Eagle Standard Pole
    ctx.strokeStyle = '#5c3a16';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -52);
    ctx.stroke();

    // Golden Imperial Eagle finial
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(0, -54, 5, 0, Math.PI * 2);
    ctx.fill();

    // Large Embroidered Silk Regimental Flag
    const wave = Math.sin(time * 5) * 6;
    ctx.fillStyle = faction.color;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.bezierCurveTo(15, -54 + wave, 28, -48 - wave, 38, -50 + wave * 0.5);
    ctx.lineTo(34, -28 + wave * 0.5);
    ctx.bezierCurveTo(24, -26 - wave, 12, -32 + wave, 0, -30);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = faction.goldColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Emblem in center
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.fillText(faction.emblem, 18, -38 + wave * 0.3);

    // Timer badge in antique serif
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(-14, 8, 28, 14);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1;
    ctx.strokeRect(-14, 8, 28, 14);

    ctx.fillStyle = '#fffdf5';
    ctx.font = 'bold 11px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(timer)}s`, 0, 19);

    ctx.restore();
  }

  private drawOverdriveField(ov: { pos: Vec2; factionId: number }, time: number) {
    const ctx = this.ctx;
    const faction = FACTIONS[ov.factionId];
    ctx.save();
    ctx.translate(ov.pos.x, ov.pos.y);

    // Clockwork Arcane Rings
    ctx.strokeStyle = faction.goldColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rotating alchemical gear teeth
    ctx.save();
    ctx.rotate(time * 0.5);
    for (let i = 0; i < 12; i++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.fillStyle = faction.goldColor + '40';
      ctx.fillRect(146, -4, 8, 8);
    }
    ctx.restore();

    ctx.fillStyle = faction.goldColor;
    ctx.font = 'bold 11px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('OVERDRIVE', 0, -160);
    ctx.restore();
  }

  private drawShieldDome(sh: { pos: Vec2; radius: number; factionId: number }, time: number) {
    const ctx = this.ctx;
    const faction = FACTIONS[sh.factionId];
    ctx.save();
    ctx.translate(sh.pos.x, sh.pos.y);

    // Arcane Hexagonal Phalanx Shield Barrier
    ctx.fillStyle = faction.color + '22';
    ctx.beginPath();
    ctx.arc(0, 0, sh.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Hexagonal lattice pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, sh.radius - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  private drawProjectile(proj: Projectile, time: number) {
    const ctx = this.ctx;
    ctx.save();

    if (proj.type === 'cannon') {
      // Heavy Cast-Iron Cannonball with burning ember sparks
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(proj.pos.x + 3, proj.pos.y + 3, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(proj.pos.x, proj.pos.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Fiery trailing fuse spark
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(proj.pos.x - proj.vel.x * 0.5, proj.pos.y - proj.vel.y * 0.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Musket Lead Ball with tracer glow
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(proj.pos.x, proj.pos.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawCartographicFrame(time: number) {
    const ctx = this.ctx;
    const mapW = this.engine.width;
    const mapH = this.engine.height;

    ctx.save();
    // Outer Antique Mahogany & Gilded Brass Frame
    ctx.strokeStyle = '#3d2b1f';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, mapW - 14, mapH - 14);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(14, 14, mapW - 28, mapH - 28);

    // Inner hairline ruler with tick marks
    ctx.strokeStyle = 'rgba(180, 140, 60, 0.7)';
    ctx.lineWidth = 1;
    for (let x = 40; x < mapW - 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, 20);
      ctx.moveTo(x, mapH - 14);
      ctx.lineTo(x, mapH - 20);
      ctx.stroke();
    }
    for (let y = 40; y < mapH - 40; y += 40) {
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.lineTo(20, y);
      ctx.moveTo(mapW - 14, y);
      ctx.lineTo(mapW - 20, y);
      ctx.stroke();
    }

    // Four Gilded Corner Brackets with Fleur-de-lis
    const corners = [
      { x: 22, y: 22 },
      { x: mapW - 22, y: 22 },
      { x: 22, y: mapH - 22 },
      { x: mapW - 22, y: mapH - 22 }
    ];

    for (const c of corners) {
      ctx.fillStyle = '#d4af37';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6e541b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }
}
