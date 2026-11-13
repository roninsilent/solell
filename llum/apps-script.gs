/*
 * Solell · llum — l'script que rep els avisos del Home Assistant i els desa al Drive.
 *
 * El Home Assistant només es veu des de casa, i l'app de Solell viu a GitHub
 * Pages. Aquest script fa de pont: el Home Assistant li envia cada avís i ell
 * l'escriu a solell-llum.json, que és el fitxer que llegeix llum.html.
 *
 * Com es posa en marxa (amb roninsilent@gmail.com):
 *   1. script.google.com → Projecte nou → enganxa-hi aquest fitxer sencer.
 *   2. Tria la funció «prepara» i prem Executa. Demanarà permís per al Drive.
 *      Al registre d'execució surt la clau.
 *   3. Implementa → Implementació nova → Aplicació web.
 *      Executa com a: jo. Qui hi té accés: qualsevol usuari.
 *      Copia l'URL que acaba en /exec.
 *   4. Al secrets.yaml del Home Assistant:
 *        solell_llum_url: "URL_QUE_ACABA_EN_/exec?clau=LA_CLAU"
 *
 * L'URL i la clau són l'única porta: sense la clau, l'script no escriu res.
 *
 * Els fitxers:
 *   - solell-llum-mestre.json: la còpia sencera. La crea l'script i és la que llegeix.
 *   - solell-llum.json: la de l'app. Només hi escriu, no la crea mai: l'app entra
 *     amb el permís drive.file, que només li deixa veure els fitxers que crea ella.
 *     Per això el primer cop que s'obre llum.html en crea una de buida, i des
 *     d'aleshores l'script hi copia tot el que té.
 */

var NOM_APP = 'solell-llum.json';
var NOM_MESTRE = 'solell-llum-mestre.json';
var MAX_EVENTS = 2000;     // uns quants anys de talls; els més vells cauen
var MAX_ARRENCADES = 60;   // arrencades ja comptades, per no apuntar dues vegades el mateix tall
var TENSIO_BAIXA = 207;    // 230 V − 10 % (EN 50160)

function prepara() {
  var p = PropertiesService.getScriptProperties();
  var clau = p.getProperty('CLAU');
  if (!clau) {
    clau = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    p.setProperty('CLAU', clau);
  }
  var D = llegeix_();
  escriu_(D);
  Logger.log('La clau és: ' + clau);
  Logger.log('Còpies de ' + NOM_APP + ' trobades: ' + copiesApp_().length +
    (copiesApp_().length ? '' : ' (obre llum.html una vegada amb roninsilent@gmail.com perquè en creï una)'));
}

/* Per provar-ho des del navegador: URL?clau=… */
function doGet(e) {
  if (!autoritzat_(e)) return json_({ ok: false, error: 'clau' });
  var D = llegeix_();
  return json_({ ok: true, events: D.events.length, contacte: D.contacte || null, copies: copiesApp_().length });
}

function doPost(e) {
  if (!autoritzat_(e)) return json_({ ok: false, error: 'clau' });
  var m;
  try { m = JSON.parse((e.postData && e.postData.contents) || '{}'); }
  catch (x) { return json_({ ok: false, error: 'json' }); }
  if (!m || typeof m !== 'object') return json_({ ok: false, error: 'json' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'ocupat' });
  try {
    var D = llegeix_();
    var ara = Date.now();
    var fet = aplica_(D, m, ara);
    D.contacte = new Date(ara).toISOString();
    D.actualitzat = D.contacte;
    escriu_(D);
    return json_({ ok: true, fet: fet });
  } finally {
    lock.releaseLock();
  }
}

/* Per apuntar a mà un tall trobat després a l'historial del Home Assistant.
   No es pot executar sola: des de l'editor, fes una funció de pas que la cridi,
   per exemple apuntaTall('2026-11-12T05:38:13+01:00', '2026-11-12T05:46:45+01:00', 'Per què ho sé').
   No toca «contacte», que és l'última vegada que ha parlat el Home Assistant. */
