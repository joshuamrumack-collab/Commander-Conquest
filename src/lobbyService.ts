import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { generateSharedMapData } from './game/mapGenerator';
import { MapSizeKey, NetGameState, NetPlayerInput, SharedMapData, SkillKey } from './types';

export interface LobbySlot {
  factionId: number;
  playerId: string | null;
  playerName: string;
  type: 'human' | 'ai' | 'none';
  skills: [SkillKey, SkillKey];
  ready: boolean;
}

export interface LobbyRoom {
  id: string; // Room Code e.g. "CC-4921"
  name: string;
  hostId: string;
  hostName: string;
  status: 'waiting' | 'in_game' | 'finished';
  mapSize: MapSizeKey;
  slots: LobbySlot[];
  mapData?: SharedMapData;
  gameState?: NetGameState;
  playerInputs?: Record<number, NetPlayerInput>;
  createdAt: string;
  updatedAt: string;
}

const ROOMS_COLLECTION = 'rooms';

export function generateRoomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  let code = '';
  for (let i = 0; i < 2; i++) code += letters[Math.floor(Math.random() * letters.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += nums[Math.floor(Math.random() * nums.length)];
  return code;
}

export async function createLobbyRoom(
  hostId: string,
  hostName: string,
  mapSize: MapSizeKey = 'small'
): Promise<LobbyRoom> {
  const roomId = generateRoomCode();
  const initialSlots: LobbySlot[] = [
    {
      factionId: 0,
      playerId: hostId,
      playerName: hostName,
      type: 'human',
      skills: ['rally', 'banner'],
      ready: true
    },
    {
      factionId: 1,
      playerId: null,
      playerName: 'Open Slot',
      type: 'ai',
      skills: ['rally', 'banner'],
      ready: false
    },
    {
      factionId: 2,
      playerId: null,
      playerName: 'Open Slot',
      type: 'none',
      skills: ['rally', 'banner'],
      ready: false
    },
    {
      factionId: 3,
      playerId: null,
      playerName: 'Open Slot',
      type: 'none',
      skills: ['rally', 'banner'],
      ready: false
    }
  ];

  // Pre-generate shared map layout with deterministic seed
  const mapData = generateSharedMapData(mapSize);
  const now = new Date().toISOString();

  const roomData: LobbyRoom = {
    id: roomId,
    name: `${hostName}'s Campaign`,
    hostId,
    hostName,
    status: 'waiting',
    mapSize,
    slots: initialSlots,
    mapData,
    createdAt: now,
    updatedAt: now
  };

  try {
    await setDoc(doc(db, ROOMS_COLLECTION, roomId), roomData);
    return roomData;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
    throw err;
  }
}

export async function joinLobbyRoom(
  roomId: string,
  playerId: string,
  playerName: string
): Promise<LobbyRoom | null> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const room = snap.data() as LobbyRoom;

    // Check if player is already in a slot
    const existingIndex = room.slots.findIndex((s) => s.playerId === playerId);
    if (existingIndex !== -1) {
      return room;
    }

    // Find first available slot (AI or none or unassigned)
    const availableIndex = room.slots.findIndex(
      (s, idx) => idx !== 0 && (!s.playerId || s.type !== 'human')
    );

    if (availableIndex === -1) {
      throw new Error('This lobby room is full (4 players maximum).');
    }

    const updatedSlots = [...room.slots];
    updatedSlots[availableIndex] = {
      ...updatedSlots[availableIndex],
      playerId,
      playerName,
      type: 'human',
      ready: false
    };

    const updatedAt = new Date().toISOString();
    await updateDoc(docRef, { slots: updatedSlots, updatedAt });
    return { ...room, slots: updatedSlots, updatedAt };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
    throw err;
  }
}

/**
 * Shut down the game when everybody has left, or transfer host if other humans remain.
 */
