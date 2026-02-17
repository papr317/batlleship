let DATABASE = [];
let activeTeam = 1,
  scores = { 1: 0, 2: 0 };
let ships = { 1: [], 2: [] };
let isProcessing = false,
  timerId = null,
  timeLeft = 120;
let gameTimerId = null,
  gameTimeLeft = 1800; // 30 минут = 1800 секунд
let gameStartTime = null; // Время начала игры
let currentQuestionData = null;
let usedQuestions = new Set();
let embargoList = {};
let embargoTimers = {};
let selectedAnswer = null; // Для отслеживания выбранного варианта
let revealedCells = {}; // { 't1-c5': 'hit'|'miss'|'error'|'sunk' }
let modalTimeExpiredHandled = false;
const GRID_SIZE = 9;
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З'];
const SHIP_CONFIG = [5, 4, 3, 3, 2];

// ПУТИ К МЕДИА
const GIFS_HIT = ['media/попадание.png', 'media/попадание2.png'];
const GIF_MISS = 'media/мимо.png';
const SINK_OPTIONS = [
  'media/тонет.jpg',
  'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHJueGZ4bmZ4bmZ4bmZ4bmZ4bmZ4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/XUFPGrX5Zis6Y/giphy.gif',
];
const ICON_COMPASS = 'media/compass.png';
const ICON_TELESCOPE = 'media/подзорная_труба.png';
const SOUND_SINK = 'media/крушение.mp3';

// 1. Загрузка CSV (с учетом твоего нового формата: id;q;img;ans;opt1...)
async function loadQuestions() {
  try {
    console.log('📂 Загрузка вопросов из CSV...');
    const response = await fetch('questions.csv');
    if (!response.ok) throw new Error('Файл не найден');
    const text = await response.text();
    const lines = text.split(/\r?\n/);
    DATABASE = [];
    for (let i = 1; i < lines.length; i++) {
      let p = lines[i].split(';').map((el) => el.trim());
      if (p.length >= 9) {
        DATABASE.push({
          id: p[0],
          q: p[1],
          img: p[2],
          a: p[3], // Правильный ответ текстом
          options: [p[4], p[5], p[6], p[7], p[8]],
          hint: p[9] || '',
        });
      }
    }
    console.log(`✅ Загружено ${DATABASE.length} вопросов`);
    loadGameState(); // Пробуем загрузить кэш
    return true;
  } catch (e) {
    console.error('❌ Ошибка загрузки:', e);
    return false;
  }
}

// 2. Инициализация игры
async function init() {
  console.log('🎮 =====  ИНИЦИАЛИЗАЦИЯ ИГРЫ  =====');
  console.log('🎮 МОРСКОЙ БОЙ: АЛГЕБРА 9 КЛАСС');
  console.log('=============================');
  await loadQuestions();
  console.log('🛢️ Создание игровых полей...');
  createGrid('grid1', 1);
  createGrid('grid2', 2);

  // После создания сеток восстанавливаем визуальное состояние из кэша (если есть)
  restoreVisualState();

  // Новая конфигурация: 1x5, 1x4, 2x3, 1x2 (итого 5 кораблей)
  if (ships[1].length === 0) {
    ships[1] = generateFleet([5, 4, 3, 3, 2]);
    console.log(`⚓ Флот СИНЕГО: ${ships[1].length} кораблей размещены`);
  }
  if (ships[2].length === 0) {
    ships[2] = generateFleet([5, 4, 3, 3, 2]);
    console.log(`⚓ Флот КРАСНОГО: ${ships[2].length} кораблей размещены`);
  }

  updateFieldVisuals();
  updateUI();
  startTimer();
  startGameTimer(); // Запуск таймера на 30 минут для всей игры
  setInterval(checkEmbargo, 1000); // Проверка блокировок каждую секунду
  console.log('✅ ИГРА НАЧАТА!');
}

