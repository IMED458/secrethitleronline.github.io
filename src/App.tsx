function ElectionPanel({ room, playerId, vote, continueElection }: { room: GameRoom; playerId: string; vote: (v: 'Ja' | 'Nein') => void; continueElection: () => void }) {
  const president = room.players.find(p => p.id === room.currentPresidentId);
  const candidate = room.players.find(p => p.id === room.currentChancellorCandidateId);
  const me = room.players.find(p => p.id === playerId);
  const hasVoted = room.votes[playerId] !== undefined;
  const voters = room.players.filter(p => p.alive);
  const electionResult = room.pendingElectionResult;
  const voteLabel = (value?: 'Ja' | 'Nein') => value === 'Ja' ? 'კი' : value === 'Nein' ? 'არა' : 'ელოდება';
  const voteTone = (value?: 'Ja' | 'Nein') => value === 'Ja' ? 'text-green-400 border-green-500/30 bg-green-950/20' : value === 'Nein' ? 'text-red-400 border-red-500/30 bg-red-950/20' : 'text-[#555] border-[#333] bg-[#111]';
  const voteRows = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {voters.map(player => (
        <div key={player.id} className="bg-[#111] border border-[#252525] rounded-lg p-3 flex items-center justify-between gap-3">
          <span className="font-bold truncate">{player.name}</span>
          <span className={`text-xs font-black uppercase border rounded-full px-3 py-1 ${voteTone(room.votes[player.id])}`}>
            {voteLabel(room.votes[player.id])}
          </span>
        </div>
      ))}
    </div>
  );

  const isPresidentOrCandidate = room.currentPresidentId === playerId || room.currentChancellorCandidateId === playerId;

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-4 md:p-6 space-y-4">
      {room.electionTracker === 2 && (
        <div className="bg-yellow-950/30 border border-yellow-500/40 text-yellow-300 rounded-xl p-3 text-sm font-bold">
          მესამე არჩევანია. თუ ეს არჩევნებიც ჩავარდება, კანონი ავტომატურად აირჩევა.
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl md:text-2xl font-black uppercase italic text-yellow-500">არჩევნები</h3>
          <p className="text-sm text-[#888] mt-1">
            პრეზიდენტი: <span className="text-[#ddd] font-bold">{president?.name}</span>
          </p>
          <p className="text-sm text-[#888]">
            კანცლერის კანდიდატი: <span className="text-[#ddd] font-bold">{candidate?.name}</span>
          </p>
        </div>
        <div className="text-xs bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-[#888]">
          ხმები {Object.keys(room.votes).length}/{voters.length}
        </div>
      </div>

      {electionResult ? (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 text-center border ${electionResult.passed ? 'bg-green-950/20 border-green-500/30 text-green-400' : 'bg-red-950/20 border-red-500/30 text-red-400'}`}>
            <div className="text-2xl font-black uppercase italic">
              {electionResult.passed ? 'მთავრობა აირჩა' : 'არჩევნები ჩავარდა'}
            </div>
            <div className="text-sm font-bold mt-1">
              კი: {electionResult.ja} / არა: {electionResult.nein}
            </div>
          </div>
          {voteRows}
          {me?.isHost ? (
            <button
              onClick={continueElection}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl py-4 font-black uppercase italic active:scale-95"
            >
              შემდეგი
            </button>
          ) : (
            <div className="bg-[#111] border border-[#333] rounded-xl p-3 text-sm text-[#888] font-bold text-center">
              ველოდებით ჰოსტის ღილაკს: შემდეგი
            </div>
          )}
        </div>
      ) : isPresidentOrCandidate ? (
        <div className="space-y-3">
          <div className="bg-blue-950/20 border border-blue-500/30 text-blue-400 rounded-xl p-4 text-center font-bold">
            {room.currentPresidentId === playerId ? 'თქვენ პრეზიდენტი ხართ' : 'თქვენ კანცლერობის კანდიდატი ხართ'} - ხმას ვერ აძლევთ
          </div>
          {voteRows}
        </div>
      ) : hasVoted ? (
        <div className="space-y-3">
          <div className="bg-yellow-950/20 border border-yellow-500/30 text-yellow-400 rounded-xl p-4 text-center font-bold">
            თქვენი ხმა მიღებულია. ველოდებით დანარჩენებს.
          </div>
          {voteRows}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="font-bold text-[#ddd]">უჭერთ მხარს ამ მთავრობას?</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => vote('Ja')} className="bg-green-900/20 border-2 border-green-500 text-green-400 rounded-xl py-4 flex flex-col items-center justify-center gap-1 font-black uppercase italic active:scale-95">
              <Check size={34} strokeWidth={4}/>
              კი
            </button>
            <button onClick={() => vote('Nein')} className="bg-red-900/20 border-2 border-red-500 text-red-400 rounded-xl py-4 flex flex-col items-center justify-center gap-1 font-black uppercase italic active:scale-95">
              <X size={34} strokeWidth={4}/>
              არა
            </button>
          </div>
          {voteRows}
        </div>
      )}
    </div>
  );
}