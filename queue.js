/* Shared by the app page and its service worker: talks to the Google Sheet and keeps clock-ins made without signal. */
var CLOCK_API = 'https://script.google.com/macros/s/AKfycbyqIYUOT1IxDTE1f4UTbBiAFSiTzqGpNhzdrPabLhH8zZgiO6-sGgPyDqE7vUzEFbqt/exec';

function callApi(fn, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
      var e = new Error('No signal. Try again.'); e.network = true; reject(e);
    }, timeoutMs || 15000);
    fetch(CLOCK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
      redirect: 'follow',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      if (j && j.ok) return resolve(j.data);
      var e = new Error((j && j.error) || 'Something went wrong.'); e.server = true; reject(e);
    }).catch(function () {
      clearTimeout(timer);
      var e = new Error('No signal. Try again.'); e.network = true; reject(e);
    });
  });
}

function openDb_() {
  return new Promise(function (resolve, reject) {
    var r = indexedDB.open('clockin', 1);
    r.onupgradeneeded = function () {
      r.result.createObjectStore('queue', { keyPath: 'id' });
      r.result.createObjectStore('meta');
    };
    r.onsuccess = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error); };
  });
}

function store_(name, mode, fn) {
  return openDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(name, mode);
      var req = fn(t.objectStore(name));
      t.oncomplete = function () { resolve(req ? req.result : undefined); };
      t.onerror = function () { reject(t.error); };
    });
  });
}

function queueAdd(entry) { return store_('queue', 'readwrite', function (s) { return s.put(entry); }); }
function queueAll() { return store_('queue', 'readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return x.at - y.at; }); }); }
function queueDel(id) { return store_('queue', 'readwrite', function (s) { return s.delete(id); }); }
function metaSet(k, v) { return store_('meta', 'readwrite', function (s) { return s.put(v, k); }); }
function metaGet(k) { return store_('meta', 'readonly', function (s) { return s.get(k); }); }

/** Sends saved clock-ins oldest first. Stops at the first one that can't get through. */
function flushQueue() {
  var result = { sent: 0, rejected: [], remaining: 0 };
  return metaGet('phoneId').then(function (pid) {
    if (!pid) return result;
    return queueAll().then(function (items) {
      var i = 0;
      function next() {
        if (i >= items.length) return Promise.resolve();
        var e = items[i];
        var call = e.visitor
          ? callApi('visitorClock', [pid, e.visitor, e.action, e.loc, e.site, { at: e.at, id: e.id }], 20000)
          : callApi('clock', [pid, e.action, e.loc, e.site, { at: e.at, id: e.id }], 20000);
        return call.then(function () {
          result.sent++; i++; return queueDel(e.id).then(next);
        }, function (err) {
          if (err.server) { result.rejected.push(err.message); i++; return queueDel(e.id).then(next); }
          result.remaining = items.length - i;
        });
      }
      return next();
    });
  }).then(function () {
    if (result.sent) callApi('sync', [], 20000).catch(function () {});
    return result;
  });
}
