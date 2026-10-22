# Política de privacidad — Gemini Folders

**Última actualización:** 21 de octubre de 2026

## Resumen

Gemini Folders no recoge, transmite ni comparte ningún dato personal. Todo funciona
sin conexión dentro de tu navegador.

## Qué datos toca la extensión

La extensión sólo lee y escribe en el almacenamiento del navegador:

- `chrome.storage.local` (respaldo en este equipo).
- `chrome.storage.sync` (copia que el propio navegador sincroniza entre tus
  equipos si tienes la extensión instalada en más de uno y estás con la misma
  cuenta de Google).

En ambas areas guarda lo mismo:

- Las carpetas que creas (nombre, carpeta padre, orden).
- La asignación de cada chat a una carpeta.
- Un índice local de los chats que has visto en el sidebar: **identificador, título y URL**.
  No se copia el contenido de las conversaciones, sólo sus títulos.
- Reglas de auto-organización que tú escribes.

La sincronización la hace el navegador (Chrome/Edge) con su propio servicio: la
extensión **no** envía esos datos a ningún servidor nuestro, porque no tenemos
ninguno.

## Qué NO hace

- No envía peticiones de red desde la extensión. No hay servidor, backend ni API propia.
- No usa cookies ni tokens de tu cuenta de Google más allá de leer la página de Gemini
  que ya tienes abierta.
- No incluye analítica, publicidad ni telemetría de ningún tipo.
- No accede a otras pestañas ni a tus datos en otras webs.

## Permisos y por qué

| Permiso | Motivo |
| --- | --- |
| `storage` | Guardar carpetas y asignaciones en el navegador (local y sync). |
| Acceso a `https://gemini.google.com/*` | Inyectar el panel de carpetas dentro del sidebar de Gemini y leer los títulos de los chats que ya se muestran. |

La extensión **no** pide `unlimitedStorage`: la cuota por defecto de `storage.local`
(10 MB) equivale a decenas de miles de chats, muy por encima del uso previsto.
El área `sync` tiene límites más pequeños (8 KB por clave y 100 KB en total); la
extensión parte los datos en trozos para no superarlos y, si aun así no cabe,
guarda todo en `local` y muestra un aviso en vez de perder datos en silencio.

## Exportar / importar

Las copias de seguridad las genera el propio usuario en su navegador, como archivo JSON
local. Si compartes ese archivo con alguien, ese archivo contiene tus carpetas y títulos
de chat: trátalo como información personal.

## Eliminar tus datos

Desinstalar la extensión borra su almacenamiento local. También puedes borrar las claves
`gf.*` desde `chrome://extensions` → DevTools → *Almacenamiento*. Para quitar también la
copia sincronizada, borra los datos de la extensión en la página de configuración del
navegador (Chrome → *Contraseñas y autocompletado* / *Configuración de sincronización*).
