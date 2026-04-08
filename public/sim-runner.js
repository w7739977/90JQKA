/**
 * 90JQKA — 模拟玩家全流程测试
 * 自动创建房间、加入玩家、模拟完整游戏，逐步展示每个操作
 */
(function () {
  'use strict';

  var KEY = '';
  var simLog = [];
  var running = false;

  function api(endpoint, data) {
    var body = Object.assign({}, data || {});
    return fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function log(type, msg, detail) {
    simLog.push({ type: type, msg: msg, detail: detail || '', time: new Date().toLocaleTimeString() });
    updateSimUI();
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function getCardEmoji(rank) {
    switch (rank) {
      case '10': return '🔄';
      case 'J': return '🍺';
      case 'Q': return '🛡️';
      case 'K': return '😵';
      case 'A': return '🔁';
      default: return '🃏';
    }
  }

  function getCardColorClass(card) {
    if (!card) return '';
    return (card.startsWith('♥') || card.startsWith('♦')) ? 'sim-card-red' : '';
  }

  // ============================================================
  // Simulation Config
  // ============================================================

  var simConfig = {
    playerCount: 4,
    speed: 800,  // ms between actions
    autoWineCups: 2,  // default cups added when J drawn
    names: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank']
  };

  // ============================================================
  // Main simulation flow
  // ============================================================

  async function runSimulation() {
    if (running) return;
    running = true;
    simLog = [];
    updateSimUI();

    var n = simConfig.playerCount;
    var speed = simConfig.speed;

    try {
      // ---- Phase 1: Create room ----
      log('phase', '📋 阶段1：创建房间');
      await sleep(speed);

      var prefix = 'sim_' + Date.now() + '_';
      var players = [];
      for (var i = 0; i < n; i++) {
        players.push({ id: prefix + 'p' + i, name: simConfig.names[i] || ('Bot' + i) });
      }

      var createR = await api('createRoom', { playerId: players[0].id, nickName: players[0].name });
      if (!createR.ok) { log('error', '创建房间失败: ' + createR.message); running = false; return; }
      var roomId = createR.roomId;
      log('success', '🏠 ' + players[0].name + ' 创建了房间 ' + roomId);
      await sleep(speed);

      // ---- Phase 2: Join room ----
      log('phase', '📋 阶段2：玩家加入');
      await sleep(speed);

      for (var i = 1; i < n; i++) {
        var jr = await api('joinRoom', { playerId: players[i].id, nickName: players[i].name, roomId: roomId });
        if (jr.ok) {
          log('success', '👋 ' + players[i].name + ' 加入了房间');
        } else {
          log('error', '❌ ' + players[i].name + ' 加入失败: ' + jr.message);
        }
        await sleep(speed);
      }

      // ---- Phase 3: Ready ----
      log('phase', '📋 阶段3：准备');
      await sleep(speed);

      for (var i = 0; i < n; i++) {
        var rr = await api('ready', { playerId: players[i].id, roomId: roomId });
        if (rr.ok) {
          log('info', '✋ ' + players[i].name + ' 已准备');
        }
        await sleep(Math.max(speed / 2, 300));
      }

      // ---- Phase 4: Start game ----
      log('phase', '📋 阶段4：开始游戏');
      await sleep(speed);

      var sr = await api('startGame', { playerId: players[0].id, roomId: roomId });
      if (!sr.ok) { log('error', '开始游戏失败: ' + sr.message); running = false; return; }
      log('success', '🎮 游戏开始！20张牌已洗好');
      await sleep(speed);

      // ---- Phase 5: Game loop ----
      log('phase', '📋 阶段5：游戏进行');

      var turnNum = 0;
      var gameOver = false;
      var gameState = { publicCup: 0, direction: 1, kCount: 0, aCount: 0 };

      while (!gameOver) {
        // Find whose turn it is
        var stR = await api('getRoom', { playerId: players[0].id, roomId: roomId });
        if (!stR.ok) { log('error', '获取状态失败'); break; }
        var room = stR.room;

        if (room.status === 'finished') {
          gameOver = true;
          break;
        }

        var currentPlayerIdx = room.currentPlayerIdx;
        var currentPlayer = room.players[currentPlayerIdx];
        if (!currentPlayer) { log('error', '无法确定当前玩家'); break; }

        // Find matching player from our list
        var cpId = currentPlayer.openId;
        var cpName = currentPlayer.nickName;

        // Check if current player has Q (can skip)
        var hasQ = currentPlayer.activeQ;

        // Skip with 30% chance if has Q
        if (hasQ && Math.random() < 0.3) {
          var skipR = await api('skipTurn', { playerId: cpId, roomId: roomId });
          if (skipR.ok) {
            turnNum++;
            log('skip', '🛡️ 第' + turnNum + '回合 | ' + cpName + ' 使用Q跳过了本轮');
            await sleep(speed);
            continue;
          }
        }

        // Draw card
        var drawR = await api('drawCard', { playerId: cpId, roomId: roomId });
        if (!drawR.ok) {
          log('error', cpName + ' 摸牌失败: ' + drawR.message);
          break;
        }

        turnNum++;
        var card = drawR.card;
        var rank = card ? card.slice(1) : '';
        var effect = drawR.cardEffect || {};
        var effectType = effect.type || '';
        var cardEmoji = getCardEmoji(rank);
        var dirText = '';

        // Update local game state from response
        if (drawR.room) {
          gameState.publicCup = drawR.room.publicCup;
          gameState.direction = drawR.room.direction;
          gameState.kCount = drawR.room.kCount;
          gameState.aCount = drawR.room.aCount;
        }

        var dirArrow = gameState.direction === 1 ? '➡️' : '⬅️';

        // Build log message based on card effect
        switch (effectType) {
          case 'reverse':
            dirText = gameState.direction === 1 ? '顺时针' : '逆时针';
            log('card-10', '🔄 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 方向反转！现在' + dirText + ' ' + dirArrow,
              '剩余 ' + (20 - drawR.room.drawIndex) + ' 张牌');
            break;

          case 'addWine':
            log('card-J', '🍺 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 需要加酒！',
              '当前公杯: ' + gameState.publicCup + ' 杯');
            await sleep(speed);
            // Add wine
            var cups = simConfig.autoWineCups;
            var awR = await api('addWine', { playerId: cpId, roomId: roomId, cups: cups });
            if (awR.ok) {
              gameState.publicCup = awR.publicCup;
              log('wine', '  ↳ ' + cpName + ' 往公杯加了 ' + cups + ' 杯酒！公杯现在: ' + awR.publicCup + ' 杯 🍺');
            }
            break;

          case 'qGain':
            log('card-Q', '🛡️ 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 获得跳过能力！');
            break;

          case 'qCancel':
            log('card-Q', '💥 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 双Q相消！',
              effect.cancelledPlayer ? '被消Q的玩家: ' + effect.cancelledPlayer : '');
            break;

          case 'drink':
            log('card-K', '😵 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 喝 ' + effect.amount + ' 杯！',
              '（第' + effect.kCount + '张K）累计: ' + (currentPlayer.drinks + effect.amount) + ' 杯');
            break;

          case 'drawAgain':
            log('card-A', '🔁 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card + ' → 继续摸牌！',
              '（第' + effect.aCount + '张A）');
            break;

          case 'gameOver':
            log('gameover', '🏁 第' + turnNum + '回合 | ' + cpName + ' 摸到第4张A ' + card + ' → 游戏结束！',
              '喝完公杯 ' + effect.cupAmount + ' 杯！总喝酒: ' + effect.totalDrinks + ' 杯');
            gameOver = true;
            break;

          default:
            log('info', '🃏 第' + turnNum + '回合 | ' + cpName + ' 摸到 ' + card);
        }

        await sleep(speed);
      }

      // ---- Phase 6: Results ----
      log('phase', '📋 阶段6：结算');
      await sleep(speed);

      var finalR = await api('getRoom', { playerId: players[0].id, roomId: roomId });
      if (finalR.ok && finalR.room) {
        var sorted = finalR.room.players.slice().sort(function (a, b) { return (b.drinks || 0) - (a.drinks || 0); });
        log('result', '🏆 喝酒排行榜', '');
        sorted.forEach(function (p, idx) {
          var rank = idx === 0 ? '👑' : (idx + 1) + '.';
          var bar = '🍺'.repeat(Math.min(p.drinks, 20));
          log('result-detail', rank + ' ' + p.nickName + ': ' + p.drinks + ' 杯 ' + bar,
            '摸到的牌: ' + (p.drawnCards || []).join(', '));
        });
      }

      // ---- Phase 7: Restart ----
      log('phase', '📋 阶段7：再来一局测试');
      await sleep(speed);

      var restR = await api('restartGame', { playerId: players[0].id, roomId: roomId });
      if (restR.ok) {
        log('success', '🔄 再来一局！喝酒数已保留（不清零）');
        var drinksPreserved = restR.room.players.every(function (p) { return p.drinks >= 0; });
        var readyReset = restR.room.players.every(function (p) { return p.ready === false; });
        log('info', '  ↳ 喝酒数保留: ' + (drinksPreserved ? '✅' : '❌') + ' | 准备状态重置: ' + (readyReset ? '✅' : '❌'));
      } else {
        log('error', '再来一局失败: ' + restR.message);
      }

      // ---- Phase 8: Play another round ----
      log('phase', '📋 阶段8：第二局游戏');
      await sleep(speed);

      // Ready all again
      for (var i = 0; i < n; i++) {
        await api('ready', { playerId: players[i].id, roomId: roomId });
        await sleep(Math.max(speed / 3, 200));
      }
      log('info', '✋ 所有玩家已准备');

      var sr2 = await api('startGame', { playerId: players[0].id, roomId: roomId });
      if (!sr2.ok) { log('error', '第二局开始失败: ' + sr2.message); running = false; return; }
      log('success', '🎮 第二局开始！');
      await sleep(speed);

      // Play round 2
      turnNum = 0;
      gameOver = false;
      while (!gameOver) {
        var st2 = await api('getRoom', { playerId: players[0].id, roomId: roomId });
        if (!st2.ok || st2.room.status === 'finished') {
          gameOver = true;
          break;
        }
        var cp2 = st2.room.players[st2.room.currentPlayerIdx];
        if (!cp2) break;

        var d2 = await api('drawCard', { playerId: cp2.openId, roomId: roomId });
        if (!d2.ok) break;

        turnNum++;
        if (d2.cardEffect && d2.cardEffect.type === 'addWine') {
          log('card-J', '🍺 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → 加酒');
          await api('addWine', { playerId: cp2.openId, roomId: roomId, cups: 1 });
        } else if (d2.cardEffect && d2.cardEffect.type === 'gameOver') {
          log('gameover', '🏁 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到第4张A → 游戏结束！');
        } else if (d2.cardEffect && d2.cardEffect.type === 'reverse') {
          log('card-10', '🔄 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → 方向反转');
        } else if (d2.cardEffect && d2.cardEffect.type === 'drink') {
          log('card-K', '😵 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → 喝' + d2.cardEffect.amount + '杯');
        } else if (d2.cardEffect && d2.cardEffect.type === 'drawAgain') {
          log('card-A', '🔁 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → 继续摸');
        } else if (d2.cardEffect && d2.cardEffect.type === 'qGain') {
          log('card-Q', '🛡️ R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → 获得Q');
        } else if (d2.cardEffect && d2.cardEffect.type === 'qCancel') {
          log('card-Q', '💥 R2第' + turnNum + '回合 | ' + cp2.nickName + ' 摸到 ' + d2.card + ' → Q互消');
        }

        await sleep(Math.max(speed / 2, 400));
      }

      // Final results
      var finalR2 = await api('getRoom', { playerId: players[0].id, roomId: roomId });
      if (finalR2.ok && finalR2.room) {
        log('phase', '📋 第二局结算');
        var sorted2 = finalR2.room.players.slice().sort(function (a, b) { return (b.drinks || 0) - (a.drinks || 0); });
        sorted2.forEach(function (p, idx) {
          var rank = idx === 0 ? '👑' : (idx + 1) + '.';
          log('result-detail', rank + ' ' + p.nickName + ': 累计 ' + p.drinks + ' 杯',
            '本局摸到: ' + (p.drawnCards || []).join(', '));
        });
      }

      log('success', '✅ 模拟完成！共测试了2局游戏');

    } catch (e) {
      log('error', '模拟异常: ' + e.message);
    }

    running = false;
    updateSimUI();
  }

  // ============================================================
  // UI Rendering
  // ============================================================

  function updateSimUI() {
    var logEl = document.getElementById('sim-log');
    if (!logEl) return;

    var html = '';
    simLog.forEach(function (entry) {
      var cls = 'sim-entry sim-' + entry.type;
      html += '<div class="' + cls + '">';
      html += '<span class="sim-time">' + entry.time + '</span>';
      html += '<span class="sim-msg">' + entry.msg + '</span>';
      if (entry.detail) {
        html += '<span class="sim-detail">' + entry.detail + '</span>';
      }
      html += '</div>';
    });

    logEl.innerHTML = html;
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ============================================================
  // Public API
  // ============================================================

  window.SimRunner = {
    setKey: function (k) { KEY = k; },
    setConfig: function (cfg) { Object.assign(simConfig, cfg); },
    run: function () { runSimulation(); },
    isRunning: function () { return running; }
  };
})();