// 3. Создание сетки 9х9
function createGrid(id, teamNum) {
  const grid = document.getElementById(id);
  grid.style.gridTemplateColumns = `30px repeat(${GRID_SIZE}, 45px)`;
  grid.innerHTML = '<div></div>';

  LETTERS.forEach((l) => {
    const d = document.createElement('div');
    d.className = 'label';
    d.innerText = l;
    grid.appendChild(d);
  });

  for (let r = 1; r <= GRID_SIZE; r++) {
    const l = document.createElement('div');
    l.className = 'label';
    l.innerText = r;
    grid.appendChild(l);
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = (r - 1) * GRID_SIZE + c;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `t${teamNum}-c${idx}`;
      cell.onclick = () => makeShot(teamNum, idx);
      grid.appendChild(cell);
    }
  }
}

// 4. Генерация флота (без 1-палубников)
function generateFleet(config) {
  let fleet = [];
  config.forEach((size) => {
    let placed = false;
    while (!placed) {
      let isVert = Math.random() > 0.5;
      let r = Math.floor(Math.random() * GRID_SIZE);
      let c = Math.floor(Math.random() * GRID_SIZE);
      let coords = [];
      for (let i = 0; i < size; i++) {
        let rr = isVert ? r + i : r,
          cc = isVert ? c : c + i;
        if (rr < GRID_SIZE && cc < GRID_SIZE) coords.push(rr * GRID_SIZE + cc);
      }
      let busy = fleet.flatMap((s) => s.coords);
      if (coords.length === size && coords.every((idx) => !busy.includes(idx))) {
        fleet.push({ coords, hits: 0, sunk: false });
        placed = true;
      }
    }
  });
  return fleet;
}

// 5. Выстрел
function makeShot(targetTeam, idx) {
  const cellId = `t${targetTeam}-c${idx}`;
  // Человеко-читаемая координата, например А1
  const col = idx % GRID_SIZE;
  const row = Math.floor(idx / GRID_SIZE) + 1;
  const coord = `${LETTERS[col]}${row}`;
  console.log(
    `🎯 ВЫСТРЕЛ по клетке ${cellId} (коорд ${coord}) — команда ${activeTeam} стреляет в команду ${targetTeam}`,
  );

  // Проверяем эмбарго перед тем как открывать модалку
  if (isEmbargoed(cellId)) {
    console.log(`⛔ Клетка ${cellId} заблокирована ЭМБАРГО!`);
    showEmbargoTimer(cellId);
    return;
  }

  if (isProcessing) {
    console.log('⚠️ Уже идёт обработка хода');
    return;
  }
  if (activeTeam === targetTeam) {
    console.log('⚠️ Нельзя стрелять по своему полю!');
    return;
  }

  const cell = document.getElementById(cellId);
  if (cell.classList.contains('revealed')) {
    console.log(`⚠️ Клетка ${cellId} уже была раскрыта`);
    return;
  }

  isProcessing = true;
  window.currentShot = { targetTeam, idx };

  // Выбор уникального вопроса
  let available = DATABASE.filter((q) => !usedQuestions.has(q.id));
  if (available.length === 0) {
    usedQuestions.clear();
    available = DATABASE;
  }
  currentQuestionData = available[Math.floor(Math.random() * available.length)];
  usedQuestions.add(currentQuestionData.id);

  // Отображение ID вопроса
  document.getElementById('question-id').innerText = currentQuestionData.id;
  // Логируем ID вопроса и оставшееся время при выстреле
  console.log(`🆔 Вопрос ID=${currentQuestionData.id}`);
  console.log(
    `⏱️ Оставшееся время хода: ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`,
  );
  // Сброс флага обработки истечения времени для новой модалки
  modalTimeExpiredHandled = false;
  // Сброс подсказки (включаем кнопку и прячем блок подсказки)
  const hintBox = document.getElementById('hint-box');
  const hintBtn = document.getElementById('btn-hint');
  if (hintBox) hintBox.style.display = 'none';
  if (hintBtn) hintBtn.disabled = false;

  // Вопрос
  document.getElementById('q-text').innerText = currentQuestionData.q;
  document.getElementById('answer-box').innerText = 'ОТВЕТ: ' + currentQuestionData.a;

  // Сброс модалки
  selectedAnswer = null;
  document.getElementById('options-box').style.display = 'none';
  document.getElementById('options-list').innerHTML = '';
  document.getElementById('answer-box').style.display = 'none';
  document.getElementById('btn-options').style.display = 'block';
  // Восстанавливаем видимость кнопки ПОКАЗАТЬ ОТВЕТ и скрываем ручную оценку
  const btnReveal = document.getElementById('btn-reveal');
  if (btnReveal) btnReveal.style.display = 'block';
  const revealJudgement = document.getElementById('reveal-judgement');
  if (revealJudgement) revealJudgement.style.display = 'none';
  document.getElementById('btn-check').disabled = true;
  // Синхронизируем таймер модалки с основным таймером
  const mt = document.getElementById('modal-timer');
  if (mt)
    mt.innerText = `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`;
  document.getElementById('modal').style.display = 'flex';
}

