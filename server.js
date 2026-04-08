const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 90JQKA Game Engine
// ============================================================

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  SUITS.forEach(s => RANKS.forEach(r => deck.push(`${s}${r}`)));
  return deck;
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateRoomId() {
  for (let i = 0; i < 100; i++) {
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    if (!roomStore.has(id)) return id;
  }
  throw new Error('无法生成房间号');
}

function getCardRank(card) {
  return card.slice(1); // e.g. '♠10' → '10', '♥J' → 'J'
}

// ============================================================
// Room Store (in-memory)
// ============================================================

const roomStore = new Map();
const playerSocketMap = new Map();

function sanitizeRoom(room) {
  return {
    roomId: room.roomId,
    ownerOpenId: room.ownerOpenId,
    status: room.status,
    direction: room.direction,
    publicCup: room.publicCup,
    kCount: room.kCount,
    aCount: room.aCount,
    currentPlayerIdx: room.currentPlayerIdx,
    drawIndex: room.drawIndex,
    deckSize: room.deck.length,
    players: room.players.map(p => ({
      openId: p.openId,
      nickName: p.nickName,
      avatarUrl: p.avatarUrl,
      ready: p.ready,
      drinks: p.drinks,
      activeQ: p.activeQ,
      drawnCards: p.drawnCards,
      offline: p.offline || false,
      lastDrawnCard: p.lastDrawnCard || null
    })),
    turnLog: room.turnLog.slice(-30),
    pendingAction: room.pendingAction || null
  };
}

function broadcastRoom(roomId) {
  const room = roomStore.get(roomId);
  if (room) {
    io.to(`room:${roomId}`).emit('roomUpdate', sanitizeRoom(room));
  }
}

// ============================================================
// API Routes
// ============================================================

app.post('/api/createRoom', (req, res) => {
  try {
    const { playerId, nickName = '玩家', avatarUrl = '' } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = generateRoomId();

    const room = {
      roomId,
      ownerOpenId: playerId,
      status: 'waiting',
      deck: [],
      drawIndex: 0,
      currentPlayerIdx: 0,
      direction: 1,
      publicCup: 0,
      kCount: 0,
      aCount: 0,
      players: [{
        openId: playerId, nickName, avatarUrl,
        ready: false, drinks: 0, activeQ: false,
        drawnCards: [], offline: false, lastDrawnCard: null
      }],
      turnLog: [],
      pendingAction: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    roomStore.set(roomId, room);
    res.json({ ok: true, roomId, openId: playerId });
  } catch (err) {
    console.error('createRoom error:', err);
    res.json({ ok: false, code: 'CREATE_FAILED', message: err.message });
  }
});

app.post('/api/joinRoom', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, nickName = '玩家', avatarUrl = '' } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (room.players.length >= 6) {
      return res.json({ ok: false, code: 'ROOM_FULL', message: '房间已满（最多6人）' });
    }

    if (room.status !== 'waiting') {
      const idx = room.players.findIndex(p => p.openId === playerId);
      if (idx === -1) {
        return res.json({ ok: false, code: 'GAME_IN_PROGRESS', message: '游戏进行中，无法加入' });
      }
    }

    const players = room.players;
    const idx = players.findIndex(p => p.openId === playerId);
    const isNewPlayer = idx === -1;

    if (isNewPlayer) {
      players.push({
        openId: playerId, nickName, avatarUrl,
        ready: false, drinks: 0, activeQ: false,
        drawnCards: [], offline: false, lastDrawnCard: null
      });
    } else {
      players[idx].nickName = nickName;
      players[idx].avatarUrl = avatarUrl;
      players[idx].offline = false;
    }

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({
      ok: true, openId: playerId,
      room: sanitizeRoom(room)
    });
  } catch (err) {
    console.error('joinRoom error:', err);
    res.json({ ok: false, code: 'JOIN_FAILED', message: err.message });
  }
});

app.post('/api/getRoom', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    res.json({ ok: true, openId: playerId || '', room: sanitizeRoom(room) });
  } catch (err) {
    console.error('getRoom error:', err);
    res.json({ ok: false, code: 'GET_ROOM_FAILED', message: err.message });
  }
});

app.post('/api/ready', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (room.status !== 'waiting') {
      return res.json({ ok: false, code: 'GAME_STARTED', message: '游戏已经开始' });
    }

    const player = room.players.find(p => p.openId === playerId);
    if (!player) return res.json({ ok: false, code: 'NOT_IN_ROOM', message: '不在房间内' });

    player.ready = !player.ready;
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, ready: player.ready, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('ready error:', err);
    res.json({ ok: false, code: 'READY_FAILED', message: err.message });
  }
});

