// ========================================
// うんちスピードスター
// Main JavaScript (ES Module)
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    get,
    remove,
    onValue,
    off,
    runTransaction,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

import {
    CORRECT_WORD,
    UNIQUE_FAKE_WORDS,
    ALL_WORDS,
    CORRECT_WORD_INDEX
} from "./words.js";

// ========================================
// Firebase設定
// ========================================
const firebaseConfig = {
  apiKey: "AIzaSyCHcw78cImehf65vogNXPyxm2C4LpJlciU",
  authDomain: "unch-speedstar.firebaseapp.com",
  databaseURL: "https://unch-speedstar-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "unch-speedstar",
  storageBucket: "unch-speedstar.firebasestorage.app",
  messagingSenderId: "158427272547",
  appId: "1:158427272547:web:97ab36d4ef3b7681f3ef56",
  measurementId: "G-PZ75BED8KQ"
};

let firebaseApp = null;
let db = null;
let firebaseReady = false;

try {
    firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    firebaseReady = true;
} catch (err) {
    console.warn("Firebase初期化に失敗しました（設定値を確認してください）", err);
    firebaseReady = false;
}

// ========================================
// 定数：単語リスト・難易度設定
// ========================================

// 難易度ごとのダミー出現確率（fakeRate）
const DIFFICULTY_SETTINGS = {
    1: { name: "EASY", min: 1000, max: 1300, fakeRate: 0.60 },   // 正解率40%
    2: { name: "NORMAL", min: 600, max: 1300, fakeRate: 0.70 }, // 正解率30%
    3: { name: "HARD", min: 400, max: 1300, fakeRate: 0.80 },   // 正解率20%
    4: { name: "CHAOS", min: 100, max: 1300, fakeRate: 0.85 }   // 正解率15%
};

// 「ひとりであそぶ」の進行構成
const SINGLE_LEVEL_PROGRESSION = [1, 2, 2, 3, 4];
const MISS_PENALTY_MS = 500;
const LOCAL_HIGHSCORE_LIST_KEY = "unchiSpeedstar_highscore_list_ms";
const EFFECT_WAIT_MS = 2000; // 演出待機時間（2.0秒）

const ANIMATION_CLASSES = [
    "anim-pop",
    "anim-slide-left",
    "anim-slide-right",
    "anim-fade-blur",
    "anim-rotate-tilt"
];

// ========================================
// 効果音
// ========================================

const sounds = {
    word: new Audio("assets/sounds/word.mp3"),
    correct: new Audio("assets/sounds/correct.mp3"),
    miss: new Audio("assets/sounds/miss.mp3"),
    win: new Audio("assets/sounds/win.mp3"),
    highscore: new Audio("assets/sounds/highscore.mp3")
};

function playSound(key) {
    const src = sounds[key];
    if (!src) return;
    try {
        src.currentTime = 0;
        src.play().catch(() => {});
    } catch (err) {}
}

// ========================================
// DOM参照
// ========================================

const screens = {
    title: document.getElementById("screen-title"),
    single: document.getElementById("screen-single"),
    singleResult: document.getElementById("screen-single-result"),
    multiSetup: document.getElementById("screen-multi-setup"),
    roomWait: document.getElementById("screen-room-wait"),
    multiPlay: document.getElementById("screen-multi-play"),
    multiResult: document.getElementById("screen-multi-result"),
    highscore: document.getElementById("screen-highscore")
};

function showScreen(key) {
    Object.values(screens).forEach((el) => el.classList.remove("is-active"));
    screens[key].classList.add("is-active");
}

// ========================================
// 共通ユーティリティ
// ========================================

function randomPlayerName() {
    const n = Math.floor(Math.random() * 900) + 100;
    return `Player${n}`;
}

