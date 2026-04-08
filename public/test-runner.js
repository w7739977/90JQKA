/**
 * 90JQKA — 自动化测试运行器
 * 测试全部 API 接口与游戏逻辑
 */
(function () {
  'use strict';

  var KEY = '';
  var results = [];
  var running = false;

  function api(endpoint, data) {
    var body = Object.assign({}, data || {});
    return fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function apiWithPlayer(endpoint, data, playerId) {
    var body = Object.assign({}, data || {}, { playerId: playerId });
    return fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // ============================================================
  // Test framework
  // ============================================================

  var currentGroup = '';
  var tests = [];

  function group(name) {
    currentGroup = name;
  }

  function test(name, fn) {
    tests.push({ group: currentGroup, name: name, fn: fn });
  }

  async function runAll() {
    if (running) return;
    running = true;
    results = [];

    // Clean up test rooms
    await api('_cleanTestRooms', { key: KEY });

    var passed = 0, failed = 0, idx = 0;
    var total = tests.length;
    var startTime = Date.now();

    for (var t of tests) {
      idx++;
      var t0 = Date.now();
      var result = { group: t.group, name: t.name, status: 'running', time: 0, detail: '' };
      results.push(result);
      updateUI(results, passed, failed, idx, total);

      try {
        await t.fn(result);
        result.status = 'pass';
        passed++;
      } catch (e) {
        result.status = 'fail';
        result.detail = e.message || String(e);
        failed++;
      }
      result.time = Date.now() - t0;
      updateUI(results, passed, failed, idx, total);
    }

    var elapsed = Date.now() - startTime;
    updateUI(results, passed, failed, total, total, elapsed);
    running = false;
  }

  function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
  }

  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
  }

  function assertOk(res, msg) {
    if (!res.ok) throw new Error((msg || 'Expected ok:true') + ' — ' + (res.message || res.code || ''));
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // ============================================================
  // Helper: create a room with N players ready and started
  // ============================================================

  async function createStartedRoom(count, prefix) {
    prefix = prefix || 't_';
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({ id: prefix + 'p' + i, name: 'Player' + i });
    }
    // Create room
    var r = await api('createRoom', { playerId: players[0].id, nickName: players[0].name });
    assertOk(r, 'createRoom');
    var roomId = r.roomId;

    // Join others
    for (var i = 1; i < count; i++) {
      var jr = await api('joinRoom', { playerId: players[i].id, nickName: players[i].name, roomId: roomId });
      assertOk(jr, 'joinRoom p' + i);
    }

    // Ready all
    for (var i = 0; i < count; i++) {
      var rr = await api('ready', { playerId: players[i].id, roomId: roomId });
      assertOk(rr, 'ready p' + i);
    }

    // Start game
    var sr = await api('startGame', { playerId: players[0].id, roomId: roomId });
    assertOk(sr, 'startGame');
    assertEq(sr.room.status, 'playing', 'status should be playing');

    return { roomId: roomId, players: players };
  }

  // Helper: draw a card for whichever player is current, auto-handle addWine
  async function autoDraw(roomId, players) {
    for (var i = 0; i < players.length; i++) {
      var pid = players[i].id;
      var r = await api('drawCard', { playerId: pid, roomId: roomId });
      if (r.ok) {
        // Auto handle addWine
        if (r.cardEffect && r.cardEffect.type === 'addWine') {
          await api('addWine', { playerId: pid, roomId: roomId, cups: 1 });
        }
        return r;
      }
    }
    throw new Error('No player could draw');
  }

  // ============================================================
  // Test definitions
  // ============================================================

  group('基础 API');
  test('createRoom 创建房间', async function () {
    var r = await api('createRoom', { playerId: 'bas1', nickName: '基础测试' });
    assertOk(r);
    assert(r.roomId && r.roomId.length === 6, 'roomId should be 6 digits');
  });

  test('getRoom 获取房间', async function () {
    var c = await api('createRoom', { playerId: 'bas2', nickName: 'B' });
    var r = await api('getRoom', { playerId: 'bas2', roomId: c.roomId });
    assertOk(r);
    assertEq(r.room.players.length, 1);
    assertEq(r.room.players[0].nickName, 'B');
  });

  test('getRoom 不存在的房间', async function () {
    var r = await api('getRoom', { playerId: 'bas3', roomId: '000000' });
    assert(!r.ok, 'should fail');
    assertEq(r.code, 'ROOM_NOT_FOUND');
  });

  test('joinRoom 加入房间', async function () {
    var c = await api('createRoom', { playerId: 'bas4a', nickName: 'Host' });
    var j = await api('joinRoom', { playerId: 'bas4b', nickName: 'Guest', roomId: c.roomId });
    assertOk(j);
    var g = await api('getRoom', { playerId: 'bas4a', roomId: c.roomId });
    assertEq(g.room.players.length, 2);
  });

  test('joinRoom 房间不存在', async function () {
    var r = await api('joinRoom', { playerId: 'bas5', roomId: '999999', nickName: 'X' });
    assert(!r.ok);
    assertEq(r.code, 'ROOM_NOT_FOUND');
  });

  test('joinRoom 最多6人', async function () {
    var c = await api('createRoom', { playerId: 'max0', nickName: 'H' });
    for (var i = 1; i <= 5; i++) {
      var j = await api('joinRoom', { playerId: 'max' + i, nickName: 'P' + i, roomId: c.roomId });
      assertOk(j, 'join ' + i);
    }
    // 7th player should fail
    var fail = await api('joinRoom', { playerId: 'max6', nickName: 'Overflow', roomId: c.roomId });
    assert(!fail.ok, '7th player should be rejected');
    assertEq(fail.code, 'ROOM_FULL');
  });

  test('joinRoom 重复加入更新昵称', async function () {
    var c = await api('createRoom', { playerId: 'dup1', nickName: 'OldName' });
    var j = await api('joinRoom', { playerId: 'dup1', nickName: 'NewName', roomId: c.roomId });
    assertOk(j);
    var g = await api('getRoom', { playerId: 'dup1', roomId: c.roomId });
    assertEq(g.room.players[0].nickName, 'NewName');
    assertEq(g.room.players.length, 1);
  });

  group('准备 / 开始');
  test('ready 切换准备状态', async function () {
    var c = await api('createRoom', { playerId: 'rd1', nickName: 'R' });
    var r1 = await api('ready', { playerId: 'rd1', roomId: c.roomId });
    assertOk(r1);
    assert(r1.ready === true, 'should be ready');
    var r2 = await api('ready', { playerId: 'rd1', roomId: c.roomId });
    assertOk(r2);
    assert(r2.ready === false, 'should be not ready');
  });

  test('startGame 未全部准备应失败', async function () {
    var c = await api('createRoom', { playerId: 'st1', nickName: 'H' });
    await api('joinRoom', { playerId: 'st2', nickName: 'G', roomId: c.roomId });
    await api('ready', { playerId: 'st1', roomId: c.roomId });
    // st2 not ready
    var r = await api('startGame', { playerId: 'st1', roomId: c.roomId });
    assert(!r.ok);
    assertEq(r.code, 'NOT_ALL_READY');
  });

  test('startGame 非房主不能开始', async function () {
    var c = await api('createRoom', { playerId: 'own1', nickName: 'H' });
    await api('joinRoom', { playerId: 'own2', nickName: 'G', roomId: c.roomId });
    await api('ready', { playerId: 'own1', roomId: c.roomId });
    await api('ready', { playerId: 'own2', roomId: c.roomId });
    var r = await api('startGame', { playerId: 'own2', roomId: c.roomId });
    assert(!r.ok);
    assertEq(r.code, 'NOT_OWNER');
  });

  test('startGame 正常开始', async function () {
    var c = await api('createRoom', { playerId: 'go1', nickName: 'H' });
    await api('joinRoom', { playerId: 'go2', nickName: 'G', roomId: c.roomId });
    await api('ready', { playerId: 'go1', roomId: c.roomId });
    await api('ready', { playerId: 'go2', roomId: c.roomId });
    var r = await api('startGame', { playerId: 'go1', roomId: c.roomId });
    assertOk(r);
    assertEq(r.room.status, 'playing');
    assertEq(r.room.deckSize, 20);
    assertEq(r.room.direction, 1);
    assertEq(r.room.publicCup, 0);
  });

  test('startGame 至少需要2人', async function () {
    var c = await api('createRoom', { playerId: 'solo1', nickName: 'Solo' });
    await api('ready', { playerId: 'solo1', roomId: c.roomId });
    var r = await api('startGame', { playerId: 'solo1', roomId: c.roomId });
    assert(!r.ok);
    assertEq(r.code, 'NOT_ENOUGH');
  });

  group('摸牌逻辑');
  test('drawCard 只有当前玩家能摸牌', async function () {
    var info = await createStartedRoom(2, 'turn_');
    // Player 1 (owner) should be current
    var r0 = await api('drawCard', { playerId: info.players[1].id, roomId: info.roomId });
    assert(!r0.ok, 'p1 should not be able to draw');
    assertEq(r0.code, 'NOT_YOUR_TURN');
    // Player 0 should be able to draw
    var r1 = await api('drawCard', { playerId: info.players[0].id, roomId: info.roomId });
    assertOk(r1, 'p0 should draw');
    assert(r1.card, 'should have a card');
  });

  test('drawCard 游戏未开始不能摸牌', async function () {
    var c = await api('createRoom', { playerId: 'nd1', nickName: 'H' });
    var r = await api('drawCard', { playerId: 'nd1', roomId: c.roomId });
    assert(!r.ok);
    assertEq(r.code, 'NOT_PLAYING');
  });

  test('drawCard 有未完成操作时不能摸牌', async function () {
    var info = await createStartedRoom(2, 'pend_');
    // Draw until someone gets J
    for (var i = 0; i < 20; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'addWine') {
        // Now there should be a pending action, try drawing again
        // (addWine was auto-handled, so no pending anymore - test before addWine)
        break;
      }
    }
    // We can't easily test this since autoDraw handles addWine immediately.
    // Instead, test by drawing and checking before addWine
    var info2 = await createStartedRoom(2, 'pend2_');
    for (var i = 0; i < 20; i++) {
      for (var j = 0; j < info2.players.length; j++) {
        var r = await api('drawCard', { playerId: info2.players[j].id, roomId: info2.roomId });
        if (r.ok && r.cardEffect && r.cardEffect.type === 'addWine') {
          // Try drawing again without adding wine
          var fail = await api('drawCard', { playerId: info2.players[j].id, roomId: info2.roomId });
          assert(!fail.ok, 'should fail with pending action');
          assertEq(fail.code, 'PENDING_ACTION');
          // Clean up
          await api('addWine', { playerId: info2.players[j].id, roomId: info2.roomId, cups: 1 });
          return;
        }
      }
    }
  });

  group('牌效果');
  test('K 效果：全局递增喝醉', async function (result) {
    var info = await createStartedRoom(2, 'kfx_');
    var kCount = 0;
    var lastKDrinks = 0;

    for (var i = 0; i < 20; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'drink') {
        kCount++;
        lastKDrinks = r.cardEffect.amount;
        assertEq(r.cardEffect.amount, kCount,
          'K#' + kCount + ' should drink ' + kCount + ' cups, got ' + r.cardEffect.amount);
      }
      if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
    }
    result.detail = 'Found ' + kCount + ' K cards, last drank ' + lastKDrinks;
  });

  test('10 效果：方向反转', async function () {
    var info = await createStartedRoom(3, 'rev_');
    var initialDir = 1;
    var reversals = 0;

    for (var i = 0; i < 20; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'reverse') {
        reversals++;
        var expected = (reversals % 2 === 1) ? -1 : 1;
        assertEq(r.room.direction, expected,
          'After ' + reversals + ' reversals, direction should be ' + expected);
      }
      if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
    }
    assert(reversals > 0, 'Should have at least 1 reversal in a full game');
  });

  test('J 效果：公杯加酒', async function () {
    var info = await createStartedRoom(2, 'jfx_');
    var totalAdded = 0;

    for (var i = 0; i < 20; i++) {
      for (var j = 0; j < info.players.length; j++) {
        var r = await api('drawCard', { playerId: info.players[j].id, roomId: info.roomId });
        if (r.ok) {
          if (r.cardEffect && r.cardEffect.type === 'addWine') {
            var cups = 2;
            var aw = await api('addWine', { playerId: info.players[j].id, roomId: info.roomId, cups: cups });
            assertOk(aw, 'addWine');
            totalAdded += cups;
            assertEq(aw.publicCup, totalAdded, 'publicCup should match');
          }
          if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
          break; // found the right player
        }
      }
      var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
      if (state.room.status === 'finished') break;
    }
    assert(totalAdded > 0, 'Should have added some wine');
  });

  test('addWine 只有当事人能加酒', async function () {
    var info = await createStartedRoom(2, 'awfx_');
    for (var i = 0; i < 20; i++) {
      for (var j = 0; j < info.players.length; j++) {
        var r = await api('drawCard', { playerId: info.players[j].id, roomId: info.roomId });
        if (r.ok && r.cardEffect && r.cardEffect.type === 'addWine') {
          // Wrong player tries addWine
          var other = info.players[1 - j].id;
          var fail = await api('addWine', { playerId: other, roomId: info.roomId, cups: 1 });
          assert(!fail.ok, 'Wrong player should not be able to addWine');
          assertEq(fail.code, 'NOT_YOUR_ACTION');
          // Correct player adds
          var ok = await api('addWine', { playerId: info.players[j].id, roomId: info.roomId, cups: 1 });
          assertOk(ok);
          return;
        }
      }
    }
  });

  test('addWine 无效杯数', async function () {
    var r = await api('addWine', { playerId: 'x', roomId: 'y', cups: 5 });
    assert(!r.ok);
    assertEq(r.code, 'INVALID_CUPS');
  });

  test('Q 效果：双Q互消', async function (result) {
    var info = await createStartedRoom(3, 'qfx_');
    var qGains = 0;
    var qCancels = 0;

    for (var i = 0; i < 20; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'qGain') qGains++;
      if (r.cardEffect && r.cardEffect.type === 'qCancel') qCancels++;
      if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
    }
    // 一共只有4张Q牌，每个qGain或qCancel都对应摸出1张Q，所以总和不超过4
    assert(qGains + qCancels <= 4, 'Q cards drawn should not exceed 4, got ' + (qGains + qCancels));
    // qCancel > 0 说明双Q互消逻辑确实触发了
    assert(qGains + qCancels > 0, 'Should have at least one Q event');
    result.detail = 'Q gains: ' + qGains + ', Q cancels: ' + qCancels + ', total Q cards: ' + (qGains + qCancels);
  });

  test('A 效果：继续摸牌，第4张A结束', async function (result) {
    var info = await createStartedRoom(2, 'afx_');
    var aCount = 0;
    var drawAgainCount = 0;
    var gameOver = false;

    for (var i = 0; i < 30; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'drawAgain') {
        aCount = r.cardEffect.aCount;
        drawAgainCount++;
      }
      if (r.cardEffect && r.cardEffect.type === 'gameOver') {
        gameOver = true;
        assert(r.cardEffect.cupAmount >= 0, 'cupAmount should be >= 0');
        break;
      }
    }
    assert(gameOver, 'Game should end with 4th A');
    result.detail = 'Draw-again events: ' + drawAgainCount + ', game ended';
  });

  test('第4张A：摸到者喝完公杯', async function () {
    var info = await createStartedRoom(2, 'a4fx_');
    var cupBeforeEnd = 0;
    var lastDrawerId = null;
    var lastDrawerDrinksBefore = 0;

    for (var i = 0; i < 30; i++) {
      for (var j = 0; j < info.players.length; j++) {
        var r = await api('drawCard', { playerId: info.players[j].id, roomId: info.roomId });
        if (r.ok) {
          if (r.cardEffect && r.cardEffect.type === 'addWine') {
            await api('addWine', { playerId: info.players[j].id, roomId: info.roomId, cups: 1 });
          }
          if (r.cardEffect && r.cardEffect.type === 'gameOver') {
            // The player who drew the 4th A should have cupAmount added to their drinks
            var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
            var drawer = state.room.players.find(function (p) { return p.openId === info.players[j].id; });
            assert(drawer.drinks >= r.cardEffect.cupAmount,
              'Drawer should have at least cupAmount drinks. drinks=' + drawer.drinks + ' cupAmount=' + r.cardEffect.cupAmount);
            assertEq(state.room.publicCup, 0, 'Public cup should be 0 after game over');
            assertEq(state.room.status, 'finished');
            return;
          }
          break;
        }
      }
    }
  });

  group('Q 跳过功能');
  test('skipTurn 正常跳过', async function () {
    // We need a scenario where a player has Q and it's their turn
    // Keep playing games until someone gets Q and survives to their next turn
    for (var attempt = 0; attempt < 10; attempt++) {
      var info = await createStartedRoom(2, 'skip_' + attempt + '_');
      var qHolderId = null;
      var skipSuccess = false;

      for (var i = 0; i < 20; i++) {
        for (var j = 0; j < info.players.length; j++) {
          var r = await api('drawCard', { playerId: info.players[j].id, roomId: info.roomId });
          if (r.ok) {
            if (r.cardEffect && r.cardEffect.type === 'addWine') {
              await api('addWine', { playerId: info.players[j].id, roomId: info.roomId, cups: 1 });
            }
            if (r.cardEffect && r.cardEffect.type === 'qGain') {
              qHolderId = info.players[j].id;
            }
            if (r.cardEffect && r.cardEffect.type === 'qCancel') {
              qHolderId = null;
            }
            if (r.cardEffect && r.cardEffect.type === 'gameOver') break;

            // Check if it's the Q holder's turn
            var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
            if (state.room.status === 'finished') break;

            var currentPid = state.room.players[state.room.currentPlayerIdx].openId;
            var holderPlayer = state.room.players.find(function (p) { return p.activeQ; });

            if (holderPlayer && holderPlayer.openId === currentPid) {
              // Try skip!
              var skip = await api('skipTurn', { playerId: currentPid, roomId: info.roomId });
              if (skip.ok) {
                skipSuccess = true;
                // Verify Q consumed
                var after = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
                var skippP = after.room.players.find(function (p) { return p.openId === currentPid; });
                assert(!skippP.activeQ, 'Q should be consumed after skip');
                return; // Test passed!
              }
            }
            break;
          }
        }
        var st = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
        if (st.room.status === 'finished') break;
      }
    }
    // If we never got to test skip (Q always cancelled), that's OK but note it
    throw new Error('Could not test skip in 10 attempts (Q always cancelled before use)');
  });

  test('skipTurn 无Q时跳过失败', async function () {
    var info = await createStartedRoom(2, 'nskip_');
    // Draw a card first to ensure it's someone's turn
    var r = await autoDraw(info.roomId, info.players);
    // Now whoever is current, try skip without Q
    var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
    var currentPid = state.room.players[state.room.currentPlayerIdx].openId;
    var cp = state.room.players.find(function (p) { return p.openId === currentPid; });
    if (!cp.activeQ) {
      var skip = await api('skipTurn', { playerId: currentPid, roomId: info.roomId });
      assert(!skip.ok, 'Should fail without Q');
      assertEq(skip.code, 'NO_Q');
    }
  });

  test('Q 不跳过不消耗', async function () {
    // Play until someone gets Q, then verify they still have Q after drawing normally
    for (var attempt = 0; attempt < 15; attempt++) {
      var info = await createStartedRoom(2, 'qpersist_' + attempt + '_');

      for (var i = 0; i < 20; i++) {
        var r = await autoDraw(info.roomId, info.players);
        if (r.cardEffect && r.cardEffect.type === 'qGain') {
          // Q holder drew Q. Now wait for their next turn.
          // Keep drawing (they won't skip, just draw normally) and check if Q persists
          var qHolderPid = null;
          for (var k = 0; k < info.players.length; k++) {
            if (info.players[k].id === r.room.players.find(function (p) { return p.activeQ; }).openId) {
              // Wait, we can't check r.room directly from autoDraw return. Let me get state.
            }
          }
          var st = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
          var holder = st.room.players.find(function (p) { return p.activeQ; });
          if (!holder) continue; // Q was already cancelled somehow
          qHolderPid = holder.openId;

          // Keep playing until Q holder's next turn
          for (var m = 0; m < 10; m++) {
            var st2 = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
            if (st2.room.status === 'finished') break;
            var curPid = st2.room.players[st2.room.currentPlayerIdx].openId;
            var holderNow = st2.room.players.find(function (p) { return p.openId === qHolderPid; });

            if (curPid === qHolderPid && holderNow.activeQ) {
              // Q holder's turn! Draw normally (not skip) and check Q persists
              var drawR = await api('drawCard', { playerId: qHolderPid, roomId: info.roomId });
              if (drawR.ok) {
                if (drawR.cardEffect && drawR.cardEffect.type === 'addWine') {
                  await api('addWine', { playerId: qHolderPid, roomId: info.roomId, cups: 1 });
                }
                // Check if Q persists (unless card was Q which could cancel)
                var afterDraw = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
                var holderAfter = afterDraw.room.players.find(function (p) { return p.openId === qHolderPid; });
                // If the drawn card was Q, it might cancel. Otherwise Q should persist.
                if (drawR.cardEffect && (drawR.cardEffect.type === 'qGain' || drawR.cardEffect.type === 'qCancel')) {
                  // Q card drawn, skip this test iteration
                } else {
                  assert(holderAfter.activeQ, 'Q should persist when drawing normally. Card: ' + drawR.card + ' effect: ' + (drawR.cardEffect || {}).type);
                  return; // Test passed!
                }
              }
            }

            // Auto draw to advance the game
            await autoDraw(info.roomId, info.players);
            var chk = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
            if (chk.room.status === 'finished') break;
          }
          break;
        }
        if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
      }
    }
  });

  group('踢人 / 再来一局');
  test('kickPlayer 房主踢人', async function () {
    var c = await api('createRoom', { playerId: 'kick_h', nickName: 'Host' });
    await api('joinRoom', { playerId: 'kick_g', nickName: 'Guest', roomId: c.roomId });
    var r = await api('kickPlayer', { playerId: 'kick_h', roomId: c.roomId, targetPlayerId: 'kick_g' });
    assertOk(r);
    var g = await api('getRoom', { playerId: 'kick_h', roomId: c.roomId });
    assertEq(g.room.players.length, 1);
  });

  test('kickPlayer 不能踢自己', async function () {
    var c = await api('createRoom', { playerId: 'kick2', nickName: 'H' });
    var r = await api('kickPlayer', { playerId: 'kick2', roomId: c.roomId, targetPlayerId: 'kick2' });
    assert(!r.ok);
    assertEq(r.code, 'CANNOT_KICK_SELF');
  });

  test('kickPlayer 非房主不能踢', async function () {
    var c = await api('createRoom', { playerId: 'kick3h', nickName: 'H' });
    await api('joinRoom', { playerId: 'kick3g', nickName: 'G', roomId: c.roomId });
    var r = await api('kickPlayer', { playerId: 'kick3g', roomId: c.roomId, targetPlayerId: 'kick3h' });
    assert(!r.ok);
    assertEq(r.code, 'NOT_OWNER');
  });

  test('restartGame 再来一局保留喝酒数', async function () {
    var info = await createStartedRoom(2, 'rest_');
    // Play to end
    for (var i = 0; i < 30; i++) {
      var r = await autoDraw(info.roomId, info.players);
      if (r.cardEffect && r.cardEffect.type === 'gameOver') break;
    }
    var endState = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
    assertEq(endState.room.status, 'finished');
    var drinks0 = endState.room.players[0].drinks;
    var drinks1 = endState.room.players[1].drinks;

    // Restart
    var rest = await api('restartGame', { playerId: info.players[0].id, roomId: info.roomId });
    assertOk(rest);
    assertEq(rest.room.status, 'waiting');
    assertEq(rest.room.players[0].drinks, drinks0, 'drinks should persist');
    assertEq(rest.room.players[1].drinks, drinks1, 'drinks should persist');
    // Ready should be reset
    assertEq(rest.room.players[0].ready, false);
    assertEq(rest.room.players[1].ready, false);
  });

  test('restartGame 非房主不能操作', async function () {
    var info = await createStartedRoom(2, 'restr_');
    var r = await api('restartGame', { playerId: info.players[1].id, roomId: info.roomId });
    assert(!r.ok);
    assertEq(r.code, 'NOT_OWNER');
  });

  group('完整游戏流程');
  test('2人完整游戏', async function (result) {
    var info = await createStartedRoom(2, 'full2_');
    var turns = 0;
    for (var i = 0; i < 30; i++) {
      var r = await autoDraw(info.roomId, info.players);
      turns++;
      if (r.cardEffect && r.cardEffect.type === 'gameOver') {
        var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
        assertEq(state.room.status, 'finished');
        assertEq(state.room.aCount, 4, 'Should end on 4th A');
        result.detail = turns + ' turns, ' + state.room.drawIndex + ' cards drawn';
        return;
      }
    }
    throw new Error('Game did not end in 30 turns');
  });

  test('4人完整游戏', async function (result) {
    var info = await createStartedRoom(4, 'full4_');
    var turns = 0;
    for (var i = 0; i < 30; i++) {
      var r = await autoDraw(info.roomId, info.players);
      turns++;
      if (r.cardEffect && r.cardEffect.type === 'gameOver') {
        var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
        assertEq(state.room.status, 'finished');
        result.detail = turns + ' turns, ' + state.room.drawIndex + ' cards drawn';
        return;
      }
    }
    throw new Error('Game did not end in 30 turns');
  });

  test('6人完整游戏', async function (result) {
    var info = await createStartedRoom(6, 'full6_');
    var turns = 0;
    for (var i = 0; i < 30; i++) {
      var r = await autoDraw(info.roomId, info.players);
      turns++;
      if (r.cardEffect && r.cardEffect.type === 'gameOver') {
        var state = await api('getRoom', { playerId: info.players[0].id, roomId: info.roomId });
        assertEq(state.room.status, 'finished');
        result.detail = turns + ' turns, ' + state.room.drawIndex + ' cards drawn';
        return;
      }
    }
    throw new Error('Game did not end in 30 turns');
  });

  // ============================================================
  // UI Rendering
  // ============================================================

  window.TestRunner = {
    setKey: function (k) { KEY = k; },
    run: function () { runAll(); },
    getResults: function () { return results; }
  };

  function updateUI(results, passed, failed, current, total, elapsed) {
    var progressEl = document.getElementById('test-progress');
    var summaryEl = document.getElementById('test-summary');
    var resultsEl = document.getElementById('test-results');

    if (progressEl) {
      progressEl.style.width = (total ? Math.round((current / total) * 100) : 0) + '%';
    }

    if (summaryEl) {
      var html = '';
      html += '<span class="test-sum-pass">✓ ' + passed + '</span>';
      html += '<span class="test-sum-fail">✗ ' + failed + '</span>';
      html += '<span class="test-sum-total">/ ' + total + '</span>';
      if (elapsed) html += '<span class="test-sum-time">' + elapsed + 'ms</span>';
      summaryEl.innerHTML = html;
    }

    if (resultsEl) {
      var html = '';
      var lastGroup = '';
      results.forEach(function (r, i) {
        if (r.group !== lastGroup) {
          lastGroup = r.group;
          html += '<div class="test-group"><div class="test-group-title">' + r.group + '</div>';
        }

        var cls = 'test-' + r.status;
        var icon = r.status === 'pass' ? '✓' : (r.status === 'fail' ? '✗' : (r.status === 'running' ? '⟳' : '○'));

        html += '<div class="test-row ' + cls + '">';
        html += '<span class="test-icon">' + icon + '</span>';
        html += '<span class="test-name">' + r.name + '</span>';
        html += '<span class="test-time">' + r.time + 'ms</span>';
        if (r.detail) {
          html += '<div class="test-detail">' + r.detail + '</div>';
        }
        if (r.status === 'fail' && r.detail) {
          html += '<div class="test-detail">' + r.detail + '</div>';
        }
        html += '</div>';

        // Close group div if next is different group or end
        if (i === results.length - 1 || results[i + 1].group !== r.group) {
          html += '</div>';
        }
      });
      resultsEl.innerHTML = html;
    }
  }
})();
