// app.js — wires the single-page app together.
//
// State lives in plain JS variables (per architecture guide §5) but is now also
// auto-saved to localStorage per logged-in user, so a reload on the SAME
// browser/computer does not lose planned work. Because there is no server,
// syncing across DIFFERENT computers is manual: "Munkamenet mentése" exports
// the full state to a JSON file, and "Munkamenet betöltése" MERGES a file's
// contents into the current state (by id, so importing twice or importing on
// top of local changes doesn't lose or duplicate data). Treat that JSON file
// as the shared master (e.g. keep it on a shared network drive) if several
// people plan repairs from different machines.

let currentUser = null;
let sharedData = null;      // { damageTypes, partners } — decrypted at login
let weeks = [];              // next 8 ISO weeks, computed at login (used for the capacity dashboard)
// jobs: { id, rendszam, damageTypeId, partnerId, startDate, endDate, days, unitCost, totalCost, createdAt }
let jobs = [];
// completedJobs: { id, rendszam, damageTypeId, damageTypeName, partnerId, partnerName, startDate, endDate, days, totalCost, completedDate, loggedAt }
let completedJobs = [];
let drafts = [];              // pending "new car" blocks not yet saved to the plan
let pendingCompleteJobId = null;
let lastTeamSave = null;      // { name, at } — who last exported/shared a session file, and when
let editingJobId = null;      // set while the "Új javítás tervezése" form is editing an existing active job
// partnerVacations: { id, partnerId, startDate, endDate, createdAt } — blocks EVERY repair line at that partner
let partnerVacations = [];
let vacationModalPartnerId = null; // which partner's "Szabadság kezelése" modal is currently open

const WEEKS_AHEAD = 8;

function uid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ---------------- Login ----------------

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = normalizeMatchKey(document.getElementById('username').value);
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.className = 'login-error';

  const record = (window.ENCRYPTED_USERS || {})[username];
  if (!record) {
    errEl.textContent = 'Hibás vezetéknév vagy jelszó.';
    errEl.className = 'login-error show';
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Bejelentkezés…';
  try {
    sharedData = await CryptoUtils.decryptJSON(password, record);
    currentUser = username;
    enterApp();
  } catch (err) {
    errEl.textContent = 'Hibás vezetéknév vagy jelszó.';
    errEl.className = 'login-error show';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bejelentkezés';
  }
});

function currentUserFullName() {
  if (sharedData && sharedData.user && (sharedData.user.keresztnev || sharedData.user.vezeteknev)) {
    return (sharedData.user.keresztnev + ' ' + sharedData.user.vezeteknev).trim();
  }
  return currentUser;
}

function enterApp() {
  weeks = CapacityCalc.getUpcomingWeeks(WEEKS_AHEAD, new Date());
  jobs = [];
  completedJobs = [];
  partnerVacations = [];
  lastTeamSave = null;
  loadLocal();
  drafts = [createDraft()];

  const firstName = (sharedData.user && sharedData.user.keresztnev) ? sharedData.user.keresztnev : currentUser;
  document.getElementById('whoLabel').textContent = 'Szia, ' + firstName + '!';
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-main').style.display = 'block';

  renderDrafts();
  renderCapacityWeeks();
  renderJobsTable();
  renderActiveSidebar();
  renderLog();
  renderStatsPanel();
  updateSyncStatusLabel();
  renderSyncInfo();
  if (typeof showAppScreen === 'function') showAppScreen('capacity');
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  sharedData = null;
  jobs = [];
  completedJobs = [];
  partnerVacations = [];
  drafts = [];
  document.getElementById('password').value = '';
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-login').style.display = 'flex';
});

// ---------------- Local persistence (per-browser convenience) ----------------

function storageKey() {
  return 'kapacitastervezo_v1_' + currentUser;
}

function saveLocal() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      jobs, completedJobs, partnerVacations, lastTeamSave, savedAt: new Date().toISOString(),
    }));
  } catch (err) {
    // localStorage may be unavailable (e.g. some file:// setups) — not fatal,
    // the person can still rely on manual "Munkamenet mentése" export.
  }
  updateSyncStatusLabel();
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.jobs)) jobs = data.jobs;
    if (Array.isArray(data.completedJobs)) completedJobs = data.completedJobs;
    if (Array.isArray(data.partnerVacations)) partnerVacations = data.partnerVacations;
    if (data.lastTeamSave) lastTeamSave = data.lastTeamSave;
  } catch (err) {
    // ignore corrupt local state
  }
}

// Shows, in the header, which colleague last saved/shared a session file and
// when — this is provenance for the shared JSON (see "Munkamenet mentése"),
// not just this browser's own local autosave.
function renderSyncInfo() {
  const el = document.getElementById('syncInfoLabel');
  if (!lastTeamSave) {
    el.textContent = 'Még nem volt közös mentés.';
    return;
  }
  el.textContent = 'Utoljára mentett: ' + lastTeamSave.name + ' — ' + new Date(lastTeamSave.at).toLocaleString('hu-HU');
}

function updateSyncStatusLabel() {
  const el = document.getElementById('syncStatusLabel');
  let raw;
  try { raw = localStorage.getItem(storageKey()); } catch (err) { raw = null; }
  let localTime = null;
  if (raw) { try { localTime = JSON.parse(raw).savedAt; } catch (err) {} }
  const localPart = localTime
    ? 'Helyi mentés: ' + new Date(localTime).toLocaleString('hu-HU')
    : 'Még nincs helyi mentés ezen a gépen.';
  el.textContent = localPart + '  ·  Ha másik gépről is dolgoztok, használjátok a "Munkamenet mentése/betöltése" gombokat a szinkronizáláshoz.';
}

// ---------------- Draft blocks ("new car" entries) ----------------

function todayISODate() {
  return CapacityCalc.toISODateString(CapacityCalc.toDateOnlyUTC(new Date()));
}

function createDraft() {
  const today = todayISODate();
  return {
    draftId: uid(),
    damageTypeId: sharedData.damageTypes[0] ? sharedData.damageTypes[0].id : '',
    rendszam: '',
    partnerId: null,
    startDate: today,
    endDate: today,
    endDateTouched: false, // once true, we stop auto-suggesting the end date from turnaround
    customPrice: '', // used only when the selected partner has a variable ("egyedi") price for this damage type
  };
}

// Recomputes the suggested end date from the selected partner's turnaround for
// this damage type, unless the person already edited the end date by hand.
function applyEndDateSuggestion(draft) {
  if (draft.endDateTouched || !draft.partnerId) return;
  const partner = sharedData.partners.find(p => p.id === draft.partnerId);
  const days = partner && partner.turnaround ? partner.turnaround[draft.damageTypeId] : null;
  if (typeof days === 'number' && draft.startDate) {
    draft.endDate = CapacityCalc.addWorkdaysEndDate(draft.startDate, days);
  }
}

function renderDrafts() {
  const wrap = document.getElementById('draftBlocks');
  wrap.innerHTML = drafts.map((draft, i) => renderDraftBlock(draft, i)).join('');
}