function randomRoomId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function randomPlayerId() {
    return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function formatSeconds(ms) {
    return (ms / 1000).toFixed(2) + "秒";
}

function resetFeedback(feedbackBadgeEl, stageEl) {
    if (feedbackBadgeEl) {
        feedbackBadgeEl.classList.remove("badge-good", "badge-bad");
        feedbackBadgeEl.textContent = "";
    }
    if (stageEl) {
        stageEl.classList.remove("shake-stage");
    }
}

function triggerFeedback(overlayEl, feedbackBadgeEl, stageEl, type, customText = "") {
    overlayEl.classList.remove("flash-good", "flash-bad");
    void overlayEl.offsetWidth;
    overlayEl.classList.add(type === "good" ? "flash-good" : "flash-bad");
    window.setTimeout(() => {
        overlayEl.classList.remove("flash-good", "flash-bad");
    }, 220);

    if (feedbackBadgeEl) {
        feedbackBadgeEl.classList.remove("badge-good", "badge-bad");
        void feedbackBadgeEl.offsetWidth;
        if (type === "good") {
            feedbackBadgeEl.textContent = customText || "〇せいかい";
            feedbackBadgeEl.classList.add("badge-good");
        } else {
            feedbackBadgeEl.textContent = customText || "✕ お手つき！";
            feedbackBadgeEl.classList.add("badge-bad");
        }
    }

    if (type === "bad" && stageEl) {
        stageEl.classList.remove("shake-stage");
        void stageEl.offsetWidth;
        stageEl.classList.add("shake-stage");
    }
}

function pickWord(difficultyLevel) {
    const settings = DIFFICULTY_SETTINGS[difficultyLevel] || DIFFICULTY_SETTINGS[2];
    const isFake = Math.random() < settings.fakeRate;
    if (!isFake) {
        return { word: CORRECT_WORD, isCorrect: true };
    }
    const fake = UNIQUE_FAKE_WORDS[Math.floor(Math.random() * UNIQUE_FAKE_WORDS.length)];
    return { word: fake, isCorrect: false };
}

function pickInterval(difficultyLevel) {
    const settings = DIFFICULTY_SETTINGS[difficultyLevel] || DIFFICULTY_SETTINGS[2];
    return Math.floor(settings.min + Math.random() * (settings.max - settings.min));
}

function setWordTextWithAnimation(element, newText) {
    element.textContent = "";
    ANIMATION_CLASSES.forEach(cls => element.classList.remove(cls));

    if (!newText) return;

    void element.offsetWidth;
    element.textContent = newText;
    const animClass = ANIMATION_CLASSES[Math.floor(Math.random() * ANIMATION_CLASSES.length)];
    element.classList.add(animClass);
}

function getTitleInfo(totalMs) {
    const sec = totalMs / 1000;
    if (sec < 2.50) return { rank: "ss", name: "👑 神速のうんち神" };
    if (sec < 3.00) return { rank: "s", name: "⚡ 光速のうんちマスター" };
    if (sec < 4.00) return { rank: "a", name: "💩 ベテランうんちハンター" };
    if (sec < 6.00) return { rank: "b", name: "🏃 見習いうんちハンター" };
    if (sec < 8.00) return { rank: "c", name: "🐢 のんびりうんち鑑賞家" };
    return { rank: "d", name: "💤 うんち初心者" };
}

// カウントダウン共通関数（れでぃ？ → ごー！）
function startCountdown(wordElement, onComplete) {
    setWordTextWithAnimation(wordElement, "れでぃ？");
    playSound("word");

    window.setTimeout(() => {
        setWordTextWithAnimation(wordElement, "ごー！");
        playSound("correct");

        window.setTimeout(() => {
            setWordTextWithAnimation(wordElement, "");
            if (onComplete) onComplete();
        }, 600);
    }, 800);
}

// ========================================
// ひとりであそぶ
// ========================================

const singleEls = {
    flash: document.getElementById("single-flash"),
    feedback: document.getElementById("single-feedback"),
    stage: document.getElementById("single-stage"),
    roundTimes: document.getElementById("single-round-times"),
    wordBlob: document.getElementById("single-word-blob"),
    wordText: document.getElementById("single-word-text"),
    wordElapsed: document.getElementById("single-word-elapsed"),
    quitBtn: document.getElementById("btn-single-quit"),
    resultTotal: document.getElementById("single-result-total"),
    resultDetail: document.getElementById("single-result-detail"),
    resultNewRecord: document.getElementById("single-result-newrecord"),
    retryBtn: document.getElementById("btn-single-retry"),
    toTitleBtn: document.querySelector(".btn-single-to-title")
};

let singleState = null;

function createSingleState() {
    return {
        roundIndex: 0,
        roundTimesMs: [0, 0, 0, 0, 0],
        roundTapTimesMs: [0, 0, 0, 0, 0],
        roundMissedTimesMs: [0, 0, 0, 0, 0],
        roundMissCounts: [0, 0, 0, 0, 0],
        wordTimeoutId: null,
        wordStartedAt: 0,
        waitingForCorrectTap: false,
        wordIsActive: false,
        finished: false,
        isPaused: true,
        isCountingDown: true,
        elapsedTimerAnimId: null
    };
}

function renderSingleRoundChips() {
    singleEls.roundTimes.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        const chip = document.createElement("span");
        chip.className = "round-chip";
        if (i < singleState.roundIndex) {
            chip.classList.add("is-done");
            chip.textContent = `${i + 1}: ${formatSeconds(singleState.roundTapTimesMs[i])}`;
        } else if (i === singleState.roundIndex) {
            chip.classList.add("is-current");
            chip.textContent = `${i + 1}回目`;
        } else {
            chip.textContent = `${i + 1}`;
        }
        singleEls.roundTimes.appendChild(chip);
    }
}

function updateWordElapsedDisplay() {
    if (!singleState || singleState.finished) return;

    if (!singleState.isPaused && singleState.wordIsActive && singleState.wordStartedAt > 0) {
        const now = performance.now();
        const elapsed = (now - singleState.wordStartedAt) / 1000;
        singleEls.wordElapsed.textContent = `単語経過: ${elapsed.toFixed(2)}秒`;
    } else if (!singleState.isPaused) {
        singleEls.wordElapsed.textContent = "単語経過: 0.00秒";
    }

    singleState.elapsedTimerAnimId = requestAnimationFrame(updateWordElapsedDisplay);
}

