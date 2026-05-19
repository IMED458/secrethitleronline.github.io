import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { customAlphabet } from 'nanoid';
import { 
  GameRoom, 
  GameStage, 
  Player, 
  Role, 
  PartyMembership, 
  Policy, 
  PolicyType, 
  ExecutivePower, 
  ChatMessage 
} from './src/types';
import _ from 'lodash';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const nanoid = customAlphabet('ABCDEFGHIJKLMNPQRSTUVWXYZ123456789', 6);
const PORT = Number(process.env.PORT) || 3000;

// Game state in memory
const rooms: Record<string, GameRoom> = {};

// Helper: Shuffle deck
function createDeck() {
  const policies: Policy[] = [];
  for (let i = 0; i < 6; i++) policies.push({ id: `L-${i}`, type: PolicyType.Liberal });
  for (let i = 0; i < 11; i++) policies.push({ id: `F-${i}`, type: PolicyType.Fascist });
  return _.shuffle(policies);
}

function ensureDeck(room: GameRoom, needed = 3) {
  if (room.drawPile.length >= needed) return;
  room.drawPile = _.shuffle([...room.drawPile, ...room.discardPile]);
  room.discardPile = [];
  addSystemMsg(room, 'დასტა გადაირია.');
}

function checkPolicyWin(room: GameRoom) {
  if (room.liberalPoliciesEnacted >= 5) {
    room.stage = GameStage.GameOver;
    room.winner = 'Liberal';
    room.winReason = 'დაიდო 5 ლიბერალური კანონი!';
    return true;
  }

  if (room.fascistPoliciesEnacted >= 6) {
    room.stage = GameStage.GameOver;
    room.winner = 'Fascist';
    room.winReason = 'დაიდო 6 ფაშისტური კანონი!';
    return true;
  }

  return false;
}

function enactTopPolicy(room: GameRoom) {
  ensureDeck(room, 1);
  const top = room.drawPile.shift();
  if (!top) return false;

  addSystemMsg(room, 'კანონი ავტომატურად აირჩა.');
  addSystemMsg(room, `ქვეყანა ქაოსმა მოიცვა! შემთხვევითი კანონი: ${top.type === PolicyType.Liberal ? 'ლიბერალური' : 'ფაშისტური'}`);
  if (top.type === PolicyType.Liberal) room.liberalPoliciesEnacted++;
  else room.fascistPoliciesEnacted++;

  room.electionTracker = 0;
  room.lastElectedPresidentId = null;
  room.lastElectedChancellorId = null;
  return checkPolicyWin(room);
}

// Helper: Get player by ID
function getPlayer(room: GameRoom, playerId: string) {
  return room.players.find(p => p.id === playerId);
}

// Helper: Secure room for a specific player
function secureRoom(room: GameRoom, playerId: string) {
  const p = getPlayer(room, playerId);
  if (!p) return room;

  const securedPlayers = room.players.map(player => {
    const isSelf = player.id === playerId;
    const canSeeRole = room.stage === GameStage.GameOver || isSelf || (
      p.role === Role.Fascist && (player.role === Role.Fascist || player.role === Role.Hitler)
    ) || (
      // Hitler knows Fascists in small games
      p.role === Role.Hitler && room.players.length <= 6 && player.role === Role.Fascist
    );

    return {
      ...player,
      role: canSeeRole ? player.role : undefined,
      partyMembership: canSeeRole ? player.partyMembership : undefined,
    };
  });

  return {
    ...room,
    players: securedPlayers,
    drawPile: [], // Don't send deck contents
    discardPile: [],
    drawPileCount: room.drawPile.length,
    discardPileCount: room.discardPile.length,
    // For legislative, only the chooser sees cards
    legislativeHand: (
      (room.stage === GameStage.LegislativePresident && room.currentPresidentId === playerId) ||
      (room.stage === GameStage.LegislativeChancellor && room.currentChancellorId === playerId)
    ) ? room.legislativeHand : []
  };
}

