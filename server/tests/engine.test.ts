/**
 * Headless unit test for the transport-agnostic ShRoom authority.
 * No Firestore — plays full Secret Hitler games in-process.
 * Run: tsx server/tests/engine.test.ts
 */
import { ShRoom } from '../../src/game/engine';
import { GameStage, Role, PartyMembership } from '../../src/types';

let pass = 0, fail = 0;
const assert = (c: boolean, m: string) => { c ? (pass++, console.log('[PASS] ' + m)) : (fail++, console.log('[FAIL] ' + m)); };

function setup(n: number): { room: ShRoom; uids: string[] } {
  const uids = Array.from({ length: n }, (_, i) => 'u' + i);
  const room = ShRoom.create(uids[0], 'P0', 'ROOM' + n);
  for (let i = 1; i < n; i++) room.join(uids[i], 'P' + i);
  return { room, uids };
}

function playFullGame(n: number) {
  const { room, uids } = setup(n);
  assert(room.room.players.length === n, `${n}p: ${n} მოთამაშე ოთახში`);

  room.startGame(uids[0]);
  assert(room.room.stage === GameStage.RoleReveal, `${n}p: RoleReveal სტადია`);
  const hitlers = room.room.players.filter(p => p.role === Role.Hitler).length;
  const fascists = room.room.players.filter(p => p.role === Role.Fascist).length;
  const libs = room.room.players.filter(p => p.role === Role.Liberal).length;
  assert(hitlers === 1, `${n}p: ზუსტად 1 ჰიტლერი`);
  assert(libs + fascists + hitlers === n, `${n}p: როლები ყველას მიენიჭა`);

  // Secured-view privacy: a Liberal must not see anyone else's role pre-game-over.
  const lib = room.room.players.find(p => p.role === Role.Liberal)!;
  const libView = room.secureRoom(lib.id);
  const leak = libView.players.filter((p: any) => p.id !== lib.id && p.role !== undefined).length;
  assert(leak === 0, `${n}p: ლიბერალი ვერ ხედავს სხვის როლს`);

  uids.forEach(u => room.finishReveal(u));
  assert(room.room.stage === GameStage.Nomination, `${n}p: ყველა reveal-ის შემდეგ Nomination`);

  const aliveOthers = (exclude: string[]) => room.room.players.filter(p => p.alive && !exclude.includes(p.id));

  let guard = 0;
  while (room.room.stage !== GameStage.GameOver && guard < 400) {
    guard++;
    const r = room.room;
    switch (r.stage) {
      case GameStage.Nomination: {
        const pres = r.currentPresidentId;
        const cand = aliveOthers([pres]).find(p => (room as any).canNominate ? true : true);
        // pick first alive non-president who is nominable
        const target = aliveOthers([pres]).find(p =>
          p.id !== r.lastElectedChancellorId &&
          !(room.room.players.filter(x => x.alive).length > 5 && p.id === r.lastElectedPresidentId)
        ) || aliveOthers([pres])[0];
        if (!target) { r.stage = GameStage.GameOver; break; }
        room.nominateChancellor(pres, target.id);
        break;
      }
      case GameStage.Voting: {
        if (r.pendingElectionResult) { room.continueElection(r.hostPlayerId); break; }
        const voters = r.players.filter(p => p.alive && p.id !== r.currentPresidentId && p.id !== r.currentChancellorCandidateId);
        // Vote Ja mostly, but Nein sometimes to exercise the tracker.
        voters.forEach((v, i) => room.castVote(v.id, guard % 7 === 0 && i === 0 ? 'Nein' : 'Ja'));
        if (r.pendingElectionResult) room.continueElection(r.hostPlayerId);
        break;
      }
      case GameStage.LegislativePresident:
        room.presidentDiscard(r.currentPresidentId, r.legislativeHand[0].id);
        break;
      case GameStage.LegislativeChancellor:
        room.chancellorEnact(r.currentChancellorId!, r.legislativeHand[0].id);
        break;
      case GameStage.ExecutiveAction: {
        const pres = r.currentPresidentId;
        const target = aliveOthers([pres])[0];
        room.executePower(pres, target ? target.id : pres);
        break;
      }
      default:
        room.finishReveal(r.currentPresidentId);
        break;
    }
  }

  assert(room.room.stage === GameStage.GameOver, `${n}p: თამაში დასრულდა (guard=${guard})`);
  assert(room.room.winner === 'Liberal' || room.room.winner === 'Fascist', `${n}p: გამარჯვებული განისაზღვრა (${room.room.winner}: ${room.room.winReason})`);
  const totalPolicies = room.room.liberalPoliciesEnacted + room.room.fascistPoliciesEnacted;
  assert(totalPolicies >= 0 && room.room.liberalPoliciesEnacted <= 5 && room.room.fascistPoliciesEnacted <= 6,
    `${n}p: კანონების რაოდენობა ვალიდურია (L=${room.room.liberalPoliciesEnacted}, F=${room.room.fascistPoliciesEnacted})`);
  // At game over everyone can see all roles.
  const overView = room.secureRoom(uids[0]);
  assert(overView.players.every((p: any) => p.role !== undefined), `${n}p: GameOver-ზე ყველა როლი ჩანს`);
}

console.log('=== SECRET HITLER ENGINE TESTS ===');
for (const n of [5, 6, 7, 9]) playFullGame(n);

// Fascist team knowledge in a small game.
{
  const { room, uids } = setup(5);
  room.startGame(uids[0]);
  const fascist = room.room.players.find(p => p.role === Role.Fascist)!;
  const view = room.secureRoom(fascist.id);
  const seesHitler = view.players.some((p: any) => p.role === Role.Hitler);
  assert(seesHitler, '5p: ფაშისტი ხედავს ჰიტლერს');
}

console.log(`\n=== SUMMARY: ${pass} Passed, ${fail} Failed ===`);
process.exit(fail > 0 ? 1 : 0);
