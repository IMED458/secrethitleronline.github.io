export enum Role {
  Liberal = 'Liberal',
  Fascist = 'Fascist',
  Hitler = 'Hitler',
}

export enum PartyMembership {
  Liberal = 'Liberal',
  Fascist = 'Fascist',
}

export enum GameStage {
  Lobby = 'LOBBY',
  RoleReveal = 'ROLE_REVEAL',
  Nomination = 'NOMINATION',
  Voting = 'VOTING',
  LegislativePresident = 'LEGISLATIVE_PRESIDENT',
  LegislativeChancellor = 'LEGISLATIVE_CHANCELLOR',
  ExecutiveAction = 'EXECUTIVE_ACTION',
  GameOver = 'GAME_OVER',
}

export enum PolicyType {
  Liberal = 'Liberal',
  Fascist = 'Fascist',
}

export enum ExecutivePower {
  InvestigateLoyalty = 'Investigate loyalty',
  PolicyPeek = 'Policy peek',
  SpecialElection = 'Special election',
  Execution = 'Execution',
}

export interface Player {
  id: string;
  socketId: string;
  name: string;
  role?: Role;
  partyMembership?: PartyMembership;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  investigatedBy?: string[]; // IDs of presidents who investigated this player
}

export interface Policy {
  id: string;
  type: PolicyType;
}

export interface Vote {
  playerId: string;
  vote: 'Ja' | 'Nein';
}

export interface ElectionResult {
  ja: number;
  nein: number;
  passed: boolean;
  trackerBefore: number;
  chancellorCandidateId: string | null;
}

export interface GameRoom {
  id: string;
  code: string;
  hostPlayerId: string;
  stage: GameStage;
  players: Player[];
  playerOrder: string[]; // Order of player IDs for president rotation
  boardPlayerCount?: number; // Player count used for Secret Hitler board powers.
  currentPresidentIndex: number;
  currentPresidentId: string;
  currentChancellorCandidateId: string | null;
  currentChancellorId: string | null;
  lastElectedPresidentId: string | null;
  lastElectedChancellorId: string | null;
  specialElectionReturnIndex: number | null;
  liberalPoliciesEnacted: number;
  fascistPoliciesEnacted: number;
  electionTracker: number;
  drawPile: Policy[];
  discardPile: Policy[];
  drawPileCount?: number;
  discardPileCount?: number;
  legislativeHand: Policy[];
  votes: Record<string, 'Ja' | 'Nein'>;
  pendingElectionResult: ElectionResult | null;
  pendingPower: ExecutivePower | null;
  winner: 'Liberal' | 'Fascist' | null;
  winReason: string | null;
  vetoRequested: boolean;
  readyPlayerIds: string[];
  chat: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  senderId: string | 'SYSTEM';
  senderName: string;
  text: string;
  timestamp: number;
}
