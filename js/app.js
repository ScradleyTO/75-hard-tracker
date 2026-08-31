const CHALLENGE_LENGTH = 75;
const TASK_DEFS = [
  { key: "outdoor", title: "Outdoor workout", sub: "45 min, outside, rain or shine" },
  { key: "second", title: "Second workout", sub: "45 min, any location" },
  { key: "diet", title: "Diet compliant", sub: "No cheat meals, no alcohol" },
  { key: "water", title: "Gallon of water", sub: "1 gallon (3.8L)" },
  { key: "reading", title: "10 pages read", sub: "Non-fiction / personal development" },
  { key: "photo", title: "Progress photo", sub: "One photo, every day" },
];

let state = null;
let photoCache = {}; // day -> objectURL, for current attempt
let ui = { modal: null, pendingPhotoDay: null };

const app = document.getElementById("app");
const photoInput = document.getElementById("photo-input");

init();

async function init() {
  state = await loadState();
  checkForFailureOrCompletion();
  await saveState(state);
  await refreshPhotoCache();
  render();
  registerServiceWorker();
  setInterval(async () => {
    const changed = checkForFailureOrCompletion();
    if (changed) { await saveState(state); render(); }
    checkReminders();
  }, 30000);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  photoInput.addEventListener("change", handlePhotoFile);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

// ---------- date / attempt helpers ----------

function todayISOLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function getCurrentAttempt() {
  return state.attempts.find((a) => a.id === state.currentAttemptId);
}

function currentDayNumber(attempt) {
  return daysBetween(attempt.startDate, todayISOLocal()) + 1;
}

function getDayRecord(attempt, dayNumber) {
  return attempt.days[dayNumber] || {
    outdoor: false, second: false, diet: false, water: false,
    reading: false, pagesRead: 10, readingBookId: null, photo: false,
  };
}

function setDayRecord(attempt, dayNumber, record) {
  attempt.days[dayNumber] = record;
}

function isDayComplete(rec) {
  return rec.outdoor && rec.second && rec.diet && rec.water && rec.reading && rec.photo;
}

function getBook(id) {
  return state.books.find((b) => b.id === id) || null;
}

// ---------- failure / completion detection ----------

function checkForFailureOrCompletion() {
  const attempt = getCurrentAttempt();
  if (!attempt || attempt.status !== "active") return false;
  const rawDay = currentDayNumber(attempt);
  let changed = false;

  const lastPastDay = Math.min(rawDay - 1, CHALLENGE_LENGTH);
  for (let d = 1; d <= lastPastDay; d++) {
    const rec = attempt.days[d];
    if (!rec || !isDayComplete(rec)) {
      attempt.status = "failed";
      attempt.failedOnDay = d;
      changed = true;
      break;
    }
  }

  if (attempt.status === "active" && rawDay > CHALLENGE_LENGTH) {
    let allDone = true;
    for (let d = 1; d <= CHALLENGE_LENGTH; d++) {
      if (!attempt.days[d] || !isDayComplete(attempt.days[d])) { allDone = false; break; }
    }
    if (allDone) { attempt.status = "completed"; changed = true; }
  }

  return changed;
}

function maybeCompleteToday(attempt, dayNumber) {
  if (attempt.status !== "active") return;
  if (dayNumber === CHALLENGE_LENGTH && isDayComplete(attempt.days[dayNumber])) {
    attempt.status = "completed";
  }
}

function computeStreak(attempt) {
  let streak = 0;
  for (let d = 1; d <= CHALLENGE_LENGTH; d++) {
    const rec = attempt.days[d];
    if (rec && isDayComplete(rec)) streak++;
    else break;
  }
  return streak;
}

function bestStreakEver() {
  let best = 0;
  for (const a of state.attempts) {
    const s = a.status === "completed" ? CHALLENGE_LENGTH : computeStreak(a);
    if (s > best) best = s;
  }
  return best;
}

// ---------- mutations ----------

async function toggleTask(key) {
  const attempt = getCurrentAttempt();
  if (attempt.status !== "active") return;
  const dayNumber = currentDayNumber(attempt);
  if (dayNumber < 1 || dayNumber > CHALLENGE_LENGTH) return;

  if (key === "reading") {
    await toggleReading(attempt, dayNumber);
  } else if (key === "photo") {
    if (getDayRecord(attempt, dayNumber).photo) {
      ui.modal = { type: "photo-retake", dayNumber };
      render();
      return;
    } else {
      ui.pendingPhotoDay = dayNumber;
      photoInput.click();
      return;
    }
  } else {
    const rec = getDayRecord(attempt, dayNumber);
    rec[key] = !rec[key];
    setDayRecord(attempt, dayNumber, rec);
  }

  maybeCompleteToday(attempt, dayNumber);
  await saveState(state);
  render();
}

async function toggleReading(attempt, dayNumber) {
  const rec = getDayRecord(attempt, dayNumber);
  if (!rec.reading) {
    if (!state.currentBookId) {
      ui.modal = { type: "manage-books" };
      render();
      return;
    }
    const book = getBook(state.currentBookId);
    const pages = rec.pagesRead || 10;
    rec.reading = true;
    rec.readingBookId = book.id;
    book.currentPage = Math.min(book.totalPages || Infinity, (book.currentPage || 0) + pages);
  } else {
    const book = getBook(rec.readingBookId);
    if (book) book.currentPage = Math.max(0, (book.currentPage || 0) - (rec.pagesRead || 0));
    rec.reading = false;
    rec.readingBookId = null;
  }
  setDayRecord(attempt, dayNumber, rec);
}

async function updatePagesRead(newValRaw) {
  const attempt = getCurrentAttempt();
  const dayNumber = currentDayNumber(attempt);
  if (dayNumber < 1 || dayNumber > CHALLENGE_LENGTH || attempt.status !== "active") return;
  const rec = getDayRecord(attempt, dayNumber);
  const newVal = Math.max(0, parseInt(newValRaw, 10) || 0);
  if (rec.reading && rec.readingBookId) {
    const book = getBook(rec.readingBookId);
    if (book) {
      const delta = newVal - (rec.pagesRead || 0);
      book.currentPage = Math.max(0, Math.min(book.totalPages || Infinity, (book.currentPage || 0) + delta));
    }
  }
  rec.pagesRead = newVal;
  setDayRecord(attempt, dayNumber, rec);
  await saveState(state);
  render();
}

async function handlePhotoFile(e) {
  const file = e.target.files[0];
  photoInput.value = "";
  if (!file) return;
  const attempt = getCurrentAttempt();
  const dayNumber = ui.pendingPhotoDay;
  ui.pendingPhotoDay = null;
  if (!dayNumber) return;

  const existing = await getPhotoForDay(attempt.id, dayNumber);
  if (existing) await deletePhoto(existing.id);
  await savePhoto({ attemptId: attempt.id, day: dayNumber, blob: file });

  const rec = getDayRecord(attempt, dayNumber);
  rec.photo = true;
  setDayRecord(attempt, dayNumber, rec);
  maybeCompleteToday(attempt, dayNumber);
  await saveState(state);
  await refreshPhotoCache();
  render();
}

function retakePhoto(dayNumber) {
  ui.modal = null;
  ui.pendingPhotoDay = dayNumber;
  photoInput.click();
}

async function refreshPhotoCache() {
  Object.values(photoCache).forEach((url) => URL.revokeObjectURL(url));
  photoCache = {};
  const attempt = getCurrentAttempt();
  if (!attempt) return;
  const photos = await getPhotosForAttempt(attempt.id);
  for (const p of photos) {
    photoCache[p.day] = URL.createObjectURL(p.blob);
  }
}

async function doReset() {
  const attempt = getCurrentAttempt();
  attempt.status = "failed";
  if (!attempt.failedOnDay) attempt.failedOnDay = currentDayNumber(attempt);
  const newAttempt = { id: state.nextAttemptId, startDate: todayISOLocal(), status: "active", failedOnDay: null, days: {} };
  state.attempts.push(newAttempt);
  state.nextAttemptId += 1;
  state.currentAttemptId = newAttempt.id;
  ui.modal = null;
  await saveState(state);
  await refreshPhotoCache();
  render();
}

async function acknowledgeFailure() {
  await doReset();
}

function attemptHasProgress(attempt) {
  return Object.values(attempt.days).some((d) => d.outdoor || d.second || d.diet || d.water || d.reading || d.photo);
}

async function saveStartDate(newDateISO) {
  if (!newDateISO) return;
  const attempt = getCurrentAttempt();
  attempt.startDate = newDateISO;
  attempt.days = {};
  checkForFailureOrCompletion();
  ui.modal = null;
  await saveState(state);
  render();
}

async function addBook(title, author, totalPages) {
  const book = { id: state.nextBookId, title, author, totalPages: totalPages || null, currentPage: 0, finished: false };
  state.books.push(book);
  state.nextBookId += 1;
  if (!state.currentBookId) state.currentBookId = book.id;
  await saveState(state);
  render();
}

async function setCurrentBook(id) {
  state.currentBookId = id;
  await saveState(state);
  render();
}

async function deleteBook(id) {
  state.books = state.books.filter((b) => b.id !== id);
  if (state.currentBookId === id) state.currentBookId = state.books[0]?.id || null;
  await saveState(state);
  render();
}

// ---------- reminders (foreground-only) ----------

function parseTime(str) {
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

async function toggleReminders() {
  if (!("Notification" in window)) { alert("Notifications aren't supported in this browser."); return; }
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
  }
  state.settings = state.settings || {};
  state.settings.remindersEnabled = !state.settings.remindersEnabled;
  await saveState(state);
  render();
}

function checkReminders() {
  if (!state.settings || !state.settings.remindersEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const today = scheduleForDate(now);
  const todayKey = todayISOLocal();
  state.settings.lastNotified = state.settings.lastNotified || {};
  if (state.settings.lastNotified.date !== todayKey) {
    state.settings.lastNotified = { date: todayKey, session1: false, session2: false };
  }
  [["session1", today.session1], ["session2", today.session2]].forEach(([key, text]) => {
    const t = parseTime(text);
    if (!t) return;
    if (now.getHours() === t.h && now.getMinutes() === t.m && !state.settings.lastNotified[key]) {
      new Notification("75 Hard — workout time", { body: text, icon: "icons/icon-192.png" });
      state.settings.lastNotified[key] = true;
      saveState(state);
    }
  });
}

// ---------- calendar export ----------

function pad(n) { return String(n).padStart(2, "0"); }

function nextDateForWeekday(weekday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function icsDateTime(date, h, m) {
  const y = date.getFullYear(), mo = pad(date.getMonth() + 1), da = pad(date.getDate());
  return `${y}${mo}${da}T${pad(h)}${pad(m)}00`;
}

function exportCalendar() {
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//75 Hard Tracker//EN\r\n";
  const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  for (let wd = 0; wd < 7; wd++) {
    const entry = WEEKLY_SCHEDULE[wd];
    const date = nextDateForWeekday(wd);
    [["Session 1", entry.session1], ["Session 2", entry.session2]].forEach(([label, text]) => {
      const t = parseTime(text);
      if (!t) return;
      const dtStart = icsDateTime(date, t.h, t.m);
      const dtEnd = icsDateTime(date, (t.h + 1) % 24, t.m);
      ics += "BEGIN:VEVENT\r\n";
      ics += `UID:75hard-${wd}-${label.replace(/\s/g, "")}-${Date.now()}@75hard\r\n`;
      ics += `DTSTART:${dtStart}\r\n`;
      ics += `DTEND:${dtEnd}\r\n`;
      ics += `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[wd]}\r\n`;
      ics += `SUMMARY:75 Hard — ${text}\r\n`;
      ics += `DESCRIPTION:${label}: ${text}\r\n`;
      ics += "BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n";
      ics += "END:VEVENT\r\n";
    });
  }
  ics += "END:VCALENDAR\r\n";
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "75-hard-workouts.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- event delegation ----------

function handleClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "close-modal" && el.classList.contains("modal-overlay") && e.target !== el) return;
  const actions = {
    "toggle-task": () => toggleTask(el.dataset.key),
    "open-reset-confirm": () => { ui.modal = { type: "reset-confirm" }; render(); },
    "close-modal": () => { ui.modal = null; render(); },
    "confirm-reset": () => doReset(),
    "acknowledge-failure": () => acknowledgeFailure(),
    "open-manage-books": () => { ui.modal = { type: "manage-books" }; render(); },
    "set-current-book": () => setCurrentBook(parseInt(el.dataset.id, 10)),
    "delete-book": () => deleteBook(parseInt(el.dataset.id, 10)),
    "add-book-submit": () => {
      const title = document.getElementById("book-title-input").value.trim();
      const author = document.getElementById("book-author-input").value.trim();
      const pages = document.getElementById("book-pages-input").value;
      if (!title) return;
      addBook(title, author, pages ? parseInt(pages, 10) : null);
      document.getElementById("book-title-input").value = "";
      document.getElementById("book-author-input").value = "";
      document.getElementById("book-pages-input").value = "";
    },
    "retake-photo": () => retakePhoto(ui.modal.dayNumber),
    "view-photo": () => { ui.modal = { type: "photo-view", src: el.dataset.src, day: el.dataset.day }; render(); },
    "toggle-reminders": () => toggleReminders(),
    "export-calendar": () => exportCalendar(),
    "toggle-history": () => { ui.showHistory = !ui.showHistory; render(); },
    "toggle-gallery-all": () => { ui.galleryAll = !ui.galleryAll; render(); },
    "start-new-attempt": () => doReset(),
    "open-set-start-date": () => { ui.modal = { type: "set-start-date" }; render(); },
    "save-start-date": () => saveStartDate(document.getElementById("start-date-input").value),
  };
  if (actions[action]) actions[action]();
}

function handleChange(e) {
  if (e.target.id === "pages-read-input") {
    updatePagesRead(e.target.value);
  }
}

// ---------- render ----------

function render() {
  const attempt = getCurrentAttempt();

  if (attempt.status === "failed") {
    app.innerHTML = renderFailureScreen(attempt);
    return;
  }
  if (attempt.status === "completed") {
    app.innerHTML = renderCompleteScreen(attempt);
    return;
  }

  const dayNumber = currentDayNumber(attempt);

  if (dayNumber < 1) {
    app.innerHTML = renderNotStartedScreen(attempt, dayNumber);
    return;
  }

  const rec = getDayRecord(attempt, dayNumber);
  const streak = computeStreak(attempt);
  const today = scheduleForDate(new Date());
  const currentBook = getBook(state.currentBookId);

  app.innerHTML = `
    ${renderHeader(dayNumber)}
    ${renderStartDateRow(attempt)}
    ${renderStats(streak)}
    ${renderScheduleCard(today)}
    ${renderChecklist(rec, currentBook)}
    ${renderBookCard(currentBook)}
    ${renderGalleryCard(attempt)}
    ${renderHistoryCard(attempt, dayNumber)}
    ${renderRemindersCard()}
    ${renderResetButton()}
    ${renderModal()}
  `;
}

function renderNotStartedScreen(attempt, dayNumber) {
  const daysUntil = 1 - dayNumber;
  return `
    <div class="header"><div class="title">75 Hard</div></div>
    <div class="card" style="text-align:center">
      <h2 style="text-transform:none;color:var(--text);font-size:18px">Not started yet</h2>
      <p style="margin-top:8px">Day 1 is set for <strong>${attempt.startDate}</strong> — that's ${daysUntil} day${daysUntil === 1 ? "" : "s"} from now.</p>
      <button class="btn btn-ghost btn-block" style="margin-top:14px" data-action="open-set-start-date">Change Day 1 date</button>
    </div>
    ${renderScheduleCard(scheduleForDate(new Date()))}
    ${renderModal()}
  `;
}

function renderStartDateRow(attempt) {
  if (attemptHasProgress(attempt)) return "";
  return `
    <div class="item-sub" style="margin:-10px 0 16px;text-align:right">
      Day 1: ${attempt.startDate} · <button class="link-btn" data-action="open-set-start-date">change</button>
    </div>
  `;
}

function renderHeader(dayNumber) {
  const dow = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return `
    <div class="header">
      <div class="title">75 Hard</div>
      <div class="day-badge">
        <div class="day-num">Day ${dayNumber}<span style="color:var(--text-dim);font-weight:400;font-size:16px">/${CHALLENGE_LENGTH}</span></div>
        <div class="day-of">${dow}</div>
      </div>
    </div>
  `;
}

function renderStats(streak) {
  const best = bestStreakEver();
  const attempts = state.attempts.length;
  return `
    <div class="stat-row">
      <div class="stat-pill"><div class="num">🔥 ${streak}</div><div class="label">Streak</div></div>
      <div class="stat-pill"><div class="num">${best}</div><div class="label">Best</div></div>
      <div class="stat-pill"><div class="num">${attempts}</div><div class="label">Attempts</div></div>
    </div>
  `;
}

function renderScheduleCard(today) {
  return `
    <div class="card">
      <h2>Today's Sessions — ${today.label}</h2>
      <div class="schedule-row"><span><span class="sess-label">1.</span>${today.session1}</span></div>
      <div class="schedule-row"><span><span class="sess-label">2.</span>${today.session2}</span></div>
    </div>
  `;
}

function renderChecklist(rec, currentBook) {
  const items = TASK_DEFS.map((t) => {
    if (t.key === "reading") return renderReadingItem(rec, currentBook);
    if (t.key === "photo") return renderPhotoItem(rec);
    const checked = rec[t.key];
    return `
      <div class="checklist-item">
        <div class="checkbox ${checked ? "checked" : ""}" data-action="toggle-task" data-key="${t.key}">${checked ? "✓" : ""}</div>
        <div class="item-body" data-action="toggle-task" data-key="${t.key}">
          <div class="item-title">${t.title}</div>
          <div class="item-sub">${t.sub}</div>
        </div>
      </div>
    `;
  }).join("");
  return `<div class="card"><h2>Today's Checklist</h2>${items}</div>`;
}

function renderReadingItem(rec, currentBook) {
  const sub = currentBook
    ? `${currentBook.title}${currentBook.totalPages ? ` — p.${currentBook.currentPage}/${currentBook.totalPages}` : ` — p.${currentBook.currentPage}`}`
    : "No book set — tap to add one";
  return `
    <div class="checklist-item" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="checkbox ${rec.reading ? "checked" : ""}" data-action="toggle-task" data-key="reading">${rec.reading ? "✓" : ""}</div>
        <div class="item-body" ${currentBook ? "" : 'data-action="open-manage-books"'}>
          <div class="item-title">10 pages read</div>
          <div class="item-sub">${sub}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;margin-left:40px">
        <span class="item-sub" style="margin:0">Pages read:</span>
        <input type="number" min="0" id="pages-read-input" class="pages-input" value="${rec.pagesRead ?? 10}" />
      </div>
    </div>
  `;
}

function renderPhotoItem(rec) {
  const dayNumber = currentDayNumber(getCurrentAttempt());
  const thumb = photoCache[dayNumber];
  return `
    <div class="checklist-item">
      <div class="checkbox ${rec.photo ? "checked" : ""}" data-action="toggle-task" data-key="photo">${rec.photo ? "✓" : ""}</div>
      <div class="item-body" data-action="toggle-task" data-key="photo">
        <div class="item-title">Progress photo</div>
        <div class="item-sub">${rec.photo ? "Tap to retake" : "Tap to take a photo"}</div>
      </div>
      ${thumb ? `<img class="photo-thumb" src="${thumb}" />` : ""}
    </div>
  `;
}

function renderBookCard(book) {
  const pct = book && book.totalPages ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100)) : null;
  return `
    <div class="card">
      <h2>Reading</h2>
      ${book ? `
        <div><strong>${book.title}</strong>${book.author ? ` · ${book.author}` : ""}</div>
        <div class="item-sub">Page ${book.currentPage}${book.totalPages ? ` of ${book.totalPages}` : ""}</div>
        ${pct !== null ? `<div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>` : ""}
      ` : `<div class="item-sub">No book selected.</div>`}
      <button class="btn btn-ghost btn-block" style="margin-top:10px" data-action="open-manage-books">Manage books</button>
    </div>
  `;
}