app.post('/api/startGame', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (playerId !== room.ownerOpenId) {
      return res.json({ ok: false, code: 'NOT_OWNER', message: '只有房主才能开始游戏' });
    }

    if (room.status !== 'waiting') {
      return res.json({ ok: false, code: 'GAME_STARTED', message: '游戏已经开始' });
    }

    if (room.players.length < 2) {
      return res.json({ ok: false, code: 'NOT_ENOUGH', message: '至少需要2名玩家' });
    }

    const allReady = room.players.every(p => p.ready);
    if (!allReady) {
      return res.json({ ok: false, code: 'NOT_ALL_READY', message: '还有玩家未准备' });
    }

    // Initialize game
    room.deck = shuffle(createDeck());
    room.drawIndex = 0;
    room.currentPlayerIdx = 0; // owner starts
    room.direction = 1;
    room.publicCup = 0;
    room.kCount = 0;
    room.aCount = 0;
    room.turnLog = [];
    room.pendingAction = null;
    room.players.forEach(p => {
      p.drawnCards = [];
      p.activeQ = false;
      p.lastDrawnCard = null;
      // drinks persist across rounds
    });

    room.status = 'playing';
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('startGame error:', err);
    res.json({ ok: false, code: 'START_FAILED', message: err.message });
  }
});

app.post('/api/drawCard', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (room.status !== 'playing') {
      return res.json({ ok: false, code: 'NOT_PLAYING', message: '游戏未在进行中' });
    }

    // Check if there's a pending action (like J add wine)
    if (room.pendingAction) {
      return res.json({ ok: false, code: 'PENDING_ACTION', message: '请先完成当前操作' });
    }

    const currentIdx = room.currentPlayerIdx;
    const currentPlayer = room.players[currentIdx];

    if (!currentPlayer || currentPlayer.openId !== playerId) {
      return res.json({ ok: false, code: 'NOT_YOUR_TURN', message: '还没轮到你' });
    }

    if (room.drawIndex >= room.deck.length) {
      return res.json({ ok: false, code: 'DECK_EMPTY', message: '牌已摸完' });
    }

    // Draw the card
    const card = room.deck[room.drawIndex];
    room.drawIndex++;

    const rank = getCardRank(card);
    currentPlayer.lastDrawnCard = card;
    currentPlayer.drawnCards.push(card);

    let logEntry = { playerId, nickName: currentPlayer.nickName, card, action: '' };
    let cardEffect = null;

    if (rank === '10') {
      // Reverse direction
      room.direction *= -1;
      logEntry.action = '方向反转';
      cardEffect = { type: 'reverse' };
      advanceToNextPlayer(room);

    } else if (rank === 'J') {
      // Need to add wine - set pending action
      logEntry.action = '请加酒';
      cardEffect = { type: 'addWine' };
      room.pendingAction = { type: 'addWine', playerIdx: currentIdx, card };

    } else if (rank === 'Q') {
      // Check if anyone else has activeQ
      const existingQHolder = room.players.find(p => p.activeQ && p.openId !== playerId);
      if (existingQHolder) {
        existingQHolder.activeQ = false;
        currentPlayer.activeQ = false; // the new Q also gets cancelled
        logEntry.action = '双Q相消！';
        cardEffect = { type: 'qCancel', cancelledPlayer: existingQHolder.openId };
      } else {
        currentPlayer.activeQ = true;
        logEntry.action = '获得跳过能力';
        cardEffect = { type: 'qGain' };
      }
      advanceToNextPlayer(room);

    } else if (rank === 'K') {
      // Global K count
      room.kCount++;
      const drinkAmount = room.kCount;
      currentPlayer.drinks += drinkAmount;
      logEntry.action = `喝 ${drinkAmount} 杯（第${room.kCount}张K）`;
      cardEffect = { type: 'drink', amount: drinkAmount, kCount: room.kCount };
      advanceToNextPlayer(room);

    } else if (rank === 'A') {
      room.aCount++;
      if (room.aCount >= 4) {
        // 4th A - game over
        const cupAmount = room.publicCup;
        currentPlayer.drinks += cupAmount;
        logEntry.action = `第4张A！喝完公杯 ${cupAmount} 杯`;
        cardEffect = { type: 'gameOver', cupAmount, totalDrinks: currentPlayer.drinks };
        room.publicCup = 0;
        room.status = 'finished';
        room.pendingAction = null;
      } else {
        logEntry.action = `继续摸牌（第${room.aCount}张A）`;
        cardEffect = { type: 'drawAgain', aCount: room.aCount };
        // Same player draws again - don't advance
      }
    }

    room.turnLog.push(logEntry);

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, card, cardEffect, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('drawCard error:', err);
    res.json({ ok: false, code: 'DRAW_FAILED', message: err.message });
  }
});

