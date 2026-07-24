/**
 * ShRoom — transport-agnostic Secret Hitler authority (ported from the old
 * Socket.IO server.ts). Holds one room's full state, exposes an action method
 * per former socket event, and produces per-player secured views. Knows nothing
 * about Firestore: the host browser drives it and serialises the result.
 *
 * Players are identified by their Firebase Auth uid (was: nanoid id + socketId).
 */
import { customAlphabet } from 'nanoid';
import _ from 'lodash';
import {
  GameRoom,
  GameStage,
  Player,
  Role,
  PartyMembership,
  Policy,
  PolicyType,
  ExecutivePower,
  ElectionResult,
} from '../types';

const nanoid = customAlphabet('ABCDEFGHIJKLMNPQRSTUVWXYZ123456789', 6);
export const genCode = () => nanoid();

export type Result = { error?: string };

function createDeck(): Policy[] {
  const policies: Policy[] = [];
  for (let i = 0; i < 6; i++) policies.push({ id: `L-${i}`, type: PolicyType.Liberal });
  for (let i = 0; i < 11; i++) policies.push({ id: `F-${i}`, type: PolicyType.Fascist });
  return _.shuffle(policies);
}

export class ShRoom {
  room: GameRoom;
  // Transient private reveals keyed by the president's uid (not persisted long-term).
  investigations: Record<string, { id: string; targetName: string; party: PartyMembership }> = {};

  constructor(room: GameRoom) {
    this.room = room;
  }

