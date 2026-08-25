// handover.js — top menu navigation between the app's 3 screens, and the
// "Átadás-átvétel" (handover) form: vehicle data, equipment/tire tables,
// damage diagram, per-defect damage cards (with attached photos), GPS
// location stamp, signatures, and PDF report generation.

// ---------------- Menu + screen navigation ----------------

document.getElementById('menuToggleBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('menuDropdown').classList.toggle('show');
});
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('menuDropdown');
  if (dropdown.classList.contains('show') && !dropdown.contains(e.target) && e.target.id !== 'menuToggleBtn') {
    dropdown.classList.remove('show');
  }
});
document.querySelectorAll('[data-role="navTo"]').forEach(btn => {
  btn.addEventListener('click', () => {
    showAppScreen(btn.dataset.screen);
    document.getElementById('menuDropdown').classList.remove('show');
  });
});

function showAppScreen(name) {
  const screens = { capacity: 'capacityScreen', movementLog: 'movementLogScreen', handover: 'handoverScreen' };
  Object.entries(screens).forEach(([key, id]) => {
    document.getElementById(id).style.display = key === name ? 'block' : 'none';
  });
  document.querySelectorAll('[data-role="navTo"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === name);
  });

  // The header-counts pills, sync info, and session/export buttons only
  // apply to the Kapacitás tervező — hide them on the other two tabs, so
  // only the brand, greeting, menu, and logout remain visible there.
  const isCapacity = name === 'capacity';
  document.querySelectorAll('.header-counts, .sync-info, [data-role="capacityOnlyAction"]').forEach(el => {
    el.style.display = isCapacity ? '' : 'none';
  });

  if (name === 'handover') initHandoverFormOnce();
}

// ---------------- Handover form state ----------------

let hoInitialized = false;
let hoCarMarks = [];    // [{x, y}] click positions on the car diagram
// hoDamageRows: [{id, hely, tipus, javitasModja, rogzitve, javitasSzukseges, photos: [{dataUrl, caption}]}]
let hoDamageRows = [];
// hoKartortenetRows: [{id, hely, tipus, megjegyzes, javitva, photos: [{dataUrl, caption}]}]
let hoKartortenetRows = [];
const HO_TIRE_POSITIONS = [
  { kod: 'BE', nev: 'Bal eleje' },
  { kod: 'JE', nev: 'Jobb eleje' },
  { kod: 'BH', nev: 'Bal hátulja' },
  { kod: 'JH', nev: 'Jobb hátulja' },
];

function initHandoverFormOnce() {
  if (hoInitialized) return;
  hoInitialized = true;

  const today = todayISODate();
  document.getElementById('hoLejelentve').value = today;
  document.getElementById('hoElszallitva').value = today;
  document.getElementById('hoServiceIdopontja').value = today;
  document.getElementById('hoSzemleIdopontja').value = today;
  if (typeof currentUserFullName === 'function') {
    const fullName = currentUserFullName();
    document.getElementById('hoSzemlezo').value = fullName;
    document.getElementById('hoInspektorNev').value = fullName;
  }

  // Default Átadó (handover-side company) details — prefilled but still
  // freely editable, since this is almost always the same company.
  document.getElementById('hoAtadoNev').value = 'Wallis Autókölcsönző Kft.';
  document.getElementById('hoAtadoSzekhely').value = '1138 Budapest, Váci út 141.';
  document.getElementById('hoAtadoAdoszam').value = '12712234-2-42';

  applyModeVisibility();
  document.querySelectorAll('input[name="hoMode"]').forEach(radio => {
    radio.addEventListener('change', applyModeVisibility);
  });

  applyBlockToggles();
  document.querySelectorAll('[data-role="hoBlockToggle"]').forEach(cb => {
    cb.addEventListener('change', applyBlockToggles);
  });

  // Convenience: mirror the representative's name into the signature-name
  // field as a starting point, without overwriting a manual edit there.
  const mirrorNameToSig = (sourceId, targetId) => {
    document.getElementById(sourceId).addEventListener('input', (e) => {
      const target = document.getElementById(targetId);
      if (!target.dataset.userEdited) target.value = e.target.value;
    });
    document.getElementById(targetId).addEventListener('input', (e) => { e.target.dataset.userEdited = '1'; });
  };
  mirrorNameToSig('hoAtadoKepviselo', 'hoSigAtadoNev');
  mirrorNameToSig('hoAtvevoKepviselo', 'hoSigAtvevoNev');
  mirrorNameToSig('hoInspektorNev', 'hoSigInspektorNev');

  const nincsSzerzodesCb = document.getElementById('hoNincsSzerzodes');
  const szerzodesInput = document.getElementById('hoSzerzodesszam');
  nincsSzerzodesCb.addEventListener('change', () => {
    if (nincsSzerzodesCb.checked) {
      szerzodesInput.value = 'Nincs hozzárendelt szerződés';
      szerzodesInput.disabled = true;
    } else {
      szerzodesInput.value = '';
      szerzodesInput.disabled = false;
    }
  });

  renderFelszereltsegChecklist();
  renderTartozekokChecklist();
  renderTireTable();
  renderDamageCards();
  renderKartortenetCards();
  renderMarkerPalette();
  drawCarDiagram();
  renderMarksList();
  setupSignaturePad('hoSigAtado');
  setupSignaturePad('hoSigAtvevo');
  setupSignaturePad('hoSigInspektor');
  setupRendszamAutocomplete();

  // Start loading every vehicle type's images now (not just the currently
  // selected one) — by the time the user picks a type and clicks "Riport
  // generálása", they're already loaded (or well on their way).
  Object.keys(HO_VEHICLE_IMAGE_ASSETS).forEach(vt => hoPreloadVehicleImages(vt));
}

// ---------------- Rendszám autocomplete (Excel-driven vehicle lookup) ----------------
//
// window.VEHICLE_LOOKUP is a plain, unencrypted array of vehicle records
// (loaded from assets/data/vehicle-lookup.js, generated by the admin tool's
// Excel import — no encryption, since this is just technical vehicle data,
// not personal/confidential information). As the user types a rendszám,
// matching records are shown in a live dropdown, filtered to a 90-day
// window around each record's "tervezettLeadas" (planned drop-off) date —
// that field itself is never shown in the form or the PDF.

function hoNormalizePlate(s) {
  // Strips whitespace AND common separators (dash, dot) so "AIBD904",
  // "AIBD-904", and "AIBD 904" are all treated as the same plate — people
  // type plates with or without the dash pretty inconsistently in practice.
  return String(s || '').toUpperCase().replace(/[\s\-.]+/g, '');
}

function hoIsWithinLeadasWindow(record) {
  if (!record.tervezettLeadas) return true; // no date given — always show
  const leadas = new Date(record.tervezettLeadas);
  if (isNaN(leadas.getTime())) return true;
  const windowEnd = new Date(leadas.getTime() + 90 * 24 * 60 * 60 * 1000);
  const today = new Date();
  return today <= windowEnd;
}

function hoFillVehicleFields(record) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && v !== undefined && v !== null && v !== '') el.value = v;
  };
  set('hoAlvazszam', record.alvazszam);
  set('hoMotorszam', record.motorszam);
  set('hoInternalSzam', record.internalSzam);
  set('hoGyartmany', record.markak);
  set('hoModell', record.tipus);
  set('hoMotorjeloles', record.motorjeloles);
  set('hoKarosszeria', record.kivitel);
  set('hoSebessegvalto', record.sebessegvalto);
  set('hoSzin', record.szin);
  set('hoHengerurtartalom', record.hengerurtartalom);
  set('hoMotorTipus', record.uzemanyag);
  set('hoTeljesitmeny', record.teljesitmeny);
  set('hoOnsuly', record.onsuly);
  set('hoOsszsuly', record.osszsuly);
  set('hoGyartasiEv', record.gyartasiEv);
  set('hoElsoForgalomba', record.elsoForgalomba);
  set('hoForgalmiSzam', record.forgalmiSzam);
  set('hoMuszakiErvenyesseg', record.muszakiErvenyesseg);

  if (record.abroncsMeret) {
    document.querySelectorAll('[data-role="hoTireField"][data-field="meret"]').forEach(el => {
      el.value = record.abroncsMeret;
    });
  }
  if (record.felniTipus) {
    document.querySelectorAll('[data-role="hoTireField"][data-field="felniTipus"]').forEach(el => {
      if ([...el.options].some(o => o.value === record.felniTipus)) el.value = record.felniTipus;
    });
  }
  if (record.abroncsMarka) {
    document.querySelectorAll('[data-role="hoTireField"][data-field="abroncsMarka"]').forEach(el => {
      el.value = record.abroncsMarka;
    });
  }

  hoMergeChecklistFromExcel(record.felszereltseg, 'hoFelszereltsegList', 'hoFelszereltseg', (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.felszereltsegek) || []);
  hoMergeChecklistFromExcel(record.tartozekok, 'hoTartozekokList', 'hoTartozek', (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.tartozekok) || []);
}

