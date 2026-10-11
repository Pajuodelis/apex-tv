/* Small, bounded UI work for Samsung's TV web engine. No player or DRM access. */
(function (global) {
  'use strict';
  function set(el, key, value) { if (el && el[key] !== value) el[key] = value; }
  function text(el, value) { if(global.ApexI18n)global.ApexI18n.setText(el,value);else set(el, 'textContent', value); }
  function attr(el, key, value) { if (el && el.getAttribute(key) !== value) el.setAttribute(key, value); }
  function style(el, key, value) { if (el && el.style[key] !== value) el.style[key] = value; }
  function motion(env, reduced) {
    var current = null, timer = 0, last = -1000;
    function cancel() { env.clearTimeout(timer); timer = 0; if (current) current.classList.remove('soft-enter'); current = null; }
    return { cancel: cancel, enter: function (el) {
      var now = env.performance && env.performance.now ? env.performance.now() : Date.now();
      cancel(); if (!el || reduced && reduced() || env.matchMedia && env.matchMedia('(prefers-reduced-motion: reduce)').matches || now - last < 250) return;
      last = now; current = el; el.classList.add('soft-enter');
      timer = env.setTimeout(cancel, 180);
    } };
  }
  function images(env, document) {
    var observer = null, queue = [], pending = [], flights = [], active = 0, generation = 0, held = false, holdTimer = 0, pumpTimer = 0;
    function pump() {
      while (!held && active < 2 && queue.length) {
        var entry = queue.shift(); if (!document.contains(entry.img)) continue;
        start(entry);
      }
    }
    function start(entry) {
      var serial = generation, done = false; active++; flights.push(entry);
      function finish(ok) {
        if (done || serial !== generation) return; done = true; active--;
        flights = flights.filter(function (value) { return value !== entry; });
        entry.img.onload = entry.img.onerror = null;
        if (document.contains(entry.img)) { if (ok) style(entry.fallback, 'visibility', 'hidden'); else entry.img.remove(); }
        pump();
      }
      entry.img.onload = function () { finish(true); }; entry.img.onerror = function () { finish(false); }; entry.img.src = entry.url;
    }
    function enqueue(entry) {
      if (entry.queued) return; entry.queued = true;
      pending = pending.filter(function (value) { return value !== entry; });
      if (entry.large) queue.unshift(entry); else queue.push(entry); pump();
    }
    function reset() {
      generation++; env.clearTimeout(holdTimer);env.clearTimeout(pumpTimer); held = false;
      if (observer) observer.disconnect(); observer = null;
      flights.forEach(function (entry) { entry.img.onload = entry.img.onerror = null; entry.img.removeAttribute('src'); });
      queue = []; pending = []; flights = []; active = 0;
    }
    return { reset: reset, defer: function () {
      held = true; env.clearTimeout(holdTimer); holdTimer = env.setTimeout(function () { held = false; pump(); }, 120);
    }, add: function (img, url, fallback, large) {
      var entry = { img: img, url: url, fallback: fallback, large: large, queued: false };
      if (large || !env.IntersectionObserver) { queue.push(entry); entry.queued = true; env.clearTimeout(pumpTimer);pumpTimer=env.setTimeout(pump,0); return; }
      pending.push(entry);
      if (!observer) observer = new env.IntersectionObserver(function (entries) {
        entries.forEach(function (value) { if (!value.isIntersecting) return;
          var entry = pending.filter(function (item) { return item.img === value.target; })[0];
          if (entry) { observer.unobserve(entry.img); enqueue(entry); }
        });
      }, { rootMargin: '160px 120px', threshold: 0.01 });
      observer.observe(img);
    } };
  }
  function spatial(root, env) {
    var entries = null;
    function invalidate() { entries = null; }
    if (env.MutationObserver) new env.MutationObserver(invalidate).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled','hidden','class'] });
    root.addEventListener('scroll', invalidate, true); env.addEventListener('resize', invalidate);
    return function (active, key) {
      if (!entries) entries = Array.prototype.slice.call(root.querySelectorAll('main button,main input,.footer-help')).filter(function (el) { return !el.disabled && el.offsetParent !== null; }).map(function (el) { var r = el.getBoundingClientRect(); return { el: el, x: r.left+r.width/2, y: r.top+r.height/2 }; });
      var origin = entries.filter(function (item) { return item.el === active; })[0]; if (!origin) { invalidate(); return null; }
      var best = Infinity, winner = null;
      entries.forEach(function (item) { if (item.el === active || item.el.disabled) return;
        var dx = item.x-origin.x, dy = item.y-origin.y, primary = key===37 ? -dx : key===39 ? dx : key===38 ? -dy : dy, cross = key===37 || key===39 ? Math.abs(dy) : Math.abs(dx);
        if (primary > 5 && primary+cross*3 < best) { best = primary+cross*3; winner = item.el; }
      }); return winner;
    };
  }
  var api = { set: set, text: text, attr: attr, style: style, motion: motion, images: images, spatial: spatial };
  global.ApexUI = api; if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));