  static create(hostUid: string, name: string, code: string): ShRoom {
    const room: GameRoom = {
      id: code,
      code,
      hostPlayerId: hostUid,
      stage: GameStage.Lobby,
      players: [{
        id: hostUid, socketId: hostUid, name: name.slice(0, 20),
        alive: true, connected: true, isHost: true,
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
      pendingElectionResult: null,
      pendingPower: null,
      winner: null,
      winReason: null,
      vetoRequested: false,
      readyPlayerIds: [],
      chat: [],
    };
    const r = new ShRoom(room);
    r.addSystemMsg(`${name} შემოვიდა ოთახში`);
    return r;
  }

  // ---- helpers (ported) ----------------------------------------------------

  private getPlayer(id: string) { return this.room.players.find(p => p.id === id); }
  private alivePlayers() { return this.room.players.filter(p => p.alive); }

  addSystemMsg(text: string) {
    this.room.chat.push({ id: nanoid(), senderId: 'SYSTEM', senderName: 'სისტემა', text, timestamp: Date.now() });
    if (this.room.chat.length > 60) this.room.chat = this.room.chat.slice(-60);
  }

  private ensureDeck(needed = 3) {
    const room = this.room;
    if (room.drawPile.length >= needed) return;
    room.drawPile = _.shuffle([...room.drawPile, ...room.discardPile]);
    room.discardPile = [];
    this.addSystemMsg('დასტა გადაირია.');
  }

  private checkPolicyWin(): boolean {
    const room = this.room;
    if (room.liberalPoliciesEnacted >= 5) {
      room.stage = GameStage.GameOver; room.winner = 'Liberal'; room.winReason = 'დაიდო 5 ლიბერალური კანონი!';
      return true;
    }
    if (room.fascistPoliciesEnacted >= 6) {
      room.stage = GameStage.GameOver; room.winner = 'Fascist'; room.winReason = 'დაიდო 6 ფაშისტური კანონი!';
      return true;
    }
    return false;
  }

  private enactTopPolicy(): boolean {
    const room = this.room;
    this.ensureDeck(1);
    const top = room.drawPile.shift();
    if (!top) return false;
    this.addSystemMsg('კანონი ავტომატურად აირჩა.');
    this.addSystemMsg(`ქვეყანა ქაოსმა მოიცვა! შემთხვევითი კანონი: ${top.type === PolicyType.Liberal ? 'ლიბერალური' : 'ფაშისტური'}`);
    if (top.type === PolicyType.Liberal) room.liberalPoliciesEnacted++;
    else room.fascistPoliciesEnacted++;
    room.electionTracker = 0;
    room.lastElectedPresidentId = null;
    room.lastElectedChancellorId = null;
    return this.checkPolicyWin();
  }

  private eligibleVoters() {
    const room = this.room;
    return this.alivePlayers().filter(p => p.id !== room.currentPresidentId && p.id !== room.currentChancellorCandidateId);
  }

  private boardPlayerCount() {
    const room = this.room;
    return room.boardPlayerCount ?? Math.max(5, room.playerOrder.length || room.players.length);
  }

  private getExecutivePowerForPolicy(policyCount: number): ExecutivePower | null {
    const n = this.boardPlayerCount();
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

  private getRolesForCount(playerCount: number): Role[] {
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

  private hasEnoughPlayers(): boolean {
    const room = this.room;
    const alive = this.alivePlayers();
    if (alive.length >= 2 || room.stage === GameStage.Lobby || room.stage === GameStage.GameOver) return true;
    room.stage = GameStage.GameOver;
    room.winner = alive[0]?.partyMembership === PartyMembership.Fascist ? 'Fascist' : 'Liberal';
    room.winReason = 'თამაშში მხოლოდ ერთი აქტიური მოთამაშე დარჩა.';
    this.addSystemMsg('თამაში დასრულდა: აქტიური მოთამაშეების რაოდენობა საკმარისი აღარ არის.');
    return false;
  }

  private canNominate(presidentId: string, targetId: string): boolean {
    const room = this.room;
    const target = this.getPlayer(targetId);
    if (!target || !target.alive || target.id === presidentId) return false;
    const aliveCount = this.alivePlayers().length;
    if (aliveCount <= 2) return true;
    if (target.id === room.lastElectedChancellorId) return false;
    if (aliveCount > 5 && target.id === room.lastElectedPresidentId) return false;
    return true;
  }

  private endLegislative() {
    this.room.lastElectedPresidentId = this.room.currentPresidentId;
    this.room.lastElectedChancellorId = this.room.currentChancellorId;
    this.nextRound();
  }

  private nextRound() {
    const room = this.room;
    if (!this.hasEnoughPlayers()) return;
    room.currentChancellorCandidateId = null;
    room.currentChancellorId = null;
    room.stage = GameStage.Nomination;
    room.legislativeHand = [];
    room.vetoRequested = false;
    room.votes = {};
    room.pendingElectionResult = null;

    let nextIdx: number;
    if (room.specialElectionReturnIndex !== null) {
      nextIdx = room.specialElectionReturnIndex;
      room.specialElectionReturnIndex = null;
    } else {
      nextIdx = room.currentPresidentIndex;
    }
    do {
      nextIdx = (nextIdx + 1) % room.playerOrder.length;
    } while (!this.getPlayer(room.playerOrder[nextIdx])?.alive);
    room.currentPresidentIndex = nextIdx;
    room.currentPresidentId = room.playerOrder[nextIdx];
  }

  private resolveElectionIfReady(): boolean {
    const room = this.room;
    if (room.stage !== GameStage.Voting) return false;
    if (room.pendingElectionResult) return true;
    const active = this.eligibleVoters();
    const aliveVoterIds = new Set(active.map(p => p.id));
    Object.keys(room.votes).forEach(voterId => { if (!aliveVoterIds.has(voterId)) delete room.votes[voterId]; });
    if (active.length === 0 || Object.keys(room.votes).length < active.length) return false;
    const jas = Object.values(room.votes).filter(v => v === 'Ja').length;
    const neins = Object.values(room.votes).filter(v => v === 'Nein').length;
    room.pendingElectionResult = {
      ja: jas, nein: neins, passed: jas > neins,
      trackerBefore: room.electionTracker, chancellorCandidateId: room.currentChancellorCandidateId,
    };
    this.addSystemMsg(`ხმის მიცემა დასრულდა. კი: ${jas}, არა: ${neins}. ჰოსტმა უნდა დააჭიროს შემდეგს.`);
    return true;
  }

  private doContinueElection(): boolean {
    const room = this.room;
    if (room.stage !== GameStage.Voting || !room.pendingElectionResult) return false;
    const result: ElectionResult = room.pendingElectionResult;
    room.pendingElectionResult = null;
    if (result.passed) {
      room.currentChancellorId = result.chancellorCandidateId;
      this.addSystemMsg(`არჩევნები შედგა! კი: ${result.ja}, არა: ${result.nein}.`);
      const chancellor = this.getPlayer(room.currentChancellorId!);
      if (!chancellor?.alive) {
        this.addSystemMsg('არჩეული კანცლერი აღარ არის აქტიური. იწყება ახალი ნომინაცია.');
        this.nextRound();
        return true;
      }
      if (room.fascistPoliciesEnacted >= 3 && chancellor?.role === Role.Hitler) {
        room.stage = GameStage.GameOver; room.winner = 'Fascist'; room.winReason = 'ჰიტლერი კანცლერად აირჩიეს!';
        this.addSystemMsg('ფაშისტებმა გაიმარჯვეს! ჰიტლერი კანცლერია.');
      } else {
        room.stage = GameStage.LegislativePresident;
        this.ensureDeck(3);
        room.legislativeHand = room.drawPile.splice(0, 3);
        room.electionTracker = 0;
      }
      return true;
    }
    room.electionTracker++;
    this.addSystemMsg(`არჩევნები ჩავარდა! კი: ${result.ja}, არა: ${result.nein}. ტრეკერი: ${room.electionTracker}`);
    if (room.electionTracker === 3) {
      if (!this.enactTopPolicy()) this.nextRound();
    } else {
      this.nextRound();
    }
    return true;
  }

  private resetGameState() {
    const room = this.room;
    room.stage = GameStage.Lobby;
    room.playerOrder = [];
    room.boardPlayerCount = undefined;
    room.currentPresidentIndex = 0;
    room.currentPresidentId = '';
    room.currentChancellorCandidateId = null;
    room.currentChancellorId = null;
    room.lastElectedPresidentId = null;
    room.lastElectedChancellorId = null;
    room.specialElectionReturnIndex = null;
    room.liberalPoliciesEnacted = 0;
    room.fascistPoliciesEnacted = 0;
    room.electionTracker = 0;
    room.drawPile = [];
    room.discardPile = [];
    room.legislativeHand = [];
    room.votes = {};
    room.pendingElectionResult = null;
    room.pendingPower = null;
    room.winner = null;
    room.winReason = null;
    room.vetoRequested = false;
    room.readyPlayerIds = [];
    room.players = room.players.filter(p => p.connected);
    room.players.forEach(p => { p.alive = true; p.role = undefined; p.partyMembership = undefined; p.isHost = false; });
    if (!room.players.find(p => p.id === room.hostPlayerId)) {
      if (room.players.length > 0) { room.hostPlayerId = room.players[0].id; room.players[0].isHost = true; }
    } else {
      this.getPlayer(room.hostPlayerId)!.isHost = true;
    }
  }

  private handlePlayerLeftActiveGame(playerId: string) {
    const room = this.room;
    if (!this.hasEnoughPlayers()) return;
    if (room.stage === GameStage.RoleReveal) {
      if (room.readyPlayerIds.length === this.alivePlayers().length) {
        room.stage = GameStage.Nomination;
        this.addSystemMsg('დარჩენილი მოთამაშეები მზად არიან. თამაში გრძელდება.');
      }
      return;
    }
    if (room.currentPresidentId === playerId) {
      room.discardPile.push(...room.legislativeHand); room.legislativeHand = []; room.pendingPower = null;
      this.nextRound();
      this.addSystemMsg('პრეზიდენტი გავიდა. პრეზიდენტობა შემდეგ მოთამაშეზე გადავიდა.');
      return;
    }
    if (room.stage === GameStage.Voting && room.currentChancellorCandidateId === playerId) {
      room.votes = {}; room.pendingElectionResult = null;
      this.nextRound();
      this.addSystemMsg('კანცლერობის კანდიდატი გავიდა. იწყება ახალი ნომინაცია.');
      return;
    }
    if (room.stage === GameStage.LegislativeChancellor && room.currentChancellorId === playerId) {
      room.discardPile.push(...room.legislativeHand); room.legislativeHand = [];
      this.endLegislative();
      this.addSystemMsg('კანცლერი გავიდა. კანონები გაუქმდა და თამაში შემდეგ რაუნდზე გადავიდა.');
      return;
    }
    this.resolveElectionIfReady();
  }

  // ---- actions (former socket handlers) ------------------------------------

  join(uid: string, name: string): Result {
    const room = this.room;
    if (room.players.some(p => p.id === uid)) { // treat as rejoin
      const p = this.getPlayer(uid)!; p.connected = true; return {};
    }
    if (room.players.length >= 10) return { error: 'ოთახი სავსეა' };
    if (room.players.some(p => p.name === name)) return { error: 'სახელი დაკავებულია' };
    const gameStarted = room.stage !== GameStage.Lobby;
    room.players.push({
      id: uid, socketId: uid, name: name.slice(0, 20), alive: true, connected: true, isHost: false,
      role: gameStarted ? Role.Liberal : undefined,
      partyMembership: gameStarted ? PartyMembership.Liberal : undefined,
    });
    if (gameStarted) room.playerOrder.push(uid);
    this.addSystemMsg(gameStarted ? `${name} შემოვიდა მიმდინარე თამაშში.` : `${name} შემოვიდა ოთახში`);
    return {};
  }

  rejoin(uid: string): Result {
    const p = this.getPlayer(uid);
    if (!p) return { error: 'ამ ოთახში თქვენი ადგილი ვერ მოიძებნა' };
    p.connected = true;
    this.addSystemMsg(`${p.name} დაბრუნდა ოთახში`);
    return {};
  }

  leave(uid: string): Result {
    const room = this.room;
    const player = this.getPlayer(uid);
    if (!player) return {};
    if (room.stage === GameStage.Lobby) {
      room.players = room.players.filter(p => p.id !== uid);
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== uid);
      if (room.players.length === 0) { room._deleted = true; return {}; }
      if (room.hostPlayerId === uid) {
        room.hostPlayerId = room.players[0].id;
        room.players = room.players.map((p, i) => ({ ...p, isHost: i === 0 }));
      }
      this.addSystemMsg(`${player.name} გავიდა ოთახიდან`);
    } else {
      player.connected = false; player.alive = false;
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== uid);
      delete room.votes[uid];
      this.addSystemMsg(`${player.name} გავიდა თამაშიდან. თამაში გრძელდება.`);
      this.handlePlayerLeftActiveGame(uid);
    }
    return {};
  }

  kick(hostUid: string, targetId: string): Result {
    const room = this.room;
    if (room.hostPlayerId !== hostUid) return { error: 'მხოლოდ ჰოსტს შეუძლია მოთამაშის გაგდება' };
    if (hostUid === targetId) return { error: 'საკუთარ თავს ვერ გააგდებთ' };
    const target = this.getPlayer(targetId);
    if (!target) return { error: 'მოთამაშე ვერ მოიძებნა' };
    target._kicked = true; // shim notifies the kicked client
    if (room.stage === GameStage.Lobby) {
      room.players = room.players.filter(p => p.id !== targetId);
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== targetId);
      this.addSystemMsg(`${target.name} ჰოსტმა გააგდო ოთახიდან.`);
    } else {
      target.connected = false; target.alive = false;
      room.readyPlayerIds = room.readyPlayerIds.filter(id => id !== targetId);
      delete room.votes[targetId];
      this.addSystemMsg(`${target.name} ჰოსტმა გააგდო თამაშიდან. თამაში გრძელდება.`);
      this.handlePlayerLeftActiveGame(targetId);
    }
    return {};
  }

  movePlayer(hostUid: string, targetId: string, direction: 'up' | 'down'): Result {
    const room = this.room;
    if (room.stage !== GameStage.Lobby) return { error: 'რიგის შეცვლა მხოლოდ ლობიში შეიძლება' };
    if (room.hostPlayerId !== hostUid) return { error: 'მხოლოდ ჰოსტს შეუძლია რიგის შეცვლა' };
    const index = room.players.findIndex(p => p.id === targetId);
    if (index < 0) return { error: 'მოთამაშე ვერ მოიძებნა' };
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= room.players.length) return {};
    const [player] = room.players.splice(index, 1);
    room.players.splice(nextIndex, 0, player);
    this.addSystemMsg('ჰოსტმა მოთამაშეების რიგი შეცვალა.');
    return {};
  }

