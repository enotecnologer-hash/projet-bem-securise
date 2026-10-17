/* BEM audit.js
   Installation (une ligne):
   <script src="https://VOTRE-DOMAINE/audit.js" defer
           data-token="TOKEN_DU_DOMAINE"
           data-api="https://XXXX.supabase.co/functions/v1/ingest"></script>

   Consentement CNDP: les événements comportementaux (formulaire_abandonne) ne sont envoyés
   qu'après window.BEM.consent(true), à appeler depuis votre bannière de consentement.
   Les erreurs techniques sont envoyées sans consentement. Aucune valeur de champ n'est lue. */
(function () {
  "use strict";
  if (window.BEM && window.BEM.__loaded) return;

  // Doit être lu pendant l'exécution synchrone du script.
  var script = document.currentScript;

  var ALLOWED_TYPES = {
    formulaire_abandonne: true,
    erreur_js: true,
    page_lente: true,
    fichier_casse: true,
    erreur_api: true,
  };
  var BEHAVIORAL_TYPES = { formulaire_abandonne: true };
  var MAX_PER_PAGE = 30; // plafond d'événements par page vue
  var BATCH_SIZE = 10;
  var FLUSH_DELAY = 2000;

  var queue = [];
  var seen = {};
  var total = 0;
  var timer = null;
  var config = null;
  var consent = null; // null = lire le stockage local
  var formState = new WeakMap();
  // Référence native: les envois de BEM ne passent jamais par le fetch instrumenté (pas de boucle).
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function readConsent() {
    if (consent !== null) return consent;
    try {
      return window.localStorage.getItem("bem_cndp_consent") === "true";
    } catch (_) {
      return false;
    }
  }

  function setConsent(value) {
    consent = !!value;
    try {
      window.localStorage.setItem("bem_cndp_consent", String(consent));
    } catch (_) {}
  }

  function cleanUrl(value) {
    try {
      var url = new URL(value, window.location.href);
      url.search = "";
      url.hash = "";
      return url.toString().slice(0, 2048);
    } catch (_) {
      return String(value || "").split(/[?#]/, 1)[0].slice(0, 2048);
    }
  }

  // Retire emails et numéros de téléphone des messages d'erreur.
  function scrub(value, max) {
    return String(value)
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[nombre]")
      .slice(0, max || 300);
  }

  function metadata(value) {
    var output = {};
    if (!value || typeof value !== "object") return output;
    Object.keys(value).slice(0, 12).forEach(function (key) {
      var item = value[key];
      if (typeof item === "string") output[key.slice(0, 80)] = scrub(item, 300);
      else if (typeof item === "number" || typeof item === "boolean") output[key.slice(0, 80)] = item;
    });
    return output;
  }

  function add(type, data) {
    if (!config || !ALLOWED_TYPES[type] || total >= MAX_PER_PAGE) return;
    var behavioral = !!BEHAVIORAL_TYPES[type];
    if (behavioral && !readConsent()) return;

    data = data || {};
    var url = cleanUrl(data.url || window.location.href);
    var key = type + "|" + url + "|" + String(data.message || data.resource || "");
    if (seen[key]) return;
    seen[key] = true;

    total++;
    queue.push({
      type: type,
      session_id: config.sessionId,
      url: url,
      metadata: metadata(data),
      consent: behavioral ? true : undefined,
    });
    if (queue.length >= BATCH_SIZE) flush(false);
    else if (!timer) timer = setTimeout(function () { flush(false); }, FLUSH_DELAY);
  }

  // Le token est dans le corps et le type est text/plain: requête "simple", donc sans préflight CORS.
  function flush(useBeacon) {
    if (!config || queue.length === 0) return;
    clearTimeout(timer);
    timer = null;
    var payload = JSON.stringify({ token: config.token, events: queue.splice(0) });

    if (useBeacon && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(config.api, new Blob([payload], { type: "text/plain;charset=UTF-8" }))) return;
      } catch (_) {}
    }
    if (nativeFetch) {
      try {
        nativeFetch(config.api, {
          method: "POST",
          headers: { "content-type": "text/plain;charset=UTF-8" },
          body: payload,
          keepalive: true,
          credentials: "omit",
        }).catch(function () {});
      } catch (_) {}
    }
  }

  function checkAbandoned() {
    document.querySelectorAll("form").forEach(function (form) {
      var state = formState.get(form);
      if (state && state.filled && !state.submitted) {
        formState.set(form, { filled: false, submitted: false });
        add("formulaire_abandonne", {});
      }
    });
  }

  function recordSlowPage() {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav && nav.loadEventEnd > 5000) add("page_lente", { load_ms: Math.round(nav.loadEventEnd) });
  }

  function init(options) {
    if (config) return;
    options = options || {};
    if (!options.token || !options.api) {
      if (window.console) console.warn("[BEM] data-token et data-api sont requis.");
      return;
    }
    config = {
      token: String(options.token),
      api: String(options.api),
      sessionId: "bem-" + Math.random().toString(36).slice(2) + Date.now().toString(36),
    };

    window.addEventListener("error", function (event) {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        add("fichier_casse", { resource: cleanUrl(target.src || target.href) });
      } else if (event.message && event.message !== "Script error.") {
        add("erreur_js", { message: scrub(event.message, 300), line: event.lineno, column: event.colno });
      }
    }, true);

    window.addEventListener("unhandledrejection", function (event) {
      var reason = event.reason;
      add("erreur_js", { message: scrub((reason && reason.message) || reason || "Promise rejetée", 300) });
    });

    if (nativeFetch) {
      window.fetch = function (input, initOptions) {
        var target = typeof input === "string" ? input : (input && input.url) || "";
        var own = target.indexOf(config.api) === 0;
        return nativeFetch(input, initOptions).then(function (response) {
          if (!own && response.status >= 500) add("erreur_api", { status: response.status, url: response.url || target });
          return response;
        }, function (error) {
          if (!own) add("erreur_api", { message: scrub((error && error.message) || "Erreur réseau", 200), url: target });
          throw error;
        });
      };
    }

    document.addEventListener("input", function (event) {
      var form = event.target && event.target.form;
      if (form) formState.set(form, { filled: true, submitted: false });
    }, true);
    document.addEventListener("submit", function (event) {
      if (event.target) formState.set(event.target, { filled: false, submitted: true });
    }, true);

    // visibilitychange est plus fiable que pagehide sur mobile; on écoute les deux.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { checkAbandoned(); flush(true); }
    });
    window.addEventListener("pagehide", function () { checkAbandoned(); flush(true); });

    if (document.readyState === "complete") recordSlowPage();
    else window.addEventListener("load", recordSlowPage, { once: true });
  }

  window.BEM = window.BEM || {};
  window.BEM.__loaded = true;
  window.BEM.init = init;
  window.BEM.consent = setConsent;

  // Initialisation automatique depuis les attributs de la balise script.
  if (script && script.getAttribute("data-token")) {
    init({ token: script.getAttribute("data-token"), api: script.getAttribute("data-api") });
  }
})();