export async function leaveLobbyRoom(roomId: string, playerId: string): Promise<void> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const room = snap.data() as LobbyRoom;

    // Clear this player's slot
    const updatedSlots = room.slots.map((s) =>
      s.playerId === playerId
        ? {
            ...s,
            playerId: null,
            playerName: 'Open Slot',
            type: (room.status === 'in_game' ? 'ai' : 'none') as 'ai' | 'none',
            ready: false
          }
        : s
    );

    // Count remaining human players in any slot
    const remainingHumans = updatedSlots.filter(
      (s) => s.playerId && s.playerId !== playerId && s.type === 'human'
    );

    // CRITICAL: Shut down the game completely once everybody has left it!
    if (remainingHumans.length === 0) {
      await deleteDoc(docRef);
      return;
    }

    // If the leaving player was the host, transfer host to the next human
    let newHostId = room.hostId;
    let newHostName = room.hostName;
    if (room.hostId === playerId && remainingHumans.length > 0) {
      newHostId = remainingHumans[0].playerId!;
      newHostName = remainingHumans[0].playerName;
    }

    const updatedAt = new Date().toISOString();
    await updateDoc(docRef, {
      hostId: newHostId,
      hostName: newHostName,
      slots: updatedSlots,
      updatedAt
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
  }
}

export async function closeRoom(roomId: string): Promise<void> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${ROOMS_COLLECTION}/${roomId}`);
  }
}

export async function updateSlotConfig(
  roomId: string,
  slotIndex: number,
  updates: Partial<LobbySlot>
): Promise<void> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const room = snap.data() as LobbyRoom;
    const updatedSlots = [...room.slots];
    updatedSlots[slotIndex] = { ...updatedSlots[slotIndex], ...updates };

    await updateDoc(docRef, { slots: updatedSlots, updatedAt: new Date().toISOString() });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
  }
}

export async function updateRoomMapSize(roomId: string, mapSize: MapSizeKey): Promise<void> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    const mapData = generateSharedMapData(mapSize);
    await updateDoc(docRef, {
      mapSize,
      mapData,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
  }
}

export async function launchRoomGame(roomId: string): Promise<void> {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const room = snap.data() as LobbyRoom;

    // Guarantee that mapData is generated and identical for all players
    const mapData = room.mapData || generateSharedMapData(room.mapSize);

    await updateDoc(docRef, {
      status: 'in_game',
      mapData,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${ROOMS_COLLECTION}/${roomId}`);
  }
}

// Throttled Net Game State sync from Host
let lastStateSendTime = 0;
export async function sendNetGameState(roomId: string, gameState: NetGameState): Promise<void> {
  const now = performance.now();
  if (now - lastStateSendTime < 200) return; // limit to 5Hz to stay well within quota
  lastStateSendTime = now;

  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    await updateDoc(docRef, {
      gameState,
      updatedAt: new Date().toISOString()
    });
  } catch {
    // Non-fatal, game continues smoothly
  }
}

// Throttled Net Player Input sync from Guest
let lastInputSendTime = 0;
export async function sendNetPlayerInput(roomId: string, input: NetPlayerInput): Promise<void> {
  const now = performance.now();
  if (now - lastInputSendTime < 150) return;
  lastInputSendTime = now;

  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  try {
    await updateDoc(docRef, {
      [`playerInputs.${input.factionId}`]: input,
      updatedAt: new Date().toISOString()
    });
  } catch {
    // Non-fatal
  }
}

export function subscribeToRoom(
  roomId: string,
  onUpdate: (room: LobbyRoom | null) => void,
  onError?: (err: Error) => void
) {
  const docRef = doc(db, ROOMS_COLLECTION, roomId);
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as LobbyRoom);
      } else {
        onUpdate(null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `${ROOMS_COLLECTION}/${roomId}`);
      if (onError) onError(error as Error);
    }
  );
}

export function subscribeToPublicRooms(
  onUpdate: (rooms: LobbyRoom[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, ROOMS_COLLECTION), where('status', '==', 'waiting'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rooms: LobbyRoom[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as LobbyRoom;
        // Only keep rooms that actually have at least 1 human player
        const humanCount = data.slots.filter((s) => s.playerId && s.type === 'human').length;
        if (humanCount > 0) {
          rooms.push(data);
        } else {
          // Asynchronously clean up empty orphaned room
          deleteDoc(docSnap.ref).catch(() => {});
        }
      });
      onUpdate(rooms);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, ROOMS_COLLECTION);
      if (onError) onError(error as Error);
    }
  );
}
