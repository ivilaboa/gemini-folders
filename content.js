/**
 * Gemini Folders — content script.
 *
 * Hace dos cosas:
 *  1. Cosecha los chats que Gemini deja visibles en su sidebar (id + título).
 *  2. Dibuja dentro de ese sidebar un árbol de carpetas y deja arrastrar chats
 *     (nativos o del propio árbol) dentro de ellas.
 *
 * Todo el estado vive en el storage del navegador (local como respaldo y
 * sync para viajar entre equipos); no hay servidor ni backend.
 */
(() => {
  'use strict';

  if (window.__gfLoaded) return;
  window.__gfLoaded = true;

  const GF = globalThis.GF;
  const DRAG_MIME = 'application/x-gemini-folders';

  const state = {
    folders: {},
    assign: {},
    chats: {},
    rules: {},
    ui: { collapsed: {}, showUnfiled: true, panelEnabled: true },
  };

  // =====================================================================
  // Selectores — con alternativas, porque Gemini rediseña su UI periódicamente.
  // =====================================================================

  // Confirmado contra el DOM real (ver tools/probe.js):
  //  - el chat vive en `<a href="/app/<id>?...">` dentro de `[data-test-id="conversation"]`
  //  - la lista scrollea en `<bard-sidenav> <infinite-scroller>` (ya no hay
  //    `.recent-conversations-container`)
  //  - el botón de "Nueva conversación" es exactamente `a[href="/app"]`
  const SEL = {
    sidenav: ['bard-sidenav', 'bard-sidenav-container'],
    mount: [
      'bard-sidenav .overflow-container',
      'bard-sidenav .sidenav-with-history-container',
      'bard-sidenav',
    ],
    chatLinks: [
      '[data-test-id="conversation"] > a[href*="/app/"]',
      'bard-sidenav a[href*="/app/"]',
    ],
    scroller: ['bard-sidenav infinite-scroller', 'bard-sidenav .overflow-container infinite-scroller'],
    newChat: ['bard-sidenav a[href="/app"]'],
    pageTitle: ['[data-test-id="conversation-title"]'],
  };

  const $ = (list, root = document) => {
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const $$ = (list, root = document) => {
    const out = [];
    const seen = new Set();
    for (const sel of list) {
      let found;
      try {
        found = root.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of found) {
        if (seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  };

  const inOurUI = (el) => !!(el && el.closest && el.closest('#gf-root'));

  // =====================================================================
  // Utilidades de DOM
  // =====================================================================

  // Iconos: SVG estáticos internos. Nunca insertar datos de usuario como SVG.
  const ICONS = {
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    folderPlus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    more:
      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
    chat:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z"/></svg>',
    inbox:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/></svg>',
  };

  /**
   * Crea un elemento. `svg` sólo acepta SVG estático propio; todo dato que venga
   * de la página o del usuario va con `text` (-> textContent) para evitar XSS.
   */
  function el(tag, attrs = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'svg') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of [].concat(kids)) if (kid) node.appendChild(kid);
    return node;
  }

  const icon = (name) => el('span', { class: 'gf-icon', 'aria-hidden': 'true', svg: ICONS[name] || '' });

  // =====================================================================
  // Chats: ids, títulos y URLs
  // =====================================================================

  const APP_RE = /\/app\/([A-Za-z0-9_-]+)/;
  const GEM_RE = /\/gem\/[^/]+\/([A-Za-z0-9_-]+)/;

  const chatIdFromHref = (href) => {
    if (!href) return null;
    const m = APP_RE.exec(href) || GEM_RE.exec(href);
    return m ? m[1] : null;
  };

  const chatIdFromPath = (pathname) => chatIdFromHref(pathname);

  const cleanTitle = (raw) => {
    let t = (raw || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/[⋮⋯…]+$/, '').trim();
    const dot = t.indexOf(' · ');
    if (dot > 0) t = t.slice(0, dot).trim();
    return t;
  };

  function titleOfLink(a) {
    const explicit = a.querySelector('[data-test-id="conversation-title"]');
    const raw = explicit ? explicit.textContent : a.textContent;
    return cleanTitle(raw) || cleanTitle(a.getAttribute('aria-label')) || 'Chat sin título';
  }

  function pageTitle() {
    const elTitle = $(SEL.pageTitle);
    if (elTitle) {
      const t = cleanTitle(elTitle.textContent);
      if (t) return t;
    }
    // Gemini titula la pestaña con el nombre del chat: "Mi chat - Google Gemini".
    const t = cleanTitle(document.title.replace(/\s*[-–|]\s*(Google\s+)?Gemini.*$/i, ''));
    return t || 'Chat sin título';
  }

  const chatUrl = (id) => `https://gemini.google.com/app/${id}`;

  /** URL del chat abierto: los "gems" no cuelgan de /app/. */
  function currentUrl() {
    const p = location.pathname;
    if (p.startsWith('/app/') || p.startsWith('/gem/')) return `https://gemini.google.com${p}`;
    return chatUrl(chatIdFromPath(p) || '');
  }

  // =====================================================================
  // Persistencia
  // =====================================================================

  /**
   * El estado se guarda en dos áreas: `sync` (viaja solo entre equipos con la
   * misma cuenta) y `local` (respaldo: si la sync falla, se queda con el
   * navegador o no la sincroniza, no se pierde nada). Cada guardado lleva un
   * `ts`; al leer, gana la copia más reciente.
   */
  const AREAS = [chrome.storage.sync, chrome.storage.local].filter(Boolean);

  // Retardo para lo que no es una acción del usuario.
  const SLOW_SAVE = 60000;

  let stateTs = 0;
  const chunkCounts = new Map();
  const legacyAreas = new Set();

  function applyState(data) {
    state.folders = data.folders;
    state.assign = data.assign;
    state.chats = data.chats;
    state.rules = data.rules;
    state.ui = { collapsed: {}, showUnfiled: true, panelEnabled: true, ...(data.ui || {}) };
    state.ui.collapsed = state.ui.collapsed || {};
  }

  async function load() {
    const reads = await Promise.all(
      AREAS.map(async (area) => {
        try {
          return { area, data: await GF.readState(area) };
        } catch {
          return { area, data: null };
        }
      }),
    );
    const ok = reads.filter((r) => r.data);
    if (!ok.length) return;
    let best = ok[0];
    for (const r of ok) if (GF.newer(r.data, best.data)) best = r;
    applyState(best.data);
    stateTs = best.data.ts;
    for (const r of ok) if (r.data.legacy) legacyAreas.add(r.area);
    // Si la copia buena no estaba en sync, o viene del formato antiguo (sin
    // marca de tiempo), hay que empujarla: se le pone ts y se replica.
    if (best.area !== AREAS[0] || best.data.ts === 0) save();
  }

  let saveTimer = null;

  /**
   * `delay` alto para lo que no es acción del usuario (el "última actividad"
   * de un chat): sync tiene límite de escrituras por minuto y no queremos
   * quemarlo con el ruido del harvest.
   */
  function save(delay = 200) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, delay);
  }

  async function flush() {
    const ts = Math.max(Date.now(), stateTs + 1);
    stateTs = ts;
    const results = await Promise.allSettled(
      AREAS.map(async (area) => {
        const counts = await GF.writeState(area, state, ts, chunkCounts.get(area.name) || {});
        chunkCounts.set(area.name, counts);
        if (legacyAreas.has(area)) {
          legacyAreas.delete(area);
          await area.remove(['gf.chats', 'gf.assign']).catch(() => {});
        }
      }),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      const err = failed.reason;
      flash(`No se pudo guardar: ${err && err.message ? err.message : err}`);
    }
  }

  /**
   * Aplica sólo las claves que vienen de fuera (otra pestaña, otra máquina o
   * el popup). Las escrituras propias se ignoran: el `ts` no cambia.
   */
  function installStorageListener() {
    const pending = new Set();
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const area = AREAS.find((a) => a.name === areaName);
      if (!area || pending.has(areaName)) return;
      pending.add(areaName);
      setTimeout(async () => {
        pending.delete(areaName);
        let data;
        try {
          data = await GF.readState(area);
        } catch {
          return;
        }
        if (!data || data.ts <= stateTs) return; // nuestra propia escritura
        applyState(data);
        stateTs = data.ts;
        // Reenviar a las demás áreas con el MISMO ts: si no, los equipos se
        // pisan en bucle.
        for (const other of AREAS) {
          if (other === area) continue;
          GF.writeState(other, state, data.ts, chunkCounts.get(other.name) || {})
            .then((counts) => chunkCounts.set(other.name, counts))
            .catch(() => {});
        }
        if (!dragging) render();
      }, 250);
    });
  }

  // =====================================================================
  // Cosecha de chats
  // =====================================================================

  function harvest() {
    const found = new Map();
    for (const a of $$(SEL.chatLinks)) {
      if (inOurUI(a)) continue;
      const id = chatIdFromHref(a.getAttribute('href'));
      if (!id) continue;
      found.set(id, { title: titleOfLink(a), url: chatUrl(id) });
    }
    const current = chatIdFromPath(location.pathname);
    if (current && !found.has(current)) {
      found.set(current, { title: pageTitle(), url: currentUrl() });
    }
    return found;
  }

  function mergeHarvested() {
    const now = Date.now();
    let changed = false;
    const current = chatIdFromPath(location.pathname);

    for (const [id, data] of harvest()) {
      const prev = state.chats[id];
      if (!prev) {
        state.chats = { ...state.chats, [id]: { ...data, ts: now } };
        changed = true;
      } else if (prev.title !== data.title) {
        state.chats[id] = { ...prev, title: data.title, ts: now };
        changed = true;
      } else if (id === current) {
        // Sólo el chat abierto marca actividad reciente.
        state.chats[id] = { ...prev, ts: now };
      }
    }
    return changed;
  }

  // =====================================================================
  // Acciones sobre carpetas y chats
  // =====================================================================

  /** Devuelve null si el usuario cancela o deja el campo vacío. */
  function askName(message, initial) {
    const answer = prompt(message, initial || '');
    if (answer === null) return null;
    const clean = answer.trim();
    return clean || null;
  }

  function addFolder(name, parentId = null) {
    const folder = GF.createFolder(state.folders, name, parentId);
    state.folders = { ...state.folders, [folder.id]: folder };
    save();
    render();
    return folder;
  }

  function renameFolder(folderId, name) {
    state.folders = GF.renameFolder(state.folders, folderId, name);
    save();
    render();
  }

  function deleteFolder(folderId) {
    const { folders, removedIds } = GF.deleteFolder(state.folders, folderId);
    state.folders = folders;
    const assign = { ...state.assign };
    for (const id of removedIds) delete assign[id];
    state.assign = assign;
    save();
    render();
  }

  function moveFolder(folderId, newParentId) {
    const next = GF.moveFolder(state.folders, folderId, newParentId);
    if (next === state.folders) return false;
    state.folders = next;
    save();
    render();
    return true;
  }

  function assignChat(chatId, folderId) {
    state.assign = GF.assignChat(state.assign, chatId, folderId);
    save();
    render();
  }

  function applyRules() {
    const res = GF.applyRules(state.rules, state.chats, state.assign, state.folders);
    state.assign = res.assign;
    state.folders = res.folders;
    state.rules = res.rules;
    save();
    render();
    return res.applied.length;
  }

  // =====================================================================
  // Navegación
  // =====================================================================

  /**
   * Gemini enruta los chats con Angular; un `.click()` sintético puede ser
   * ignorado por los list-items de Material. Se dispara la secuencia de puntero
   * completa, que es lo que el componente espera.
   */
  function activate(el) {
    if (!el) return;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
    };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    } catch {
      /* navegador sin PointerEvent */
    }
    el.click();
  }

  function openChat(chatId) {
    const target = $$(SEL.chatLinks)
      .filter((a) => !inOurUI(a))
      .find((a) => chatIdFromHref(a.getAttribute('href')) === chatId);
    if (target) {
      activate(target);
      return;
    }
    // El chat no está en el DOM: Gemini sólo enruta si primero "soltamos" el chat actual.
    const newChat = $(SEL.newChat);
    if (newChat) activate(newChat);
    history.pushState({}, '', pathOf(chatId));
    dispatchEvent(new PopStateEvent('popstate'));
  }

  /** Ruta a la que navegar para un chat (los gems no cuelgan de /app/). */
  function pathOf(chatId) {
    const stored = state.chats[chatId] && state.chats[chatId].url;
    if (stored) {
      try {
        const u = new URL(stored);
        if (u.origin === location.origin && u.pathname.startsWith('/')) return u.pathname;
      } catch {
        /* URL guardada inválida: caemos a /app/<id> */
      }
    }
    return `/app/${chatId}`;
  }

  // =====================================================================
  // Render del árbol
  // =====================================================================

  let root = null;
  let launcher = null;
  let dragging = false;

  function ensureRoot() {
    if (!state.ui.panelEnabled) return null;
    if (root && root.isConnected) return root;
    const host = $(SEL.mount);
    if (!host) return null;
    const scroller = findScroller();
    root = el('div', { id: 'gf-root', 'data-gf-root': '1' });
    // Va justo antes de la lista de chats: el árbol queda sobre los chats y
    // debajo de la navegación de Gemini.
    const anchor = hostChildWith(host, scroller);
    host.insertBefore(root, anchor || host.firstChild);
    fitScroller(scroller);
    return root;
  }

  /** Devuelve el hijo de `host` que contiene a `node` (null si no cuelga de él). */
  function hostChildWith(host, node) {
    if (!node) return null;
    let cur = node;
    while (cur && cur.parentElement && cur.parentElement !== host) cur = cur.parentElement;
    return cur && cur.parentElement === host ? cur : null;
  }

  /**
   * El sidebar de Gemini es una columna de altura fija: al añadir nuestro árbol
   * hay que dejarle sitio a la lista de chats, o los últimos quedan fuera de
   * la vista. Se mide el alto "natural" del scroller (sin nuestro panel) y se
   * le pone un tope para que quepan los dos.
   */
  function fitScroller(scroller) {
    if (!scroller || !root || !root.isConnected) return;
    const host = root.parentElement;
    const prevMax = scroller.style.maxHeight;
    const prevDisplay = root.style.display;
    // Medimos el alto natural sin nuestro panel Y sin el tope que pusimos
    // nosotros: si no, cada llamada mide un scroller ya recortado y la lista
    // se encoge hasta desaparecer.
    scroller.style.maxHeight = '';
    root.style.display = 'none';
    let natural = scroller.clientHeight;
    root.style.display = prevDisplay;
    scroller.style.maxHeight = prevMax;

    // El alto visible es el menor de la cadena de contenedores: un scroller
    // block con 1400 chats no puede ser más alto que la columna que lo aloja.
    for (let node = host; node && node !== document.body; node = node.parentElement) {
      const h = node.getBoundingClientRect().height;
      if (h > 0) natural = Math.min(natural, h);
    }

    const avail = natural - root.offsetHeight;
    scroller.style.maxHeight = `${Math.max(120, avail)}px`;
  }

  function ensureLauncher() {
    if (launcher && launcher.isConnected) return launcher;
    launcher = el('button', {
      class: 'gf-launcher',
      'data-gf-row': '1',
      type: 'button',
      title: 'Gemini Folders',
      'aria-label': 'Abrir el panel de carpetas',
      svg: ICONS.folder,
      onclick: () => {
        state.ui.panelEnabled = true;
        save();
        render();
      },
    });
    document.body.appendChild(launcher);
    return launcher;
  }

  function toggleFolder(folderId) {
    const collapsed = { ...state.ui.collapsed };
    if (collapsed[folderId]) delete collapsed[folderId];
    else collapsed[folderId] = true;
    state.ui.collapsed = collapsed;
    save();
    render();
  }

  function buildFolderNode(folder) {
    const collapsed = !!state.ui.collapsed[folder.id];
    const count = GF.chatsInFolder(state.assign, folder.id).length;

    const twisty = el('button', {
      class: `gf-twisty${collapsed ? '' : ' gf-open'}`,
      type: 'button',
      svg: ICONS.chevron,
      'aria-label': collapsed ? 'Expandir carpeta' : 'Contraer carpeta',
      onclick: (e) => {
        e.stopPropagation();
        toggleFolder(folder.id);
      },
    });

    const row = el(
      'div',
      {
        class: 'gf-row gf-folder',
        draggable: 'true',
        'data-folder': folder.id,
        'data-gf-row': '1',
        title: folder.name,
        onclick: (e) => {
          if (e.target.closest('.gf-kebab')) return;
          toggleFolder(folder.id);
        },
      },
      [
        twisty,
        icon('folder'),
        el('span', { class: 'gf-name', text: folder.name }),
        count ? el('span', { class: 'gf-count', text: String(count) }) : null,
        el('button', {
          class: 'gf-kebab',
          type: 'button',
          svg: ICONS.more,
          'aria-label': `Opciones de ${folder.name}`,
          onclick: (e) => {
            e.stopPropagation();
            openMenu(e.currentTarget, folderMenu(folder));
          },
        }),
      ],
    );

    row.addEventListener('dragstart', (e) => {
      dragging = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ t: 'folder', id: folder.id }));
      e.dataTransfer.setData('text/plain', folder.name);
    });
    row.addEventListener('dragend', () => {
      dragging = false;
    });
    makeDropTarget(row, folder.id);

    const node = el(
      'div',
      {
        class: 'gf-node',
        role: 'treeitem',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-label': folder.name,
        tabindex: '0',
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleFolder(folder.id);
          }
        },
      },
      [row],
    );

    if (!collapsed) {
      const group = el('div', { class: 'gf-children', role: 'group' });
      renderFolder(folder.id, group);
      const chatIds = GF.sortChats(state.chats, GF.chatsInFolder(state.assign, folder.id));
      for (const id of chatIds) group.appendChild(buildChatRow(id));
      if (group.childElementCount) node.appendChild(group);
    }
    return node;
  }

  function buildChatRow(chatId) {
    const chat = state.chats[chatId] || { title: 'Chat sin título', url: chatUrl(chatId) };
    const row = el(
      'div',
      {
        class: 'gf-row gf-chat',
        draggable: 'true',
        'data-chat': chatId,
        'data-gf-row': '1',
        title: chat.title,
        role: 'treeitem',
        'aria-label': chat.title,
        tabindex: '0',
        onclick: () => openChat(chatId),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openChat(chatId);
          }
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          openMenu(e.currentTarget, chatMenu(chatId));
        },
      },
      [icon('chat'), el('span', { class: 'gf-name', text: chat.title })],
    );
    row.addEventListener('dragstart', (e) => {
      dragging = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ t: 'chat', id: chatId }));
      e.dataTransfer.setData('text/plain', chatUrl(chatId));
    });
    row.addEventListener('dragend', () => {
      dragging = false;
    });
    return row;
  }

  function renderFolder(parentId, container) {
    for (const folder of GF.childrenOf(state.folders, parentId)) {
      container.appendChild(buildFolderNode(folder));
    }
  }

  function buildUnfiledSection() {
    const unfiled = GF.sortChats(state.chats, GF.unfiledChatIds(state.assign, state.chats));
    const collapsed = !state.ui.showUnfiled;
    const head = el(
      'div',
      {
        class: 'gf-row gf-section',
        role: 'treeitem',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-label': `Sin carpeta (${unfiled.length})`,
        tabindex: '0',
        onclick: () => {
          state.ui.showUnfiled = !state.ui.showUnfiled;
          save();
          render();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            state.ui.showUnfiled = !state.ui.showUnfiled;
            save();
            render();
          }
        },
      },
      [
        el('button', {
          class: `gf-twisty${collapsed ? '' : ' gf-open'}`,
          type: 'button',
          svg: ICONS.chevron,
          'aria-label': collapsed ? 'Expandir' : 'Contraer',
          onclick: (e) => {
            e.stopPropagation();
            state.ui.showUnfiled = !state.ui.showUnfiled;
            save();
            render();
          },
        }),
        icon('inbox'),
        el('span', { class: 'gf-name', text: `Sin carpeta (${unfiled.length})` }),
      ],
    );

    const node = el('div', { class: 'gf-node', role: 'none' }, [head]);
    if (!collapsed && unfiled.length) {
      const group = el('div', { class: 'gf-children', role: 'group' });
      for (const id of unfiled) group.appendChild(buildChatRow(id));
      node.appendChild(group);
    }
    return node;
  }

  function render() {
    if (!state.ui.panelEnabled) {
      if (root && root.isConnected) root.remove();
      root = null;
      ensureLauncher();
      return;
    }
    if (launcher && launcher.isConnected) launcher.remove();

    const target = ensureRoot();
    if (!target) {
      ensureLauncher();
      return;
    }

    const tree = el('div', { class: 'gf-tree', role: 'tree', 'aria-label': 'Carpetas' });
    renderFolder(null, tree);
    tree.appendChild(buildUnfiledSection());

    const header = el('div', { class: 'gf-header' }, [
      el('span', { class: 'gf-title', text: 'Carpetas' }),
      el('button', {
        class: 'gf-btn',
        type: 'button',
        svg: ICONS.folderPlus,
        'aria-label': 'Nueva carpeta',
        title: 'Nueva carpeta',
        onclick: () => {
          const name = askName('Nombre de la carpeta', 'Nueva carpeta');
          if (name) addFolder(name);
        },
      }),
      el('button', {
        class: 'gf-btn',
        type: 'button',
        svg: ICONS.more,
        'aria-label': 'Opciones del panel',
        title: 'Opciones',
        onclick: (e) => openMenu(e.currentTarget, mainMenu()),
      }),
    ]);

    target.replaceChildren();
    target.appendChild(header);
    target.appendChild(tree);
    if (statusMessage) {
      target.appendChild(el('div', { class: 'gf-status', role: 'status', text: statusMessage }));
    }
    fitScroller(findScroller());
  }

  // =====================================================================
  // Menús
  // =====================================================================

  let menuEl = null;

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  const SEPARATOR = { label: '—', action: () => {}, separator: true };

  function openMenu(anchor, items) {
    closeMenu();
    const list = items.filter(Boolean);
    if (!list.length) return;
    menuEl = el(
      'div',
      { class: 'gf-menu', 'data-gf-row': '1', role: 'menu' },
      list.map((it) =>
        el('button', {
          class: `gf-menu-item${it.separator ? ' gf-separator' : ''}`,
          type: 'button',
          role: 'menuitem',
          disabled: it.separator || undefined,
          text: it.label,
          onclick: () => {
            closeMenu();
            it.action();
          },
        }),
      ),
    );
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    menuEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    menuEl.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8))}px`;
    setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown, { once: true }), 0);
  }

  function onDocPointerDown(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  function folderMenu(folder) {
    return [
      {
        label: 'Renombrar',
        action: () => {
          const name = askName('Nuevo nombre', folder.name);
          if (name) renameFolder(folder.id, name);
        },
      },
      {
        label: 'Nueva subcarpeta',
        action: () => {
          const name = askName('Nombre de la carpeta', 'Nueva carpeta');
          if (name) addFolder(name, folder.id);
        },
      },
      { label: 'Mover a la raíz', action: () => moveFolder(folder.id, null) },
      { label: 'Eliminar carpeta', action: () => deleteFolder(folder.id) },
    ];
  }

  function chatMenu(chatId) {
    const items = GF.folderList(state.folders).map((f) => ({
      label: `→ ${f.name}`,
      action: () => assignChat(chatId, f.id),
    }));
    if (items.length) items.push(SEPARATOR);
    items.push({ label: 'Quitar de la carpeta', action: () => assignChat(chatId, null) });
    items.push({ label: 'Abrir chat', action: () => openChat(chatId) });
    return items;
  }

  function mainMenu() {
    const pending = GF.unfiledChatIds(state.assign, state.chats).length;
    return [
      { label: 'Cargar todos los chats', action: () => loadAllChats() },
      {
        label: `Auto-organizar pendientes (${pending})`,
        action: () => {
          const n = applyRules();
          flash(n ? `Se organizaron ${n} chats` : 'No hay reglas ni chats pendientes');
        },
      },
      { label: 'Añadir regla de auto-organización', action: addRule },
      { label: 'Reglas guardadas', action: showRules },
      SEPARATOR,
      {
        label: 'Cerrar panel',
        action: () => {
          state.ui.panelEnabled = false;
          save();
          render();
        },
      },
    ];
  }

  // =====================================================================
  // Reglas de auto-organización
  // =====================================================================

  function addRule() {
    const name = askName('Nombre de la regla (también será el nombre de la carpeta)');
    if (!name) return;
    const pattern = askName('Expresión regular que debe cumplir el título del chat');
    if (!pattern) return;
    if (GF.isRiskyPattern(pattern)) {
      flash('Ese patrón es demasiado costoso: podría bloquear el navegador.');
      return;
    }
    const rule = { id: GF.uid('r'), name, pattern, folderId: null, enabled: true };
    state.rules = { ...state.rules, [rule.id]: rule };
    save();
    flash(`Regla "${name}" creada`);
  }

  function showRules() {
    const rules = GF.folderList(state.rules);
    if (!rules.length) {
      flash('No hay reglas. Añade una desde el menú.');
      return;
    }
    const items = rules.map((r) => ({
      label: `${r.enabled === false ? '[off] ' : ''}${r.name}  ·  /${r.pattern}/`,
      action: () => {
        state.rules = { ...state.rules, [r.id]: { ...r, enabled: r.enabled === false } };
        save();
        flash(`Regla "${r.name}" ${r.enabled === false ? 'activada' : 'desactivada'}`);
      },
    }));
    items.push(SEPARATOR);
    items.push({
      label: 'Borrar todas las reglas',
      action: () => {
        state.rules = {};
        save();
        flash('Reglas borradas');
      },
    });
    const anchor = document.querySelector('#gf-root .gf-header .gf-btn:last-child') || document.body;
    openMenu(anchor, items);
  }

  // =====================================================================
  // Arrastrar y soltar
  // =====================================================================

  function parseDrop(e) {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        if (data.t === 'chat' && has(state.chats, data.id)) return { t: 'chat', id: data.id };
        if (data.t === 'folder' && has(state.folders, data.id)) return { t: 'folder', id: data.id };
        return null;
      } catch {
        return null;
      }
    }
    // Arrastrado desde fuera: sólo aceptamos URLs de Gemini de chats conocidos.
    const id = chatIdFromHref(e.dataTransfer.getData('text/plain'));
    return id && has(state.chats, id) ? { t: 'chat', id } : null;
  }

  const has = (obj, key) =>
    typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj || {}, key);

  function makeDropTarget(row, folderId) {
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('gf-drop');
    });
    row.addEventListener('dragleave', () => row.classList.remove('gf-drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('gf-drop');
      const data = parseDrop(e);
      if (!data) return;
      if (data.t === 'chat') assignChat(data.id, folderId);
      else moveFolder(data.id, folderId);
    });
  }

  // =====================================================================
  // Botón flotante para asignar chats nativos a una carpeta
  // =====================================================================

  let assignBtn = null;

  function ensureAssignButton() {
    if (assignBtn && assignBtn.isConnected) return assignBtn;
    assignBtn = el('button', {
      class: 'gf-assign',
      type: 'button',
      'data-gf-row': '1',
      title: 'Mover a una carpeta',
      'aria-label': 'Mover a una carpeta',
      svg: ICONS.folder,
    });
    assignBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    assignBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = assignBtn.dataset.chatId;
      if (id) openMenu(assignBtn, chatMenu(id));
    });
    document.body.appendChild(assignBtn);
    return assignBtn;
  }

  function positionAssignButton(link) {
    const id = chatIdFromHref(link.getAttribute('href'));
    if (!id) return;
    const btn = ensureAssignButton();
    btn.dataset.chatId = id;
    const r = link.getBoundingClientRect();
    btn.style.display = '';
    btn.style.left = `${Math.max(4, r.right - btn.offsetWidth - 6)}px`;
    btn.style.top = `${r.top + r.height / 2 - btn.offsetHeight / 2}px`;
  }

  function installRowHover() {
    let pending = false;
    let lastTarget = null;
    document.addEventListener(
      'pointermove',
      (e) => {
        const target = e.target;
        if (target === lastTarget) return;
        lastTarget = target;
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          const link = target && target.closest ? target.closest('a[href*="/app/"]') : null;
          if (!link || inOurUI(link)) {
            if (assignBtn) assignBtn.style.display = 'none';
            return;
          }
          positionAssignButton(link);
        });
      },
      true,
    );
  }

  // =====================================================================
  // Cargar todos los chats (paginación del sidebar nativo)
  // =====================================================================

  function findScroller() {
    // El scroller real del sidebar: <bard-sidenav> <infinite-scroller>.
    // Se acepta aunque todavía no scrollee (poco historial): scrollearlo es lo
    // que dispara la paginación de Gemini.
    for (const sel of SEL.scroller) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const sidenav = $(SEL.sidenav);
    if (sidenav) {
      let best = null;
      for (const el of sidenav.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 50 && (!best || el.clientHeight < best.clientHeight)) {
          best = el;
        }
      }
      if (best) return best;
    }
    return null;
  }

  function waitForMutation(target, timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const observer = new MutationObserver(() => finish(true));
      observer.observe(target, { childList: true, subtree: true });
      const timer = setTimeout(() => finish(false), timeout);
    });
  }

  async function loadAllChats() {
    const scroller = findScroller();
    if (!scroller) {
      flash('No se encontró la lista de chats en el sidebar');
      return;
    }
    const prevTop = scroller.scrollTop;
    let idle = 0;
    let round = 0;

    while (idle < 3 && round < 300) {
      round++;
      const before = Object.keys(state.chats).length;
      scroller.scrollTop = scroller.scrollHeight;
      await waitForMutation(scroller, 900);
      mergeHarvested();
      const after = Object.keys(state.chats).length;
      if (after === before) idle++;
      else idle = 0;
      statusMessage = `Cargando chats… ${after}`;
      render();
    }

    scroller.scrollTop = prevTop;
    save();
    statusMessage = '';
    render();
    flash(`Chats conocidos: ${Object.keys(state.chats).length}`);
  }

  // =====================================================================
  // Estado y mensajes
  // =====================================================================

  let statusMessage = '';
  let flashTimer = null;

  function flash(message) {
    statusMessage = message;
    render();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      statusMessage = '';
      render();
    }, 2500);
  }

  // =====================================================================
  // Montaje
  // =====================================================================

  function installObserver() {
    let harvestTimer = null;

    // La cosecha no se reprograma en cada mutación: así el sidebar no puede
    // aplazarla indefinidamente mientras la página se mueve.
    const scheduleHarvest = () => {
      if (harvestTimer) return;
      harvestTimer = setTimeout(() => {
        harvestTimer = null;
        if (mergeHarvested()) {
          // Ruido de fondo (actividad del chat abierto): se guarda con
          // retardo para no gastar las escrituras de sync.
          save(SLOW_SAVE);
          if (!dragging) render();
        }
      }, 1200);
    };

    const observer = new MutationObserver(() => {
      // Gemini remonta el sidebar al navegar: hay que reinsertar y repintar.
      // Se hace de forma síncrona (no con rAF) porque rAF no corre en una
      // pestaña en segundo plano y el panel se quedaría invisible.
      if (root && !root.isConnected) {
        root = null;
        render();
      }
      scheduleHarvest();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    await load();

    // El sidebar puede montarse después que el content script.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ($(SEL.mount)) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    installObserver();
    installStorageListener();
    installRowHover();
    window.addEventListener('resize', () => fitScroller(findScroller()));

    mergeHarvested();
    render();
    save();
  }

  init();
})();
