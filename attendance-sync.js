/* Nazeer's Motor Spares — cloud sync for the attendance module (optional).
   Every phone keeps working from its own copy, offline too. When signed in, each change is sent to the
   shared database and changes from the other phones come back within about a minute.
   Records are small (one per person per day), so the owner and the manager can mark at the same time.

   const cloud = NMSSync.create({ url, key });
   const app = NMSAttendance.mount(el, { storage: cloud.storage, cloud });
   cloud.attach(app);

   The key is a publishable key: it only allows what the database's row-level security allows,
   and that is nothing until a person signs in with an account that has been made a member. */
(function (root) {
  'use strict';
  const C = root.NMSAttendanceCore;

  function create(opts) {
    const URL_ = opts.url.replace(/\/$/, ''), KEY = opts.key;
    const DATA_KEY = opts.storageKey || 'nms-attendance-v1';
    const STATE_KEY = opts.stateKey || 'nms-attendance-sync-v1';
    // people can sign in with a short username: 'nazeer' means nazeer@<usernameDomain>
    const DOMAIN = opts.usernameDomain || '';
    const toEmail = (login) => { const l = String(login || '').trim().toLowerCase(); return l.includes('@') || !DOMAIN ? l : l + '@' + DOMAIN; };
    const toLogin = (email) => (DOMAIN && email.endsWith('@' + DOMAIN) ? email.slice(0, -DOMAIN.length - 1) : email);
    const OVERLAP_MS = 120000; // re-read the last two minutes each time, so no change is missed

    // cred: this phone's own login and secret, from its setup link. removed: the link was replaced by the owner.
    const blank = () => ({ session: null, shadow: {}, lastPull: '', synced: false, cred: null, removed: false });
    let st = blank();
    try { st = Object.assign(blank(), JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); } catch (e) { /* start fresh */ }
    const persist = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch (e) { /* storage full */ } };

    let app = null, current = null, ver = 0, busy = false, again = false, timer = null;
    let state = 'idle', lastOk = 0, lastError = '';
    const listeners = [];

    /* ---------- local storage (what the screens read and write) ---------- */
    const storage = {
      load() {
        if (current) return current;
        try { const raw = localStorage.getItem(DATA_KEY); current = raw ? JSON.parse(raw) : null; } catch (e) { current = null; }
        return current;
      },
      save(data) {
        current = data; ver++;
        localStorage.setItem(DATA_KEY, JSON.stringify(data));
        schedule();
      },
    };
    const writeLocal = () => localStorage.setItem(DATA_KEY, JSON.stringify(current));

    /* ---------- the data object <-> one record per thing ---------- */
    function toMap(d) {
      const m = {};
      if (!d) return m;
      m['settings:main'] = d.settings;
      for (const e of d.employees || []) m['employee:' + e.id] = e;
      for (const date in d.marks || {}) for (const emp in d.marks[date]) m['mark:' + date + '|' + emp] = d.marks[date][emp];
      for (const date in d.closed || {}) m['closed:' + date] = { reason: d.closed[date] };
      for (const a of d.advances || []) m['advance:' + a.id] = a;
      for (const p of d.payments || []) m['payment:' + p.id] = p;
      return m;
    }
    function applyRecord(d, kind, id, val) {
      const upsertList = (list) => {
        const i = list.findIndex((x) => x.id === id);
        if (val == null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = val; else list.push(val);
      };
      if (kind === 'settings') { if (val) d.settings = Object.assign({}, d.settings, val); }
      else if (kind === 'employee') upsertList(d.employees);
      else if (kind === 'advance') upsertList(d.advances);
      else if (kind === 'payment') upsertList(d.payments);
      else if (kind === 'closed') { if (val == null) delete d.closed[id]; else d.closed[id] = val.reason || 'Closed'; }
      else if (kind === 'mark') {
        const cut = id.indexOf('|'), date = id.slice(0, cut), emp = id.slice(cut + 1);
        if (val == null) {
          if (d.marks[date]) { delete d.marks[date][emp]; if (!Object.keys(d.marks[date]).length) delete d.marks[date]; }
        } else (d.marks[date] || (d.marks[date] = {}))[emp] = val;
      }
    }

    /* the database reorders JSON keys, so fingerprints use a key-sorted form */
    function canon(v) {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
      return JSON.stringify(v === undefined ? null : v);
    }
    function fp(v) {
      const s = canon(v);
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length;
    }

    /* ---------- auth ---------- */
    async function authCall(path, body) {
      const r = await fetch(URL_ + '/auth/v1/' + path, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        let msg = j.msg || j.error_description || j.message || 'Could not sign in';
        if (/invalid login/i.test(msg)) msg = DOMAIN ? 'Wrong username or password' : 'Wrong email or password';
        const e = new Error(msg); e.auth = true; throw e;
      }
      return j;
    }
    function setSession(j) {
      const old = st.session || {};
      st.session = {
        access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
        email: (j.user && j.user.email) || old.email || '', uid: (j.user && j.user.id) || old.uid || '',
        role: old.role || '', name: old.name || '',
        // a new account carries a temporary password that must be replaced at the first sign-in
        mustChange: j.user ? !!(j.user.user_metadata && j.user.user_metadata.must_change_password) : !!old.mustChange,
      };
      persist();
    }
    async function token() {
      if (!st.session) throw new Error('Not signed in');
      if (st.session.exp - Date.now() < 60000) {
        try { setSession(await authCall('token?grant_type=refresh_token', { refresh_token: st.session.refresh })); }
        catch (e) {
          if (!e.auth) throw e;
          // the session ran out: a phone set up with a link signs itself back in
          if (st.cred) {
            try { setSession(await authCall('token?grant_type=password', { email: toEmail(st.cred.login), password: st.cred.secret })); return st.session.access; }
            catch (e2) { if (!e2.auth) throw e2; st.removed = true; }
          }
          st.session = null; persist(); emit();
          throw new Error(st.removed ? 'This phone has been removed — ask Nazeer for a new setup link' : 'Signed out — please sign in again');
        }
      }
      return st.session.access;
    }
    async function rest(method, path, body, prefer) {
      const headers = { apikey: KEY, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' };
      if (prefer) headers.Prefer = prefer;
      const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error('The cloud refused the request (' + r.status + ')');
      return method === 'GET' ? r.json() : null;
    }

    /* ---------- sync: pull what changed in the cloud, then push what changed here ---------- */
    async function run() {
      if (!st.session || st.session.mustChange) return;
      if (busy) { again = true; return; }
      // never swap the data under someone who is typing or has a form open; try again shortly
      if (app && app.isBusy && app.isBusy()) { schedule(4000); return; }
      busy = true; setState('syncing');
      try {
        if (!st.session.role) {
          const me = await rest('GET', 'nms_members?select=role,name&user_id=eq.' + encodeURIComponent(st.session.uid));
          if (!me.length) throw new Error('This account has not been given access yet — ask the administrator');
          st.session.role = me[0].role; st.session.name = me[0].name; persist();
        }
        const startVer = ver;
        const d = C.normalise(JSON.parse(JSON.stringify(storage.load() || null)));
        const first = !st.synced;
        const seen = {}; // fingerprints learnt from the cloud, kept only if the pulled changes are kept
        let applied = false, newest = st.lastPull;
        const since = st.lastPull ? new Date(new Date(st.lastPull).getTime() - OVERLAP_MS).toISOString() : '';
        for (let offset = 0; ; offset += 1000) {
          const rows = await rest('GET', `nms_records?select=kind,id,data,deleted,updated_at&order=updated_at.asc,kind.asc,id.asc&limit=1000&offset=${offset}${since ? '&updated_at=gt.' + encodeURIComponent(since) : ''}`);
          const local = toMap(d);
          for (const row of rows) {
            const key = row.kind + ':' + row.id;
            const theirs = row.deleted ? 'x' : fp(row.data);
            const ours = key in local ? fp(local[key]) : 'x';
            const known = st.shadow[key];
            if (row.updated_at > newest) newest = row.updated_at;
            if (theirs === ours) { seen[key] = theirs; continue; }
            // changed on this phone since the last sync: keep this phone's version (it is sent below).
            // On the very first sync the cloud wins, so a new phone never overwrites the shop's records.
            if (!first && ours !== (known === undefined ? 'x' : known)) continue;
            applyRecord(d, row.kind, row.id, row.deleted ? null : row.data);
            seen[key] = theirs;
            applied = true;
          }
          if (rows.length < 1000) break;
        }
        // something was changed on this phone while the cloud was being read: start again with the new version
        if (ver !== startVer) { again = true; setState('ok'); return; }
        Object.assign(st.shadow, seen);
        st.lastPull = newest;
        if (applied) { current = d; writeLocal(); }

        const local = toMap(d), out = [];
        for (const key in local) { const f = fp(local[key]); if (st.shadow[key] !== f) out.push({ key, f, data: local[key], deleted: false }); }
        for (const key in st.shadow) if (!(key in local) && st.shadow[key] !== 'x') out.push({ key, f: 'x', data: {}, deleted: true });
        for (let i = 0; i < out.length; i += 200) {
          const chunk = out.slice(i, i + 200);
          await rest('POST', 'nms_records?on_conflict=kind,id', chunk.map((o) => {
            const cut = o.key.indexOf(':');
            return { kind: o.key.slice(0, cut), id: o.key.slice(cut + 1), data: o.data, deleted: o.deleted };
          }), 'resolution=merge-duplicates,return=minimal');
          for (const o of chunk) st.shadow[o.key] = o.f;
          persist();
        }
        st.synced = true;
        persist();
        lastOk = Date.now(); lastError = '';
        setState('ok');
        if (applied && app) app.reload();
      } catch (e) {
        lastError = navigator.onLine === false || e instanceof TypeError ? 'Offline — changes are kept on this phone and sent later' : e.message;
        persist();
        setState('error');
      } finally {
        busy = false;
        if (again) { again = false; schedule(300); }
      }
    }
    function schedule(ms) {
      if (!st.session) return;
      clearTimeout(timer);
      timer = setTimeout(run, ms == null ? 1500 : ms);
    }

    /* ---------- account ---------- */
    async function signIn(login, password, keepState) {
      const j = await authCall('token?grant_type=password', { email: toEmail(login), password });
      if (!keepState) st = blank();
      setSession(j);
      const me = await rest('GET', 'nms_members?select=role,name&user_id=eq.' + encodeURIComponent(st.session.uid)).catch(() => null);
      if (me && !me.length) { signOut(); throw new Error('This account has not been given access yet — ask the administrator'); }
      if (me) { st.session.role = me[0].role; st.session.name = me[0].name; persist(); }
      emit();
      await run();
      if (state === 'error' && /not been given access/.test(lastError)) { const m = lastError; signOut(); throw new Error(m); }
    }
    /* ---------- setup links: https://…/#join=<login>.<secret> ---------- */
    function newSecret() {
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function parseLink(hash) {
      const m = /^#join=([a-z0-9_-]+)\.([A-Za-z0-9_-]{24,})$/i.exec(hash || '');
      return m ? { login: m[1].toLowerCase(), secret: m[2] } : null;
    }
    const linkFor = (login, secret) => (opts.appUrl || location.href.split('#')[0]) + '#join=' + login + '.' + secret;
    async function signInWithLink(login, secret) {
      const same = st.cred && st.cred.login === login;
      await signIn(login, secret, same);
      st.cred = { login, secret }; st.removed = false; persist(); emit();
      return same;
    }
    /* this phone's own link: set up another phone for the same person */
    const ownLink = () => (st.cred ? linkFor(st.cred.login, st.cred.secret) : '');
    async function members() { return rest('GET', 'nms_members?select=user_id,role,name&order=role.desc,name.asc'); }
    /* owner only: replace someone's link; their old phones stop working */
    async function resetMember(userId) {
      const secret = newSecret();
      const headers = { apikey: KEY, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' };
      const r = await fetch(URL_ + '/rest/v1/rpc/nms_reset_login', { method: 'POST', headers, body: JSON.stringify({ target_user: userId, new_secret: secret }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not make a new link');
      return linkFor(j, secret);
    }
    function signOut() {
      const s = st.session;
      if (s) fetch(URL_ + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access } }).catch(() => {});
      st = blank(); persist(); setState('idle');
    }
    async function setPassword(password) {
      const r = await fetch(URL_ + '/auth/v1/user', { method: 'PUT', headers: { apikey: KEY, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ password, data: { must_change_password: false } }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(/same|different/i.test(j.msg || j.message || '') ? 'Choose a password different from the temporary one' : j.msg || j.message || 'Could not change the password'); }
      st.session.mustChange = false; persist(); emit(); schedule(100);
    }
    function status() {
      const s = st.session;
      if (!s) return { signedIn: false, ok: false, text: 'Not signed in — records are on this phone only' };
      const who = { signedIn: true, uid: s.uid, email: s.email, login: toLogin(s.email), role: s.role, name: s.name, mustChange: !!s.mustChange };
      if (state === 'syncing') return { ...who, ok: true, text: 'Syncing…' };
      if (state === 'error') return { ...who, ok: false, text: lastError };
      const mins = Math.round((Date.now() - lastOk) / 60000);
      return { ...who, ok: true, text: !lastOk ? 'Cloud sync on' : mins < 1 ? 'Synced just now' : `Synced ${mins} min ago` };
    }
    function setState(s) { state = s; emit(); }
    function emit() { for (const fn of listeners) try { fn(status()); } catch (e) { /* ignore */ } }

    window.addEventListener('online', () => schedule(200));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
    setInterval(() => { if (!document.hidden) schedule(0); }, 30000);

    return {
      storage, run, schedule, signIn, signOut, setPassword, status,
      signInWithLink, parseLink, ownLink, members, resetMember, isRemoved: () => !!st.removed,
      /* changes on this phone the cloud has not received yet */
      pending() {
        const local = toMap(current ? C.normalise(current) : null);
        let n = 0;
        for (const k in local) if (st.shadow[k] !== fp(local[k])) n++;
        for (const k in st.shadow) if (!(k in local) && st.shadow[k] !== 'x') n++;
        return st.synced ? n : 0;
      },
      /* forget the shop's records on this phone (they stay in the cloud) */
      clearLocal() { current = null; ver++; localStorage.removeItem(DATA_KEY); },
      onStatus: (fn) => listeners.push(fn),
      attach(a) { app = a; schedule(300); },
    };
  }

  root.NMSSync = { create };
})(typeof self !== 'undefined' ? self : this);
