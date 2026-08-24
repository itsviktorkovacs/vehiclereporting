// ics-generator.js — builds an RFC 5545 (.ics) calendar file so the current
// active repairs can be imported into Outlook (or any calendar app) as
// all-day events. Pure string-building logic, no DOM access, so it's testable
// in Node like capacity-calc.js.

(function (global) {

  function pad(n) { return String(n).padStart(2, '0'); }

  // 'YYYY-MM-DD' -> 'YYYYMMDD'
  function dateOnlyToICS(dateStr) {
    return dateStr.replace(/-/g, '');
  }

  // 'YYYY-MM-DD' + hour/minute -> 'YYYYMMDDTHHMMSS' (floating local time — no
  // timezone conversion, Outlook interprets it in the reader's own local time,
  // which is the simplest correct behavior for a single-country internal tool).
  function icsLocalDateTime(dateStr, hour, minute) {
    return dateOnlyToICS(dateStr) + 'T' + pad(hour) + pad(minute) + '00';
  }

  // Escapes text per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline).
  function escapeICSText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  // Builds the full .ics calendar text for the given active jobs. Each job
  // becomes ONE all-day event spanning its whole startDate..endDate range
  // (a single banner in Outlook, not one entry per day), with:
  //   - SUMMARY = rendszám
  //   - LOCATION = partner neve
  //   - reminder #1: the day before the completion date, 11:00
  //   - reminder #2: the completion date itself, 09:00
  function buildIcsCalendar(jobs, damageTypes, partners) {
    const damageById = {};
    damageTypes.forEach(d => { damageById[d.id] = d; });
    const partnerById = {};
    partners.forEach(p => { partnerById[p.id] = p; });

    const now = new Date();
    const dtstamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) +
      'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';

    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//Kapacitastervezo Fleet Control//HU');
    lines.push('CALSCALE:GREGORIAN');

    jobs.forEach(j => {
      const partner = partnerById[j.partnerId];
      const damageType = damageById[j.damageTypeId];

      const dayBeforeCompletion = CapacityCalc.toISODateString(
        CapacityCalc.addDaysUTC(CapacityCalc.toDateOnlyUTC(j.endDate), -1)
      );
      // DTEND for an all-day event is EXCLUSIVE per RFC 5545 — one day past the last covered day.
      const dtendExclusive = CapacityCalc.toISODateString(
        CapacityCalc.addDaysUTC(CapacityCalc.toDateOnlyUTC(j.endDate), 1)
      );

      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + (j.id || (j.rendszam + '-' + j.startDate)) + '@kapacitastervezo.local');
      lines.push('DTSTAMP:' + dtstamp);
      lines.push('DTSTART;VALUE=DATE:' + dateOnlyToICS(j.startDate));
      lines.push('DTEND;VALUE=DATE:' + dateOnlyToICS(dtendExclusive));
      lines.push('SUMMARY:' + escapeICSText(j.rendszam));
      lines.push('LOCATION:' + escapeICSText(partner ? partner.name : ''));
      lines.push('DESCRIPTION:' + escapeICSText(damageType ? damageType.name : ''));

      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + escapeICSText('Holnap esedékes az elkészülés: ' + j.rendszam));
      lines.push('TRIGGER;VALUE=DATE-TIME:' + icsLocalDateTime(dayBeforeCompletion, 11, 0));
      lines.push('END:VALARM');

      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + escapeICSText('Ma esedékes az elkészülés: ' + j.rendszam));
      lines.push('TRIGGER;VALUE=DATE-TIME:' + icsLocalDateTime(j.endDate, 9, 0));
      lines.push('END:VALARM');

      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // Browser-only: triggers the file download.
  function downloadIcsCalendar(jobs, damageTypes, partners) {
    const ics = buildIcsCalendar(jobs, damageTypes, partners);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kapacitastervezes_naptar_' + new Date().toISOString().slice(0, 10) + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const api = { buildIcsCalendar, downloadIcsCalendar, escapeICSText, dateOnlyToICS, icsLocalDateTime };
  if (typeof window !== 'undefined') window.IcsGenerator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