// Checks off any known checklist items (Felszereltség/Tartozékok) that the
// vehicle database lists for this specific car, and appends any unknown
// items as extra, pre-checked entries tagged "Excel". Nothing in either
// checklist is checked by default anymore — only what actually comes from
// the vehicle database for the matched plate.
function hoMergeChecklistFromExcel(rawValue, checklistElId, dataRole, knownItems) {
  if (!rawValue) return;
  const listed = String(rawValue).split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const checklistEl = document.getElementById(checklistElId);
  if (!checklistEl) return;
  const extras = [];
  listed.forEach(item => {
    const match = knownItems.find(k => k.toLowerCase() === item.toLowerCase());
    if (match) {
      const cb = checklistEl.querySelector('[data-role="' + dataRole + '"][data-name="' + match.replace(/"/g, '\\"') + '"]');
      if (cb) cb.checked = true;
    } else {
      extras.push(item);
    }
  });
  extras.forEach(name => {
    if (checklistEl.querySelector('[data-name="' + name.replace(/"/g, '\\"') + '"]')) return; // already added
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-role="${dataRole}" data-name="${escapeHtml(name)}" checked> ${escapeHtml(name)} <span class="ho-excel-tag">Excel</span>`;
    checklistEl.appendChild(label);
  });
}

function setupRendszamAutocomplete() {
  const input = document.getElementById('hoRendszam');
  const list = document.getElementById('hoRendszamSuggestions');
  if (!input || !list) return;

  function renderSuggestions(matches) {
    if (matches.length === 0) { list.classList.remove('show'); list.innerHTML = ''; return; }
    list.innerHTML = matches.map(m => `
      <div class="ho-autocomplete-item" data-plate="${escapeHtml(m.rendszam)}">
        <span class="plate">${escapeHtml(m.rendszam)}</span>
        <span class="desc">${escapeHtml([m.markak, m.tipus].filter(Boolean).join(' '))}</span>
      </div>
    `).join('');
    list.classList.add('show');
    list.querySelectorAll('.ho-autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const plate = item.dataset.plate;
        input.value = plate;
        list.classList.remove('show');
        const record = (window.VEHICLE_LOOKUP || []).find(r => hoNormalizePlate(r.rendszam) === hoNormalizePlate(plate));
        if (record) hoFillVehicleFields(record);
      });
    });
  }

  input.addEventListener('input', () => {
    const query = hoNormalizePlate(input.value);
    if (!query) { list.classList.remove('show'); return; }
    const matches = (window.VEHICLE_LOOKUP || [])
      .filter(r => hoIsWithinLeadasWindow(r))
      .filter(r => hoNormalizePlate(r.rendszam).includes(query))
      .slice(0, 8);
    renderSuggestions(matches);
  });

  input.addEventListener('blur', () => {
    // Small delay so a click on a suggestion registers before we hide the list.
    setTimeout(() => {
      list.classList.remove('show');
      const exact = (window.VEHICLE_LOOKUP || []).find(r => hoNormalizePlate(r.rendszam) === hoNormalizePlate(input.value));
      if (exact) hoFillVehicleFields(exact);
    }, 150);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) list.classList.remove('show');
  });
}

// ---------------- 3-way mode switch (Átadás-átvétel / Állapotfelmérés / Kombinált) ----------------

function hoGetMode() {
  const checked = document.querySelector('input[name="hoMode"]:checked');
  return checked ? checked.value : 'atadas';
}

function applyModeVisibility() {
  const mode = hoGetMode();
  document.querySelectorAll('[data-ho-modes]').forEach(el => {
    const modes = el.dataset.hoModes.split(' ');
    el.style.display = modes.includes(mode) ? '' : 'none';
  });
  // :has() has good but not universal support — keep a JS-driven class in sync too.
  document.querySelectorAll('#hoModeSwitch label').forEach(label => {
    const input = label.querySelector('input');
    label.classList.toggle('active', input.checked);
  });
}

// ---------------- Per-block "Releváns" toggles (sections 3-8) ----------------

function applyBlockToggles() {
  document.querySelectorAll('[data-role="hoBlockToggle"]').forEach(cb => {
    const body = document.querySelector('[data-block-body="' + cb.dataset.block + '"]');
    if (body) body.style.display = cb.checked ? '' : 'none';
  });
}

function hoIsBlockRelevant(blockKey) {
  if (hoGetMode() === 'kartortenet') return false; // these sections don't apply to the Kártörténet mode
  const cb = document.querySelector('[data-role="hoBlockToggle"][data-block="' + blockKey + '"]');
  return !cb || cb.checked; // no toggle found = always relevant
}

// ---------------- Felszereltség / Tartozékok checklists ----------------

function renderFelszereltsegChecklist() {
  const list = document.getElementById('hoFelszereltsegList');
  const items = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.felszereltsegek) || [];
  list.innerHTML = items.map(item => `
    <label><input type="checkbox" data-role="hoFelszereltseg" data-name="${escapeHtml(item)}"> ${escapeHtml(item)}</label>
  `).join('');
}

function renderTartozekokChecklist() {
  const list = document.getElementById('hoTartozekokList');
  const items = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.tartozekok) || [];
  list.innerHTML = items.map(item => `
    <label><input type="checkbox" data-role="hoTartozek" data-name="${escapeHtml(item)}"> ${escapeHtml(item)}</label>
  `).join('');
}

// ---------------- Abroncsok (tires) table ----------------

function renderTireTable() {
  const tbody = document.getElementById('hoTireTableBody');
  tbody.innerHTML = HO_TIRE_POSITIONS.map(pos => `
    <tr data-tire="${pos.kod}">
      <td>${escapeHtml(pos.kod)} — ${escapeHtml(pos.nev)}</td>
      <td>
        <select data-role="hoTireField" data-tire="${pos.kod}" data-field="felniTipus">
          <option value="" selected>— nincs megadva —</option>
          <option value="Könnyűfém">Könnyűfém</option>
          <option value="Acél">Acél</option>
        </select>
      </td>
      <td><input type="text" data-role="hoTireField" data-tire="${pos.kod}" data-field="meret" placeholder="pl. 245/45R19"></td>
      <td><input type="text" data-role="hoTireField" data-tire="${pos.kod}" data-field="abroncsMarka" placeholder="pl. Continental"></td>
      <td class="num"><input type="number" min="0" max="20" step="0.1" data-role="hoTireField" data-tire="${pos.kod}" data-field="menetmelyseg" style="text-align:right;"></td>
    </tr>
  `).join('');
}

function getTireData() {
  const data = {};
  HO_TIRE_POSITIONS.forEach(pos => {
    data[pos.kod] = { felniTipus: '', meret: '', abroncsMarka: '', menetmelyseg: '' };
  });
  document.querySelectorAll('[data-role="hoTireField"]').forEach(el => {
    data[el.dataset.tire][el.dataset.field] = el.value;
  });
  return data;
}

// ---------------- Car damage diagram (canvas): 5-panel unfolded view ----------------
//
// A generic, code-drawn hatchback-style silhouette (front / rear / left side /
// right side / top), NOT a licensed KIA Ceed technical drawing — approximated
// from scratch since no real reference artwork was available.

const HO_PANELS = {
  left: { x: 20, y: 20, w: 860, h: 210, label: 'Bal oldalnézet' },
  right: { x: 20, y: 250, w: 860, h: 210, label: 'Jobb oldalnézet' },
  top: { x: 20, y: 480, w: 860, h: 210, label: 'Felülnézet' },
  front: { x: 20, y: 710, w: 420, h: 210, label: 'Elölnézet' },
  rear: { x: 460, y: 710, w: 420, h: 210, label: 'Hátulnézet' },
};

const HO_MARKER_TYPES = [
  { key: 'horpadas', label: 'Horpadás', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
  { key: 'karc', label: 'Karc', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><line x1="3" y1="15" x2="9" y2="4" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="16" x2="14" y2="5" stroke="currentColor" stroke-width="1.6"/><line x1="13" y1="17" x2="19" y2="6" stroke="currentColor" stroke-width="1.6"/></svg>' },
  { key: 'tores', label: 'Törés', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" stroke-width="2"/><line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" stroke-width="2"/></svg>' },
  { key: 'polir', label: 'Polír sérülés', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><path d="M1 7 Q4 3 7 7 T13 7 T19 7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1 13 Q4 9 7 13 T13 13 T19 13" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' },
  { key: 'kavics', label: 'Kavicsfelverődés', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="4" fill="currentColor" stroke="none"/></svg>' },
  { key: 'hianyzo', label: 'Hiányzik/hiányos', icon: '<svg class="ho-marker-icon" viewBox="0 0 20 20"><text x="10" y="15" font-size="15" font-weight="700" text-anchor="middle" fill="currentColor">?</text></svg>' },
];
let hoActiveMarkerType = HO_MARKER_TYPES[0].key;

function renderMarkerPalette() {
  const el = document.getElementById('hoMarkerPalette');
  el.innerHTML = HO_MARKER_TYPES.map(m => `
    <button type="button" class="ho-marker-btn ${m.key === hoActiveMarkerType ? 'active' : ''}" data-role="hoMarkerType" data-type="${m.key}">
      ${m.icon} ${escapeHtml(m.label)}
    </button>
  `).join('');
  el.querySelectorAll('[data-role="hoMarkerType"]').forEach(btn => {
    btn.addEventListener('click', () => {
      hoActiveMarkerType = btn.dataset.type;
      renderMarkerPalette();
    });
  });
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// drawPanelLabel, HO_VEHICLE_PROFILES, drawFrontOrRearPanel, drawTopPanel,
// drawSidePanel, HO_VEHICLE_IMAGE_ASSETS, hoGetOrLoadImage,
// hoDrawImageContain, and drawVehiclePanel now live in vehicle-diagrams.js
// (shared with the zone-editor tool) — see that file for the drawing logic.

function drawMark(ctx, mark) {
  const { x, y, type } = mark;
  ctx.strokeStyle = '#ff5000';
  ctx.lineWidth = 2;
  if (type === 'horpadas') {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'karc') {
    [-6, 0, 6].forEach(offset => {
      ctx.beginPath();
      ctx.moveTo(x - 7 + offset, y - 7);
      ctx.lineTo(x + 7 + offset, y + 7);
      ctx.stroke();
    });
  } else if (type === 'tores') {
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
    ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7);
    ctx.stroke();
  } else if (type === 'polir') {
    [-4, 4].forEach(dy => {
      ctx.beginPath();
      ctx.moveTo(x - 9, y + dy);
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        ctx.lineTo(x - 9 + 18 * t, y + dy + 4 * Math.sin(t * Math.PI * 2));
      }
      ctx.stroke();
    });
  } else if (type === 'kavics') {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'hianyzo') {
    ctx.fillStyle = '#ff5000';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// Renders just ONE panel (e.g. only "Bal oldalnézet"), with only the marks
// that belong to it, onto a small offscreen canvas sized to that panel's own
// dimensions — used by the PDF export so only views with an actual marked
// damage get included, cropped to that view instead of the full 5-panel sheet.
function hoBuildPanelCropCanvas(panelKey, vehicleType) {
  const panel = HO_PANELS[panelKey];
  if (!panel) return null;
  const canvas = document.createElement('canvas');
  canvas.width = panel.w;
  canvas.height = panel.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const localBox = { x: 0, y: 0, w: panel.w, h: panel.h };
  drawVehiclePanel(ctx, panelKey, localBox, vehicleType, () => {}); // image is already cached by now
  hoCarMarks
    .filter(m => (m.panel || 'top') === panelKey)
    .forEach(m => drawMark(ctx, { ...m, x: m.x - panel.x, y: m.y - panel.y }));
  return canvas;
}

function drawCarDiagram() {
  const canvas = document.getElementById('hoCarCanvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const vehicleType = document.getElementById('hoVehicleType').value;
  Object.keys(HO_PANELS).forEach(key => {
    drawVehiclePanel(ctx, key, HO_PANELS[key], vehicleType, drawCarDiagram);
  });
  Object.values(HO_PANELS).forEach(p => drawPanelLabel(ctx, p));

  hoCarMarks.forEach(m => drawMark(ctx, m));
}

(function wireCarDiagram() {
  const canvas = document.getElementById('hoCarCanvas');
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const panelKey = Object.keys(HO_PANELS).find(key => {
      const p = HO_PANELS[key];
      return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    }) || 'top';
    hoCarMarks.push({ x, y, type: hoActiveMarkerType, panel: panelKey });
    drawCarDiagram();
    renderMarksList();
  });
  document.getElementById('hoUndoMarkBtn').addEventListener('click', () => {
    hoCarMarks.pop();
    drawCarDiagram();
    renderMarksList();
  });
  document.getElementById('hoClearMarksBtn').addEventListener('click', () => {
    hoCarMarks = [];
    drawCarDiagram();
    renderMarksList();
  });
  document.getElementById('hoVehicleType').addEventListener('change', () => {
    if (hoCarMarks.length > 0) {
      const keep = confirm('A jármű típusának váltásakor a korábbi jelölések helyzete már nem biztos, hogy illik a rajzra. Törlöd a jelöléseket? (Mégse = megtartja őket.)');
      if (keep) hoCarMarks = [];
    }
    drawCarDiagram();
    renderMarksList();
  });
})();

// Standard ray-casting point-in-polygon test. `point` is [x, y], `polygon`
// is an array of [x, y] pairs, both in the same (normalized 0-1) coordinate
// space.
function hoPointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = (yi > py) !== (yj > py) &&
      px < (xj - xi) * (py - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Turns a raw {x, y, type, panel} mark into a human-readable Hungarian
// description like "Horpadás, jobb oldal, első ajtó, alsó rész". If a
// precise zone configuration was defined for this vehicle type + panel
// (via tools/zone-editor.html, loaded as window.HO_ZONE_CONFIG), the exact
// admin-named zone is used instead of the generic position heuristic below.
function hoClassifyMark(mark) {
  const typeLabel = (HO_MARKER_TYPES.find(t => t.key === mark.type) || {}).label || mark.type;
  const panelKey = mark.panel || 'top';
  const panel = HO_PANELS[panelKey];
  if (!panel) return typeLabel;

  const relX = (mark.x - panel.x) / panel.w;
  const relY = (mark.y - panel.y) / panel.h;

  const vehicleType = document.getElementById('hoVehicleType').value;
  const zones = window.HO_ZONE_CONFIG && window.HO_ZONE_CONFIG[vehicleType] && window.HO_ZONE_CONFIG[vehicleType][panelKey];
  if (zones && zones.length) {
    const hit = zones.find(z => hoPointInPolygon([relX, relY], z.points));
    if (hit) return typeLabel + ', ' + hit.name;
  }

  const vertLabel = relY < 0.5 ? 'felső rész' : 'alsó rész';
  let oldalLabel, zonaLabel;
  if (panelKey === 'left' || panelKey === 'right') {
    oldalLabel = panelKey === 'left' ? 'bal oldal' : 'jobb oldal';
    if (relX < 0.25) zonaLabel = 'elülső lökhárító';
    else if (relX < 0.5) zonaLabel = 'első ajtó';
    else if (relX < 0.75) zonaLabel = 'hátsó ajtó';
    else zonaLabel = 'hátsó lökhárító / csomagtér';
  } else if (panelKey === 'front' || panelKey === 'rear') {
    oldalLabel = relX < 0.5 ? 'bal oldal' : 'jobb oldal';
    zonaLabel = panelKey === 'front' ? 'elülső lökhárító' : 'hátsó lökhárító';
  } else {
    oldalLabel = relX < 0.5 ? 'bal oldal' : 'jobb oldal';
    zonaLabel = relY < 0.33 ? 'motorháztető / szélvédő' : (relY < 0.67 ? 'tetőrész' : 'csomagtértető');
  }
  return typeLabel + ', ' + oldalLabel + ', ' + zonaLabel + ', ' + vertLabel;
}

function renderMarksList() {
  const container = document.getElementById('hoMarksList');
  if (!container) return;
  const jegkarChecked = document.getElementById('hoJegkarCheckbox') && document.getElementById('hoJegkarCheckbox').checked;
  const jegkarMertek = document.getElementById('hoJegkarMerteke') ? document.getElementById('hoJegkarMerteke').value.trim() : '';
  const jegkarLine = jegkarChecked ? 'Jégkár' + (jegkarMertek ? ' — ' + jegkarMertek : '') : null;

  if (hoCarMarks.length === 0 && !jegkarLine) {
    container.innerHTML = '<div class="ho-mark-empty">Nincs jelölt sérülés a rajzon.</div>';
    return;
  }
  const rows = hoCarMarks.map((m) => hoClassifyMark(m));
  if (jegkarLine) rows.push(jegkarLine);
  container.innerHTML = rows.map((text, i) => `<div class="ho-mark-row">${i + 1}. ${escapeHtml(text)}</div>`).join('');
}

(function wireJegkarToggle() {
  const cb = document.getElementById('hoJegkarCheckbox');
  const field = document.getElementById('hoJegkarMerteke');
  if (!cb || !field) return;
  cb.addEventListener('change', () => {
    field.style.display = cb.checked ? '' : 'none';
    renderMarksList();
  });
  field.addEventListener('input', renderMarksList);
})();

// ---------------- Signature pads ----------------

function setupSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = '#1b1b1f';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  let drawing = false;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  }
  canvas.addEventListener('pointerdown', (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  window.addEventListener('pointerup', () => { drawing = false; });
}

document.querySelectorAll('[data-role="clearSig"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const canvas = document.getElementById(btn.dataset.target);
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
});

// ---------------- Damage cards ("Nem elfogadható hibák") — each with its own photos ----------------

// ---------------- Image compression (keeps the final PDF well under 5 MB) ----------------

// Loads a data URL into an <img>, downsizes it to at most maxDim on its long
// side, and re-encodes as JPEG at the given quality. Large camera photos
// (often several MB each) would otherwise bloat the exported PDF — this
// keeps each embedded photo to roughly 60-250 KB while still looking sharp
// at the "half page" print size used in the report. Returns
// { dataUrl, aspect } (aspect = width/height, needed to lay the photo out
// correctly in the PDF without distorting it).
function compressImageDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
    const safetyTimer = setTimeout(() => settle({ dataUrl, aspect: 4 / 3 }), 6000);

    const img = new Image();
    img.onload = () => {
      clearTimeout(safetyTimer);
      const aspect = img.naturalWidth / img.naturalHeight || 1;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) {
        if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
        else { w = Math.round(w * (maxDim / h)); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { settle({ dataUrl, aspect }); return; }
      ctx.fillStyle = '#ffffff'; // JPEG has no alpha — flatten onto white first
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        settle({ dataUrl: canvas.toDataURL('image/jpeg', quality || 0.75), aspect });
      } catch (err) {
        settle({ dataUrl, aspect }); // fall back to the original if re-encoding fails
      }
    };
    img.onerror = () => { clearTimeout(safetyTimer); settle({ dataUrl, aspect: 4 / 3 }); };
    img.src = dataUrl;
  });
}

function renderDamageCards() {
  const container = document.getElementById('hoDamageCards');
  const helyek = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.serulesHelyek) || [];
  const tipusok = HO_MARKER_TYPES.map(m => m.label);
  const modok = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.javitasModjai) || [];

  if (hoDamageRows.length === 0) {
    container.innerHTML = '<div class="empty-state small">Nincs rögzített sérülés.</div>';
    return;
  }

  container.innerHTML = hoDamageRows.map(row => `
    <div class="ho-damage-card" data-row="${row.id}">
      <div class="form-row">
        <div><label>Hely</label>
          <select data-role="hoRowField" data-row="${row.id}" data-field="hely">
            ${helyek.map(h => `<option value="${escapeHtml(h.kod)}" ${row.hely === h.kod ? 'selected' : ''}>${escapeHtml(h.kod)} — ${escapeHtml(h.nev)}</option>`).join('')}
          </select>
        </div>
        <div><label>Sérülés megnevezése</label>
          <select data-role="hoRowField" data-row="${row.id}" data-field="tipus">
            ${tipusok.map(t => `<option value="${escapeHtml(t)}" ${row.tipus === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div><label>Javítás módja</label>
          <select data-role="hoRowField" data-row="${row.id}" data-field="javitasModja">
            ${modok.map(m => `<option value="${escapeHtml(m)}" ${row.javitasModja === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><label>Átnézéskor rögzítve?</label>
          <select data-role="hoRowField" data-row="${row.id}" data-field="rogzitve">
            <option value="IGEN" ${row.rogzitve === 'IGEN' ? 'selected' : ''}>IGEN</option>
            <option value="NEM" ${row.rogzitve === 'NEM' ? 'selected' : ''}>NEM</option>
          </select>
        </div>
        <div><label>Leadás előtt javítás szükséges?</label>
          <select data-role="hoRowField" data-row="${row.id}" data-field="javitasSzukseges">
            <option value="IGEN" ${row.javitasSzukseges === 'IGEN' ? 'selected' : ''}>IGEN</option>
            <option value="NEM" ${row.javitasSzukseges === 'NEM' ? 'selected' : ''}>NEM</option>
          </select>
        </div>
      </div>
      <div class="ho-photo-add-row">
        <label class="file-input-label">
          📷 Fotó készítése
          <input type="file" accept="image/*" capture="environment" data-role="hoDamagePhotoInput" data-row="${row.id}">
        </label>
        <label class="file-input-label">
          + Kép feltöltése (galéria/mappa)
          <input type="file" accept="image/jpeg,image/png" data-role="hoDamagePhotoInput" data-row="${row.id}">
        </label>
      </div>
      <div class="ho-photo-preview">
        ${row.photos.map((p, i) => `
          <div>
            <img src="${p.dataUrl}" class="ho-photo-thumb" alt="sérülés fotó">
            <input type="text" value="${escapeHtml(p.caption)}" placeholder="Felirat / megjegyzés" data-role="hoDamagePhotoCaption" data-row="${row.id}" data-index="${i}">
            <button class="rm-btn" data-role="hoDamagePhotoRemove" data-row="${row.id}" data-index="${i}">✕ kép törlése</button>
          </div>
        `).join('')}
      </div>
      <button class="btn ghost small" data-role="hoRemoveRow" data-row="${row.id}" style="margin-top:10px;">✕ Sérülés törlése</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-role="hoRowField"]').forEach(el => {
    el.addEventListener('input', () => {
      const row = hoDamageRows.find(r => String(r.id) === el.dataset.row);
      if (!row) return;
      row[el.dataset.field] = el.dataset.field === 'felszOsszeg' ? (parseFloat(el.value) || 0) : el.value;
    });
  });
  container.querySelectorAll('[data-role="hoRemoveRow"]').forEach(btn => {
    btn.addEventListener('click', () => {
      hoDamageRows = hoDamageRows.filter(r => String(r.id) !== btn.dataset.row);
      renderDamageCards();
    });
  });
  container.querySelectorAll('[data-role="hoDamagePhotoInput"]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const row = hoDamageRows.find(r => String(r.id) === input.dataset.row);
      if (!row) return;
      const rawDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { dataUrl, aspect } = await compressImageDataUrl(rawDataUrl, 1200, 0.75);
      row.photos.push({ dataUrl, aspect, caption: '' });
      renderDamageCards();
    });
  });
  container.querySelectorAll('[data-role="hoDamagePhotoCaption"]').forEach(input => {
    input.addEventListener('input', () => {
      const row = hoDamageRows.find(r => String(r.id) === input.dataset.row);
      const idx = parseInt(input.dataset.index, 10);
      if (row && row.photos[idx]) row.photos[idx].caption = input.value;
    });
  });
  container.querySelectorAll('[data-role="hoDamagePhotoRemove"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = hoDamageRows.find(r => String(r.id) === btn.dataset.row);
      const idx = parseInt(btn.dataset.index, 10);
      if (row) row.photos.splice(idx, 1);
      renderDamageCards();
    });
  });
}

document.getElementById('hoAddDamageRowBtn').addEventListener('click', () => {
  const helyek = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.serulesHelyek) || [];
  const modok = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.javitasModjai) || [];
  hoDamageRows.push({
    id: uid(),
    hely: helyek[0] ? helyek[0].kod : '',
    tipus: HO_MARKER_TYPES[0].label,
    javitasModja: modok[0] || '',
    rogzitve: 'IGEN',
    javitasSzukseges: 'NEM',
    photos: [],
  });
  renderDamageCards();
});

