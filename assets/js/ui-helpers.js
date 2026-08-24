// ui-helpers.js — tiny DOM utilities, no business logic.

function showToast(message, isError) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function formatHUF(n) {
  return Math.round(n).toLocaleString('hu-HU') + ' Ft';
}

function formatDays(n) {
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString('hu-HU') + ' nap';
}

// Formats a 'YYYY-MM-DD' string as 'YYYY.MM.DD.'
function formatDateHu(isoDateStr) {
  if (!isoDateStr) return '';
  const [y, m, d] = String(isoDateStr).split('-');
  return y + '.' + m + '.' + d + '.';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Used whenever names (rendszám partner/sérüléstípus, felhasználó vezetékneve)
// need to be matched against each other — tolerant of case, extra/non-breaking
// whitespace, and Unicode NFC/NFD differences (two visually identical
// accented strings, e.g. from different Excel/OS sources, can otherwise fail
// to match even though they look the same to a person).
function normalizeMatchKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
