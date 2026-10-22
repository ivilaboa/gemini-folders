/**
 * Tests de la lógica pura (lib.js). Sin dependencias: `node tests/lib.test.js`.
 */
const assert = require('node:assert/strict');
const GF = require('../lib.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

const withFolders = (...folders) => Object.fromEntries(folders.map((f) => [f.id, f]));

console.log('carpetas');

test('createFolder respeta el padre y el orden', () => {
  const a = GF.createFolder({}, 'Trabajo');
  let folders = { [a.id]: a };
  const b = GF.createFolder(folders, 'Trabajo', a.id);
  folders = { ...folders, [b.id]: b };
  const c = GF.createFolder(folders, 'Ocio', a.id);
  assert.equal(a.parentId, null);
  assert.equal(b.parentId, a.id);
  assert.ok(c.order > b.order, 'los hermanos mantienen un orden creciente');
});

test('childrenOf ordena por order y luego por nombre', () => {
  const folders = withFolders(
    { id: 'f1', name: 'B', parentId: null, order: 10 },
    { id: 'f2', name: 'A', parentId: null, order: 10 },
    { id: 'f3', name: 'C', parentId: null, order: 5 },
  );
  assert.deepEqual(GF.childrenOf(folders, null).map((f) => f.id), ['f3', 'f2', 'f1']);
});

test('isDescendant detecta nietos', () => {
  const folders = withFolders(
    { id: 'a', name: 'a', parentId: null, order: 1 },
    { id: 'b', name: 'b', parentId: 'a', order: 2 },
    { id: 'c', name: 'c', parentId: 'b', order: 3 },
  );
  assert.equal(GF.isDescendant(folders, 'c', 'a'), true);
  assert.equal(GF.isDescendant(folders, 'b', 'c'), false);
  assert.equal(GF.isDescendant(folders, 'a', 'a'), false);
});

test('moveFolder mueve y bloquea ciclos', () => {
  const folders = withFolders(
    { id: 'a', name: 'a', parentId: null, order: 1 },
    { id: 'b', name: 'b', parentId: 'a', order: 2 },
    { id: 'c', name: 'c', parentId: null, order: 3 },
  );
  const moved = GF.moveFolder(folders, 'b', 'c');
  assert.equal(moved.b.parentId, 'c');
  assert.equal(GF.moveFolder(folders, 'a', 'b').a.parentId, null, 'no debe permitir el ciclo');
  assert.equal(GF.moveFolder(folders, 'a', 'a').a.parentId, null, 'no puede ser su propio padre');
  assert.equal(GF.moveFolder(folders, 'a', 'nope').a.parentId, null, 'padre inexistente');
});

test('deleteFolder borra descendientes', () => {
  const folders = withFolders(
    { id: 'a', name: 'a', parentId: null, order: 1 },
    { id: 'b', name: 'b', parentId: 'a', order: 2 },
    { id: 'c', name: 'c', parentId: 'b', order: 3 },
    { id: 'd', name: 'd', parentId: null, order: 4 },
  );
  const res = GF.deleteFolder(folders, 'a');
  assert.deepEqual(res.removedIds.sort(), ['a', 'b', 'c']);
  assert.deepEqual(Object.keys(res.folders), ['d']);
});

test('renameFolder ignora nombres vacíos', () => {
  const folders = withFolders({ id: 'a', name: 'a', parentId: null, order: 1 });
  assert.equal(GF.renameFolder(folders, 'a', '  ').a.name, 'a');
  assert.equal(GF.renameFolder(folders, 'a', 'Nuevo').a.name, 'Nuevo');
});

console.log('chats');

test('assignChat asigna y desasigna', () => {
  const assign = GF.assignChat({}, 'chat1', 'f1');
  assert.equal(assign.chat1, 'f1');
  assert.equal(GF.assignChat(assign, 'chat1', null).chat1, undefined);
});

test('chatsInFolder y unfiledChatIds', () => {
  const assign = { c1: 'f1', c2: 'f1', c3: 'f2' };
  const chats = { c1: {}, c2: {}, c3: {}, c4: {} };
  assert.deepEqual(GF.chatsInFolder(assign, 'f1').sort(), ['c1', 'c2']);
  assert.deepEqual(GF.unfiledChatIds(assign, chats), ['c4']);
});

test('sortChats ordena por actividad reciente', () => {
  const chats = { a: { ts: 1 }, b: { ts: 3 }, c: { ts: 2 } };
  assert.deepEqual(GF.sortChats(chats, ['a', 'b', 'c']), ['b', 'c', 'a']);
});

console.log('reglas');

test('applyRules crea la carpeta de la regla y no pisa lo manual', () => {
  const rules = { r1: { id: 'r1', name: 'Trabajo', pattern: 'proyecto', enabled: true } };
  const chats = { c1: { title: 'Mi proyecto nuevo' }, c2: { title: 'manual' } };
  const assign = { c2: 'manualFolder' };
  const res = GF.applyRules(rules, chats, assign, { manualFolder: { id: 'manualFolder' } });
  assert.equal(res.applied.length, 1);
  assert.equal(res.assign.c1, res.folders[res.assign.c1].id);
  assert.equal(res.assign.c2, 'manualFolder', 'no debe pisar una asignación manual');
});

test('applyRules respeta enabled=false y regex inválida', () => {
  const chats = { c1: { title: 'x' } };
  const off = GF.applyRules({ r: { id: 'r', name: 'n', pattern: 'x', enabled: false } }, chats, {}, {});
  assert.equal(off.applied.length, 0);
  const bad = GF.applyRules({ r: { id: 'r', name: 'n', pattern: '([', enabled: true } }, chats, {}, {});
  assert.equal(bad.applied.length, 0);
  assert.equal(GF.compileRule({ pattern: '([' }), null);
});

console.log('import / export');

test('exportData produce un payload versionado', () => {
  const payload = GF.exportData({ folders: { a: {} }, assign: {}, chats: {}, rules: {} });
  assert.equal(payload.format, 'gemini-folders');
  assert.equal(payload.version, 1);
  assert.ok(payload.exportedAt);
});

test('parseImport rechaza JSON inválido y foreign payloads', () => {
  assert.throws(() => GF.parseImport('no json'), /JSON/);
  assert.throws(() => GF.parseImport('{"format":"otro"}'), /copia de seguridad/);
  const good = GF.parseImport(JSON.stringify(GF.exportData({ folders: {}, assign: {}, chats: {}, rules: {} })));
  assert.equal(good.format, 'gemini-folders');
});

test('mergeImport deja ganar al importado y conserva lo local', () => {
  const merged = GF.mergeImport(
    { folders: { a: { id: 'a', name: 'local' } }, assign: { c1: 'a' }, chats: { c1: {} }, rules: {} },
    { folders: { a: { id: 'a', name: 'importado' }, b: { id: 'b' } }, assign: { c2: 'b' }, chats: { c2: {} }, rules: {} },
  );
  assert.equal(merged.folders.a.name, 'importado');
  assert.equal(merged.folders.b.id, 'b');
  assert.equal(merged.assign.c1, 'a', 'conserva lo local que no viene en el import');
  assert.equal(merged.assign.c2, 'b');
  assert.deepEqual(Object.keys(merged.chats).sort(), ['c1', 'c2']);
});

test('applyRules crea la carpeta sólo si la regla casa con algún chat', () => {
  const rules = { r1: { id: 'r1', name: 'Trabajo', pattern: 'proyecto', enabled: true } };
  const res = GF.applyRules(rules, { c1: { title: 'nada que ver' } }, {}, {});
  assert.equal(res.applied.length, 0);
  assert.equal(Object.keys(res.folders).length, 0, 'no debe crear carpetas vacías');
});

test('applyRules recuerda la carpeta creada y no la duplica', () => {
  const rules = { r1: { id: 'r1', name: 'Trabajo', pattern: 'proyecto', enabled: true } };
  const chats = { c1: { title: 'un proyecto' } };
  const first = GF.applyRules(rules, chats, {}, {});
  const folderId = first.assign.c1;
  assert.ok(folderId);
  const second = GF.applyRules(first.rules, chats, {}, first.folders);
  assert.equal(second.assign.c1, folderId);
  assert.equal(Object.keys(second.folders).length, 1, 'no debe crear una carpeta nueva');
});

console.log('seguridad');

test('isRiskyPattern bloquea backtracking catastrófico', () => {
  for (const bad of ['^(a+)+$', '(a*)*', '(.*)+', '(a|aa)+', '([a-z]+)*$', '(x+x+)+y']) {
    assert.equal(GF.isRiskyPattern(bad), true, `${bad} debería bloquearse`);
  }
  for (const ok of ['^proyecto', 'trabajo|proyecto', '^\\d{4}-\\d{2}-\\d{2}$', '(?:https?://)\\S+']) {
    assert.equal(GF.isRiskyPattern(ok), false, `${ok} debería permitirse`);
  }
});

test('compileRule rechaza patrones peligrosos e inválidos', () => {
  assert.equal(GF.compileRule({ pattern: '^(a+)+$' }), null);
  assert.equal(GF.compileRule({ pattern: '([' }), null);
  assert.ok(GF.compileRule({ pattern: 'proyecto' }) instanceof RegExp);
});

test('safeCopy descarta claves reservadas', () => {
  const copy = GF.safeCopy(JSON.parse('{"__proto__":{"x":1},"constructor":2,"ok":3}'));
  assert.deepEqual(Object.keys(copy), ['ok']);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
});

test('validateImport rechaza secciones que no son objetos', () => {
  assert.throws(() => GF.validateImport({ format: 'gemini-folders', folders: 'ABC' }), /folders/);
  assert.throws(() => GF.validateImport({ format: 'gemini-folders', rules: [] }), /rules/);
});

test('validateImport rechaza claves reservadas', () => {
  const payload = JSON.parse(
    '{"format":"gemini-folders","assign":{"__proto__":"x"}}',
  );
  assert.throws(() => GF.validateImport(payload), /reservada/);
});

test('validateImport rechaza formas inválidas y URLs externas', () => {
  assert.throws(
    () => GF.validateImport({ format: 'gemini-folders', folders: { a: { name: 5 } } }),
    /nombre inválido/,
  );
  assert.throws(
    () => GF.validateImport({ format: 'gemini-folders', chats: { a: { title: 'x', url: 'https://evil.example/' } } }),
    /URL inválida/,
  );
  assert.throws(
    () => GF.validateImport({ format: 'gemini-folders', rules: { r: { name: 'n', pattern: '^(a+)+$' } } }),
    /demasiado costoso/,
  );
});

test('validateImport acepta un payload sano', () => {
  const payload = GF.exportData({
    folders: { f1: { id: 'f1', name: 'Trabajo', parentId: null, order: 1000 } },
    assign: { c1: 'f1' },
    chats: { c1: { title: 'hola', url: 'https://gemini.google.com/app/c1' } },
    rules: { r1: { id: 'r1', name: 'n', pattern: 'hola' } },
  });
  assert.doesNotThrow(() => GF.validateImport(payload));
});

console.log(`\n${passed} pruebas OK`);
