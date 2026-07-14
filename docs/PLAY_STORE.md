# Empaquetado a Google Play — TSC Capacita

Esta guía explica cómo llevar la app web del LMS (TSC Capacita) a la Play Store.
La app ya es una PWA instalable: el manifest, el service worker y los iconos de
marca viven en el repo y se sirven solos en cuanto el sitio esté desplegado en
HTTPS. Lo que falta para publicar en la tienda depende de credenciales y cuentas
de Ismael (Play Console, clave de firma, dominio), no de código.

La experiencia que va a la tienda es la cáscara móvil del guardia (retrato,
dark-first).

## Qué ya está listo en el repo (automático)

Todo esto se generó en la rama y no requiere ninguna acción manual mas allá de
desplegar el sitio:

- `apps/web/src/app/manifest.ts`: Web App Manifest servido en
  `/manifest.webmanifest` (name "TSC Capacita", short_name "Capacita",
  `display: standalone`, `orientation: portrait`, `theme_color: #121E23`,
  `background_color: #090F12`, `lang: es`, categoría educación).
- `apps/web/public/sw.js`: service worker mínimo y no destructivo (network-first
  para navegación con cáscara offline, no cachea el API ni toca la auth). Se
  registra solo en producción desde `apps/web/src/app/pwa-register.tsx`.
- `apps/web/public/offline.html`: cáscara offline de marca (ink + escudo).
- `apps/web/public/icons/`: iconos PNG reales de marca (escudo TSC sobre ink):
  - `icon-192.png`, `icon-512.png` (purpose any)
  - `maskable-192.png`, `maskable-512.png` (purpose maskable, con zona segura)
  - `apple-touch-icon.png` (180)
  - `favicon-32.png`, `favicon-48.png`
- `apps/web/public/favicon.png` (64) y `favicon.ico` (16/32/48): favicon
  autocontenido (escudo claro sobre ink) que se ve en cualquier pestaña.

Con esto, en cuanto el sitio viva en un origen HTTPS, Chrome en Android ya lo
ofrece como "Instalar app" y cumple el criterio de instalabilidad (manifest
valido, service worker con handler fetch, e iconos 192 y 512).

## Camino recomendado: TWA con Bubblewrap

Como esto es una app web bien formada, la ruta correcta a Play es una Trusted
Web Activity (TWA). Es una app Android delgada que abre la PWA a pantalla
completa, sin barra de navegador, usando el motor de Chrome del dispositivo.
Bubblewrap es la herramienta oficial de Google para generarla.

Ventajas: una sola base de código (la web), la app siempre sirve la ultima
versión desplegada, y el peso del AAB es mínimo.

### Requisitos

1. El sitio desplegado en un origen HTTPS estable. Ejemplo previsto:
   `https://capacita.tscseguridadprivada.com.mx`.
2. Un archivo Digital Asset Links en `/.well-known/assetlinks.json` del mismo
   origen, con el fingerprint SHA-256 de la clave con la que se firma la app.
   Esto es lo que quita la barra de URL del navegador dentro de la app.
3. Una clave de firma Android (keystore) para el AAB.
4. Node y el CLI de Bubblewrap instalados en la máquina de build.
5. El JDK y el Android SDK (Bubblewrap los instala o guía para instalarlos la
   primera vez).

### Pasos concretos

Instalar Bubblewrap:

```
npm install -g @bubblewrap/cli
```

Inicializar el proyecto Android a partir del manifest ya publicado:

```
bubblewrap init --manifest https://capacita.tscseguridadprivada.com.mx/manifest.webmanifest
```

En el init, valores sugeridos para mantener consistencia de marca:

- Application ID (package): `mx.com.tscseguridadprivada.capacita`
- Nombre de la app: `TSC Capacita`
- Nombre corto: `Capacita`
- Color de la barra de estado y splash: `#121E23`
- Color de fondo del splash: `#090F12`
- Orientación: `portrait`

Construir el paquete firmado:

```
bubblewrap build
```

Esto produce `app-release-bundle.aab` (para subir a Play) y un APK firmado (para
probar en un teléfono real con `adb install`). En el primer build, Bubblewrap
pide crear o seleccionar la clave de firma (keystore).

### Digital Asset Links (assetlinks.json)

El archivo debe quedar servido en:

```
https://capacita.tscseguridadprivada.com.mx/.well-known/assetlinks.json
```

