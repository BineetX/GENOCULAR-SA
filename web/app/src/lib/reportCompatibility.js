export function needsReportCookieFallback(key) {
  return /(?:^|\/)quast\/.*\.html$/i.test(String(key || ""));
}

// Report-local preferences only: never grant access to application cookies.
export const REPORT_COOKIE_FALLBACK = `
(function () {
  try { void document.cookie; return; } catch (_) {}
  var cookies = Object.create(null);
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: function () {
      return Object.keys(cookies).map(function (name) { return name + '=' + cookies[name]; }).join('; ');
    },
    set: function (value) {
      var parts = String(value).split(';');
      var pair = parts.shift();
      var separator = pair.indexOf('=');
      if (separator < 1) return;
      var name = pair.slice(0, separator).trim();
      var expired = parts.some(function (attribute) {
        var item = attribute.trim();
        if (/^max-age\\s*=\\s*0$/i.test(item)) return true;
        if (/^expires=/i.test(item)) return Date.parse(item.slice(item.indexOf('=') + 1)) <= Date.now();
        return false;
      });
      if (expired) delete cookies[name];
      else cookies[name] = pair.slice(separator + 1);
    }
  });
})();
`;