function renderGalleryCard(attempt) {
  const days = Object.keys(photoCache).map(Number).sort((a, b) => b - a);
  if (!days.length) return `<div class="card"><h2>Progress Photos</h2><div class="item-sub">No photos yet this attempt.</div></div>`;
  const shown = ui.galleryAll ? days : days.slice(0, 8);
  const grid = shown.map((d) => `<img src="${photoCache[d]}" data-action="view-photo" data-src="${photoCache[d]}" data-day="${d}" />`).join("");
  return `
    <div class="card">
      <h2>Progress Photos</h2>
      <div class="gallery-grid">${grid}</div>
      ${days.length > 8 ? `<button class="link-btn" style="margin-top:10px" data-action="toggle-gallery-all">${ui.galleryAll ? "Show less" : `Show all ${days.length}`}</button>` : ""}
    </div>
  `;
}

function renderHistoryCard(attempt, dayNumber) {
  const rows = [];
  for (let d = 1; d < dayNumber; d++) {
    const rec = attempt.days[d];
    const complete = rec && isDayComplete(rec);
    rows.push(`<div class="history-row"><div class="dot ${complete ? "complete" : "incomplete"}"></div> Day ${d} — ${complete ? "complete" : "incomplete"}</div>`);
  }
  if (!rows.length) return "";
  const shown = ui.showHistory ? rows : rows.slice(-5);
  return `
    <div class="card">
      <h2>History</h2>
      ${shown.join("")}
      ${rows.length > 5 ? `<button class="link-btn" style="margin-top:8px" data-action="toggle-history">${ui.showHistory ? "Show less" : "Show all"}</button>` : ""}
    </div>
  `;
}