function checkAnswer() {
  if (!selectedAnswer || !currentQuestionData) {
    console.warn('⚠️ Выберите вариант ответа!');
    return;
  }
  console.log(
    `🔍 Проверка ответа: выбран "${selectedAnswer}", правильный: "${currentQuestionData.a}"`,
  );

  // Сравниваем выбранный ответ с правильным
  const isCorrect =
    selectedAnswer.trim().toLowerCase() === currentQuestionData.a.trim().toLowerCase();

  console.log(`${isCorrect ? '✅ ВЕРНЫЙ' : '❌ НЕВЕРНЫЙ'} ОТВЕТ!`);

  document.getElementById('btn-check').disabled = true;
  // Используем общую обработку результата
  resolveShot(isCorrect);
}

function markSunk(team, ship) {
  ship.coords.forEach((idx) => {
    const c = document.getElementById(`t${team}-c${idx}`);
    c.classList.remove('hit');
    c.classList.add('sunk'); // Черный цвет в CSS
  });
}

// 6. Таймер и Кэш
function startTimer() {
  if (timerId) clearInterval(timerId);
  timeLeft = 120;
  timerId = setInterval(() => {
    timeLeft--;
    document.getElementById('timer').innerText =
      `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`;
    // Если открыта модалка вопроса — синхронизируем её таймер и обрабатываем окончание
    const modal = document.getElementById('modal');
    if (modal && modal.style.display === 'flex') {
      const mt = document.getElementById('modal-timer');
      if (mt)
        mt.innerText = `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`;
      if (timeLeft <= 0 && !modalTimeExpiredHandled) {
        modalTimeExpiredHandled = true;
        // Сообщение пользователю и логирование ID примера
        document.getElementById('m-header').innerText = '⏱️ ВРЕМЯ ИСТЕКЛО';
        if (currentQuestionData && currentQuestionData.id) {
          console.log(`⏱️ Время истекло для вопроса ID=${currentQuestionData.id}`);
        } else {
          console.log('⏱️ Время истекло (вопрос не определён)');
        }
        // Показываем подсказку/ответ в модалке (если нужно) и затем закрываем через 2s
        const answerBox = document.getElementById('answer-box');
        if (answerBox && currentQuestionData) {
          answerBox.innerText = 'ВРЕМЯ ИСТЕКЛО. ОТВЕТ: ' + currentQuestionData.a;
          answerBox.style.display = 'block';
        }
        setTimeout(() => {
          modal.style.display = 'none';
          document.getElementById('media-placeholder').style.display = 'none';
          document.getElementById('m-header').innerText = 'ОГНЕВОЙ КОНТАКТ';
          isProcessing = false;
          switchTurn();
        }, 2000);
      }
    } else {
      if (timeLeft <= 0) switchTurn();
    }
  }, 1000);
}

// Таймер на 30 минут для всей игры
function startGameTimer() {
  if (gameTimerId) clearInterval(gameTimerId);

  // Если игра только начинается, сохраняем время начала
  if (!gameStartTime) {
    gameStartTime = Date.now();
    gameTimeLeft = 1800; // 30 минут в секундах
  }

  gameTimerId = setInterval(() => {
    gameTimeLeft--;

    // Сохраняем состояние таймера через каждые 5 секунд
    if (gameTimeLeft % 5 === 0) {
      saveGameState();
    }

    // Обновляем отображение таймера игры
    const minutes = Math.floor(gameTimeLeft / 60);
    const seconds = gameTimeLeft % 60;
    document.getElementById('game-timer').innerText =
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Когда время истекает, показываем окно с поздравлением
    if (gameTimeLeft <= 0) {
      clearInterval(gameTimerId);
      endGameByTime();
    }
  }, 1000);
}