function startSinglePlay() {
    stopSinglePlay();
    singleState = createSingleState();
    resetFeedback(singleEls.feedback, singleEls.stage);
    renderSingleRoundChips();

    if (singleEls.wordElapsed) {
        singleEls.wordElapsed.textContent = "単語経過: 0.00秒";
    }

    showScreen("single");

    startCountdown(singleEls.wordText, () => {
        if (!singleState) return;
        singleState.isCountingDown = false;
        singleState.isPaused = false;
        scheduleSingleWord();
        updateWordElapsedDisplay();
    });
}

function scheduleSingleWord() {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    const level = SINGLE_LEVEL_PROGRESSION[singleState.roundIndex];
    const interval = pickInterval(level);

    singleState.wordTimeoutId = window.setTimeout(() => {
        showSingleWord(level);
    }, interval);
}

function showSingleWord(level) {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    if (singleState.wordIsActive && singleState.waitingForCorrectTap && singleState.wordStartedAt > 0) {
        const missedTime = performance.now() - singleState.wordStartedAt;
        singleState.roundMissedTimesMs[singleState.roundIndex] += missedTime;
        singleState.roundTimesMs[singleState.roundIndex] += missedTime;
    }

    resetFeedback(singleEls.feedback, singleEls.stage);
    const { word, isCorrect } = pickWord(level);
    setWordTextWithAnimation(singleEls.wordText, word);

    singleState.wordIsActive = true;
    singleState.waitingForCorrectTap = isCorrect;
    singleState.wordStartedAt = performance.now();
    playSound("word");

    scheduleSingleWord();
}

function handleSingleTap() {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    const isCorrectTap = singleState.wordIsActive && singleState.waitingForCorrectTap;

    singleState.isPaused = true;
    if (singleState.wordTimeoutId) {
        window.clearTimeout(singleState.wordTimeoutId);
        singleState.wordTimeoutId = null;
    }

    if (isCorrectTap) {
        const reaction = performance.now() - singleState.wordStartedAt;
        singleState.roundTapTimesMs[singleState.roundIndex] = reaction;

        singleEls.wordElapsed.textContent = `単語経過: ${(reaction / 1000).toFixed(2)}秒`;

        const missPenalty = singleState.roundMissCounts[singleState.roundIndex] * MISS_PENALTY_MS;
        singleState.roundTimesMs[singleState.roundIndex] += (reaction + missPenalty);

        playSound("correct");
        triggerFeedback(singleEls.flash, singleEls.feedback, singleEls.stage, "good");

        singleState.wordIsActive = false;
        singleState.waitingForCorrectTap = false;
        singleState.wordStartedAt = 0;

        window.setTimeout(() => {
            if (!singleState) return;
            singleState.isPaused = false;
            resetFeedback(singleEls.feedback, singleEls.stage);
            setWordTextWithAnimation(singleEls.wordText, "");
            advanceSingleRound();
        }, EFFECT_WAIT_MS);
    } else {
        singleState.roundMissCounts[singleState.roundIndex] += 1;
        playSound("miss");
        triggerFeedback(singleEls.flash, singleEls.feedback, singleEls.stage, "bad");

        singleState.wordIsActive = false;
        singleState.waitingForCorrectTap = false;
        singleState.wordStartedAt = 0;

        window.setTimeout(() => {
            if (!singleState) return;
            singleState.isPaused = false;
            resetFeedback(singleEls.feedback, singleEls.stage);
            setWordTextWithAnimation(singleEls.wordText, "");
            scheduleSingleWord();
        }, EFFECT_WAIT_MS);
    }
}

function advanceSingleRound() {
    singleState.roundIndex += 1;
    renderSingleRoundChips();

    if (singleState.roundIndex >= 5) {
        singleState.finished = true;
        finishSinglePlay();
        return;
    }

    scheduleSingleWord();
}

