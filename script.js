let DATABASE = [];
let activeTeam = 1,
  scores = { 1: 0, 2: 0 };
let ships = { 1: [], 2: [] };
let isProcessing = false,
  timerId = null,
  timeLeft = 120;
let currentQuestionData = null;
let usedQuestions = new Set(); // Для исключения повторов
let embargoList = {}; // Для блокировки клеток на 5 минут

const GRID_SIZE = 9;
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З'];

// ПУТИ К МЕДИА
const GIFS_HIT = ['media/попадание.png', 'media/попадание2.png'];
const GIF_MISS = 'media/мимо.png';
const SINK_OPTIONS = [
  'media/тонет.jpg',
  'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHJueGZ4bmZ4bmZ4bmZ4bmZ4bmZ4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/XUFPGrX5Zis6Y/giphy.gif',
];

// 1. Загрузка CSV (с учетом твоего нового формата: id;q;img;ans;opt1...)
async function loadQuestions() {
  try {
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
    loadGameState(); // Пробуем загрузить кэш
    return true;
  } catch (e) {
    console.error('Ошибка загрузки:', e);
    return false;
  }
}

// 2. Инициализация игры
async function init() {
  await loadQuestions();
  createGrid('grid1', 1);
  createGrid('grid2', 2);

  // Новая конфигурация: 1x5, 1x4, 2x3, 1x2 (итого 5 кораблей)
  if (ships[1].length === 0) ships[1] = generateFleet([5, 4, 3, 3, 2]);
  if (ships[2].length === 0) ships[2] = generateFleet([5, 4, 3, 3, 2]);

  updateFieldVisuals();
  updateUI();
  startTimer();
  setInterval(checkEmbargo, 1000); // Проверка блокировок каждую секунду
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

// 5. Выстрел и Эмбарго
function makeShot(targetTeam, idx) {
  const cellId = `t${targetTeam}-c${idx}`;
  if (isProcessing || activeTeam === targetTeam || isEmbargoed(cellId)) return;

  const cell = document.getElementById(cellId);
  if (cell.classList.contains('revealed')) return;

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

  document.getElementById('q-text').innerText = currentQuestionData.q;
  document.getElementById('answer-box').innerText = 'ОТВЕТ: ' + currentQuestionData.a;

  // Сброс модалки
  document.getElementById('options-box').style.display = 'none';
  document.getElementById('btn-options').style.display = 'block';
  document.getElementById('answer-box').style.display = 'none';
  document.getElementById('btn-reveal').style.display = 'block';
  document.getElementById('btn-y').disabled = document.getElementById('btn-n').disabled = true;
  document.getElementById('modal').style.display = 'flex';
}

function handleResult(isCorrect) {
  const { targetTeam, idx } = window.currentShot;
  const cell = document.getElementById(`t${targetTeam}-c${idx}`);
  const ship = ships[targetTeam].find((s) => s.coords.includes(idx));

  cell.classList.add('revealed');
  let points = isCorrect ? 10 : -5;

  if (isCorrect) {
    if (ship) {
      ship.hits++;
      points += 10;
      cell.classList.add('hit');
      if (ship.hits === ship.coords.length) {
        ship.sunk = true;
        points += 15;
        markSunk(targetTeam, ship);
      }
    } else {
      cell.classList.add('miss');
    }
  } else {
    cell.classList.add('error');
    setEmbargo(`t${targetTeam}-c${idx}`);
  }

  scores[activeTeam] += points;
  saveGameState();
  updateUI();
  setTimeout(() => {
    document.getElementById('modal').style.display = 'none';
    isProcessing = false;
    switchTurn();
  }, 2000);
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
    if (timeLeft <= 0) switchTurn();
  }, 1000);
}

function setEmbargo(cellId) {
  embargoList[cellId] = Date.now() + 5 * 60 * 1000;
}

function isEmbargoed(cellId) {
  return embargoList[cellId] && Date.now() < embargoList[cellId];
}

