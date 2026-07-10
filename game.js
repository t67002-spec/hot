/* =========================================================
   หมากฮอสออนไลน์ — game.js
   Rules engine + rendering + AI (minimax/alpha-beta) + modes
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   1. CONSTANTS & SMALL HELPERS
   --------------------------------------------------------- */
const ALL_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const AI_DEPTH = 4;          // minimax search depth
const HOP_ANIM_MS = 300;     // ms per hop while animating a capture chain
const HOP_PAUSE_MS = 110;    // pause after removing a captured piece
const POLL_INTERVAL_MS = 1800;

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function opponent(color) { return color === 'red' ? 'black' : 'red'; }
function isPromotionRow(color, row) { return color === 'red' ? row === 7 : row === 0; }
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
function cloneBoard(board) { return board.map(row => row.map(cell => (cell ? { ...cell } : null))); }
let pieceIdCounter = 1;

/* ---------------------------------------------------------
   2. BOARD SETUP
   --------------------------------------------------------- */
function createInitialBoard(ruleSet) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = ruleSet === 'thai' ? 2 : 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { id: pieceIdCounter++, color: 'red', king: false };
    }
  }
  for (let r = 8 - rows; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { id: pieceIdCounter++, color: 'black', king: false };
    }
  }
  return board;
}

/* ---------------------------------------------------------
   3. MOVE GENERATION (rules-aware: 'thai' | 'international')
   --------------------------------------------------------- */
function getSimpleMovesForPiece(board, r, c, ruleSet) {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  if (piece.king) {
    if (ruleSet === 'thai') {
      // Flying king: glides any distance until blocked
      for (const [dr, dc] of ALL_DIRS) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc) && !board[nr][nc]) {
          moves.push({ toRow: nr, toCol: nc, path: [{ row: nr, col: nc }] });
          nr += dr; nc += dc;
        }
      }
    } else {
      // International king: one step, any of the four diagonals
      for (const [dr, dc] of ALL_DIRS) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && !board[nr][nc]) moves.push({ toRow: nr, toCol: nc, path: [{ row: nr, col: nc }] });
      }
    }
  } else {
    // Man: forward only, one step
    const dr = piece.color === 'red' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !board[nr][nc]) moves.push({ toRow: nr, toCol: nc, path: [{ row: nr, col: nc }] });
    }
  }
  return moves;
}

function getSingleHopCaptures(board, r, c, ruleSet) {
  const piece = board[r][c];
  if (!piece) return [];
  const enemy = opponent(piece.color);
  const results = [];

  if (piece.king && ruleSet === 'thai') {
    // Flying king capture: scan each diagonal for the first piece, then any empty landing beyond it
    for (const [dr, dc] of ALL_DIRS) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc) && !board[nr][nc]) { nr += dr; nc += dc; }
      if (inBounds(nr, nc) && board[nr][nc] && board[nr][nc].color === enemy) {
        let lr = nr + dr, lc = nc + dc;
        while (inBounds(lr, lc) && !board[lr][lc]) {
          results.push({ overRow: nr, overCol: nc, toRow: lr, toCol: lc });
          lr += dr; lc += dc;
        }
      }
    }
  } else if (piece.king) {
    // International king: one-square jump, any of four diagonals
    for (const [dr, dc] of ALL_DIRS) {
      const mr = r + dr, mc = c + dc;
      const lr = r + 2 * dr, lc = c + 2 * dc;
      if (inBounds(lr, lc) && board[mr] && board[mr][mc] && board[mr][mc].color === enemy && !board[lr][lc]) {
        results.push({ overRow: mr, overCol: mc, toRow: lr, toCol: lc });
      }
    }
  } else {
    // Man: captures forward only (per both rule sets in this app)
    const dr = piece.color === 'red' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const mr = r + dr, mc = c + dc;
      const lr = r + 2 * dr, lc = c + 2 * dc;
      if (inBounds(lr, lc) && board[mr] && board[mr][mc] && board[mr][mc].color === enemy && !board[lr][lc]) {
        results.push({ overRow: mr, overCol: mc, toRow: lr, toCol: lc });
      }
    }
  }
  return results;
}

