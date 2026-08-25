// Jármű-adatbázis a rendszám szerinti automatikus mezőkitöltéshez az
// Átadás-átvétel képernyőn. NEM titkosított — ez nem bizalmas/személyes
// adat, csak jármű-műszaki adatok, ezért a tools/prepare-data.html "Jármű-
// adatbázis" pontjában (Excel importtal) generálható, titkosítás nélkül.
//
// Minden bejegyzés kulcsa a rendszám (normalizálva: nagybetűs, szóköz
// nélkül). A "tervezettLeadas" mező NEM kerül be a form mezőibe vagy a
// PDF-be — kizárólag a rendszám-kereső 90 napos láthatósági szűréséhez
// használt (leadás dátumától +90 napig jelenik meg találatként).
window.VEHICLE_LOOKUP = [
  {
    rendszam: 'DEMO-001',
    alvazszam: 'WDB2110421A123456',
    motorszam: '654920123456',
    internalSzam: 'FL-1042',
    markak: 'Mercedes Benz',
    tipus: 'V-Klasse',
    motorjeloles: 'OM654',
    felszereltseg: 'Automata/digitális klíma, Navigáció, Ülésfűtés',
    kivitel: 'Kisbusz',
    sebessegvalto: 'Automata',
    szin: 'Fekete',
    hengerurtartalom: 1950,
    uzemanyag: 'Diesel',
    teljesitmeny: 140,
    onsuly: 2100,
    osszsuly: 3050,
    gyartasiEv: 2023,
    elsoForgalomba: '2023-04-08',
    forgalmiSzam: 'FE-0012345',
    muszakiErvenyesseg: '2027-04-08',
    abroncsMeret: '235/60R17',
    tervezettLeadas: '2026-08-19',
  },
];
