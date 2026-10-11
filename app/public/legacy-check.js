// Shows a friendly message on very old WebViews that cannot run the app bundle.
(function () {
  var ok =
    typeof Promise !== 'undefined' &&
    typeof Symbol !== 'undefined' &&
    typeof Object.fromEntries === 'function' &&
    typeof globalThis !== 'undefined' &&
    !!window.CSS &&
    CSS.supports('gap', '1px');
  if (!ok) {
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('legacy');
      if (el) el.style.display = 'block';
    });
  }
})();
