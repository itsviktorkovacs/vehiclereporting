// handover-config.js — NON-secret shared config for the "Átadás-átvétel" form
// (damage locations/types, photo categories, accessory checklist). Not part
// of the encrypted business data, since none of this is confidential — it's
// just dropdown/checklist content. Regenerate this file via
// tools/prepare-data.html once you've filled in "atadas_atveteli_adatok_sablon.xlsx"
// with your own real lists.

window.HANDOVER_CONFIG = {
  serulesHelyek: [
    { kod: 'JE', nev: 'Jobb eleje' },
    { kod: 'JH', nev: 'Jobb hátulja' },
    { kod: 'BE', nev: 'Bal eleje' },
    { kod: 'BH', nev: 'Bal hátulja' },
    { kod: 'EVH', nev: 'Első lökhárító' },
    { kod: 'HVH', nev: 'Hátsó lökhárító' },
    { kod: 'MHT', nev: 'Motorháztető' },
    { kod: 'CST', nev: 'Csomagtértető' },
    { kod: 'TE', nev: 'Tető' },
    { kod: 'JAO', nev: 'Jobb első ajtó' },
    { kod: 'JHO', nev: 'Jobb hátsó ajtó' },
    { kod: 'BAO', nev: 'Bal első ajtó' },
    { kod: 'BHO', nev: 'Bal hátsó ajtó' },
    { kod: 'SZV', nev: 'Szélvédő' },
  ],
  serulesTipusok: [
    'Horzsolás', 'Horpadás', 'Karcolás', 'Festékhiba / festéklekopás',
    'Törés', 'Repedés', 'Hiányzik', 'Elszíneződés', 'Kőfelverődéses', 'Egyéb',
  ],
  javitasModjai: [
    'Fényezés', 'Csere', 'Javítás és fényezés', 'Javítás előkészítés', 'Nincs teendő', 'Egyéb',
  ],
  felszereltsegek: [
    'Automata/digitális klíma', 'Adaptív tempomat (ACC)', 'Sávtartó asszisztens',
    'Vakfoltfigyelő rendszer', 'Tolatókamera / parkolóradar', 'Beépített navigáció',
    'Multifunkciós kormánykerék', 'Ülésfűtés', 'LED fényszórók',
    'Apple CarPlay / Android Auto', 'Automatikus vészfékrendszer (AEB)', 'Kulcsnélküli indítás (Keyless go)',
  ],
  tartozekok: [
    'Forgalmi engedély', 'Szervizkönyv', 'Kezelési könyv', 'Kresz tartozékok',
    'Kalaptartó / roló', 'Pótkerék', 'Javítókészlet',
  ],
};