function secureBoardRoom(room: GameRoom) {
  const president = getPlayer(room, room.currentPresidentId);
  const chancellorCandidate = room.currentChancellorCandidateId ? getPlayer(room, room.currentChancellorCandidateId) : null;
  const chancellor = room.currentChancellorId ? getPlayer(room, room.currentChancellorId) : null;
  return {
    code: room.code,
    stage: room.stage,
    currentPresidentName: president?.name || null,
    currentChancellorCandidateName: chancellorCandidate?.name || null,
    currentChancellorName: chancellor?.name || null,
    votes: Object.entries(room.votes).map(([playerId, vote]) => ({
      playerName: getPlayer(room, playerId)?.name || 'უცნობი',
      vote,
    })),
    playerCount: boardPlayerCount(room),
    aliveCount: alivePlayers(room).length,
    liberalPoliciesEnacted: room.liberalPoliciesEnacted,
    fascistPoliciesEnacted: room.fascistPoliciesEnacted,
    electionTracker: room.electionTracker,
    drawPileCount: room.drawPile.length,
    discardPileCount: room.discardPile.length,
    winner: room.winner,
    winReason: room.winReason,
  };
}

// Broadcast room update
function broadcastRoom(roomCode: string) {
  const room = rooms[roomCode];
  if (!room) return;
  
  room.players.forEach(p => {
    io.to(p.socketId).emit('roomUpdate', secureRoom(room, p.id));
  });
  io.to(`monitor:${room.code}`).emit('boardUpdate', secureBoardRoom(room));
}

// System message
function addSystemMsg(room: GameRoom, text: string) {
  room.chat.push({
    id: nanoid(),
    senderId: 'SYSTEM',
    senderName: 'სისტემა',
    text,
    timestamp: Date.now()
  });
}

function removePlayerFromLobby(room: GameRoom, playerId: string) {
  const leavingPlayer = getPlayer(room, playerId);
  if (!leavingPlayer) return false;

  room.players = room.players.filter(p => p.id !== playerId);
  room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== playerId);

  if (room.players.length === 0) {
    delete rooms[room.code];
    return true;
  }

  if (room.hostPlayerId === playerId) {
    room.hostPlayerId = room.players[0].id;
    room.players = room.players.map((p, index) => ({ ...p, isHost: index === 0 }));
  }

  addSystemMsg(room, `${leavingPlayer.name} გავიდა ოთახიდან`);
  return true;
}

function getRolesForCount(playerCount: number) {
  if (playerCount === 2) return [Role.Liberal, Role.Hitler];
  if (playerCount === 3) return [Role.Liberal, Role.Fascist, Role.Hitler];
  if (playerCount === 4) return [Role.Liberal, Role.Liberal, Role.Fascist, Role.Hitler];
  if (playerCount === 5) return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Hitler];
  if (playerCount === 6) return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Hitler];
  if (playerCount === 7) return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Fascist, Role.Hitler];
  if (playerCount === 8) return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Fascist, Role.Hitler];
  if (playerCount === 9) return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Fascist, Role.Fascist, Role.Hitler];
  return [Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Liberal, Role.Fascist, Role.Fascist, Role.Fascist, Role.Hitler];
}

function alivePlayers(room: GameRoom) {
  return room.players.filter(player => player.alive);
}

function boardPlayerCount(room: GameRoom) {
  return room.boardPlayerCount ?? Math.max(5, room.playerOrder.length || room.players.length);
}

function getExecutivePowerForPolicy(room: GameRoom, policyCount: number) {
  const n = boardPlayerCount(room);

  if (n <= 6) {
    if (policyCount === 3) return ExecutivePower.PolicyPeek;
    if (policyCount === 4 || policyCount === 5) return ExecutivePower.Execution;
  } else if (n <= 8) {
    if (policyCount === 2) return ExecutivePower.InvestigateLoyalty;
    if (policyCount === 3) return ExecutivePower.SpecialElection;
    if (policyCount === 4 || policyCount === 5) return ExecutivePower.Execution;
  } else {
    if (policyCount === 1 || policyCount === 2) return ExecutivePower.InvestigateLoyalty;
    if (policyCount === 3) return ExecutivePower.SpecialElection;
    if (policyCount === 4 || policyCount === 5) return ExecutivePower.Execution;
  }

  return null;
}