En un proyecto Next, se sirve poniéndolo en
`apps/web/public/.well-known/assetlinks.json`. Contenido (reemplazar el
fingerprint):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "mx.com.tscseguridadprivada.capacita",
      "sha256_cert_fingerprints": ["REEMPLAZAR_CON_EL_FINGERPRINT_SHA256"]
    }
  }
]
```

Para obtener el fingerprint desde la clave local:

```
keytool -list -v -keystore android.keystore -alias android
```

O directamente con Bubblewrap:

```
bubblewrap fingerprint list
```

Aviso importante sobre Play App Signing: al subir un AAB, Google suele re-firmar
la app con su propia clave. En ese caso el fingerprint que va en
`assetlinks.json` no es el de tu keystore de subida, sino el de la clave de
firma de la app que Play Console muestra en "Configuración, Integridad de la
app, Firma de la app". Si la barra de URL no desaparece dentro de la app, casi
siempre es porque el fingerprint publicado no coincide con el de firma real.
Publica el que aparece en Play Console y espera unos minutos a que se propague.

### Qué es de Ismael en la ruta TWA

- La cuenta de Google Play Console (alta de pago único de 25 USD) y el alta de
  la ficha de la app.
- El dominio y su despliegue en HTTPS (`capacita.tscseguridadprivada.com.mx` en
  el VPS o Vercel).
- La clave de firma (keystore) y su resguardo. Si se pierde, no se puede
  actualizar la app.
- Publicar `assetlinks.json` con el fingerprint real (una vez creada la app en
  Play Console).
- Los assets de la ficha: capturas, gráfico destacado, descripción, política de
  privacidad (URL requerida por Play).

## Alternativa: Capacitor

Capacitor envuelve la web en un WebView nativo y da acceso a plugins nativos.
Conviene solo si en algún momento se necesita algo que la TWA no da bien:

- Notificaciones push nativas (FCM), cámara, biométricos, lectura de archivos,
  ejecución en segundo plano u otras APIs nativas.
- Control fino del contenedor nativo (splash, permisos, deep links propios).

Para el caso actual (un LMS que ya funciona como PWA) la TWA es mejor: menos
mantenimiento y sin proyecto nativo que cuidar. Capacitor implica mantener un
proyecto Android aparte y pasa por mas escrutinio de revisión por ser un
WebView.

### Pasos con Capacitor (apuntando al sitio de prod)

```
pnpm add -D @capacitor/cli
pnpm add @capacitor/core @capacitor/android
npx cap init "TSC Capacita" mx.com.tscseguridadprivada.capacita
npx cap add android
```

Para que la app cargue el sitio desplegado (en vez de empaquetar el build),
poner en `capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "mx.com.tscseguridadprivada.capacita",
  appName: "TSC Capacita",
  webDir: "apps/web/public",
  server: {
    url: "https://capacita.tscseguridadprivada.com.mx",
    cleartext: false
  }
};

export default config;
```

Abrir en Android Studio y generar el AAB firmado:

```
npx cap open android
```

En Android Studio: Build, Generate Signed Bundle, elegir la clave de firma y
producir el AAB. Requiere Android Studio y JDK instalados.

## Resumen: automático vs credenciales de Ismael

| Pieza | Estado |
| --- | --- |
| Web App Manifest (`/manifest.webmanifest`) | Listo en el repo |
| Service worker + cáscara offline | Listo en el repo |
| Iconos de marca (192, 512, maskable, apple, favicon) | Listos en el repo |
| Registro del SW (solo producción) | Listo en el repo |
| Sitio desplegado en HTTPS | De Ismael (VPS o Vercel) |
| `assetlinks.json` con fingerprint real | De Ismael (tras crear la app) |
| Clave de firma Android (keystore) | De Ismael |
| Cuenta y ficha en Play Console | De Ismael |
| Capturas, gráfico destacado, política de privacidad | De Ismael |
| Construir el AAB (`bubblewrap build`) | Se ejecuta con su clave, no aquí |

## Honestidad sobre lo que no se puede hacer aquí

La construcción del APK/AAB y el alta en Play Console no se pueden completar en
este entorno: requieren la cuenta de Play, la clave de firma y el dominio en
HTTPS de Ismael, mas el Android SDK y el JDK en la máquina de build. Los comandos
de arriba quedan listos para ejecutar en su equipo cuando el sitio esté
desplegado. Lo que sí queda hecho y verificado en el repo es la parte web: la app
es instalable como PWA (manifest, service worker e iconos reales), que es el
requisito previo de la TWA.