function renderDraftBlock(draft, index) {
  const damageOptions = sharedData.damageTypes.map(d =>
    `<option value="${d.id}" ${d.id === draft.damageTypeId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`
  ).join('');

  const options = CapacityCalc.partnerOptionsForDamageType(draft.damageTypeId, sharedData.partners);
  let partnerHtml;
  if (options.length === 0) {
    partnerHtml = '<div class="empty-state small">Egyik partnernél sincs ár megadva ehhez a sérüléstípushoz.</div>';
  } else {
    const validRange = draft.startDate && draft.endDate && draft.endDate >= draft.startDate;
    partnerHtml = options.map(o => {
      let blockedHtml = '';
      let isUnavailable = false;
      if (validRange) {
        const partner = sharedData.partners.find(p => p.id === o.partnerId);
        const check = CapacityCalc.checkAvailability({
          partnerId: o.partnerId, repairLines: partner.repairLines, startDate: draft.startDate, endDate: draft.endDate,
          existingJobs: jobs, excludeJobId: editingJobId, vacations: partnerVacations,
        });
        if (!check.available) {
          isUnavailable = true;
          const onVacation = CapacityCalc.partnerHasVacationOverlap(partnerVacations, o.partnerId, draft.startDate, draft.endDate);
          blockedHtml = onVacation
            ? '<div class="po-warning">A partner szabadságon van ezen az időszakon. Keress másik javítót vagy dátumot!</div>'
            : '<div class="po-warning">Foglalt kapacitás. Keress másik javítót!</div>';
        }
      }
      return `
      <div class="partner-option ${o.partnerId === draft.partnerId ? 'selected' : ''} ${isUnavailable ? 'unavailable' : ''}" data-role="partnerOption" data-draft="${draft.draftId}" data-partner="${o.partnerId}" data-unavailable="${isUnavailable}">
        <div>
          <div class="po-name">${escapeHtml(o.partnerName)}</div>
          <div class="po-badges">
            ${o.isCheapest ? '<span class="po-badge cheapest">legolcsóbb</span>' : ''}
            ${o.isFastest ? '<span class="po-badge fastest">leggyorsabb</span>' : ''}
            ${o.isMostCapacity ? '<span class="po-badge capacity">legnagyobb kapacitás</span>' : ''}
          </div>
          ${blockedHtml}
        </div>
        <div>
          <div class="po-price">${o.isVariablePrice ? 'Egyedi ár' : formatHUF(o.unitCost)}</div>
          <div class="po-days">${o.turnaroundDays != null ? '~' + o.turnaroundDays + ' nap' : '—'}</div>
        </div>
      </div>
    `;
    }).join('');
  }

  const selectedOption = options.find(o => o.partnerId === draft.partnerId);
  const customPriceHtml = (selectedOption && selectedOption.isVariablePrice) ? `
    <div class="form-row custom-price-row">
      <div>
        <label>Egyedi ár ennél a partnernél (Ft)</label>
        <input type="number" min="0" step="500" data-role="customPrice" data-draft="${draft.draftId}" value="${escapeHtml(draft.customPrice)}" placeholder="add meg az összeget">
      </div>
    </div>
  ` : '';

  return `
    <div class="draft-block" data-draft="${draft.draftId}">
      <div class="draft-head">
        <span class="draft-label">${index + 1}. autó</span>
        ${drafts.length > 1 ? `<button class="remove-draft" data-role="removeDraft" data-draft="${draft.draftId}" title="Eltávolítás">✕</button>` : ''}
      </div>
      <div class="form-row">
        <div>
          <label>Sérülés típusa</label>
          <select data-role="damageType" data-draft="${draft.draftId}">${damageOptions}</select>
        </div>
        <div>
          <label>Gépkocsi rendszáma</label>
          <input type="text" data-role="rendszam" data-draft="${draft.draftId}" value="${escapeHtml(draft.rendszam)}" placeholder="pl. ABC-123">
        </div>
        <div>
          <label>Kezdő dátum</label>
          <input type="date" data-role="startDate" data-draft="${draft.draftId}" value="${draft.startDate}">
        </div>
        <div>
          <label>Elkészülési dátum</label>
          <input type="date" data-role="endDate" data-draft="${draft.draftId}" value="${draft.endDate}" min="${draft.startDate}">
        </div>
      </div>
      <div class="partner-options">${partnerHtml}</div>
      ${customPriceHtml}
    </div>
  `;
}

const draftBlocksEl = document.getElementById('draftBlocks');

draftBlocksEl.addEventListener('input', (e) => {
  const role = e.target.dataset.role;
  const draftId = e.target.dataset.draft;
  const draft = drafts.find(d => d.draftId === draftId);
  if (!draft) return;
  if (role === 'rendszam') {
    draft.rendszam = e.target.value; // no re-render needed — avoids losing focus while typing
  } else if (role === 'customPrice') {
    draft.customPrice = e.target.value;
  }
});

draftBlocksEl.addEventListener('change', (e) => {
  const role = e.target.dataset.role;
  const draftId = e.target.dataset.draft;
  const draft = drafts.find(d => d.draftId === draftId);
  if (!draft) return;
  if (role === 'damageType') {
    draft.damageTypeId = e.target.value;
    draft.partnerId = null; // price list changed, force re-selection
    draft.endDateTouched = false;
    renderDrafts();
  } else if (role === 'startDate') {
    draft.startDate = e.target.value;
    if (draft.endDate < draft.startDate) draft.endDate = draft.startDate;
    applyEndDateSuggestion(draft);
    renderDrafts();
  } else if (role === 'endDate') {
    draft.endDate = e.target.value;
    draft.endDateTouched = true;
    renderDrafts();
  }
});

draftBlocksEl.addEventListener('click', (e) => {
  const optionEl = e.target.closest('[data-role="partnerOption"]');
  if (optionEl) {
    if (optionEl.dataset.unavailable === 'true') {
      showToast('Foglalt kapacitás. Keress másik javítót!', true);
      return;
    }
    const draft = drafts.find(d => d.draftId === optionEl.dataset.draft);
    if (draft) {
      draft.partnerId = optionEl.dataset.partner;
      applyEndDateSuggestion(draft);
      renderDrafts();
    }
    return;
  }
  const removeBtn = e.target.closest('[data-role="removeDraft"]');
  if (removeBtn) {
    drafts = drafts.filter(d => d.draftId !== removeBtn.dataset.draft);
    renderDrafts();
  }
});

document.getElementById('addCarBtn').addEventListener('click', () => {
  drafts.push(createDraft());
  renderDrafts();
});

// ---------------- Editing an existing active job from the sidebar ----------------