// Builds every maximal capture chain starting at (r,c). A chain stops as soon
// as the piece promotes (common convention) or no further hop is available.
function findCaptureChains(board, r, c, ruleSet) {
  const piece = board[r][c];
  const hops = getSingleHopCaptures(board, r, c, ruleSet);
  if (hops.length === 0) return [];
  const chains = [];

  for (const hop of hops) {
    const nb = cloneBoard(board);
    nb[hop.overRow][hop.overCol] = null;
    nb[r][c] = null;
    const newPiece = { ...piece };
    let promoted = false;
    if (!piece.king && isPromotionRow(piece.color, hop.toRow)) { newPiece.king = true; promoted = true; }
    nb[hop.toRow][hop.toCol] = newPiece;

    const capturedSoFar = [{ row: hop.overRow, col: hop.overCol }];
    const pathSoFar = [{ row: hop.toRow, col: hop.toCol }];

    if (promoted) {
      chains.push({ path: pathSoFar, captured: capturedSoFar, becameKing: true });
      continue;
    }
    const subChains = findCaptureChains(nb, hop.toRow, hop.toCol, ruleSet);
    if (subChains.length === 0) {
      chains.push({ path: pathSoFar, captured: capturedSoFar, becameKing: false });
    } else {
      for (const sub of subChains) {
        chains.push({
          path: pathSoFar.concat(sub.path),
          captured: capturedSoFar.concat(sub.captured),
          becameKing: sub.becameKing
        });
      }
    }
  }
  return chains;
}

// Returns the complete list of legal moves for `color`. If any capture chain
// exists anywhere on the board, only capture moves are returned (forced capture).
function getAllValidMoves(board, color, ruleSet) {
  const captureMoves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) {
        const chains = findCaptureChains(board, r, c, ruleSet);
        for (const ch of chains) {
          const last = ch.path[ch.path.length - 1];
          captureMoves.push({
            fromRow: r, fromCol: c, toRow: last.row, toCol: last.col,
            path: ch.path, captured: ch.captured, isCapture: true, becameKing: ch.becameKing
          });
        }
      }
    }
  }
  if (captureMoves.length > 0) return captureMoves;

  const simpleMoves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) {
        for (const m of getSimpleMovesForPiece(board, r, c, ruleSet)) {
          simpleMoves.push({
            fromRow: r, fromCol: c, toRow: m.toRow, toCol: m.toCol,
            path: m.path, captured: [], isCapture: false,
            becameKing: !piece.king && isPromotionRow(piece.color, m.toRow)
          });
        }
      }
    }
  }
  return simpleMoves;
}

function applyMove(board, move) {
  const nb = cloneBoard(board);
  const piece = { ...nb[move.fromRow][move.fromCol] };
  nb[move.fromRow][move.fromCol] = null;
  for (const cap of move.captured) nb[cap.row][cap.col] = null;
  if (move.becameKing) piece.king = true;
  nb[move.toRow][move.toCol] = piece;
  return nb;
}

/* ---------------------------------------------------------
   4. AI — Minimax with alpha-beta pruning
   --------------------------------------------------------- */
function evaluateBoard(board, aiColor, ruleSet) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      let val = p.king ? 1.7 : 1.0;
      if (!p.king) {
        // encourage men to advance toward promotion
        const advance = p.color === 'red' ? r : (7 - r);
        val += advance * 0.03;
      }
      // mild center-column preference
      val += (3.5 - Math.abs(c - 3.5)) * 0.01;
      score += p.color === aiColor ? val : -val;
    }
  }
  return score;
}