function checkEmbargo() {
  for (let id in embargoList) {
    const cell = document.getElementById(id);
    if (Date.now() < embargoList[id]) {
      cell.classList.add('embargo');
    } else {
      cell.classList.remove('embargo');
      delete embargoList[id];
    }
  }
}

function saveGameState() {
  const data = { scores, ships, activeTeam, usedQuestions: Array.from(usedQuestions), embargoList };
  localStorage.setItem('navy_battle_save', JSON.stringify(data));
}

function loadGameState() {
  const saved = localStorage.getItem('navy_battle_save');
  if (saved) {
    const data = JSON.parse(saved);
    scores = data.scores;
    ships = data.ships;
    activeTeam = data.activeTeam;
    usedQuestions = new Set(data.usedQuestions);
    embargoList = data.embargoList;
  }
}

function showOptions() {
  if (!currentQuestionData) return;

  const optBox = document.getElementById('options-box');
  const letters = ['А', 'Б', 'В', 'Г', 'Д'];

  let txt = 'ВАРИАНТЫ:\n';
  currentQuestionData.options.forEach((opt, i) => {
    if (opt && opt !== '') {
      txt += `${letters[i]}) ${opt}   `;
    }
  });

  optBox.innerText = txt;
  optBox.style.display = 'block';
  document.getElementById('btn-options').style.display = 'none';

  scores[activeTeam] -= 5;
  showPointAnim(-5);
  updateUI();
}

function makeShot(targetTeam, idx) {
  if (
    isProcessing ||
    (activeTeam === 1 && targetTeam !== 2) ||
    (activeTeam === 2 && targetTeam !== 1)
  )
    return;
  const cell = document.getElementById(`t${targetTeam}-c${idx}`);
  if (cell.classList.contains('revealed')) return;

  isProcessing = true;
  clearInterval(timerId);
  window.currentShot = { targetTeam, idx };

  // Выбираем случайный вопрос
  currentQuestionData = DATABASE[Math.floor(Math.random() * DATABASE.length)];

  document.getElementById('q-text').innerText = currentQuestionData.q;
  document.getElementById('answer-box').innerText = 'ОТВЕТ: ' + currentQuestionData.a;

  // Сброс окон
  document.getElementById('options-box').style.display = 'none';
  document.getElementById('btn-options').style.display = 'block';
  document.getElementById('answer-box').style.display = 'none';
  document.getElementById('btn-reveal').style.display = 'block';
  document.getElementById('btn-y').disabled = document.getElementById('btn-n').disabled = true;
  document.getElementById('modal').style.display = 'flex';
}

function handleResult(isCorrect) {
  document.getElementById('btn-y').disabled = true;
  document.getElementById('btn-n').disabled = true;

  const { targetTeam, idx } = window.currentShot;
  const cell = document.getElementById(`t${targetTeam}-c${idx}`);
  const ship = ships[targetTeam].find((s) => s.coords.includes(idx));
  const imgElement = document.getElementById('explosion-gif');
  const placeholder = document.getElementById('media-placeholder');

  cell.classList.add('revealed');
  let p = isCorrect ? 10 : -5;

  if (isCorrect) {
    if (ship) {
      ship.hits++;
      p += 10;
      cell.classList.add('hit');
      cell.innerText = '💥';
      placeholder.style.display = 'block';

      if (ship.hits === ship.coords.length) {
        p += 15;
        document.getElementById('m-header').innerText = 'КОРАБЛЬ УНИЧТОЖЕН! (+35)';
        if (document.getElementById('snd-hit')) document.getElementById('snd-hit').play();
        const randomSink = SINK_OPTIONS[Math.floor(Math.random() * SINK_OPTIONS.length)];
        imgElement.src = randomSink + '?t=' + Math.random();
      } else {
        document.getElementById('m-header').innerText = 'ЕСТЬ ПРОБИТИЕ! (+20)';
        if (document.getElementById('snd-hit')) document.getElementById('snd-hit').play();
        imgElement.src = GIFS_HIT[Math.floor(Math.random() * GIFS_HIT.length)];
      }
    } else {
      cell.classList.add('miss');
      cell.innerText = '•';
      document.getElementById('m-header').innerText = 'МИМО! (Верно)';
      if (document.getElementById('snd-shot')) document.getElementById('snd-shot').play();
      imgElement.src = GIF_MISS;
      placeholder.style.display = 'block';
    }
  } else {
    cell.innerText = '❌';
    document.getElementById('m-header').innerText = 'ОШИБКА! (-5)';
  }

  scores[activeTeam] += p;
  showPointAnim(p);
  updateUI();

  const enemyTeam = activeTeam === 1 ? 2 : 1;
  const allSunk = ships[enemyTeam].every((s) => s.hits === s.coords.length);

  if (allSunk) {
    setTimeout(endGame, 2000);
  } else {
    setTimeout(finishMove, isCorrect ? 2500 : 1000);
  }
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ) ---

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

