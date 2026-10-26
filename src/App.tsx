import confetti from 'canvas-confetti';
import React, { useEffect, useRef, useState } from 'react';
import { sound } from './audio';
import { FACTION_HOTKEY_LABELS, FACTIONS, MAP_CONFIGS, SKILLS } from './game/constants';
import { GameEngine } from './game/engine';
import { GameRenderer } from './game/renderer';
import {
  closeRoom,
  createLobbyRoom,
  joinLobbyRoom,
  launchRoomGame,
  leaveLobbyRoom,
  LobbyRoom,
  sendNetGameState,
  sendNetPlayerInput,
  subscribeToPublicRooms,
  subscribeToRoom,
  updateRoomMapSize,
  updateSlotConfig
} from './lobbyService';
import { MapSizeKey, PlayerSetup, SkillKey } from './types';

interface CommanderCooldownState {
  factionId: number;
  skill1: SkillKey;
  skill2: SkillKey;
  cd1: number;
  maxCd1: number;
  cd2: number;
  maxCd2: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  // General App Modes
  const [lobbyMode, setLobbyMode] = useState<'local' | 'online'>('local');
  const [inGame, setInGame] = useState(false);
  const [selectedMap, setSelectedMap] = useState<MapSizeKey>('small');
  const [musicOn, setMusicOn] = useState(true);
  const [editingFaction, setEditingFaction] = useState<number | null>(null);
  const [winnerFactionId, setWinnerFactionId] = useState<number | null | 'draw'>(null);
  const [startButtonText, setStartButtonText] = useState('Start Game');

  // Cooldown bar state for active local player(s)
  const [cooldowns, setCooldowns] = useState<CommanderCooldownState[]>([]);

  // Local Player Configs
  const [playerConfigs, setPlayerConfigs] = useState<PlayerSetup[]>([
    { type: 'human', skills: ['rally', 'banner'] },
    { type: 'ai', skills: ['rally', 'banner'] },
    { type: 'none', skills: ['rally', 'banner'] },
    { type: 'none', skills: ['rally', 'banner'] }
  ]);