function minimax(board, depth, alpha, beta, aiColor, currentColor, ruleSet) {
  const moves = getAllValidMoves(board, currentColor, ruleSet);
  if (moves.length === 0) {
    // currentColor has no moves => currentColor loses
    return currentColor === aiColor ? -1000 + depth : 1000 - depth;
  }
  if (depth === 0) return evaluateBoard(board, aiColor, ruleSet);

  if (currentColor === aiColor) {
    let value = -Infinity;
    for (const move of moves) {
      const child = applyMove(board, move);
      value = Math.max(value, minimax(child, depth - 1, alpha, beta, aiColor, opponent(currentColor), ruleSet));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (const move of moves) {
      const child = applyMove(board, move);
      value = Math.min(value, minimax(child, depth - 1, alpha, beta, aiColor, opponent(currentColor), ruleSet));
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }
}

function computeAiMove(board, aiColor, ruleSet) {
  const moves = getAllValidMoves(board, aiColor, ruleSet);
  if (moves.length === 0) return null;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity, beta = Infinity;
  for (const move of moves) {
    const child = applyMove(board, move);
    const score = minimax(child, AI_DEPTH - 1, alpha, beta, aiColor, opponent(aiColor), ruleSet);
    if (score > bestScore) { bestScore = score; bestMove = move; }
    alpha = Math.max(alpha, bestScore);
  }
  return bestMove;
}

/* ---------------------------------------------------------
   5. APP STATE
   --------------------------------------------------------- */
const state = {
  mode: null,            // 'ai' | 'local' | 'online'
  ruleSet: null,          // 'thai' | 'international'
  board: null,
  turn: 'red',
  playerName: 'ผู้เล่น',
  opponentName: 'คู่ต่อสู้',
  myColor: 'red',         // which color the local human controls in AI mode / online mode
  aiColor: 'black',
  selected: null,
  legalForSelected: [],
  capturedCount: { red: 0, black: 0 },
  roomCode: null,
  isHost: false,
  pollTimer: null,
  gameOver: false,
  aiThinking: false,
  inputLocked: false,
  lastAppliedTurnStamp: 0
};

/* ---------------------------------------------------------
   6. DOM REFERENCES
   --------------------------------------------------------- */
const screenMenu = document.getElementById('screen-menu');
const screenGame = document.getElementById('screen-game');
const modeGroup = document.getElementById('modeGroup');
const ruleGroup = document.getElementById('ruleGroup');
const onlineBlock = document.getElementById('onlineBlock');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCodeInput');
const onlineStatusEl = document.getElementById('onlineStatus');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const btnStart = document.getElementById('btnStart');
const menuErrorEl = document.getElementById('menuError');

const boardEl = document.getElementById('board');
const turnLabelEl = document.getElementById('turnLabel');
const turnDotEl = document.getElementById('turnDot');
const roomBadgeEl = document.getElementById('roomBadge');
const roomCodeLabelEl = document.getElementById('roomCodeLabel');
const nameTopEl = document.getElementById('nameTop');
const nameBottomEl = document.getElementById('nameBottom');
const capturedByTopEl = document.getElementById('capturedByTop');
const capturedByBottomEl = document.getElementById('capturedByBottom');
const ruleTagEl = document.getElementById('ruleTag');
const promoRingEl = document.getElementById('promoRing');
const btnBack = document.getElementById('btnBack');
const btnNewGame = document.getElementById('btnNewGame');

const modalOverlay = document.getElementById('modalResult');
const modalWinnerText = document.getElementById('modalWinnerText');
const modalSubText = document.getElementById('modalSubText');
const btnPlayAgain = document.getElementById('btnPlayAgain');
const btnBackMenu2 = document.getElementById('btnBackMenu2');

const themeToggle = document.getElementById('themeToggle');

let cellEls = [];           // 64 cell divs
let pieceLayerEl = null;    // absolute overlay for pieces
const pieceElements = new Map(); // id -> { el, row, col }
let selectedMode = null;
let selectedRule = null;
let myAssignedColor = null;
let pendingOpponentName = null;

/* ---------------------------------------------------------
   7. MENU LOGIC
   --------------------------------------------------------- */
modeGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.tile');
  if (!btn) return;
  selectedMode = btn.dataset.mode;
  [...modeGroup.children].forEach(t => t.classList.toggle('is-selected', t === btn));
  onlineBlock.classList.toggle('is-hidden', selectedMode !== 'online');
  myAssignedColor = null;
  onlineStatusEl.textContent = '';
  state.roomCode = null;
  updateStartButton();
});

ruleGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.tile');
  if (!btn) return;
  selectedRule = btn.dataset.rule;
  [...ruleGroup.children].forEach(t => t.classList.toggle('is-selected', t === btn));
  updateStartButton();
});

playerNameInput.addEventListener('input', updateStartButton);

function updateStartButton() {
  let ok = !!selectedMode && !!selectedRule && playerNameInput.value.trim().length > 0;
  if (selectedMode === 'online') ok = ok && !!myAssignedColor && !!state.roomCode;
  btnStart.disabled = !ok;
  menuErrorEl.textContent = '';
}

btnCreateRoom.addEventListener('click', async () => {
  if (!selectedRule) { onlineStatusEl.textContent = 'กรุณาเลือกกติกาก่อนสร้างห้อง'; return; }
  const name = playerNameInput.value.trim() || 'ผู้เล่น 1';
  onlineStatusEl.textContent = 'กำลังสร้างห้อง...';
  try {
    const res = await GameAPI.createRoom(name, selectedRule);
    state.roomCode = res.roomCode;
    myAssignedColor = 'red';
    state.isHost = true;
    onlineStatusEl.textContent = `สร้างห้องสำเร็จ! รหัสห้อง: ${res.roomCode} (รอผู้เล่นอีกฝั่งเข้าร่วม)`;
    roomCodeInput.value = res.roomCode;
  } catch (err) {
    onlineStatusEl.textContent = 'สร้างห้องไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ';
  }
  updateStartButton();
});

btnJoinRoom.addEventListener('click', async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { onlineStatusEl.textContent = 'กรุณากรอกรหัสห้อง'; return; }
  const name = playerNameInput.value.trim() || 'ผู้เล่น 2';
  onlineStatusEl.textContent = 'กำลังเข้าร่วมห้อง...';
  try {
    const res = await GameAPI.joinRoom(code, name);
    state.roomCode = code;
    myAssignedColor = 'black';
    state.isHost = false;
    pendingOpponentName = res.player1Name || null;
    selectedRule = res.ruleSet || selectedRule;
    if (selectedRule) {
      [...ruleGroup.children].forEach(t => t.classList.toggle('is-selected', t.dataset.rule === selectedRule));
    }
    onlineStatusEl.textContent = `เข้าร่วมห้อง ${code} สำเร็จ!`;
  } catch (err) {
    onlineStatusEl.textContent = 'เข้าร่วมห้องไม่สำเร็จ ตรวจสอบรหัสห้องอีกครั้ง';
  }
  updateStartButton();
});

btnStart.addEventListener('click', () => {
  startGame();
});

/* ---------------------------------------------------------
   8. GAME BOOTSTRAP
   --------------------------------------------------------- */
function buildBoardDom() {
  boardEl.innerHTML = '';
  cellEls = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + ((r + c) % 2 === 1 ? ' is-dark' : '');
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => handleSquareClick(r, c));
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }
  }
  pieceLayerEl = document.createElement('div');
  pieceLayerEl.className = 'piece-layer';
  boardEl.appendChild(pieceLayerEl);
  pieceLayerEl.addEventListener('click', (e) => {
    const pieceEl = e.target.closest('.piece');
    if (!pieceEl) return;
    const r = parseInt(pieceEl.dataset.row, 10);
    const c = parseInt(pieceEl.dataset.col, 10);
    handleSquareClick(r, c);
  });
}

function cellAt(r, c) { return cellEls[r * 8 + c]; }

