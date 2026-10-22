# Gemini Folders

Extensión de Chrome (MV3) para **agrupar tus chats de Gemini en carpetas anidables,
dentro del propio sidebar de Gemini**.

- Árbol de carpetas (con subcarpetas) inyectado en el sidebar nativo, **encima de la lista de chats**.
- Arrastra chats del sidebar de Gemini o del propio árbol para meterlos en una carpeta.
- Todo se guarda **en local** (`chrome.storage.local`). Sin servidor, sin cuentas, sin telemetría.
- Exporta/importa un JSON para llevar tus carpetas a otra computadora.

## Instalar (uso personal)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. **Cargar descomprimida** → selecciona la carpeta de este repo.
4. Abre <https://gemini.google.com> y expande el sidebar.

## Instalar (Chrome Web Store)

1. `powershell -ExecutionPolicy Bypass -File scripts\package.ps1` → genera `dist/gemini-folders-<versión>.zip`.
2. Sube ese ZIP en <https://chrome.google.com/webstore/devconsole>.
3. Antes de publicar, rellena la [política de privacidad](PRIVACY.md).

> La cuenta de Web Store pide un pago único de 5 USD aldeveloper por primera publicación.

## Uso

| Acción | Cómo |
| --- | --- |
| Crear carpeta | Botón `+` de carpeta en la cabecera del panel, o menú de una carpeta → *Nueva subcarpeta* |
| Asignar chat | Pasa el ratón por un chat nativo del sidebar y pulsa el botón de carpeta que aparece a su derecha |
| Asignar chat (alternativa) | Click derecho sobre un chat de nuestro árbol → *→ carpeta* |
| Mover una carpeta | Arrastra la carpeta dentro de otra (no permite ciclos) |
| Cargar todos los chats | Menú `⋮` del panel → *Cargar todos los chats* |
| Auto-organizar | Menú `⋮` → *Añadir regla…* (expresión regular contra el título) y luego *Auto-organizar pendientes* |
| Copia de seguridad | Botón de la extensión en la barra → *Exportar copia* / *Importar copia* |

### Auto-organización por reglas

Las reglas son locales y deterministas (sin IA ni claves de API). Cada regla tiene un
nombre (que también es el nombre de la carpeta destino) y una expresión regular que se
evalúa contra el **título** del chat:

```
Regla "Trabajo"      →  /trabajo|proyecto|cliente/i  →  chats a la carpeta "Trabajo"
Regla "Universidad"  →  /tesis|universidad|examen/i  →  chats a la carpeta "Universidad"
```

Las reglas **no pisan** las asignaciones manuales: sólo organizan los chats que siguen
sin carpeta.

## Limitaciones conocidas

- Gemini sólo renderiza ~25 chats recientes en su sidebar. *Cargar todos los chats* hace
  scroll hasta agotar la paginación, pero los chats muy antiguos siguen sin aparecer en
  la UI de Gemini (Google los conserva en el historial de actividad, no en el sidebar).
- Los chats se detectan **por lo que hay en el DOM**. Si Gemini cambia sus selectores, el
  panel deja de poblarlo. Para diagnosticarlo, abre `tools/probe.js`, cópialo y pégalo en
  la consola de DevTools con Gemini abierto: devuelve el JSON con la estructura real del
  sidebar.
- `tools/selftest.html` abre un mock del sidebar de Gemini (misma estructura DOM que la real)
  con el script inyectado, para probar la extensión sin cuenta de Google (abre el archivo con
  `file://` y revisa la consola).

## Desarrollo

```bash
node tests/lib.test.js      # tests de la lógica pura (sin dependencias)
```

Estructura:

```
manifest.json   MV3, permiso mínimo: storage (el acceso a gemini.google.com viene del content script)
lib.js          lógica pura (árbol de carpetas, reglas, import/export) — testeable en Node
content.js      content script: cosecha chats, dibuja el árbol, drag & drop
content.css     estilos del panel
popup.html/js   export/import JSON
tools/          probe.js (sonda del DOM) y selftest.html (mock)
scripts/        package.ps1 (empaquetado para la Web Store)
```

## Privacidad

Todo se queda en el navegador. La extensión no hace peticiones de red ni envía datos a
ningún sitio. Ver [PRIVACY.md](PRIVACY.md).
