/* Apex TV legacy runtime for Samsung Tizen 5.0/5.5 (Chromium 63/69).
   Loaded by index.html before the boot loader and the signed menu.
   Every polyfill is guarded: on Tizen 6+ the native implementation wins.
   Keep this file ES5 so it can never be the cause of a boot SyntaxError. */
(function (global) {
  'use strict';
  function define(target, name, value) {
    if (target && !(name in target)) {
      try { Object.defineProperty(target, name, { value: value, writable: true, configurable: true, enumerable: false }); }
      catch (_) { target[name] = value; }
    }
  }

  /* --- ES2020 globalThis (Chrome 71) --- */
  if (typeof global.globalThis === 'undefined') define(global, 'globalThis', global);

  /* --- String (Chrome 66 / 73 / 85) --- */
  define(String.prototype, 'trimStart', String.prototype.trimLeft || function () { return String(this).replace(/^[\s﻿\xA0]+/, ''); });
  define(String.prototype, 'trimEnd', String.prototype.trimRight || function () { return String(this).replace(/[\s﻿\xA0]+$/, ''); });
  define(String.prototype, 'matchAll', function (regexp) {
    if (regexp == null) throw new TypeError('matchAll requires a RegExp');
    var flags = regexp instanceof RegExp ? regexp.flags : 'g';
    if (regexp instanceof RegExp && flags.indexOf('g') < 0) throw new TypeError('matchAll requires a global RegExp');
    var re = new RegExp(regexp, flags.indexOf('g') < 0 ? flags + 'g' : flags), text = String(this), done = false;
    re.lastIndex = regexp instanceof RegExp ? regexp.lastIndex : 0;
    var iterator = {
      next: function () {
        if (done) return { value: undefined, done: true };
        var match = re.exec(text);
        if (match === null) { done = true; return { value: undefined, done: true }; }
        if (match[0] === '') {
          var n=re.lastIndex, first=text.charCodeAt(n), second=text.charCodeAt(n+1);
          re.lastIndex += re.unicode && first>=0xD800 && first<=0xDBFF && second>=0xDC00 && second<=0xDFFF ? 2 : 1;
        }
        return { value: match, done: false };
      }
    };
    iterator[Symbol.iterator] = function () { return iterator; };
    return iterator;
  });
  define(String.prototype, 'replaceAll', function (search, replacement) {
    if (search instanceof RegExp) {
      if (search.flags.indexOf('g') < 0) throw new TypeError('replaceAll requires a global RegExp');
      return String(this).replace(search, replacement);
    }
    var escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, function(ch) { return '\\' + ch; });
    return String(this).replace(new RegExp(escaped, 'g'), replacement);
  });

  /* --- Array / Object (Chrome 69 / 73 / 92 / 93) --- */
  define(Array.prototype, 'flat', function flat(depth) {
    var level = depth === undefined ? 1 : Number(depth) || 0, out = [];
    (function walk(list, d) {
      for (var i = 0; i < list.length; i++) {
        if (!(i in list)) continue;
        if (Array.isArray(list[i]) && d > 0) walk(list[i], d - 1); else out.push(list[i]);
      }
    }(this, level));
    return out;
  });
  define(Array.prototype, 'flatMap', function (callback, thisArg) { return Array.prototype.map.call(this, callback, thisArg).flat(1); });
  function at(index) { var n = Math.trunc(Number(index)) || 0, len = this.length; if (n < 0) n += len; return n < 0 || n >= len ? undefined : this[n]; }
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', function (index) { return at.call(String(this), index); });
  define(Object, 'fromEntries', function (entries) {
    var result = {};
    Array.from(entries, function (pair) { Object.defineProperty(result, pair[0], {value:pair[1],writable:true,enumerable:true,configurable:true}); });
    return result;
  });
  define(Object, 'hasOwn', function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); });

  /* --- Promise (finally = Chrome 63, allSettled = Chrome 76, any = Chrome 85) --- */
  if (typeof Promise === 'function') {
    define(Promise.prototype, 'finally', function (callback) {
      if (typeof callback !== 'function') return this.then(callback, callback);
      var P = this.constructor || Promise;
      return this.then(
        function (value) { return P.resolve(callback()).then(function () { return value; }); },
        function (reason) { return P.resolve(callback()).then(function () { throw reason; }); }
      );
    });
    define(Promise, 'allSettled', function (items) {
      return Promise.all(Array.from(items, function (item) {
        return Promise.resolve(item).then(
          function (value) { return { status: 'fulfilled', value: value }; },
          function (reason) { return { status: 'rejected', reason: reason }; }
        );
      }));
    });
  }

  /* --- queueMicrotask (Chrome 71) --- */
  if (typeof global.queueMicrotask !== 'function') {
    define(global, 'queueMicrotask', function (callback) {
      Promise.resolve().then(callback).catch(function (error) { setTimeout(function () { throw error; }, 0); });
    });
  }

  /* --- AbortController / AbortSignal (Chrome 66) + AbortSignal.timeout (Chrome 103) --- */
  function abortError(name, message) {
    try { return new DOMException(message, name); }
    catch (_) { var e = new Error(message); e.name = name; return e; }
  }
  if (typeof global.AbortController !== 'function') {
    var AbortSignalShim = function AbortSignal() { this.aborted = false; this.reason = undefined; this.onabort = null; this._listeners = []; };
    AbortSignalShim.prototype.addEventListener = function (type, listener) { if (type === 'abort' && typeof listener === 'function') this._listeners.push(listener); };
    AbortSignalShim.prototype.removeEventListener = function (type, listener) { if (type === 'abort') this._listeners = this._listeners.filter(function (l) { return l !== listener; }); };
    AbortSignalShim.prototype.throwIfAborted = function () { if (this.aborted) throw this.reason; };
    AbortSignalShim.prototype._abort = function (reason) {
      if (this.aborted) return;
      this.aborted = true; this.reason = reason === undefined ? abortError('AbortError', 'The operation was aborted.') : reason;
      var event = { type: 'abort', target: this }, listeners = this._listeners.slice();
      if (typeof this.onabort === 'function') { try { this.onabort(event); } catch (_) {} }
      for (var i = 0; i < listeners.length; i++) { try { listeners[i].call(this, event); } catch (_) {} }
    };
    var AbortControllerShim = function AbortController() { this.signal = new AbortSignalShim(); };
    AbortControllerShim.prototype.abort = function (reason) { this.signal._abort(reason); };
    global.AbortSignal = AbortSignalShim;
    global.AbortController = AbortControllerShim;

    /* Chromium 63's fetch ignores `signal`, so reject the caller's promise on abort.
       (The socket finishes in the background; the result is discarded.) */
    if (typeof global.fetch === 'function') {
      var nativeFetch = global.fetch;
      global.fetch = function (input, init) {
        var signal = init && init.signal;
        if (!signal || !(signal instanceof AbortSignalShim)) return nativeFetch.apply(this, arguments);
        if (signal.aborted) return Promise.reject(signal.reason);
        var clean = {}; Object.keys(init).forEach(function (key) { if (key !== 'signal') clean[key] = init[key]; });
        var self = this;
        return new Promise(function (resolve, reject) {
          function onAbort() { reject(signal.reason); }
          signal.addEventListener('abort', onAbort);
          nativeFetch.call(self, input, clean).then(
            function (response) { signal.removeEventListener('abort', onAbort); resolve(response); },
            function (error) { signal.removeEventListener('abort', onAbort); reject(error); }
          );
        });
      };
    }
  }
  if (typeof global.AbortSignal === 'function' && typeof global.AbortSignal.timeout !== 'function') {
    global.AbortSignal.timeout = function (ms) {
      var controller = new global.AbortController();
      setTimeout(function () { controller.abort(abortError('TimeoutError', 'The operation timed out.')); }, ms);
      return controller.signal;
    };
  }

  /* --- CSS: flexbox `gap` only exists from Chromium 84. Flag the page so
         tv.css can apply margin-based fallbacks only where needed. --- */
  function flagFlexGap() {
    try {
      var root = document.documentElement, probe = document.createElement('div');
      probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
      probe.appendChild(document.createElement('div')); probe.appendChild(document.createElement('div'));
      root.appendChild(probe);
      var supported = probe.scrollHeight === 1;
      root.removeChild(probe);
      if (!supported) root.className += (root.className ? ' ' : '') + 'no-flexgap';
    } catch (_) {}
  }
  if (global.document) flagFlexGap();

  global.APEX_LEGACY_RUNTIME = { version: 1, target: 'chrome63' };
}(typeof window !== 'undefined' ? window : this));