// ---------------- Kártörténet — kártörténeti sérülés-kártyák ----------------
//
// Reuses the same photo-add (camera+gallery) mechanism as "Sérülések
// fotókkal", and the same damage-type list as the marking palette — but
// instead of a "javítás szükséges?" question, this has a free-text comment
// field and a settable "javítva van-e" (already repaired) toggle.

function renderKartortenetCards() {
  const container = document.getElementById('hoKartortenetCards');
  if (!container) return;
  const helyek = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.serulesHelyek) || [];
  const tipusok = HO_MARKER_TYPES.map(m => m.label);

  if (hoKartortenetRows.length === 0) {
    container.innerHTML = '<div class="empty-state small">Nincs rögzített sérülés a kártörténetben.</div>';
    return;
  }

  container.innerHTML = hoKartortenetRows.map(row => `
    <div class="ho-damage-card" data-row="${row.id}">
      <div class="form-row">
        <div><label>Hely</label>
          <select data-role="hoKartortenetRowField" data-row="${row.id}" data-field="hely">
            ${helyek.map(h => `<option value="${escapeHtml(h.kod)}" ${row.hely === h.kod ? 'selected' : ''}>${escapeHtml(h.kod)} — ${escapeHtml(h.nev)}</option>`).join('')}
          </select>
        </div>
        <div><label>Sérülés megnevezése</label>
          <select data-role="hoKartortenetRowField" data-row="${row.id}" data-field="tipus">
            ${tipusok.map(t => `<option value="${escapeHtml(t)}" ${row.tipus === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div><label>Javítva van?</label>
          <select data-role="hoKartortenetRowField" data-row="${row.id}" data-field="javitva">
            <option value="IGEN" ${row.javitva === 'IGEN' ? 'selected' : ''}>IGEN</option>
            <option value="NEM" ${row.javitva === 'NEM' ? 'selected' : ''}>NEM</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div style="flex:1;"><label>Megjegyzés</label>
          <textarea data-role="hoKartortenetRowField" data-row="${row.id}" data-field="megjegyzes" rows="2" style="width:100%;" placeholder="Szabad szöveges megjegyzés a sérülésről...">${escapeHtml(row.megjegyzes)}</textarea>
        </div>
      </div>
      <div class="ho-photo-add-row">
        <label class="file-input-label">
          📷 Fotó készítése
          <input type="file" accept="image/*" capture="environment" data-role="hoKartortenetPhotoInput" data-row="${row.id}">
        </label>
        <label class="file-input-label">
          + Kép feltöltése (galéria/mappa)
          <input type="file" accept="image/jpeg,image/png" data-role="hoKartortenetPhotoInput" data-row="${row.id}">
        </label>
      </div>
      <div class="ho-photo-preview">
        ${row.photos.map((p, i) => `
          <div>
            <img src="${p.dataUrl}" class="ho-photo-thumb" alt="sérülés fotó">
            <input type="text" value="${escapeHtml(p.caption)}" placeholder="Felirat / megjegyzés" data-role="hoKartortenetPhotoCaption" data-row="${row.id}" data-index="${i}">
            <button class="rm-btn" data-role="hoKartortenetPhotoRemove" data-row="${row.id}" data-index="${i}">✕ kép törlése</button>
          </div>
        `).join('')}
      </div>
      <button class="btn ghost small" data-role="hoRemoveKartortenetRow" data-row="${row.id}" style="margin-top:10px;">✕ Sérülés törlése</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-role="hoKartortenetRowField"]').forEach(el => {
    el.addEventListener('input', () => {
      const row = hoKartortenetRows.find(r => String(r.id) === el.dataset.row);
      if (row) row[el.dataset.field] = el.value;
    });
  });
  container.querySelectorAll('[data-role="hoRemoveKartortenetRow"]').forEach(btn => {
    btn.addEventListener('click', () => {
      hoKartortenetRows = hoKartortenetRows.filter(r => String(r.id) !== btn.dataset.row);
      renderKartortenetCards();
    });
  });
  container.querySelectorAll('[data-role="hoKartortenetPhotoInput"]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const row = hoKartortenetRows.find(r => String(r.id) === input.dataset.row);
      if (!row) return;
      const rawDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { dataUrl, aspect } = await compressImageDataUrl(rawDataUrl, 1200, 0.75);
      row.photos.push({ dataUrl, aspect, caption: '' });
      renderKartortenetCards();
    });
  });
  container.querySelectorAll('[data-role="hoKartortenetPhotoCaption"]').forEach(input => {
    input.addEventListener('input', () => {
      const row = hoKartortenetRows.find(r => String(r.id) === input.dataset.row);
      const idx = parseInt(input.dataset.index, 10);
      if (row && row.photos[idx]) row.photos[idx].caption = input.value;
    });
  });
  container.querySelectorAll('[data-role="hoKartortenetPhotoRemove"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = hoKartortenetRows.find(r => String(r.id) === btn.dataset.row);
      const idx = parseInt(btn.dataset.index, 10);
      if (row) row.photos.splice(idx, 1);
      renderKartortenetCards();
    });
  });
}