function getLocalHighscores() {
    const raw = window.localStorage.getItem(LOCAL_HIGHSCORE_LIST_KEY);
    if (!raw) {
        const oldVal = window.localStorage.getItem("unchiSpeedstar_highscore_ms");
        if (oldVal) {
            const parsedOld = parseFloat(oldVal);
            if (!isNaN(parsedOld)) return [parsedOld];
        }
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveLocalHighscore(totalMs) {
    const list = getLocalHighscores();
    list.push(totalMs);
    list.sort((a, b) => a - b);
    const best5 = list.slice(0, 5);
    window.localStorage.setItem(LOCAL_HIGHSCORE_LIST_KEY, JSON.stringify(best5));
    return best5[0] === totalMs;
}

function finishSinglePlay() {
    if (singleState.elapsedTimerAnimId) {
        cancelAnimationFrame(singleState.elapsedTimerAnimId);
        singleState.elapsedTimerAnimId = null;
    }

    const totalMs = singleState.roundTimesMs.reduce((a, b) => a + b, 0);
    const isNewTopRecord = saveLocalHighscore(totalMs);

    playSound("win");

    if (isNewTopRecord) {
        window.setTimeout(() => playSound("highscore"), 300);
        saveHighscoreToFirebase(totalMs).catch(() => {});
    }

    singleEls.resultNewRecord.classList.toggle("is-hidden", !isNewTopRecord);
    singleEls.resultTotal.textContent = formatSeconds(totalMs);

    const titleInfo = getTitleInfo(totalMs);
    const titleBadge = document.getElementById("single-result-title-badge");
    if (titleBadge) {
        titleBadge.textContent = titleInfo.name;
        titleBadge.className = `title-badge rank-${titleInfo.rank}`;
        titleBadge.classList.remove("is-hidden");
    }

    singleEls.resultDetail.innerHTML = "";

    for (let i = 0; i < 5; i++) {
        const row = document.createElement("div");
        row.className = "result-row";
        const level = SINGLE_LEVEL_PROGRESSION[i];
        const levelName = DIFFICULTY_SETTINGS[level].name;

        const roundTotal = singleState.roundTimesMs[i];
        const tapTime = singleState.roundTapTimesMs[i];
        const missedTime = singleState.roundMissedTimesMs[i];
        const missCount = singleState.roundMissCounts[i];

        row.innerHTML = `
            <div class="result-row-header">
                <span>${i + 1}回目（${levelName}）</span>
                <span>${formatSeconds(roundTotal)}</span>
            </div>
            <div class="result-row-breakdown">
                <span>タップ: ${formatSeconds(tapTime)}</span>
                ${missedTime > 0 ? `<span>見逃し: +${formatSeconds(missedTime)}</span>` : ""}
                ${missCount > 0 ? `<span>お手つき: ${missCount}回(+${formatSeconds(missCount * MISS_PENALTY_MS)})</span>` : ""}
            </div>
        `;
        singleEls.resultDetail.appendChild(row);
    }

    showScreen("singleResult");
}

function stopSinglePlay() {
    if (singleState) {
        if (singleState.wordTimeoutId) {
            window.clearTimeout(singleState.wordTimeoutId);
            singleState.wordTimeoutId = null;
        }
        if (singleState.elapsedTimerAnimId) {
            cancelAnimationFrame(singleState.elapsedTimerAnimId);
            singleState.elapsedTimerAnimId = null;
        }
    }
    singleState = null;
}

singleEls.wordBlob.addEventListener("click", handleSingleTap);
singleEls.quitBtn.addEventListener("click", () => {
    stopSinglePlay();
    showScreen("title");
});
singleEls.retryBtn.addEventListener("click", startSinglePlay);
if (singleEls.toTitleBtn) {
    singleEls.toTitleBtn.addEventListener("click", () => showScreen("title"));
}

document.getElementById("btn-goto-single").addEventListener("click", startSinglePlay);

// ========================================
// ハイスコア画面
// ========================================

const highscoreEls = {
    localList: document.getElementById("highscore-local-list"),
    ranking: document.getElementById("highscore-ranking"),
    toTitleBtn: document.getElementById("btn-highscore-to-title")
};

async function saveHighscoreToFirebase(totalMs) {
    if (!firebaseReady) return;
    const name = getStoredPlayerName() || randomPlayerName();
    const id = getOrCreateLocalPlayerId();
    try {
        await set(ref(db, `highscores/${id}`), {
            name,
            totalMs,
            updatedAt: serverTimestamp()
        });
    } catch (err) {
        console.warn("ハイスコアのFirebase保存に失敗しました", err);
    }
}

function getOrCreateLocalPlayerId() {
    let id = window.localStorage.getItem("unchiSpeedstar_playerId");
    if (!id) {
        id = randomPlayerId();
        window.localStorage.setItem("unchiSpeedstar_playerId", id);
    }
    return id;
}

function getStoredPlayerName() {
    return window.localStorage.getItem("unchiSpeedstar_playerName") || "";
}

function renderHighscoreScreen() {
    const localBest = getLocalHighscores();
    highscoreEls.localList.innerHTML = "";
    if (localBest.length === 0) {
        highscoreEls.localList.innerHTML = '<li class="highscore-loading">記録なし</li>';
    } else {
        localBest.forEach((ms, index) => {
            const titleInfo = getTitleInfo(ms);
            const li = document.createElement("li");
            li.innerHTML = `
                <span class="hs-rank">${index + 1}位</span>
                <span class="hs-title rank-${titleInfo.rank}">${titleInfo.name}</span>
                <span class="hs-time">${formatSeconds(ms)}</span>
            `;
            highscoreEls.localList.appendChild(li);
        });
    }

    highscoreEls.ranking.innerHTML = '<li class="highscore-loading">読み込み中…</li>';

    if (!firebaseReady) {
        highscoreEls.ranking.innerHTML = '<li class="highscore-loading">オンラインランキングは利用できません</li>';
        return;
    }

    get(ref(db, "highscores"))
        .then((snapshot) => {
            const data = snapshot.val();
            if (!data) {
                highscoreEls.ranking.innerHTML = '<li class="highscore-loading">まだ記録がありません</li>';
                return;
            }
            const list = Object.values(data)
                .filter((entry) => typeof entry.totalMs === "number")
                .sort((a, b) => a.totalMs - b.totalMs)
                .slice(0, 10);

            highscoreEls.ranking.innerHTML = "";
            list.forEach((entry, index) => {
                const li = document.createElement("li");
                li.innerHTML = `<span>${index + 1}. ${escapeHtml(entry.name || "名無し")}</span><span>${formatSeconds(
                    entry.totalMs
                )}</span>`;
                highscoreEls.ranking.appendChild(li);
            });
        })
        .catch(() => {
            highscoreEls.ranking.innerHTML = '<li class="highscore-loading">読み込みに失敗しました</li>';
        });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

document.getElementById("btn-goto-highscore").addEventListener("click", () => {
    renderHighscoreScreen();
    showScreen("highscore");
});
highscoreEls.toTitleBtn.addEventListener("click", () => showScreen("title"));

// ========================================
// みんなであそぶ（通信対戦）
// ========================================

const multiSetupEls = {
    nameInput: document.getElementById("input-player-name"),
    roomIdInput: document.getElementById("input-room-id"),
    joinBtn: document.getElementById("btn-join-room"),
    errorText: document.getElementById("multi-setup-error"),
    toTitleBtn: document.getElementById("btn-multi-to-title")
};

const roomWaitEls = {
    idDisplay: document.getElementById("room-id-display"),
    players: document.getElementById("room-players"),
    leaveBtn: document.getElementById("btn-room-leave")
};

const multiPlayEls = {
    flash: document.getElementById("multi-flash"),
    feedback: document.getElementById("multi-feedback"),
    stage: document.getElementById("multi-stage"),
    scoreboard: document.getElementById("multi-scoreboard"),
    wordBlob: document.getElementById("multi-word-blob"),
    wordText: document.getElementById("multi-word-text"),
    difficultyBadge: document.getElementById("multi-difficulty-badge"),
    penaltyText: document.getElementById("multi-penalty-text")
};

const multiResultEls = {
    title: document.getElementById("multi-result-title"),
    ranking: document.getElementById("multi-result-ranking"),
    toTitleBtn: document.getElementById("btn-multi-result-to-title")
};

const WIN_SCORE = 3;

let multi = {
    roomId: null,
    playerId: null,
    playerName: null,
    maxPlayers: null,
    isHost: false,
    listeners: [],
    penaltyUntil: 0,
    penaltyAnimFrameId: null,
    hostLoopTimeoutId: null,
    lastPlayersData: {}
};

function multiWatch(path, callback) {
    const r = ref(db, path);
    onValue(r, callback);
    multi.listeners.push({ ref: r, callback });
}

function multiUnwatchAll() {
    multi.listeners.forEach(({ ref: r, callback }) => off(r, "value", callback));
    multi.listeners = [];
    if (multi.hostLoopTimeoutId) {
        window.clearTimeout(multi.hostLoopTimeoutId);
        multi.hostLoopTimeoutId = null;
    }
    if (multi.penaltyAnimFrameId) {
        cancelAnimationFrame(multi.penaltyAnimFrameId);
        multi.penaltyAnimFrameId = null;
    }
}

function requireFirebase() {
    if (!firebaseReady) {
        multiSetupEls.errorText.textContent =
            "Firebaseが設定されていないため、みんなであそぶモードは利用できません。script.js内のfirebaseConfigを設定してください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
        return false;
    }
    return true;
}

document.getElementById("btn-goto-multi").addEventListener("click", () => {
    multiSetupEls.errorText.classList.add("is-hidden");
    const stored = getStoredPlayerName();
    if (stored) multiSetupEls.nameInput.value = stored;
    showScreen("multiSetup");
});
multiSetupEls.toTitleBtn.addEventListener("click", () => showScreen("title"));

document.querySelectorAll(".btn-playercount").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (!requireFirebase()) return;
        const count = parseInt(btn.dataset.count, 10);
        createRoom(count);
    });
});

