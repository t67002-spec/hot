/* =========================================================
   หมากฮอสออนไลน์ — database.js
   Thin client for the Google Apps Script backend (Code.gs).

   HOW THIS TALKS TO GOOGLE APPS SCRIPT
   -------------------------------------------------------
   - Reads (getRoom) use a plain GET request with query-string
     params. GET requests don't trigger a CORS preflight, so
     this works against a GAS Web App with zero extra setup.
   - Writes (saveMatch / createRoom / joinRoom / updateRoom) use
     POST, but the body is sent with
     Content-Type: 'text/plain;charset=utf-8' instead of
     'application/json'. This is a well-known trick for Apps
     Script Web Apps: it keeps the request in the "simple
     request" category so the browser skips the OPTIONS
     preflight (which doGet/doPost-only deployments can't
     answer), while Code.gs still JSON.parses the body itself.

   After deploying Code.gs as a Web App (see instructions at
   the bottom of Code.gs), paste the deployment URL below.
   ========================================================= */

const GAS_CONFIG = {
  // 👉 REPLACE with your own Apps Script Web App URL after deploying Code.gs
  WEB_APP_URL: 'https://script.google.com/macros/s/1lhw7Mdp3CfDCnT_7i50pwL4dkOT71M9yX0ZQtG-q7D8/exec'
};

async function gasGet(params) {
  const url = new URL(GAS_CONFIG.WEB_APP_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('Network error: ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function gasPost(payload) {
  const res = await fetch(GAS_CONFIG.WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Network error: ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const GameAPI = {
  /** Save a completed match into the MatchHistory sheet. */
  async saveMatch({ playerName, opponentType, ruleSet, winner }) {
    return gasPost({ action: 'saveMatch', playerName, opponentType, ruleSet, winner });
  },

  /** Fetch recent match history (optional leaderboard/history view). */
  async getHistory(limit = 20) {
    return gasGet({ action: 'getHistory', limit });
  },

  /** Create a new online room. Caller becomes the 'red' host. */
  async createRoom(playerName, ruleSet) {
    return gasPost({ action: 'createRoom', playerName, ruleSet });
  },

  /** Join an existing room by its short code. Joiner becomes 'black'. */
  async joinRoom(roomCode, playerName) {
    return gasPost({ action: 'joinRoom', roomCode, playerName });
  },

  /** Poll the current state of a room (board, turn, status). */
  async getRoom(roomCode) {
    return gasGet({ action: 'getRoom', roomCode });
  },

  /** Push a new board state after a local move. */
  async updateRoom({ roomCode, board, turn, capturedCount, status, winnerColor }) {
    return gasPost({
      action: 'updateBoard',
      roomCode,
      board: JSON.stringify(board),
      turn,
      capturedCount: JSON.stringify(capturedCount),
      status,
      winnerColor: winnerColor || ''
    });
  }
};

// getRoom's board comes back from the sheet as a JSON string — normalize it
// here so the rest of game.js can always treat state.board as a real array.
const _rawGetRoom = GameAPI.getRoom.bind(GameAPI);
GameAPI.getRoom = async function (roomCode) {
  const data = await _rawGetRoom(roomCode);
  if (data && typeof data.board === 'string') {
    try { data.board = JSON.parse(data.board); } catch (e) { /* leave as-is */ }
  }
  if (data && typeof data.capturedCount === 'string') {
    try { data.capturedCount = JSON.parse(data.capturedCount); } catch (e) { /* ignore */ }
  }
  return data;
};