const hoAddKartortenetRowBtnEl = document.getElementById('hoAddKartortenetRowBtn');
if (hoAddKartortenetRowBtnEl) {
  hoAddKartortenetRowBtnEl.addEventListener('click', () => {
    const helyek = (window.HANDOVER_CONFIG && window.HANDOVER_CONFIG.serulesHelyek) || [];
    hoKartortenetRows.push({
      id: uid(),
      hely: helyek[0] ? helyek[0].kod : '',
      tipus: HO_MARKER_TYPES[0].label,
      megjegyzes: '',
      javitva: 'NEM',
      photos: [],
    });
    renderKartortenetCards();
  });
}


// ---------------- GPS location stamp + reverse geocoding (postal address) ----------------
//
// Google's Geocoding API needs a billed API key we don't have — this uses
// OpenStreetMap's free, keyless Nominatim reverse-geocoding service instead,
// which gives the same practical result (postal code / street / house
// number from GPS coordinates). If a real Google Maps API key becomes
// available, swap this call for Google's Geocoding API endpoint.
async function hoReverseGeocode(lat, lon) {
  const hintEl = document.getElementById('hoCimHint');
  try {
    const resp = await fetch(
      'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon + '&zoom=18&addressdetails=1',
      { headers: { 'Accept-Language': 'hu' } }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const addr = data.address || {};
    document.getElementById('hoCimIranyitoszam').value = addr.postcode || '';
    document.getElementById('hoCimUtca').value = addr.road || addr.pedestrian || addr.residential || '';
    document.getElementById('hoCimHazszam').value = addr.house_number || '';
    hintEl.textContent = 'Cím automatikusan kitöltve (OpenStreetMap Nominatim alapján) — szükség esetén felülírható.';
  } catch (err) {
    hintEl.textContent = 'A postai cím automatikus kikeresése nem sikerült — add meg kézzel, ha szükséges.';
  }
}

document.getElementById('hoGetLocationBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('A böngésző nem támogatja a helymeghatározást.', true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);
      document.getElementById('hoLocation').value = lat + ', ' + lon;
      showToast('Helyzet meghatározva.');
      hoReverseGeocode(lat, lon);
    },
    (err) => {
      showToast('Nem sikerült meghatározni a helyzetet: ' + err.message, true);
    }
  );
});

// ---------------- PDF report generation ----------------