function apuntaTall(inici, fi, nota) {
  var m = { tipus: 'historic', inici: Date.parse(inici) / 1000, fi: Date.parse(fi) / 1000, nota: nota };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Ocupat: torna-ho a provar d\'aquí a un moment');
  try {
    var D = llegeix_();
    var fet = aplica_(D, m, Date.now());
    if (fet === 'tall') { D.actualitzat = new Date().toISOString(); escriu_(D); }
    Logger.log(fet + ': ' + inici + ' → ' + fi);
    return fet;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- què fa cada avís ---------- */
function aplica_(D, m, ara) {
  if (m.vigila && typeof m.vigila === 'object') D.vigila = vigila_(m.vigila);
  var t = str_(m.tipus, 20);

  if (t === 'batec') return 'batec';

  if (t === 'historic') {
    // Un tall trobat després, mirant l'historial. Hores en segons des del 1970.
    var hi = num_(m.inici, 1577836800, 4e9), hf = num_(m.fi, 1577836800, 4e9);
    if (hi === null || hf === null || hf < hi || hf * 1000 > ara + 60000) return 'sense dades';
    var ini = hi * 1000, fin = hf * 1000;
    var ja = D.events.some(function (x) {
      return x.tipus === 'tall' && Date.parse(x.inici) <= fin + 600000 && (Date.parse(x.fi) || ara) >= ini - 600000;
    });
    if (ja) return 'ja hi era';
    var hist = { tipus: 'tall', font: 'historial', inici: iso_(ini), fi: iso_(fin) };
    var nota = str_(m.nota, 200);
    if (nota) hist.nota = nota;
    afegeix_(D, hist);
    return 'tall';
  }

  if (t === 'arrencada') {
    // El Home Assistant torna a ser viu. «ant» és l'últim batec que va escriure
    // abans d'apagar-se (segons el seu rellotge, que llavors anava bé) i
    // «uptime» els segons que fa que la màquina s'ha encès. L'hora d'encesa la
    // calculo aquí, amb el rellotge de Google: després d'un tall el seu pot
    // anar malament fins que torna internet.
    var ant = num_(m.ant, 1e9, 4e9), up = num_(m.uptime, 0, 1e9), boot = str_(m.boot_ant, 64);
    if (ant === null || up === null || !boot || boot === '-') return 'sense dades';
    if (D.arrencades.indexOf(boot) >= 0) return 'ja comptada';
    D.arrencades.unshift(boot);
    D.arrencades = D.arrencades.slice(0, MAX_ARRENCADES);
    if (m.neta === true) return 'aturada neta';
    var inici = ant * 1000, fi = ara - up * 1000;
    if (fi < inici) fi = inici;
    // si l'alarma o el SAI ja l'havien obert, aquest el tanca i el substitueix
    D.events = D.events.filter(function (x) {
      return !(x.tipus === 'tall' && !x.fi && x.inici && Date.parse(x.inici) >= inici - 600000 && Date.parse(x.inici) <= fi + 600000);
    });
    afegeix_(D, { tipus: 'tall', font: 'arrencada', inici: iso_(inici), fi: iso_(fi) });
    return 'tall';
  }

  if (t === 'xarxa' || t === 'circuit') {
    // xarxa: l'alarma o el SAI diuen que no hi ha corrent (o que torna).
    // circuit: un aparell de prova s'ha quedat sense corrent (o torna).
    var hora = horaDe_(m.hora, ara);
    var tipus = t === 'xarxa' ? 'tall' : 'circuit';
    var font = t === 'xarxa' ? (str_(m.font, 20) === 'sai' ? 'sai' : 'alarma') : 'aparells';
    var aparells = llista_(m.aparells);
    if (str_(m.estat, 10) === 'fi') {
      var obert = null;
      for (var i = 0; i < D.events.length; i++) {
        var x = D.events[i];
        if (x.tipus === tipus && x.font === font && !x.fi) { obert = x; break; }
      }
      if (obert) { obert.fi = iso_(Math.max(hora, Date.parse(obert.inici) || hora)); return 'tancat'; }
      return 'res a tancar';
    }
    var nou = { tipus: tipus, font: font, inici: iso_(hora), fi: null };
    if (aparells.length) nou.aparells = aparells;
    afegeix_(D, nou);
    return 'obert';
  }

  if (t === 'tensio') {
    var a = horaDe_(m.inici, ara), b = horaDe_(m.fi, ara);
    var mn = num_(m.minima, 0, 400), mx = num_(m.maxima, 0, 400);
    if (mn === null && mx === null) return 'sense dades';
    var ev = { tipus: 'tensio', font: 'sensor', inici: iso_(Math.min(a, b)), fi: iso_(Math.max(a, b)),
               sentit: (mn !== null && mn < TENSIO_BAIXA) ? 'baixa' : 'alta' };
    if (mn !== null) ev.minima = Math.round(mn * 10) / 10;
    if (mx !== null) ev.maxima = Math.round(mx * 10) / 10;
    var fonts = llista_(m.fonts);
    if (fonts.length) ev.aparells = fonts;
    afegeix_(D, ev);
    return 'tensio';
  }

  return 'desconegut';
}

function afegeix_(D, ev) {
  ev.id = Utilities.getUuid().slice(0, 8);
  D.events.push(ev);
  D.events.sort(function (a, b) { return (Date.parse(b.inici) || 0) - (Date.parse(a.inici) || 0); });
  D.events = D.events.slice(0, MAX_EVENTS);
}

/* ---------- el Drive ---------- */
function llegeix_() {
  var f = primer_(DriveApp.getFilesByName(NOM_MESTRE)) || primer_(DriveApp.getFilesByName(NOM_APP));
  var D = {};
  if (f) { try { D = JSON.parse(f.getBlob().getDataAsString('UTF-8') || '{}'); } catch (x) { D = {}; } }
  if (!D || typeof D !== 'object') D = {};
  D.versio = 1;
  if (!Array.isArray(D.events)) D.events = [];
  if (!Array.isArray(D.arrencades)) D.arrencades = [];
  if (!D.vigila || typeof D.vigila !== 'object') D.vigila = {};
  return D;
}

function escriu_(D) {
  var text = JSON.stringify(D);
  var mestre = primer_(DriveApp.getFilesByName(NOM_MESTRE));
  if (mestre) mestre.setContent(text);
  else DriveApp.createFile(NOM_MESTRE, text, 'application/json');
  copiesApp_().forEach(function (f) { f.setContent(text); });
}

function copiesApp_() {
  var it = DriveApp.getFilesByName(NOM_APP), o = [];
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) o.push(f); }
  return o;
}