function startEditJob(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;

  const partner = sharedData.partners.find(p => p.id === job.partnerId);
  const rawCost = partner ? partner.costs[job.damageTypeId] : null;
  const isVariable = typeof rawCost === 'number' && CapacityCalc.isVariablePriceValue(rawCost);

  editingJobId = jobId;
  drafts = [{
    draftId: uid(),
    damageTypeId: job.damageTypeId,
    rendszam: job.rendszam,
    partnerId: job.partnerId,
    startDate: job.startDate,
    endDate: job.endDate,
    endDateTouched: true, // don't overwrite the person's existing dates with a turnaround suggestion
    customPrice: isVariable ? String(job.unitCost) : '',
  }];
  renderDrafts();
  updateDraftPanelModeUI();

  const panel = document.getElementById('draftPanelTitle');
  if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exitEditMode() {
  editingJobId = null;
  drafts = [createDraft()];
  renderDrafts();
  updateDraftPanelModeUI();
}

function updateDraftPanelModeUI() {
  const title = document.getElementById('draftPanelTitle');
  const saveBtn = document.getElementById('saveDraftsBtn');
  const addBtn = document.getElementById('addCarBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const bulkToolbar = document.getElementById('bulkImportToolbar');
  const hint = document.getElementById('draftPanelHint');

  if (editingJobId) {
    title.textContent = 'Rögzített javítás módosítása';
    saveBtn.textContent = 'Módosítás mentése';
    addBtn.style.display = 'none';
    bulkToolbar.style.display = 'none';
    cancelBtn.style.display = 'inline-flex';
    hint.textContent = 'Módosítsd az adatokat, majd mentsd — a foglalás a régi helyét felszabadítja, és az újat ellenőrzi (ütközés esetén nem enged menteni).';
  } else {
    title.textContent = 'Új javítás tervezése';
    saveBtn.textContent = 'Mentés a tervhez';
    addBtn.style.display = '';
    bulkToolbar.style.display = '';
    cancelBtn.style.display = 'none';
    hint.innerHTML = 'Vegyél fel egy vagy több autót — mindegyikhez válaszd ki a sérülés típusát és a partnert, majd mentsd el egyszerre a tervhez. Tömeges felvitelhez az Excel oszlopai: <code>Rendszam</code>, <code>SerulesTipus</code>, <code>Partner</code> (opcionális), és vagy <code>KezdoDatum</code>+<code>ElkeszulesiDatum</code>, vagy helyettük <code>LegkesobbiElkeszulesiDatum</code> — utóbbi esetben a rendszer maga osztja be az autókat a partnerek javítósoraira úgy, hogy minél több javítás elkészüljön a határidőig. Ha egy partnernél "Egyedi ár" van beállítva, add meg az összeget az opcionális <code>EgysegAr</code> oszlopban, különben az a partner kimarad az automatikus választásból. Ugyanez az oszlopszerkezet, amit az "Excel export" is használ.';
  }
}

document.getElementById('cancelEditBtn').addEventListener('click', () => {
  exitEditMode();
});

document.getElementById('saveDraftsBtn').addEventListener('click', () => {
  if (editingJobId) {
    saveEditedJob();
    return;
  }

  const errors = [];
  let addedCount = 0;

  drafts.forEach((draft, i) => {
    const label = (i + 1) + '. autó';
    if (!draft.rendszam || !draft.rendszam.trim()) { errors.push(label + ': hiányzik a rendszám.'); return; }
    if (!draft.partnerId) { errors.push(label + ' (' + draft.rendszam + '): válassz partnert.'); return; }
    if (!draft.startDate || !draft.endDate) { errors.push(label + ' (' + draft.rendszam + '): add meg a kezdő és elkészülési dátumot.'); return; }
    if (draft.endDate < draft.startDate) { errors.push(label + ' (' + draft.rendszam + '): az elkészülési dátum korábbi, mint a kezdő dátum.'); return; }

    const partner = sharedData.partners.find(p => p.id === draft.partnerId);
    const damageType = sharedData.damageTypes.find(d => d.id === draft.damageTypeId);
    const rawCost = partner.costs[draft.damageTypeId];
    let unitCost = rawCost;
    if (CapacityCalc.isVariablePriceValue(rawCost)) {
      unitCost = parseFloat(draft.customPrice);
      if (!(unitCost > 0)) {
        errors.push(label + ' (' + draft.rendszam + '): add meg az egyedi árat ehhez a partnerhez.');
        return;
      }
    }
    const days = CapacityCalc.daysBetweenInclusive(draft.startDate, draft.endDate);
    const workdays = CapacityCalc.countWorkdaysInclusive(draft.startDate, draft.endDate);

    if (damageType && typeof damageType.avgRepairDays === 'number' && workdays > damageType.avgRepairDays) {
      const confirmed = confirm(
        'Biztosan szükséges ennyi munkanap az elkészüléshez? Az átlagos javítási idő ilyen esetekben ' +
        damageType.avgRepairDays + ' nap.'
      );
      if (!confirmed) {
        errors.push(label + ' (' + draft.rendszam + '): kihagyva — a megadott ' + workdays + ' munkanap meghaladja az átlagos ' + damageType.avgRepairDays + ' napot, és ezt nem erősítetted meg.');
        return;
      }
    }

    const { available, line } = CapacityCalc.checkAvailability({
      partnerId: draft.partnerId, repairLines: partner.repairLines, startDate: draft.startDate, endDate: draft.endDate,
      existingJobs: jobs, vacations: partnerVacations,
    });
    if (!available) {
      const onVacation = CapacityCalc.partnerHasVacationOverlap(partnerVacations, draft.partnerId, draft.startDate, draft.endDate);
      errors.push(label + ' (' + draft.rendszam + '): ' + (onVacation ? 'A partner szabadságon van ezen az időszakon.' : 'Foglalt kapacitás. Keress másik javítót!'));
      return;
    }

    jobs.push({
      id: uid(),
      rendszam: draft.rendszam.trim().toUpperCase(),
      damageTypeId: draft.damageTypeId,
      partnerId: draft.partnerId,
      line,
      startDate: draft.startDate,
      endDate: draft.endDate,
      days,
      unitCost,
      totalCost: unitCost,
      createdAt: new Date().toISOString(),
    });
    addedCount++;
  });

  if (addedCount > 0) {
    drafts = [createDraft()];
    renderDrafts();
    renderCapacityWeeks();
    renderJobsTable();
    renderActiveSidebar();
    saveLocal();
  }

  if (errors.length > 0) {
    showToast(addedCount + ' hozzáadva, ' + errors.length + ' kihagyva. Részletek: ' + errors.join(' | '), true);
  } else {
    showToast(addedCount + ' autó hozzáadva a tervhez.');
  }
});

// Updates the single job currently being edited (see startEditJob) in place,
// re-checking availability with the job's OWN previous booking excluded —
// otherwise it would always "conflict with itself".
function saveEditedJob() {
  const draft = drafts[0];
  const job = jobs.find(j => j.id === editingJobId);
  if (!draft || !job) { exitEditMode(); return; }

  if (!draft.rendszam || !draft.rendszam.trim()) { showToast('Hiányzik a rendszám.', true); return; }
  if (!draft.partnerId) { showToast('Válassz partnert.', true); return; }
  if (!draft.startDate || !draft.endDate) { showToast('Add meg a kezdő és elkészülési dátumot.', true); return; }
  if (draft.endDate < draft.startDate) { showToast('Az elkészülési dátum korábbi, mint a kezdő dátum.', true); return; }

  const partner = sharedData.partners.find(p => p.id === draft.partnerId);
  const damageType = sharedData.damageTypes.find(d => d.id === draft.damageTypeId);
  const rawCost = partner.costs[draft.damageTypeId];
  if (typeof rawCost !== 'number' || rawCost <= 0) { showToast('Ennél a partnernél nincs ár ehhez a sérüléstípushoz.', true); return; }
  let unitCost = rawCost;
  if (CapacityCalc.isVariablePriceValue(rawCost)) {
    unitCost = parseFloat(draft.customPrice);
    if (!(unitCost > 0)) { showToast('Add meg az egyedi árat ehhez a partnerhez.', true); return; }
  }
  const days = CapacityCalc.daysBetweenInclusive(draft.startDate, draft.endDate);
  const workdays = CapacityCalc.countWorkdaysInclusive(draft.startDate, draft.endDate);

  if (damageType && typeof damageType.avgRepairDays === 'number' && workdays > damageType.avgRepairDays) {
    const confirmed = confirm(
      'Biztosan szükséges ennyi munkanap az elkészüléshez? Az átlagos javítási idő ilyen esetekben ' +
      damageType.avgRepairDays + ' nap.'
    );
    if (!confirmed) return;
  }

  const { available, line } = CapacityCalc.checkAvailability({
    partnerId: draft.partnerId, repairLines: partner.repairLines, startDate: draft.startDate, endDate: draft.endDate,
    existingJobs: jobs, excludeJobId: job.id, vacations: partnerVacations,
  });
  if (!available) {
    const onVacation = CapacityCalc.partnerHasVacationOverlap(partnerVacations, draft.partnerId, draft.startDate, draft.endDate);
    showToast(onVacation ? 'A partner szabadságon van ezen az időszakon.' : 'Foglalt kapacitás. Keress másik javítót!', true);
    return;
  }

  job.rendszam = draft.rendszam.trim().toUpperCase();
  job.damageTypeId = draft.damageTypeId;
  job.partnerId = draft.partnerId;
  job.line = line;
  job.startDate = draft.startDate;
  job.endDate = draft.endDate;
  job.days = days;
  job.unitCost = unitCost;
  job.totalCost = unitCost;

  exitEditMode();
  renderCapacityWeeks();
  renderJobsTable();
  renderActiveSidebar();
  saveLocal();
  showToast('Javítás módosítva.');
}

// ---------------- Weekly capacity: per-repair-line day-square grid ----------------

function renderCapacityWeeks() {
  const usage = CapacityCalc.capacityUsageByWeek(jobs, sharedData.partners, weeks, partnerVacations);
  const el = document.getElementById('capacityWeeks');
  el.innerHTML = usage.map(wRow => `
    <div class="week-block">
      <div class="week-title">${wRow.week.label} <span class="range">${wRow.week.rangeLabel}</span></div>
      ${wRow.partners.map((p, pIdx) => `
        <div class="partner-lines ${pIdx > 0 ? 'partner-divider' : ''}">
          <div class="partner-lines-head">
            <span class="pname">${escapeHtml(p.partnerName)}</span>
            ${p.repairLines > 1 ? `<span class="pname-sub">${p.repairLines} javítósor</span>` : ''}
            <button class="btn small ghost vacation-btn" data-role="openVacationModal" data-partner="${p.partnerId}">Szabadság beállítása</button>
          </div>
          ${p.lines.map(line => `
            <div class="line-row">
              ${p.repairLines > 1 ? `<div class="line-label line-color-${((line.lineNumber - 1) % 6) + 1}">${line.lineNumber}. sor</div>` : '<div class="line-label"></div>'}
              <div class="day-grid">
                ${line.days.map(d => {
                  const cls = d.onVacation ? 'vacation' : (d.occupied ? 'occupied line-color-' + (((line.lineNumber - 1) % 6) + 1) : 'free');
                  const title = d.weekdayShort + ' ' + formatDateHu(d.dateStr) + ' — ' + (d.onVacation ? 'szabadság (a partner zárva)' : (d.occupied ? (line.lineNumber + '. sor foglalt') : 'szabad'));
                  return `
                  <div class="day-square ${cls}" title="${title}">
                    <span class="dow">${d.weekdayShort}</span>
                    <span class="dom">${d.dayOfMonth}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `).join('');

  el.querySelectorAll('[data-role="openVacationModal"]').forEach(btn => {
    btn.onclick = () => openVacationModal(btn.dataset.partner);
  });
}

// ---------------- Jobs table ----------------

function renderJobsTable() {
  const tbody = document.getElementById('jobsTableBody');
  const emptyState = document.getElementById('jobsEmptyState');

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
    const sorted = [...jobs].sort((a, b) => a.startDate.localeCompare(b.startDate));
    tbody.innerHTML = sorted.map(j => {
      const d = sharedData.damageTypes.find(x => x.id === j.damageTypeId);
      const p = sharedData.partners.find(x => x.id === j.partnerId);
      return `
        <tr>
          <td>${escapeHtml(j.rendszam || '')}</td>
          <td>${escapeHtml(d ? d.name : j.damageTypeId)}</td>
          <td>${escapeHtml(p ? p.name : j.partnerId)}${j.line ? ' <span class="line-tag">' + j.line + '. sor</span>' : ''}</td>
          <td>${formatDateHu(j.startDate)}</td>
          <td>${formatDateHu(j.endDate)}</td>
          <td class="num">${j.days}</td>
          <td class="num">${formatHUF(j.totalCost)}</td>
          <td><button class="rm-btn" data-id="${j.id}" title="Törlés">✕</button></td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('.rm-btn').forEach(btn => {
      btn.onclick = () => {
        jobs = jobs.filter(j => j.id !== btn.dataset.id);
        renderCapacityWeeks();
        renderJobsTable();
        renderActiveSidebar();
        saveLocal();
      };
    });
  }

  document.getElementById('jobCountLabel').textContent = jobs.length + ' tétel';
  const totalCost = jobs.reduce((s, j) => s + j.totalCost, 0);
  const totalDays = jobs.reduce((s, j) => s + j.days, 0);
  document.getElementById('totalJobsValue').textContent = jobs.length;
  document.getElementById('totalCostValue').textContent = formatHUF(totalCost);
  document.getElementById('totalHoursValue').textContent = formatDays(totalDays);
}

// ---------------- Sidebar: cars currently under repair ----------------

let expandedPartnerGroups = new Set(); // partnerIds currently expanded when they have >3 active cars

function renderActiveSidebar() {
  document.getElementById('headerActiveCount').textContent = jobs.length;

  const todayStr = todayISODate();
  const tomorrowStr = CapacityCalc.toISODateString(CapacityCalc.addDaysUTC(CapacityCalc.toDateOnlyUTC(todayStr), 1));
  document.getElementById('headerDueTodayCount').textContent = jobs.filter(j => j.endDate === todayStr).length;
  document.getElementById('headerDueTomorrowCount').textContent = jobs.filter(j => j.endDate === tomorrowStr).length;

  const list = document.getElementById('activeJobsList');
  const empty = document.getElementById('activeJobsEmpty');

  document.getElementById('activeCountLabel').textContent = jobs.length + ' rendszám';

  if (jobs.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const groups = {};
  jobs.forEach(j => {
    if (!groups[j.partnerId]) groups[j.partnerId] = [];
    groups[j.partnerId].push(j);
  });

  const partnerIds = Object.keys(groups).sort((a, b) => {
    const pa = sharedData.partners.find(p => p.id === a);
    const pb = sharedData.partners.find(p => p.id === b);
    return (pa ? pa.name : a).localeCompare(pb ? pb.name : b);
  });

  list.innerHTML = partnerIds.map(partnerId => {
    const partner = sharedData.partners.find(p => p.id === partnerId);
    const partnerJobs = [...groups[partnerId]].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const isCollapsible = partnerJobs.length > 3;
    const isExpanded = expandedPartnerGroups.has(partnerId);
    const showCards = !isCollapsible || isExpanded;

    return `
      <div class="partner-group">
        <div class="partner-group-head">
          <span class="pg-name">${escapeHtml(partner ? partner.name : partnerId)}</span>
          ${isCollapsible
            ? `<button class="pg-toggle" data-role="togglePartnerGroup" data-partner="${partnerId}">${partnerJobs.length} db futó javítás ${isExpanded ? '▲' : '▼'}</button>`
            : `<span class="pg-count">${partnerJobs.length} db</span>`}
        </div>
        ${showCards ? partnerJobs.map(renderActiveJobCard).join('') : ''}
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-role="completeBtn"]').forEach(btn => {
    btn.onclick = () => openCompleteModal(btn.dataset.id);
  });
  list.querySelectorAll('[data-role="editJobBtn"]').forEach(btn => {
    btn.onclick = () => startEditJob(btn.dataset.id);
  });
  list.querySelectorAll('[data-role="deleteJobBtn"]').forEach(btn => {
    btn.onclick = () => {
      const job = jobs.find(j => j.id === btn.dataset.id);
      if (!job) return;
      const label = (job.rendszam || '—') + (job.startDate ? ' (' + formatDateHu(job.startDate) + ' – ' + formatDateHu(job.endDate) + ')' : '');
      if (!confirm('Biztosan törlöd ezt a javítást: ' + label + '? Ez nem "elkészültként" rögzíti, egyszerűen eltávolítja a listából és minden statisztikából.')) return;
      jobs = jobs.filter(j => j.id !== btn.dataset.id);
      renderCapacityWeeks();
      renderJobsTable();
      renderActiveSidebar();
      renderStatsPanel();
      saveLocal();
      showToast('Javítás törölve.');
    };
  });
  list.querySelectorAll('[data-role="togglePartnerGroup"]').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.partner;
      if (expandedPartnerGroups.has(pid)) expandedPartnerGroups.delete(pid); else expandedPartnerGroups.add(pid);
      renderActiveSidebar();
    };
  });
}

function renderActiveJobCard(j) {
  const d = sharedData.damageTypes.find(x => x.id === j.damageTypeId);
  const colorClass = j.line ? 'line-color-' + (((j.line - 1) % 6) + 1) : '';
  return `
    <div class="active-job-card ${colorClass}">
      <div class="card-top-row">
        <div class="plate">${escapeHtml(j.rendszam || '—')}</div>
        <div class="card-top-actions">
          <button class="icon-edit-btn" data-role="editJobBtn" data-id="${j.id}" title="Javítás szerkesztése" aria-label="Javítás szerkesztése">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="icon-edit-btn" data-role="deleteJobBtn" data-id="${j.id}" title="Javítás törlése" aria-label="Javítás törlése">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </div>
      <div class="meta">${escapeHtml(d ? d.name : '')}${j.line ? ' · <span class="line-tag">' + j.line + '. sor</span>' : ''}<br>${formatDateHu(j.startDate)} – ${formatDateHu(j.endDate)}</div>
      <button class="btn small primary" data-role="completeBtn" data-id="${j.id}">Elkészült</button>
    </div>
  `;
}

// ---------------- Completion modal ----------------

function openCompleteModal(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  pendingCompleteJobId = jobId;
  const d = sharedData.damageTypes.find(x => x.id === job.damageTypeId);
  const p = sharedData.partners.find(x => x.id === job.partnerId);
  document.getElementById('completeModalSubtitle').textContent =
    (job.rendszam || '') + ' — ' + (d ? d.name : '') + ' (' + (p ? p.name : '') + ')';
  document.getElementById('completeDateInput').value = new Date().toISOString().slice(0, 10);
  document.getElementById('completeModalOverlay').classList.add('show');
}

function closeCompleteModal() {
  pendingCompleteJobId = null;
  document.getElementById('completeModalOverlay').classList.remove('show');
}

document.getElementById('completeModalCancel').addEventListener('click', closeCompleteModal);
document.getElementById('completeModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'completeModalOverlay') closeCompleteModal();
});

document.getElementById('completeModalConfirm').addEventListener('click', () => {
  const jobId = pendingCompleteJobId;
  const job = jobs.find(j => j.id === jobId);
  if (!job) { closeCompleteModal(); return; }
  const completedDate = document.getElementById('completeDateInput').value;
  if (!completedDate) { showToast('Add meg az elkészülés dátumát.', true); return; }

  const d = sharedData.damageTypes.find(x => x.id === job.damageTypeId);
  const p = sharedData.partners.find(x => x.id === job.partnerId);

  completedJobs.push({
    id: uid(),
    rendszam: job.rendszam,
    damageTypeId: job.damageTypeId,
    damageTypeName: d ? d.name : job.damageTypeId,
    partnerId: job.partnerId,
    partnerName: p ? p.name : job.partnerId,
    startDate: job.startDate,
    endDate: job.endDate,
    days: job.days,
    totalCost: job.totalCost,
    completedDate,
    loggedAt: new Date().toISOString(),
  });

  jobs = jobs.filter(j => j.id !== jobId); // frees the reserved capacity

  renderCapacityWeeks();
  renderJobsTable();
  renderActiveSidebar();
  renderLog();
  renderStatsPanel();
  saveLocal();
  closeCompleteModal();
  showToast('Javítás elkészültként rögzítve, kapacitás felszabadítva.');
});

// ---------------- Partner vacation ("szabadság") modal ----------------

function openVacationModal(partnerId) {
  const partner = sharedData.partners.find(p => p.id === partnerId);
  if (!partner) return;
  vacationModalPartnerId = partnerId;
  document.getElementById('vacationModalPartnerName').textContent = partner.name;
  const today = todayISODate();
  document.getElementById('vacationStartInput').value = today;
  document.getElementById('vacationEndInput').value = today;
  document.getElementById('vacationConflictWarning').style.display = 'none';
  renderVacationModalList();
  document.getElementById('vacationModalOverlay').classList.add('show');
}

function closeVacationModal() {
  vacationModalPartnerId = null;
  document.getElementById('vacationModalOverlay').classList.remove('show');
}

function renderVacationModalList() {
  const list = document.getElementById('vacationModalList');
  const vacationsForPartner = partnerVacations
    .filter(v => v.partnerId === vacationModalPartnerId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (vacationsForPartner.length === 0) {
    list.innerHTML = '<div class="empty-state small">Nincs rögzített szabadság ennél a partnernél.</div>';
    return;
  }

  list.innerHTML = '<table class="stats-table"><tbody>' + vacationsForPartner.map(v => `
    <tr>
      <td>${formatDateHu(v.startDate)} – ${formatDateHu(v.endDate)}</td>
      <td style="text-align:right;"><button class="rm-btn" data-role="removeVacation" data-id="${v.id}" title="Törlés">✕</button></td>
    </tr>
  `).join('') + '</tbody></table>';

  list.querySelectorAll('[data-role="removeVacation"]').forEach(btn => {
    btn.onclick = () => {
      partnerVacations = partnerVacations.filter(v => v.id !== btn.dataset.id);
      renderVacationModalList();
      renderCapacityWeeks();
      saveLocal();
      showToast('Szabadság törölve.');
    };
  });
}

function updateVacationConflictPreview() {
  const start = document.getElementById('vacationStartInput').value;
  const end = document.getElementById('vacationEndInput').value;
  const warningEl = document.getElementById('vacationConflictWarning');
  if (!vacationModalPartnerId || !start || !end || end < start) { warningEl.style.display = 'none'; return; }

  const conflicting = jobs.filter(j => j.partnerId === vacationModalPartnerId && CapacityCalc.rangesOverlap(j.startDate, j.endDate, start, end));
  if (conflicting.length === 0) { warningEl.style.display = 'none'; return; }

  warningEl.style.display = 'block';
  warningEl.textContent = 'Figyelem: ezen az időszakon már van foglalás — ' +
    conflicting.map(j => j.rendszam).join(', ') + ' — ezeket érdemes átütemezni, de a szabadság rögzíthető.';
}

document.getElementById('vacationStartInput').addEventListener('change', () => {
  const start = document.getElementById('vacationStartInput').value;
  const endInput = document.getElementById('vacationEndInput');
  if (endInput.value < start) endInput.value = start;
  updateVacationConflictPreview();
});
document.getElementById('vacationEndInput').addEventListener('change', updateVacationConflictPreview);

document.getElementById('vacationModalClose').addEventListener('click', closeVacationModal);
document.getElementById('vacationModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'vacationModalOverlay') closeVacationModal();
});

document.getElementById('vacationModalAdd').addEventListener('click', () => {
  const partnerId = vacationModalPartnerId;
  if (!partnerId) return;
  const startDate = document.getElementById('vacationStartInput').value;
  const endDate = document.getElementById('vacationEndInput').value;
  if (!startDate || !endDate) { showToast('Add meg a kezdő és záró dátumot.', true); return; }
  if (endDate < startDate) { showToast('A záró dátum korábbi, mint a kezdő dátum.', true); return; }

  const conflicting = jobs.filter(j => j.partnerId === partnerId && CapacityCalc.rangesOverlap(j.startDate, j.endDate, startDate, endDate));

  partnerVacations.push({ id: uid(), partnerId, startDate, endDate, createdAt: new Date().toISOString() });
  renderVacationModalList();
  renderCapacityWeeks();
  renderDrafts(); // in case a currently-selected partner just became unavailable for the chosen dates
  saveLocal();

  if (conflicting.length > 0) {
    showToast('Szabadság rögzítve — figyelem, ütközik ' + conflicting.map(j => j.rendszam).join(', ') + ' foglalásával, ezeket érdemes átütemezni.', true);
  } else {
    showToast('Szabadság rögzítve.');
  }
});

// ---------------- Completed jobs log ----------------

function renderLog() {
  const tbody = document.getElementById('logTableBody');
  const empty = document.getElementById('logEmptyState');

  document.getElementById('logCountLabel').textContent = completedJobs.length + ' tétel';

  if (completedJobs.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...completedJobs].sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''));
  tbody.innerHTML = sorted.map(c => `
    <tr>
      <td>${escapeHtml(c.rendszam || '')}</td>
      <td>${escapeHtml(c.damageTypeName || '')}</td>
      <td>${escapeHtml(c.partnerName || '')}</td>
      <td>${formatDateHu(c.startDate)} – ${formatDateHu(c.endDate)}</td>
      <td>${escapeHtml(c.completedDate || '')}</td>
      <td class="num">${formatHUF(c.totalCost)}</td>
    </tr>
  `).join('');
}

document.getElementById('showLogBtn').addEventListener('click', () => {
  const panel = document.getElementById('logPanel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------- Mini dashboard: historical average service days ----------------

function renderStatsPanel() {
  const body = document.getElementById('statsPanelBody');
  const stats = CapacityCalc.computeServiceStats(completedJobs, sharedData.damageTypes, sharedData.partners);

  if (stats.overall.count === 0) {
    body.innerHTML = '<div class="empty-state">Még nincs elég adat — a statisztika akkor épül, ha legalább egy javítás "Elkészült"-re lett állítva.</div>';
    return;
  }

  function statTable(rows, labelHeader) {
    if (rows.length === 0) return '<div class="empty-state small">Nincs adat.</div>';
    return `
      <table class="stats-table">
        <thead><tr><th>${labelHeader}</th><th class="num">Db</th><th class="num">Átlag nap</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.count}</td><td class="num">${formatDays(Math.round(r.avgDays * 10) / 10)}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  body.innerHTML = `
    <div class="stats-overall">
      <div class="stats-overall-value">${formatDays(Math.round(stats.overall.avgDays * 10) / 10)}</div>
      <div class="stats-overall-label">átlagos szervizidő — teljes flotta (${stats.overall.count} lezárt javítás alapján)</div>
    </div>
    <div class="grid-cols-2" style="margin-top:14px;">
      <div>
        <div class="stats-subhead">Javítási típusonként</div>
        ${statTable(stats.byDamageType, 'Sérülés típusa')}
      </div>
      <div>
        <div class="stats-subhead">Partnerenként</div>
        ${statTable(stats.byPartner, 'Partner')}
      </div>
    </div>
  `;
}

// ---------------- Bulk Excel import of repair jobs ----------------

// Accepts a JS Date (from XLSX cellDates), an Excel serial number, or a
// 'YYYY-MM-DD' string, and returns a normalized 'YYYY-MM-DD' string.
function parseExcelDateCell(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return CapacityCalc.toISODateString(CapacityCalc.toDateOnlyUTC(value));
  if (typeof value === 'number') {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return CapacityCalc.toISODateString(CapacityCalc.toDateOnlyUTC(new Date(ms)));
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  return s;
}

document.getElementById('bulkImportInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    // Accepts either a plain "Javitasok" sheet, or the "AktivJavitasok" sheet
    // produced by this app's own "Excel export" — same column shape either way.
    const sheetName = wb.SheetNames.includes('Javitasok') ? 'Javitasok'
      : (wb.SheetNames.includes('AktivJavitasok') ? 'AktivJavitasok' : wb.SheetNames[0]);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

    const damageByName = {};
    sharedData.damageTypes.forEach(d => { damageByName[normalizeMatchKey(d.name)] = d; });
    const partnerByName = {};
    sharedData.partners.forEach(p => { partnerByName[normalizeMatchKey(p.name)] = p; });

    let added = 0;
    const errors = [];
    const avgExceededNotes = [];
    const deadlinePending = []; // rows using "LegkesobbiElkeszulesiDatum" instead of fixed dates

    rows.forEach((r, idx) => {
      const rowLabel = (idx + 2) + '. sor';
      const rendszam = String(r.Rendszam ?? r.rendszam ?? '').trim();
      const damageName = String(r.SerulesTipus ?? r.serulesTipus ?? '').trim();
      const partnerName = String(r.Partner ?? r.partner ?? '').trim();
      const startDate = parseExcelDateCell(r.KezdoDatum ?? r.kezdoDatum);
      let endDate = parseExcelDateCell(r.ElkeszulesiDatum ?? r.elkeszulesiDatum);
      const deadlineDate = parseExcelDateCell(r.LegkesobbiElkeszulesiDatum ?? r.legkesobbiElkeszulesiDatum);

      if (!rendszam) { errors.push(rowLabel + ': hiányzik a rendszám.'); return; }
      const damageType = damageByName[normalizeMatchKey(damageName)];
      if (!damageType) { errors.push(rowLabel + ' (' + rendszam + '): ismeretlen sérüléstípus "' + damageName + '".'); return; }

      const manualCostCell = parseFloat(r.EgysegAr ?? r.egysegAr ?? r.Koltseg ?? r.koltseg);
      const manualCost = isNaN(manualCostCell) ? null : manualCostCell;

      // --- Mode 2: no fixed dates, only a deadline — schedule automatically later ---
      if (!startDate && deadlineDate) {
        const partner = partnerName ? partnerByName[normalizeMatchKey(partnerName)] : null;
        if (partnerName && !partner) { errors.push(rowLabel + ' (' + rendszam + '): ismeretlen partner "' + partnerName + '".'); return; }
        deadlinePending.push({ rowLabel, rendszam, damageTypeId: damageType.id, deadlineDate, partnerId: partner ? partner.id : null, manualCost });
        return;
      }

      // --- Mode 1: fixed KezdoDatum (+ optional ElkeszulesiDatum) ---
      if (!startDate) { errors.push(rowLabel + ' (' + rendszam + '): add meg a "KezdoDatum"-ot VAGY a "LegkesobbiElkeszulesiDatum"-ot.'); return; }

      let partner = partnerName ? partnerByName[normalizeMatchKey(partnerName)] : null;
      if (!partner) {
        const options = CapacityCalc.partnerOptionsForDamageType(damageType.id, sharedData.partners);
        if (options.length === 0) { errors.push(rowLabel + ' (' + rendszam + '): egyik partnernél sincs ár ehhez a sérüléstípushoz.'); return; }
        // Prefer a fixed-price partner when auto-selecting, since we have no
        // interactive way to ask for an amount for a variable-price one here
        // unless the row itself already supplied EgysegAr.
        const preferred = manualCost != null ? options[0] : (options.find(o => !o.isVariablePrice) || options[0]);
        partner = sharedData.partners.find(p => p.id === preferred.partnerId);
      }
      const rawCost = partner.costs[damageType.id];
      if (typeof rawCost !== 'number' || rawCost <= 0) { errors.push(rowLabel + ' (' + rendszam + '): "' + partner.name + '"-nál nincs ár (vagy 0 Ft van megadva) ehhez a sérüléstípushoz — nem kínálja ezt a szolgáltatást.'); return; }
      let unitCost = rawCost;
      if (CapacityCalc.isVariablePriceValue(rawCost)) {
        if (manualCost == null || !(manualCost > 0)) {
          errors.push(rowLabel + ' (' + rendszam + '): "' + partner.name + '"-nál egyedi ár szükséges — add meg az "EgysegAr" oszlopban.');
          return;
        }
        unitCost = manualCost;
      }

      if (!endDate) {
        const turnaround = partner.turnaround ? partner.turnaround[damageType.id] : null;
        const suggestedDays = typeof turnaround === 'number' ? Math.max(1, Math.round(turnaround)) : 1;
        endDate = CapacityCalc.addWorkdaysEndDate(startDate, suggestedDays);
      }
      if (endDate < startDate) { errors.push(rowLabel + ' (' + rendszam + '): az elkészülési dátum korábbi, mint a kezdő dátum.'); return; }

      const days = CapacityCalc.daysBetweenInclusive(startDate, endDate);
      const workdays = CapacityCalc.countWorkdaysInclusive(startDate, endDate);

      if (typeof damageType.avgRepairDays === 'number' && workdays > damageType.avgRepairDays) {
        avgExceededNotes.push(rendszam + ': ' + workdays + ' munkanap (átlagos: ' + damageType.avgRepairDays + ' nap) — ellenőrizd, hogy tényleg ennyi idő kell-e.');
      }

      const { available, line } = CapacityCalc.checkAvailability({
        partnerId: partner.id, repairLines: partner.repairLines, startDate, endDate, existingJobs: jobs, vacations: partnerVacations,
      });
      if (!available) {
        const onVacation = CapacityCalc.partnerHasVacationOverlap(partnerVacations, partner.id, startDate, endDate);
        errors.push(rowLabel + ' (' + rendszam + '): ' + (onVacation ? ('"' + partner.name + '" szabadságon van ezen az időszakon.') : ('Foglalt kapacitás "' + partner.name + '"-nál. Keress másik javítót!')));
        return;
      }

      jobs.push({
        id: uid(), rendszam: rendszam.toUpperCase(), damageTypeId: damageType.id, partnerId: partner.id, line,
        startDate, endDate, days, unitCost, totalCost: unitCost,
        createdAt: new Date().toISOString(),
      });
      added++;
    });

    // --- Deadline-mode rows: schedule as a batch, earliest-deadline-first, ---
    // --- trying to fit as many repairs as possible before each one's deadline ---
    if (deadlinePending.length > 0) {
      const { scheduled, failed } = CapacityCalc.scheduleByDeadline({
        pendingItems: deadlinePending.map(p => ({ rendszam: p.rendszam, damageTypeId: p.damageTypeId, deadlineDate: p.deadlineDate, partnerId: p.partnerId, manualCost: p.manualCost })),
        partners: sharedData.partners,
        todayDate: todayISODate(),
        existingJobs: jobs,
        vacations: partnerVacations,
      });

      scheduled.forEach(s => {
        const damageType = sharedData.damageTypes.find(d => d.id === s.damageTypeId);
        const scheduledWorkdays = CapacityCalc.countWorkdaysInclusive(s.startDate, s.endDate);
        if (typeof damageType.avgRepairDays === 'number' && scheduledWorkdays > damageType.avgRepairDays) {
          avgExceededNotes.push(s.rendszam + ': ' + scheduledWorkdays + ' munkanap (átlagos: ' + damageType.avgRepairDays + ' nap) — a partner átfutási ideje haladja meg az átlagot.');
        }
        jobs.push({
          id: uid(), rendszam: s.rendszam.toUpperCase(), damageTypeId: s.damageTypeId, partnerId: s.partnerId, line: s.line,
          startDate: s.startDate, endDate: s.endDate, days: s.days, unitCost: s.unitCost, totalCost: s.unitCost,
          createdAt: new Date().toISOString(),
        });
        added++;
      });
      failed.forEach(f => {
        const original = deadlinePending.find(p => p.rendszam === f.rendszam && p.damageTypeId === f.damageTypeId);
        errors.push((original ? original.rowLabel : '?') + ' (' + f.rendszam + '): ' + f.reason);
      });
    }

    renderCapacityWeeks();
    renderJobsTable();
    renderActiveSidebar();
    renderStatsPanel();
    saveLocal();

    if (errors.length > 0 || avgExceededNotes.length > 0) {
      let msg = 'Import kész: ' + added + ' sor sikeres, ' + errors.length + ' kihagyva.';
      if (errors.length > 0) msg += '\n\nKihagyott sorok:\n' + errors.join('\n');
      if (avgExceededNotes.length > 0) msg += '\n\nFigyelem — az átlagosnál hosszabb javítási idő:\n' + avgExceededNotes.join('\n');
      alert(msg);
    } else {
      showToast(added + ' sor sikeresen importálva.');
    }
  } catch (err) {
    showToast('Hiba az importálás során: ' + err.message, true);
  } finally {
    e.target.value = '';
  }
});

// ---------------- Session export / import (manual cross-machine sync) ----------------

document.getElementById('exportSessionBtn').addEventListener('click', () => {
  const savedAt = new Date().toISOString();
  const savedByName = currentUserFullName();
  const snapshot = { savedAt, user: currentUser, savedBy: savedByName, jobs, completedJobs, partnerVacations };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kapacitastervezes_allapot_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  lastTeamSave = { name: savedByName, at: savedAt };
  renderSyncInfo();
  saveLocal();
  showToast('Állapot elmentve (JSON fájlba) — ezt oszd meg, ha máshonnan is dolgoztok.');
});

document.getElementById('importSessionInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const snapshot = JSON.parse(text);
    if (!Array.isArray(snapshot.jobs) || !Array.isArray(snapshot.completedJobs ?? [])) {
      throw new Error('Érvénytelen fájlformátum.');
    }
    const existingJobIds = new Set(jobs.map(j => j.id));
    const existingCompletedIds = new Set(completedJobs.map(c => c.id));
    const existingVacationIds = new Set(partnerVacations.map(v => v.id));

    let newJobs = 0, newCompleted = 0, newVacations = 0;
    (snapshot.jobs || []).forEach(j => {
      if (!existingJobIds.has(j.id)) { jobs.push(j); newJobs++; }
    });
    (snapshot.completedJobs || []).forEach(c => {
      if (!existingCompletedIds.has(c.id)) { completedJobs.push(c); newCompleted++; }
    });
    (snapshot.partnerVacations || []).forEach(v => {
      if (!existingVacationIds.has(v.id)) { partnerVacations.push(v); newVacations++; }
    });

    // A car might have been marked complete on another machine — remove it from
    // the active list here too, since its capacity is already freed there.
    jobs = jobs.filter(j => !completedJobs.some(c => c.rendszam === j.rendszam && c.damageTypeId === j.damageTypeId && c.startDate === j.startDate && c.partnerId === j.partnerId));

    // The imported file's provenance (who saved it, and when) becomes the
    // header's "last known team save" if it's more recent than what we had.
    if (snapshot.savedAt && snapshot.savedBy && (!lastTeamSave || snapshot.savedAt > lastTeamSave.at)) {
      lastTeamSave = { name: snapshot.savedBy, at: snapshot.savedAt };
    }

    renderCapacityWeeks();
    renderJobsTable();
    renderActiveSidebar();
    renderLog();
    renderStatsPanel();
    renderSyncInfo();
    saveLocal();
    showToast('Betöltve: ' + newJobs + ' új aktív, ' + newCompleted + ' új elkészült, ' + newVacations + ' új szabadság tétel egyesítve.');
  } catch (err) {
    showToast('Nem sikerült betölteni a fájlt: ' + err.message, true);
  } finally {
    e.target.value = '';
  }
});

// ---------------- PDF export ----------------

document.getElementById('exportPdfBtn').addEventListener('click', () => {
  if (jobs.length === 0 && completedJobs.length === 0) {
    showToast('Nincs mit exportálni — adj hozzá legalább egy tervezett javítást.', true);
    return;
  }
  try {
    buildSessionPdf({ weeks, partners: sharedData.partners, jobs, completedJobs, damageTypes: sharedData.damageTypes, username: currentUser });
    showToast('PDF exportálva.');
  } catch (err) {
    showToast('Hiba a PDF előállítása közben: ' + err.message, true);
  }
});

// ---------------- Excel export ----------------

document.getElementById('exportExcelBtn').addEventListener('click', () => {
  if (jobs.length === 0 && completedJobs.length === 0) {
    showToast('Nincs mit exportálni — adj hozzá legalább egy tervezett javítást.', true);
    return;
  }
  try {
    buildSessionExcel({ jobs, completedJobs, partners: sharedData.partners, damageTypes: sharedData.damageTypes, username: currentUser });
    showToast('Excel exportálva.');
  } catch (err) {
    showToast('Hiba az Excel előállítása közben: ' + err.message, true);
  }
});

// ---------------- Outlook naptár (.ics) export ----------------

document.getElementById('exportIcsBtn').addEventListener('click', () => {
  if (jobs.length === 0) {
    showToast('Nincs aktív javítás, amit naptárba lehetne exportálni.', true);
    return;
  }
  try {
    IcsGenerator.downloadIcsCalendar(jobs, sharedData.damageTypes, sharedData.partners);
    showToast('Naptár (.ics) exportálva — importáld Outlookba.');
  } catch (err) {
    showToast('Hiba a naptárfájl előállítása közben: ' + err.message, true);
  }
});