// Функция для завершения игры по истечении времени
function endGameByTime() {
  console.log('🎉 ВРЕМЯ ИГРЫ ИСТЕКЛО!');
  console.log(`📊 ФИНАЛЬНЫЕ БАЛЛЫ - СИНИЙ ФЛОТ: ${scores[1]}, КРАСНЫЙ ФЛОТ: ${scores[2]}`);

  // Останавливаем основной таймер
  clearInterval(timerId);

  // Отображаем финальные очки в модальном окне
  document.getElementById('game-over-s1').innerText = scores[1];
  document.getElementById('game-over-s2').innerText = scores[2];

  // Определяем сообщение о победителе
  let winnerMessage = '';
  if (scores[1] > scores[2]) {
    winnerMessage = 'СИНИЙ ФЛОТ одержал победу!';
  } else if (scores[2] > scores[1]) {
    winnerMessage = 'КРАСНЫЙ ФЛОТ одержал победу!';
  } else {
    winnerMessage = 'Ничья!';
  }
  document.getElementById('game-over-message').innerText = winnerMessage;

  // Очищаем сохраненное состояние игры
  clearSavedState();

  // Показываем модальное окно с поздравлением
  document.getElementById('game-over-modal').style.display = 'flex';
}

function setEmbargo(cellId) {
  console.log(`🚫 ЭМБАРГО установлено на клетку ${cellId} на 5 минут`);
  embargoList[cellId] = Date.now() + 5 * 60 * 1000; // 5 минут
  // Запускаем пер-клеточный таймер отображения оставшегося времени
  startEmbargoTimer(cellId);
  // Показываем модальное окно эмбарго сразу
  showEmbargoModal(cellId);
  saveGameState();
}

function showEmbargoModal(cellId) {
  // Эмбарго теперь отображается только бейджем на самой клетке.
  // Для обратной совместимости просто логируем попытки открыть модалку.
  console.log(
    `⛔ Попытка открыть модалку эмбарго для ${cellId} — модалка отключена, показывается бейдж на клетке.`,
  );
}