function startGame() {
  state.mode = selectedMode;
  state.ruleSet = selectedRule;
  state.playerName = playerNameInput.value.trim() || 'ผู้เล่น';
  state.board = createInitialBoard(state.ruleSet);
  state.turn = 'red';
  state.capturedCount = { red: 0, black: 0 };
  state.selected = null;
  state.legalForSelected = [];
  state.gameOver = false;
  state.inputLocked = false;

  if (state.mode === 'ai') {
    state.myColor = 'red';
    state.aiColor = 'black';
    state.opponentName = 'บอท (AI)';
  } else if (state.mode === 'local') {
    state.myColor = null; // both sides local
    state.opponentName = 'ผู้เล่นฝั่งดำ';
  } else if (state.mode === 'online') {
    state.myColor = myAssignedColor;
    state.opponentName = state.isHost ? 'รอผู้เล่น...' : (pendingOpponentName || 'เจ้าของห้อง');
  }

  ruleTagEl.textContent = 'กฎ: ' + (state.ruleSet === 'thai' ? 'หมากฮอสไทย' : 'สากล');
  roomBadgeEl.classList.toggle('is-hidden', state.mode !== 'online');
  if (state.mode === 'online') roomCodeLabelEl.textContent = state.roomCode;

  nameTopEl.textContent = state.mode === 'local' ? 'ผู้เล่นฝั่งดำ' : state.opponentName;
  nameBottomEl.textContent = state.playerName;

  screenMenu.classList.remove('is-active');
  screenGame.classList.add('is-active');

  buildBoardDom();
  syncPiecesToBoard(state.board);
  updateTurnBanner();
  clearHighlights();

  if (state.mode === 'online') {
    startPolling();
    if (state.isHost) pushOnlineState(false); // seed the room with the starting position
  }
  if (state.mode === 'ai' && state.turn === state.aiColor) {
    triggerAiTurn();
  }
}

btnBack.addEventListener('click', () => backToMenu());
btnBackMenu2.addEventListener('click', () => { hideModal(); backToMenu(); });

function backToMenu() {
  stopPolling();
  screenGame.classList.remove('is-active');
  screenMenu.classList.add('is-active');
}

btnNewGame.addEventListener('click', () => {
  if (state.mode === 'online') return; // online games restart via both players rejoining
  startGame();
});
btnPlayAgain.addEventListener('click', () => {
  hideModal();
  if (state.mode === 'online') { backToMenu(); return; }
  startGame();
});

/* ---------------------------------------------------------
   9. RENDERING
   --------------------------------------------------------- */
function positionPieceEl(el, r, c) {
  el.style.left = ((c + 0.5) / 8 * 100) + '%';
  el.style.top = ((r + 0.5) / 8 * 100) + '%';
  el.dataset.row = r;
  el.dataset.col = c;
}

function syncPiecesToBoard(board) {
  const seen = new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      seen.add(p.id);
      let entry = pieceElements.get(p.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'piece is-' + p.color + (p.king ? ' is-king' : '');
        el.style.transition = 'none';
        pieceLayerEl.appendChild(el);
        positionPieceEl(el, r, c);
        void el.offsetWidth; // force reflow so future transitions animate
        el.style.transition = '';
        entry = { el, row: r, col: c };
        pieceElements.set(p.id, entry);
      } else {
        entry.row = r; entry.col = c;
        positionPieceEl(entry.el, r, c);
        entry.el.classList.toggle('is-king', !!p.king);
      }
    }
  }
  for (const [id, entry] of [...pieceElements]) {
    if (!seen.has(id)) {
      entry.el.classList.add('is-vanishing');
      setTimeout(() => { entry.el.remove(); }, 320);
      pieceElements.delete(id);
    }
  }
}

function movePieceElementVisual(id, r, c) {
  const entry = pieceElements.get(id);
  if (!entry) return;
  entry.row = r; entry.col = c;
  positionPieceEl(entry.el, r, c);
}

function vanishPieceAtVisual(r, c) {
  for (const [id, entry] of [...pieceElements]) {
    if (entry.row === r && entry.col === c) {
      entry.el.classList.add('is-vanishing');
      setTimeout(() => { entry.el.remove(); }, 320);
      pieceElements.delete(id);
      return;
    }
  }
}

function clearHighlights() {
  for (const cell of cellEls) {
    cell.classList.remove('is-selected', 'is-valid', 'is-capture', 'is-last-move');
  }
}

function highlightSelection(row, col, moves) {
  clearHighlights();
  cellAt(row, col).classList.add('is-selected');
  for (const m of moves) {
    const cell = cellAt(m.toRow, m.toCol);
    cell.classList.add('is-valid');
    if (m.isCapture) cell.classList.add('is-capture');
  }
}

function markLastMove(move) {
  cellAt(move.fromRow, move.fromCol).classList.add('is-last-move');
  cellAt(move.toRow, move.toCol).classList.add('is-last-move');
}