// Ensures every image this vehicle type needs (front/rear/left/right/top)
// is fully loaded before we try to draw it — otherwise, if the report is
// generated before an image finishes loading, that view's PDF export would
// silently come out blank (only the mark visible, no car outline).
function hoPreloadVehicleImages(vehicleType) {
  const assets = HO_VEHICLE_IMAGE_ASSETS[vehicleType];
  if (!assets) return Promise.resolve(); // vector-drawn type — nothing to preload
  const urls = Object.values(assets);
  return Promise.all(urls.map(url => new Promise(resolve => {
    const check = () => {
      const img = hoGetOrLoadImage(url, resolve);
      if (img) resolve();
    };
    check();
    // hoGetOrLoadImage's own onload will call resolve() again if still
    // loading — resolve() is idempotent on a Promise, so that's safe.
  })));
}

// ---------------- Állapotfelmérés/Átadás-átvétel mentése és betöltése ----------------
//
// Lets an inspector fill out an "Állapotfelmérés" on-site, save the entire
// form as a .json file, and later reopen it (even in a different session)
// to switch the mode to "Kombinált"/"Átadás-átvétel" and finish it as a
// full handover document — nothing entered so far gets lost.

function hoExportStateData() {
  const state = { fields: {}, mode: null, blockToggles: {}, tires: getTireData(), marks: hoCarMarks, damageRows: hoDamageRows, kartortenetRows: hoKartortenetRows, checklist: {}, signatures: {} };

  document.querySelectorAll('#handoverScreen input[id^="ho"], #handoverScreen select[id^="ho"], #handoverScreen textarea[id^="ho"]').forEach(el => {
    if (el.type === 'checkbox') state.fields[el.id] = el.checked;
    else if (el.type !== 'radio' && el.type !== 'file') state.fields[el.id] = el.value;
  });

  const modeChecked = document.querySelector('input[name="hoMode"]:checked');
  state.mode = modeChecked ? modeChecked.value : 'atadas';

  document.querySelectorAll('[data-role="hoBlockToggle"]').forEach(cb => {
    state.blockToggles[cb.dataset.block] = cb.checked;
  });

  state.checklist.felszereltseg = [...document.querySelectorAll('[data-role="hoFelszereltseg"]')].map(cb => ({ name: cb.dataset.name, checked: cb.checked }));
  state.checklist.tartozekok = [...document.querySelectorAll('[data-role="hoTartozek"]')].map(cb => ({ name: cb.dataset.name, checked: cb.checked }));

  ['hoSigAtado', 'hoSigAtvevo', 'hoSigInspektor'].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas && typeof canvas.toDataURL === 'function') {
      try { state.signatures[id] = canvas.toDataURL('image/png'); } catch (err) { /* ignore */ }
    }
  });

  return state;
}

function hoImportStateData(state) {
  if (!state || typeof state !== 'object') throw new Error('Érvénytelen mentés-fájl.');

  if (state.mode) {
    const radio = document.querySelector('input[name="hoMode"][value="' + state.mode + '"]');
    if (radio) radio.checked = true;
  }

  Object.keys(state.fields || {}).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!state.fields[id];
    else el.value = state.fields[id];
  });

  // Vehicle-type-dependent UI (tire table DOM, car diagram) must be rebuilt
  // AFTER hoVehicleType's value is restored above.
  renderTireTable();
  renderFelszereltsegChecklist();
  renderTartozekokChecklist();

  Object.keys(state.blockToggles || {}).forEach((block) => {
    const cb = document.querySelector('[data-role="hoBlockToggle"][data-block="' + block + '"]');
    if (cb) cb.checked = !!state.blockToggles[block];
  });
  applyModeVisibility();
  applyBlockToggles();

  if (state.tires) {
    Object.keys(state.tires).forEach((tireKod) => {
      Object.keys(state.tires[tireKod] || {}).forEach((field) => {
        const el = document.querySelector('[data-role="hoTireField"][data-tire="' + tireKod + '"][data-field="' + field + '"]');
        if (el) el.value = state.tires[tireKod][field];
      });
    });
  }

  (state.checklist && state.checklist.felszereltseg || []).forEach((item) => {
    const cb = document.querySelector('[data-role="hoFelszereltseg"][data-name="' + item.name.replace(/"/g, '\\"') + '"]');
    if (cb) cb.checked = !!item.checked;
  });
  (state.checklist && state.checklist.tartozekok || []).forEach((item) => {
    const cb = document.querySelector('[data-role="hoTartozek"][data-name="' + item.name.replace(/"/g, '\\"') + '"]');
    if (cb) cb.checked = !!item.checked;
  });

  hoCarMarks = Array.isArray(state.marks) ? state.marks : [];
  drawCarDiagram();
  renderMarksList();

  hoDamageRows = Array.isArray(state.damageRows) ? state.damageRows : [];
  renderDamageCards();
  renderKartortenetCards();

  hoKartortenetRows = Array.isArray(state.kartortenetRows) ? state.kartortenetRows : [];
  renderKartortenetCards();

  Object.keys(state.signatures || {}).forEach((id) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = state.signatures[id];
  });
}

const hoSaveStateBtnEl = document.getElementById('hoSaveStateBtn');
if (hoSaveStateBtnEl) {
  hoSaveStateBtnEl.addEventListener('click', () => {
    const state = hoExportStateData();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const rendszamPart = (document.getElementById('hoRendszam').value || 'jarmu').replace(/[^a-zA-Z0-9-]/g, '');
    a.href = url;
    a.download = 'allapotfelmeres_' + rendszamPart + '_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Mentve — a fájl később betölthető és folytatható/bővíthető.');
  });
}

const hoLoadStateInputEl = document.getElementById('hoLoadStateInput');
if (hoLoadStateInputEl) {
  hoLoadStateInputEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const state = JSON.parse(text);
      hoImportStateData(state);
      showToast('Betöltve — a mód váltásával (pl. Kombinált) bővítheted átadás-átvételi jegyzőkönyvvé.');
    } catch (err) {
      showToast('Hiba a fájl betöltése közben: ' + err.message, true);
    }
    e.target.value = '';
  });
}


document.getElementById('hoGenerateReportBtn').addEventListener('click', async () => {
  if (!document.getElementById('hoRendszam').value.trim()) {
    showToast('Add meg legalább a rendszámot.', true);
    return;
  }
  if (hoGetMode() !== 'kartortenet' && !document.getElementById('hoLegalAck').checked) {
    showToast('A jogi nyilatkozat elfogadása nélkül nem generálható riport.', true);
    return;
  }
  try {
    await hoPreloadVehicleImages(document.getElementById('hoVehicleType').value);
    buildHandoverPdf();
    showToast('PDF létrehozva.');
    const restartBtn = document.getElementById('hoStartNewCarBtn');
    if (restartBtn) restartBtn.disabled = false;
  } catch (err) {
    showToast('Hiba a riport előállítása közben: ' + err.message, true);
  }
});