  startGame(uid: string): Result {
    const room = this.room;
    if (room.hostPlayerId !== uid) return {};
    if (room.players.length < 2) return { error: 'მინიმუმ 2 მოთამაშეა საჭირო' };
    if (room.stage === GameStage.GameOver) this.resetGameState();
    if (room.players.length < 2) return { error: 'ახალი ხელისთვის მინიმუმ 2 დაკავშირებული მოთამაშეა საჭირო' };
    if (room.stage !== GameStage.Lobby) return { error: 'თამაში ამ სტადიაზე ვერ დაიწყება' };

    const n = room.players.length;
    room.boardPlayerCount = Math.max(5, n);
    const roles = _.shuffle(this.getRolesForCount(n));
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
    this.addSystemMsg('თამაში დაიწყო! გაეცანით თქვენს როლებს.');
    return {};
  }

  finishReveal(uid: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.RoleReveal) return {};
    const player = this.getPlayer(uid);
    if (!player || !player.alive) return {};
    if (!room.readyPlayerIds.includes(uid)) room.readyPlayerIds.push(uid);
    if (room.readyPlayerIds.length === this.alivePlayers().length) {
      room.stage = GameStage.Nomination;
      this.addSystemMsg('ყველა მზადაა. პრეზიდენტი ასახელებს კანცლერს.');
    }
    return {};
  }

  nominateChancellor(uid: string, targetId: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.Nomination || room.currentPresidentId !== uid) return {};
    const target = this.getPlayer(targetId);
    if (!target || !target.alive || target.id === uid) return {};
    if (!this.canNominate(uid, targetId)) return { error: 'ეს მოთამაშე ამ რაუნდში კანდიდატი ვერ იქნება' };
    room.currentChancellorCandidateId = targetId;
    room.stage = GameStage.Voting;
    room.votes = {};
    room.pendingElectionResult = null;
    this.addSystemMsg(`პრეზიდენტმა კანცლერობის კანდიდატად დაასახელა ${target.name}. დროა ხმის მიცემის.`);
    this.resolveElectionIfReady();
    return {};
  }

  castVote(uid: string, vote: 'Ja' | 'Nein'): Result {
    const room = this.room;
    if (room.stage !== GameStage.Voting) return {};
    if (room.pendingElectionResult) return { error: 'ხმის მიცემა დასრულებულია. დაელოდეთ ჰოსტის შემდეგ ბრძანებას.' };
    const p = this.getPlayer(uid);
    if (!p || !p.alive) return {};
    if (room.currentPresidentId === uid || room.currentChancellorCandidateId === uid) {
      return { error: 'პრეზიდენტი და კანცლერობის კანდიდატი ვერ ხმას აძლევენ' };
    }
    room.votes[uid] = vote;
    this.resolveElectionIfReady();
    return {};
  }

  continueElection(uid: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.Voting || !room.pendingElectionResult) return {};
    if (room.hostPlayerId !== uid) return { error: 'მხოლოდ ჰოსტს შეუძლია გაგრძელება' };
    this.doContinueElection();
    return {};
  }

  presidentDiscard(uid: string, policyId: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.LegislativePresident || room.currentPresidentId !== uid) return {};
    const idx = room.legislativeHand.findIndex(p => p.id === policyId);
    if (idx === -1) return {};
    room.discardPile.push(room.legislativeHand.splice(idx, 1)[0]);
    room.stage = GameStage.LegislativeChancellor;
    return {};
  }

  chancellorEnact(uid: string, policyId: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.LegislativeChancellor || room.currentChancellorId !== uid) return {};
    const idx = room.legislativeHand.findIndex(p => p.id === policyId);
    if (idx === -1) return {};
    const enacted = room.legislativeHand.splice(idx, 1)[0];
    const discarded = room.legislativeHand.pop()!;
    room.discardPile.push(discarded);
    if (enacted.type === PolicyType.Liberal) room.liberalPoliciesEnacted++;
    else room.fascistPoliciesEnacted++;
    this.addSystemMsg(`ახალი კანონი: ${enacted.type === PolicyType.Liberal ? 'ლიბერალური' : 'ფაშისტური'}`);
    this.ensureDeck(3);
    if (this.checkPolicyWin()) return {};
    let powerTriggered = false;
    if (enacted.type === PolicyType.Fascist) {
      room.pendingPower = this.getExecutivePowerForPolicy(room.fascistPoliciesEnacted);
      if (room.pendingPower) { room.stage = GameStage.ExecutiveAction; powerTriggered = true; }
    }
    if (!powerTriggered) this.endLegislative();
    return {};
  }

  requestVeto(uid: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.LegislativeChancellor || room.currentChancellorId !== uid) return {};
    if (room.fascistPoliciesEnacted < 5) return {};
    room.vetoRequested = true;
    this.addSystemMsg('კანცლერმა ვეტო მოითხოვა. პრეზიდენტი უნდა დათანხმდეს ან უარყოს.');
    return {};
  }

  respondToVeto(uid: string, accept: boolean): Result {
    const room = this.room;
    if (room.stage !== GameStage.LegislativeChancellor || room.currentPresidentId !== uid) return {};
    if (accept) {
      this.addSystemMsg('პრეზიდენტი დათანხმდა ვეტოს. კანონები გაუქმდა.');
      room.discardPile.push(...room.legislativeHand);
      room.legislativeHand = [];
      room.electionTracker++;
      if (room.electionTracker === 3 && this.enactTopPolicy()) return {};
      this.endLegislative();
    } else {
      this.addSystemMsg('პრეზიდენტმა უარყო ვეტო. კანცლერმა უნდა აირჩიოს კანონი.');
      room.vetoRequested = false;
    }
    return {};
  }

  executePower(uid: string, targetId: string): Result {
    const room = this.room;
    if (room.stage !== GameStage.ExecutiveAction || room.currentPresidentId !== uid) return {};
    const power = room.pendingPower;
    const target = this.getPlayer(targetId);

    if (power === ExecutivePower.InvestigateLoyalty) {
      if (!target || !target.alive || target.id === uid) return {};
      this.investigations[uid] = { id: nanoid(), targetName: target.name, party: target.partyMembership! };
      target.investigatedBy = [...(target.investigatedBy || []), uid];
      this.addSystemMsg(`პრეზიდენტმა გამოიძია ${target.name}-ს ერთგულება.`);
    } else if (power === ExecutivePower.Execution) {
      if (!target || !target.alive || target.id === uid) return {};
      target.alive = false;
      this.addSystemMsg(`პრეზიდენტმა სიკვდილით დასაჯა ${target.name}!`);
      if (target.role === Role.Hitler) {
        room.stage = GameStage.GameOver; room.winner = 'Liberal'; room.winReason = 'ჰიტლერი მოკლეს!';
        return {};
      }
    } else if (power === ExecutivePower.SpecialElection) {
      if (!target || !target.alive || target.id === uid) return {};
      room.specialElectionReturnIndex = room.currentPresidentIndex;
      room.currentPresidentId = target.id;
      room.lastElectedPresidentId = room.playerOrder[room.currentPresidentIndex];
      room.lastElectedChancellorId = room.currentChancellorId;
      room.stage = GameStage.Nomination;
      room.pendingPower = null;
      return {};
    } else if (power === ExecutivePower.PolicyPeek) {
      this.addSystemMsg('პრეზიდენტმა დასტის ზედა კანონები ნახა.');
    }

    room.pendingPower = null;
    this.endLegislative();
    return {};
  }

  sendMessage(uid: string, text: string): Result {
    const room = this.room;
    const p = this.getPlayer(uid);
    if (!p || (!p.alive && room.stage !== GameStage.GameOver)) return {};
    room.chat.push({ id: nanoid(), senderId: uid, senderName: p.name, text: text.slice(0, 200), timestamp: Date.now() });
    if (room.chat.length > 60) room.chat = room.chat.slice(-60);
    return {};
  }

  // ---- secured views -------------------------------------------------------

  secureRoom(playerId: string): any {
    const room = this.room;
    const p = this.getPlayer(playerId);
    if (!p) return room;
    const securedPlayers = room.players.map(player => {
      const isSelf = player.id === playerId;
      const canSeeRole = room.stage === GameStage.GameOver || isSelf ||
        (p.role === Role.Fascist && (player.role === Role.Fascist || player.role === Role.Hitler)) ||
        (p.role === Role.Hitler && room.players.length <= 6 && player.role === Role.Fascist);
      return { ...player, role: canSeeRole ? player.role : undefined, partyMembership: canSeeRole ? player.partyMembership : undefined };
    });
    const canSeeHand =
      (room.stage === GameStage.LegislativePresident && room.currentPresidentId === playerId) ||
      (room.stage === GameStage.LegislativeChancellor && room.currentChancellorId === playerId);
    const view: any = {
      ...room,
      players: securedPlayers,
      drawPile: [],
      discardPile: [],
      drawPileCount: room.drawPile.length,
      discardPileCount: room.discardPile.length,
      legislativeHand: canSeeHand ? room.legislativeHand : [],
    };
    // Private president reveals delivered through the president's own view doc.
    if (this.investigations[playerId]) view._investigationResult = this.investigations[playerId];
    if (room.stage === GameStage.ExecutiveAction && room.pendingPower === ExecutivePower.PolicyPeek && room.currentPresidentId === playerId) {
      view._peekResults = room.drawPile.slice(0, 3);
    }
    return view;
  }

  secureBoardRoom(): any {
    const room = this.room;
    const president = this.getPlayer(room.currentPresidentId);
    const chancellorCandidate = room.currentChancellorCandidateId ? this.getPlayer(room.currentChancellorCandidateId) : null;
    const chancellor = room.currentChancellorId ? this.getPlayer(room.currentChancellorId) : null;
    return {
      code: room.code,
      stage: room.stage,
      currentPresidentName: president?.name || null,
      currentChancellorCandidateName: chancellorCandidate?.name || null,
      currentChancellorName: chancellor?.name || null,
      votes: Object.entries(room.votes).map(([playerId, vote]) => ({ playerName: this.getPlayer(playerId)?.name || 'უცნობი', vote })),
      playerCount: this.boardPlayerCount(),
      aliveCount: this.alivePlayers().length,
      liberalPoliciesEnacted: room.liberalPoliciesEnacted,
      fascistPoliciesEnacted: room.fascistPoliciesEnacted,
      electionTracker: room.electionTracker,
      drawPileCount: room.drawPile.length,
      discardPileCount: room.discardPile.length,
      winner: room.winner,
      winReason: room.winReason,
    };
  }
}