function updateTurnBanner() {
  const isBlack = state.turn === 'black';
  turnDotEl.classList.toggle('is-black', isBlack);
  const who = state.turn === 'red' ? 'แดง' : 'ดำ';
  let label = `ตาของ: ${who}`;
  if (state.mode === 'ai') label += state.turn === state.aiColor ? ' (บอทกำลังคิด...)' : ` (${state.playerName})`;
  if (state.mode === 'online') label += state.turn === state.myColor ? ' (ตาคุณ)' : ' (รอคู่แข่ง)';
  turnLabelEl.textContent = label;
  capturedByTopEl.textContent = state.mode === 'local'
    ? state.capturedCount.black : state.capturedCount[state.aiColor || opponent(state.myColor || 'red')];
  capturedByBottomEl.textContent = state.mode === 'local'
    ? state.capturedCount.red : state.capturedCount[state.myColor || 'red'];
}

function flashPromotion() {
  promoRingEl.classList.remove('is-firing');
  void promoRingEl.offsetWidth;
  promoRingEl.classList.add('is-firing');
}

/* ---------------------------------------------------------
   10. INTERACTION
   --------------------------------------------------------- */
function localSideIsControllable(color) {
  if (state.mode === 'local') return true;
  if (state.mode === 'ai') return color === state.myColor;
  if (state.mode === 'online') return color === state.myColor;
  return false;
}

function handleSquareClick(row, col) {
  if (state.inputLocked || state.gameOver) return;
  if (!localSideIsControllable(state.turn)) return;

  const allMoves = getAllValidMoves(state.board, state.turn, state.ruleSet);
  const piece = state.board[row][col];

  // Clicking a destination while something is selected
  if (state.selected) {
    const chosen = state.legalForSelected.find(m => m.toRow === row && m.toCol === col);
    if (chosen) {
      commitMove(chosen);
      return;
    }
  }

  // Selecting / reselecting a piece
  if (piece && piece.color === state.turn) {
    const movesForPiece = allMoves.filter(m => m.fromRow === row && m.fromCol === col);
    if (movesForPiece.length === 0) {
      if (allMoves.some(m => m.isCapture)) toast('ต้องกินหมากฝ่ายตรงข้ามก่อน!');
      state.selected = null;
      state.legalForSelected = [];
      clearHighlights();
      return;
    }
    state.selected = { row, col };
    state.legalForSelected = movesForPiece;
    highlightSelection(row, col, movesForPiece);
    return;
  }

  // Clicked empty / invalid square with nothing useful selected
  state.selected = null;
  state.legalForSelected = [];
  clearHighlights();
}

async function commitMove(move) {
  state.inputLocked = true;
  clearHighlights();
  const movingPiece = state.board[move.fromRow][move.fromCol];

  for (let i = 0; i < move.path.length; i++) {
    const step = move.path[i];
    movePieceElementVisual(movingPiece.id, step.row, step.col);
    await wait(HOP_ANIM_MS);
    if (move.captured[i]) {
      vanishPieceAtVisual(move.captured[i].row, move.captured[i].col);
      await wait(HOP_PAUSE_MS);
    }
  }

  const priorTurn = state.turn;
  state.board = applyMove(state.board, move);
  state.capturedCount[priorTurn] += move.captured.length;
  if (move.becameKing) flashPromotion();
  syncPiecesToBoard(state.board);
  markLastMove(move);

  state.selected = null;
  state.legalForSelected = [];
  state.turn = opponent(priorTurn);
  updateTurnBanner();

  const finished = checkGameOverAndReport();
  state.inputLocked = false;

  if (state.mode === 'online') {
    pushOnlineState(finished);
  }
  if (!finished && state.mode === 'ai' && state.turn === state.aiColor) {
    triggerAiTurn();
  }
}

function checkGameOverAndReport() {
  const moves = getAllValidMoves(state.board, state.turn, state.ruleSet);
  if (moves.length > 0) return false;
  state.gameOver = true;
  const winnerColor = opponent(state.turn);
  showEndGame(winnerColor);
  return true;
}