app.post('/api/addWine', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, cups } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const addCups = parseInt(cups);
    if (![1, 2, 3].includes(addCups)) {
      return res.json({ ok: false, code: 'INVALID_CUPS', message: '请选择1-3杯' });
    }

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (!room.pendingAction || room.pendingAction.type !== 'addWine') {
      return res.json({ ok: false, code: 'NO_PENDING', message: '当前无需加酒' });
    }

    const pendingIdx = room.pendingAction.playerIdx;
    const pendingPlayer = room.players[pendingIdx];
    if (!pendingPlayer || pendingPlayer.openId !== playerId) {
      return res.json({ ok: false, code: 'NOT_YOUR_ACTION', message: '不是你的操作' });
    }

    room.publicCup += addCups;

    // Update the last log entry action
    const lastLog = room.turnLog[room.turnLog.length - 1];
    if (lastLog) {
      lastLog.action = `往公杯加了 ${addCups} 杯酒`;
    }

    room.pendingAction = null;
    advanceToNextPlayer(room);

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, addedCups: addCups, publicCup: room.publicCup, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('addWine error:', err);
    res.json({ ok: false, code: 'ADD_WINE_FAILED', message: err.message });
  }
});

app.post('/api/skipTurn', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (room.status !== 'playing') {
      return res.json({ ok: false, code: 'NOT_PLAYING', message: '游戏未在进行中' });
    }

    if (room.pendingAction) {
      return res.json({ ok: false, code: 'PENDING_ACTION', message: '请先完成当前操作' });
    }

    const currentIdx = room.currentPlayerIdx;
    const currentPlayer = room.players[currentIdx];

    if (!currentPlayer || currentPlayer.openId !== playerId) {
      return res.json({ ok: false, code: 'NOT_YOUR_TURN', message: '还没轮到你' });
    }

    if (!currentPlayer.activeQ) {
      return res.json({ ok: false, code: 'NO_Q', message: '你没有跳过能力' });
    }

    // Use Q to skip
    currentPlayer.activeQ = false;
    room.turnLog.push({
      playerId, nickName: currentPlayer.nickName, card: null,
      action: '使用Q跳过'
    });

    advanceToNextPlayer(room);

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('skipTurn error:', err);
    res.json({ ok: false, code: 'SKIP_FAILED', message: err.message });
  }
});

app.post('/api/restartGame', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (playerId !== room.ownerOpenId) {
      return res.json({ ok: false, code: 'NOT_OWNER', message: '只有房主才能开始新一局' });
    }

    // Reset game state but keep players and drinks
    room.deck = shuffle(createDeck());
    room.drawIndex = 0;
    room.currentPlayerIdx = 0;
    room.direction = 1;
    room.publicCup = 0;
    room.kCount = 0;
    room.aCount = 0;
    room.turnLog = [];
    room.pendingAction = null;
    room.players.forEach(p => {
      p.ready = false;
      p.activeQ = false;
      p.drawnCards = [];
      p.lastDrawnCard = null;
    });
    room.status = 'waiting';
    room.updatedAt = new Date();

    io.to(`room:${roomId}`).emit('roundReset', { roomId });
    broadcastRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('restartGame error:', err);
    res.json({ ok: false, code: 'RESTART_FAILED', message: err.message });
  }
});