multiSetupEls.joinBtn.addEventListener("click", () => {
    if (!requireFirebase()) return;
    const roomId = multiSetupEls.roomIdInput.value.trim().toUpperCase();
    if (roomId.length !== 6) {
        multiSetupEls.errorText.textContent = "6桁のルームIDを入力してください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
        return;
    }
    joinRoom(roomId);
});

function resolvePlayerName() {
    const typed = multiSetupEls.nameInput.value.trim();
    const name = typed || randomPlayerName();
    window.localStorage.setItem("unchiSpeedstar_playerName", name);
    return name;
}

async function createRoom(maxPlayers) {
    multiUnwatchAll();
    const roomId = randomRoomId();
    const playerId = randomPlayerId();
    const playerName = resolvePlayerName();

    multi.roomId = roomId;
    multi.playerId = playerId;
    multi.playerName = playerName;
    multi.maxPlayers = maxPlayers;
    multi.lastPlayersData = {};

    try {
        await set(ref(db, `rooms/${roomId}`), {
            maxPlayers,
            playerCount: 1,
            state: "waiting",
            createdAt: serverTimestamp()
        });
        await set(ref(db, `rooms/${roomId}/players/${playerId}`), {
            name: playerName,
            score: 0,
            joinedAt: Date.now()
        });

        onDisconnect(ref(db, `rooms/${roomId}/players/${playerId}`)).remove();
        enterRoomWaitScreen();
    } catch (err) {
        console.error(err);
        multiSetupEls.errorText.textContent = "ルーム作成に失敗しました。時間をおいて再度お試しください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
    }
}

