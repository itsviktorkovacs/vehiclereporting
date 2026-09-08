// app-version.js — ezt a fájlt MINDIG hálózatról frissen kell lekérni
// (lásd service-worker.js DATA_FILE_PATTERN + a "🔄 Verzió ellenőrzése"
// gomb), hogy a "legfrissebb szerver-verzió" pontosan ismert legyen,
// függetlenül attól, hogy a böngésző a többi fájlt (index.html, JS, CSS)
// esetleg még a régi, gyorsítótárazott formában futtatja.
//
// FONTOS: minden érdemi kiadásnál ezt A SZÁMOT ÉS a handover.js tetején
// lévő HO_APP_VERSION konstanst is bumpelni kell, ugyanarra az értékre.
window.HO_APP_VERSION_LATEST = '2026-09-08.1';