function renderRemindersCard() {
  const enabled = state.settings && state.settings.remindersEnabled;
  return `
    <div class="card">
      <h2>Reminders</h2>
      <div class="item-sub" style="margin-bottom:10px">In-app alerts only fire while this app is open. For alerts that work even when it's closed, export the weekly schedule to your Calendar app.</div>
      <button class="btn ${enabled ? "btn-primary" : "btn-secondary"} btn-block" style="margin-bottom:8px" data-action="toggle-reminders">${enabled ? "In-app reminders: ON" : "Enable in-app reminders"}</button>
      <button class="btn btn-ghost btn-block" data-action="export-calendar">Export weekly schedule to Calendar (.ics)</button>
    </div>
  `;
}

function renderResetButton() {
  return `
    <button class="btn btn-ghost btn-block" style="border-color:var(--accent); color:var(--accent)" data-action="open-reset-confirm">Reset to Day 1</button>
  `;
}

function renderFailureScreen(attempt) {
  return `
    <div class="header"><div class="title">75 Hard</div></div>
    <div class="card fail-banner">
      <div class="fail-title">Day ${attempt.failedOnDay} wasn't completed</div>
      <p style="margin-top:10px">Every requirement has to be checked off every day. Day ${attempt.failedOnDay} was missing at least one, so this attempt is over. 75 Hard means restarting from Day 1 — no partial credit.</p>
      <button class="btn btn-primary btn-block" style="margin-top:16px" data-action="acknowledge-failure">Acknowledge &amp; Restart from Day 1</button>
    </div>
  `;
}

