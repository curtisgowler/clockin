(function () {
  var state = null, busy = false, photoData = null, foundName = null, lastFix = null, gpsStarted = false, installEvt = null;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- small helpers ---------- */
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function show(id) {
    ['loading', 'register', 'main', 'done'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); });
    window.scrollTo(0, 0);
  }
  function msg(id, text, kind) { var el = $(id); el.className = 'msg ' + (text ? kind || 'err' : ''); el.textContent = text || ''; }
  function setImg(id, src) { var el = $(id); if (src) { el.src = src; el.classList.remove('hidden'); } else el.classList.add('hidden'); }
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDate(ms) { return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
  function newId() {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function phoneId() {
    var id = ls('clockin_phone_id');
    if (!id) { id = newId(); ls('clockin_phone_id', id); }
    metaSet('phoneId', id).catch(function () {});
    return id;
  }
  function saveState() { if (state) ls('clockin_state', JSON.stringify(state)); }
  function online() { return navigator.onLine !== false; }
  function updateNet() { $('net').classList.toggle('show', !online()); }

  /* ---------- install prompt ---------- */
  function standalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  function setupInstall() {
    if (standalone()) return;
    var ua = navigator.userAgent;
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('install').classList.remove('hidden');
    if (ios) $('installIos').classList.remove('hidden');
    else $('installOther').classList.remove('hidden');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); installEvt = e;
      $('installOther').classList.add('hidden'); $('installAndroid').classList.remove('hidden');
    });
    $('installBtn').onclick = function () {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt.userChoice.then(function () { installEvt = null; $('install').classList.add('hidden'); });
    };
    window.addEventListener('appinstalled', function () { $('install').classList.add('hidden'); });
  }

  /* ---------- GPS: starts as soon as the main screen shows, so it is ready before the tap ---------- */
  function startGps() {
    if (gpsStarted || !navigator.geolocation) return;
    gpsStarted = true;
    try {
      navigator.geolocation.watchPosition(function (p) {
        lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
      }, function () {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
    } catch (e) {}
  }
  function getLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      if (lastFix && Date.now() - lastFix.at < 120000) return resolve(lastFix);
      var finished = false;
      var t = setTimeout(function () { if (!finished) { finished = true; resolve(lastFix); } }, 8000);
      navigator.geolocation.getCurrentPosition(function (p) {
        if (finished) return; finished = true; clearTimeout(t);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      }, function () { if (finished) return; finished = true; clearTimeout(t); resolve(lastFix); },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 120000 });
    });
  }

  /* ---------- main screen ---------- */
  function render(s) {
    if (busy) return;
    state = s; saveState();
    if (!s.registered) { notMe(); show('register'); return; }
    $('hello').textContent = 'Hi ' + s.name.split(' ')[0];
    setImg('mainPhoto', s.photo);
    $('workerMsg').textContent = s.message || '';
    var sel = $('loc'); sel.length = 1;
    (s.locations || []).forEach(function (n) { var o = document.createElement('option'); o.value = o.textContent = n; sel.appendChild(o); });
    var pick = ls('clockin_location') || s.lastLocation;
    if ((s.locations || []).length === 1) pick = s.locations[0];
    if (pick && s.locations.indexOf(pick) >= 0) sel.value = pick;
    $('locWrap').classList.toggle('hidden', !!s.onSite);
    var pill = $('statusPill'), btn = $('actionBtn');
    if (s.onSite) {
      pill.className = 'status on'; pill.textContent = 'On site' + (s.location ? ' at ' + s.location : '') + ' since ' + s.since;
      btn.className = 'btn-out'; btn.textContent = 'CLOCK OUT';
    } else {
      pill.className = 'status off'; pill.textContent = 'Not clocked in';
      btn.className = 'btn-in'; btn.textContent = 'CLOCK IN';
    }
    btn.disabled = false;
    msg('mainMsg', '');
    renderHistory();
    show('main');
    startGps();
  }

  function renderHistory() {
    queueAll().catch(function () { return []; }).then(function (queued) {
      var list = $('hist'); list.innerHTML = '';
      var rows = queued.slice().reverse().map(function (q) {
        return { at: q.at, action: q.action, location: q.site, map: q.loc ? 'https://www.google.com/maps?q=' + q.loc.lat + ',' + q.loc.lng : '', pending: true };
      }).concat((state && state.history) || []);
      var seen = {};
      rows = rows.filter(function (r) { var k = r.action + r.at; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 15);
      rows.forEach(function (r) {
        var li = document.createElement('li');
        var tag = document.createElement('span'); tag.className = 'tag ' + r.action; tag.textContent = r.action;
        var what = document.createElement('div'); what.className = 'what';
        var when = document.createElement('div'); when.className = 'when'; when.textContent = fmtDate(r.at) + ' · ' + fmtTime(r.at);
        var where = document.createElement('div'); where.className = 'where'; where.textContent = r.location || '';
        what.appendChild(when); what.appendChild(where);
        if (r.pending) { var w = document.createElement('div'); w.className = 'wait'; w.textContent = 'Saved on phone, waiting for signal'; what.appendChild(w); }
        li.appendChild(tag); li.appendChild(what);
        if (r.map) { var a = document.createElement('a'); a.href = r.map; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Map'; li.appendChild(a); }
        list.appendChild(li);
      });
      $('histEmpty').classList.toggle('hidden', rows.length > 0);
      msg('queueMsg', queued.length ? queued.length + ' clock-in' + (queued.length > 1 ? 's' : '') + ' saved on this phone. They will send when you have signal.' : '', 'warn');
    });
  }

  function load() {
    if (!online()) {
      if (!state || !state.registered) { show('register'); msg('regMsg', 'No signal. Connect once to set up this phone.'); }
      return;
    }
    callApi('state', [phoneId()], 20000).then(render, function (e) {
      if (!state || !state.registered) { show('register'); msg('regMsg', e.network ? 'No signal. Connect once to set up this phone.' : e.message); }
    });
  }

  function sync() {
    if (!online()) return Promise.resolve();
    return flushQueue().then(function (r) {
      if (r.rejected.length) msg('mainMsg', 'A saved clock-in was not accepted: ' + r.rejected[0]);
      if (r.sent) load(); else renderHistory();
    }).catch(function () {});
  }

  function askBackgroundSync() {
    if (navigator.serviceWorker && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.sync.register('clockin-queue'); }).catch(function () {});
    }
  }

  /* ---------- clock in / out ---------- */
  function doClock() {
    if (!state || busy) return;
    var action = state.onSite ? 'OUT' : 'IN';
    var site = action === 'IN' ? $('loc').value : (state.location || $('loc').value);
    if (action === 'IN' && !site) { msg('mainMsg', 'Pick your work location first.'); return; }
    if (action === 'IN') ls('clockin_location', site);
    var btn = $('actionBtn');
    busy = true; btn.disabled = true;
    btn.textContent = lastFix ? 'Saving…' : 'Checking location…';
    msg('mainMsg', '');
    getLocation().then(function (loc) {
      btn.textContent = 'Saving…';
      var entry = { id: newId(), action: action, site: site, loc: loc ? { lat: loc.lat, lng: loc.lng, acc: loc.acc } : null, at: Date.now() };
      var send = online()
        ? callApi('clock', [phoneId(), action, entry.loc, site, { at: entry.at, id: entry.id }], 12000)
        : Promise.reject({ network: true });
      return send.then(function (r) {
        finish(r, false, entry);
        callApi('sync', [], 20000).catch(function () {});
      }, function (e) {
        if (e && e.server) { busy = false; render(state); msg('mainMsg', e.message); load(); return; }
        return queueAdd(entry).then(function () {
          askBackgroundSync();
          finish({ name: state.name, action: action, location: site, photo: state.photo, time: fmtTime(entry.at), date: fmtDate(entry.at), at: entry.at, locationStatus: 'OK' }, true, entry);
        });
      });
    }).catch(function (e) {
      busy = false; render(state); msg('mainMsg', 'Could not save: ' + (e && e.message ? e.message : e));
    });
  }

  function finish(r, queued, entry) {
    busy = false;
    state.onSite = r.action === 'IN';
    state.since = r.action === 'IN' ? fmtTime(entry.at) : null;
    state.location = r.action === 'IN' ? r.location : null;
    state.lastLocation = r.location;
    if (!queued) {
      state.history = [{ at: r.at || entry.at, action: r.action, location: r.location,
        map: entry.loc ? 'https://www.google.com/maps?q=' + entry.loc.lat + ',' + entry.loc.lng : '' }].concat(state.history || []).slice(0, 15);
    }
    saveState();
    $('done').className = 'card done ' + (r.action === 'IN' ? 'in' : 'out');
    setImg('donePhoto', r.photo);
    $('doneTick').textContent = r.photo ? '' : (r.action === 'IN' ? '✔' : '⏏');
    $('doneWhat').textContent = r.name + (r.action === 'IN' ? ' clocked IN' : ' clocked OUT');
    $('doneTime').textContent = r.time;
    $('doneDate').textContent = r.location + ' · ' + r.date;
    $('doneFlag').textContent = queued
      ? 'No signal right now. This is saved on your phone and will send when you have signal.'
      : (r.locationStatus === 'OK' || r.locationStatus === 'SITE PIN NOT SET' ? '' : 'Note: location check was "' + r.locationStatus + '". Your supervisor can see this.');
    show('done');
    if (navigator.vibrate) navigator.vibrate(150);
  }

  /* ---------- first-time setup ---------- */
  function notMe() {
    foundName = null; $('pin').value = '';
    $('pinStep').classList.remove('hidden'); $('confirmStep').classList.add('hidden');
    msg('regMsg', '');
  }
  function doFind() {
    var pin = $('pin').value.trim();
    if (!pin) { msg('regMsg', 'Enter your PIN.'); return; }
    var b = $('findBtn'); b.disabled = true; b.textContent = 'Checking…'; msg('regMsg', '');
    callApi('findByPin', [pin], 20000).then(function (n) {
      b.disabled = false; b.textContent = 'Next';
      foundName = n; $('foundName').textContent = n;
      $('pinStep').classList.add('hidden'); $('confirmStep').classList.remove('hidden');
    }, function (e) { b.disabled = false; b.textContent = 'Next'; msg('regMsg', e.message); });
  }
  function doRegister() {
    var pin = $('pin').value.trim();
    if (!foundName || !pin) { notMe(); return; }
    var b = $('regBtn'); b.disabled = true; b.textContent = 'Registering…';
    callApi('register', [foundName, pin, phoneId(), photoData], 30000).then(function (s) {
      b.disabled = false; b.textContent = 'Yes, register this phone'; render(s);
    }, function (e) { b.disabled = false; b.textContent = 'Yes, register this phone'; msg('regMsg', e.message); });
  }
  function pickPhoto(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () {
      var max = 400, k = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      photoData = c.toDataURL('image/jpeg', 0.8); setImg('photoPreview', photoData);
    };
    img.src = URL.createObjectURL(f);
  }

  /* ---------- start ---------- */
  $('findBtn').onclick = doFind;
  $('regBtn').onclick = doRegister;
  $('notMeBtn').onclick = notMe;
  $('photoInput').onchange = function () { pickPhoto(this); };
  $('actionBtn').onclick = doClock;
  $('doneBtn').onclick = function () { render(state); load(); };
  window.addEventListener('online', function () { updateNet(); sync(); });
  window.addEventListener('offline', updateNet);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !busy) sync().then(load); });
  setInterval(function () { if (!busy) sync(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

  updateNet();
  setupInstall();
  var cached = null;
  try { cached = JSON.parse(ls('clockin_state') || 'null'); } catch (e) {}
  if (cached && cached.registered) render(cached);
  sync().then(load);
})();
