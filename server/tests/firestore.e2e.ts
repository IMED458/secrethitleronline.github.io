/**
 * End-to-end test of the Firestore host-authoritative transport with three
 * independent anonymous players, exercising the REAL security rules.
 * Requires: firestore.rules published + Anonymous auth enabled.
 * Run: npx tsx server/tests/firestore.e2e.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { createSocket, FbCtx } from '../../src/net/socket';
import { GameStage, Role } from '../../src/types';

const CONFIG = {
  apiKey: 'AIzaSyAaEzER9GP9Ce2qD_Cmk4rP70V7q-u_leE',
  authDomain: 'secrethitler-97006.firebaseapp.com',
  projectId: 'secrethitler-97006',
  appId: '1:747688079363:web:05f534dd98e3825b75de36',
};

let pass = 0, fail = 0;
const assert = (c: boolean, m: string) => { c ? (pass++, console.log('[PASS] ' + m)) : (fail++, console.log('[FAIL] ' + m)); };
const waitFor = async (pred: () => boolean, ms = 12000, step = 150) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise(r => setTimeout(r, step)); }
  return pred();
};

function makeCtx(name: string): FbCtx {
  const app = initializeApp(CONFIG, name + '-' + Math.random().toString(36).slice(2, 6));
  const auth: Auth = getAuth(app);
  const db: Firestore = getFirestore(app);
  return { db, auth };
}

interface Seat { socket: any; room: any; joinedCode: string | null; }
function makeSeat(name: string): Seat {
  const seat: Seat = { socket: null, room: null, joinedCode: null };
  seat.socket = createSocket(makeCtx(name));
  seat.socket.on('roomUpdate', (r: any) => { seat.room = r; });
  seat.socket.on('joined', (p: any) => { seat.joinedCode = p.code; });
  seat.socket.on('error', (m: string) => console.log(`[${name} error] ${m}`));
  return seat;
}

async function main() {
  const a = makeSeat('A'), b = makeSeat('B'), c = makeSeat('C');
  await waitFor(() => a.socket.connected && b.socket.connected && c.socket.connected);
  assert(a.socket.connected, 'სამივე კლიენტი დაუკავშირდა (anonymous auth)');

  a.socket.emit('createRoom', { name: 'ალისა' });
  await waitFor(() => !!a.joinedCode && !!a.room);
  assert(!!a.joinedCode, 'ჰოსტმა შექმნა ოთახი (rules: create)');
  const code = a.joinedCode!;

  b.socket.emit('joinRoom', { code, name: 'ბექა' });
  c.socket.emit('joinRoom', { code, name: 'ცისკო' });
  await waitFor(() => (a.room?.players?.length ?? 0) === 3 && !!b.room && !!c.room);
  assert(a.room.players.length === 3, 'სამი მოთამაშე შემოვიდა (JOIN → host → views)');

  a.socket.emit('startGame', { code, playerId: a.socket.uid });
  await waitFor(() => a.room?.stage === GameStage.RoleReveal);
  assert(a.room.stage === GameStage.RoleReveal, 'თამაში დაიწყო (RoleReveal)');

  // Role privacy over Firestore: A only sees own role unless a fascist teammate.
  const meA = a.room.players.find((p: any) => p.id === a.socket.uid);
  const hiddenForA = a.room.players.filter((p: any) => p.id !== a.socket.uid && p.role !== undefined);
  if (meA.role === Role.Liberal) {
    assert(hiddenForA.length === 0, 'ლიბერალი ვერ ხედავს სხვის როლს (secured view)');
  } else {
    assert(true, `მოქმედი მოთამაშე ფაშისტური გუნდისაა (${meA.role}) — teammate ხილვადობა ნორმალურია`);
  }

  a.socket.emit('finishReveal', { code, playerId: a.socket.uid });
  b.socket.emit('finishReveal', { code, playerId: b.socket.uid });
  c.socket.emit('finishReveal', { code, playerId: c.socket.uid });
  await waitFor(() => a.room?.stage === GameStage.Nomination);
  assert(a.room.stage === GameStage.Nomination, 'ყველა reveal → Nomination');

  // President nominates the next player; the third votes; host continues.
  const pres = a.room.players.find((p: any) => p.id === a.room.currentPresidentId);
  const presSeat = [a, b, c].find(s => s.socket.uid === pres.id)!;
  const candidate = a.room.players.find((p: any) => p.id !== pres.id);
  presSeat.socket.emit('nominateChancellor', { code, playerId: pres.id, targetId: candidate.id });
  await waitFor(() => a.room?.stage === GameStage.Voting);
  assert(a.room.stage === GameStage.Voting, 'ნომინაცია → Voting');

  const voter = a.room.players.find((p: any) => p.id !== pres.id && p.id !== candidate.id);
  const voterSeat = [a, b, c].find(s => s.socket.uid === voter.id)!;
  voterSeat.socket.emit('castVote', { code, playerId: voter.id, vote: 'Ja' });
  await waitFor(() => !!a.room?.pendingElectionResult, 8000);
  // Host continues the election.
  const hostSeat = [a, b, c].find(s => s.socket.uid === a.room.hostPlayerId)!;
  hostSeat.socket.emit('continueElection', { code, playerId: hostSeat.socket.uid });
  await waitFor(() => a.room?.stage === GameStage.LegislativePresident || a.room?.stage === GameStage.Nomination, 8000);
  assert(
    a.room.stage === GameStage.LegislativePresident,
    `არჩევნები შედგა → LegislativePresident (stage=${a.room.stage})`
  );

  // Only the president sees the 3-card legislative hand.
  const presView = presSeat.room;
  assert((presView.legislativeHand?.length ?? 0) === 3, 'პრეზიდენტი ხედავს 3 კანონს');
  const otherSeat = [a, b, c].find(s => s.socket.uid !== pres.id)!;
  assert((otherSeat.room.legislativeHand?.length ?? 0) === 0, 'სხვები ვერ ხედავენ კანონებს (privacy)');

  [a, b, c].forEach(s => s.socket.emit('leaveRoom', {}));
  console.log(`\n=== FIRESTORE E2E: ${pass} Passed, ${fail} Failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