function renderCompleteScreen(attempt) {
  return `
    <div class="header"><div class="title">75 Hard</div></div>
    <div class="card complete-screen">
      <div class="big">🏆</div>
      <h2 style="margin-top:10px">75 Hard Complete</h2>
      <p>You completed all ${CHALLENGE_LENGTH} days without missing a single requirement. Started ${attempt.startDate}.</p>
      <button class="btn btn-primary btn-block" style="margin-top:16px" data-action="start-new-attempt">Start a new attempt</button>
    </div>
  `;
}

function renderModal() {
  if (!ui.modal) return "";
  const m = ui.modal;

  if (m.type === "reset-confirm") {
    const streak = computeStreak(getCurrentAttempt());
    return `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal-box danger">
          <h2>Reset to Day 1?</h2>
          <p>This ends your current attempt${streak > 0 ? ` (currently a ${streak}-day streak)` : ""} and starts a brand new Day 1 today. This can't be undone.</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
            <button class="btn btn-primary" style="background:var(--accent)" data-action="confirm-reset">Yes, reset</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === "photo-retake") {
    return `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal-box">
          <h2>Retake today's photo?</h2>
          <p>This will replace today's progress photo.</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
            <button class="btn btn-primary" data-action="retake-photo">Retake</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === "photo-view") {
    return `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal-box" style="text-align:center">
          <h2>Day ${m.day}</h2>
          <img src="${m.src}" style="width:100%;border-radius:10px;margin-top:8px" />
          <button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="close-modal">Close</button>
        </div>
      </div>
    `;
  }

  if (m.type === "manage-books") {
    const rows = state.books.map((b) => `
      <div class="book-row">
        <div>
          <div>${b.title}${state.currentBookId === b.id ? " ⭐️" : ""}</div>
          <div class="item-sub">p.${b.currentPage}${b.totalPages ? `/${b.totalPages}` : ""}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${state.currentBookId !== b.id ? `<button class="btn btn-ghost" data-action="set-current-book" data-id="${b.id}">Use</button>` : ""}
          <button class="btn btn-ghost" style="color:var(--accent)" data-action="delete-book" data-id="${b.id}">Delete</button>
        </div>
      </div>
    `).join("");
    return `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal-box">
          <h2>Manage books</h2>
          ${rows || `<p>No books yet.</p>`}
          <div style="margin-top:14px">
            <label>Title</label>
            <input type="text" id="book-title-input" placeholder="Atomic Habits" />
            <label>Author (optional)</label>
            <input type="text" id="book-author-input" placeholder="James Clear" />
            <label>Total pages (optional)</label>
            <input type="number" id="book-pages-input" placeholder="320" />
            <button class="btn btn-primary btn-block" data-action="add-book-submit">Add book</button>
          </div>
          <button class="btn btn-secondary btn-block" style="margin-top:10px" data-action="close-modal">Done</button>
        </div>
      </div>
    `;
  }

  if (m.type === "set-start-date") {
    const attempt = getCurrentAttempt();
    return `
      <div class="modal-overlay" data-action="close-modal">
        <div class="modal-box">
          <h2>Set Day 1 date</h2>
          <p>Choose the calendar date that should count as Day 1 of this attempt.</p>
          <label style="margin-top:12px">Day 1 date</label>
          <input type="date" id="start-date-input" value="${attempt.startDate}" />
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
            <button class="btn btn-primary" data-action="save-start-date">Save</button>
          </div>
        </div>
      </div>
    `;
  }

  return "";
}