app.post('/api/kickPlayer', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, targetPlayerId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (playerId !== room.ownerOpenId) {
      return res.json({ ok: false, code: 'NOT_OWNER', message: '只有房主才能踢人' });
    }

    if (targetPlayerId === playerId) {
      return res.json({ ok: false, code: 'CANNOT_KICK_SELF', message: '不能踢自己' });
    }

    if (room.status === 'playing') {
      return res.json({ ok: false, code: 'GAME_IN_PROGRESS', message: '游戏进行中不能踢人' });
    }

    const targetIdx = room.players.findIndex(p => p.openId === targetPlayerId);
    if (targetIdx === -1) return res.json({ ok: false, code: 'PLAYER_NOT_FOUND', message: '目标玩家不在房间' });

    room.players.splice(targetIdx, 1);
    io.to(`room:${roomId}`).emit('playerKicked', { roomId, kickedPlayerId: targetPlayerId });

    if (room.players.length === 0) {
      roomStore.delete(roomId);
    } else {
      room.updatedAt = new Date();
      broadcastRoom(roomId);
    }

    res.json({ ok: true, room: room.players.length > 0 ? sanitizeRoom(room) : null });
  } catch (err) {
    console.error('kickPlayer error:', err);
    res.json({ ok: false, code: 'KICK_FAILED', message: err.message });
  }
});

function advanceToNextPlayer(room) {
  const n = room.players.length;
  room.currentPlayerIdx = (room.currentPlayerIdx + room.direction + n) % n;
}

// ============================================================
// Test & Simulation Utilities
// ============================================================

const TEST_KEY = process.env.TEST_KEY || 'jqka2026';

app.post('/api/_cleanTestRooms', (req, res) => {
  if (req.body.key !== TEST_KEY) {
    return res.json({ ok: false, code: 'UNAUTHORIZED', message: '密钥错误' });
  }
  let count = 0;
  for (const [roomId] of roomStore) {
    if (roomId.startsWith('_t_') || roomId.startsWith('_sim_')) {
      roomStore.delete(roomId);
      count++;
    }
  }
  res.json({ ok: true, cleaned: count });
});

/** Simulation helper: create room with a fixed deck for deterministic testing */
app.post('/api/_simCreateRoom', (req, res) => {
  try {
    const { players, deck, key } = req.body;
    if (key !== TEST_KEY) return res.json({ ok: false, code: 'UNAUTHORIZED' });

    const roomId = '_sim_' + Date.now();
    const finalDeck = (deck && deck.length === 20) ? deck.slice() : shuffle(createDeck());

    const room = {
      roomId,
      ownerOpenId: players[0].id,
      status: 'waiting',
      deck: finalDeck,
      drawIndex: 0,
      currentPlayerIdx: 0,
      direction: 1,
      publicCup: 0,
      kCount: 0,
      aCount: 0,
      players: players.map(p => ({
        openId: p.id, nickName: p.name, avatarUrl: '',
        ready: false, drinks: 0, activeQ: false,
        drawnCards: [], offline: false, lastDrawnCard: null
      })),
      turnLog: [],
      pendingAction: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    roomStore.set(roomId, room);
    res.json({ ok: true, roomId });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// ============================================================
// Socket.IO
// ============================================================

io.on('connection', (socket) => {
  let socketPlayerId = null;
  let socketRoomId = null;

  socket.on('joinRoom', (roomId, playerId) => {
    socket.join(`room:${roomId}`);
    if (playerId) {
      socketPlayerId = playerId;
      socketRoomId = roomId;
      playerSocketMap.set(playerId, socket.id);

      const room = roomStore.get(roomId);
      if (room) {
        const p = room.players.find(x => x.openId === playerId);
        if (p && p.offline) {
          p.offline = false;
          room.updatedAt = new Date();
          broadcastRoom(roomId);
        }
      }
    }
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room:${roomId}`);
  });

  socket.on('disconnect', () => {
    if (!socketPlayerId || !socketRoomId) return;
    if (playerSocketMap.get(socketPlayerId) !== socket.id) return;

    playerSocketMap.delete(socketPlayerId);
    const room = roomStore.get(socketRoomId);
    if (!room) return;
    const p = room.players.find(x => x.openId === socketPlayerId);
    if (!p) return;

    p.offline = true;
    room.updatedAt = new Date();
    broadcastRoom(socketRoomId);

    // Clean up if room is empty after 60s
    const pid = socketPlayerId;
    const rid = socketRoomId;
    setTimeout(() => {
      const r = roomStore.get(rid);
      if (!r) return;
      const player = r.players.find(x => x.openId === pid);
      if (player && player.offline) {
        r.players = r.players.filter(x => x.openId !== pid);
        if (r.players.length === 0) {
          roomStore.delete(rid);
        } else {
          r.updatedAt = new Date();
          broadcastRoom(rid);
        }
      }
    }, 60000);
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`90JQKA 游戏运行在 http://localhost:${PORT}`);
});
