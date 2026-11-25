// Content script på new-app.projektportalen.se.
// Fungerar som en SKRIVSKYDDAD proxy mot new-api: anropen görs med användarens
// egen inloggade session (cookies) och CSRF-token från sessionStorage.
//
// SÄKERHET: Endast endpoints i ALLOWLIST kan anropas. Inga PUT/DELETE/PATCH,
// och POST bara till list-endpoints som enbart läser data. Ändra inte detta
// utan att verifiera att en ny endpoint inte skriver något.
(() => {
  // Undvik dubbla lyssnare, men ersätt en gammal instans vars tilläggskontext
  // har dött (t.ex. efter att tillägget laddats om/uppdaterats).
  const prev = window.__ppPlanering;
  if (prev && prev.alive()) return;
  window.__ppPlanering = { alive: () => { try { return !!chrome.runtime.id; } catch { return false; } } };

  const API = 'https://new-api.projektportalen.se/api';

  const ALLOWLIST = [
    { method: 'GET', re: /^\/projects\/risk-scores$/ },
    { method: 'GET', re: /^\/projects\/\d+$/ },
    { method: 'GET', re: /^\/time-manage$/ },
    { method: 'GET', re: /^\/employees\/schedules$/ },
    { method: 'POST', re: /^\/projects\/list$/ },                 // läser projektlista (ag-grid)
    { method: 'POST', re: /^\/projects\/reported-user-times$/ },  // läser tidrader (ag-grid)
  ];

  function allowed(method, path) {
    return ALLOWLIST.some((a) => a.method === method && a.re.test(path));
  }

  function session() {
    try {
      const s = JSON.parse(sessionStorage.getItem('pp_session_rotation') || 'null');
      return s || null;
    } catch {
      return null;
    }
  }

  async function call({ method = 'GET', path, query, body }) {
    method = String(method).toUpperCase();
    if (!allowed(method, path)) {
      throw new Error(`Blockerat av skrivskyddet: ${method} ${path}`);
    }
    const url = new URL(API + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = { Accept: 'application/json', languageId: '1' };
    if (method === 'POST') {
      const s = session();
      if (!s || !s.csrfToken) throw new Error('Ingen inloggad session hittades i Projektportalen.');
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = s.csrfToken;
    }
    const res = await fetch(url.toString(), {
      method,
      credentials: 'include',
      headers,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(res.status === 401
        ? 'Inloggningen i Projektportalen har gått ut – ladda om Projektportalen-fliken och logga in igen.'
        : res.status === 403 ? `Saknar behörighet (403) för ${path}` : `HTTP ${res.status} för ${path}`);
      err.status = res.status;
      throw err;
    }
    let data = text ? JSON.parse(text) : null;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { /* dubbelkodad JSON förekommer */ }
    }
    return data;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'pp-ping') {
      const s = session();
      sendResponse({
        ok: true,
        loggedIn: !!(s && s.csrfToken),
        user: s && s.loginUser ? {
          userId: s.loginUser.userId,
          clientNumber: s.loginUser.clientNumber,
          roleCode: s.loginUser.roleCode,
        } : null,
      });
      return;
    }
    if (msg.type === 'pp-api') {
      call(msg.req).then(
        (data) => sendResponse({ ok: true, data }),
        (e) => sendResponse({ ok: false, error: e.message, status: e.status || null }),
      );
      return true; // asynkront svar
    }
  });
})();
