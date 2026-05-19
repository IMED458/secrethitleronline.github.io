/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  GameRoom, 
  GameStage, 
  Player, 
  Role, 
  Policy,
  PolicyType, 
  ExecutivePower,
  PartyMembership
} from './types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Shield, 
  UserX,
  Check, 
  X, 
  Send, 
  Crown, 
  Search, 
  Eye, 
  Skull,
  Settings,
  Copy,
  LogOut,
  BookOpen,
  Bird,
  ShieldAlert,
  Monitor,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

const socket: Socket = io();

type BoardSnapshot = {
  code: string;
  stage: GameStage;
  playerCount: number;
  aliveCount: number;
  liberalPoliciesEnacted: number;
  fascistPoliciesEnacted: number;
  electionTracker: number;
  drawPileCount: number;
  discardPileCount: number;
  winner: 'Liberal' | 'Fascist' | null;
  winReason: string | null;
};

export default function App() {
  const boardCodeFromUrl = new URLSearchParams(window.location.search).get('board')?.toUpperCase() || '';
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(localStorage.getItem('playerId'));
  const [name, setName] = useState(localStorage.getItem('name') || '');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [monitorCodeInput, setMonitorCodeInput] = useState(boardCodeFromUrl);
  const [boardSnapshot, setBoardSnapshot] = useState<BoardSnapshot | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [investigationResult, setInvestigationResult] = useState<{ targetName: string, party: PartyMembership } | null>(null);
  const [peekResult, setPeekResult] = useState<any[] | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState<'board' | 'players' | 'chat'>('board');
  const [showRole, setShowRole] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const reconnectAttempted = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('joined', ({ code, playerId }: { code: string, playerId: string }) => {
      setPlayerId(playerId);
      localStorage.setItem('playerId', playerId);
      localStorage.setItem('name', name);
      localStorage.setItem('roomCode', code);
    });

    socket.on('roomUpdate', (updatedRoom: GameRoom) => {
      setRoom(updatedRoom);
      setError(null);
    });

    socket.on('error', (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    socket.on('investigationResult', (res) => {
      setInvestigationResult(res);
    });

    socket.on('peekResults', (policies) => {
      setPeekResult(policies);
    });

    socket.on('leftRoom', () => {
      setRoom(null);
      setPlayerId(null);
      setRoomCodeInput('');
      setShowRole(false);
      setRoleChecked(false);
      setShowRules(false);
      setActiveTab('board');
      localStorage.removeItem('playerId');
      localStorage.removeItem('roomCode');
    });

    socket.on('kickedRoom', (message: string) => {
      setRoom(null);
      setPlayerId(null);
      setRoomCodeInput('');
      setShowRole(false);
      setRoleChecked(false);
      setShowRules(false);
      setActiveTab('board');
      localStorage.removeItem('playerId');
      localStorage.removeItem('roomCode');
      setError(message || 'ჰოსტმა გაგაგდოთ ოთახიდან');
      setTimeout(() => setError(null), 5000);
    });

    socket.on('boardUpdate', (snapshot: BoardSnapshot) => {
      setBoardSnapshot(snapshot);
      setBoardError(null);
    });

    socket.on('boardError', (msg: string) => {
      setBoardError(msg);
    });

    return () => {
      socket.off('joined');
      socket.off('roomUpdate');
      socket.off('error');
      socket.off('investigationResult');
      socket.off('peekResults');
      socket.off('leftRoom');
      socket.off('kickedRoom');
      socket.off('boardUpdate');
      socket.off('boardError');
    };
  }, [name]);

  useEffect(() => {
    if (boardCodeFromUrl) {
      const watchRoom = () => socket.emit('watchRoom', { code: boardCodeFromUrl });
      if (socket.connected) watchRoom();
      socket.on('connect', watchRoom);

      return () => {
        socket.off('connect', watchRoom);
      };
    }
  }, [boardCodeFromUrl]);

  useEffect(() => {
    if (boardCodeFromUrl) return;
    const savedCode = localStorage.getItem('roomCode');
    const savedPlayerId = localStorage.getItem('playerId');
    if (!savedCode || !savedPlayerId || reconnectAttempted.current) return;

    const rejoin = () => {
      reconnectAttempted.current = true;
      socket.emit('rejoinRoom', { code: savedCode, playerId: savedPlayerId });
    };

    if (socket.connected) rejoin();
    else socket.once('connect', rejoin);

    return () => {
      socket.off('connect', rejoin);
    };
  }, []);

  useEffect(() => {
    if (boardCodeFromUrl) return;

    const rejoinOnReconnect = () => {
      const savedCode = localStorage.getItem('roomCode');
      const savedPlayerId = localStorage.getItem('playerId');
      if (savedCode && savedPlayerId) socket.emit('rejoinRoom', { code: savedCode, playerId: savedPlayerId });
    };

    socket.on('connect', rejoinOnReconnect);
    return () => {
      socket.off('connect', rejoinOnReconnect);
    };
  }, [boardCodeFromUrl]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.chat]);

  const me = useMemo(() => room?.players.find(p => p.id === playerId), [room, playerId]);

  const createRoom = () => {
    if (!name) return setError('გთხოვთ შეიყვანოთ სახელი');
    socket.emit('createRoom', { name });
  };

  const joinRoom = () => {
    if (!name || !roomCodeInput) return setError('შეიყვანეთ სახელი და კოდი');
    socket.emit('joinRoom', { code: roomCodeInput.toUpperCase(), name });
  };

  const startGame = () => {
    if (room) socket.emit('startGame', { code: room.code, playerId });
  };

  const movePlayer = (targetId: string, direction: 'up' | 'down') => {
    if (room) socket.emit('movePlayer', { code: room.code, hostPlayerId: playerId, targetId, direction });
  };

  const finishReveal = () => {
    if (room) socket.emit('finishReveal', { code: room.code, playerId });
  };

  const nominate = (targetId: string) => {
    if (room) socket.emit('nominateChancellor', { code: room.code, playerId, targetId });
  };

  const vote = (v: 'Ja' | 'Nein') => {
    if (room) socket.emit('castVote', { code: room.code, playerId, vote: v });
  };

  const discard = (policyId: string) => {
    if (room) socket.emit('presidentDiscard', { code: room.code, playerId, policyId });
  };

  const enact = (policyId: string) => {
    if (room) socket.emit('chancellorEnact', { code: room.code, playerId, policyId });
  };

  const requestVeto = () => {
    if (room) socket.emit('requestVeto', { code: room.code, playerId });
  };

  const respondToVeto = (accept: boolean) => {
    if (room) socket.emit('respondToVeto', { code: room.code, playerId, accept });
  };

  const executePower = (targetId: string) => {
    if (room) socket.emit('executePower', { code: room.code, playerId, targetId });
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && room && playerId) {
      socket.emit('sendMessage', { code: room.code, playerId, text: chatInput });
      setChatInput('');
    }
  };

  const copyCode = () => {
    if (room) {
      navigator.clipboard.writeText(room.code);
      // toast notification would be nice here
    }
  };

  const leaveRoom = () => {
    if (room && playerId) {
      socket.emit('leaveRoom', { code: room.code, playerId });
    }
    setRoom(null);
    setPlayerId(null);
    setRoomCodeInput('');
    setShowRole(false);
    setRoleChecked(false);
    setShowRules(false);
    setActiveTab('board');
    localStorage.removeItem('playerId');
    localStorage.removeItem('roomCode');
  };

  const kickPlayer = (targetId: string) => {
    if (!room || !playerId || targetId === playerId) return;
    const target = room.players.find(player => player.id === targetId);
    if (!target) return;
    const confirmed = window.confirm(`${target.name}-ის გაგდება გსურთ?`);
    if (!confirmed) return;
    socket.emit('kickPlayer', { code: room.code, hostPlayerId: playerId, targetId });
  };

  const openMonitorBoard = () => {
    const code = monitorCodeInput.trim().toUpperCase();
    if (!code) return setError('შეიყვანეთ ოთახის კოდი');
    const url = `${window.location.origin}${window.location.pathname}?board=${encodeURIComponent(code)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (boardCodeFromUrl) {
    return <BoardOnlyView snapshot={boardSnapshot} code={boardCodeFromUrl} error={boardError} />;
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] flex items-center justify-center p-4 font-sans">
        <button
          onClick={() => setShowRules(true)}
          className="fixed top-4 right-4 z-40 flex items-center justify-center w-10 h-10 rounded-full border border-[#333] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-red-500 transition-all"
          aria-label="წესები"
          title="წესები"
        >
          <BookOpen size={18}/>
        </button>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 bg-[#1a1a1a] p-8 rounded-2xl border border-[#333] shadow-2xl"
        >
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-black text-red-600 uppercase italic">Secret Hitler</h1>
            <p className="text-[#888] text-sm">სრულიად ფუნქციური ვერსია ქართულად</p>
            <p className="text-[11px] font-bold uppercase italic text-[#666]">created by DR.IMEDO🩺</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase text-[#666] mb-1 block italic">თქვენი სახელი</label>
              <input 
                type="text" 
                maxLength={20}
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#111] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-red-600 transition-colors"
                placeholder="სახელი"
              />
            </div>

            <div className="pt-4 border-t border-[#333] space-y-4">
              <button 
                onClick={createRoom}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg transition-all active:scale-95 uppercase italic"
              >
                ოთახის შექმნა
              </button>
              
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-[#333]"></div>
                <span className="flex-shrink mx-4 text-[#444] text-xs font-bold uppercase">ან</span>
                <div className="flex-grow border-t border-[#333]"></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input 
                  type="text" 
                  maxLength={6}
                  value={roomCodeInput} 
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  className="min-w-0 flex-grow bg-[#111] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-blue-600 transition-colors text-center font-mono"
                  placeholder="CODE"
                />
                <button 
                  onClick={joinRoom}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg transition-all active:scale-95 uppercase italic whitespace-nowrap"
                >
                  შესვლა
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[#333] space-y-3">
              <label className="text-xs font-bold uppercase text-[#666] mb-1 block italic flex items-center gap-2">
                <Monitor size={14}/> მონიტორის დაფა
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={monitorCodeInput}
                  onChange={(e) => setMonitorCodeInput(e.target.value.toUpperCase())}
                  className="min-w-0 flex-grow bg-[#111] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-red-600 transition-colors text-center font-mono"
                  placeholder="CODE"
                />
                <button
                  onClick={openMonitorBoard}
                  className="bg-[#222] hover:bg-[#333] border border-[#333] text-white font-bold px-5 py-3 rounded-lg transition-all active:scale-95 uppercase italic whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <Monitor size={16}/> გახსნა
                </button>
              </div>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-red-950/20 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center"
            >
              {error}
            </motion.div>
          )}
        </motion.div>
        <RulesModal open={showRules} onClose={() => setShowRules(false)} />
      </div>
    );
  }

  // LOBBY
  if (room.stage === GameStage.Lobby) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] p-4 font-sans">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-[#1a1a1a] p-6 rounded-2xl border border-[#333]"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-xs font-bold uppercase text-[#666] italic">ოთახის კოდი</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-4xl font-mono font-black text-red-600">{room.code}</span>
                    <button onClick={copyCode} className="p-2 hover:bg-[#333] rounded-lg transition-colors text-[#666]"><Copy size={18}/></button>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button 
                    onClick={() => setShowRules(true)}
                    className="w-full sm:w-auto bg-[#222] hover:bg-[#333] border border-[#333] text-[#ddd] font-bold px-4 py-4 rounded-xl transition-all active:scale-95 uppercase italic flex items-center justify-center gap-2"
                  >
                    <BookOpen size={16}/> წესები
                  </button>
                  {me?.isHost && (
                    <button 
                      onClick={startGame}
                      disabled={room.players.length < 2}
                      className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:bg-[#333] text-white font-bold px-8 py-4 rounded-xl transition-all active:scale-95 uppercase italic"
                    >
                      თამაშის დაწყება
                    </button>
                  )}
                  <button 
                    onClick={leaveRoom}
                    className="w-full sm:w-auto bg-[#222] hover:bg-[#333] border border-[#333] text-[#ddd] font-bold px-5 py-4 rounded-xl transition-all active:scale-95 uppercase italic flex items-center justify-center gap-2"
                  >
                    <LogOut size={16}/> გასვლა
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase text-[#666] mb-4 flex items-center gap-2">
                  <Users size={14}/> მოთამაშეები ({room.players.length}/10)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {room.players.map((p, index) => (
                    <div key={p.id} className="flex items-center justify-between bg-[#111] p-3 rounded-lg border border-[#222] gap-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${p.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="font-mono text-xs text-[#666]">{index + 1}</span>
                        <span className="font-bold">{p.name} {p.id === playerId && '(თქვენ)'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {me?.isHost && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => movePlayer(p.id, 'up')}
                              disabled={index === 0}
                              className="w-8 h-8 rounded-lg border border-[#333] bg-[#222] text-[#888] disabled:opacity-30 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center"
                              aria-label={`${p.name} ზემოთ`}
                              title="ზემოთ"
                            >
                              <ArrowUp size={14}/>
                            </button>
                            <button
                              onClick={() => movePlayer(p.id, 'down')}
                              disabled={index === room.players.length - 1}
                              className="w-8 h-8 rounded-lg border border-[#333] bg-[#222] text-[#888] disabled:opacity-30 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center"
                              aria-label={`${p.name} ქვემოთ`}
                              title="ქვემოთ"
                            >
                              <ArrowDown size={14}/>
                            </button>
                          </div>
                        )}
                        {p.isHost && <Crown size={14} className="text-yellow-500"/>}
                        {me?.isHost && p.id !== playerId && (
                          <button
                            onClick={() => kickPlayer(p.id)}
                            className="w-8 h-8 rounded-lg border border-red-500/30 bg-red-950/20 text-red-400 hover:bg-red-600 hover:text-white transition-colors flex items-center justify-center"
                            aria-label={`${p.name} გაგდება`}
                            title="გაგდება"
                          >
                            <UserX size={15}/>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
            
            <div className="bg-[#1a1a1a] p-6 rounded-2xl border border-[#333] space-y-4">
              <h3 className="text-xs font-bold uppercase text-[#666] flex items-center gap-2">
                <Settings size={14}/> ინფო
              </h3>
              <div className="text-xs text-[#888] grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="font-bold text-[#aaa]">როლები მოთამაშეების მიხედვით:</p>
                  <p>5 მოთამაშე: 3 Lib, 1 Fasc, 1 Hitler</p>
                  <p>6 მოთამაშე: 4 Lib, 1 Fasc, 1 Hitler</p>
                  <p>7 მოთამაშე: 4 Lib, 2 Fasc, 1 Hitler</p>
                  <p>8 მოთამაშე: 5 Lib, 2 Fasc, 1 Hitler</p>
                </div>
                <div className="space-y-1">
                   <p className="font-bold text-[#aaa]">გამარჯვება:</p>
                   <p>ლიბერალი: 5 Lib policy ან Hitler მოკვდა</p>
                   <p>ფაშისტი: 6 Fasc policy ან Hitler კანცლერია (3+ Fasc policy-ს მერე)</p>
                </div>
              </div>
            </div>
          </div>

          {/* CHAT */}
          <ChatUI room={room} playerId={playerId} sendChat={sendChat} chatInput={chatInput} setChatInput={setChatInput} chatEndRef={chatEndRef} />
        </div>
        <RulesModal open={showRules} onClose={() => setShowRules(false)} />
      </div>
    );
  }

  // ROLE REVEAL
  if (room.stage === GameStage.RoleReveal) {
    const fascistMates = room.players.filter(p => (p.role === Role.Fascist || p.role === Role.Hitler) && p.id !== playerId);
    const isReady = Boolean(playerId && room.readyPlayerIds.includes(playerId));
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8 bg-[#1a1a1a] p-10 rounded-2xl border border-[#333] text-center"
        >
          {!isReady ? (
            <>
              <h2 className="text-xs font-bold uppercase text-red-600 italic">თქვენი საიდუმლო როლი</h2>
              
              <div className="py-6">
                <div className={`text-6xl font-black uppercase italic mb-2 ${me?.role === Role.Liberal ? 'text-blue-500' : 'text-red-600'}`}>
                  {me?.role === Role.Liberal ? 'Liberal' : me?.role === Role.Fascist ? 'Fascist' : 'Hitler'}
                </div>
                <div className="text-[#888] text-sm italic">პარტია: {me?.partyMembership}</div>
              </div>

              <div className="bg-[#111] p-4 rounded-xl border border-[#222] text-left space-y-2">
                <p className="text-xs font-bold uppercase text-[#666]">ინფორმაცია</p>
                {me?.role === Role.Fascist && (
                  <div className="text-sm">
                    <p className="mb-1 text-red-400">თქვენი გუნდი:</p>
                    {fascistMates.map(m => (
                      <div key={m.id} className="flex items-center gap-2">
                        <span className="font-bold">{m.name}</span>
                        <span className="text-[10px] uppercase border border-red-500/30 px-1 rounded text-red-500/50">
                          {m.role === Role.Hitler ? 'ჰიტლერი' : 'ფაშისტი'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {me?.role === Role.Hitler && room.players.length <= 6 && (
                    <div className="text-sm">
                        <p className="mb-1 text-red-400">თქვენი ფაშისტები:</p>
                        {fascistMates.map(m => (
                            <div key={m.id} className="font-bold">{m.name}</div>
                        ))}
                    </div>
                )}
                {me?.role === Role.Hitler && room.players.length > 6 && (
                    <p className="text-sm text-[#888]">ვინაიდან 7+ მოთამაშეა, თქვენ არ იცით ვინ არიან ფაშისტები. მათ კი იციან თქვენი ვინაობა.</p>
                )}
                {me?.role === Role.Liberal && (
                    <p className="text-sm text-[#888]">თქვენ არ იცით სხვა მოთამაშეების როლები. უნდა გამოიცნოთ ვინ ვინ არის.</p>
                )}
              </div>

              <div className="bg-red-950/20 p-3 rounded-lg text-xs text-red-500 font-bold uppercase italic">
                არ აჩვენოთ ეს ეკრანი სხვებს!
              </div>
            </>
          ) : (
            <div className="py-10 space-y-4">
              <Shield size={42} className="mx-auto text-[#555]"/>
              <h2 className="text-xl font-black uppercase italic text-white">როლი დამალულია</h2>
              <p className="text-sm text-[#888]">ველოდებით დანარჩენ მოთამაშეებს...</p>
            </div>
          )}

          <button 
            onClick={finishReveal}
            disabled={isReady}
            className="w-full bg-[#333] hover:bg-[#444] disabled:bg-[#222] disabled:text-[#666] text-white font-bold py-3 rounded-lg transition-all active:scale-95 uppercase italic"
          >
            {isReady ? `ველოდებით სხვებს (${room.readyPlayerIds.length}/${room.players.length})` : 'გასაგებია'}
          </button>
          <button 
            onClick={leaveRoom}
            className="w-full bg-transparent hover:bg-[#222] border border-[#333] text-[#aaa] font-bold py-3 rounded-lg transition-all active:scale-95 uppercase italic flex items-center justify-center gap-2"
          >
            <LogOut size={16}/> გასვლა
          </button>
          <button 
            onClick={() => setShowRules(true)}
            className="w-full bg-transparent hover:bg-[#222] border border-[#333] text-[#aaa] font-bold py-3 rounded-lg transition-all active:scale-95 uppercase italic flex items-center justify-center gap-2"
          >
            <BookOpen size={16}/> წესები
          </button>
        </motion.div>
        <RulesModal open={showRules} onClose={() => setShowRules(false)} />
      </div>
    );
  }

  // MAIN GAME
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] flex flex-col font-sans text-sm md:text-base">
      
      {/* HEADER / ROLE INDICATOR */}
      <div className="bg-[#1a1a1a] border-b border-[#333] p-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
            <h1 className="text-lg font-black text-red-600 uppercase italic">SH</h1>
            <div className="h-4 w-[1px] bg-[#333] mx-1"></div>
            <span className="font-bold text-[#888] truncate max-w-[100px]">{me?.name}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRules(true)}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-[#333] bg-[#222] text-[#888] hover:text-white hover:border-blue-500 hover:bg-blue-600/20 transition-all"
            aria-label="წესები"
            title="წესები"
          >
            <BookOpen size={16}/>
          </button>
          <button 
            onClick={() => {
              setShowRole(!showRole);
              setRoleChecked(false);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
              showRole ? 'bg-red-600 border-red-500 text-white' : 'bg-[#222] border-[#333] text-[#888]'
            }`}
          >
            <Shield size={14}/>
            <span className="text-[10px] font-bold uppercase">{showRole ? 'დამალვა' : 'შენი როლი'}</span>
          </button>
          <button
            onClick={leaveRoom}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-[#333] bg-[#222] text-[#888] hover:text-white hover:border-red-500 hover:bg-red-600/20 transition-all"
            aria-label="გასვლა"
            title="გასვლა"
          >
            <LogOut size={16}/>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showRole && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-[52px] left-0 right-0 z-50 bg-red-950/90 backdrop-blur-md border-b border-red-500/30 p-4 text-center"
          >
            <div className="text-[10px] font-bold uppercase text-red-400 mb-2">პარტიის გადამოწმება</div>
            {!roleChecked ? (
              <button
                onClick={() => setRoleChecked(true)}
                className="bg-[#222] hover:bg-[#333] border border-red-500/30 text-white font-bold px-5 py-2 rounded-lg uppercase italic"
              >
                გადამოწმება
              </button>
            ) : (
              <div className={`text-3xl font-black italic uppercase ${me?.partyMembership === PartyMembership.Liberal ? 'text-blue-400' : 'text-red-400'}`}>
                {me?.partyMembership === PartyMembership.Liberal ? 'ლიბერალი' : 'ფაშისტი'}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE TABS */}
      <div className="lg:hidden flex bg-[#111] border-b border-[#222] sticky top-[52px] z-40">
        <button 
          onClick={() => setActiveTab('board')}
          className={`flex-grow py-3 text-xs font-bold uppercase transition-all ${activeTab === 'board' ? 'text-red-500 border-b-2 border-red-500 bg-[#1a1a1a]' : 'text-[#555]'}`}
        >
          დაფა
        </button>
        <button 
          onClick={() => setActiveTab('players')}
          className={`flex-grow py-3 text-xs font-bold uppercase transition-all ${activeTab === 'players' ? 'text-red-500 border-b-2 border-red-500 bg-[#1a1a1a]' : 'text-[#555]'}`}
        >
          მოთამაშეები
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex-grow py-3 text-xs font-bold uppercase transition-all ${activeTab === 'chat' ? 'text-red-500 border-b-2 border-red-500 bg-[#1a1a1a]' : 'text-[#555]'}`}
        >
          ჩატი
        </button>
      </div>

      <div className="max-w-[1400px] mx-auto w-full grid grid-cols-1 lg:grid-cols-4 gap-6 p-4 flex-grow overflow-hidden">
        
        {/* LEFT: Players & Actions (Desktop) or Tab Content (Mobile) */}
        <div className={`lg:col-span-1 space-y-4 flex flex-col overflow-hidden ${activeTab !== 'players' && 'hidden lg:flex'}`}>
          <div className="bg-[#1a1a1a] p-4 rounded-xl border border-[#333] flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold uppercase text-[#666] flex items-center gap-2">
                <Users size={14}/> მოთამაშეები
              </h2>
              <div className="text-[10px] bg-[#222] px-2 py-1 rounded text-[#888] font-mono">#{room.code}</div>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[30vh] lg:max-h-[40vh] custom-scrollbar">
              {room.playerOrder.map(pid => {
                const p = room.players.find(pl => pl.id === pid)!;
                const isPres = room.currentPresidentId === p.id;
                const isChanc = room.currentChancellorId === p.id;
                const isCand = room.currentChancellorCandidateId === p.id;
                const isLastPres = room.lastElectedPresidentId === p.id;
                const isLastChanc = room.lastElectedChancellorId === p.id;
                const isSelf = p.id === playerId;

                return (
                  <div key={p.id} className={`p-2 rounded-lg border relative transition-all ${p.alive ? 'bg-[#111] border-[#222]' : 'bg-[#1a1a1a] border-[#333] grayscale opacity-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className={`w-1.5 h-1.5 rounded-full ${p.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className={`font-bold truncate ${isSelf ? 'text-yellow-500' : ''}`}>
                            {p.name}
                        </span>
                        {!p.alive && <Skull size={12} className="text-red-600 flex-shrink-0"/>}
                      </div>
                      <div className="flex items-center gap-1">
                        <PlayerStatusBadges isPres={isPres} isChanc={isChanc} isCand={isCand} />
                        {me?.isHost && !isSelf && (
                          <button
                            onClick={() => kickPlayer(p.id)}
                            className="w-7 h-7 rounded-md border border-red-500/30 bg-red-950/20 text-red-400 hover:bg-red-600 hover:text-white transition-colors flex items-center justify-center"
                            aria-label={`${p.name} გაგდება`}
                            title="გაგდება"
                          >
                            <UserX size={13}/>
                          </button>
                        )}
                      </div>
                    </div>
                    {(isLastPres || isLastChanc) && (
                      <div className="text-[8px] text-[#555] uppercase font-black absolute -bottom-1 right-2">Ineligible</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-[#1a1a1a] p-4 rounded-xl border border-[#333] flex-grow flex flex-col overflow-hidden min-h-[200px]">
            <h2 className="text-xs font-bold uppercase text-[#666] mb-4">თქვენი მოქმედება</h2>
            <div className="flex-grow flex items-center justify-center text-center">
              <AnimatePresence mode="wait">
                <GameActionPanel 
                    room={room} 
                    playerId={playerId!} 
                    nominate={nominate} 
                    vote={vote} 
                    discard={discard} 
                    enact={enact} 
                    executePower={executePower}
                    requestVeto={requestVeto}
                    respondToVeto={respondToVeto}
                    kickPlayer={kickPlayer}
                    investigationResult={investigationResult}
                    setInvestigationResult={setInvestigationResult}
                    peekResult={peekResult}
                    setPeekResult={setPeekResult}
                    socket={socket}
                />
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* MIDDLE: Board */}
        <div className={`lg:col-span-2 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar pb-20 lg:pb-0 ${activeTab !== 'board' && 'hidden lg:flex'}`}>
          {/* Liberal Track */}
          <div className="bg-blue-900/10 border border-blue-900/30 p-4 md:p-6 rounded-2xl relative overflow-hidden">
            <div className="flex justify-between items-center mb-4 md:mb-6">
                <h3 className="text-blue-500 font-black italic uppercase text-xl md:text-2xl">ლიბერალური კანონები</h3>
                <span className="text-blue-500/50 font-bold">{room.liberalPoliciesEnacted} / 5</span>
            </div>
            <div className="grid grid-cols-5 gap-2 md:gap-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className={`aspect-[2/3] rounded-md md:rounded-lg border-2 flex items-center justify-center transition-all ${i < room.liberalPoliciesEnacted ? 'bg-blue-600 border-blue-400 rotate-2' : 'bg-blue-950/20 border-dashed border-blue-900/40 opacity-40'}`}>
                  {i < room.liberalPoliciesEnacted && <PolicyMark type={PolicyType.Liberal} />}
                </div>
              ))}
            </div>
          </div>

          {/* Fascist Track */}
          <div className="bg-red-900/10 border border-red-900/30 p-4 md:p-6 rounded-2xl relative overflow-hidden">
            <div className="flex justify-between items-center mb-4 md:mb-6">
                <h3 className="text-red-500 font-black italic uppercase text-xl md:text-2xl">ფაშისტური კანონები</h3>
                <span className="text-red-500/50 font-bold">{room.fascistPoliciesEnacted} / 6</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 md:gap-3">
              {[...Array(6)].map((_, i) => {
                const power = getFascistPower(room.players.length, i + 1);
                const isEnacted = i < room.fascistPoliciesEnacted;
                return (
                  <div key={i} className={`aspect-[2/3] rounded-md md:rounded-lg border-2 flex flex-col items-center justify-center p-1 md:p-2 text-center transition-all ${isEnacted ? 'bg-red-600 border-red-400 -rotate-2' : 'bg-red-950/20 border-dashed border-red-900/40 opacity-40'}`}>
                    {isEnacted ? (
                      <PolicyMark type={PolicyType.Fascist} size="sm" />
                    ) : (
                      <>
                        <div className="opacity-40">{getPowerIcon(power, 16)}</div>
                        <div className="text-[5px] md:text-[8px] font-black mt-1 md:mt-2 leading-tight opacity-40">{getPowerLabel(power)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Misc Info */}
          <div className="grid grid-cols-3 gap-2 md:gap-4">
             <div className="bg-[#1a1a1a] p-3 md:p-4 rounded-xl border border-[#333] text-center">
                <p className="text-[8px] md:text-[10px] uppercase text-[#666] mb-1 font-bold">Tracker</p>
                <div className="flex justify-center gap-1 md:gap-2">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className={`w-2 h-2 md:w-3 md:h-3 rounded-full border ${room.electionTracker === i ? 'bg-yellow-500 border-white' : 'bg-[#222] border-[#444]'}`}></div>
                    ))}
                </div>
             </div>
             <div className="bg-[#1a1a1a] p-3 md:p-4 rounded-xl border border-[#333] text-center">
                <p className="text-[8px] md:text-[10px] uppercase text-[#666] mb-1 font-bold">Draw</p>
                <span className="font-mono text-lg md:text-xl">{room.drawPileCount ?? '??'}</span>
             </div>
             <div className="bg-[#1a1a1a] p-3 md:p-4 rounded-xl border border-[#333] text-center">
                <p className="text-[8px] md:text-[10px] uppercase text-[#666] mb-1 font-bold">Discard</p>
                <span className="font-mono text-lg md:text-xl">{room.discardPileCount ?? '??'}</span>
             </div>
          </div>
          <div className="lg:hidden">
            <BoardPlayersList room={room} playerId={playerId!} kickPlayer={kickPlayer} />
          </div>
        </div>

        {/* RIGHT: Chat */}
        <div className={`lg:col-span-1 flex flex-col overflow-hidden pb-16 lg:pb-0 ${activeTab !== 'chat' && 'hidden lg:flex'}`}>
            <ChatUI room={room} playerId={playerId} sendChat={sendChat} chatInput={chatInput} setChatInput={setChatInput} chatEndRef={chatEndRef} />
        </div>

      </div>

      {/* GAME OVER OVERLAY */}
      {room.stage === GameStage.GameOver && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#1a1a1a] p-10 rounded-2xl border border-[#333] text-center max-w-lg space-y-6"
              >
                  <h1 className={`text-6xl font-black italic uppercase ${room.winner === 'Liberal' ? 'text-blue-500' : 'text-red-600'}`}>
                    {room.winner === 'Liberal' ? 'Liberals Win!' : 'Fascists Win!'}
                  </h1>
                  <p className="text-xl italic text-[#888]">{room.winReason}</p>
                  
                  <div className="py-6 border-y border-[#333] space-y-2">
                      <p className="text-xs uppercase font-bold text-[#666]">მოთამაშეების როლები</p>
                      <div className="grid grid-cols-2 gap-4 text-left">
                          {room.players.map(p => (
                              <div key={p.id} className="flex flex-col">
                                  <span className="font-bold">{p.name}</span>
                                  <span className={`text-xs uppercase font-black italic ${p.role === Role.Liberal ? 'text-blue-400' : 'text-red-400'}`}>{p.role}</span>
                              </div>
                          ))}
                      </div>
                  </div>

                  <button 
                    onClick={() => window.location.reload()}
                    className="w-full bg-[#333] hover:bg-[#444] text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 uppercase italic"
                  >
                    <LogOut size={16}/> მთავარ გვერდზე
                  </button>
              </motion.div>
          </div>
      )}
        <ActionOverlay
        room={room}
        playerId={playerId!}
        nominate={nominate}
        vote={vote}
        discard={discard}
        enact={enact}
        requestVeto={requestVeto}
        respondToVeto={respondToVeto}
        executePower={executePower}
        investigationResult={investigationResult}
        setInvestigationResult={setInvestigationResult}
        peekResult={peekResult}
        setPeekResult={setPeekResult}
        socket={socket}
      />
      <RulesModal open={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}

function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-2xl max-h-[86dvh] overflow-y-auto custom-scrollbar bg-[#1a1a1a] border border-[#333] rounded-2xl shadow-2xl"
      >
        <div className="sticky top-0 bg-[#1a1a1a]/95 backdrop-blur border-b border-[#333] p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-red-500"/>
            <h2 className="font-black uppercase italic text-lg">თამაშის წესები</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[#aaa] hover:text-white hover:border-red-500"
            aria-label="დახურვა"
          >
            <X size={18}/>
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm leading-6 text-[#d0d0d0]">
          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">მიზანი</h3>
            <p>ლიბერალები იგებენ, თუ მიიღებენ 5 ლიბერალურ კანონს ან მოკლავენ ჰიტლერს. ფაშისტები იგებენ, თუ მიიღებენ 6 ფაშისტურ კანონს, ან 3 ფაშისტური კანონის შემდეგ ჰიტლერი კანცლერად აირჩევა.</p>
          </section>

          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">როლები</h3>
            <p>ყველას აქვს საიდუმლო როლი: ლიბერალი, ფაშისტი ან ჰიტლერი. ფაშისტებმა იციან ერთმანეთი და ჰიტლერი. 5-6 მოთამაშეში ჰიტლერმაც იცის ფაშისტები, 7+ მოთამაშეში კი არა.</p>
          </section>

          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">რაუნდი</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li>პრეზიდენტი ასახელებს კანცლერის კანდიდატს.</li>
              <li>ყველა ცოცხალი მოთამაშე აძლევს ხმას Ja ან Nein.</li>
              <li>თუ Ja მეტია, მთავრობა აირჩევა და იწყება კანონების ფაზა.</li>
              <li>თუ მთავრობა ჩავარდა, election tracker იზრდება. მესამე ჩავარდნაზე ზედა კანონი შემთხვევით მიიღება.</li>
            </ol>
          </section>

          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">კანონები</h3>
            <p>პრეზიდენტი იღებს 3 კანონს და ერთს აგდებს. კანცლერი იღებს დარჩენილ 2-ს, ერთს იღებს და ერთს აგდებს. მიღებული კანონი ემატება შესაბამის დაფას.</p>
          </section>

          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">ძალაუფლებები</h3>
            <p>ფაშისტური კანონების მიღებისას შეიძლება გააქტიურდეს პრეზიდენტის ძალა: ერთგულების შემოწმება, ზედა 3 კანონის ნახვა, სპეციალური არჩევნები ან მოთამაშის სიკვდილით დასჯა.</p>
          </section>

          <section>
            <h3 className="text-red-500 font-black uppercase italic mb-2">შეზღუდვები</h3>
            <p>ბოლო არჩეული კანცლერი ისევ კანცლერად ვერ დასახელდება. 6+ ცოცხალ მოთამაშეში ბოლო პრეზიდენტიც ვერ გახდება კანცლერი შემდეგ არჩევნებზე.</p>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

function ChatUI({ room, playerId, sendChat, chatInput, setChatInput, chatEndRef }: any) {
    return (
        <div className="bg-[#1a1a1a] rounded-2xl border border-[#333] flex flex-col h-full overflow-hidden">
            <h3 className="bg-[#1a1a1a] p-4 text-xs font-bold uppercase text-[#666] border-b border-[#333] flex-shrink-0">ჩატი</h3>
            <div className="flex-grow overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {room.chat.map((msg: any) => {
                    const isSystem = msg.senderId === 'SYSTEM';
                    const isMe = msg.senderId === playerId;
                    return (
                        <div key={msg.id} className={`flex flex-col ${isSystem ? 'items-center' : isMe ? 'items-end' : 'items-start'}`}>
                            {!isSystem && <span className="text-[10px] text-[#555] mb-0.5">{msg.senderName}</span>}
                            <div className={`px-3 py-1.5 rounded-lg text-sm max-w-[90%] ${
                                isSystem ? 'bg-transparent border border-[#333] text-[#555] text-[10px] uppercase font-bold text-center' : 
                                isMe ? 'bg-red-600/20 text-red-100 border border-red-500/20 rounded-tr-none' : 
                                'bg-[#222] text-[#ccc] rounded-tl-none'
                            }`}>
                                {msg.text}
                            </div>
                        </div>
                    );
                })}
                <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} className="p-4 bg-[#111] border-t border-[#333] flex gap-2 flex-shrink-0">
                <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="bg-transparent text-sm focus:outline-none flex-grow"
                    placeholder="დაწერეთ რამე..."
                />
                <button type="submit" className="text-red-500 hover:text-red-400 transition-colors"><Send size={18}/></button>
            </form>
        </div>
    );
}

function PlayerStatusBadges({ isPres, isChanc, isCand }: { isPres: boolean; isChanc: boolean; isCand: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {isPres && <div className="text-[8px] md:text-[10px] bg-yellow-600 text-white px-1.5 py-0.5 rounded font-bold uppercase">პრეზიდენტი</div>}
      {isChanc && <div className="text-[8px] md:text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold uppercase">კანცლერი</div>}
      {isCand && <div className="text-[8px] md:text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold uppercase">კანდიდატი</div>}
    </div>
  );
}

function BoardPlayersList({ room, playerId, kickPlayer }: { room: GameRoom; playerId: string; kickPlayer: (targetId: string) => void }) {
  const me = room.players.find(player => player.id === playerId);

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-4 space-y-3">
      <h3 className="text-xs font-bold uppercase text-[#666] flex items-center gap-2">
        <Users size={14}/> მოთამაშეები
      </h3>
      <div className="space-y-2">
        {room.playerOrder.map(pid => {
          const player = room.players.find(p => p.id === pid);
          if (!player) return null;
          const isPres = room.currentPresidentId === player.id;
          const isChanc = room.currentChancellorId === player.id;
          const isCand = room.currentChancellorCandidateId === player.id;
          return (
            <div key={player.id} className={`bg-[#111] border border-[#252525] rounded-xl p-3 flex items-center justify-between gap-2 ${!player.alive ? 'opacity-50 grayscale' : ''}`}>
              <div className="min-w-0 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${player.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className={`font-bold truncate ${player.id === playerId ? 'text-yellow-500' : 'text-[#ddd]'}`}>
                  {player.name}
                </span>
                {!player.alive && <Skull size={13} className="text-red-600 flex-shrink-0"/>}
              </div>
              <div className="flex items-center gap-1">
                <PlayerStatusBadges isPres={isPres} isChanc={isChanc} isCand={isCand} />
                {me?.isHost && player.id !== playerId && (
                  <button
                    onClick={() => kickPlayer(player.id)}
                    className="w-8 h-8 rounded-lg border border-red-500/30 bg-red-950/20 text-red-400 flex items-center justify-center"
                    aria-label={`${player.name} გაგდება`}
                    title="გაგდება"
                  >
                    <UserX size={14}/>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ElectionPanel({ room, playerId, vote }: { room: GameRoom; playerId: string; vote: (v: 'Ja' | 'Nein') => void }) {
  const president = room.players.find(p => p.id === room.currentPresidentId);
  const candidate = room.players.find(p => p.id === room.currentChancellorCandidateId);
  const isPresident = room.currentPresidentId === playerId;
  const isCandidate = room.currentChancellorCandidateId === playerId;
  const hasVoted = room.votes[playerId] !== undefined;
  const voters = room.players.filter(p => (
    p.alive &&
    p.id !== room.currentPresidentId &&
    p.id !== room.currentChancellorCandidateId
  ));

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

      {isPresident || isCandidate ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2 bg-[#111] border border-[#333] rounded-xl p-3 text-sm text-[#888] font-bold text-center">
            {isPresident ? 'პრეზიდენტი არჩევნებში ხმას არ აძლევს.' : 'კანცლერობის კანდიდატი არჩევნებში ხმას არ აძლევს.'}
          </div>
          {voters.map(player => (
            <div key={player.id} className="bg-[#111] border border-[#252525] rounded-lg p-3 flex items-center justify-between">
              <span className="font-bold">{player.name}</span>
              <span className={`text-xs font-bold uppercase ${room.votes[player.id] ? 'text-green-400' : 'text-[#555]'}`}>
                {room.votes[player.id] ? 'ხმა მიღებულია' : 'ელოდება'}
              </span>
            </div>
          ))}
        </div>
      ) : hasVoted ? (
        <div className="bg-yellow-950/20 border border-yellow-500/30 text-yellow-400 rounded-xl p-4 text-center font-bold">
          თქვენი ხმა მიღებულია. ველოდებით დანარჩენებს.
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
        </div>
      )}
    </div>
  );
}

function getEligibleCandidates(room: GameRoom, playerId: string) {
  const aliveCount = room.players.filter(player => player.alive).length;
  return room.playerOrder
    .map(pid => room.players.find(player => player.id === pid))
    .filter((player): player is Player => {
      if (!player || !player.alive || player.id === playerId) return false;
      if (aliveCount <= 2) return true;
      if (player.id === room.lastElectedChancellorId) return false;
      if (aliveCount > 5 && player.id === room.lastElectedPresidentId) return false;
      return true;
    });
}

function NominationPanel({ room, playerId, nominate }: { room: GameRoom; playerId: string; nominate: (targetId: string) => void }) {
  const candidates = getEligibleCandidates(room, playerId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-black uppercase italic text-yellow-500">აირჩიეთ კანდიდატი</h3>
        <p className="text-sm text-[#888] mt-1">კანცლერის კანდიდატად დაასახელეთ ერთი მოთამაშე.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {candidates.map(player => (
          <button
            key={player.id}
            onClick={() => nominate(player.id)}
            className="bg-[#111] border border-[#333] hover:border-yellow-500 hover:bg-yellow-500/10 rounded-xl p-4 text-left font-bold transition-all active:scale-95"
          >
            {player.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function PolicyChoicePanel({
  title,
  subtitle,
  policies,
  action,
  cardSize = 'lg',
}: {
  title: string;
  subtitle: string;
  policies: Array<{ id: string; type: PolicyType }>;
  action: (policyId: string) => void;
  cardSize?: 'md' | 'lg';
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-black uppercase italic text-yellow-500">{title}</h3>
        <p className="text-sm text-[#888] mt-1">{subtitle}</p>
      </div>
      <div className="flex justify-center gap-3">
        {policies.map(policy => (
          <button
            key={policy.id}
            onClick={() => action(policy.id)}
            className={`${cardSize === 'lg' ? 'w-24' : 'w-20'} aspect-[2/3] rounded-xl border-4 flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${policy.type === PolicyType.Liberal ? 'bg-blue-600 border-blue-400' : 'bg-red-600 border-red-400'}`}
          >
            <PolicyMark type={policy.type} size={cardSize === 'lg' ? 'lg' : 'md'} />
          </button>
        ))}
      </div>
    </div>
  );
}

function VetoPanel({ respondToVeto }: { respondToVeto: (accept: boolean) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-black uppercase italic text-red-500">ვეტოს მოთხოვნა</h3>
        <p className="text-sm text-[#888] mt-1">კანცლერმა ვეტო მოითხოვა. ეთანხმებით?</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => respondToVeto(true)} className="bg-green-900/20 border-2 border-green-500 text-green-400 rounded-xl py-4 font-black uppercase italic active:scale-95">კი</button>
        <button onClick={() => respondToVeto(false)} className="bg-red-900/20 border-2 border-red-500 text-red-400 rounded-xl py-4 font-black uppercase italic active:scale-95">არა</button>
      </div>
    </div>
  );
}

function ExecutiveActionPanel({
  room,
  playerId,
  executePower,
  investigationResult,
  setInvestigationResult,
  peekResult,
  setPeekResult,
  socket,
}: {
  room: GameRoom;
  playerId: string;
  executePower: (targetId: string) => void;
  investigationResult: { targetName: string; party: PartyMembership } | null;
  setInvestigationResult: React.Dispatch<React.SetStateAction<{ targetName: string; party: PartyMembership } | null>>;
  peekResult: Policy[] | null;
  setPeekResult: React.Dispatch<React.SetStateAction<Policy[] | null>>;
  socket: Socket;
}) {
  const isPresident = room.currentPresidentId === playerId;
  const power = room.pendingPower;

  if (!isPresident) {
    return (
      <div className="text-center space-y-3 py-8">
        <Crown size={38} className="mx-auto text-red-500"/>
        <h3 className="text-xl font-black uppercase italic">პრეზიდენტი ასრულებს მოქმედებას</h3>
        <p className="text-sm text-[#888]">დაელოდეთ შემდეგ ეტაპს.</p>
      </div>
    );
  }

  if (investigationResult) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <Search size={38} className="text-red-500"/>
          <h3 className="text-2xl font-black uppercase italic text-red-500">გამოძიების შედეგი</h3>
        </div>
        <div className="rounded-xl border border-[#333] bg-black/20 p-4">
          <p className="text-xs text-[#888] mb-2">{investigationResult.targetName}</p>
          <p className={`text-2xl font-black uppercase italic ${investigationResult.party === PartyMembership.Liberal ? 'text-blue-500' : 'text-red-600'}`}>
            {translateParty(investigationResult.party)}
          </p>
        </div>
        <button onClick={() => setInvestigationResult(null)} className="bg-[#333] hover:bg-[#3b3b3b] p-3 w-full rounded-xl font-bold uppercase italic active:scale-95">
          დახურვა
        </button>
      </div>
    );
  }

  if (peekResult) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <Eye size={38} className="text-red-500"/>
          <h3 className="text-2xl font-black uppercase italic text-red-500">დასტის ზედა 3 კანონი</h3>
        </div>
        <div className="flex gap-3 justify-center">
          {peekResult.map((policy, i) => (
            <div key={`${policy.id}-${i}`} className={`w-20 aspect-[2/3] rounded-xl border-4 flex items-center justify-center ${policy.type === PolicyType.Liberal ? 'bg-blue-600 border-blue-400' : 'bg-red-600 border-red-400'}`}>
              <PolicyMark type={policy.type} size="md" />
            </div>
          ))}
        </div>
        <button onClick={() => {
          setPeekResult(null);
          executePower('DONE');
        }} className="bg-[#333] hover:bg-[#3b3b3b] p-3 w-full rounded-xl font-bold uppercase italic active:scale-95">
          დახურვა
        </button>
      </div>
    );
  }

  const targets = room.players.filter(player => player.alive && player.id !== playerId);
  const title = getPowerLabel(power) || 'პრეზიდენტის მოქმედება';
  const subtitle =
    power === ExecutivePower.InvestigateLoyalty ? 'აირჩიეთ მოთამაშე, რომლის პარტიულ წევრობასაც გადაამოწმებთ.' :
    power === ExecutivePower.Execution ? 'აირჩიეთ მოთამაშე, რომელიც თამაშიდან გავარდება.' :
    power === ExecutivePower.SpecialElection ? 'აირჩიეთ მოთამაშე, რომელიც შემდეგი პრეზიდენტი გახდება.' :
    power === ExecutivePower.PolicyPeek ? 'ნახეთ დასტის ზედა სამი კანონი.' :
    'შეასრულეთ პრეზიდენტის მოქმედება.';

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {getPowerIcon(power)}
        <h3 className="text-2xl font-black uppercase italic text-red-500">{title}</h3>
        <p className="text-sm text-[#888]">{subtitle}</p>
      </div>
      {power === ExecutivePower.PolicyPeek ? (
        <button onClick={() => socket.emit('peekReady', { code: room.code })} className="w-full bg-red-600 hover:bg-red-500 p-4 rounded-xl font-black uppercase italic active:scale-95">
          კანონების ნახვა
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {targets.map(player => (
            <button
              key={player.id}
              onClick={() => executePower(player.id)}
              className="bg-[#222] border border-[#333] hover:border-red-500 p-3 rounded-xl text-sm font-bold uppercase active:scale-95"
            >
              {player.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionOverlay({
  room,
  playerId,
  nominate,
  vote,
  discard,
  enact,
  requestVeto,
  respondToVeto,
  executePower,
  investigationResult,
  setInvestigationResult,
  peekResult,
  setPeekResult,
  socket,
}: {
  room: GameRoom;
  playerId: string;
  nominate: (targetId: string) => void;
  vote: (v: 'Ja' | 'Nein') => void;
  discard: (policyId: string) => void;
  enact: (policyId: string) => void;
  requestVeto: () => void;
  respondToVeto: (accept: boolean) => void;
  executePower: (targetId: string) => void;
  investigationResult: { targetName: string; party: PartyMembership } | null;
  setInvestigationResult: React.Dispatch<React.SetStateAction<{ targetName: string; party: PartyMembership } | null>>;
  peekResult: Policy[] | null;
  setPeekResult: React.Dispatch<React.SetStateAction<Policy[] | null>>;
  socket: Socket;
}) {
  const me = room.players.find(player => player.id === playerId);
  if (!me?.alive || room.stage === GameStage.GameOver) return null;

  const isPresident = room.currentPresidentId === playerId;
  const isChancellor = room.currentChancellorId === playerId;
  const shouldShowNomination = room.stage === GameStage.Nomination;
  const shouldShowVoting = room.stage === GameStage.Voting;
  const shouldShowPresidentPolicies = room.stage === GameStage.LegislativePresident;
  const shouldShowChancellorPolicies = room.stage === GameStage.LegislativeChancellor;
  const shouldShowExecutive = room.stage === GameStage.ExecutiveAction;
  const shouldShowExecutiveResult = Boolean(investigationResult || peekResult);
  if (!shouldShowNomination && !shouldShowVoting && !shouldShowPresidentPolicies && !shouldShowChancellorPolicies && !shouldShowExecutive && !shouldShowExecutiveResult) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-6 pointer-events-auto">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-xl max-h-[86dvh] overflow-y-auto custom-scrollbar bg-[#1a1a1a] border border-[#333] rounded-2xl shadow-2xl p-4 sm:p-6"
      >
        {shouldShowExecutiveResult ? (
          <ExecutiveActionPanel
            room={room}
            playerId={playerId}
            executePower={executePower}
            investigationResult={investigationResult}
            setInvestigationResult={setInvestigationResult}
            peekResult={peekResult}
            setPeekResult={setPeekResult}
            socket={socket}
          />
        ) : shouldShowNomination && (
          isPresident ? (
            <NominationPanel room={room} playerId={playerId} nominate={nominate} />
          ) : (
            <div className="text-center space-y-3 py-8">
              <Crown size={38} className="mx-auto text-yellow-500"/>
              <h3 className="text-xl font-black uppercase italic">პრეზიდენტი ირჩევს კანცლერს</h3>
              <p className="text-sm text-[#888]">დაელოდეთ კანდიდატის დასახელებას.</p>
            </div>
          )
        )}
        {shouldShowVoting && (
          <ElectionPanel room={room} playerId={playerId} vote={vote} />
        )}
        {shouldShowPresidentPolicies && (
          isPresident ? (
            <PolicyChoicePanel
              title="აირჩიეთ გადასაგდები კანონი"
              subtitle="ერთი ბარათი გადააგდეთ. დარჩენილი ორი კანცლერს გადაეცემა."
              policies={room.legislativeHand}
              action={discard}
              cardSize="md"
            />
          ) : (
            <div className="text-center space-y-3 py-8">
              <Crown size={38} className="mx-auto text-yellow-500"/>
              <h3 className="text-xl font-black uppercase italic">პრეზიდენტი არჩევს კანონს</h3>
              <p className="text-sm text-[#888]">დაფა ფონზე ჩანს. დაელოდეთ პრეზიდენტის გადაწყვეტილებას.</p>
            </div>
          )
        )}
        {shouldShowChancellorPolicies && (
          room.vetoRequested ? (
            isPresident ? (
              <VetoPanel respondToVeto={respondToVeto} />
            ) : (
              <div className="text-center space-y-3 py-8">
                <ScaleIcon />
                <h3 className="text-xl font-black uppercase italic">პრეზიდენტი ვეტოზე ფიქრობს</h3>
                <p className="text-sm text-[#888]">დაელოდეთ გადაწყვეტილებას.</p>
              </div>
            )
          ) : isChancellor ? (
            <div className="space-y-4">
              <PolicyChoicePanel
                title="აირჩიეთ მისაღები კანონი"
                subtitle="ერთი კანონი მიიღეთ. მეორე ავტომატურად გადავა discard-ში."
                policies={room.legislativeHand}
                action={enact}
                cardSize="lg"
              />
              {room.fascistPoliciesEnacted >= 5 && (
                <button onClick={requestVeto} className="w-full bg-yellow-950/40 border border-yellow-500 text-yellow-400 p-3 rounded-xl text-xs font-bold uppercase italic">
                  მოითხოვეთ ვეტო
                </button>
              )}
            </div>
          ) : (
            <div className="text-center space-y-3 py-8">
              <Shield size={38} className="mx-auto text-red-500"/>
              <h3 className="text-xl font-black uppercase italic">კანცლერი არჩევს კანონს</h3>
              <p className="text-sm text-[#888]">დაფა ფონზე ჩანს. დაელოდეთ კანცლერის გადაწყვეტილებას.</p>
            </div>
          )
        )}
        {shouldShowExecutive && !shouldShowExecutiveResult && (
          <ExecutiveActionPanel
            room={room}
            playerId={playerId}
            executePower={executePower}
            investigationResult={investigationResult}
            setInvestigationResult={setInvestigationResult}
            peekResult={peekResult}
            setPeekResult={setPeekResult}
            socket={socket}
          />
        )}
      </motion.div>
    </div>
  );
}

function ScaleIcon() {
  return <Shield size={38} className="mx-auto text-yellow-500"/>;
}

function BoardOnlyView({ snapshot, code, error }: { snapshot: BoardSnapshot | null; code: string; error: string | null }) {
  return (
    <div className="min-h-screen bg-[#080808] text-[#e5e5e5] flex flex-col p-4 sm:p-6 lg:p-10 font-sans">
      <div className="flex items-center justify-between gap-4 mb-5 lg:mb-8">
        <div>
          <div className="text-[10px] sm:text-xs font-black uppercase italic text-[#666] flex items-center gap-2">
            <Monitor size={14}/> მონიტორის დაფა
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black uppercase italic text-red-600">#{code}</h1>
        </div>
        <div className="text-right">
          <div className="text-[10px] sm:text-xs font-bold uppercase text-[#666]">სტატუსი</div>
          <div className="text-sm sm:text-xl font-black italic text-[#ddd]">{snapshot ? getStageLabel(snapshot.stage) : 'იტვირთება...'}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/20 p-4 text-red-400 font-bold">
          {error}
        </div>
      )}

      {!snapshot ? (
        <div className="flex-grow flex items-center justify-center text-[#666] font-bold uppercase italic">
          დაფასთან დაკავშირება...
        </div>
      ) : (
        <div className="flex-grow grid grid-rows-2 gap-5 lg:gap-8">
          <section className="bg-blue-900/10 border border-blue-900/35 p-4 sm:p-6 lg:p-8 rounded-2xl flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4 lg:mb-7">
              <h2 className="text-blue-500 font-black italic uppercase text-xl sm:text-3xl lg:text-5xl">ლიბერალური კანონები</h2>
              <span className="text-blue-500/60 font-black text-xl sm:text-3xl">{snapshot.liberalPoliciesEnacted} / 5</span>
            </div>
            <div className="grid grid-cols-5 gap-2 sm:gap-4 lg:gap-6 flex-grow min-h-0">
              {[...Array(5)].map((_, i) => (
                <div key={i} className={`rounded-xl border-2 sm:border-4 flex items-center justify-center transition-all ${i < snapshot.liberalPoliciesEnacted ? 'bg-blue-600 border-blue-400 rotate-1' : 'bg-blue-950/20 border-dashed border-blue-900/40 opacity-45'}`}>
                  {i < snapshot.liberalPoliciesEnacted && <PolicyMark type={PolicyType.Liberal} size="lg" />}
                </div>
              ))}
            </div>
          </section>

          <section className="bg-red-900/10 border border-red-900/35 p-4 sm:p-6 lg:p-8 rounded-2xl flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4 lg:mb-7">
              <h2 className="text-red-500 font-black italic uppercase text-xl sm:text-3xl lg:text-5xl">ფაშისტური კანონები</h2>
              <span className="text-red-500/60 font-black text-xl sm:text-3xl">{snapshot.fascistPoliciesEnacted} / 6</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 sm:gap-4 lg:gap-6 flex-grow min-h-0">
              {[...Array(6)].map((_, i) => {
                const power = getFascistPower(snapshot.playerCount, i + 1);
                const isEnacted = i < snapshot.fascistPoliciesEnacted;
                return (
                  <div key={i} className={`rounded-xl border-2 sm:border-4 flex flex-col items-center justify-center p-1 sm:p-3 text-center transition-all ${isEnacted ? 'bg-red-600 border-red-400 -rotate-1' : 'bg-red-950/20 border-dashed border-red-900/40 opacity-45'}`}>
                    {isEnacted ? (
                      <PolicyMark type={PolicyType.Fascist} size="lg" />
                    ) : (
                      <>
                        <div className="opacity-45">{getPowerIcon(power, 30)}</div>
                        <div className="text-[7px] sm:text-xs lg:text-base font-black mt-1 sm:mt-3 leading-tight opacity-45">{getPowerLabel(power)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {snapshot?.winner && (
        <div className="mt-5 rounded-2xl border border-[#333] bg-[#111] p-4 text-center">
          <div className={`text-2xl sm:text-4xl font-black uppercase italic ${snapshot.winner === 'Liberal' ? 'text-blue-500' : 'text-red-600'}`}>
            {snapshot.winner === 'Liberal' ? 'ლიბერალებმა მოიგეს' : 'ფაშისტებმა მოიგეს'}
          </div>
          <div className="text-[#aaa] mt-1">{snapshot.winReason}</div>
        </div>
      )}
    </div>
  );
}

function PolicyMark({ type, size = 'md' }: { type: PolicyType; size?: 'sm' | 'md' | 'lg' }) {
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 34 : 24;
  const letterSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-4xl' : 'text-2xl';
  const isLiberal = type === PolicyType.Liberal;

  return (
    <div className="flex flex-col items-center justify-center gap-1 leading-none">
      {isLiberal ? (
        <Bird size={iconSize} strokeWidth={2.4} className="text-white"/>
      ) : (
        <ShieldAlert size={iconSize} strokeWidth={2.6} className="text-white"/>
      )}
      <span className={`font-black italic ${letterSize}`}>{isLiberal ? 'ლ' : 'ფ'}</span>
    </div>
  );
}

function GameActionPanel({ 
    room, 
    playerId, 
    nominate, 
    vote, 
    discard, 
    enact, 
    executePower, 
    requestVeto, 
    respondToVeto,
    investigationResult,
    setInvestigationResult,
    peekResult,
    setPeekResult,
    socket
}: any) {
    const isPresident = room.currentPresidentId === playerId;
    const isChancellor = (room.stage === GameStage.LegislativeChancellor && room.currentChancellorId === playerId) ||
                        (room.stage === GameStage.Voting && room.currentChancellorCandidateId === playerId);
    const p = room.players.find((pl: any) => pl.id === playerId);

    if (!p?.alive) return <div>თქვენ მკვდარი ხართ. მხოლოდ დაკვირვება შეგიძლიათ.</div>;

    if (room.stage === GameStage.Nomination) {
        return <div className="text-[#666] italic">{isPresident ? 'კანდიდატის არჩევა მთავარ ფანჯარაშია.' : 'პრეზიდენტი ირჩევს კანცლერს...'}</div>;
    }

    if (room.stage === GameStage.Voting) {
        return <div className="text-[#666] italic">{isPresident ? 'პრეზიდენტი არჩევნებში ხმას არ აძლევს.' : isChancellor ? 'კანცლერობის კანდიდატი არჩევნებში ხმას არ აძლევს.' : 'ხმის მიცემა მთავარ ფანჯარაშია.'}</div>;
    }

    if (room.stage === GameStage.LegislativePresident) {
        return <div className="text-yellow-500 italic">{isPresident ? 'კანონის არჩევა მთავარ ფანჯარაშია.' : 'პრეზიდენტი განიხილავს კანონებს...'}</div>;
    }

    if (room.stage === GameStage.LegislativeChancellor) {
        const isChan = room.currentChancellorId === playerId;
        if (!isChan && !isPresident) return <div className="text-red-500 italic">კანცლერი იღებს გადაწყვეტილებას...</div>;
        
        if (room.vetoRequested) {
            if (isPresident) return <div className="text-red-500 animate-pulse font-bold">ვეტოზე პასუხი მთავარ ფანჯარაშია.</div>;
            return <div className="text-red-500 animate-pulse font-bold">პრეზიდენტი ვეტოზე ფიქრობს...</div>;
        }

        if (isChan) {
            return <div className="text-red-500 italic">კანონის არჩევა მთავარ ფანჯარაშია.</div>;
        }
        return <div className="text-red-500 italic">კანცლერი განიხილავს 2 კანონს...</div>;
    }

    if (room.stage === GameStage.ExecutiveAction) {
        return <div className="text-red-500 italic font-bold uppercase">{isPresident ? 'პრეზიდენტის მოქმედება მთავარ ფანჯარაშია.' : 'პრეზიდენტი ასრულებს მოქმედებას...'}</div>;
    }

    return <div>დაელოდეთ...</div>;
}

function getFascistPower(playerCount: number, policyIndex: number): ExecutivePower | null {
  if (playerCount <= 6) {
    if (policyIndex === 3) return ExecutivePower.PolicyPeek;
    if (policyIndex === 4) return ExecutivePower.Execution;
    if (policyIndex === 5) return ExecutivePower.Execution;
  } else if (playerCount <= 8) {
    if (policyIndex === 2) return ExecutivePower.InvestigateLoyalty;
    if (policyIndex === 3) return ExecutivePower.SpecialElection;
    if (policyIndex === 4) return ExecutivePower.Execution;
    if (policyIndex === 5) return ExecutivePower.Execution;
  } else {
    if (policyIndex === 1) return ExecutivePower.InvestigateLoyalty;
    if (policyIndex === 2) return ExecutivePower.InvestigateLoyalty;
    if (policyIndex === 3) return ExecutivePower.SpecialElection;
    if (policyIndex === 4) return ExecutivePower.Execution;
    if (policyIndex === 5) return ExecutivePower.Execution;
  }
  return null;
}

function getPowerIcon(power: ExecutivePower | null, size = 32) {
  if (power === ExecutivePower.InvestigateLoyalty) return <Search size={size} className="text-red-500"/>;
  if (power === ExecutivePower.PolicyPeek) return <Eye size={size} className="text-red-500"/>;
  if (power === ExecutivePower.SpecialElection) return <Crown size={size} className="text-red-500"/>;
  if (power === ExecutivePower.Execution) return <Skull size={size} className="text-red-500"/>;
  return null;
}

function getPowerLabel(power: ExecutivePower | null) {
  if (power === ExecutivePower.InvestigateLoyalty) return 'გამოძიების უფლება';
  if (power === ExecutivePower.PolicyPeek) return 'კანონების ნახვა';
  if (power === ExecutivePower.SpecialElection) return 'სპეც. არჩევნები';
  if (power === ExecutivePower.Execution) return 'მოკვლის უფლება';
  return '';
}

function translateParty(party: PartyMembership) {
  return party === PartyMembership.Liberal ? 'ლიბერალი' : 'ფაშისტი';
}

function getStageLabel(stage: GameStage) {
  if (stage === GameStage.Lobby) return 'ლოდინი';
  if (stage === GameStage.RoleReveal) return 'როლების ნახვა';
  if (stage === GameStage.Nomination) return 'კანცლერის არჩევა';
  if (stage === GameStage.Voting) return 'არჩევნები';
  if (stage === GameStage.LegislativePresident) return 'პრეზიდენტის კანონები';
  if (stage === GameStage.LegislativeChancellor) return 'კანცლერის კანონები';
  if (stage === GameStage.ExecutiveAction) return 'პრეზიდენტის მოქმედება';
  if (stage === GameStage.GameOver) return 'დასრულდა';
  return 'თამაში';
}
