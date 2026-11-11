/* Saath: where visitors come from. First-party only — no cookies, no IP, no third-party analytics.
 * Records source/medium (e.g. utm_source=macronations&utm_medium=footer), the page, the MacroNations
 * session id when the visitor came from macronations.com, and a random browser id for unique counts.
 * The first source is remembered for 30 days so the app can credit a sign-up to it (see saath_attribute_me). */
(function () {
  var SUPA = "https://qgelvmefyexyzpwqupev.supabase.co";
  var KEY = "sb_publishable_fiT8iohvTZFUZ7vTlYpOvQ_9NPLPcIa"; // public key, as in the app
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function param(n) { try { return new URLSearchParams(location.search).get(n) || ""; } catch (e) { return ""; } }

  var vid = store("saath_vid");
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); store("saath_vid", vid); }

  var src = param("utm_source"), med = param("utm_medium"), mn = param("mn_sid");
  if (!src && document.referrer) {
    try { var h = new URL(document.referrer).hostname; if (h && h.indexOf("saath.") !== 0) src = h.replace(/^www\./, "").split(".")[0]; } catch (e) {}
  }
  var saved = null;
  try { saved = JSON.parse(store("saath_src") || "null"); } catch (e) {}
  if (src && (!saved || Date.now() - saved.at > 30 * 864e5)) {
    saved = { source: src, medium: med, mn_sid: mn, at: Date.now() };
    store("saath_src", JSON.stringify(saved));
  }
  var body = {
    p_source: src || (saved && saved.source) || "direct", p_medium: med || (saved && saved.medium) || "",
    p_page: location.pathname || "/", p_mn_sid: mn || (saved && saved.mn_sid) || "", p_visitor: vid,
  };
  try {
    fetch(SUPA + "/rest/v1/rpc/saath_track_visit", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + KEY },
      body: JSON.stringify(body),
    }).catch(function () {});
  } catch (e) {}
})();