function startEmbargoTimer(cellId) {
  // Очищаем старый интервал
  if (embargoTimers[cellId]) {
    clearInterval(embargoTimers[cellId]);
  }

  const cell = document.getElementById(cellId);
  if (!cell) return;
  cell.classList.add('embargo');

  // Создаём бейдж для таймера внутри клетки
  let badge = cell.querySelector('.embargo-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'embargo-badge';
    badge.style.cssText =
      'position:absolute; top:2px; right:2px; background:#c62828; color:#fff; padding:2px 6px; border-radius:6px; font-size:10px; z-index:5;';
    cell.style.position = 'relative';
    cell.appendChild(badge);
  }

  const tick = () => {
    const remaining = Math.max(0, (embargoList[cellId] || 0) - Date.now());
    if (remaining <= 0) {
      clearInterval(embargoTimers[cellId]);
      delete embargoTimers[cellId];
      delete embargoList[cellId];
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      cell.classList.remove('embargo');
      // Когда эмбарго окончено — делаем клетку снова активной для нового вопроса.
      cell.classList.remove('revealed', 'error', 'hit', 'miss', 'sunk');
      cell.innerText = '';
      // Удаляем запись об этой клетке в revealedCells, чтобы при следующем клике выбрался новый вопрос
      delete revealedCells[cellId];
      saveGameState();
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    badge.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Немедленный вызов и интервал
  tick();
  embargoTimers[cellId] = setInterval(tick, 1000);
}

function isEmbargoed(cellId) {
  if (!embargoList[cellId]) return false;

  const remaining = embargoList[cellId] - Date.now();
  if (remaining <= 0) {
    delete embargoList[cellId];
    return false;
  }

  // Если попытались нажать на заблокированную клетку - показываем модалку
  return true;
}

// Показать таймер эмбарго при попытке нажать на заблокированную клетку
function showEmbargoTimer(cellId) {
  // Показываем краткое уведомление в заголовке модалки и логируем; основной таймер виден на клетке.
  if (!embargoList[cellId]) return;
  const remaining = Math.max(0, embargoList[cellId] - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const msg = `⛔ Клетка заблокирована: ${minutes}:${seconds.toString().padStart(2, '0')}`;
  console.log(msg + ` (cell=${cellId})`);
  // Покажем сообщение в модалке действий (временное) — если она открыта
  const mh = document.getElementById('m-header');
  const prev = mh ? mh.innerText : null;
  if (mh) mh.innerText = msg;
  setTimeout(() => {
    if (mh && prev) mh.innerText = prev;
  }, 2500);
}

function checkEmbargo() {
  for (let id in embargoList) {
    const cell = document.getElementById(id);
    if (cell && Date.now() < embargoList[id]) {
      cell.classList.add('embargo');
    } else if (cell) {
      cell.classList.remove('embargo');
    }
  }
}

function saveGameState() {
  const data = {
    scores,
    ships,
    activeTeam,
    usedQuestions: Array.from(usedQuestions),
    embargoList,
    revealedCells,
    gameTimeLeft,
    gameStartTime,
  };
  // Сохраняем в localStorage
  try {
    localStorage.setItem('navy_battle_save', JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage write failed', e);
  }
  // Сохраняем в cookie (на 7 дней)
  try {
    const v = encodeURIComponent(JSON.stringify(data));
    const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `navy_battle_save=${v}; expires=${exp}; path=/`;
  } catch (e) {
    console.warn('cookie write failed', e);
  }
}

function loadGameState() {
  // Сначала пробуем localStorage
  let saved = null;
  try {
    saved = localStorage.getItem('navy_battle_save');
  } catch (e) {
    console.warn('localStorage read failed', e);
  }
  // Если нет, пробуем cookie
  if (!saved) {
    const m = document.cookie.match(/(?:^|; )navy_battle_save=([^;]+)/);
    if (m) {
      try {
        saved = decodeURIComponent(m[1]);
      } catch (e) {
        console.warn('cookie decode failed', e);
      }
    }
  }
  if (saved) {
    try {
      const data = JSON.parse(saved);
      scores = data.scores || scores;
      ships = data.ships || ships;
      activeTeam = data.activeTeam || activeTeam;
      usedQuestions = new Set(data.usedQuestions || []);
      embargoList = data.embargoList || {};
      revealedCells = data.revealedCells || {};

      // Восстанавливаем состояние таймера игры
      if (data.gameTimeLeft !== undefined && data.gameStartTime !== undefined) {
        const elapsed = Math.floor((Date.now() - data.gameStartTime) / 1000);
        gameTimeLeft = Math.max(0, data.gameTimeLeft - elapsed);
        gameStartTime = data.gameStartTime;
        console.log(
          `⏱️ Восстановлен таймер игры: ${Math.floor(gameTimeLeft / 60)}:${(gameTimeLeft % 60).toString().padStart(2, '0')}`,
        );
      }
    } catch (e) {
      console.warn('Failed to parse saved state', e);
    }
  }
}

function restoreVisualState() {
  // Применяем визуальные классы к клеткам из сохранённого состояния
  try {
    // Сначала очистим все состояния
    for (let t = 1; t <= 2; t++) {
      for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const el = document.getElementById(`t${t}-c${i}`);
        if (!el) continue;
        el.classList.remove('hit', 'miss', 'error', 'sunk', 'revealed', 'embargo');
        el.innerText = '';
      }
    }

    // Восстановим revealedCells
    for (const key in revealedCells) {
      const el = document.getElementById(key);
      if (!el) continue;
      const st = revealedCells[key];
      el.classList.add('revealed');
      if (st === 'hit') {
        el.classList.add('hit');
        el.innerText = '💥';
      } else if (st === 'miss') {
        el.classList.add('miss');
        el.innerText = '•';
      } else if (st === 'error') {
        el.classList.add('error');
        el.innerText = '❌';
      } else if (st === 'sunk') {
        el.classList.add('sunk');
        el.innerText = '';
      }
    }

    // Восстановим эмбарго
    for (const id in embargoList) {
      const el = document.getElementById(id);
      if (el) el.classList.add('embargo');
      // Запускаем пер-клеточный таймер для оставшегося эмбарго
      startEmbargoTimer(id);
    }
  } catch (e) {
    console.warn('restoreVisualState failed', e);
  }
}

function clearSavedState() {
  // Очищаем переменную таймера игры
  gameStartTime = null;
  gameTimeLeft = 1800;

  try {
    localStorage.removeItem('navy_battle_save');
  } catch (e) {
    console.warn('localStorage clear failed', e);
  }
  try {
    // Удаляем cookie, установив истёкшую дату
    document.cookie = 'navy_battle_save=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  } catch (e) {
    console.warn('cookie clear failed', e);
  }
  console.log('🧹 Сохранение игры очищено (кэш очищен)');
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ) ---

function showOptions() {
  if (!currentQuestionData) {
    console.warn('⚠️ Нет текущего вопроса');
    return;
  }
  console.log(`📋 Показываем варианты ответа для вопроса ID=${currentQuestionData.id}`);

  const optBox = document.getElementById('options-box');
  const optList = document.getElementById('options-list');
  const letters = ['А', 'Б', 'В', 'Г', 'Д'];

  // Создаем кнопки для каждого варианта
  let html = '';
  currentQuestionData.options.forEach((opt, i) => {
    if (opt && opt !== '') {
      html += `<button class="btn btn-option" onclick="selectAnswer('${opt.replace(/'/g, "\\'")}')"
        style="
          background: #424242; color: white; padding: 12px; text-align: left; border-radius: 8px;
          cursor: pointer; transition: 0.3s; border: none; font-size: 14px; width: 100%;
          font-family: 'Segoe UI', sans-serif; font-weight: bold; display: flex; align-items: center; gap: 8px;
        ">
        <img src="${ICON_COMPASS}" alt="🧭" style="width:16px; height:16px;"><strong>${letters[i]})</strong> ${opt}
      </button>`;
    }
  });

  optList.innerHTML = html;
  optBox.style.display = 'block';
  document.getElementById('btn-options').style.display = 'none';
  // Скрываем judgement кнопки если были показаны
  const revealJudgement = document.getElementById('reveal-judgement');
  if (revealJudgement) revealJudgement.style.display = 'none';

  scores[activeTeam] -= 5;
  console.log(`💸 Отнято 5 очков за показ вариантов. Баллы: ${scores[activeTeam]}`);
  showPointAnim(-5);
  saveGameState();
  updateUI();
}

// Обработка ручной оценки при показе ответа (ВЕРНО / НЕВЕРНО)
function handleReveal(isCorrect) {
  console.log(`🧾 Ручная проверка: ${isCorrect ? 'ВЕРНО' : 'НЕВЕРНО'}`);
  // Скрываем judgement кнопки
  const revealJudgement = document.getElementById('reveal-judgement');
  if (revealJudgement) revealJudgement.style.display = 'none';
  // Перейти к стандартной обработке результата
  resolveShot(isCorrect);
}

// Универсальная логика обработки попадания/ошибки
function resolveShot(isCorrect) {
  const { targetTeam, idx } = window.currentShot || {};
  if (typeof targetTeam === 'undefined') return;
  const cell = document.getElementById(`t${targetTeam}-c${idx}`);
  const ship = ships[targetTeam].find((s) => s.coords.includes(idx));
  const imgElement = document.getElementById('explosion-gif');
  const placeholder = document.getElementById('media-placeholder');

  if (cell) cell.classList.add('revealed');
  // Сохраняем визуальное состояние для восстановления после перезагрузки
  const cellKey = `t${targetTeam}-c${idx}`;
  let p = isCorrect ? 10 : -5;

  if (isCorrect) {
    if (ship) {
      ship.hits++;
      p += 10;
      cell.classList.add('hit');
      cell.innerText = '💥';
      revealedCells[cellKey] = 'hit';
      placeholder.style.display = 'block';

      if (ship.hits === ship.coords.length) {
        p += 15;
        ship.sunk = true;
        markSunk(targetTeam, ship);
        // Отметим все клетки корабля как потопленные в кеше
        ship.coords.forEach((ci) => (revealedCells[`t${targetTeam}-c${ci}`] = 'sunk'));
        document.getElementById('m-header').innerText = 'КОРАБЛЬ УНИЧТОЖЕН! (+35)';
        // Воспроизводим новый звук потопления
        if (document.getElementById('snd-sink')) {
          document.getElementById('snd-sink').play();
        } else if (document.getElementById('snd-hit')) {
          document.getElementById('snd-hit').play();
        }
        const randomSink = SINK_OPTIONS[Math.floor(Math.random() * SINK_OPTIONS.length)];
        imgElement.src = randomSink + '?t=' + Math.random();
      } else {
        document.getElementById('m-header').innerText = 'ЕСТЬ ПРОБИТИЕ! (+20)';
        if (document.getElementById('snd-hit')) document.getElementById('snd-hit').play();
        imgElement.src = GIFS_HIT[Math.floor(Math.random() * GIFS_HIT.length)];
      }
    } else {
      if (cell) cell.classList.add('miss');
      if (cell) cell.innerText = '•';
      revealedCells[cellKey] = 'miss';
      document.getElementById('m-header').innerText = 'МИМО! (Верно +10)';
      if (document.getElementById('snd-shot')) document.getElementById('snd-shot').play();
      imgElement.src = GIF_MISS;
      placeholder.style.display = 'block';
    }
  } else {
    if (cell) cell.innerText = '❌';
    if (cell) cell.classList.add('error');
    revealedCells[cellKey] = 'error';
    document.getElementById('m-header').innerText = 'ОШИБКА! (-5)';
    setEmbargo(`t${targetTeam}-c${idx}`);
  }

  scores[activeTeam] += p;
  console.log(
    `💰 ${p >= 0 ? '+' : ''}${p} очков. Всего у ФЛОТА ${activeTeam}: ${scores[activeTeam]}`,
  );
  showPointAnim(p);
  saveGameState();
  updateUI();

  const enemyTeam = activeTeam === 1 ? 2 : 1;
  const allSunk = ships[enemyTeam].every((s) => s.hits === s.coords.length);

  if (allSunk) {
    setTimeout(endGame, 2000);
  } else {
    setTimeout(finishMove, isCorrect ? 2500 : 1000);
  }
}

function selectAnswer(answer) {
  console.log(`📢 Выбран вариант ответа: "${answer}"`);
  selectedAnswer = answer;
  document.getElementById('btn-check').disabled = false;
  console.log('✅ Кнопка ПРОВЕРИТЬ ОТВЕТ активирована');
}

function showAnswer() {
  if (!currentQuestionData) {
    console.warn('⚠️ Нет текущего вопроса');
    return;
  }
  console.log(`📝 Показываем ответ: "${currentQuestionData.a}"`);
  const answerBox = document.getElementById('answer-box');
  answerBox.innerText = 'ОТВЕТ: ' + currentQuestionData.a;
  answerBox.style.display = 'block';

  // Показать кнопки ВЕРНО/НЕВЕРНО и скрыть другие
  const revealBtn = document.getElementById('btn-reveal');
  const optionsBtn = document.getElementById('btn-options');
  const revealJudgement = document.getElementById('reveal-judgement');
  if (revealBtn) revealBtn.style.display = 'none';
  if (optionsBtn) optionsBtn.style.display = 'none';
  if (revealJudgement) revealJudgement.style.display = 'flex';
  // Отключаем кнопку проверки мн. выборов
  const btnCheck = document.getElementById('btn-check');
  if (btnCheck) btnCheck.disabled = true;
  console.log('✅ Ответ отображён; показаны кнопки ВЕРНО/НЕВЕРНО');
}

function useHint() {
  if (!currentQuestionData) {
    console.warn('⚠️ Нет текущего вопроса для подсказки');
    return;
  }
  const hintBox = document.getElementById('hint-box');
  const btn = document.getElementById('btn-hint');
  if (!hintBox || !btn) return;
  if (hintBox.style.display === 'block') return; // уже использована

  const hint = currentQuestionData.hint || 'Подсказка отсутствует';
  hintBox.innerText = 'ПОДСКАЗКА: ' + hint;
  hintBox.style.display = 'block';

  // Снимаем 2.5 очка
  scores[activeTeam] = (scores[activeTeam] || 0) - 2.5;
  console.log(`💡 Подсказка показана. -2.5 очка. Баллы: ${scores[activeTeam]}`);
  btn.disabled = true;
  showPointAnim(-2.5);
  saveGameState();
  updateUI();
}

function showPointAnim(val) {
  const header = document.getElementById('m-header');
  const color = val > 0 ? '#b2ff59' : '#ff5252';
  const anim = document.createElement('div');
  anim.innerHTML = `<strong>${val > 0 ? '+' : ''}${val}</strong>`;
  anim.style.cssText = `color: ${color}; font-size: 45px; position: absolute; width: 100%; top: 20px; left: 0; animation: up 1s forwards; pointer-events: none; z-index: 10;`;
  header.appendChild(anim);
  setTimeout(() => anim.remove(), 1000);
}

function finishMove() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('media-placeholder').style.display = 'none';
  document.getElementById('m-header').innerText = 'ОГНЕВОЙ КОНТАКТ';
  isProcessing = false;
  switchTurn();
}

function switchTurn() {
  activeTeam = activeTeam === 1 ? 2 : 1;
  console.log(
    `🔄 Смена хода! Теперь ходит: ФЛОТ ${activeTeam === 1 ? 'СИНИЙ' : 'КРАСНЫЙ'} (${activeTeam})`,
  );
  console.log(`📊 Баллы - СИНИЙ: ${scores[1]}, КРАСНЫЙ: ${scores[2]}`);
  updateFieldVisuals();
  startTimer();
  // Сохраняем смену хода в кэше
  saveGameState();
}

function updateFieldVisuals() {
  const isT1 = activeTeam === 1;
  const banner = document.getElementById('turn-banner');
  banner.innerText = isT1 ? 'СЕЙЧАС ХОДИТ: СИНИЙ ФЛОТ' : 'СЕЙЧАС ХОДИТ: КРАСНЫЙ ФЛОТ';
  banner.style.background = isT1 ? '#0d47a1' : '#b71c1c';
  document.getElementById('cont1').classList.toggle('disabled-field', isT1);
  document.getElementById('cont2').classList.toggle('disabled-field', !isT1);
}

function updateUI() {
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 0.0001 ? String(Math.round(v)) : v.toFixed(1));
  document.getElementById('s1').innerText = fmt(scores[1] || 0);
  document.getElementById('s2').innerText = fmt(scores[2] || 0);
}

function endGame() {
  clearInterval(timerId);
  clearInterval(gameTimerId); // Останавливаем таймер игры
  console.log('🏁 КОНЕЦ ИГРЫ!');
  console.log(`📊 ФИНАЛЬНЫЕ БАЛЛЫ - СИНИЙ ФЛОТ: ${scores[1]}, КРАСНЫЙ ФЛОТ: ${scores[2]}`);
  const modal = document.getElementById('finish-modal');
  modal.style.display = 'flex';
  document.getElementById('final-s1').innerText = scores[1];
  document.getElementById('final-s2').innerText = scores[2];
  const winner =
    scores[1] > scores[2]
      ? 'СИНИЕ ПОБЕДИЛИ!'
      : scores[2] > scores[1]
        ? 'КРАСНЫЕ ПОБЕДИЛИ!'
        : 'НИЧЬЯ!';
  console.log(`🏆 ${winner}`);
  document.getElementById('winner-title').innerText = winner;
  // При завершении сражения очищаем кэш, чтобы при перезагрузке игра начиналась сначала.
  clearSavedState();
}

window.onload = init;
