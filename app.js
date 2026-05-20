const QUIZ_SIZE = 12;
const OPTION_KEYS = ["A", "B", "C", "D"];
const STORAGE_PREFIX = "vocab-quiz-result";

const state = {
  mode: "loading",
  questions: [],
  index: 0,
  selected: null,
  score: 0,
  answers: [],
  today: localDateKey(new Date()),
  startedAt: null,
  finishedAt: null,
  elapsedMs: null,
  timerId: null,
};

const app = document.querySelector("#app");
const progressBar = document.querySelector("#progressBar");

init();

async function init() {
  try {
    const response = await fetch("questions.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load questions.json (${response.status})`);
    }

    const data = await response.json();
    state.questions = buildDailyQuiz(data.terms, state.today);
    document.addEventListener("keydown", handleKeydown);
    const savedResult = loadSavedResult();
    if (savedResult) {
      restoreSavedResult(savedResult);
      renderResults(true);
    } else {
      renderIntro(data);
    }
  } catch (error) {
    renderError(error);
  }
}

function renderIntro(data) {
  state.mode = "intro";
  progressBar.style.width = "0%";
  app.innerHTML = `
    <section class="screen">
      <h1>Vocab Quiz</h1>
      <div class="meta-row">
        <span class="pill">${formatDate(state.today)}</span>
        <span class="pill">${QUIZ_SIZE} daily questions</span>
      </div>
      <button class="start-button" type="button" id="startButton">Start</button>
      <p class="key-cue">Press Space or Enter</p>
    </section>
  `;
  document.querySelector("#startButton").addEventListener("click", startQuiz);
}

function startQuiz() {
  if (state.mode !== "intro") {
    return;
  }

  state.mode = "quiz";
  state.index = 0;
  state.selected = null;
  state.score = 0;
  state.answers = [];
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.elapsedMs = null;
  clearInterval(state.timerId);
  state.timerId = setInterval(updateTimer, 250);
  renderQuestion();
}

