/**
 * Gemini Folders — popup.
 *
 * El popup no habla con la pestaña: lee y escribe chrome.storage.local
 * directamente. El content script escucha chrome.storage.onChanged y se
 * repinta solo, así que importar desde aquí se refleja al instante.
 */
(() => {
  'use strict';

  const GF = globalThis.GF;
  const KEYS = ['gf.folders', 'gf.assign', 'gf.chats', 'gf.rules'];
  const $ = (id) => document.getElementById(id);

  const say = (text, isError = false) => {
    const msg = $('msg');
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  async function refresh() {
    const raw = await chrome.storage.local.get(KEYS);
    const folders = Object.keys(raw['gf.folders'] || {}).length;
    const chats = Object.keys(raw['gf.chats'] || {}).length;
    const assigned = Object.keys(raw['gf.assign'] || {}).length;
    const rules = Object.keys(raw['gf.rules'] || {}).length;
    $('stats').textContent =
      `${folders} carpeta(s) · ${assigned}/${chats} chat(s) asignados · ${rules} regla(s)`;
    return raw;
  }

  async function exportBackup() {
    const raw = await chrome.storage.local.get(KEYS);
    const payload = GF.exportData({
      folders: raw['gf.folders'],
      assign: raw['gf.assign'],
      chats: raw['gf.chats'],
      rules: raw['gf.rules'],
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
    const current = await chrome.storage.local.get(KEYS);
    const merged = GF.mergeImport(
      {
        folders: current['gf.folders'],
        assign: current['gf.assign'],
        chats: current['gf.chats'],
        rules: current['gf.rules'],
      },
      incoming,
    );
    await chrome.storage.local.set({
      'gf.folders': merged.folders,
      'gf.assign': merged.assign,
      'gf.chats': merged.chats,
      'gf.rules': merged.rules,
    });
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