async function joinRoom(roomId) {
    multiUnwatchAll();
    try {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const room = snap.val();
        if (!room) {
            multiSetupEls.errorText.textContent = "そのルームIDは見つかりませんでした。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }
        if (room.state !== "waiting") {
            multiSetupEls.errorText.textContent = "このルームはすでに開始しています。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }
        if ((room.playerCount || 0) >= room.maxPlayers) {
            multiSetupEls.errorText.textContent = "このルームは満員です。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }

        const playerId = randomPlayerId();
        const playerName = resolvePlayerName();

        multi.roomId = roomId;
        multi.playerId = playerId;
        multi.playerName = playerName;
        multi.maxPlayers = room.maxPlayers;
        multi.lastPlayersData = {};

        await set(ref(db, `rooms/${roomId}/players/${playerId}`), {
            name: playerName,
            score: 0,
            joinedAt: Date.now()
        });

        await runTransaction(ref(db, `rooms/${roomId}/playerCount`), (current) => (current || 0) + 1);

        onDisconnect(ref(db, `rooms/${roomId}/players/${playerId}`)).remove();
        enterRoomWaitScreen();
    } catch (err) {
        console.error(err);
        multiSetupEls.errorText.textContent = "参加に失敗しました。ルームIDをご確認ください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
    }
}

function renderRoomQrCode(roomId) {
    const container = document.getElementById("room-qr");
    if (!container) return;
    container.innerHTML = "";

    if (typeof QRCode === "undefined") {
        console.warn("QRコードライブラリの読み込みに失敗しました");
        return;
    }

    const joinUrl = `${location.origin}${location.pathname}?room=${roomId}`;
    try {
        new QRCode(container, {
            text: joinUrl,
            width: 140,
            height: 140,
            colorDark: "#3A2C1D",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    } catch (err) {
        console.warn("QRコードの生成に失敗しました", err);
    }
}

function enterRoomWaitScreen() {
    roomWaitEls.idDisplay.textContent = multi.roomId;
    renderRoomQrCode(multi.roomId);
    showScreen("roomWait");

    multiWatch(`rooms/${multi.roomId}/players`, (snapshot) => {
        const players = snapshot.val() || {};
        multi.lastPlayersData = { ...players };
        renderRoomWaitPlayers(players);
        renderMultiScoreboard(multiPlayEls.scoreboard, players);
        checkAndUpdateHost(players);
    });

    multiWatch(`rooms/${multi.roomId}/state`, (snapshot) => {
        const state = snapshot.val();
        if (state === "playing") {
            enterMultiPlayScreen();
        } else if (state === "finished") {
            enterMultiResultScreen();
        }
    });

    multiWatch(`rooms/${multi.roomId}/round`, (snapshot) => {
        const round = snapshot.val();
        if (round) handleRoundUpdate(round);
    });

    watchAutoStart();
}

function checkAndUpdateHost(players) {
    const entries = Object.entries(players);
    if (entries.length === 0) return;
    entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    multi.isHost = (entries[0][0] === multi.playerId);
}

function watchAutoStart() {
    multiWatch(`rooms/${multi.roomId}/players`, async (snapshot) => {
        const players = snapshot.val() || {};
        const count = Object.keys(players).length;

        if (!multi.maxPlayers || count < multi.maxPlayers) return;

        try {
            const result = await runTransaction(ref(db, `rooms/${multi.roomId}/state`), (current) => {
                if (current === "waiting") return "playing";
                return;
            });

            if (result.committed) {
                triggerMultiStartCountdown();
            }
        } catch (err) {
            console.warn("自動開始処理に失敗しました", err);
        }
    });
}

function renderRoomWaitPlayers(players) {
    roomWaitEls.players.innerHTML = "";
    Object.entries(players).forEach(([id, p]) => {
        const row = document.createElement("div");
        row.className = "room-player-row";
        row.textContent = id === multi.playerId ? `${p.name}（あなた）` : p.name;
        roomWaitEls.players.appendChild(row);
    });
}

roomWaitEls.leaveBtn.addEventListener("click", leaveRoom);

async function leaveRoom() {
    if (multi.roomId && multi.playerId) {
        try {
            await remove(ref(db, `rooms/${multi.roomId}/players/${multi.playerId}`));
            await runTransaction(ref(db, `rooms/${multi.roomId}/playerCount`), (current) =>
                Math.max((current || 1) - 1, 0)
            );
        } catch (err) {
            console.warn(err);
        }
    }
    multiUnwatchAll();
    multi.roomId = null;
    multi.playerId = null;
    multi.maxPlayers = null;
    showScreen("title");
}

let currentRoundId = null;
let currentRoundIsCorrectWord = false;
let lastProcessedWinnerId = null;

function enterMultiPlayScreen() {
    multi.penaltyUntil = 0;
    lastProcessedWinnerId = null;
    resetFeedback(multiPlayEls.feedback, multiPlayEls.stage);
    setWordTextWithAnimation(multiPlayEls.wordText, "");
    multiPlayEls.penaltyText.textContent = "";

    if (multi.lastPlayersData) {
        renderMultiScoreboard(multiPlayEls.scoreboard, multi.lastPlayersData);
    }

    showScreen("multiPlay");
    updateMultiPenaltyDisplay();
}

function updateMultiPenaltyDisplay() {
    if (!screens.multiPlay.classList.contains("is-active")) return;

    const now = Date.now();
    if (multi.penaltyUntil > now) {
        const remainingSec = ((multi.penaltyUntil - now) / 1000).toFixed(2);
        multiPlayEls.penaltyText.textContent = `お手つき！ペナルティ ${remainingSec}秒！`;
    } else {
        multiPlayEls.penaltyText.textContent = "";
    }

    multi.penaltyAnimFrameId = requestAnimationFrame(updateMultiPenaltyDisplay);
}

function triggerMultiStartCountdown() {
    if (!multi.roomId || !multi.isHost) return;

    window.setTimeout(() => {
        startNextMultiScoreRound();
    }, 1500);
}

async function startNextMultiScoreRound() {
    if (!multi.roomId || !multi.isHost) return;

    const newLevel = Math.floor(Math.random() * 3) + 2;
    await set(ref(db, `rooms/${multi.roomId}/currentDifficulty`), newLevel);
    scheduleNextMultiWord(newLevel, true);
}

async function scheduleNextMultiWord(level, isNewRound = false) {
    if (!multi.roomId || !multi.isHost) return;

    if (multi.hostLoopTimeoutId) {
        window.clearTimeout(multi.hostLoopTimeoutId);
        multi.hostLoopTimeoutId = null;
    }

    const { word, isCorrect } = pickWord(level);
    const interval = pickInterval(level);

    try {
        const roundIdToSet = isNewRound ? Date.now() : (currentRoundId || Date.now());

        if (isNewRound) {
            await set(ref(db, `rooms/${multi.roomId}/round`), {
                roundId: roundIdToSet,
                difficultyLevel: level,
                word: word,
                isCorrect: isCorrect,
                winnerId: null,
                winnerName: null,
                updatedAt: Date.now()
            });
        } else {
            // 現在の単語のみをシンプルにセット（競合防止）
            const snap = await get(ref(db, `rooms/${multi.roomId}/round/winnerId`));
            if (!snap.val()) {
                await set(ref(db, `rooms/${multi.roomId}/round/word`), word);
                await set(ref(db, `rooms/${multi.roomId}/round/isCorrect`), isCorrect);
                await set(ref(db, `rooms/${multi.roomId}/round/updatedAt`), Date.now());
            }
        }

        multi.hostLoopTimeoutId = window.setTimeout(() => {
            scheduleNextMultiWord(level, false);
        }, interval);

    } catch (err) {
        console.warn("マルチワード進行に失敗しました", err);
    }
}

function handleRoundUpdate(round) {
    if (!round) return;

    const isRoundChanged = round.roundId !== currentRoundId;
    currentRoundId = round.roundId;

    const settings = DIFFICULTY_SETTINGS[round.difficultyLevel] || DIFFICULTY_SETTINGS[2];
    multiPlayEls.difficultyBadge.textContent = settings.name;

    // --- 勝者が決定した場合の一元処理 ---
    if (round.winnerId) {
        if (round.winnerId === lastProcessedWinnerId) return;
        lastProcessedWinnerId = round.winnerId;

        if (multi.hostLoopTimeoutId) {
            window.clearTimeout(multi.hostLoopTimeoutId);
            multi.hostLoopTimeoutId = null;
        }

        if (round.winnerId === multi.playerId) {
            playSound("correct");
            triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "good", "〇 せいかい！");
        } else {
            playSound("miss");
            const winnerName = round.winnerName || "相手";
            triggerFeedback(
                multiPlayEls.flash,
                multiPlayEls.feedback,
                multiPlayEls.stage,
                "bad",
                `✕ ${winnerName} にとられた！`
            );
        }

        // ホストがスコアのチェックと次ラウンド／終了画面への進行を制御
        if (multi.isHost) {
            window.setTimeout(async () => {
                const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
                const playersData = playersSnap.val() || {};
                const hasWinner = Object.values(playersData).some((p) => (p.score || 0) >= WIN_SCORE);

                if (hasWinner) {
                    await set(ref(db, `rooms/${multi.roomId}/state`), "finished");
                } else {
                    startNextMultiScoreRound();
                }
            }, EFFECT_WAIT_MS);
        }
        return;
    }

    currentRoundIsCorrectWord = !!round.isCorrect;
    const displayWord = round.word || CORRECT_WORD;

    setWordTextWithAnimation(multiPlayEls.wordText, displayWord);
    playSound("word");
}

function renderMultiScoreboard(targetEl, players) {
    if (!targetEl) return;
    targetEl.innerHTML = "";
    Object.entries(players)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
        .forEach(([id, p]) => {
            const pill = document.createElement("div");
            pill.className = "score-pill" + (id === multi.playerId ? " is-me" : "");
            pill.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="score-value">${p.score || 0}</span>`;
            targetEl.appendChild(pill);
        });
}

// 即時レスポンス＆アトミック判定の決定版ロジック
multiPlayEls.wordBlob.addEventListener("click", async () => {
    if (!multi.roomId || !currentRoundId) return;

    if (Date.now() < multi.penaltyUntil) return;

    const currentWordText = multiPlayEls.wordText.textContent;
    if (!currentWordText || currentWordText === "れでぃ？" || currentWordText === "ごー！") return;

    const isCorrectTap = currentRoundIsCorrectWord;

    if (!isCorrectTap) {
        multi.penaltyUntil = Date.now() + 5000;
        playSound("miss");
        triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "bad", "✕ お手つき！(5秒ストップ)");
        return;
    }

    // 1. まず自画面で最速レスポンス（演出）を即座に出す
    playSound("correct");
    triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "good", "〇 せいかい！");

    // 2. 最軽量の winnerId フィールドのみをアトミックに獲得申請
    try {
        const claim = await runTransaction(
            ref(db, `rooms/${multi.roomId}/round/winnerId`),
            (current) => {
                if (current) return; // 既に獲得者あり
                return multi.playerId;
            }
        );

        if (claim.committed) {
            // 先着成功：勝者名とスコア加算の書き込み
            await set(ref(db, `rooms/${multi.roomId}/round/winnerName`), multi.playerName);
            await runTransaction(
                ref(db, `rooms/${multi.roomId}/players/${multi.playerId}/score`),
                (current) => (current || 0) + 1
            );
        }
    } catch (err) {
        console.warn("判定処理に失敗しました", err);
    }
});

function enterMultiResultScreen() {
    multiUnwatchAll();
    playSound("win");

    multiResultEls.ranking.innerHTML = "";
    const sortedPlayers = Object.entries(multi.lastPlayersData)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    const winnerEntry = sortedPlayers[0];
    if (winnerEntry) {
        const [winnerId, winnerData] = winnerEntry;
        multiResultEls.title.textContent =
            winnerId === multi.playerId ? "🎉 あなたの勝ち！" : `🎉 ${winnerData.name} の勝ち！`;
    }

    sortedPlayers.forEach(([id, p], idx) => {
        const li = document.createElement("li");
        if (idx === 0) li.classList.add("rank-1");
        const isMe = id === multi.playerId ? "（あなた）" : "";
        li.innerHTML = `
            <span>${idx + 1}位: ${escapeHtml(p.name)}${isMe}</span>
            <span class="res-score">${p.score || 0}pt</span>
        `;
        multiResultEls.ranking.appendChild(li);
    });

    showScreen("multiResult");
}

multiResultEls.toTitleBtn.addEventListener("click", async () => {
    if (multi.roomId && multi.playerId) {
        try {
            await remove(ref(db, `rooms/${multi.roomId}/players/${multi.playerId}`));
        } catch (err) {}
    }
    multiUnwatchAll();
    multi.roomId = null;
    multi.playerId = null;
    multi.maxPlayers = null;
    multi.lastPlayersData = {};
    currentRoundId = null;
    showScreen("title");
});

// ========================================
// 初期化
// ========================================

function applyRoomIdFromUrl() {
    const params = new URLSearchParams(location.search);
    const roomIdFromUrl = params.get("room");
    if (!roomIdFromUrl) return;

    const normalized = roomIdFromUrl.trim().toUpperCase().slice(0, 6);

    multiSetupEls.errorText.classList.add("is-hidden");
    const stored = getStoredPlayerName();
    if (stored) multiSetupEls.nameInput.value = stored;
    multiSetupEls.roomIdInput.value = normalized;
    showScreen("multiSetup");

    const cleanUrl = location.origin + location.pathname;
    history.replaceState(null, "", cleanUrl);
}

function init() {
    console.log("うんちスピードスター initialized");
    showScreen("title");
    applyRoomIdFromUrl();
}

document.addEventListener("DOMContentLoaded", init);