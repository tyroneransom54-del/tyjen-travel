// Small progressive-enhancement script. The whole app works with plain HTML
// forms and links without this file; it only adds a couple of conveniences.
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("site-nav--open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  // Register the PWA service worker if supported.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/service-worker.js").catch(function () {
        /* non-fatal: app works fully without offline support */
      });
    });
  }
})();