  // Online Multiplayer State
  const [playerId] = useState(() => {
    const saved = localStorage.getItem('cc_player_id');
    if (saved) return saved;
    const newId = 'usr_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('cc_player_id', newId);
    return newId;
  });
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('cc_player_name') || 'Commander ' + Math.floor(Math.random() * 900 + 100);
  });
  const [onlineRooms, setOnlineRooms] = useState<LobbyRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<LobbyRoom | null>(null);
  const currentRoomRef = useRef<LobbyRoom | null>(null);
  currentRoomRef.current = currentRoom;

  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // HUD stats
  const [hudStats, setHudStats] = useState<Array<{
    id: number;
    name: string;
    color: string;
    goldColor: string;
    emblem: string;
    alive: boolean;
    units: number;
    outposts: number;
    clusters: number;
  }>>([]);

  // Temporary selected skills in modal
  const [tempSelectedSkills, setTempSelectedSkills] = useState<SkillKey[]>(['rally', 'banner']);
  const [skillError, setSkillError] = useState(false);

  // Save Player Name on change
  const handlePlayerNameChange = (val: string) => {
    setPlayerName(val);
    localStorage.setItem('cc_player_name', val);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine();
    const renderer = new GameRenderer(canvas, engine);
    engineRef.current = engine;
    rendererRef.current = renderer;

    renderer.resize();
    const handleResize = () => {
      renderer.resize();
    };
    window.addEventListener('resize', handleResize);

    engine.onEndGame = (winnerId) => {
      setWinnerFactionId(winnerId === null ? 'draw' : winnerId);
      if (winnerId !== null) {
        const winner = engine.players.find((p) => p.id === winnerId);
        if (winner && !winner.isAI) {
          sound.playVictory();
          confetti({
            particleCount: 75,
            spread: 65,
            origin: { y: 0.6 }
          });
        } else {
          sound.playDefeat();
        }
      } else {
        sound.playDefeat();
      }
    };

    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      let dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;
      if (dt > 0.1) dt = 0.1;

      if (engine.active) {
        engine.update(dt);
        renderer.render(currentTime / 1000);

        // Multiplayer real-time state synchronization
        const activeRoom = currentRoomRef.current;
        if (activeRoom && activeRoom.status === 'in_game') {
          const isHost = activeRoom.hostId === playerId;
          if (isHost) {
            engine.tickCount++;
            if (engine.tickCount % 12 === 0) {
              sendNetGameState(activeRoom.id, engine.getNetGameState(engine.tickCount));
            }
            if (activeRoom.playerInputs) {
              Object.values(activeRoom.playerInputs).forEach((inp) => {
                if (inp.playerId !== playerId) {
                  engine.applyNetPlayerInput(inp);
                }
              });
            }
          } else {
            const input = engine.getLocalPlayerInput(playerId);
            if (input) {
              sendNetPlayerInput(activeRoom.id, input);
            }
          }
        }

        // Update HUD snapshot
        const stats = engine.players.map((p) => {
          const faction = FACTIONS[p.id];
          const unitCount = engine.units.filter((u) => u.factionId === p.id).length;
          const outpostCount = engine.outposts.filter((o) => o.owner === p.id).length;
          const isAlive = engine.commanders.some((c) => c.factionId === p.id) || engine.time <= 5;
          const controlledClusters = engine.clusters.filter((c) => c.controllingFaction === p.id).length;
          return {
            id: p.id,
            name: faction.name,
            color: faction.color,
            goldColor: faction.goldColor,
            emblem: faction.emblem,
            alive: isAlive,
            units: unitCount,
            outposts: outpostCount,
            clusters: controlledClusters
          };
        });
        setHudStats(stats);

        // Update real-time cooldown state for human commanders
        const humanCmds = engine.commanders.filter((c) => !c.isAI);
        const cdList: CommanderCooldownState[] = humanCmds.map((c) => ({
          factionId: c.factionId,
          skill1: c.skill1,
          skill2: c.skill2,
          cd1: Math.max(0, c.cooldown1),
          maxCd1: SKILLS[c.skill1].cd,
          cd2: Math.max(0, c.cooldown2),
          maxCd2: SKILLS[c.skill2].cd
        }));
        setCooldowns(cdList);
      } else {
        // Draw Menu Campaign Map Backdrop in Napoleonic Fantasy style
        drawMenuBackdrop(canvas, currentTime / 1000);
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Automatic clean shutdown when window is closed or refreshed
  useEffect(() => {
    const handleUnload = () => {
      if (currentRoomRef.current) {
        leaveLobbyRoom(currentRoomRef.current.id, playerId);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [playerId]);

  // Subscribe to public rooms when in online multiplayer lobby list
  useEffect(() => {
    if (lobbyMode !== 'online' || currentRoom !== null) return;
    const unsubscribe = subscribeToPublicRooms(
      (rooms) => setOnlineRooms(rooms),
      (err) => setLobbyError(err.message)
    );
    return () => unsubscribe();
  }, [lobbyMode, currentRoom]);

  // Subscribe to current room updates
  useEffect(() => {
    if (!currentRoom) return;
    const unsubscribe = subscribeToRoom(
      currentRoom.id,
      (updatedRoom) => {
        if (!updatedRoom) {
          // Game has shut down because all commanders have departed
          setCurrentRoom(null);
          if (engineRef.current) engineRef.current.active = false;
          sound.stopMusic();
          setInGame(false);
          setWinnerFactionId(null);
          setLobbyError('The match has shut down because all commanders have departed.');
          if (rendererRef.current) rendererRef.current.updateCamera();
          return;
        }

        setCurrentRoom(updatedRoom);

        // If host launched the game and we aren't in game yet, launch it!
        if (updatedRoom.status === 'in_game' && !engineRef.current?.active) {
          launchLocalEngineFromRoom(updatedRoom);
        } else if (updatedRoom.status === 'in_game' && engineRef.current?.active) {
          // Non-host players sync from host's authoritative game snapshot!
          if (updatedRoom.hostId !== playerId && updatedRoom.gameState) {
            engineRef.current.applyNetGameState(updatedRoom.gameState);
          }
        }
      },
      (err) => setLobbyError(err.message)
    );

    return () => unsubscribe();
  }, [currentRoom?.id]);

  // Ensure camera updates when game state switches
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateCamera();
    }
  }, [inGame]);

  const drawMenuBackdrop = (canvas: HTMLCanvasElement, time: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    // Deep warm antique mahogany desk
    ctx.fillStyle = '#150f0c';
    ctx.fillRect(0, 0, w, h);

    // Weathered Parchment Map center
    const pad = 32;
    const mapW = w - pad * 2;
    const mapH = h - pad * 2;

    const grad = ctx.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, '#f4ecd8');
    grad.addColorStop(0.7, '#e0cca8');
    grad.addColorStop(1, '#ad9269');
    ctx.fillStyle = grad;
    ctx.fillRect(pad, pad, mapW, mapH);

    // Antique frame
    ctx.strokeStyle = '#382518';
    ctx.lineWidth = 12;
    ctx.strokeRect(pad, pad, mapW, mapH);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad + 8, pad + 8, mapW - 16, mapH - 16);

    // Coordinate grid lines
    ctx.strokeStyle = 'rgba(115, 85, 45, 0.12)';
    ctx.lineWidth = 1;
    for (let x = pad + 80; x < pad + mapW; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + mapH);
      ctx.stroke();
    }
    for (let y = pad + 80; y < pad + mapH; y += 100) {
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + mapW, y);
      ctx.stroke();
    }

    // Four Faction Bastion Nodes on the campaign map
    const nodes = [
      { x: w * 0.28, y: h * 0.35, f: FACTIONS[0] },
      { x: w * 0.72, y: h * 0.65, f: FACTIONS[1] },
      { x: w * 0.68, y: h * 0.3, f: FACTIONS[2] },
      { x: w * 0.32, y: h * 0.72, f: FACTIONS[3] }
    ];

    // Marching dashed lines
    ctx.strokeStyle = 'rgba(120, 80, 30, 0.22)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    ctx.lineTo(nodes[2].x, nodes[2].y);
    ctx.lineTo(nodes[1].x, nodes[1].y);
    ctx.lineTo(nodes[3].x, nodes[3].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Nodes
    nodes.forEach((node, i) => {
      const pulse = Math.sin(time * 2 + i) * 3 + 12;

      ctx.fillStyle = node.f.color + '22';
      ctx.beginPath();
      ctx.arc(node.x, node.y, pulse * 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#6e563d';
      ctx.beginPath();
      ctx.arc(node.x, node.y, pulse + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = node.f.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '12px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.f.emblem, node.x, node.y);

      ctx.fillStyle = '#422c15';
      ctx.font = 'bold 11px Cinzel, Georgia, serif';
      ctx.fillText(node.f.name, node.x, node.y + pulse + 14);
    });

    // Drifting black powder smoke clouds
    ctx.fillStyle = 'rgba(235, 222, 195, 0.3)';
    for (let p = 0; p < 16; p++) {
      const px = ((p * 180 + time * 14 * ((p % 3) + 1)) % mapW) + pad;
      const py = ((p * 230 - time * 9 * ((p % 2) + 1)) % mapH) + pad;
      const pr = 18 + Math.sin(time + p) * 6;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const handleStartGame = async () => {
    const activeCount = playerConfigs.filter((p) => p.type !== 'none').length;
    if (activeCount < 2) {
      setStartButtonText('Need 2+ Players!');
      setTimeout(() => setStartButtonText('Start Game'), 1500);
      return;
    }

    if (musicOn) {
      await sound.init();
      sound.playMusic();
    }

    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer) return;

    engine.start(selectedMap, playerConfigs);
    renderer.generateTerrainDecorations();

    // Scale UI and camera so the entire map is completely visible!
    renderer.updateCamera();

    setWinnerFactionId(null);
    setInGame(true);
  };

  const launchLocalEngineFromRoom = async (room: LobbyRoom) => {
    if (musicOn) {
      await sound.init();
      sound.playMusic();
    }

    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer) return;

    // Find which faction belongs to this client and if host
    const mySlotIndex = room.slots.findIndex((s) => s.playerId === playerId);
    const myFactionId = mySlotIndex !== -1 ? room.slots[mySlotIndex].factionId : 0;
    const isHost = room.hostId === playerId;

    // Convert room slots to game player configs
    const configs: PlayerSetup[] = room.slots.map((s) => ({
      type: s.type,
      skills: s.skills
    }));

    // Start with identical mapData seed, outposts, and topology
    engine.start(room.mapSize, configs, room.mapData, myFactionId, true, isHost);
    renderer.generateTerrainDecorations(room.mapData?.seed);
    renderer.updateCamera();

    setWinnerFactionId(null);
    setInGame(true);
  };

  const handleEndGame = async () => {
    const engine = engineRef.current;
    if (engine) engine.active = false;
    sound.stopMusic();
    setInGame(false);
    setWinnerFactionId(null);

    if (currentRoomRef.current) {
      const rid = currentRoomRef.current.id;
      setCurrentRoom(null);
      await leaveLobbyRoom(rid, playerId);
    }

    if (rendererRef.current) {
      rendererRef.current.updateCamera();
    }
  };

  const handleToggleMusic = async () => {
    const state = await sound.toggleMusic();
    setMusicOn(state);
  };

  // Open skill selection for a faction
  const openSkillsModal = (factionIdx: number) => {
    setEditingFaction(factionIdx);
    if (currentRoom) {
      setTempSelectedSkills([...currentRoom.slots[factionIdx].skills]);
    } else {
      setTempSelectedSkills([...playerConfigs[factionIdx].skills]);
    }
    setSkillError(false);
  };

  const toggleModalSkill = (skillKey: SkillKey) => {
    if (tempSelectedSkills.includes(skillKey)) {
      setTempSelectedSkills(tempSelectedSkills.filter((s) => s !== skillKey));
    } else {
      if (tempSelectedSkills.length < 2) {
        setTempSelectedSkills([...tempSelectedSkills, skillKey]);
      } else {
        setTempSelectedSkills([tempSelectedSkills[1], skillKey]);
      }
    }
  };

  const saveModalSkills = async () => {
    if (editingFaction === null) return;
    if (tempSelectedSkills.length !== 2) {
      setSkillError(true);
      return;
    }

    const chosen: [SkillKey, SkillKey] = [tempSelectedSkills[0], tempSelectedSkills[1]];

    if (currentRoom) {
      await updateSlotConfig(currentRoom.id, editingFaction, { skills: chosen });
    } else {
      const updated = [...playerConfigs];
      updated[editingFaction] = {
        ...updated[editingFaction],
        skills: chosen
      };
      setPlayerConfigs(updated);
    }

    setEditingFaction(null);
  };

  // Multiplayer Room Handlers
  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    setLobbyError(null);
    try {
      const room = await createLobbyRoom(playerId, playerName, selectedMap);
      setCurrentRoom(room);
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to create room.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinByCode = async () => {
    if (!roomCodeInput.trim()) return;
    setLobbyError(null);
    try {
      const code = roomCodeInput.trim().toUpperCase();
      const room = await joinLobbyRoom(code, playerId, playerName);
      if (!room) {
        setLobbyError('Room not found. Check the code and try again.');
        return;
      }
      setCurrentRoom(room);
      setRoomCodeInput('');
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to join room.');
    }
  };

  const handleJoinDirect = async (roomId: string) => {
    setLobbyError(null);
    try {
      const room = await joinLobbyRoom(roomId, playerId, playerName);
      if (room) setCurrentRoom(room);
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to join room.');
    }
  };

  const handleLeaveRoom = async () => {
    if (!currentRoom) return;
    await leaveLobbyRoom(currentRoom.id, playerId);
    setCurrentRoom(null);
  };

  const handleLaunchMultiplayer = async () => {
    if (!currentRoom) return;
    try {
      await launchRoomGame(currentRoom.id);
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to launch battle.');
    }
  };

  const handleTakeSlot = async (slotIdx: number) => {
    if (!currentRoom) return;
    // Remove self from any other slot first
    const updatedSlots = currentRoom.slots.map((s, idx) => {
      if (idx === slotIdx) {
        return {
          ...s,
          playerId,
          playerName,
          type: 'human' as const,
          ready: false
        };
      } else if (s.playerId === playerId) {
        return {
          ...s,
          playerId: null,
          playerName: 'Open Slot',
          type: 'ai' as const,
          ready: false
        };
      }
      return s;
    });

    try {
      await updateSlotConfig(currentRoom.id, slotIdx, {
        playerId,
        playerName,
        type: 'human',
        ready: false
      });
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to take slot.');
    }
  };

  const handleToggleReady = async (slotIdx: number) => {
    if (!currentRoom) return;
    const currentReady = currentRoom.slots[slotIdx].ready;
    await updateSlotConfig(currentRoom.id, slotIdx, { ready: !currentReady });
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-[#120f0d] text-white font-sans">
      {/* Game Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

      {/* Main Menu & Lobby Screen */}
      {!inGame && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-3 sm:p-4 pointer-events-none">
          <div className="pointer-events-auto parchment-panel p-5 sm:p-7 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col gap-4 border border-[#d4af37]/35 max-h-[92vh] overflow-y-auto">
            {/* Title & Subtitle */}
            <div className="text-center">
              <h1 className="text-3xl sm:text-4xl font-cinzel-dec font-extrabold gold-gradient-text mb-1">
                Commander Conquest
              </h1>
              <p className="text-[#c9b79c] text-xs sm:text-sm font-crimson italic">
                Lead your units, capture outposts, and dominate the map!
              </p>
            </div>

            {/* Mode Tabs: Local Play vs Online Multiplayer */}
            <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-700">
              <button
                onClick={() => {
                  setLobbyMode('local');
                  setCurrentRoom(null);
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs sm:text-sm font-bold font-cinzel transition-all cursor-pointer ${
                  lobbyMode === 'local'
                    ? 'bg-gradient-to-r from-blue-700 to-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Local Play / Solo
              </button>
              <button
                onClick={() => setLobbyMode('online')}
                className={`flex-1 py-1.5 rounded-lg text-xs sm:text-sm font-bold font-cinzel transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  lobbyMode === 'online'
                    ? 'bg-gradient-to-r from-amber-600 to-amber-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Multiplayer Lobby</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </button>
            </div>

            {/* =========================================
                LOCAL PLAY / SOLO MODE
               ========================================= */}
            {lobbyMode === 'local' && (
              <div className="flex flex-col gap-3">
                {/* Map Size Selector */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-300 font-cinzel">
                    Map Size
                  </label>
                  <div className="flex gap-2">
                    {(['small', 'medium', 'large'] as MapSizeKey[]).map((size) => (
                      <button
                        key={size}
                        onClick={() => setSelectedMap(size)}
                        className={`flex-1 py-1.5 rounded text-xs font-bold font-cinzel transition-all cursor-pointer ${
                          selectedMap === size
                            ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.5)] border border-blue-400'
                            : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {size.charAt(0).toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Players Section with Explicit Skills & Hotkeys */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300 font-cinzel">
                      Players & Equipped Skills
                    </label>
                    <span className="text-[10px] text-amber-300/80">Click skills to customize</span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {FACTIONS.map((faction, idx) => {
                      const setup = playerConfigs[idx];
                      const isHuman = setup.type === 'human';
                      const isAI = setup.type === 'ai';
                      const hotkey = FACTION_HOTKEY_LABELS[idx];
                      const s1 = SKILLS[setup.skills[0]];
                      const s2 = SKILLS[setup.skills[1]];

                      return (
                        <div
                          key={faction.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-900/85 border border-slate-700/80 p-2 sm:p-2.5 rounded-lg gap-2"
                        >
                          {/* Faction Header */}
                          <div className="flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                              style={{ backgroundColor: faction.color }}
                            />
                            <div className="flex flex-col">
                              <span className="text-xs font-bold font-cinzel" style={{ color: faction.color }}>
                                {faction.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Move: <b className="text-slate-200">{hotkey.move}</b>
                              </span>
                            </div>
                          </div>

                          {/* Equipped Skills + Hotkeys (Very Clear Display) */}
                          <div className="flex items-center gap-1.5 flex-wrap flex-1 sm:justify-center">
                            {isHuman ? (
                              <button
                                onClick={() => openSkillsModal(idx)}
                                className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-600 rounded px-2 py-1 transition-colors cursor-pointer group text-left"
                                title="Click to customize skills"
                              >
                                <div className="flex items-center gap-1">
                                  <kbd className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 font-mono font-bold text-[10px] border border-amber-400/40">
                                    {hotkey.abil1}
                                  </kbd>
                                  <span className="text-xs font-medium text-slate-200 group-hover:text-amber-200">
                                    {s1.name}
                                  </span>
                                </div>
                                <span className="text-slate-500 text-[10px]">·</span>
                                <div className="flex items-center gap-1">
                                  <kbd className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 font-mono font-bold text-[10px] border border-amber-400/40">
                                    {hotkey.abil2}
                                  </kbd>
                                  <span className="text-xs font-medium text-slate-200 group-hover:text-amber-200">
                                    {s2.name}
                                  </span>
                                </div>
                              </button>
                            ) : isAI ? (
                              <span className="text-[11px] text-slate-400 italic bg-slate-800/40 px-2 py-1 rounded">
                                [Random Skills]
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 italic px-2 py-1">
                                [Slot Inactive]
                              </span>
                            )}
                          </div>

                          {/* Player Type Selector */}
                          <select
                            value={setup.type}
                            onChange={(e) => {
                              const updated = [...playerConfigs];
                              updated[idx] = { ...updated[idx], type: e.target.value as any };
                              setPlayerConfigs(updated);
                            }}
                            className="bg-slate-950 border border-slate-700 rounded text-xs p-1.5 text-white focus:outline-none focus:border-blue-500 cursor-pointer self-end sm:self-center"
                          >
                            <option value="human">Human</option>
                            <option value="ai">AI</option>
                            <option value="none">None</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Controls Box */}
                <div className="text-[11px] text-slate-300 bg-slate-900/80 border border-slate-700/60 p-2.5 rounded font-mono leading-relaxed">
                  <b className="text-white">Controls (Move | Abilities):</b>
                  <br />
                  Player 1 (Red): W A S D | Q (Rally), E (Drop Banner)
                  <br />
                  Player 2 (Blue): Arrow Keys | Comma (,), Period (.)
                  <br />
                  Player 3 (Green): I J K L | U, O
                  <br />
                  Player 4 (Yellow): Numpad 8 4 5 6 | Numpad 7, Numpad 9
                </div>

                {/* Menu Buttons */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleToggleMusic}
                    className="w-1/3 py-3 rounded-xl font-bold text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                  >
                    {musicOn ? '🎵 Music: ON' : '🔇 Music: OFF'}
                  </button>
                  <button
                    onClick={handleStartGame}
                    className="w-2/3 py-3 rounded-xl font-bold text-base sm:text-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all transform hover:scale-[1.02] cursor-pointer"
                  >
                    {startButtonText}
                  </button>
                </div>
              </div>
            )}

            {/* =========================================
                ONLINE MULTIPLAYER MODE (FIREBASE)
               ========================================= */}
            {lobbyMode === 'online' && !currentRoom && (
              <div className="flex flex-col gap-3">
                {/* Player Profile Name */}
                <div className="flex items-center gap-2 bg-slate-900/80 p-2.5 rounded-lg border border-slate-700">
                  <label className="text-xs font-cinzel text-slate-300 font-bold shrink-0">
                    Your Name:
                  </label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => handlePlayerNameChange(e.target.value)}
                    maxLength={32}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                    placeholder="Enter your name"
                  />
                </div>

                {/* Lobby Actions: Create Room or Join by Code */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={handleCreateRoom}
                    disabled={isCreatingRoom}
                    className="py-2.5 rounded-lg font-cinzel font-bold text-xs bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-md cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isCreatingRoom ? 'Creating Room...' : '+ Create New Lobby'}
                  </button>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                      placeholder="Room Code (e.g. AB-1234)"
                      maxLength={10}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white font-mono uppercase focus:outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={handleJoinByCode}
                      className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold font-cinzel rounded cursor-pointer"
                    >
                      Join
                    </button>
                  </div>
                </div>

                {lobbyError && (
                  <div className="text-xs text-red-400 bg-red-950/60 p-2 rounded border border-red-800">
                    {lobbyError}
                  </div>
                )}

                {/* Public Lobbies Browser (Live Firestore Sync) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-cinzel">
                    <span>Public Lobbies ({onlineRooms.length})</span>
                    <span className="text-[10px] text-amber-300">Live Real-time</span>
                  </div>

                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {onlineRooms.length === 0 ? (
                      <div className="text-xs text-slate-500 italic text-center py-6 bg-slate-900/40 rounded border border-slate-800">
                        No active lobbies right now. Click "Create New Lobby" to host one!
                      </div>
                    ) : (
                      onlineRooms.map((r) => {
                        const humanCount = r.slots.filter((s) => s.type === 'human').length;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between bg-slate-900/80 border border-slate-700/70 p-2 rounded-lg hover:border-slate-500 transition-colors"
                          >
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-amber-200 font-cinzel">
                                {r.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Host: <b className="text-slate-300">{r.hostName}</b> · Map:{' '}
                                <b className="capitalize text-slate-300">{r.mapSize}</b> · Players:{' '}
                                <b className="text-emerald-400">{humanCount}/4</b>
                              </span>
                            </div>

                            <button
                              onClick={() => handleJoinDirect(r.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded cursor-pointer"
                            >
                              Join
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* =========================================
                INSIDE A MULTIPLAYER ROOM LOBBY
               ========================================= */}
            {lobbyMode === 'online' && currentRoom && (
              <div className="flex flex-col gap-3">
                {/* Room Details Bar */}
                <div className="flex items-center justify-between bg-slate-900/90 p-2.5 rounded-lg border border-slate-700">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-400">Room Code:</span>
                    <span className="text-sm font-mono font-bold text-amber-300 tracking-wider">
                      {currentRoom.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Map:</span>
                    {currentRoom.hostId === playerId ? (
                      <select
                        value={currentRoom.mapSize}
                        onChange={(e) => updateRoomMapSize(currentRoom.id, e.target.value as MapSizeKey)}
                        className="bg-slate-950 border border-slate-700 rounded text-xs px-2 py-1 text-white cursor-pointer"
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    ) : (
                      <span className="text-xs font-bold uppercase text-white bg-slate-800 px-2 py-1 rounded">
                        {currentRoom.mapSize}
                      </span>
                    )}
                  </div>
                </div>

                {/* 4 Faction Slots inside Room */}
                <div className="flex flex-col gap-2">
                  {currentRoom.slots.map((slot, idx) => {
                    const faction = FACTIONS[slot.factionId];
                    const hotkey = FACTION_HOTKEY_LABELS[slot.factionId];
                    const isMySlot = slot.playerId === playerId;
                    const isHost = currentRoom.hostId === playerId;
                    const s1 = SKILLS[slot.skills[0]];
                    const s2 = SKILLS[slot.skills[1]];

                    return (
                      <div
                        key={faction.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-lg border gap-2 transition-all ${
                          isMySlot
                            ? 'bg-slate-900/95 border-amber-500/70 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                            : 'bg-slate-900/75 border-slate-700'
                        }`}
                      >
                        {/* Faction & Player Info */}
                        <div className="flex items-center gap-2 min-w-[130px]">
                          <div
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: faction.color }}
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold font-cinzel" style={{ color: faction.color }}>
                              {faction.name}
                            </span>
                            <span className="text-[11px] text-slate-300">
                              {slot.playerId ? (
                                <b>{slot.playerName} {isMySlot ? '(You)' : ''}</b>
                              ) : slot.type === 'ai' ? (
                                <span className="text-slate-400">AI Bot</span>
                              ) : (
                                <span className="text-slate-500 italic">Open Slot</span>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* Equipped Skills + Hotkeys */}
                        <div className="flex items-center gap-1.5 flex-wrap flex-1 sm:justify-center">
                          {slot.type === 'human' ? (
                            <button
                              onClick={() => isMySlot && openSkillsModal(idx)}
                              disabled={!isMySlot}
                              className={`flex items-center gap-1.5 bg-slate-800/90 border border-slate-600 rounded px-2 py-1 text-left ${
                                isMySlot ? 'cursor-pointer hover:bg-slate-700 hover:border-amber-400' : 'cursor-default'
                              }`}
                              title={isMySlot ? 'Click to customize skills' : ''}
                            >
                              <div className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 font-mono font-bold text-[10px] border border-amber-400/40">
                                  {hotkey.abil1}
                                </kbd>
                                <span className="text-xs text-slate-200">{s1.name}</span>
                              </div>
                              <span className="text-slate-500 text-[10px]">·</span>
                              <div className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 font-mono font-bold text-[10px] border border-amber-400/40">
                                  {hotkey.abil2}
                                </kbd>
                                <span className="text-xs text-slate-200">{s2.name}</span>
                              </div>
                            </button>
                          ) : slot.type === 'ai' ? (
                            <span className="text-[10px] text-slate-400 italic">[Random Skills]</span>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">[Empty]</span>
                          )}
                        </div>

                        {/* Slot Actions */}
                        <div className="flex items-center gap-1.5 self-end sm:self-center">
                          {/* If slot is unassigned, allow take slot */}
                          {!slot.playerId && (
                            <button
                              onClick={() => handleTakeSlot(idx)}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded cursor-pointer"
                            >
                              Take Slot
                            </button>
                          )}

                          {/* Host can toggle empty slots between AI / None */}
                          {isHost && !slot.playerId && (
                            <select
                              value={slot.type}
                              onChange={(e) =>
                                updateSlotConfig(currentRoom.id, idx, {
                                  type: e.target.value as any
                                })
                              }
                              className="bg-slate-950 border border-slate-700 rounded text-xs p-1 text-white cursor-pointer"
                            >
                              <option value="ai">AI</option>
                              <option value="none">None</option>
                            </select>
                          )}

                          {/* Ready Button for Humans */}
                          {slot.type === 'human' && (
                            <button
                              onClick={() => isMySlot && handleToggleReady(idx)}
                              disabled={!isMySlot}
                              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                                slot.ready
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-700 text-slate-300'
                              } ${isMySlot ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                            >
                              {slot.ready ? '✓ Ready' : 'Not Ready'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Room Controls (Leave / Launch) */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleLeaveRoom}
                    className="w-1/3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold font-cinzel rounded-xl border border-slate-700 cursor-pointer"
                  >
                    Leave Lobby
                  </button>

                  {currentRoom.hostId === playerId ? (
                    <button
                      onClick={handleLaunchMultiplayer}
                      className="w-2/3 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold text-sm font-cinzel rounded-xl shadow-lg cursor-pointer"
                    >
                      ⚔️ Launch Battle
                    </button>
                  ) : (
                    <div className="w-2/3 py-2.5 bg-slate-800/80 text-amber-300 text-xs text-center font-bold font-cinzel rounded-xl border border-amber-500/30 flex items-center justify-center">
                      Waiting for Host to launch...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================
          IN-GAME HUD & COMMAND ACTION BAR
         ========================================= */}
      {inGame && (
        <>
          {/* Top Regiment Badges & Controls */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between pointer-events-none items-start">
            <div className="flex gap-2.5 flex-wrap">
              {hudStats.map((p) => (
                <div
                  key={p.id}
                  className={`glass-panel px-3.5 py-1.5 rounded-lg flex items-center gap-2.5 transition-opacity ${
                    !p.alive ? 'opacity-30' : ''
                  }`}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_currentColor]"
                    style={{ backgroundColor: p.color, color: p.color }}
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-bold" style={{ color: p.color }}>
                      {p.name} {!p.alive ? '(DEFEATED)' : ''}
                    </span>
                    <span className="text-xs text-slate-300">
                      Units: {p.units} | Outposts: {p.outposts}
                      {p.clusters > 0 && (
                        <span className="text-amber-400 font-bold ml-1">
                          · ⚡{p.clusters} Cluster (+1.5x)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              {currentRoom && (
                <div className="glass-panel px-3 py-1.5 rounded-lg flex items-center gap-2 border border-amber-400/40 shadow-lg">
                  <div
                    className="w-3.5 h-3.5 rounded-full ring-1 ring-white/50"
                    style={{ backgroundColor: FACTIONS[engineRef.current?.myFactionId ?? 0].color }}
                  />
                  <span className="text-xs font-bold text-white hidden sm:inline">
                    You:{' '}
                    <b style={{ color: FACTIONS[engineRef.current?.myFactionId ?? 0].color }}>
                      {FACTIONS[engineRef.current?.myFactionId ?? 0].name}
                    </b>
                  </span>
                  {currentRoom.hostId === playerId ? (
                    <span className="px-1.5 py-0.5 bg-amber-600/80 rounded text-[10px] text-white font-mono font-bold">
                      HOST
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-blue-600/80 rounded text-[10px] text-white font-mono font-bold">
                      GUEST
                    </span>
                  )}
                </div>
              )}
              <button
                onClick={handleToggleMusic}
                className="px-3.5 py-1.5 bg-slate-700/80 hover:bg-slate-600 rounded text-xs sm:text-sm font-bold backdrop-blur cursor-pointer text-white"
              >
                {musicOn ? '🎵 ON' : '🔇 OFF'}
              </button>
              <button
                onClick={handleEndGame}
                className="px-3.5 py-1.5 bg-red-600/80 hover:bg-red-500 rounded text-xs sm:text-sm font-bold backdrop-blur cursor-pointer text-white"
              >
                {currentRoom ? 'Leave Battle' : 'End Game'}
              </button>
            </div>
          </div>

          {/* DEDICATED IN-GAME COMMAND ACTION BAR (CRYSTAL CLEAR COOLDOWNS FOR ALL SCREEN SIZES) */}
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-3 bg-slate-950/90 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-slate-700/80 shadow-2xl max-w-full">
            {cooldowns.map((cdInfo) => {
              const faction = FACTIONS[cdInfo.factionId];
              const hotkeys = FACTION_HOTKEY_LABELS[cdInfo.factionId];
              const s1 = SKILLS[cdInfo.skill1];
              const s2 = SKILLS[cdInfo.skill2];
              const isReady1 = cdInfo.cd1 <= 0;
              const isReady2 = cdInfo.cd2 <= 0;
              const p1Ratio = Math.max(0, Math.min(1, cdInfo.cd1 / cdInfo.maxCd1));
              const p2Ratio = Math.max(0, Math.min(1, cdInfo.cd2 / cdInfo.maxCd2));

              return (
                <div key={cdInfo.factionId} className="flex items-center gap-3">
                  {/* Faction Indicator */}
                  <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700">
                    <div
                      className="w-3.5 h-3.5 rounded-full"
                      style={{ backgroundColor: faction.color }}
                    />
                    <span className="text-xs font-cinzel font-bold hidden sm:inline" style={{ color: faction.color }}>
                      {faction.name}
                    </span>
                  </div>

                  {/* Skill 1 Box */}
                  <button
                    onClick={() => engineRef.current?.castPlayerSkill(cdInfo.factionId, 1)}
                    className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer select-none ${
                      isReady1
                        ? 'bg-emerald-950/70 border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:scale-105'
                        : 'bg-slate-900/90 border-slate-700 opacity-90'
                    }`}
                  >
                    {/* Hotkey Badge */}
                    <kbd className="px-2 py-1 rounded bg-slate-800 text-amber-300 font-mono font-extrabold text-xs border border-amber-400/50 shadow-sm">
                      {hotkeys.abil1}
                    </kbd>

                    {/* Skill Info */}
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-bold text-white tracking-wide">
                        {s1.name}
                      </span>
                      {isReady1 ? (
                        <span className="text-[10px] font-extrabold text-emerald-400 tracking-wider">
                          READY
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono font-bold text-amber-400">
                          {cdInfo.cd1.toFixed(1)}s
                        </span>
                      )}
                    </div>

                    {/* Cooldown progress bar at bottom of skill */}
                    {!isReady1 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800 rounded-b-xl overflow-hidden">
                        <div
                          className="h-full bg-amber-400 transition-all duration-75"
                          style={{ width: `${(1 - p1Ratio) * 100}%` }}
                        />
                      </div>
                    )}
                  </button>

                  {/* Skill 2 Box */}
                  <button
                    onClick={() => engineRef.current?.castPlayerSkill(cdInfo.factionId, 2)}
                    className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer select-none ${
                      isReady2
                        ? 'bg-blue-950/70 border-blue-500/80 shadow-[0_0_12px_rgba(59,130,246,0.3)] hover:scale-105'
                        : 'bg-slate-900/90 border-slate-700 opacity-90'
                    }`}
                  >
                    {/* Hotkey Badge */}
                    <kbd className="px-2 py-1 rounded bg-slate-800 text-amber-300 font-mono font-extrabold text-xs border border-amber-400/50 shadow-sm">
                      {hotkeys.abil2}
                    </kbd>

                    {/* Skill Info */}
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-bold text-white tracking-wide">
                        {s2.name}
                      </span>
                      {isReady2 ? (
                        <span className="text-[10px] font-extrabold text-blue-400 tracking-wider">
                          READY
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono font-bold text-amber-400">
                          {cdInfo.cd2.toFixed(1)}s
                        </span>
                      )}
                    </div>

                    {/* Cooldown progress bar at bottom of skill */}
                    {!isReady2 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800 rounded-b-xl overflow-hidden">
                        <div
                          className="h-full bg-blue-400 transition-all duration-75"
                          style={{ width: `${(1 - p2Ratio) * 100}%` }}
                        />
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Game Over Screen */}
      {winnerFactionId !== null && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass-panel p-8 sm:p-10 rounded-2xl shadow-2xl text-center flex flex-col gap-6 max-w-sm w-full border border-slate-700">
            <h2
              className="text-4xl sm:text-5xl font-black font-cinzel"
              style={{
                color:
                  winnerFactionId === 'draw'
                    ? 'white'
                    : FACTIONS[winnerFactionId].color
              }}
            >
              {winnerFactionId === 'draw' ? 'Draw!' : FACTIONS[winnerFactionId].name}
            </h2>
            <p className="text-slate-300">has conquered the battlefield!</p>
            <button
              onClick={async () => {
                setWinnerFactionId(null);
                setInGame(false);
                if (currentRoomRef.current) {
                  const rid = currentRoomRef.current.id;
                  setCurrentRoom(null);
                  await leaveLobbyRoom(rid, playerId);
                }
                if (rendererRef.current) {
                  rendererRef.current.updateCamera();
                }
              }}
              className="w-full py-3 rounded-xl font-bold bg-white text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              {currentRoom ? 'Exit to Lobby' : 'Play Again'}
            </button>
          </div>
        </div>
      )}

      {/* Skill Selection Modal */}
      {editingFaction !== null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass-panel p-6 rounded-2xl shadow-2xl z-50 w-full max-w-sm flex flex-col gap-4 border border-slate-600">
            <h3 className="text-xl font-bold text-white text-center">Select 2 Skills</h3>
            <p className="text-slate-300 text-sm text-center">
              {FACTIONS[editingFaction].name} Skills
            </p>

            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-2">
              {(Object.keys(SKILLS) as SkillKey[]).map((id) => {
                const skill = SKILLS[id];
                const isSelected = tempSelectedSkills.includes(id);

                return (
                  <div
                    key={id}
                    onClick={() => toggleModalSkill(id)}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer border transition-colors ${
                      isSelected
                        ? 'bg-blue-900/50 border-blue-500'
                        : 'bg-slate-800/50 hover:bg-slate-700 border-transparent'
                    }`}
                  >
                    <div className="flex flex-col pr-2">
                      <span className="text-sm font-bold" style={{ color: skill.color }}>
                        {skill.name}{' '}
                        <span className="text-xs text-slate-400 font-normal">
                          ({skill.cd}s CD)
                        </span>
                      </span>
                      <span className="text-xs text-slate-300">{skill.desc}</span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border border-slate-500 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-blue-500 border-blue-500' : ''
                      }`}
                    >
                      {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                  </div>
                );
              })}
            </div>

            {skillError && (
              <p className="text-red-400 text-xs text-center">Select exactly 2 skills.</p>
            )}

            <button
              onClick={saveModalSkills}
              className="mt-2 py-2 bg-blue-600 hover:bg-blue-500 rounded font-bold text-white transition-colors cursor-pointer"
            >
              Confirm Selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
