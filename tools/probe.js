/**
 * Sonda del DOM de Gemini.
 *
 * Pega este archivo en la consola de DevTools (F12) con tu sesión de Gemini
 * iniciada y devuelve un JSON con la estructura real del sidebar: qué
 * selectores existen, cuántos chats hay y cuál es el contenedor que scrollea.
 *
 * Con esa salida se ajustan los selectores de content.js (SEL).
 */
(() => {
  const SEL = {
    sidenav: ['bard-sidenav', 'bard-sidenav-container', '.sidebar-nav'],
    mount: [
      'bard-sidenav .sidenav-with-history-container',
      'bard-sidenav .overflow-container',
      'bard-sidenav',
    ],
    chatLinks: [
      '[data-test-id="conversation"] > a[href*="/app/"]',
      'a[data-test-id="conversation"][href*="/app/"]',
      'a[href*="/app/"]:not([data-gf-row])',
    ],
    scroller: ['.recent-conversations-container', 'infinite-scroller'],
    newChat: ['bard-sidenav .overflow-container gem-nav-list-item a', 'bard-sidenav a[href="/app"]'],
    pageTitle: ['main [data-test-id="conversation-title"]', '[data-test-id="conversation-title"]'],
  };

  const count = (sel) => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return -1;
    }
  };

  const describe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      class: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8),
      testId: el.getAttribute('data-test-id') || undefined,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 8,
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      children: el.children.length,
    };
  };

  const out = {
    url: location.href,
    title: document.title,
    path: location.pathname,
    selectors: {},
    chatSamples: [],
    scrollers: [],
    sidenavTree: null,
  };

  for (const [key, list] of Object.entries(SEL)) {
    out.selectors[key] = list.map((sel) => ({ sel, count: count(sel), first: describe(document.querySelector(sel)) }));
  }

  const links = [...document.querySelectorAll('a[href*="/app/"]')];
  out.chatSamples = links.slice(0, 8).map((a) => ({
    href: a.getAttribute('href'),
    text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    testId: a.getAttribute('data-test-id') || undefined,
    parentTestId: a.parentElement?.getAttribute('data-test-id') || undefined,
    parentClass: (a.parentElement?.className || '').toString().slice(0, 120),
    grandparentTestId: a.parentElement?.parentElement?.getAttribute('data-test-id') || undefined,
  }));

  const sidenav = document.querySelector(SEL.sidenav[0]) || document.querySelector(SEL.sidenav[1]);
  if (sidenav) {
    const walk = (el, depth) => {
      if (depth > 3) return null;
      return {
        ...describe(el),
        kids: [...el.children].slice(0, 12).map((c) => walk(c, depth + 1)),
      };
    };
    out.sidenavTree = walk(sidenav, 0);
  }

  for (const sel of SEL.scroller) {
    for (const el of document.querySelectorAll(sel)) {
      out.scrollers.push({ sel, ...describe(el) });
    }
  }
  if (sidenav) {
    for (const el of sidenav.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50) {
        out.scrollers.push({ sel: '(dentro de bard-sidenav)', ...describe(el) });
        if (out.scrollers.length > 8) break;
      }
    }
  }

  const text = JSON.stringify(out, null, 2);
  console.log(text);

  const pre = document.createElement('pre');
  pre.id = 'gf-probe';
  pre.textContent = text;
  pre.style.cssText =
    'position:fixed;inset:2vh 2vw;z-index:2147483647;overflow:auto;background:#111;color:#0f0;font:11px/1.4 monospace;padding:12px;border:2px solid #0f0';
  pre.addEventListener('click', () => pre.remove());
  document.body.appendChild(pre);

  return text;
})();