function createGrid(id, teamNum) {
  const grid = document.getElementById(id);
  const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е','Ё', 'Ж', 'З'];
  grid.innerHTML = '<div></div>';
  letters.forEach((l) => {
    const d = document.createElement('div');
    d.className = 'label';
    d.innerText = l;
    grid.appendChild(d);
  });
  for (let r = 1; r <= 9; r++) {
    const l = document.createElement('div');
    l.className = 'label';
    l.innerText = r;
    grid.appendChild(l);
    for (let c = 0; c < 9; c++) {
      const idx = (r - 1) * 9 + c;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `t${teamNum}-c${idx}`;
      cell.onclick = () => makeShot(teamNum, idx);
      grid.appendChild(cell);
    }
  }
}

function generateFleet() {
  let fleet = [];
  [4, 3, 3, 2, 2, 1, 1].forEach((size) => {
    let placed = false;
    while (!placed) {
      let isVert = Math.random() > 0.5,
        r = Math.floor(Math.random() * 8),
        c = Math.floor(Math.random() * 8);
      let coords = [];
      for (let i = 0; i < size; i++) {
        let rr = isVert ? r + i : r,
          cc = isVert ? c : c + i;
        if (rr < 8 && cc < 8) coords.push(rr * 8 + cc);
      }
      let allBusy = fleet.flatMap((s) => s.coords);
      if (coords.length === size && coords.every((idx) => !allBusy.includes(idx))) {
        fleet.push({ coords, hits: 0 });
        placed = true;
      }
    }
  });
  return fleet;
}

function startTimer() {
  clearInterval(timerId);
  timeLeft = 120;
  timerId = setInterval(() => {
    timeLeft--;
    const display = document.getElementById('timer');
    const m = Math.floor(timeLeft / 60),
      s = timeLeft % 60;
    display.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
    if (timeLeft <= 0) switchTurn();
  }, 1000);
}

function switchTurn() {
  activeTeam = activeTeam === 1 ? 2 : 1;
  updateFieldVisuals();
  startTimer();
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
  document.getElementById('s1').innerText = scores[1];
  document.getElementById('s2').innerText = scores[2];
}

function revealAnswer() {
  document.getElementById('answer-box').style.display = 'block';
  document.getElementById('btn-reveal').style.display = 'none';
  document.getElementById('btn-options').style.display = 'none';
  document.getElementById('btn-y').disabled = document.getElementById('btn-n').disabled = false;
}

function endGame() {
  clearInterval(timerId);
  const modal = document.getElementById('finish-modal');
  modal.style.display = 'flex';
  document.getElementById('final-s1').innerText = scores[1];
  document.getElementById('final-s2').innerText = scores[2];
  document.getElementById('winner-title').innerText =
    scores[1] > scores[2] ? 'СИНИЕ ПОБЕДИЛИ!' : 'КРАСНЫЕ ПОБЕДИЛИ!';
}

window.onload = init;