function renderQuestion() {
  const question = state.questions[state.index];
  state.selected = null;
  updateProgress();

  app.innerHTML = `
    <section class="screen">
      <div class="question-top">
        <div class="section-label">${question.section} ${state.index + 1}/${state.questions.length}</div>
        <div class="quiz-stats">
          <div class="score">Score ${state.score}/${state.questions.length}</div>
          <div class="score">Time <span id="timer">${formatDuration(elapsedMs())}</span></div>
        </div>
      </div>
      <p class="prompt">${question.prompt}</p>
      <div class="options" role="group" aria-label="Answer options">
        ${question.options
          .map(
            (option, index) => `
              <button class="option" type="button" data-index="${index}">
                <span class="key">${OPTION_KEYS[index]}</span>
                <span class="option-text">${escapeHtml(option)}</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="feedback" id="feedback" aria-live="polite"></div>
    </section>
  `;

  document.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => selectAnswer(Number(button.dataset.index)));
  });
  updateTimer();
}

function selectAnswer(optionIndex) {
  if (state.selected !== null) {
    return;
  }

  const question = state.questions[state.index];
  const isCorrect = optionIndex === question.answerIndex;
  state.selected = optionIndex;
  state.score += isCorrect ? 1 : 0;
  state.answers.push({
    term: question.term,
    type: question.type,
    definition: question.definition,
    example: question.example,
    correct: isCorrect,
    picked: question.options[optionIndex],
    expected: question.options[question.answerIndex],
  });

  document.querySelectorAll(".option").forEach((button, index) => {
    button.disabled = true;
    if (index === question.answerIndex) {
      button.classList.add("is-correct");
    } else if (index === optionIndex) {
      button.classList.add("is-wrong");
    }
  });

  const feedback = document.querySelector("#feedback");
  feedback.innerHTML = `
    <strong>${isCorrect ? "Correct." : "Wrong."}</strong> ${escapeHtml(question.note)}
    <span class="example">Example: ${escapeHtml(question.example)}</span>
    <span class="continue">Press Space or Enter.</span>
  `;

  document.querySelector(".score").textContent = `Score ${state.score}/${state.questions.length}`;
}

function handleKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (state.questions.length === 0) {
    return;
  }

  if (state.mode === "intro" && (event.key === " " || event.key === "Enter")) {
    event.preventDefault();
    startQuiz();
    return;
  }

  if (state.mode !== "quiz") {
    return;
  }

  const keyIndex = OPTION_KEYS.indexOf(event.key.toUpperCase());
  if (keyIndex >= 0 && state.selected === null) {
    event.preventDefault();
    selectAnswer(keyIndex);
    return;
  }

  if ((event.key === " " || event.key === "Enter") && state.selected !== null) {
    event.preventDefault();
    advance();
  }
}

function advance() {
  state.index += 1;
  if (state.index >= state.questions.length) {
    finishQuiz();
    renderResults(false);
  } else {
    renderQuestion();
  }
}

function finishQuiz() {
  state.mode = "results";
  state.finishedAt = Date.now();
  state.elapsedMs = elapsedMs();
  clearInterval(state.timerId);
  saveResult();
}

function renderResults(fromSavedResult) {
  state.mode = "results";
  clearInterval(state.timerId);
  progressBar.style.width = "100%";
  const missed = state.answers.filter((answer) => !answer.correct);
  const shareText = buildShareText();
  const finalTime = formatDuration(elapsedMs());
  const savedNote = fromSavedResult
    ? `<p class="saved-note">Completed today. Come back tomorrow for a new quiz.</p>`
    : "";

  app.innerHTML = `
    <section class="screen">
      <div class="result-layout">
        <div>
          <p class="eyebrow">Finished</p>
          <h1>${state.score}/${state.questions.length}</h1>
          <div class="meta-row">
            <span class="pill">Time ${finalTime}</span>
            <span class="pill">${Math.round(elapsedMs() / state.questions.length / 100) / 10}s per question</span>
          </div>
          ${savedNote}
          ${renderMisses(missed)}
        </div>
        <div class="share-box">
          <label for="shareText">Shareable ASCII</label>
          <textarea id="shareText" readonly>${shareText}</textarea>
          <button class="share-button" type="button" id="copyButton">Copy result</button>
        </div>
      </div>
    </section>
  `;

  const copyButton = document.querySelector("#copyButton");
  copyButton.addEventListener("click", async () => {
    const textarea = document.querySelector("#shareText");
    textarea.select();
    try {
      await navigator.clipboard.writeText(textarea.value);
      copyButton.textContent = "Copied";
    } catch {
      document.execCommand("copy");
      copyButton.textContent = "Copied";
    }
  });
}

function renderMisses(missed) {
  if (missed.length === 0) {
    return `<div class="misses"><h2>No misses.</h2><p>Annoyingly competent.</p></div>`;
  }

  return `
    <div class="misses">
      <h2>Missed terms</h2>
      <ul>
        ${missed
          .map(
            (answer) => `
              <li>
                <strong>${escapeHtml(answer.term)}</strong>: ${escapeHtml(answer.definition)}
                <span class="miss-picked">You chose: ${escapeHtml(answer.picked)}</span>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderError(error) {
  state.mode = "error";
  progressBar.style.width = "0%";
  app.innerHTML = `
    <section class="screen">
      <h1>Question load failed.</h1>
      <p class="error">${escapeHtml(error.message)}. Run a tiny local server from this folder, for example <code>python3 -m http.server 8123</code>, then open <code>http://127.0.0.1:8123</code>.</p>
    </section>
  `;
}

function buildDailyQuiz(terms, dateKey) {
  const rng = mulberry32(hashString(dateKey));
  const shuffled = shuffle([...terms], rng);
  const half = QUIZ_SIZE / 2;
  const selected = shuffled.slice(0, QUIZ_SIZE);
  const definitionToWord = selected.slice(0, half).map((term) => makeQuestion(term, "definition-to-word", rng));
  const wordToDefinition = selected.slice(half).map((term) => makeQuestion(term, "word-to-definition", rng));
  return [...definitionToWord, ...wordToDefinition];
}

function makeQuestion(term, type, rng) {
  if (type === "definition-to-word") {
    const options = shuffle([term.word, ...term.wordDecoys].slice(0, 4), rng);
    return {
      type,
      term: term.word,
      definition: term.definition,
      example: term.example,
      section: "Definition to word",
      prompt: escapeHtml(term.definition),
      options,
      answerIndex: options.indexOf(term.word),
      note: `${term.word}: ${term.definition}`,
    };
  }

  const options = shuffle([term.definition, ...term.definitionDecoys].slice(0, 4), rng);
  return {
    type,
    term: term.word,
    definition: term.definition,
    example: term.example,
    section: "Word to definition",
    prompt: `<span class="term">${escapeHtml(term.word)}</span>`,
    options,
    answerIndex: options.indexOf(term.definition),
    note: `${term.word}: ${term.definition}`,
  };
}

function buildShareText() {
  const marks = state.answers.map((answer) => (answer.correct ? "🟩" : "🟥"));
  const lines = chunk(marks, 6).map((row) => row.join("")).join("\n");
  return [
    `Vocab Quiz ${state.today}`,
    `Score: ${state.score}/${state.questions.length}`,
    `Time: ${formatDuration(elapsedMs())}`,
    lines,
  ].join("\n");
}

function updateProgress() {
  progressBar.style.width = `${(state.index / state.questions.length) * 100}%`;
}

function updateTimer() {
  const timer = document.querySelector("#timer");
  if (timer) {
    timer.textContent = formatDuration(elapsedMs());
  }
}

function elapsedMs() {
  if (typeof state.elapsedMs === "number") {
    return state.elapsedMs;
  }
  if (!state.startedAt) {
    return 0;
  }
  return (state.finishedAt ?? Date.now()) - state.startedAt;
}

function storageKey() {
  return `${STORAGE_PREFIX}:${state.today}`;
}

function loadSavedResult() {
  try {
    const rawResult = localStorage.getItem(storageKey());
    return rawResult ? JSON.parse(rawResult) : null;
  } catch {
    return null;
  }
}

function saveResult() {
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        date: state.today,
        score: state.score,
        total: state.questions.length,
        answers: state.answers,
        elapsedMs: elapsedMs(),
        completedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // The quiz still works if storage is unavailable.
  }
}

function restoreSavedResult(result) {
  const questionByTerm = new Map(state.questions.map((question) => [question.term, question]));
  state.mode = "results";
  state.index = state.questions.length;
  state.score = Number(result.score) || 0;
  state.answers = Array.isArray(result.answers)
    ? result.answers.map((answer) => {
        const question = questionByTerm.get(answer.term);
        return {
          ...answer,
          definition: answer.definition ?? question?.definition ?? "",
          example: answer.example ?? question?.example ?? "",
        };
      })
    : [];
  state.elapsedMs = Number(result.elapsedMs) || 0;
  state.startedAt = null;
  state.finishedAt = null;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function chunk(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