function hasEnoughPlayers(room: GameRoom) {
  const alive = alivePlayers(room);
  if (alive.length >= 2 || room.stage === GameStage.Lobby || room.stage === GameStage.GameOver) return true;

  room.stage = GameStage.GameOver;
  room.winner = alive[0]?.partyMembership === PartyMembership.Fascist ? 'Fascist' : 'Liberal';
  room.winReason = 'თამაშში მხოლოდ ერთი აქტიური მოთამაშე დარჩა.';
  addSystemMsg(room, 'თამაში დასრულდა: აქტიური მოთამაშეების რაოდენობა საკმარისი აღარ არის.');
  return false;
}

function canNominate(room: GameRoom, presidentId: string, targetId: string) {
  const target = getPlayer(room, targetId);
  if (!target || !target.alive || target.id === presidentId) return false;

  const aliveCount = alivePlayers(room).length;
  if (aliveCount <= 2) return true;
  if (target.id === room.lastElectedChancellorId) return false;
  if (aliveCount > 5 && target.id === room.lastElectedPresidentId) return false;
  return true;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', ({ name }) => {
    const code = nanoid();
    const playerId = nanoid();
    const room: GameRoom = {
      id: nanoid(),
      code,
      hostPlayerId: playerId,
      stage: GameStage.Lobby,
      players: [{
        id: playerId,
        socketId: socket.id,
        name: name.slice(0, 20),
        alive: true,
        connected: true,
        isHost: true
      }],
      playerOrder: [],
      boardPlayerCount: undefined,
      currentPresidentIndex: 0,
      currentPresidentId: '',
      currentChancellorCandidateId: null,
      currentChancellorId: null,
      lastElectedPresidentId: null,
      lastElectedChancellorId: null,
      specialElectionReturnIndex: null,
      liberalPoliciesEnacted: 0,
      fascistPoliciesEnacted: 0,
      electionTracker: 0,
      drawPile: [],
      discardPile: [],
      legislativeHand: [],
      votes: {},
      pendingPower: null,
      winner: null,
      winReason: null,
      vetoRequested: false,
      readyPlayerIds: [],
      chat: []
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('joined', { code, playerId });
    addSystemMsg(room, `${name} შემოვიდა ოთახში`);
    broadcastRoom(code);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) return socket.emit('error', 'ოთახი ვერ მოიძებნა');
    if (room.players.length >= 10) return socket.emit('error', 'ოთახი სავსეა');
    if (room.players.some(p => p.name === name)) return socket.emit('error', 'სახელი დაკავებულია');

    const playerId = nanoid();
    const gameStarted = room.stage !== GameStage.Lobby;
    const player: Player = {
      id: playerId,
      socketId: socket.id,
      name: name.slice(0, 20),
      alive: true,
      connected: true,
      isHost: false,
      role: gameStarted ? Role.Liberal : undefined,
      partyMembership: gameStarted ? PartyMembership.Liberal : undefined,
    };
    room.players.push(player);
    if (gameStarted) room.playerOrder.push(playerId);

    socket.join(room.code);
    socket.emit('joined', { code: room.code, playerId });
    addSystemMsg(room, gameStarted ? `${name} შემოვიდა მიმდინარე თამაშში.` : `${name} შემოვიდა ოთახში`);
    broadcastRoom(room.code);
  });

  socket.on('rejoinRoom', ({ code, playerId }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room) return socket.emit('error', 'ოთახი ვერ მოიძებნა');

    const player = getPlayer(room, playerId);
    if (!player) return socket.emit('error', 'ამ ოთახში თქვენი ადგილი ვერ მოიძებნა');

    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, playerId });
    addSystemMsg(room, `${player.name} დაბრუნდა ოთახში`);
    broadcastRoom(room.code);
  });

  socket.on('watchRoom', ({ code }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room) return socket.emit('boardError', 'ოთახი ვერ მოიძებნა');

    socket.join(`monitor:${room.code}`);
    socket.emit('boardUpdate', secureBoardRoom(room));
  });

  socket.on('leaveRoom', ({ code, playerId }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room) return socket.emit('leftRoom');

    const player = getPlayer(room, playerId);
    if (!player) return socket.emit('leftRoom');

    socket.leave(room.code);

    if (room.stage === GameStage.Lobby) {
      removePlayerFromLobby(room, playerId);
    } else {
      player.connected = false;
      player.alive = false;
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== playerId);
      delete room.votes[playerId];
      addSystemMsg(room, `${player.name} გავიდა თამაშიდან. თამაში გრძელდება.`);
      handlePlayerLeftActiveGame(room, playerId);
    }

    socket.emit('leftRoom');
    if (rooms[room.code]) broadcastRoom(room.code);
  });

  socket.on('kickPlayer', ({ code, hostPlayerId, targetId }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room) return socket.emit('error', 'ოთახი ვერ მოიძებნა');
    if (room.hostPlayerId !== hostPlayerId) return socket.emit('error', 'მხოლოდ ჰოსტს შეუძლია მოთამაშის გაგდება');
    if (hostPlayerId === targetId) return socket.emit('error', 'საკუთარ თავს ვერ გააგდებთ');

    const target = getPlayer(room, targetId);
    if (!target) return socket.emit('error', 'მოთამაშე ვერ მოიძებნა');

    const targetSocket = io.sockets.sockets.get(target.socketId);
    targetSocket?.emit('kickedRoom', 'ჰოსტმა გაგაგდოთ ოთახიდან');
    targetSocket?.leave(room.code);

    if (room.stage === GameStage.Lobby) {
      room.players = room.players.filter(player => player.id !== targetId);
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== targetId);
      addSystemMsg(room, `${target.name} ჰოსტმა გააგდო ოთახიდან.`);
    } else {
      target.connected = false;
      target.alive = false;
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== targetId);
      delete room.votes[targetId];
      addSystemMsg(room, `${target.name} ჰოსტმა გააგდო თამაშიდან. თამაში გრძელდება.`);
      handlePlayerLeftActiveGame(room, targetId);
    }

    broadcastRoom(room.code);
  });

  socket.on('movePlayer', ({ code, hostPlayerId, targetId, direction }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room) return socket.emit('error', 'ოთახი ვერ მოიძებნა');
    if (room.stage !== GameStage.Lobby) return socket.emit('error', 'რიგის შეცვლა მხოლოდ ლობიში შეიძლება');
    if (room.hostPlayerId !== hostPlayerId) return socket.emit('error', 'მხოლოდ ჰოსტს შეუძლია რიგის შეცვლა');

    const index = room.players.findIndex(player => player.id === targetId);
    if (index < 0) return socket.emit('error', 'მოთამაშე ვერ მოიძებნა');

    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= room.players.length) return;

    const [player] = room.players.splice(index, 1);
    room.players.splice(nextIndex, 0, player);
    addSystemMsg(room, 'ჰოსტმა მოთამაშეების რიგი შეცვალა.');
    broadcastRoom(room.code);
  });

  socket.on('startGame', ({ code, playerId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.hostPlayerId !== playerId) return;
    if (room.players.length < 2) return socket.emit('error', 'მინიმუმ 2 მოთამაშეა საჭირო');

    // Assign roles
    const n = room.players.length;
    room.boardPlayerCount = Math.max(5, n);
    const roles = _.shuffle(getRolesForCount(n));
    room.players.forEach((p, i) => {
      p.role = roles[i];
      p.partyMembership = p.role === Role.Liberal ? PartyMembership.Liberal : PartyMembership.Fascist;
    });

    room.playerOrder = room.players.map(p => p.id);
    room.currentPresidentIndex = 0;
    room.currentPresidentId = room.playerOrder[0];
    room.drawPile = createDeck();
    room.stage = GameStage.RoleReveal;
    room.readyPlayerIds = [];
    
    addSystemMsg(room, 'თამაში დაიწყო! გაეცანით თქვენს როლებს.');
    broadcastRoom(room.code);
  });

  socket.on('finishReveal', ({ code, playerId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.RoleReveal) return;

    const player = getPlayer(room, playerId);
    if (!player || !player.alive) return;

    if (!room.readyPlayerIds.includes(playerId)) room.readyPlayerIds.push(playerId);
    if (room.readyPlayerIds.length === alivePlayers(room).length) {
      room.stage = GameStage.Nomination;
      addSystemMsg(room, 'ყველა მზადაა. პრეზიდენტი ასახელებს კანცლერს.');
    }
    broadcastRoom(room.code);
  });

  socket.on('nominateChancellor', ({ code, playerId, targetId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.Nomination || room.currentPresidentId !== playerId) return;
    
    const target = getPlayer(room, targetId);
    if (!target || !target.alive || target.id === playerId) return;
    if (!canNominate(room, playerId, targetId)) return socket.emit('error', 'ეს მოთამაშე ამ რაუნდში კანდიდატი ვერ იქნება');

    room.currentChancellorCandidateId = targetId;
    room.stage = GameStage.Voting;
    room.votes = {};
    
    addSystemMsg(room, `პრეზიდენტმა კანცლერობის კანდიდატად დაასახელა ${target.name}. დროა ხმის მიცემის!`);
    broadcastRoom(room.code);
  });

  socket.on('castVote', ({ code, playerId, vote }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.Voting) return;
    
    const p = getPlayer(room, playerId);
    if (!p || !p.alive) return;
    if (room.currentPresidentId === playerId) return socket.emit('error', 'პრეზიდენტი არჩევნებში ხმას არ აძლევს');
    if (room.currentChancellorCandidateId === playerId) return socket.emit('error', 'კანცლერობის კანდიდატი არჩევნებში ხმას არ აძლევს');

    room.votes[playerId] = vote;
    
    const activePlayers = alivePlayers(room).filter(player => (
      player.id !== room.currentPresidentId &&
      player.id !== room.currentChancellorCandidateId
    ));
    if (Object.keys(room.votes).length === activePlayers.length) {
      // Reveal votes
      const jas = Object.values(room.votes).filter(v => v === 'Ja').length;
      const neins = Object.values(room.votes).filter(v => v === 'Nein').length;

      if (jas > neins) {
        // Government elected
        room.currentChancellorId = room.currentChancellorCandidateId;
        addSystemMsg(room, `არჩევნები შედგა! კი: ${jas}, არა: ${neins}.`);
        
        // Hitler check
        const chancellor = getPlayer(room, room.currentChancellorId!);
        if (room.fascistPoliciesEnacted >= 3 && chancellor?.role === Role.Hitler) {
          room.stage = GameStage.GameOver;
          room.winner = 'Fascist';
          room.winReason = 'ჰიტლერი კანცლერად აირჩიეს!';
          addSystemMsg(room, 'ფაშისტებმა გაიმარჯვეს! ჰიტლერი კანცლერია.');
        } else {
          room.stage = GameStage.LegislativePresident;
          ensureDeck(room, 3);
          room.legislativeHand = room.drawPile.splice(0, 3);
          room.electionTracker = 0;
        }
      } else {
        // Failed
        room.electionTracker++;
        addSystemMsg(room, `არჩევნები ჩავარდა! კი: ${jas}, არა: ${neins}. ტრეკერი: ${room.electionTracker}`);
        
        if (room.electionTracker === 3 && enactTopPolicy(room)) return broadcastRoom(room.code);
        
        nextRound(room);
      }
      broadcastRoom(room.code);
    } else {
      // Just update progress
      broadcastRoom(room.code);
    }
  });

  socket.on('presidentDiscard', ({ code, playerId, policyId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.LegislativePresident || room.currentPresidentId !== playerId) return;

    const idx = room.legislativeHand.findIndex(p => p.id === policyId);
    if (idx === -1) return;

    const discarded = room.legislativeHand.splice(idx, 1)[0];
    room.discardPile.push(discarded);
    room.stage = GameStage.LegislativeChancellor;
    broadcastRoom(room.code);
  });

  socket.on('chancellorEnact', ({ code, playerId, policyId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.LegislativeChancellor || room.currentChancellorId !== playerId) return;

    const idx = room.legislativeHand.findIndex(p => p.id === policyId);
    if (idx === -1) return;

    const enacted = room.legislativeHand.splice(idx, 1)[0];
    const discarded = room.legislativeHand.pop()!;
    room.discardPile.push(discarded);
    
    if (enacted.type === PolicyType.Liberal) room.liberalPoliciesEnacted++;
    else room.fascistPoliciesEnacted++;

    addSystemMsg(room, `ახალი კანონი: ${enacted.type === PolicyType.Liberal ? 'ლიბერალური' : 'ფაშისტური'}`);

    ensureDeck(room, 3);

    // Win condition
    if (checkPolicyWin(room)) return broadcastRoom(room.code);

    // Presidential powers
    let powerTriggered = false;
    if (enacted.type === PolicyType.Fascist) {
      const count = room.fascistPoliciesEnacted;
      room.pendingPower = getExecutivePowerForPolicy(room, count);

      if (room.pendingPower) {
        room.stage = GameStage.ExecutiveAction;
        powerTriggered = true;
      }
    }

    if (!powerTriggered) {
      endLegislative(room);
    }
    broadcastRoom(room.code);
  });

  socket.on('requestVeto', ({ code, playerId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.LegislativeChancellor || room.currentChancellorId !== playerId) return;
    if (room.fascistPoliciesEnacted < 5) return;

    room.vetoRequested = true;
    addSystemMsg(room, 'კანცლერმა ვეტო მოითხოვა. პრეზიდენტი უნდა დათანხმდეს ან უარყოს.');
    broadcastRoom(room.code);
  });

  socket.on('respondToVeto', ({ code, playerId, accept }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.LegislativeChancellor || room.currentPresidentId !== playerId) return;

    if (accept) {
      addSystemMsg(room, 'პრეზიდენტი დათანხმდა ვეტოს. კანონები გაუქმდა.');
      room.discardPile.push(...room.legislativeHand);
      room.legislativeHand = [];
      room.electionTracker++;
      if (room.electionTracker === 3 && enactTopPolicy(room)) return broadcastRoom(room.code);
      endLegislative(room);
    } else {
      addSystemMsg(room, 'პრეზიდენტმა უარყო ვეტო. კანცლერმა უნდა აირჩიოს კანონი.');
      room.vetoRequested = false;
    }
    broadcastRoom(room.code);
  });

  socket.on('executePower', ({ code, playerId, targetId }) => {
    const room = rooms[code.toUpperCase()];
    if (!room || room.stage !== GameStage.ExecutiveAction || room.currentPresidentId !== playerId) return;

    const power = room.pendingPower;
    const target = getPlayer(room, targetId);
    let investigationResult: { targetName: string; party: PartyMembership } | null = null;

    if (power === ExecutivePower.InvestigateLoyalty) {
      if (!target || !target.alive || target.id === playerId) return;
      investigationResult = { targetName: target.name, party: target.partyMembership! };
      addSystemMsg(room, `პრეზიდენტმა გამოიძია ${target.name}-ს ერთგულება.`);
    } else if (power === ExecutivePower.Execution) {
      if (!target || !target.alive || target.id === playerId) return;
      target.alive = false;
      addSystemMsg(room, `პრეზიდენტმა სიკვდილით დასაჯა ${target.name}!`);
      if (target.role === Role.Hitler) {
        room.stage = GameStage.GameOver;
        room.winner = 'Liberal';
        room.winReason = 'ჰიტლერი მოკლეს!';
        return broadcastRoom(room.code);
      }
    } else if (power === ExecutivePower.SpecialElection) {
      if (!target || !target.alive || target.id === playerId) return;
      room.specialElectionReturnIndex = room.currentPresidentIndex;
      room.currentPresidentId = target.id;
      // We skip nextRound's rotation
      room.lastElectedPresidentId = room.playerOrder[room.currentPresidentIndex];
      room.lastElectedChancellorId = room.currentChancellorId;
      room.stage = GameStage.Nomination;
      room.pendingPower = null;
      return broadcastRoom(room.code);
    } else if (power === ExecutivePower.PolicyPeek) {
      addSystemMsg(room, 'პრეზიდენტმა დასტის ზედა კანონები ნახა.');
    }

    room.pendingPower = null;
    endLegislative(room);
    broadcastRoom(room.code);
    if (investigationResult) socket.emit('investigationResult', investigationResult);
  });

  function endLegislative(room: GameRoom) {
    room.lastElectedPresidentId = room.currentPresidentId;
    room.lastElectedChancellorId = room.currentChancellorId;
    nextRound(room);
  }

  function nextRound(room: GameRoom) {
    if (!hasEnoughPlayers(room)) return;

    room.currentChancellorCandidateId = null;
    room.currentChancellorId = null;
    room.stage = GameStage.Nomination;
    room.legislativeHand = [];
    room.vetoRequested = false;

    // Rotate president
    let nextIdx: number;
    if (room.specialElectionReturnIndex !== null) {
      nextIdx = room.specialElectionReturnIndex;
      room.specialElectionReturnIndex = null;
    } else {
      nextIdx = room.currentPresidentIndex;
    }

    do {
      nextIdx = (nextIdx + 1) % room.playerOrder.length;
    } while (!getPlayer(room, room.playerOrder[nextIdx])?.alive);

    room.currentPresidentIndex = nextIdx;
    room.currentPresidentId = room.playerOrder[nextIdx];
  }

  function handlePlayerLeftActiveGame(room: GameRoom, playerId: string) {
    if (!hasEnoughPlayers(room)) return;

    if (room.stage === GameStage.RoleReveal) {
      if (room.readyPlayerIds.length === alivePlayers(room).length) {
        room.stage = GameStage.Nomination;
        addSystemMsg(room, 'დარჩენილი მოთამაშეები მზად არიან. თამაში გრძელდება.');
      }
      return;
    }

    if (room.currentPresidentId === playerId) {
      room.legislativeHand = [];
      room.pendingPower = null;
      nextRound(room);
      addSystemMsg(room, 'პრეზიდენტი გავიდა. პრეზიდენტობა შემდეგ მოთამაშეზე გადავიდა.');
      return;
    }

    if (room.stage === GameStage.Voting && room.currentChancellorCandidateId === playerId) {
      room.votes = {};
      nextRound(room);
      addSystemMsg(room, 'კანცლერობის კანდიდატი გავიდა. იწყება ახალი ნომინაცია.');
      return;
    }

    if (room.stage === GameStage.LegislativeChancellor && room.currentChancellorId === playerId) {
      room.discardPile.push(...room.legislativeHand);
      room.legislativeHand = [];
      endLegislative(room);
      addSystemMsg(room, 'კანცლერი გავიდა. კანონები გაუქმდა და თამაში შემდეგ რაუნდზე გადავიდა.');
      return;
    }

    const activeVoters = alivePlayers(room).filter(player => (
      player.id !== room.currentPresidentId &&
      player.id !== room.currentChancellorCandidateId
    ));
    if (room.stage === GameStage.Voting && Object.keys(room.votes).length === activeVoters.length) {
      const votes = { ...room.votes };
      room.votes = {};
      Object.entries(votes).forEach(([voterId, vote]) => {
        if (getPlayer(room, voterId)?.alive) room.votes[voterId] = vote;
      });
    }
  }

  socket.on('sendMessage', ({ code, playerId, text }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) return;
    const p = getPlayer(room, playerId);
    if (!p || (!p.alive && room.stage !== GameStage.GameOver)) return;

    room.chat.push({
      id: nanoid(),
      senderId: playerId,
      senderName: p.name,
      text: text.slice(0, 200),
      timestamp: Date.now()
    });
    broadcastRoom(room.code);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Find player and mark disconnected
    Object.values(rooms).forEach(room => {
      const p = room.players.find(pl => pl.socketId === socket.id);
      if (p) {
        p.connected = false;
        broadcastRoom(room.code);
      }
    });
  });

  socket.on('peekReady', ({ code }) => {
    const room = rooms[String(code || '').toUpperCase()];
    const player = room ? room.players.find(p => p.socketId === socket.id) : null;
    if (room && player && room.stage === GameStage.ExecutiveAction && room.pendingPower === ExecutivePower.PolicyPeek && room.currentPresidentId === player.id) {
      socket.emit('peekResults', room.drawPile.slice(0, 3));
    }
  });
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
