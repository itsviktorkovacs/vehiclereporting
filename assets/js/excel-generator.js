// excel-generator.js — builds an .xlsx export of the current plan (active +
// completed repairs), one row per rendszám. The column names here are
// DELIBERATELY the same ones the bulk importer (see app.js) reads, so an
// exported file can be re-imported, edited in Excel, or used as a template
// for someone else's manual data entry.

function buildSessionExcel({ jobs, completedJobs, partners, damageTypes, username }) {
  const damageById = {};
  damageTypes.forEach(d => { damageById[d.id] = d; });
  const partnerById = {};
  partners.forEach(p => { partnerById[p.id] = p; });

  const activeRows = [...jobs]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map(j => ({
      Rendszam: j.rendszam || '',
      SerulesTipus: damageById[j.damageTypeId] ? damageById[j.damageTypeId].name : j.damageTypeId,
      Partner: partnerById[j.partnerId] ? partnerById[j.partnerId].name : j.partnerId,
      JavitoSor: j.line || '',
      KezdoDatum: j.startDate,
      ElkeszulesiDatum: j.endDate,
      LegkesobbiElkeszulesiDatum: '', // only meaningful for import; blank here since these already have fixed dates
      Nap: j.days,
      EgysegAr: j.unitCost,
      Koltseg: j.totalCost,
    }));

  const completedRows = [...completedJobs]
    .sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''))
    .map(c => ({
      Rendszam: c.rendszam || '',
      SerulesTipus: c.damageTypeName || '',
      Partner: c.partnerName || '',
      KezdoDatum: c.startDate,
      ElkeszulesiDatum: c.endDate,
      Nap: c.days,
      Koltseg: c.totalCost,
      ElkeszultDatum: c.completedDate,
    }));

  const wb = XLSX.utils.book_new();

  const wsActive = XLSX.utils.json_to_sheet(activeRows.length ? activeRows : [{ Rendszam: '' }]);
  wsActive['!cols'] = [
    { wch: 12 }, { wch: 28 }, { wch: 22 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 7 }, { wch: 11 }, { wch: 11 },
  ];
  XLSX.utils.book_append_sheet(wb, wsActive, 'AktivJavitasok');

  const wsCompleted = XLSX.utils.json_to_sheet(completedRows.length ? completedRows : [{ Rendszam: '' }]);
  wsCompleted['!cols'] = [
    { wch: 12 }, { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 11 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsCompleted, 'ElkeszultJavitasok');

  XLSX.writeFile(wb, 'kapacitastervezes_export_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
