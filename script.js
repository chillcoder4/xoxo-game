
/**
 * XOXO - Real-Time Multiplayer Game
 * Built with Firebase Realtime Database
 * Developer: Jaswant Yadav
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, remove, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBG64A2bc_T0Onqqw6TTF1O-1SA2-EBluo",
    authDomain: "xoxo-game-b643f.firebaseapp.com",
    databaseURL: "https://xoxo-game-b643f-default-rtdb.asia-southeast1.firebasedatabase.app", 
    projectId: "xoxo-game-b643f",
    storageBucket: "xoxo-game-b643f.firebasestorage.app",
    messagingSenderId: "974850811180",
    appId: "1:974850811180:web:67024f96edde5ccea13889",
    measurementId: "G-7HZ0NYR1CC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- STATE MANAGEMENT ---
let STATE = {
    username: "",
    roomId: "",
    playerSymbol: "", // 'X' or 'O'
    isMyTurn: false,
    gameActive: false,
    cleanupScheduled: false // Prevent duplicate cleanup triggers
};

// --- DOM ELEMENTS (Global Scope) ---
let screens = {};
let ui = {};

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Select Elements
    screens = {
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen')
    };

    ui = {
        username: document.getElementById('username'),
        roomInput: document.getElementById('room-code-input'),
        createBtn: document.getElementById('create-btn'),
        joinBtn: document.getElementById('join-btn'),
        leaveBtn: document.getElementById('leave-btn'),
        
        roomDisplay: document.getElementById('display-room-id'),
        roomInfoBox: document.getElementById('room-info-display'),
        
        status: document.getElementById('status-msg'),
        nameX: document.getElementById('name-x'),
        nameO: document.getElementById('name-o'),
        playerX: document.getElementById('p-x-display'),
        playerO: document.getElementById('p-o-display'),
        cells: Array.from(document.querySelectorAll('.cell')),
        
        chatMsgs: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        sendBtn: document.getElementById('send-btn'),
        emojiParams: document.querySelectorAll('.quick-emojis span'),
        
        modal: document.getElementById('modal-overlay'),
        modalTitle: document.getElementById('modal-title'),
        modalMsg: document.getElementById('modal-msg'),
        modalClose: document.getElementById('modal-close-btn'),
        modalQuit: document.getElementById('modal-quit-btn')
    };

    // 2. Attach Event Listeners
    if (ui.createBtn) ui.createBtn.addEventListener('click', createRoom);
    if (ui.joinBtn) ui.joinBtn.addEventListener('click', joinRoom);
    if (ui.leaveBtn) ui.leaveBtn.addEventListener('click', () => handleLeave(true));
    if (ui.sendBtn) ui.sendBtn.addEventListener('click', sendMessage);

    // Chat Enter Key
    if (ui.chatInput) {
        ui.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    // Emojis (Instant Send)
    if (ui.emojiParams) {
        ui.emojiParams.forEach(emoji => {
            emoji.addEventListener('click', () => {
                const text = emoji.innerText;
                if (!STATE.roomId) return; 
                
                // Direct send logic re-using the push mechanism
                const chatRef = ref(db, `games/${STATE.roomId}/chat`);
                push(chatRef, {
                    user: STATE.username,
                    text: text,
                    time: Date.now()
                });
            });
        });
    }

    // Board Clicks
    if (ui.cells) {
        ui.cells.forEach(cell => {
            cell.addEventListener('click', () => handleMove(cell.dataset.index));
        });
    }

    // Modal Actions
    // "Close" now acts as "Next Round"
    if (ui.modalClose) ui.modalClose.addEventListener('click', startNextRound);
    if (ui.modalQuit) ui.modalQuit.addEventListener('click', () => handleLeave(true));
    
    // Info Modal (About)
    const infoModal = document.getElementById('info-modal');
    const aboutBtn = document.getElementById('about-btn');
    const infoCloseBtn = document.getElementById('info-close-btn');

    if (aboutBtn && infoModal) {
        aboutBtn.addEventListener('click', () => {
            infoModal.classList.remove('hidden');
        });
    }
    if (infoCloseBtn && infoModal) {
        infoCloseBtn.addEventListener('click', () => {
            infoModal.classList.add('hidden');
        });
    }

    // Room ID Copy
    if (ui.roomInfoBox) {
        ui.roomInfoBox.addEventListener('click', () => {
            if (STATE.roomId) {
                navigator.clipboard.writeText(STATE.roomId)
                    .then(() => showToast(`Room ID ${STATE.roomId} Copied!`))
                    .catch(() => showToast("Failed to copy ID"));
            }
        });
    }

    console.log("DOM Loaded & Listeners Attached");
});

// --- CORE FUNCTIONS ---

function generateId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function validateInput() {
  if (STATE.username) return STATE.username;

  const name = ui.username.value.trim();
  if (!name || name.length < 2) {
    alert("Please enter a valid username (min 2 chars).");
    return null;
  }
  return name;
}

// 1. Create Room
async function createRoom() {
    try {
        const user = validateInput();
        if (!user) return;

        const roomId = generateId();
        const roomRef = ref(db, `games/${roomId}`);

        // Check availability
        const snap = await get(roomRef);
        if (snap.exists()) {
             createRoom(); // retry
             return;
        }

        const initialData = {
            board: ["","","","","","","","",""],
            turn: "X",
            playerX: user,
            playerO: "",
            scoreX: 0, 
            scoreO: 0,
            winner: "",
            status: "waiting", 
            createdAt: Date.now()
        };

        await set(roomRef, initialData);

        // Setup Local State
        STATE.username = user;
        STATE.roomId = roomId;
        STATE.playerSymbol = "X";
        STATE.gameActive = true;
        STATE.cleanupScheduled = false;

        enterGame();
        listenToGame();

    } catch (err) {
        console.error(err);
        alert("Error creating room: " + err.message);
    }
}

// 2. Join Room
async function joinRoom() {
    try {
        const user = validateInput();
        if (!user) return;

        const roomId = ui.roomInput.value.trim().toUpperCase();
        if (!roomId) {
            alert("Please enter a Room ID.");
            return;
        }

        const roomRef = ref(db, `games/${roomId}`);
        const snap = await get(roomRef);

        if (!snap.exists()) {
            alert("Room not found! Check the ID.");
            return;
        }

        const data = snap.val();
        if (data.playerO) {
            alert("Room is already full!");
            return;
        }

        // Update DB
        await update(roomRef, {
            playerO: user,
            status: "playing"
        });

        // Setup Local State
        STATE.username = user;
        STATE.roomId = roomId;
        STATE.playerSymbol = "O";
        STATE.gameActive = true;
        STATE.cleanupScheduled = false;

        enterGame();
        listenToGame();

    } catch (err) {
        console.error(err);
        alert("Error joining room: " + err.message);
    }
}

// 3. Game Logic Listener
function listenToGame() {
    const roomRef = ref(db, `games/${STATE.roomId}`);
    const chatRef = ref(db, `games/${STATE.roomId}/chat`);

    // Game Updates
    // We intentionally do NOT use { onlyOnce: true } because we need real-time updates
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        
        // If room data is null, it means room was deleted (Host left or Auto-Cleaned)
        if (!data) {
            // Avoid alert loop if we are the ones who deleted it
            if (!STATE.roomId) return;
            
            alert("Game ended or Room closed.");
            location.reload();
            return;
        }

        updateBoardUI(data);
        updateStatusUI(data);
    });

    // Chat Updates
    onValue(chatRef, (snapshot) => {
        const msgs = snapshot.val();
        ui.chatMsgs.innerHTML = '';
        if (msgs) {
            Object.values(msgs).forEach(msg => renderMessage(msg));
            ui.chatMsgs.scrollTop = ui.chatMsgs.scrollHeight;
        }
    });

    // Send system message only for Joiner upon first connection
    // (In a real app we'd check if specific message exists, strictly simple here per req)
    if (STATE.playerSymbol === 'O') {
        const systemMsgRef = ref(db, `games/${STATE.roomId}/chat`);
        // We push blindly. It's fine for this scale.
        push(systemMsgRef, {
            user: "System",
            text: `${STATE.username} joined the game.`,
            type: "system",
            time: Date.now()
        });
    }
}

function updateBoardUI(data) {
    // Board
    data.board.forEach((val, idx) => {
        const cell = ui.cells[idx];
        cell.className = "cell"; 
        if (val === 'X') cell.classList.add('x');
        if (val === 'O') cell.classList.add('o');
        cell.textContent = val;
    });

    // Players
    ui.nameX.textContent = data.playerX || "Waiting...";
    ui.nameO.textContent = data.playerO || "Waiting...";

    // Scores
    const scoreXEl = document.getElementById('score-x');
    const scoreOEl = document.getElementById('score-o');
    if (scoreXEl) scoreXEl.textContent = data.scoreX || 0;
    if (scoreOEl) scoreOEl.textContent = data.scoreO || 0;

    ui.playerX.classList.toggle('active', data.turn === 'X');
    ui.playerO.classList.toggle('active', data.turn === 'O');

    // Win/Draw Logic
    if (data.winner) {
        STATE.gameActive = false;
        let msg = "";
        let btnText = "Start Next Round"; // Default text for continuous play
        
        if (data.winner === "DRAW") {
            msg = "It's a Draw! 🤝";
        } else {
            const winnerName = data.winner === 'X' ? data.playerX : data.playerO;
            msg = `${winnerName} Wins! 🎉`;
        }
        
        // Show Modal with Reset Option
        if(ui.modal.classList.contains('hidden')) {
             showModal(msg, btnText);
        }

        // NO AUTO-CLEANUP: Removed per new requirements.
        // Room stays open for unlimited rounds.

    } else {
        ui.modal.classList.add('hidden');
        STATE.gameActive = true;
    }
}

function updateStatusUI(data) {
    if (!data.playerO) {
        ui.status.textContent = "Waiting for player to join...";
        ui.status.className = "status-msg";
        return;
    }

    if (data.winner) {
        ui.status.textContent = "Round Over";
        return;
    }

    const isMyTurn = data.turn === STATE.playerSymbol;
    STATE.isMyTurn = isMyTurn;

    if (isMyTurn) {
        ui.status.textContent = "Your Turn!";
        ui.status.className = "status-msg active-turn";
    } else {
        const opponentName = STATE.playerSymbol === 'X' ? data.playerO : data.playerX;
        ui.status.textContent = `Waiting for ${opponentName}...`;
        ui.status.className = "status-msg";
    }
}

// 4. Move Logic
function handleMove(index) {
    if (!STATE.gameActive || !STATE.isMyTurn) return;
    if (ui.cells[index].textContent !== "") return;

    // Read current state to ensure strict validation
    const roomRef = ref(db, `games/${STATE.roomId}`);
    get(roomRef).then((snap) => {
        const data = snap.val();
        
        // Validation
        if (!data || data.winner || data.turn !== STATE.playerSymbol || data.board[index] !== "") return;

        const newBoard = [...data.board];
        newBoard[index] = STATE.playerSymbol;

        const winner = checkWin(newBoard);
        let nextTurn = STATE.playerSymbol === 'X' ? 'O' : 'X';
        
        // Score Logic
        let updates = {
            board: newBoard,
            turn: nextTurn, // Default next turn
            winner: ""
        };

        if (winner) {
            updates.winner = winner;
            
            if (winner === 'X') {
                updates.scoreX = (data.scoreX || 0) + 1;
                updates.turn = 'X'; // Winner starts next
            } else if (winner === 'O') {
                updates.scoreO = (data.scoreO || 0) + 1;
                updates.turn = 'O'; // Winner starts next
            } else {
                // DRAW
                updates.turn = data.turn === 'X' ? 'O' : 'X'; // Swap start for draw? Or keep X? let's wap.
            }
        }

        update(roomRef, updates);
    });
}


function startNextRound() {
    if (!STATE.roomId) return;
    
    // Reset board, keep scores, keep players
    // This action can be triggered by either player, so we just blindly update content
    update(ref(db, `games/${STATE.roomId}`), {
        board: ["","","","","","","","",""],
        winner: ""
       // Turn is already set correctly by handleMove (Winner starts)
    });
    
    ui.modal.classList.add('hidden');
}

function showModal(msg, btnLabel = "Close") {
    ui.modalTitle.textContent = msg.includes("Draw") ? "Draw!" : "Round Won!";
    ui.modalMsg.textContent = msg;
    if (ui.modalClose) ui.modalClose.textContent = btnLabel;
    ui.modal.classList.remove('hidden');
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'glass-panel';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '10px 20px';
    toast.style.zIndex = '999';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function checkWin(board) {
    const wins = [
        [0,1,2], [3,4,5], [6,7,8],
        [0,3,6], [1,4,7], [2,5,8],
        [0,4,8], [2,4,6]
    ];

    for (let combo of wins) {
        const [a, b, c] = combo;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    if (board.every(cell => cell !== "")) return "DRAW";
    return null;
}

// 5. Chat System
function sendMessage() {
    const text = ui.chatInput.value.trim();
    if (!text) return;

    const chatRef = ref(db, `games/${STATE.roomId}/chat`);
    push(chatRef, {
        user: STATE.username,
        text: text,
        time: Date.now()
    });

    ui.chatInput.value = "";
}

function renderMessage(msg) {
    const div = document.createElement('div');
    if (msg.type === 'system') {
        div.className = 'message system';
        div.textContent = msg.text;
    } else {
        const isMe = msg.user === STATE.username;
        div.className = `message ${isMe ? 'me' : 'opponent'}`;
        div.innerHTML = `<span class="sender">${isMe ? 'You' : msg.user}</span>${msg.text}`;
    }
    ui.chatMsgs.appendChild(div);
}

// 6. Extras
function enterGame() {
    screens.lobby.classList.add('hidden');
    screens.game.classList.remove('hidden');
    ui.roomDisplay.textContent = STATE.roomId;
}

async function handleLeave(userAction = false) {
    if (!STATE.roomId) return;

    if (userAction && !confirm("Are you sure you want to leave?")) return;

    // Manual Cleanup Logic
    // NO onDisconnect used, so we must be robust here.
    if (STATE.playerSymbol === 'X') {
        // Host leaves -> Destroy Room
        // This is safe because 'X' is the owner.
        await remove(ref(db, `games/${STATE.roomId}`));
    } else {
        // Joiner leaves -> Clear playerO field only
        try {
            await update(ref(db, `games/${STATE.roomId}`), {
                playerO: ""
            });
        } catch(e) {
            // Room might already be deleted
        }
    }
    location.reload();
}
