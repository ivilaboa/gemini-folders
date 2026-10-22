/**
 * Gemini Folders — popup.
 *
 * El popup no habla con la pestaña: lee y escribe el storage directamente
 * (local + sync). El content script escucha chrome.storage.onChanged y se
 * repinta solo, así que importar desde aquí se refleja al instante.
 */
(() => {
  'use strict';

  const GF = globalThis.GF;
  const AREAS = [chrome.storage.sync, chrome.storage.local].filter(Boolean);
  const $ = (id) => document.getElementById(id);

  const say = (text, isError = false) => {
    const msg = $('msg');
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  /** El estado más reciente entre las dos áreas (la de sync es la que viaja). */
  async function currentState() {
    const reads = await Promise.all(
      AREAS.map(async (area) => {
        try {
          return await GF.readState(area);
        } catch {
          return null;
        }
      }),
    );
    const ok = reads.filter(Boolean);
    let best = ok[0] || { ts: 0, folders: {}, assign: {}, chats: {}, rules: {} };
    for (const s of ok) if (s.ts > best.ts) best = s;
    return best;
  }

  async function writeState(state, currentTs) {
    const ts = Math.max(Date.now(), currentTs + 1);
    await Promise.all(AREAS.map((area) => GF.writeState(area, state, ts)));
    return ts;
  }

  async function refresh() {
    const state = await currentState();
    const folders = Object.keys(state.folders || {}).length;
    const chats = Object.keys(state.chats || {}).length;
    const assigned = Object.keys(state.assign || {}).length;
    const rules = Object.keys(state.rules || {}).length;
    $('stats').textContent =
      `${folders} carpeta(s) · ${assigned}/${chats} chat(s) asignados · ${rules} regla(s)`;
    return state;
  }

  async function exportBackup() {
    const state = await currentState();
    const payload = GF.exportData({
      folders: state.folders,
      assign: state.assign,
      chats: state.chats,
      rules: state.rules,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-folders-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say('Copia exportada.');
  }

  async function importBackup(file) {
    const text = await file.text();
    let incoming;
    try {
      incoming = GF.parseImport(text);
    } catch (err) {
      say(err.message || 'Archivo inválido', true);
      return;
    }
    const current = await currentState();
    const merged = GF.mergeImport(
      {
        folders: current.folders,
        assign: current.assign,
        chats: current.chats,
        rules: current.rules,
      },
      incoming,
    );
    await writeState(merged, current.ts);
    await refresh();
    say('Copia importada y fusionada.');
  }

  $('export').addEventListener('click', () => {
    exportBackup().catch((err) => say(String(err), true));
  });

  $('import').addEventListener('click', () => $('file').click());

  $('file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    importBackup(file).catch((err) => say(String(err), true));
  });

  refresh().catch((err) => say(String(err), true));
})();
