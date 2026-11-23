(function () {
  var state = null, busy = false, inProfile = false, wantProfile = false, photoData = null, foundName = null, lastFix = null, gpsStarted = false, installEvt = null;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- small helpers ---------- */
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function show(id) {
    ['loading', 'register', 'main', 'done', 'profile'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); });
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
  function getVisitor() { try { var v = JSON.parse(ls('clockin_visitor') || 'null'); return v && v.name ? v : null; } catch (e) { return null; } }
  function fillSelect(sel, names, pick) {
    sel.length = 1;
    (names || []).forEach(function (n) { var o = document.createElement('option'); o.value = o.textContent = n; sel.appendChild(o); });
    if ((names || []).length === 1) pick = names[0];
    if (pick && (names || []).indexOf(pick) >= 0) sel.value = pick;
  }
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
    if (inProfile && s.registered && !s.visitor) return;
    if (!s.registered) {
      if (!$('register').classList.contains('hidden') && !$('visitorStep').classList.contains('hidden')) {
        fillSelect($('vLoc'), s.locations, $('vLoc').value || ls('clockin_location'));
        return;
      }
      notMe(); show('register');
      if (wantProfile) msg('regMsg', 'To change your profile, first set up this phone: type your PIN (the year you were born) and press Next.', 'info');
      return;
    }
    var v = !!s.visitor;
    $('hello').textContent = 'Hi ' + s.name.split(' ')[0];
    setImg('mainPhoto', s.photo);
    $('workerMsg').textContent = v ? 'Visitor: sign in when you arrive and sign out when you leave.' : (s.message || '');
    $('locLabel').textContent = v ? 'Location you are visiting' : 'Work location';
    $('histTitle').textContent = v ? 'My sign-ins' : 'My clock-ins';
    fillSelect($('loc'), s.locations, ls('clockin_location') || s.lastLocation);
    $('locWrap').classList.toggle('hidden', !!s.onSite);
    $('visitorDone').classList.toggle('hidden', !v || !!s.onSite);
    $('profileBtn').classList.toggle('hidden', v);
    var pill = $('statusPill'), btn = $('actionBtn');
    if (s.onSite) {
      pill.className = 'status on'; pill.textContent = (v ? 'Signed in' : 'On site') + (s.location ? ' at ' + s.location : '') + ' since ' + s.since;
      btn.className = 'btn-out'; btn.textContent = v ? 'SIGN OUT' : 'CLOCK OUT';
    } else {
      pill.className = 'status off'; pill.textContent = v ? 'Not signed in' : 'Not clocked in';
      btn.className = 'btn-in'; btn.textContent = v ? 'SIGN IN' : 'CLOCK IN';
    }
    btn.disabled = false;
    msg('mainMsg', '');
    renderHistory();
    show('main');
    startGps();
    // The Command Centre's WORKER PROFILE button opens the app at #profile.
    if (wantProfile && !v && s.name) { wantProfile = false; openProfile(); }
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
    var vis = getVisitor();
    var req = vis
      ? callApi('visitorState', [vis], 20000).then(function (r) { r.visitor = true; r.registered = true; return r; })
      : callApi('state', [phoneId()], 20000);
    req.then(render, function (e) {
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
    if (action === 'IN' && !site) { msg('mainMsg', state.visitor ? 'Pick the location you are visiting.' : 'Pick your work location first.'); return; }
    if (action === 'IN') ls('clockin_location', site);
    var btn = $('actionBtn');
    busy = true; btn.disabled = true;
    btn.textContent = lastFix ? 'Saving…' : 'Checking location…';
    msg('mainMsg', '');
    getLocation().then(function (loc) {
      btn.textContent = 'Saving…';
      var entry = { id: newId(), action: action, site: site, loc: loc ? { lat: loc.lat, lng: loc.lng, acc: loc.acc } : null, at: Date.now() };
      var vis = state.visitor ? getVisitor() : null;
      if (vis) entry.visitor = vis;
      var send = !online() ? Promise.reject({ network: true })
        : vis ? callApi('visitorClock', [phoneId(), vis, action, entry.loc, site, { at: entry.at, id: entry.id }], 12000)
        : callApi('clock', [phoneId(), action, entry.loc, site, { at: entry.at, id: entry.id }], 12000);
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
    var verb = state.visitor ? ' signed ' : ' clocked ';
    $('doneWhat').textContent = (state.visitor ? getVisitor().name : r.name) + verb + r.action;
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
    foundName = null; $('pin').value = ''; $('pickName').innerHTML = '';
    $('pinStep').classList.remove('hidden'); $('confirmStep').classList.add('hidden'); $('visitorStep').classList.add('hidden');
    $('regTitle').textContent = 'Set up this phone'; $('regSub').classList.remove('hidden');
    msg('regMsg', '');
  }
  function pickedName(n) {
    foundName = n; $('foundName').textContent = n; $('pickName').innerHTML = '';
    $('pinStep').classList.add('hidden'); $('confirmStep').classList.remove('hidden');
  }
  function doFind() {
    var pin = $('pin').value.trim();
    if (!pin) { msg('regMsg', 'Enter your PIN.'); return; }
    var b = $('findBtn'); b.disabled = true; b.textContent = 'Checking…'; msg('regMsg', '');
    $('pickName').innerHTML = '';
    callApi('findByPin', [pin], 20000).then(function (n) {
      b.disabled = false; b.textContent = 'Next';
      if (!Array.isArray(n)) { pickedName(n); return; }
      // More than one person has this PIN (same birth year): let them tap their own name.
      var box = $('pickName');
      var p = document.createElement('p'); p.textContent = 'More than one person has that PIN. Tap your name:'; box.appendChild(p);
      n.forEach(function (nm) {
        var bt = document.createElement('button'); bt.type = 'button'; bt.textContent = nm;
        bt.onclick = function () { pickedName(nm); }; box.appendChild(bt);
      });
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

  /* ---------- my profile ---------- */
  var profilePhoto = null;
  function openProfile() {
    if (!online()) { msg('mainMsg', 'No signal. Your profile can be changed when you have signal.'); return; }
    profilePhoto = null;
    $('pName').textContent = state.name; setImg('pPhoto', state.photo);
    ['pPhone', 'pEmail', 'pEmergency'].forEach(function (id) { $(id).value = ''; $(id).disabled = true; });
    $('pSaveBtn').disabled = true; msg('pMsg', 'Loading…', 'warn');
    inProfile = true; show('profile');
    callApi('getProfile', [phoneId()], 20000).then(function (p) {
      $('pPhone').value = p.phone || ''; $('pEmail').value = p.email || ''; $('pEmergency').value = p.emergency || '';
      if (p.photo) setImg('pPhoto', p.photo);
      ['pPhone', 'pEmail', 'pEmergency'].forEach(function (id) { $(id).disabled = false; });
      $('pSaveBtn').disabled = false; msg('pMsg', '');
    }, function (e) { msg('pMsg', e.message); });
  }
  function saveProfile() {
    var b = $('pSaveBtn'); b.disabled = true; b.textContent = 'Saving…'; msg('pMsg', '');
    var data = { phone: $('pPhone').value, email: $('pEmail').value, emergency: $('pEmergency').value };
    if (profilePhoto) data.photoData = profilePhoto;
    callApi('saveProfile', [phoneId(), data], 30000).then(function (p) {
      b.disabled = false; b.textContent = 'Save';
      if (p.photo) { state.photo = p.photo; saveState(); setImg('pPhoto', p.photo); }
      profilePhoto = null;
      msg('pMsg', 'Saved.', 'ok');
    }, function (e) { b.disabled = false; b.textContent = 'Save'; msg('pMsg', e.message); });
  }
  function shrinkPhoto(input, done) {
    var f = input.files && input.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () {
      var max = 400, k = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = URL.createObjectURL(f);
  }

  /* ---------- visitors ---------- */
  function showVisitorForm() {
    $('pinStep').classList.add('hidden'); $('confirmStep').classList.add('hidden'); $('visitorStep').classList.remove('hidden');
    $('regTitle').textContent = 'Visitor sign in'; $('regSub').classList.add('hidden');
    msg('regMsg', '');
    var v = getVisitor() || {};
    if (v.name) $('vName').value = v.name;
    if (v.company) $('vCompany').value = v.company;
    fillSelect($('vLoc'), (state && state.locations) || [], ls('clockin_location'));
    if (online()) callApi('state', [phoneId()], 20000).then(function (s) {
      if (!s.registered) { state = s; saveState(); fillSelect($('vLoc'), s.locations, $('vLoc').value || ls('clockin_location')); }
    }, function () {});
  }
  function visitorSignIn() {
    var name = $('vName').value.replace(/\s+/g, ' ').trim(), company = $('vCompany').value.replace(/\s+/g, ' ').trim(), site = $('vLoc').value;
    if (name.indexOf(' ') < 0) { msg('regMsg', 'Type your first and last name.'); return; }
    if (!company) { msg('regMsg', 'Type the company you are with.'); return; }
    if (!site) { msg('regMsg', 'Pick the location you are visiting.'); return; }
    ls('clockin_visitor', JSON.stringify({ name: name, company: company }));
    ls('clockin_location', site);
    var locs = $('vLoc').options; var names = [];
    for (var i = 1; i < locs.length; i++) names.push(locs[i].value);
    render({ registered: true, visitor: true, name: name, locations: names, onSite: false, history: [] });
    $('loc').value = site;
    doClock();
  }
  function visitorDone() {
    try { localStorage.removeItem('clockin_visitor'); } catch (e) {}
    $('vName').value = ''; $('vCompany').value = '';
    var locs = state && state.locations;
    state = { registered: false, locations: locs }; saveState();
    notMe(); show('register');
  }

  /* ---------- start ---------- */
  $('profileBtn').onclick = openProfile;
  $('pSaveBtn').onclick = saveProfile;
  $('pBackBtn').onclick = function () { inProfile = false; render(state); };
  $('pPhotoInput').onchange = function () { shrinkPhoto(this, function (d) { profilePhoto = d; setImg('pPhoto', d); }); };
  $('visitorLink').onclick = function (e) { e.preventDefault(); showVisitorForm(); };
  $('vSignInBtn').onclick = visitorSignIn;
  $('vBackBtn').onclick = notMe;
  $('visitorDoneLink').onclick = function (e) { e.preventDefault(); visitorDone(); };
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

  function checkHash() {
    if (location.hash !== '#profile') return false;
    wantProfile = true;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    return true;
  }
  window.addEventListener('hashchange', function () { if (checkHash() && state && !busy) render(state); });
  checkHash();
  updateNet();
  setupInstall();
  var cached = null;
  try { cached = JSON.parse(ls('clockin_state') || 'null'); } catch (e) {}
  if (cached && cached.registered) render(cached);
  sync().then(load);
})();
