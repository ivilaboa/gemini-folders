/**
 * Gemini Folders — lógica pura.
 *
 * Sin DOM y sin APIs de Chrome: todo lo que se puede testear en Node vive aquí.
 * Se carga como script clásico (content script y popup) y expone `globalThis.GF`.
 */
(function (root) {
  'use strict';

  const GF = {};

  const ORDER_STEP = 1000;

  /** Claves que no pueden usarse como id (rompen el prototipo de los objetos). */
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ------------------------------------------------------------------ ids

  GF.uid = (prefix = 'id') =>
    `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  /** Copia un objeto descartando claves reservadas (protege contra prototype pollution). */
  GF.safeCopy = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (!RESERVED.has(k)) out[k] = v;
    }
    return out;
  };

  // --------------------------------------------------------------- folders
  // Un "map" por id: { [id]: { id, name, parentId, order } }

  GF.folderList = (folders) => Object.values(GF.safeCopy(folders));

  GF.childrenOf = (folders, parentId) =>
    GF.folderList(folders)
      .filter((f) => (f.parentId || null) === (parentId || null))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));

  /** ¿`candidateId` está dentro de `ancestorId` (en cualquier nivel)? */
  GF.isDescendant = (folders, candidateId, ancestorId) => {
    const seen = new Set();
    let cur = (folders || {})[candidateId];
    while (cur && cur.parentId && !seen.has(cur.parentId)) {
      if (cur.parentId === ancestorId) return true;
      seen.add(cur.parentId);
      cur = (folders || {})[cur.parentId];
    }
    return false;
  };

  GF.createFolder = (folders, name, parentId = null) => ({
    id: GF.uid('f'),
    name: (name || 'Nueva carpeta').trim() || 'Nueva carpeta',
    parentId: parentId || null,
    order: (() => {
      const siblings = GF.childrenOf(folders, parentId);
      return (siblings.length ? siblings[siblings.length - 1].order || 0 : 0) + ORDER_STEP;
    })(),
  });

  /** Mueve una carpeta bajo otro padre. Devuelve un map nuevo; no hace nada si genera un ciclo. */
  GF.moveFolder = (folders, folderId, newParentId) => {
    const target = (folders || {})[folderId];
    if (!target) return folders;
    if (newParentId === folderId) return folders;
    if (newParentId && !(folders || {})[newParentId]) return folders;
    if (newParentId && GF.isDescendant(folders, newParentId, folderId)) return folders;
    return { ...folders, [folderId]: { ...target, parentId: newParentId || null } };
  };

  /**
   * Borra una carpeta y todas sus descendientes.
   * Devuelve { folders, removedIds } — los chats asignados quedan sin carpeta.
   */
  GF.deleteFolder = (folders, folderId) => {
    const removed = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of GF.folderList(folders)) {
        if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) {
          removed.add(f.id);
          grew = true;
        }
      }
    }
    const next = {};
    for (const [id, f] of Object.entries(folders || {})) {
      if (!removed.has(id) && !RESERVED.has(id)) next[id] = f;
    }
    return { folders: next, removedIds: [...removed] };
  };

  GF.renameFolder = (folders, folderId, name) => {
    const f = (folders || {})[folderId];
    if (!f) return folders;
    const clean = (name || '').trim();
    if (!clean) return folders;
    return { ...folders, [folderId]: { ...f, name: clean } };
  };

  // ---------------------------------------------------------------- chats

  GF.assignChat = (assign, chatId, folderId) => {
    const next = { ...(assign || {}) };
    if (!folderId) delete next[chatId];
    else next[chatId] = folderId;
    return next;
  };

  GF.chatsInFolder = (assign, folderId) =>
    Object.keys(assign || {}).filter((id) => assign[id] === folderId);

  GF.unfiledChatIds = (assign, chats) =>
    Object.keys(chats || {}).filter((id) => !(assign || {})[id]);

  /** Chats ordenados por actividad reciente primero. */
  GF.sortChats = (chats, ids) =>
    ids.slice().sort((a, b) => (chats[b]?.ts || 0) - (chats[a]?.ts || 0));

  // --------------------------------------------------------------- reglas
  // Auto-organización local: { [id]: { id, name, pattern, folderId, enabled } }
  // `pattern` es una expresión regular que se evalúa contra el título del chat.

  const MAX_PATTERN = 200;
  const MAX_TITLE = 500;

  /**
   * Detecta patrones con riesgo de backtracking catastrófico (ReDoS).
   * Un patrón así bloquearía el hilo principal del renderer para siempre.
   */
  GF.isRiskyPattern = (pattern) => {
    if (typeof pattern !== 'string' || !pattern || pattern.length > MAX_PATTERN) return true;
    // grupo ( ... ) seguido de cuantificador
    const riskyGroup = /\(([^()]*)\)\s*(?:[+*]|\{\d+,?\d*\})/g;
    let m;
    while ((m = riskyGroup.exec(pattern)) !== null) {
      const inner = m[1];
      if (!/[+*]|\|/.test(inner) && !/\{[^}]*,/.test(inner)) continue;
      // Alternancia de caracteres simples distintos: es lineal, se permite.
      const branches = inner.split('|');
      if (branches.length > 1 && branches.every((b) => b.length === 1)) continue;
      return true;
    }
    return false;
  };

  GF.compileRule = (rule) => {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) return null;
    if (GF.isRiskyPattern(rule.pattern)) return null;
    try {
      return new RegExp(rule.pattern, 'i');
    } catch {
      return null; // patrón inválido: la regla se ignora en vez de romper todo
    }
  };

  /** `compiled` evita recompilar la RegExp por cada chat. */
  GF.ruleMatches = (rule, title, compiled) => {
    if (!rule || rule.enabled === false) return false;
    const re = compiled || GF.compileRule(rule);
    if (!re) return false;
    return re.test((title || '').slice(0, MAX_TITLE));
  };

  /**
   * Aplica las reglas a los chats sin carpeta.
   * Devuelve { assign, folders, rules, applied } — `folders` crece sólo si la regla
   * realmente casa con algún chat, y el id de la carpeta creada se guarda en la regla.
   */
  GF.applyRules = (rules, chats, assign, folders) => {
    let nextAssign = { ...(assign || {}) };
    let nextFolders = { ...(folders || {}) };
    let nextRules = { ...(rules || {}) };
    const applied = [];

    for (const rule of GF.folderList(rules)) {
      if (rule.enabled === false) continue;
      const compiled = GF.compileRule(rule);
      if (!compiled) continue; // patrón inválido o peligroso: la regla se ignora

      let folderId = rule.folderId;
      if (!folderId || !nextFolders[folderId]) {
        const existing = GF.folderList(nextFolders).find(
          (f) => (f.name || '').toLowerCase() === (rule.name || '').toLowerCase() && !f.parentId,
        );
        folderId = existing ? existing.id : null;
      }

      for (const [chatId, chat] of Object.entries(chats || {})) {
        if (nextAssign[chatId]) continue; // no sobrescribir decisiones manuales
        if (!GF.ruleMatches(rule, chat.title, compiled)) continue;

        if (!folderId) {
          // La carpeta se crea sólo cuando la regla casa con algo.
          const created = GF.createFolder(nextFolders, rule.name || 'Auto');
          nextFolders = { ...nextFolders, [created.id]: created };
          folderId = created.id;
          nextRules = { ...nextRules, [rule.id]: { ...rule, folderId } };
        }
        nextAssign[chatId] = folderId;
        applied.push(chatId);
      }
    }
    return { assign: nextAssign, folders: nextFolders, rules: nextRules, applied };
  };

  // ------------------------------------------------------- import / export

  GF.exportData = ({ folders, assign, chats, rules }) => ({
    format: 'gemini-folders',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: folders || {},
    assign: assign || {},
    chats: chats || {},
    rules: rules || {},
  });

  /**
   * Fusiona un payload importado sobre el estado actual.
   * Importado gana por id; los chats que solo existen en local se conservan.
   */
  GF.mergeImport = (current, incoming) => ({
    folders: { ...GF.safeCopy(current.folders), ...GF.safeCopy(incoming.folders) },
    assign: { ...GF.safeCopy(current.assign), ...GF.safeCopy(incoming.assign) },
    chats: { ...GF.safeCopy(current.chats), ...GF.safeCopy(incoming.chats) },
    rules: { ...GF.safeCopy(current.rules), ...GF.safeCopy(incoming.rules) },
  });

  /** Valida la forma del payload importado. Lanza Error con un mensaje legible. */
  GF.validateImport = (data) => {
    if (!isPlain(data)) throw new Error('El archivo no tiene la forma esperada');

    for (const key of ['folders', 'assign', 'chats', 'rules']) {
      if (!(key in data)) continue;
      if (!isPlain(data[key])) throw new Error(`"${key}" debe ser un objeto`);
      for (const k of Object.keys(data[key])) {
        if (RESERVED.has(k)) throw new Error(`"${key}" contiene una clave reservada: ${k}`);
      }
    }

    for (const [id, f] of Object.entries(data.folders || {})) {
      if (!isPlain(f)) throw new Error(`Carpeta "${id}" inválida`);
      if (typeof f.name !== 'string' || f.name.length > 200) {
        throw new Error(`Carpeta "${id}": nombre inválido`);
      }
      if (f.parentId != null && typeof f.parentId !== 'string') {
        throw new Error(`Carpeta "${id}": parentId inválido`);
      }
      if (f.order != null && typeof f.order !== 'number') {
        throw new Error(`Carpeta "${id}": order inválido`);
      }
    }

    for (const [id, c] of Object.entries(data.chats || {})) {
      if (!isPlain(c)) throw new Error(`Chat "${id}" inválido`);
      if (typeof c.title !== 'string' || c.title.length > 2000) {
        throw new Error(`Chat "${id}": título inválido`);
      }
      if (c.url != null && !/^https:\/\/gemini\.google\.com\//.test(c.url)) {
        throw new Error(`Chat "${id}": URL inválida`);
      }
    }

    for (const [id, r] of Object.entries(data.rules || {})) {
      if (!isPlain(r)) throw new Error(`Regla "${id}" inválida`);
      if (typeof r.pattern !== 'string') throw new Error(`Regla "${id}": patrón inválido`);
      if (GF.isRiskyPattern(r.pattern)) {
        throw new Error(`Regla "${id}": el patrón es demasiado costoso (riesgo de bloqueo)`);
      }
      if (typeof r.name !== 'string' || r.name.length > 200) {
        throw new Error(`Regla "${id}": nombre inválido`);
      }
    }

    if (Object.keys(data.rules || {}).length > 100) throw new Error('Demasiadas reglas');
    if (Object.keys(data.chats || {}).length > 200000) throw new Error('Demasiados chats');

    return data;
  };

  // =====================================================================
  // Persistencia: local (respaldo) + sync (entre equipos)
  // =====================================================================

  /**
   * chrome.storage.sync limita cada clave a 8 KB, así que los mapas grandes
   * (chats, asignaciones) se parten en trozos de ~7 KB que se vuelven a unir
   * al leer. `gf.<mapa>.n` guarda cuántos trozos hay.
   */
  GF.CHUNK_BYTES = 7000;

  GF.chunkMap = (map, maxBytes = GF.CHUNK_BYTES) => {
    const src = map && typeof map === 'object' ? map : {};
    const chunks = [];
    let cur = {};
    let size = 2; // "{}"
    for (const [key, value] of Object.entries(src)) {
      const piece = `${JSON.stringify(key)}:${JSON.stringify(value)},`;
      if (size + piece.length > maxBytes && Object.keys(cur).length) {
        chunks.push(cur);
        cur = {};
        size = 2;
      }
      cur[key] = value;
      size += piece.length;
    }
    chunks.push(cur);
    return chunks;
  };

  GF.mergeChunks = (chunks) => {
    const out = {};
    for (const chunk of chunks || []) {
      if (chunk && typeof chunk === 'object') Object.assign(out, chunk);
    }
    return out;
  };

  /** Lee el estado completo de un área de storage. */
  GF.readState = async (area) => {
    const all = await area.get(null);
    const pick = (prefix) => {
      const count = all[`${prefix}.n`];
      if (typeof count !== 'number') {
        // Formato antiguo: el mapa entero en una sola clave.
        const legacy = all[prefix];
        return legacy && typeof legacy === 'object' ? legacy : {};
      }
      const chunks = [];
      for (let i = 0; i < count; i++) chunks.push(all[`${prefix}.${i}`]);
      return GF.mergeChunks(chunks);
    };
    return {
      ts: typeof all['gf.ts'] === 'number' ? all['gf.ts'] : 0,
      folders: all['gf.folders'] || {},
      ui: all['gf.ui'] || {},
      rules: all['gf.rules'] || {},
      assign: pick('gf.assign'),
      chats: pick('gf.chats'),
      // Claves del formato antiguo: se pueden borrar tras migrar.
      legacy:
        Boolean(all['gf.chats'] && typeof all['gf.chats'] === 'object') ||
        Boolean(all['gf.assign'] && typeof all['gf.assign'] === 'object'),
    };
  };

  /**
   * Escribe el estado en un área. `ts` es la marca de esta versión: al leer
   * gana la copia más reciente. Devuelve cuántos trozos tiene cada mapa.
   */
  GF.writeState = async (area, state, ts, prevCounts = {}) => {
    const assign = GF.chunkMap(state.assign);
    const chats = GF.chunkMap(state.chats);
    const items = {
      'gf.ts': ts,
      'gf.folders': state.folders || {},
      'gf.ui': state.ui || {},
      'gf.rules': state.rules || {},
      'gf.assign.n': assign.length,
      'gf.chats.n': chats.length,
    };
    assign.forEach((chunk, i) => {
      items[`gf.assign.${i}`] = chunk;
    });
    chats.forEach((chunk, i) => {
      items[`gf.chats.${i}`] = chunk;
    });

    // Trozos que sobran de una versión anterior.
    const stale = [];
    for (const [prefix, count] of [
      ['gf.assign', assign.length],
      ['gf.chats', chats.length],
    ]) {
      for (let i = count; i < prevCounts[prefix] || 0; i++) stale.push(`${prefix}.${i}`);
    }
    if (stale.length) await area.remove(stale);
    await area.set(items);
    return { 'gf.assign': assign.length, 'gf.chats': chats.length };
  };

  GF.parseImport = (text) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('El archivo no es JSON válido');
    }
    if (!data || data.format !== 'gemini-folders') {
      throw new Error('El archivo no es una copia de seguridad de Gemini Folders');
    }
    return GF.validateImport(data);
  };

  root.GF = GF;
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.GF;
