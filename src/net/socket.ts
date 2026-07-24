/**
 * Firestore-backed drop-in replacement for the Socket.IO client.
 *
 * Exposes the small slice of the socket.io API the app uses (on/off/once/emit/
 * connected) so App.tsx barely changes. Under the hood: anonymous auth, a
 * host-authoritative ShRoom engine that runs in the room creator's browser,
 * an `actions` queue, and per-player secured `views` documents.
 *
 * Firestore layout:
 *   rooms/{code}                      public: {hostUid, memberUids, publicPlayers, board, stage}
 *   rooms/{code}/state/full           host-only: the full room (roles, deck)
 *   rooms/{code}/views/{uid}          per-player secured room (read: own uid)
 *   rooms/{code}/actions/{id}         action queue (create: anyone; read/delete: host)
 */
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Firestore, Unsubscribe,
} from 'firebase/firestore';
import { Auth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { db as defaultDb, auth as defaultAuth } from '../firebase';
import { ShRoom, genCode } from '../game/engine';

type Handler = (payload?: any) => void;
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export interface FbCtx { db: Firestore; auth: Auth; }

class ShimSocket {
  connected = false;
  uid = '';
  private db: Firestore;
  private auth: Auth;
  private handlers: Record<string, Set<Handler>> = {};

  private code: string | null = null;
  private myName = '';
  private engine: ShRoom | null = null;
  private hostRunning = false;
  private becomingHost = false;
  private actionChain: Promise<void> = Promise.resolve();
  private actionUnsub: Unsubscribe | null = null;
  private roomUnsubs: Unsubscribe[] = [];
  private wasMember = false;
  private leftVoluntarily = false;
  private lastInvestigationId: string | null = null;
  private lastPeek: any[] | null = null;

  constructor(ctx?: FbCtx) {
    this.db = ctx?.db ?? defaultDb;
    this.auth = ctx?.auth ?? defaultAuth;
    void this.boot();
  }

  private signIn(): Promise<string> {
    if (this.auth.currentUser) return Promise.resolve(this.auth.currentUser.uid);
    return new Promise<string>((resolve, reject) => {
      const unsub = onAuthStateChanged(this.auth, (u) => { if (u) { unsub(); resolve(u.uid); } });
      signInAnonymously(this.auth).catch((e) => { unsub(); reject(e); });
    });
  }

  private async boot() {
    try {
      this.uid = await this.signIn();
      this.connected = true;
      this.fire('connect');
    } catch {
      this.fire('error', 'Firebase-თან დაკავშირება ვერ მოხერხდა');
    }
  }

  // ---- socket.io-like emitter API ----
  on(event: string, cb: Handler) { (this.handlers[event] ||= new Set()).add(cb); }
  off(event: string, cb?: Handler) { if (cb) this.handlers[event]?.delete(cb); else delete this.handlers[event]; }
  once(event: string, cb: Handler) { const w: Handler = (p) => { this.off(event, w); cb(p); }; this.on(event, w); }
  private fire(event: string, payload?: any) { this.handlers[event]?.forEach((h) => h(payload)); }

  emit(event: string, payload: any = {}) {
    switch (event) {
      case 'createRoom': void this.createRoom(payload.name); break;
      case 'joinRoom': void this.joinRoom(payload.code, payload.name); break;
      case 'rejoinRoom': void this.rejoinRoom(payload.code); break;
      case 'watchRoom': void this.watchRoom(payload.code); break;
      case 'leaveRoom': void this.leaveRoom(); break;
      case 'peekReady': this.fire('peekResults', this.lastPeek || []); break;
      default: void this.sendAction(this.mapEventToAction(event), payload); break;
    }
  }

  private mapEventToAction(event: string): string {
    // App emits the same names the old server used; the host maps them back.
    return event;
  }

  // ---- refs ----
  private roomRef(code = this.code!) { return doc(this.db, 'rooms', code); }
  private fullRef(code = this.code!) { return doc(this.db, 'rooms', code, 'state', 'full'); }
  private viewRef(uid: string, code = this.code!) { return doc(this.db, 'rooms', code, 'views', uid); }
  private actionsCol(code = this.code!) { return collection(this.db, 'rooms', code, 'actions'); }

  // ---- room lifecycle ----
  private async createRoom(name: string) {
    await this.ensureUid();
    this.resetRoomState();
    this.myName = name;
    const code = genCode();
    this.code = code;
    this.engine = ShRoom.create(this.uid, name, code);
    await this.persist();
    this.startHost();
    this.subscribe(code);
    this.fire('joined', { code, playerId: this.uid });
  }

  private async joinRoom(codeRaw: string, name: string) {
    await this.ensureUid();
    const code = String(codeRaw || '').toUpperCase();
    const snap = await getDoc(this.roomRef(code));
    if (!snap.exists() || (snap.data() as any).deleted) return this.fire('error', 'ოთახი ვერ მოიძებნა');
    const pub = snap.data() as any;
    const already = (pub.publicPlayers || []).some((p: any) => p.id === this.uid);
    if (!already) {
      if ((pub.publicPlayers || []).length >= 10) return this.fire('error', 'ოთახი სავსეა');
      if ((pub.publicPlayers || []).some((p: any) => p.name === name)) return this.fire('error', 'სახელი დაკავებულია');
    }
    this.resetRoomState();
    this.myName = name;
    this.code = code;
    this.subscribe(code);
    await this.sendAction('JOIN', { name });
    await this.maybeBecomeHost(pub.hostUid);
    this.fire('joined', { code, playerId: this.uid });
  }

  private async rejoinRoom(codeRaw: string) {
    await this.ensureUid();
    const code = String(codeRaw || '').toUpperCase();
    const snap = await getDoc(this.roomRef(code));
    if (!snap.exists() || (snap.data() as any).deleted) return this.fire('error', 'ოთახი ვერ მოიძებნა');
    const pub = snap.data() as any;
    if (!(pub.publicPlayers || []).some((p: any) => p.id === this.uid)) {
      return this.fire('error', 'ამ ოთახში თქვენი ადგილი ვერ მოიძებნა');
    }
    this.resetRoomState();
    this.code = code;
    this.subscribe(code);
    await this.sendAction('rejoin', {});
    await this.maybeBecomeHost(pub.hostUid);
    this.fire('joined', { code, playerId: this.uid });
  }

  private async watchRoom(codeRaw: string) {
    await this.ensureUid();
    const code = String(codeRaw || '').toUpperCase();
    this.roomUnsubs.push(onSnapshot(this.roomRef(code), (snap) => {
      if (!snap.exists()) { this.fire('boardError', 'ოთახი ვერ მოიძებნა'); return; }
      this.fire('boardUpdate', (snap.data() as any).board);
    }));
  }

  private async leaveRoom() {
    this.leftVoluntarily = true;
    if (this.code) await this.sendAction('leaveRoom', {}).catch(() => {});
    this.teardown();
    this.fire('leftRoom');
  }

  // ---- subscriptions ----
  private subscribe(code: string) {
    // My secured view → drives the UI.
    this.roomUnsubs.push(onSnapshot(this.viewRef(this.uid, code), (snap) => {
      if (!snap.exists()) return;
      const view = snap.data() as any;
      if (view._investigationResult && view._investigationResult.id !== this.lastInvestigationId) {
        this.lastInvestigationId = view._investigationResult.id;
        this.fire('investigationResult', { targetName: view._investigationResult.targetName, party: view._investigationResult.party });
      }
      this.lastPeek = view._peekResults || null;
      this.fire('roomUpdate', view);
    }));

    // Public doc → host migration + kick detection.
    this.roomUnsubs.push(onSnapshot(this.roomRef(code), (snap) => {
      if (!snap.exists()) return;
      const pub = snap.data() as any;
      const members: string[] = pub.memberUids || [];
      if (members.includes(this.uid)) this.wasMember = true;
      void this.maybeBecomeHost(pub.hostUid);
      if (this.wasMember && !members.includes(this.uid) && !this.leftVoluntarily) {
        this.fire('kickedRoom', 'ჰოსტმა გაგაგდოთ ოთახიდან');
        this.teardown();
      }
    }));
  }

  // ---- host authority ----
  private async maybeBecomeHost(hostUid: string) {
    if (hostUid !== this.uid || this.hostRunning || this.becomingHost || !this.code) return;
    this.becomingHost = true;
    try {
      if (!this.engine) {
        const full = await getDoc(this.fullRef());
        if (full.exists()) this.engine = new ShRoom((full.data() as any).room);
      }
      if (this.engine) this.startHost();
    } finally {
      this.becomingHost = false;
    }
  }

  private startHost() {
    if (this.hostRunning || !this.code || !this.engine) return;
    this.hostRunning = true;
    this.actionUnsub = onSnapshot(query(this.actionsCol(), orderBy('ts', 'asc')), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const id = ch.doc.id;
        const data = ch.doc.data() as any;
        this.actionChain = this.actionChain.then(() => this.processAction(id, data)).catch((e) => console.error('action', e));
      });
    });
  }

  private async processAction(id: string, action: { uid: string; type: string; payload?: any }) {
    const eng = this.engine;
    if (!eng) return;
    const { uid, type, payload } = action;
    const p = payload || {};
    let res: { error?: string } | undefined;
    switch (type) {
      case 'JOIN': res = eng.join(uid, p.name); break;
      case 'rejoin': res = eng.rejoin(uid); break;
      case 'leaveRoom': res = eng.leave(uid); break;
      case 'kickPlayer': res = eng.kick(uid, p.targetId); break;
      case 'movePlayer': res = eng.movePlayer(uid, p.targetId, p.direction); break;
      case 'startGame': res = eng.startGame(uid); break;
      case 'finishReveal': res = eng.finishReveal(uid); break;
      case 'nominateChancellor': res = eng.nominateChancellor(uid, p.targetId); break;
      case 'castVote': res = eng.castVote(uid, p.vote); break;
      case 'continueElection': res = eng.continueElection(uid); break;
      case 'presidentDiscard': res = eng.presidentDiscard(uid, p.policyId); break;
      case 'chancellorEnact': res = eng.chancellorEnact(uid, p.policyId); break;
      case 'requestVeto': res = eng.requestVeto(uid); break;
      case 'respondToVeto': res = eng.respondToVeto(uid, p.accept); break;
      case 'executePower': res = eng.executePower(uid, p.targetId); break;
      case 'sendMessage': res = eng.sendMessage(uid, p.text); break;
    }
    // Route validation errors back to the local actor only.
    if (res?.error && uid === this.uid) this.fire('error', res.error);
    await this.persist();
    await deleteDoc(doc(this.db, 'rooms', this.code!, 'actions', id)).catch(() => {});
  }

  private async persist() {
    const eng = this.engine;
    if (!eng || !this.code) return;
    const room = eng.room;
    if (room._deleted) {
      this.teardown();
      return;
    }
    const publicPlayers = room.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, connected: p.connected, isHost: p.isHost }));
    await setDoc(this.roomRef(), clean({
      hostUid: room.hostPlayerId,
      memberUids: room.players.map((p) => p.id),
      code: room.code,
      stage: room.stage,
      publicPlayers,
      board: eng.secureBoardRoom(),
      updatedAt: Date.now(),
    }));
    await setDoc(this.fullRef(), clean({ room }));
    for (const player of room.players) {
      await setDoc(this.viewRef(player.id), clean(eng.secureRoom(player.id)));
    }
  }

  private async sendAction(type: string, payload: any) {
    if (!this.code) return;
    await addDoc(this.actionsCol(), { uid: this.uid, type, payload: payload ?? null, ts: serverTimestamp() });
  }

  private async ensureUid() {
    if (!this.uid) { this.uid = await this.signIn(); this.connected = true; }
  }

  private resetRoomState() {
    this.teardown(true);
  }

  private teardown(keepUid = true) {
    this.roomUnsubs.forEach((u) => u());
    this.roomUnsubs = [];
    if (this.actionUnsub) { this.actionUnsub(); this.actionUnsub = null; }
    this.hostRunning = false;
    this.becomingHost = false;
    this.engine = null;
    this.code = null;
    this.wasMember = false;
    this.leftVoluntarily = false;
    this.lastInvestigationId = null;
    this.lastPeek = null;
    if (!keepUid) this.uid = '';
  }
}

export type Socket = ShimSocket;
export function createSocket(ctx?: FbCtx): ShimSocket { return new ShimSocket(ctx); }
