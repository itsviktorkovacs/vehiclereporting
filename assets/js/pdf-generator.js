// pdf-generator.js — builds a PDF snapshot of the current planning session.
// Uses jsPDF (vendored, see architecture guide §6) with an embedded DejaVu Sans
// font, because jsPDF's built-in fonts don't cover Hungarian ő/ű.

function buildSessionPdf({ weeks, partners, jobs, completedJobs = [], damageTypes, username }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  doc.addFileToVFS('DejaVuSans.ttf', window.FONT_DejaVuSans);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');

  const marginX = 40;
  let y = 50;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  function ensureSpace(nextLineHeight) {
    if (y + nextLineHeight > pageHeight - 40) {
      doc.addPage();
      doc.setFont('DejaVuSans', 'normal');
      y = 50;
    }
  }

  function h1(text) {
    doc.setFontSize(16);
    doc.text(text, marginX, y);
    y += 22;
  }
  function h2(text) {
    ensureSpace(20);
    doc.setFontSize(12);
    doc.text(text, marginX, y);
    y += 16;
  }
  function line(text, size = 10, color = [30, 30, 30]) {
    ensureSpace(14);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, marginX, y);
    y += size + 4;
  }

  const damageById = {};
  damageTypes.forEach(d => { damageById[d.id] = d; });
  const partnerById = {};
  partners.forEach(p => { partnerById[p.id] = p; });

  h1('Kapacitástervezés — összesítő');
  line('Készült: ' + new Date().toLocaleString('hu-HU') + '   ·   Felhasználó: ' + username, 9, [100, 100, 100]);
  y += 6;

  // --- Weekly capacity section ---
  h2('Heti kapacitás-kihasználtság');
  const usage = CapacityCalc.capacityUsageByWeek(jobs, partners, weeks);
  usage.forEach(wRow => {
    const totalLineRows = wRow.partners.reduce((s, p) => s + p.lines.length, 0);
    ensureSpace(14 + wRow.partners.length * 13 + totalLineRows * 12);
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(wRow.week.label + '  (' + wRow.week.rangeLabel + ')', marginX, y);
    y += 13;
    wRow.partners.forEach(p => {
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text('  ' + p.partnerName, marginX, y);
      y += 12;
      p.lines.forEach(line => {
        ensureSpace(12);
        const dayMarks = line.days.map(d => d.weekdayShort + (d.occupied ? '■' : '·')).join('  ');
        const lineLabel = p.lines.length > 1 ? (line.lineNumber + '. sor: ') : '';
        doc.setFontSize(8.5);
        doc.setTextColor(90, 90, 90);
        doc.text('    ' + lineLabel + dayMarks, marginX, y);
        y += 11;
      });
    });
    y += 4;
  });

  // --- Jobs table ---
  y += 6;
  h2('Tervezett javítások (aktív)');
  if (jobs.length === 0) {
    line('Nincs tervezett javítás ebben az állapotban.', 9, [120, 120, 120]);
  } else {
    const colX = [marginX, marginX + 70, marginX + 200, marginX + 300, marginX + 375, marginX + 445, marginX + 475];
    ensureSpace(14);
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text('Rendszám', colX[0], y);
    doc.text('Sérülés típusa', colX[1], y);
    doc.text('Partner', colX[2], y);
    doc.text('Kezdő', colX[3], y);
    doc.text('Kész', colX[4], y);
    doc.text('Nap', colX[5], y);
    doc.text('Költség', colX[6], y);
    y += 12;

    const sortedJobs = [...jobs].sort((a, b) => a.startDate.localeCompare(b.startDate));
    let totalCost = 0, totalDays = 0;
    sortedJobs.forEach(j => {
      ensureSpace(13);
      const d = damageById[j.damageTypeId];
      const p = partnerById[j.partnerId];
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text(String(j.rendszam || '').slice(0, 12), colX[0], y);
      doc.text(String(d ? d.name : j.damageTypeId).slice(0, 22), colX[1], y);
      doc.text(String(p ? p.name : j.partnerId).slice(0, 16), colX[2], y);
      doc.text(j.startDate, colX[3], y);
      doc.text(j.endDate, colX[4], y);
      doc.text(String(j.days), colX[5], y);
      doc.text(Math.round(j.totalCost).toLocaleString('hu-HU') + ' Ft', colX[6], y);
      y += 13;
      totalCost += j.totalCost;
      totalDays += j.days;
    });

    y += 8;
    ensureSpace(16);
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text('Összesen: ' + jobs.length + ' javítás  ·  ' + totalDays + ' nap  ·  ' + Math.round(totalCost).toLocaleString('hu-HU') + ' Ft', marginX, y);
  }

  // --- Completed jobs log ---
  y += 24;
  h2('Elkészült javítások naplója');
  if (completedJobs.length === 0) {
    line('Nincs elkészült javítás rögzítve.', 9, [120, 120, 120]);
  } else {
    const colX = [marginX, marginX + 70, marginX + 200, marginX + 290, marginX + 370, marginX + 440, marginX + 475];
    ensureSpace(14);
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text('Rendszám', colX[0], y);
    doc.text('Sérülés típusa', colX[1], y);
    doc.text('Partner', colX[2], y);
    doc.text('Időszak', colX[3], y);
    doc.text('Elkészült', colX[4], y);
    doc.text('Nap', colX[5], y);
    doc.text('Költség', colX[6], y);
    y += 12;

    const sortedCompleted = [...completedJobs].sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''));
    sortedCompleted.forEach(c => {
      ensureSpace(13);
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text(String(c.rendszam || '').slice(0, 12), colX[0], y);
      doc.text(String(c.damageTypeName || '').slice(0, 22), colX[1], y);
      doc.text(String(c.partnerName || '').slice(0, 16), colX[2], y);
      doc.text((c.startDate || '') + ' – ' + (c.endDate || ''), colX[3], y);
      doc.text(String(c.completedDate || ''), colX[4], y);
      doc.text(String(c.days || ''), colX[5], y);
      doc.text(Math.round(c.totalCost || 0).toLocaleString('hu-HU') + ' Ft', colX[6], y);
      y += 13;
    });
  }

  doc.save('kapacitastervezes_' + new Date().toISOString().slice(0, 10) + '.pdf');
}
