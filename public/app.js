(function () {
  'use strict';

  // ============================================================
  // Utilities
  // ============================================================

  const $ = (sel) => document.querySelector(sel);
  const $app = () => $('#app');

  function generateId() {
    return 'p_' + Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
  }

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    const colors = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
    return colors[Math.abs(h) % colors.length];
  }

  function renderAvatar(name, size, extraClass) {
    var initial = (name || '?')[0];
    var bg = hashColor(name || '?');
    return '<div class="avatar ' + (extraClass || '') + '" style="background:' + bg +
      ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.45) + 'px">' +
      escHtml(initial) + '</div>';
  }

  function getCardColorClass(card) {
    if (!card) return '';
    return (card.startsWith('♥') || card.startsWith('♦')) ? 'poker-card-text-red' : '';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg, duration) {
    duration = duration || 2500;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(function () { el.remove(); }, duration);
  }

  function showEffectToast(msg) {
    var el = document.createElement('div');
    el.className = 'card-effect-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2000);
  }

  function showLoading(msg) {
    var overlay = $('#loading-overlay');
    overlay.querySelector('.loading-text').textContent = msg || '加载中...';
    overlay.style.display = 'flex';
  }

  function hideLoading() {
    $('#loading-overlay').style.display = 'none';
  }

  // ============================================================
  // State
  // ============================================================

  var state = {
    playerId: localStorage.getItem('jqka_playerId') || (function () {
      var id = generateId();
      localStorage.setItem('jqka_playerId', id);
      return id;
    })(),
    userInfo: JSON.parse(localStorage.getItem('jqka_userInfo') || 'null'),
    currentPage: '',
    roomId: '',
    isOwner: false,
    room: null
  };

  // ============================================================
  // API
  // ============================================================

  function api(endpoint, data) {
    var body = Object.assign({}, data || {}, { playerId: state.playerId });
    return fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // ============================================================
  // Socket.IO
  // ============================================================

  var socket = null;
  var currentSocketRoom = null;

  function initSocket() {
    if (socket) return;
    socket = io({ reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

    socket.on('roomUpdate', function (room) {
      if ((state.currentPage === 'room' || state.currentPage === 'game') && room.roomId === state.roomId) {
        handleRoomUpdate(room);
      }
    });

    socket.on('roundReset', function (data) {
      if (data.roomId === state.roomId) {
        state.room = null;
        navigate('/room/' + state.roomId + (state.isOwner ? '/owner' : ''));
      }
    });

    socket.on('playerKicked', function (data) {
      if (data.roomId === state.roomId && data.kickedPlayerId === state.playerId) {
        showToast('你已被移出房间');
        leaveSocketRoom();
        navigate('/');
      }
    });

    socket.on('reconnect', function () {
      if (currentSocketRoom) {
        socket.emit('joinRoom', currentSocketRoom, state.playerId);
        if (state.currentPage === 'room' || state.currentPage === 'game') fetchRoom();
      }
    });
  }

  function joinSocketRoom(roomId) {
    if (!socket) return;
    if (currentSocketRoom && currentSocketRoom !== roomId) {
      socket.emit('leaveRoom', currentSocketRoom);
    }
    currentSocketRoom = roomId;
    socket.emit('joinRoom', roomId, state.playerId);
  }

  function leaveSocketRoom() {
    if (!socket || !currentSocketRoom) return;
    socket.emit('leaveRoom', currentSocketRoom);
    currentSocketRoom = null;
  }

  // ============================================================
  // Router
  // ============================================================

  function navigate(hash) {
    window.location.hash = hash;
  }

  function parseRoute() {
    var rawHash = window.location.hash.slice(1) || '/';
    var hash = rawHash.split('?')[0];
    var parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'room' && parts[1]) {
      return { page: 'room', roomId: parts[1], isOwner: parts[2] === 'owner' };
    }
    if (parts[0] === 'result' && parts[1]) {
      return { page: 'result', roomId: parts[1] };
    }
    if (parts[0] === 'test') {
      return { page: 'test' };
    }
    if (parts[0] === 'simulate') {
      return { page: 'simulate' };
    }
    return { page: 'lobby' };
  }

  function handleRoute() {
    var route = parseRoute();
    var prevPage = state.currentPage;
    state.currentPage = route.page;

    if (prevPage === 'room' && route.page !== 'room') {
      leaveSocketRoom();
    }

    switch (route.page) {
      case 'room':
        state.roomId = route.roomId;
        state.isOwner = route.isOwner;
        initRoomPage();
        break;
      case 'result':
        state.roomId = route.roomId;
        initResultPage();
        break;
      case 'test':
        initTestPage();
        break;
      case 'simulate':
        initSimulatePage();
        break;
      default:
        initLobbyPage();
        break;
    }
  }

  // ============================================================
  // Lobby Page
  // ============================================================

  function initLobbyPage() {
    var hasUser = !!state.userInfo;
    renderLobby(!hasUser);
  }

  function renderLobby(showAuth) {
    var userInfo = state.userInfo;
    var html = '<div class="lobby-container">';
    html += '<div class="lobby-title">90JQKA</div>';
    html += '<div class="lobby-subtitle">饮酒扑克 · 好友对战</div>';

    if (!showAuth) {
      html += '<div class="action-panel">';
      html += '<div class="action-row btn-primary" onclick="App.createRoom()">创建房间</div>';
      html += '<div class="action-row btn-secondary" onclick="App.toggleJoinInput()">加入房间</div>';
      html += '<div id="join-section" style="display:none">';
      html += '<div class="action-row input-row"><input class="action-input" placeholder="请输入房间号" maxlength="10" id="join-room-input"></div>';
      html += '<div class="action-row btn-primary" onclick="App.confirmJoin()">确认加入</div>';
      html += '</div>';
      html += '</div>';
    }

    if (showAuth) {
      html += '<div class="auth-mask"><div class="auth-modal">';
      html += '<div class="auth-header">';
      html += '<span class="auth-title">设置你的游戏昵称</span>';
      html += '<span class="auth-desc">输入昵称后即可创建或加入房间</span>';
      html += '</div>';
      if (userInfo) {
        html += '<div class="profile-preview">';
        html += renderAvatar(userInfo.nickName, 60, '');
        html += '<span class="profile-name">' + escHtml(userInfo.nickName) + '</span>';
        html += '</div>';
      }
      html += '<div class="auth-action-group">';
      html += '<div class="action-row input-row"><input class="action-input" placeholder="请输入你的昵称" maxlength="12" id="nickname-input" value="' + escHtml((userInfo && userInfo.nickName) || '') + '"></div>';
      html += '<div class="action-row btn-primary" onclick="App.confirmProfile()">确认并进入大厅</div>';
      html += '</div></div></div>';
    }

    html += '</div>';
    $app().innerHTML = html;
  }

  window.App = {};

  App.confirmProfile = function () {
    var input = $('#nickname-input');
    var name = (input && input.value || '').trim();
    if (!name) { showToast('请输入昵称'); return; }
    state.userInfo = { nickName: name };
    localStorage.setItem('jqka_userInfo', JSON.stringify(state.userInfo));
    showToast('已确认昵称');
    renderLobby(false);
  };

  App.createRoom = function () {
    if (!state.userInfo) return;
    showLoading('创建中...');
    api('createRoom', {
      nickName: state.userInfo.nickName,
      avatarUrl: ''
    }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '创建失败'); return; }
      navigate('/room/' + result.roomId + '/owner');
    }).catch(function () { hideLoading(); showToast('创建失败'); });
  };

  var joinInputShown = false;
  App.toggleJoinInput = function () {
    joinInputShown = !joinInputShown;
    var sec = $('#join-section');
    if (sec) sec.style.display = joinInputShown ? 'flex' : 'none';
    if (sec && !sec.style.flexDirection) {
      sec.style.flexDirection = 'column';
      sec.style.gap = '12px';
    }
  };

  App.confirmJoin = function () {
    if (!state.userInfo) return;
    var input = $('#join-room-input');
    var roomId = (input && input.value || '').trim();
    if (!roomId) { showToast('请输入房间号'); return; }
    showLoading('加入中...');
    api('joinRoom', {
      roomId: roomId,
      nickName: state.userInfo.nickName,
      avatarUrl: ''
    }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '加入失败'); return; }
      navigate('/room/' + roomId);
    }).catch(function () { hideLoading(); showToast('加入失败'); });
  };

  // ============================================================
  // Room / Game Page
  // ============================================================

  function initRoomPage() {
    $app().innerHTML = '<div class="room-page"><div style="text-align:center;padding-top:40px;color:#9ca3af">加载中...</div></div>';
    joinSocketRoom(state.roomId);
    fetchRoom();
  }

  function fetchRoom() {
    api('getRoom', { roomId: state.roomId }).then(function (result) {
      if (!result.ok) {
        showToast(result.message || '房间不存在');
        navigate('/');
        return;
      }
      handleRoomUpdate(result.room);
    }).catch(function () {
      showToast('加载失败');
      navigate('/');
    });
  }

  function playerInRoom(room, openId) {
    if (!room || !room.players || !openId) return false;
    return room.players.some(function (p) { return p.openId === openId; });
  }

  function handleRoomUpdate(room) {
    if (!room) return;

    if (!playerInRoom(room, state.playerId)) {
      renderPendingJoin(room);
      return;
    }

    state.room = room;

    if (room.status === 'finished') {
      state.currentPage = 'result';
      navigate('/result/' + room.roomId);
      return;
    }

    renderGamePage(room);
  }

  function renderPendingJoin(room) {
    var rid = room.roomId || state.roomId;
    var html = '<div class="lobby-container pending-join-page">';
    html += '<div class="lobby-title">加入房间</div>';
    html += '<div class="auth-mask"><div class="auth-modal">';
    html += '<div class="auth-header">';
    html += '<span class="auth-title">房间号 ' + escHtml(rid) + '</span>';
    html += '<span class="auth-desc">请输入昵称后加入</span>';
    html += '</div>';
    if (state.userInfo && state.userInfo.nickName) {
      html += '<div class="profile-preview">';
      html += renderAvatar(state.userInfo.nickName, 60, '');
      html += '<span class="profile-name">' + escHtml(state.userInfo.nickName) + '</span>';
      html += '</div>';
    }
    html += '<div class="auth-action-group">';
    html += '<div class="action-row input-row"><input class="action-input" placeholder="请输入你的昵称" maxlength="12" id="invite-nickname-input" value="' + escHtml((state.userInfo && state.userInfo.nickName) || '') + '"></div>';
    html += '<div class="action-row btn-primary" onclick="App.joinRoomFromInvite()">确认加入</div>';
    html += '<div class="action-row btn-secondary" onclick="App.backToLobbyFromInvite()">返回大厅</div>';
    html += '</div></div></div></div>';
    $app().innerHTML = html;
  }

  App.joinRoomFromInvite = function () {
    var input = $('#invite-nickname-input');
    var nick = (input && input.value || '').trim();
    if (!nick) { showToast('请输入昵称'); return; }
    state.userInfo = { nickName: nick };
    localStorage.setItem('jqka_userInfo', JSON.stringify(state.userInfo));
    showLoading('加入中...');
    api('joinRoom', {
      roomId: state.roomId,
      nickName: nick,
      avatarUrl: ''
    }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '加入失败'); return; }
      handleRoomUpdate(result.room);
    }).catch(function () { hideLoading(); showToast('加入失败'); });
  };

  App.backToLobbyFromInvite = function () {
    navigate('/');
  };

  // ============================================================
  // Game Page Rendering
  // ============================================================

  function renderGamePage(room) {
    var status = room.status;
    var selfId = state.playerId;
    var isOwner = room.ownerOpenId === selfId;

    var html = '<div class="room-page">';

    // Header
    html += '<div class="room-header">';
    html += '<span class="room-id">房间号：' + escHtml(room.roomId) + '</span>';
    html += '<button class="invite-btn" onclick="App.invite()">邀请</button>';
    html += '</div>';

    if (status === 'waiting') {
      html += renderWaitingPage(room);
    } else if (status === 'playing') {
      html += renderPlayingPage(room);
    }

    html += '</div>';
    $app().innerHTML = html;

    // Animate cup liquid after render
    if (status === 'playing') {
      animateCupLiquid(room.publicCup);
    }
  }

  // -- Waiting Phase --

  function renderWaitingPage(room) {
    var selfId = state.playerId;
    var isOwner = room.ownerOpenId === selfId;
    var allReady = room.players.every(function (p) { return p.ready; });
    var selfPlayer = room.players.find(function (p) { return p.openId === selfId; });
    var selfReady = selfPlayer && selfPlayer.ready;

    var html = '';

    // Players
    html += '<div class="players-table">';
    room.players.forEach(function (p) {
      var isPOwner = p.openId === room.ownerOpenId;
      var isSelf = p.openId === selfId;
      var avatarClass = isPOwner ? 'owner-avatar' : (p.ready ? 'ready-avatar' : '');

      html += '<div class="player-seat' + (isSelf ? ' is-self' : '') + '">';
      if (isPOwner) html += '<span class="crown-badge">👑</span>';
      html += renderAvatar(p.nickName, 40, avatarClass);
      html += '<span class="nickname">' + escHtml(p.nickName) + '</span>';
      html += '<div class="player-tags">';
      if (p.drinks > 0) html += '<span class="ptag ptag-drinks">🍺' + p.drinks + '</span>';
      if (p.ready) html += '<span class="ptag ptag-ready">已准备</span>';
      else if (isSelf) html += '<span class="ptag ptag-waiting">未准备</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Bottom bar
    html += '<div class="bottom-bar">';
    if (isOwner && allReady && room.players.length >= 2) {
      html += '<button class="btn btn-primary btn-full" onclick="App.startGame()">开始游戏</button>';
    } else if (isOwner && !allReady) {
      html += '<span class="status-text">等待所有玩家准备...</span>';
    } else if (!selfReady) {
      html += '<button class="btn btn-green btn-full" onclick="App.toggleReady()">准备</button>';
    } else {
      html += '<span class="status-text">已准备，等待房主开始...</span>';
    }
    html += '</div>';

    return html;
  }

  App.toggleReady = function () {
    api('ready', { roomId: state.roomId }).then(function (result) {
      if (!result.ok) showToast(result.message || '操作失败');
    }).catch(function () { showToast('操作失败'); });
  };

  App.startGame = function () {
    showLoading('开始中...');
    api('startGame', { roomId: state.roomId }).then(function (result) {
      hideLoading();
      if (!result.ok) showToast(result.message || '开始失败');
    }).catch(function () { hideLoading(); showToast('开始失败'); });
  };

  // -- Playing Phase --

  function renderPlayingPage(room) {
    var selfId = state.playerId;
    var isOwner = room.ownerOpenId === selfId;
    var currentPlayer = room.players[room.currentPlayerIdx];
    var isMyTurn = currentPlayer && currentPlayer.openId === selfId;
    var selfPlayer = room.players.find(function (p) { return p.openId === selfId; });
    var pendingAction = room.pendingAction;
    var isPendingForMe = pendingAction && room.players[pendingAction.playerIdx] && room.players[pendingAction.playerIdx].openId === selfId;

    var html = '';

    // Direction bar
    var dirArrow = room.direction === 1 ? '➡️' : '⬅️';
    var dirText = room.direction === 1 ? '顺时针' : '逆时针';
    html += '<div class="direction-bar">';
    html += '<span class="direction-arrow">' + dirArrow + '</span>';
    html += '<span>' + dirText + '</span>';
    html += '<span style="margin-left:auto;font-size:11px;color:#6b7280">剩余 ' + (room.deckSize - room.drawIndex) + ' 张</span>';
    html += '</div>';

    // Players
    html += '<div class="players-table">';
    room.players.forEach(function (p, idx) {
      var isPOwner = p.openId === room.ownerOpenId;
      var isSelf = p.openId === selfId;
      var isCurrent = idx === room.currentPlayerIdx;
      var avatarClass = isPOwner ? 'owner-avatar' : '';

      html += '<div class="player-seat' + (isCurrent ? ' current-turn' : '') + (isSelf ? ' is-self' : '') + (p.offline ? ' offline-seat' : '') + '">';
      if (isPOwner) html += '<span class="crown-badge">👑</span>';
      html += renderAvatar(p.nickName, 40, avatarClass);
      html += '<span class="nickname">' + escHtml(p.nickName) + (isCurrent ? ' 🎯' : '') + '</span>';
      html += '<div class="player-tags">';
      if (p.drinks > 0) html += '<span class="ptag ptag-drinks">🍺' + p.drinks + '</span>';
      if (p.activeQ) html += '<span class="ptag ptag-q-shield">🛡Q</span>';
      html += '</div>';
      if (p.lastDrawnCard) {
        html += '<div class="last-card-display">';
        html += renderMiniCard(p.lastDrawnCard);
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Public Cup
    html += '<div class="public-cup-zone">';
    html += '<div class="public-cup" id="public-cup">';
    html += '<div class="cup-rim"></div>';
    html += '<div class="cup-liquid" id="cup-liquid"></div>';
    html += '<span class="cup-count" id="cup-count">' + room.publicCup + '</span>';
    html += '</div>';
    html += '<span class="cup-label">🍺 公杯</span>';

    // Add wine buttons (only visible for the player who drew J)
    if (isPendingForMe && pendingAction.type === 'addWine') {
      html += '<div class="add-wine-buttons">';
      html += '<button class="wine-btn" onclick="App.addWine(1)">+1杯</button>';
      html += '<button class="wine-btn" onclick="App.addWine(2)">+2杯</button>';
      html += '<button class="wine-btn" onclick="App.addWine(3)">+3杯</button>';
      html += '</div>';
    }

    html += '</div>';

    // Turn log
    if (room.turnLog && room.turnLog.length > 0) {
      html += '<div class="turn-log">';
      html += '<div class="turn-log-title">📋 出牌记录</div>';
      var logs = room.turnLog.slice().reverse();
      logs.forEach(function (entry) {
        html += '<div class="log-entry">';
        html += '<span class="log-name">' + escHtml(entry.nickName) + '</span>';
        if (entry.card) {
          html += '<span class="log-card">';
          html += renderInlineCard(entry.card);
          html += '</span>';
        }
        html += '<span class="log-action">' + escHtml(entry.action) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Bottom bar
    html += '<div class="bottom-bar">';
    if (isPendingForMe && pendingAction.type === 'addWine') {
      html += '<span class="status-text" style="color:#fbbf24">你摸到了J，请选择加酒杯数 ↑</span>';
    } else if (isMyTurn) {
      if (selfPlayer && selfPlayer.activeQ) {
        html += '<button class="btn btn-primary btn-sm" onclick="App.drawCard()">摸牌</button>';
        html += '<button class="btn btn-secondary btn-sm" onclick="App.skipTurn()">🛡跳过(Q)</button>';
      } else {
        html += '<button class="btn btn-primary btn-full" onclick="App.drawCard()">摸牌</button>';
      }
    } else if (isPendingForMe) {
      html += '<span class="status-text">等待操作...</span>';
    } else {
      html += '<span class="status-text">等待 ' + escHtml(currentPlayer ? currentPlayer.nickName : '...') + ' 摸牌</span>';
    }
    html += '</div>';

    return html;
  }

  function animateCupLiquid(cupAmount) {
    var liquid = document.getElementById('cup-liquid');
    if (liquid) {
      var maxCup = 20;
      var pct = Math.min((cupAmount / maxCup) * 100, 100);
      if (cupAmount === 0) pct = 0;
      setTimeout(function () {
        liquid.style.height = pct + '%';
      }, 100);
    }
  }

  function renderMiniCard(card) {
    if (!card) return '';
    var colorClass = getCardColorClass(card);
    return '<div class="poker-card card-animate"><span class="poker-card-text ' + colorClass + '">' + escHtml(card) + '</span></div>';
  }

  function renderInlineCard(card) {
    if (!card) return '';
    var colorClass = getCardColorClass(card);
    return '<div class="poker-card" style="width:24px;height:32px"><span class="poker-card-text ' + colorClass + '" style="font-size:9px">' + escHtml(card) + '</span></div>';
  }

  App.drawCard = function () {
    showLoading('摸牌中...');
    api('drawCard', { roomId: state.roomId }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '摸牌失败'); return; }

      // Show effect toast
      if (result.cardEffect) {
        var effect = result.cardEffect;
        if (effect.type === 'reverse') {
          showEffectToast('🔄 方向反转！');
        } else if (effect.type === 'addWine') {
          showEffectToast('🃏 摸到J！请加酒');
        } else if (effect.type === 'qGain') {
          showEffectToast('🛡 获得跳过能力！');
        } else if (effect.type === 'qCancel') {
          showEffectToast('💥 双Q相消！');
        } else if (effect.type === 'drink') {
          showEffectToast('🍺 喝 ' + effect.amount + ' 杯！（第' + effect.kCount + '张K）');
        } else if (effect.type === 'drawAgain') {
          showEffectToast('🔁 继续摸牌！（第' + effect.aCount + '张A）');
        } else if (effect.type === 'gameOver') {
          showEffectToast('GameOver！喝完公杯 ' + effect.cupAmount + ' 杯！');
        }
      }
    }).catch(function () { hideLoading(); showToast('摸牌失败'); });
  };

  App.addWine = function (cups) {
    showLoading('加酒中...');
    api('addWine', { roomId: state.roomId, cups: cups }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '加酒失败'); return; }
      showEffectToast('🍺 往公杯加了 ' + cups + ' 杯！');
    }).catch(function () { hideLoading(); showToast('加酒失败'); });
  };

  App.skipTurn = function () {
    showLoading('跳过中...');
    api('skipTurn', { roomId: state.roomId }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '跳过失败'); return; }
      showToast('使用Q跳过了本轮');
    }).catch(function () { hideLoading(); showToast('跳过失败'); });
  };

  // ============================================================
  // Result Page
  // ============================================================

  function initResultPage() {
    joinSocketRoom(state.roomId);
    $app().innerHTML = '<div class="result-page"><div style="text-align:center;padding-top:40px;color:#9ca3af">加载中...</div></div>';
    api('getRoom', { roomId: state.roomId }).then(function (result) {
      if (result.ok && result.room) {
        renderResultPage(result.room);
      } else {
        showToast('房间不存在');
        navigate('/');
      }
    }).catch(function () {
      showToast('加载失败');
      navigate('/');
    });
  }

  function renderResultPage(room) {
    var selfId = state.playerId;
    var isOwner = room.ownerOpenId === selfId;

    // Sort players by drinks descending
    var sorted = room.players.slice().sort(function (a, b) { return (b.drinks || 0) - (a.drinks || 0); });

    var html = '<div class="result-page">';

    // Header
    html += '<div class="result-header">';
    html += '<div class="result-title">🏆 本局结束</div>';
    html += '<div class="result-subtitle">房间号：' + escHtml(room.roomId) + '</div>';
    html += '</div>';

    // Rankings
    sorted.forEach(function (p, idx) {
      var isSelf = p.openId === selfId;
      var isTop = idx === 0 && p.drinks > 0;
      var rankText = idx === 0 ? '👑' : (idx + 1);

      html += '<div class="result-card' + (isTop ? ' top-drinker' : '') + '">';
      html += '<span class="result-rank">' + rankText + '</span>';
      html += renderAvatar(p.nickName, 40, '');
      html += '<div class="result-info">';
      html += '<span class="result-name">' + escHtml(p.nickName) + (isSelf ? ' (你)' : '') + '</span>';
      html += '<span class="result-drinks">🍺 ' + (p.drinks || 0) + ' 杯</span>';
      html += '</div>';
      html += '<div class="result-cards-row">';
      (p.drawnCards || []).forEach(function (c) {
        html += renderInlineCard(c);
      });
      html += '</div>';
      html += '</div>';
    });

    // Bottom
    if (isOwner) {
      html += '<button class="back-btn" onclick="App.restartGame()">再来一局</button>';
    } else {
      html += '<div class="waiting-next-round">等待房主开始新一局...</div>';
    }

    html += '</div>';
    $app().innerHTML = html;
  }

  App.restartGame = function () {
    showLoading('准备中...');
    api('restartGame', { roomId: state.roomId }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '操作失败'); return; }
      navigate('/room/' + state.roomId + (state.isOwner ? '/owner' : ''));
    }).catch(function () { hideLoading(); showToast('操作失败'); });
  };

  // ============================================================
  // Invite
  // ============================================================

  App.invite = function () {
    var url = window.location.origin + '/#/room/' + state.roomId;
    var overlay = document.createElement('div');
    overlay.className = 'invite-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    var modal = document.createElement('div');
    modal.className = 'invite-modal';

    var header = '<div class="invite-header"><span class="invite-title">邀请好友</span><span class="invite-close" onclick="this.closest(\'.invite-overlay\').remove()">✕</span></div>';
    var qrWrap = '<div class="invite-qr" id="invite-qr-container"></div>';
    var info = '<div class="invite-info">' +
      '<div class="invite-room">房间号：<span class="invite-room-id">' + escHtml(state.roomId) + '</span></div>' +
      '<div class="invite-url">' + escHtml(url) + '</div>' +
      '</div>';
    var actions = '<div class="invite-actions">' +
      '<button class="btn btn-primary invite-copy-btn" onclick="App.copyInviteLink()">复制邀请链接</button>' +
      '</div>';

    modal.innerHTML = header + qrWrap + info + actions;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      var container = document.getElementById('invite-qr-container');
      if (container) container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    } catch (e) {
      var container = document.getElementById('invite-qr-container');
      if (container) container.innerHTML = '<span style="color:#9ca3af;font-size:12px">二维码生成失败</span>';
    }
  };

  App.copyInviteLink = function () {
    var url = window.location.origin + '/#/room/' + state.roomId;
    copyText(url).then(function (ok) {
      if (ok) showToast('邀请链接已复制');
      else showToast('复制失败，房间号：' + state.roomId);
    });
  };

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return Promise.resolve(ok);
  };

  // ============================================================
  // Test Page
  // ============================================================

  function initTestPage() {
    var key = '';
    var searchStr = window.location.search || '';
    if (searchStr) key = new URLSearchParams(searchStr).get('key') || '';
    if (!key) {
      var hashQuery = (window.location.hash || '').split('?')[1] || '';
      if (hashQuery) key = new URLSearchParams(hashQuery).get('key') || '';
    }
    if (!key) {
      $app().innerHTML = '<div class="test-page"><div class="test-denied">无权访问<br><br>请使用以下格式访问：<br><code style="color:#fbbf24;font-size:13px">http://你的IP:端口/#/test?key=jqka2026</code></div></div>';
      return;
    }
    if (window.TestRunner) window.TestRunner.setKey(key);
    renderTestPage();
  }

  function renderTestPage() {
    var html = '<div class="test-page">';
    html += '<div class="test-header">';
    html += '<h1 class="test-title">90JQKA 自动化测试</h1>';
    html += '<button class="btn btn-primary test-run-btn" id="test-run-btn" onclick="App.runTests()">运行测试</button>';
    html += '</div>';
    html += '<div class="test-progress-wrap"><div class="test-progress-bar" id="test-progress" style="width:0%"></div></div>';
    html += '<div class="test-summary" id="test-summary"></div>';
    html += '<div id="test-results"></div>';
    html += '</div>';
    $app().innerHTML = html;
  }

  App.runTests = function () {
    if (typeof window.TestRunner === 'undefined') {
      showToast('测试模块未加载');
      return;
    }
    var btn = document.getElementById('test-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = '运行中...'; }
    window.TestRunner.run();
    // Re-enable button after a delay
    setTimeout(function () {
      if (btn) { btn.disabled = false; btn.textContent = '重新测试'; }
    }, 60000);
  };

  // ============================================================
  // Simulate Page
  // ============================================================

  function initSimulatePage() {
    var key = '';
    var hashQuery = (window.location.hash || '').split('?')[1] || '';
    if (hashQuery) key = new URLSearchParams(hashQuery).get('key') || '';
    if (!key) key = 'jqka2026'; // default key for sim
    if (window.SimRunner) window.SimRunner.setKey(key);
    renderSimulatePage();
  }

  function renderSimulatePage() {
    var html = '<div class="test-page sim-page">';
    html += '<div class="test-header">';
    html += '<h1 class="test-title">🎮 90JQKA 模拟测试</h1>';
    html += '<button class="btn btn-primary test-run-btn" id="sim-run-btn" onclick="App.runSim()">开始模拟</button>';
    html += '</div>';

    // Config panel
    html += '<div class="sim-config">';
    html += '<div class="sim-config-row">';
    html += '<label>玩家人数</label>';
    html += '<select id="sim-player-count">';
    for (var i = 2; i <= 6; i++) {
      html += '<option value="' + i + '"' + (i === 4 ? ' selected' : '') + '>' + i + '人</option>';
    }
    html += '</select>';
    html += '</div>';
    html += '<div class="sim-config-row">';
    html += '<label>动画速度</label>';
    html += '<select id="sim-speed">';
    html += '<option value="1500">慢速 (1.5s)</option>';
    html += '<option value="800" selected>正常 (0.8s)</option>';
    html += '<option value="300">快速 (0.3s)</option>';
    html += '<option value="50">极速 (50ms)</option>';
    html += '</select>';
    html += '</div>';
    html += '<div class="sim-config-row">';
    html += '<label>加酒杯数</label>';
    html += '<select id="sim-wine-cups">';
    html += '<option value="1">1杯</option>';
    html += '<option value="2" selected>2杯</option>';
    html += '<option value="3">3杯</option>';
    html += '</select>';
    html += '</div>';
    html += '</div>';

    // Log area
    html += '<div id="sim-log" class="sim-log"></div>';
    html += '</div>';
    $app().innerHTML = html;
  }

  App.runSim = function () {
    if (typeof window.SimRunner === 'undefined') {
      showToast('模拟模块未加载');
      return;
    }
    if (window.SimRunner.isRunning()) {
      showToast('模拟正在运行中...');
      return;
    }

    var countEl = document.getElementById('sim-player-count');
    var speedEl = document.getElementById('sim-speed');
    var wineEl = document.getElementById('sim-wine-cups');

    window.SimRunner.setConfig({
      playerCount: countEl ? parseInt(countEl.value) : 4,
      speed: speedEl ? parseInt(speedEl.value) : 800,
      autoWineCups: wineEl ? parseInt(wineEl.value) : 2
    });

    var btn = document.getElementById('sim-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = '模拟中...'; }

    window.SimRunner.run();

    // Re-enable after delay
    var checkDone = setInterval(function () {
      if (!window.SimRunner.isRunning()) {
        clearInterval(checkDone);
        if (btn) { btn.disabled = false; btn.textContent = '重新模拟'; }
      }
    }, 1000);
  };

  // ============================================================
  // Init
  // ============================================================

  initSocket();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (socket && currentSocketRoom) {
      socket.emit('joinRoom', currentSocketRoom, state.playerId);
    }
    if ((state.currentPage === 'room' || state.currentPage === 'game') && state.roomId) {
      fetchRoom();
    }
  });

})();