// Resets the entire form so the same screen can be reused for the next
// vehicle, without leaving any stale data from the previous handover behind.
function hoResetFormForNewCar() {
  if (!confirm('Biztosan új autóval kezded? Minden jelenlegi adat (kitöltött mezők, jelölések, fotók) elvész, ha nem mentetted el.')) return;

  document.querySelectorAll('#handoverScreen input[id^="ho"], #handoverScreen select[id^="ho"], #handoverScreen textarea[id^="ho"]').forEach((el) => {
    if (el.type === 'checkbox') el.checked = false;
    else if (el.type === 'file') el.value = '';
    else if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  document.querySelectorAll('[data-role="hoBlockToggle"]').forEach((cb) => { cb.checked = true; });
  document.querySelector('input[name="hoMode"][value="atadas"]').checked = true;

  hoCarMarks = [];
  hoDamageRows = [];
  hoKartortenetRows = [];
  document.getElementById('hoJegkarMerteke').style.display = 'none';

  ['hoSigAtado', 'hoSigAtvevo', 'hoSigInspektor'].forEach((id) => {
    const canvas = document.getElementById(id);
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  applyModeVisibility();
  applyBlockToggles();
  renderFelszereltsegChecklist();
  renderTartozekokChecklist();
  renderTireTable();
  renderDamageCards();
  renderKartortenetCards();
  renderMarkerPalette();
  drawCarDiagram();
  renderMarksList();

  // Defaults that should always be re-applied, matching the initial load.
  const today = todayISODate();
  document.getElementById('hoLejelentve').value = today;
  document.getElementById('hoElszallitva').value = today;
  document.getElementById('hoServiceIdopontja').value = today;
  document.getElementById('hoSzemleIdopontja').value = today;
  if (typeof currentUserFullName === 'function') {
    const fullName = currentUserFullName();
    document.getElementById('hoSzemlezo').value = fullName;
    document.getElementById('hoInspektorNev').value = fullName;
  }
  document.getElementById('hoAtadoNev').value = 'Wallis Autókölcsönző Kft.';
  document.getElementById('hoAtadoSzekhely').value = '1138 Budapest, Váci út 141.';
  document.getElementById('hoAtadoAdoszam').value = '12712234-2-42';

  document.getElementById('hoStartNewCarBtn').disabled = true;
  document.getElementById('hoRendszam').scrollIntoView({ block: 'center' });
  showToast('Új autóval kezdheted — az űrlap kiürült.');
}

const hoStartNewCarBtnEl = document.getElementById('hoStartNewCarBtn');
if (hoStartNewCarBtnEl) hoStartNewCarBtnEl.addEventListener('click', hoResetFormForNewCar);

function buildHandoverPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', window.FONT_DejaVuSans);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');

  const marginX = 40;
  let y = 50;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentW = pageWidth - marginX * 2;
  const RULE = [222, 222, 222];
  const TEXT_DARK = [26, 26, 26];
  const TEXT_MUTED = [94, 94, 94];
  const BRAND = [255, 80, 0];

  function ensureSpace(next) {
    if (y + next > pageHeight - 44) {
      doc.addPage();
      doc.setFont('DejaVuSans', 'normal');
      y = 50;
    }
  }

  // Bold black title with a thin rule underneath — dense, formal-document
  // style (matches the real SIXT rental agreement / price sheet), not a
  // colored banner or a soft grey card.
  function sectionTitle(text) {
    ensureSpace(26);
    doc.setFontSize(11.5);
    doc.setTextColor(...TEXT_DARK);
    doc.text(text.toUpperCase(), marginX, y);
    y += 6;
    doc.setDrawColor(...TEXT_DARK);
    doc.setLineWidth(0.8);
    doc.line(marginX, y, marginX + contentW, y);
    y += 12;
  }

  // A dense label/value table: label left (muted), value right-aligned
  // (dark, bold-ish), a thin grey rule under each row. No background fill —
  // mirrors the "License plate: ... AOLP-631" rows in the real documents.
  function fieldCard(rows) {
    const rowH = 14.5;
    doc.setFontSize(9);
    rows.forEach(row => {
      const valueText = String(row.value == null || row.value === '' ? 'na.' : row.value);
      const valueLines = doc.splitTextToSize(valueText, contentW * 0.6);
      const thisRowH = Math.max(rowH, valueLines.length * 11.5 + 4);
      ensureSpace(thisRowH + 6);
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(row.label, marginX, y + 9);
      doc.setTextColor(...TEXT_DARK);
      valueLines.forEach((l, li) => doc.text(l, marginX + contentW, y + 9 + li * 11.5, { align: 'right' }));
      y += thisRowH;
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.5);
      doc.line(marginX, y, marginX + contentW, y);
      y += 5;
    });
    y += 8;
  }

  // A flowing grid of small, equal-height, content-width "tiles" — each one
  // "Label: Value" — wrapping to a new row as needed. Used for the
  // data-dense sections (Felek, Jármű adatok) instead of one-row-per-field.
  function chipGrid(rows) {
    const chipH = 24, chipGapX = 8, chipGapY = 8, padX = 10;
    const available = contentW - padX * 2;
    doc.setFontSize(9);
    const chips = rows.map(r => {
      const value = (r.value == null || r.value === '') ? 'na.' : String(r.value);
      let text = r.label + ': ' + value;
      let textW = doc.getTextWidth(text);
      if (textW > available) {
        while (textW > available && text.length > 4) {
          text = text.slice(0, -1);
          textW = doc.getTextWidth(text + '…');
        }
        text += '…';
        textW = doc.getTextWidth(text);
      }
      return { text, w: textW + padX * 2 };
    });
    ensureSpace(chipH + chipGapY);
    let cursorX = marginX;
    chips.forEach(chip => {
      if (cursorX + chip.w > marginX + contentW && cursorX > marginX) {
        cursorX = marginX;
        y += chipH + chipGapY;
        ensureSpace(chipH + chipGapY);
      }
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.6);
      doc.roundedRect(cursorX, y, chip.w, chipH, 5, 5, 'S');
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_DARK);
      doc.text(chip.text, cursorX + padX, y + chipH / 2 + 3);
      cursorX += chip.w + chipGapX;
    });
    y += chipH + 14;
  }

  // A 2-column checklist: ✓/✕ + name, thin rule under each row pair.
  function checklistCard(items) {
    const rowH = 14.5;
    const colW = contentW / 2;
    const rowCount = Math.ceil(items.length / 2) || 1;
    for (let r = 0; r < rowCount; r++) {
      ensureSpace(rowH + 6);
      [0, 1].forEach(col => {
        const idx = r * 2 + col;
        if (idx >= items.length) return;
        const it = items[idx];
        const cx = marginX + col * colW;
        doc.setFontSize(9);
        if (it.checked) { doc.setTextColor(31, 122, 77); doc.text('✓', cx, y + 9); }
        else { doc.setTextColor(180, 180, 180); doc.text('✕', cx, y + 9); }
        doc.setTextColor(...TEXT_DARK);
        doc.text(doc.splitTextToSize(it.name, colW - 20)[0] || it.name, cx + 14, y + 9);
      });
      y += rowH;
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.5);
      doc.line(marginX, y, marginX + contentW, y);
      y += 5;
    }
    y += 8;
  }

  // A highlighted total line, in brand orange — mirrors the real documents'
  // "Sum gross: 518.81 EUR" treatment (colored text, no box).
  function bigNumberCard(label, value, sub) {
    ensureSpace(30);
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text(label.toUpperCase(), marginX, y + 9);
    doc.setFontSize(13);
    doc.text(value, marginX + contentW, y + 9, { align: 'right' });
    y += 16;
    if (sub) {
      doc.setFontSize(8.3);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(sub, marginX, y);
      y += 11;
    }
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1);
    doc.line(marginX, y, marginX + contentW, y);
    y += 10;
  }

  // Draws a small vector icon for the damage-marker legend, mirroring the
  // canvas drawMark() shapes using jsPDF's own drawing primitives.
  function drawLegendIcon(doc, type, cx, cy) {
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1.1);
    if (type === 'horpadas') {
      doc.circle(cx, cy, 4, 'S');
    } else if (type === 'karc') {
      [-3, 0, 3].forEach(o => doc.line(cx - 3 + o, cy - 3, cx + 3 + o, cy + 3));
    } else if (type === 'tores') {
      doc.line(cx - 4, cy - 4, cx + 4, cy + 4);
      doc.line(cx + 4, cy - 4, cx - 4, cy + 4);
    } else if (type === 'polir') {
      doc.line(cx - 4, cy - 1, cx, cy - 3);
      doc.line(cx, cy - 3, cx + 4, cy - 1);
      doc.line(cx - 4, cy + 3, cx, cy + 1);
      doc.line(cx, cy + 1, cx + 4, cy + 3);
    } else if (type === 'kavics') {
      doc.setFillColor(26, 26, 26);
      doc.circle(cx, cy, 2, 'F');
    } else if (type === 'hianyzo') {
      doc.setFontSize(11);
      doc.setFont('DejaVuSans', 'normal');
      doc.setTextColor(...BRAND);
      doc.text('?', cx, cy + 3, { align: 'center' });
    }
  }

  // One rounded card per recorded damage — header row + details + its own photos.
  function damageCard(row, index) {
    const padX = 16, padY = 13, headerH = 16, detailH = 14;
    const photoGap = 16, rowGap = 14, maxPhotoH = 260;
    const leftColW = (contentW - padX * 2 - photoGap) / 2;
    const rightColW = leftColW;

    const photoLayout = row.photos.map(p => {
      const aspect = p.aspect || 4 / 3;
      const imgH = Math.min(maxPhotoH, leftColW / aspect);
      const captionLines = p.caption ? doc.splitTextToSize(p.caption, rightColW) : [];
      const captionH = captionLines.length * 11;
      return { imgH, captionLines, rowH: Math.max(imgH, captionH) };
    });
    const photosH = photoLayout.reduce((sum, p) => sum + p.rowH + rowGap, 0);
    const cardH = padY * 2 + headerH + detailH + (photosH > 0 ? photosH + 4 : 0);
    ensureSpace(cardH + 14);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, marginX + contentW, y);

    doc.setFontSize(10.5);
    doc.setTextColor(...TEXT_DARK);
    doc.text((index + 1) + '. ' + row.hely + ' — ' + row.tipus, marginX, y + padY + 8);

    doc.setFontSize(8.8);
    doc.setTextColor(...TEXT_MUTED);
    const details = 'Javítás módja: ' + row.javitasModja + '   ·   Rögzítve: ' + row.rogzitve +
      '   ·   Javítás szükséges: ' + row.javitasSzukseges;
    doc.text(details, marginX + padX, y + padY + 8 + headerH);

    let py = y + padY + headerH + detailH + 10;
    row.photos.forEach((p, i) => {
      const layout = photoLayout[i];
      const imgX = marginX + padX;
      const capX = marginX + padX + leftColW + photoGap;
      try { doc.addImage(p.dataUrl, imgX, py, leftColW, layout.imgH); } catch (err) { /* unsupported format — skip */ }
      if (layout.captionLines.length) {
        doc.setFontSize(9);
        doc.setTextColor(...TEXT_MUTED);
        doc.text(layout.captionLines, capX, py + 11);
      }
      py += layout.rowH + rowGap;
    });

    y += cardH + 16;
  }

  function kartortenetDamageCard(row, index) {
    const padX = 16, padY = 13, headerH = 16;
    const photoGap = 16, rowGap = 14, maxPhotoH = 260;
    const leftColW = (contentW - padX * 2 - photoGap) / 2;
    const rightColW = leftColW;

    const megjegyzesLines = row.megjegyzes ? doc.splitTextToSize(row.megjegyzes, contentW - padX * 2) : ['na.'];
    const detailH = megjegyzesLines.length * 11 + 4;

    const photoLayout = row.photos.map(p => {
      const aspect = p.aspect || 4 / 3;
      const imgH = Math.min(maxPhotoH, leftColW / aspect);
      const captionLines = p.caption ? doc.splitTextToSize(p.caption, rightColW) : [];
      const captionH = captionLines.length * 11;
      return { imgH, captionLines, rowH: Math.max(imgH, captionH) };
    });
    const photosH = photoLayout.reduce((sum, p) => sum + p.rowH + rowGap, 0);
    const cardH = padY * 2 + headerH + detailH + (photosH > 0 ? photosH + 4 : 0);
    ensureSpace(cardH + 14);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, marginX + contentW, y);

    doc.setFontSize(10.5);
    doc.setTextColor(...TEXT_DARK);
    doc.text((index + 1) + '. ' + row.hely + ' — ' + row.tipus, marginX, y + padY + 8);
    doc.setFontSize(9);
    if (row.javitva === 'IGEN') doc.setTextColor(31, 122, 77);
    else doc.setTextColor(...TEXT_MUTED);
    doc.text('Javítva: ' + (row.javitva || 'NEM'), marginX + contentW - 70, y + padY + 8);

    doc.setFontSize(8.8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(megjegyzesLines, marginX + padX, y + padY + 8 + headerH);

    let py = y + padY + headerH + detailH + 10;
    row.photos.forEach((p, i) => {
      const layout = photoLayout[i];
      const imgX = marginX + padX;
      const capX = marginX + padX + leftColW + photoGap;
      try { doc.addImage(p.dataUrl, imgX, py, leftColW, layout.imgH); } catch (err) { /* unsupported format — skip */ }
      if (layout.captionLines.length) {
        doc.setFontSize(9);
        doc.setTextColor(...TEXT_MUTED);
        doc.text(layout.captionLines, capX, py + 11);
      }
      py += layout.rowH + rowGap;
    });

    y += cardH + 16;
  }

  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
  const mode = hoGetMode();
  const showHandoverFields = mode === 'atadas' || mode === 'kombinalt';
  const showInspectorFields = mode === 'allapotfelmeres' || mode === 'kombinalt' || mode === 'kartortenet';
  const showKartortenetFields = mode === 'kartortenet';
  const modeTitles = { atadas: 'Átadás-átvételi jegyzőkönyv', allapotfelmeres: 'Állapotfelmérés', kombinalt: 'Állapotfelmérés és átadás-átvételi jegyzőkönyv', kartortenet: 'Kártörténet' };

  const rendszamRaw = val('hoRendszam') || 'ATADAS';
  const reportId = 'SIXT/' + rendszamRaw.replace(/\s+/g, '').toUpperCase() + '/' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // ---- Header: logo on its own line, bold black title below (matches the
  // real SIXT rental agreement layout) — thin rule closes off the header. ----
  const brandKey = val('hoBrandSelect') || 'sixt';
  const brandLogos = {
    sixt: { dataUrl: window.SIXT_LOGO_POS_DATAURL, dark: false, w: 85, h: 35 },
    sixtplus: { dataUrl: window.SIXT_PLUS_LOGO_DATAURL, dark: false, w: 90, h: 29.5 },
    sixtride: { dataUrl: window.SIXT_RIDE_LOGO_DATAURL, dark: false, w: 90, h: 23 },
    // Limousine/chauffeur assets are "negative" (white wordmark) — only
    // legible on a dark background, so a small dark chip is drawn behind
    // them here to keep the logo readable on the PDF's white page.
    limousine: { dataUrl: window.SIXT_LIMOUSINE_LOGO_DATAURL, dark: true, w: 90, h: 22 },
    chauffeur: { dataUrl: window.SIXT_CHAUFFEUR_LOGO_DATAURL, dark: true, w: 90, h: 22 },
  };
  const selectedBrand = brandLogos[brandKey] || brandLogos.sixt;
  if (selectedBrand.dataUrl) {
    const logoW = selectedBrand.w, logoH = selectedBrand.h;
    if (selectedBrand.dark) {
      doc.setFillColor(26, 26, 26);
      doc.roundedRect(marginX - 6, y - 26, logoW + 12, logoH + 10, 4, 4, 'F');
    }
    try { doc.addImage(selectedBrand.dataUrl, 'PNG', marginX, y - 22, logoW, logoH); } catch (err) { /* ignore */ }
  }
  y += 32;
  doc.setFontSize(16);
  doc.setTextColor(...TEXT_DARK);
  doc.text((modeTitles[mode] || modeTitles.atadas).toUpperCase() + ' ' + rendszamRaw.toUpperCase(), marginX, y);
  y += 18;
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(reportId + '   ·   Generálva: ' + new Date().toLocaleString('hu-HU'), marginX, y);
  y += 10;
  doc.setDrawColor(...TEXT_DARK);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, marginX + contentW, y);
  y += 20;

  sectionTitle('1. Felek és azonosítás');
  if (showHandoverFields) {
    fieldCard([
      { label: 'Megrendelő', value: val('hoMegrendelo') },
      { label: 'Átadó — Jogi személy', value: val('hoAtadoNev') },
      { label: 'Átadó — Székhely', value: val('hoAtadoSzekhely') },
      { label: 'Átadó — Adószám', value: val('hoAtadoAdoszam') },
      { label: 'Átadó — Képviselő', value: val('hoAtadoKepviselo') + (val('hoAtadoTelefon') ? ' · ' + val('hoAtadoTelefon') : '') + (val('hoAtadoEmail') ? ' · ' + val('hoAtadoEmail') : '') },
      { label: 'Átvevő — Jogi személy', value: val('hoAtvevoNev') },
      { label: 'Átvevő — Székhely', value: val('hoAtvevoSzekhely') },
      { label: 'Átvevő — Adószám', value: val('hoAtvevoAdoszam') },
      { label: 'Átvevő — Képviselő', value: val('hoAtvevoKepviselo') + (val('hoAtvevoTelefon') ? ' · ' + val('hoAtvevoTelefon') : '') + (val('hoAtvevoEmail') ? ' · ' + val('hoAtvevoEmail') : '') },
    ]);
  }
  if (showKartortenetFields) {
    fieldCard([
      { label: 'Megrendelés oka', value: val('hoKartortenetOk') },
      { label: 'Igénylő neve', value: val('hoKartortenetIgenylo') },
      { label: 'Átadó — Jogi személy', value: val('hoAtadoNev') },
      { label: 'Átadó — Székhely', value: val('hoAtadoSzekhely') },
      { label: 'Átadó — Adószám', value: val('hoAtadoAdoszam') },
      { label: 'Átadó — Képviselő', value: val('hoAtadoKepviselo') + (val('hoAtadoTelefon') ? ' · ' + val('hoAtadoTelefon') : '') + (val('hoAtadoEmail') ? ' · ' + val('hoAtadoEmail') : '') },
    ]);
  }
  if (showInspectorFields) {
    fieldCard([
      { label: 'Megrendelő', value: (showHandoverFields || showKartortenetFields) ? undefined : val('hoMegrendelo') },
      { label: 'Inspekciót végző', value: val('hoInspektorNev') },
      { label: 'Képviselt szervezet', value: val('hoInspektorSzervezet') },
      { label: 'Elérhetőség', value: (val('hoInspektorEmail') || 'na.') + ' · ' + (val('hoInspektorTelefon') || 'na.') },
    ].filter(r => r.value !== undefined));
  }

  sectionTitle('2. Jármű adatok');
  const vehicleRows = [
    { label: 'Rendszám', value: val('hoRendszam') },
    { label: 'Alvázszám', value: val('hoAlvazszam') },
    { label: 'Motorszám', value: val('hoMotorszam') },
    { label: 'Internal szám', value: val('hoInternalSzam') },
    { label: 'Szerződésszám', value: val('hoSzerzodesszam') },
    { label: 'Márka', value: val('hoGyartmany') },
    { label: 'Típus', value: val('hoModell') },
    { label: 'Motorjelölés', value: val('hoMotorjeloles') },
    { label: 'Kivitel (karosszéria)', value: val('hoKarosszeria') },
    { label: 'Sebességváltó', value: val('hoSebessegvalto') },
    { label: 'Meghajtás', value: val('hoMeghajtas') },
    { label: 'Trim / felszereltségi szint', value: val('hoKivitel') },
    { label: 'Gyártási év', value: val('hoGyartasiEv') },
    { label: 'Szín', value: val('hoSzin') },
    { label: 'Üzemanyag', value: val('hoMotorTipus') },
    { label: 'Hengerűrtartalom', value: val('hoHengerurtartalom') ? val('hoHengerurtartalom') + ' cm³' : '' },
    { label: 'Teljesítmény', value: val('hoTeljesitmeny') ? val('hoTeljesitmeny') + ' kW' : '' },
    { label: 'Önsúly', value: val('hoOnsuly') ? val('hoOnsuly') + ' kg' : '' },
    { label: 'Össztömeg', value: val('hoOsszsuly') ? val('hoOsszsuly') + ' kg' : '' },
    { label: 'Első forgalomba helyezés', value: val('hoElsoForgalomba') },
    { label: 'Forgalmi engedély száma', value: val('hoForgalmiSzam') },
    { label: 'Műszaki vizsga érvényessége', value: val('hoMuszakiErvenyesseg') },
    { label: 'Km-óra állása', value: val('hoKmOra') ? val('hoKmOra') + ' km' : '' },
    { label: 'Üzemanyagszint', value: val('hoUzemanyag') },
  ];
  chipGrid(vehicleRows);

  if (showHandoverFields) {
    fieldCard([
      { label: 'Lejelentve', value: val('hoLejelentve') },
      { label: 'Lejelentő neve', value: val('hoLejelentoNeve') },
      { label: 'Elszállítás', value: val('hoElszallitasStatusz') },
      { label: 'Elszállítás dátuma', value: val('hoElszallitva') },
      { label: 'Szállítmányozó neve', value: val('hoSzallitmanyozoNeve') },
      { label: 'Fuvarlevél száma', value: val('hoFuvarlevelSzam') },
    ]);
  }

  if (showKartortenetFields) {
    sectionTitle('Kártörténet');
    if (hoKartortenetRows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Nincs rögzített sérülés a kártörténetben.', marginX, y);
      y += 16;
    } else {
      hoKartortenetRows.forEach((r, idx) => kartortenetDamageCard(r, idx));
    }
  }

  if (hoIsBlockRelevant('felszereltseg')) {
    sectionTitle('3. Felszereltség');
    const felszereltsegItems = (window.HANDOVER_CONFIG.felszereltsegek || []).map(name => ({
      name, checked: !![...document.querySelectorAll('[data-role="hoFelszereltseg"]')].find(cb => cb.dataset.name === name && cb.checked),
    }));
    checklistCard(felszereltsegItems.length ? felszereltsegItems : [{ name: '(nincs megadva)', checked: false }]);
  }

  if (hoIsBlockRelevant('muszaki')) {
    sectionTitle('4. Kerekek');
    fieldCard([
      { label: 'Könnyűfém felni', value: val('hoFelni') },
      { label: 'Utángyártott dísztárcsa', value: val('hoUtangyartottDisz') },
      { label: 'Gyári dísztárcsa', value: val('hoGyariDisz') },
      { label: 'Rendszámtábla keret cserélve', value: val('hoRendszamKeret') },
    ]);
  }

  if (hoIsBlockRelevant('abroncsok')) {
    sectionTitle('5. Abroncsok');
    const tireData = getTireData();
    fieldCard(HO_TIRE_POSITIONS.map(pos => {
      const t = tireData[pos.kod];
      return { label: pos.kod + ' — ' + pos.nev, value: (t.felniTipus || 'na.') + '  ·  ' + (t.meret || 'na.') + '  ·  ' + (t.abroncsMarka || 'na.') + '  ·  ' + (t.menetmelyseg || 'na.') + ' mm' };
    }));
  }

  if (hoIsBlockRelevant('szerviz')) {
    sectionTitle('6. Utolsó szervizelés adatai');
    fieldCard([
      { label: 'Típusa', value: val('hoServiceTipus') },
      { label: 'Időpontja', value: val('hoServiceIdopontja') },
      { label: 'Km állás', value: val('hoServiceKm') },
    ]);
  }

  if (hoIsBlockRelevant('serulesrajz')) {
    sectionTitle('7. Sérülések (autó-sziluett)');
    const vehicleTypeLabels = { szemelyauto: 'Személyautó', suv: 'SUV / SAV', kisbusz: 'Kisbusz', kisteherauto: 'Kisteherautó' };
    const vehicleTypeForDiagram = val('hoVehicleType');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('Jármű típusa (rajzhoz): ' + (vehicleTypeLabels[vehicleTypeForDiagram] || vehicleTypeForDiagram), marginX, y);
    y += 14;

    // Only export the specific views that actually have a marked damage on
    // them (cropped to that view, with its marks) — not the whole 5-panel
    // sheet every time.
    const panelKeysWithMarks = Object.keys(HO_PANELS).filter(key => hoCarMarks.some(m => (m.panel || 'top') === key));
    if (panelKeysWithMarks.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Nincs jelölt sérülés — nincs exportálandó nézet.', marginX, y);
      y += 16;
    } else {
      panelKeysWithMarks.forEach(panelKey => {
        const panel = HO_PANELS[panelKey];
        const cropCanvas = hoBuildPanelCropCanvas(panelKey, vehicleTypeForDiagram);
        const imgW = Math.min(contentW - 20, panel.w), imgH = imgW * (panel.h / panel.w);
        ensureSpace(imgH + 34);
        doc.setFontSize(9.5);
        doc.setTextColor(...TEXT_DARK);
        doc.text(panel.label, marginX, y);
        y += 12;
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.6);
        doc.rect(marginX, y, imgW + 20, imgH + 20, 'S');
        let imgOk = false;
        if (cropCanvas && typeof cropCanvas.toDataURL === 'function') {
          try {
            doc.addImage(cropCanvas.toDataURL('image/png'), 'PNG', marginX + 10, y + 10, imgW, imgH);
            imgOk = true;
          } catch (err) { /* fall through to the placeholder message below */ }
        }
        if (!imgOk) {
          doc.setFontSize(9);
          doc.setTextColor(150, 150, 150);
          doc.text('(ez a nézet nem exportálható ebben a böngészőben)', marginX + 10, y + imgH / 2 + 10);
        }
        y += imgH + 34;
      });
    }

    // Legend: a small key explaining each marker symbol
    const legendPadX = 4, legendPadY = 6, legendRowH = 18, legendCols = 3;
    const legendColW = (contentW - legendPadX * 2) / legendCols;
    const legendRows = Math.ceil(HO_MARKER_TYPES.length / legendCols);
    const legendH = legendPadY * 2 + legendRows * legendRowH;
    ensureSpace(legendH + 12);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, marginX + contentW, y);
    HO_MARKER_TYPES.forEach((m, i) => {
      const col = i % legendCols, row = Math.floor(i / legendCols);
      const cx = marginX + legendPadX + col * legendColW + 6;
      const cy = y + legendPadY + 8 + row * legendRowH;
      drawLegendIcon(doc, m.key, cx, cy);
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_DARK);
      doc.text(m.label, cx + 12, cy + 3);
    });
    y += legendH;
    doc.line(marginX, y, marginX + contentW, y);
    y += 14;

    // Marks list: every placed marking, described in plain Hungarian —
    // plus the "gépkocsi jégkáros" toggle, listed alongside the marked
    // damages the same way it appears on-screen.
    const jegkarChecked = document.getElementById('hoJegkarCheckbox') && document.getElementById('hoJegkarCheckbox').checked;
    const jegkarMertek = document.getElementById('hoJegkarMerteke') ? document.getElementById('hoJegkarMerteke').value.trim() : '';
    const jegkarLine = jegkarChecked ? 'Jégkár' + (jegkarMertek ? ' — ' + jegkarMertek : '') : null;
    const markLines = hoCarMarks.map((m) => hoClassifyMark(m));
    if (jegkarLine) markLines.push(jegkarLine);

    if (markLines.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Nincs jelölt sérülés a rajzon.', marginX, y);
      y += 16;
    } else {
      markLines.forEach((text, idx) => {
        ensureSpace(14);
        doc.setFontSize(9.3);
        doc.setTextColor(...TEXT_DARK);
        doc.text((idx + 1) + '. ' + text, marginX, y);
        y += 14;
      });
      y += 4;
    }
  }

  if (hoIsBlockRelevant('nemelfogadhato')) {
    sectionTitle('8. Sérülések fotókkal');
    if (hoDamageRows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Nincs rögzített sérülés.', marginX, y);
      y += 16;
    } else {
      hoDamageRows.forEach((r, idx) => damageCard(r, idx));
    }
  }

  if (!showKartortenetFields) {
    sectionTitle('9. Tartozékok átadva');
    const tartozekItems = [{ name: 'Kulcsok: ' + (val('hoKulcsokDb') || '0') + ' db', checked: true }]
      .concat([...document.querySelectorAll('[data-role="hoTartozek"]')].map(cb => ({ name: cb.dataset.name, checked: cb.checked })));
    checklistCard(tartozekItems);
  }

  if (hoIsBlockRelevant('belsoserulesek')) {
    sectionTitle('10. Belső sérülések');
    fieldCard([{ label: 'Leírás', value: val('hoBelsoSerulesek') }]);
  }

  if (!showKartortenetFields) {
    sectionTitle('11. Megjegyzések, sérülések, hiányok');
    fieldCard([{ label: 'Megjegyzés', value: val('hoMegjegyzes') }]);

    sectionTitle('12. Jogi nyilatkozat');
    fieldCard([
      { label: 'Nyilatkozat', value: 'Tájékoztatom, hogy a fent említett rendszámú autóról 10 naptári nap múlva a biztosítások (KGFB és Casco) lemondásra kerülnek, ezt követően nem áll módunkban biztosítási kárigényt elfogadnunk.' },
      { label: 'Tudomásul vettem', value: document.getElementById('hoLegalAck').checked ? 'IGEN' : 'NEM' },
    ]);
  }

  if (showInspectorFields && !showKartortenetFields) {
    sectionTitle('13. Szemle');
    fieldCard([
      { label: 'Szemle helye', value: val('hoSzemleHelye') },
      { label: 'Szemléző', value: val('hoSzemlezo') },
      { label: 'Szemle időpontja', value: val('hoSzemleIdopontja') },
    ]);
  }

  sectionTitle('14. Hely, idő és aláírások');
  const cimResz = [val('hoCimIranyitoszam'), val('hoCimUtca'), val('hoCimHazszam')].filter(Boolean).join(' ');
  fieldCard([
    { label: 'Hely (GPS)', value: val('hoLocation') },
    { label: 'Postai cím', value: cimResz },
    { label: 'Időbélyeg', value: new Date().toLocaleString('hu-HU') },
  ]);

  y += 4;
  const sigW = 220, sigH = 64, sigGap = 30;
  if (showHandoverFields) {
    ensureSpace(16 + sigH + 16);
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('Átadó aláírása', marginX, y);
    doc.text('Átvevő aláírása', marginX + sigW + sigGap, y);
    y += 8;
    const sigAtado = document.getElementById('hoSigAtado');
    const sigAtvevo = document.getElementById('hoSigAtvevo');
    doc.setDrawColor(...TEXT_DARK);
    doc.setLineWidth(0.8);
    doc.rect(marginX, y, sigW, sigH, 'S');
    doc.rect(marginX + sigW + sigGap, y, sigW, sigH, 'S');
    if (sigAtado && typeof sigAtado.toDataURL === 'function') {
      try { doc.addImage(sigAtado.toDataURL('image/png'), 'PNG', marginX, y, sigW, sigH); } catch (err) { /* ignore */ }
    }
    if (sigAtvevo && typeof sigAtvevo.toDataURL === 'function') {
      try { doc.addImage(sigAtvevo.toDataURL('image/png'), 'PNG', marginX + sigW + sigGap, y, sigW, sigH); } catch (err) { /* ignore */ }
    }
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(val('hoSigAtadoNev') || 'na.', marginX, y + sigH + 12);
    doc.text(val('hoSigAtvevoNev') || 'na.', marginX + sigW + sigGap, y + sigH + 12);
    y += sigH + 24;
  }
  if (showInspectorFields) {
    ensureSpace(16 + sigH + 16);
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('Inspekciót végző aláírása', marginX, y);
    y += 8;
    const sigInspektor = document.getElementById('hoSigInspektor');
    doc.setDrawColor(...TEXT_DARK);
    doc.setLineWidth(0.8);
    doc.rect(marginX, y, sigW, sigH, 'S');
    if (sigInspektor && typeof sigInspektor.toDataURL === 'function') {
      try { doc.addImage(sigInspektor.toDataURL('image/png'), 'PNG', marginX, y, sigW, sigH); } catch (err) { /* ignore */ }
    }
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(val('hoSigInspektorNev') || 'na.', marginX, y + sigH + 12);
    y += sigH + 24;
  }

  // Footer on every page: report id + page number, subtle and out of the way.
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(reportId, marginX, pageHeight - 22);
    doc.text(i + ' / ' + pageCount, pageWidth - marginX - 30, pageHeight - 22);
  }

  const rendszamPart = (val('hoRendszam') || 'jarmu').replace(/[^a-zA-Z0-9-]/g, '');
  const modeFileSlug = { atadas: 'atadas_atveteli_jegyzokonyv', allapotfelmeres: 'allapotfelmeres', kombinalt: 'allapotfelmeres_es_atadas_atveteli_jegyzokonyv', kartortenet: 'kartortenet' };
  const MAX_PDF_BYTES = 5 * 1024 * 1024;
  let sizeBytes = 0;
  try { sizeBytes = doc.output('arraybuffer').byteLength; } catch (err) { /* size check is best-effort */ }
  if (sizeBytes > MAX_PDF_BYTES) {
    showToast('Figyelem: a generált PDF ' + (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB, meghaladja az 5 MB célt — érdemes kevesebb vagy kisebb fotót csatolni.', true);
  }
  doc.save((modeFileSlug[mode] || modeFileSlug.atadas) + '_' + rendszamPart + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
}