function primer_(it) {
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

/* ---------- comprovacions ---------- */
function autoritzat_(e) {
  var clau = PropertiesService.getScriptProperties().getProperty('CLAU');
  return !!clau && !!e && !!e.parameter && e.parameter.clau === clau;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function num_(v, min, max) {
  var n = typeof v === 'string' ? parseFloat(v) : v;
  return (typeof n === 'number' && isFinite(n) && n >= min && n <= max) ? n : null;
}

function str_(v, max) {
  return (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max) : '';
}

function llista_(v) {
  return Array.isArray(v) ? v.map(function (x) { return str_(x, 80); }).filter(String).slice(0, 20) : [];
}

/* Les hores arriben en segons des del 1970, amb el rellotge del Home Assistant.
   Si una no té sentit (més d'un dia al futur o abans del 2020), poso la d'ara. */
function horaDe_(v, ara) {
  var s = num_(v, 1577836800, 4e9);
  if (s === null) return ara;
  var ms = s * 1000;
  return ms > ara + 86400000 ? ara : ms;
}

function iso_(ms) { return new Date(ms).toISOString(); }

function vigila_(v) {
  return {
    tensio: llista_(v.tensio),
    sentinelles: llista_(v.sentinelles),
    alarma: llista_(v.alarma),
    sai: llista_(v.sai),
    ha: str_(v.ha, 30)
  };
}