function showEndGame(winnerColor) {
  let winnerName;
  if (state.mode === 'local') {
    winnerName = winnerColor === 'red' ? state.playerName : state.opponentName;
  } else if (state.mode === 'ai') {
    winnerName = winnerColor === state.myColor ? state.playerName : state.opponentName;
  } else {
    winnerName = winnerColor === state.myColor ? state.playerName : state.opponentName;
  }
  modalWinnerText.textContent = `🏆 ${winnerName} ชนะ!`;
  modalSubText.textContent = `สีที่ชนะ: ${winnerColor === 'red' ? 'แดง' : 'ดำ'} · กฎ ${state.ruleSet === 'thai' ? 'หมากฮอสไทย' : 'สากล'}`;
  modalOverlay.classList.remove('is-hidden');

  const shouldSave = state.mode !== 'online' || state.isHost;
  if (shouldSave) {
    GameAPI.saveMatch({
      playerName: state.playerName,
      opponentType: state.mode === 'ai' ? 'AI' : (state.mode === 'online' ? 'Human-Online' : 'Human-Local'),
      ruleSet: state.ruleSet,
      winner: winnerName
    }).catch(() => {});
  }
  stopPolling();
}

function hideModal() { modalOverlay.classList.add('is-hidden'); }

let toastTimer = null;
function toast(message) {
  turnLabelEl.dataset.original = turnLabelEl.dataset.original || turnLabelEl.textContent;
  turnLabelEl.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(updateTurnBanner, 1400);
}

/* ---------------------------------------------------------
   11. AI TURN
   --------------------------------------------------------- */
function triggerAiTurn() {
  state.inputLocked = true;
  updateTurnBanner();
  setTimeout(() => {
    const move = computeAiMove(state.board, state.aiColor, state.ruleSet);
    state.inputLocked = false;
    if (!move) { checkGameOverAndReport(); return; }
    commitMove(move);
  }, 420);
}

/* ---------------------------------------------------------
   12. ONLINE MODE (polling via Google Apps Script)
   --------------------------------------------------------- */
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(pollRoomState, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function pollRoomState() {
  if (!state.roomCode || state.gameOver) return;
  try {
    const remote = await GameAPI.getRoom(state.roomCode);
    if (!remote || !remote.board) return;
    if (remote.updatedAt && remote.updatedAt === state.lastAppliedTurnStamp) return;
    if (remote.opponentJoined && state.mode === 'online' && state.isHost && state.opponentName !== remote.player2Name) {
      state.opponentName = remote.player2Name || state.opponentName;
      nameTopEl.textContent = state.opponentName;
    }
    // Only re-sync if it's meaningfully different from what we already applied
    if (remote.turn !== state.turn || JSON.stringify(remote.board) !== JSON.stringify(state.board)) {
      state.board = remote.board;
      state.turn = remote.turn;
      state.capturedCount = remote.capturedCount || state.capturedCount;
      state.lastAppliedTurnStamp = remote.updatedAt;
      syncPiecesToBoard(state.board);
      updateTurnBanner();
      if (remote.status === 'finished' && !state.gameOver) {
        state.gameOver = true;
        showEndGame(remote.winnerColor);
      }
    }
  } catch (err) { /* silent retry next tick */ }
}

async function pushOnlineState(finished) {
  const payload = {
    roomCode: state.roomCode,
    board: state.board,
    turn: state.turn,
    capturedCount: state.capturedCount,
    status: finished ? 'finished' : 'active',
    winnerColor: finished ? opponent(state.turn) : null
  };
  try {
    const res = await GameAPI.updateRoom(payload);
    if (res && res.updatedAt) state.lastAppliedTurnStamp = res.updatedAt;
  } catch (err) { /* will retry via next move / poll */ }
}

/* ---------------------------------------------------------
   13. THEME TOGGLE
   --------------------------------------------------------- */
themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('theme-dark');
  document.body.classList.toggle('theme-dark', !isDark);
  document.body.classList.toggle('theme-light', isDark);
  themeToggle.querySelector('.theme-toggle__icon').textContent = isDark ? '☼' : '☾';
});
