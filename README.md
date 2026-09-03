# Portfolio — Willian Eduardo Huit Tepen

Portfolio profesional en HTML, CSS y JavaScript sin dependencias ni proceso de
build. Se sirve tal cual desde GitHub Pages.

🔗 **https://willianhuit.github.io/Portfolio/**

## Características

- **Sin framework ni build**: HTML, CSS y JS planos. Se abre `index.html` y funciona.
- **Bilingüe (ES/EN)**: sistema i18n propio, cambio instantáneo sin recargar.
- **Modo claro/oscuro** con detección de la preferencia del sistema.
- **Cero dependencias externas**: los iconos van como sprite SVG incrustado y
  la tipografía auto-alojada. La página no pide nada a ningún tercero.
- **Accesible**: respeta `prefers-reduced-motion`, etiquetas ARIA traducidas y
  degradación completa sin JavaScript.

## Estructura

```
Portfolio/
├── index.html              # Página completa (incluye el sprite SVG de iconos)
├── arcade.html             # Easter egg: el juego "Sacbé"
├── 404.html                # Página de error de GitHub Pages
├── robots.txt
├── sitemap.xml
└── src/
    ├── css/styles.css      # Hoja de estilos principal (~2400 líneas)
    ├── fonts/              # Poppins auto-alojada (woff2, subsets latin)
    ├── js/
    │   ├── translations.js # Textos ES/EN
    │   ├── language.js     # Gestor de idioma (LanguageManager)
    │   ├── main.js         # Tema, navegación, partículas y animaciones
    │   └── arcade.js       # El juego (solo lo carga arcade.html)
    ├── vendor/three.module.min.js   # three.js r160, auto-alojado
    ├── img/                # Foto, iconos y capturas de proyectos
    └── pdf/                # CV y certificados
```

## Cómo trabajar en él

No hace falta instalar nada. Para desarrollo basta un servidor estático
cualquiera (abrir el archivo con `file://` funciona, pero un servidor evita
problemas con rutas relativas):

```bash
npx http-server -p 8080 -c-1
# o
python -m http.server 8080
```

### Cambiar textos

Todo el contenido traducible vive en [`src/js/translations.js`](src/js/translations.js),
con una entrada por idioma. En el HTML se referencia con atributos:

- `data-i18n="seccion.clave"` → reemplaza el texto del elemento.
- `data-i18n-aria="a11y.clave"` → traduce el `aria-label`.
- `data-i18n-manual` → el elemento lo gestiona otro módulo (el typing del hero);
  `updateContent()` no lo toca.

> **Importante**: `data-i18n` sobrescribe el `textContent` completo. Si el
> elemento contiene un icono u otro hijo, pon el atributo en un `<span>`
> interno, no en el padre.

### Cambiar colores

Son variables CSS al principio de [`src/css/styles.css`](src/css/styles.css):

```css
:root {
    --primary-color: #6366f1;
    --secondary-color: #8b5cf6;
    --accent-color: #ec4899;
}

html.dark-mode { /* sobrescribe los tonos de fondo y texto */ }
```

El modo oscuro se aplica con la clase `dark-mode` en `<html>` (no en `<body>`),
para que un script en el `<head>` pueda ponerla antes del primer pintado y no
haya destello blanco.

### Añadir un icono

Los iconos son un sprite `<symbol>` de Font Awesome Free 6.4.0 incrustado al
principio del `<body>` de `index.html`. Para añadir uno nuevo:

1. Copia el `<symbol>` correspondiente desde el sprite oficial
   (`https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/sprites/solid.svg`
   o `brands.svg`) dentro del bloque `<defs>`, renombrando su `id` a `i-<nombre>`.
2. Úsalo con `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-<nombre>"></use></svg>`.

Ojo: varios nombres de Font Awesome 5 se renombraron en la 6
(`external-link-alt` → `up-right-from-square`, `project-diagram` → `diagram-project`,
`users-cog` → `users-gear`, `pencil-ruler` → `pen-ruler`).

### Añadir una imagen de proyecto

Redimensiona a **800 px de ancho máximo** y guarda en JPEG (calidad ~85) en
`src/img/projects/`. Añade siempre `width`, `height`, `loading="lazy"` y
`decoding="async"` al `<img>`: sin las dimensiones la página salta al cargar.

## Decisiones de rendimiento

Estas decisiones no son arbitrarias; deshacerlas degrada métricas medidas:

| Decisión | Motivo |
|---|---|
| Iconos como sprite SVG en vez del CDN | El CSS + las dos webfonts de Font Awesome eran 275 KB para 30 iconos. |
| Poppins auto-alojada en `src/fonts/` con `preload` | Google Fonts exigía dos viajes a un tercero (el CSS tardaba ~2.3 s y solo entonces se pedían los `.woff2`). Ahora es un viaje al propio origen. |
| Del paquete de Poppins solo `latin` y `latin-ext` | Se descartó `devanagari`: 4 archivos innecesarios. Los `unicode-range` originales se conservan para que `latin-ext` solo se baje si hace falta. |
| `@font-face 'Poppins Fallback'` con `size-adjust` | Red de seguridad si el `.woff2` falla. Sin métricas ajustadas el intercambio de fuente provocaba CLS de 0.39. El valor se calibró midiendo el ancho de avance real. |
| `.icon { width: 1.25em; height: 1em }` | Reserva la caja del icono desde el primer pintado. |
| El loader **no** espera a `window.load` | `load` esperaba al iframe de Google Forms; la pantalla podía quedarse 3.8 s. Ahora usa `DOMContentLoaded` con tope duro de 2 s. |
| Imágenes a 800 px | La foto del hero pesaba 2.3 MB a 3000×3000 px mostrándose a 400×400. |
| Color del canvas cacheado | `getComputedStyle()` dentro del bucle de dibujo provocaba ~1200 lecturas forzadas de estilo por frame. |
| El `opacity: 0` de los reveals está en CSS, no en JS | Con la clase `.no-js` el contenido nunca queda invisible si el script falla. |

Estado actual (Chrome, medido en local):

- Peso de la carga inicial: **~170 KB** (HTML/CSS/JS comprimidos + foto + 4 fuentes)
- `DOMContentLoaded`: **~445 ms** · `window.load`: **~450 ms**
- La pantalla de carga se retira a los **~840 ms**
- CLS en móvil: **0.000**
- Peticiones a terceros: **0**

## Animaciones

Todas se desactivan con `prefers-reduced-motion: reduce`.

Typing rotativo en el hero · contadores animados · barra de progreso de scroll ·
botón volver-arriba con anillo de progreso · porcentaje animado en las barras de
habilidades · tilt 3D con spotlight en los proyectos (solo con ratón) ·
partículas que se repelen del cursor · títulos revelándose letra por letra ·
flip 3D en las certificaciones · marquee de tecnologías · malla de degradado en
el hero · cambio de tema con revelación circular (View Transitions API).

## Easter egg: «Sacbé»

Cinco clics seguidos en el logo `WH` de la barra llevan a `arcade.html`, un
endless runner voxel sobre una calzada maya. Al pasar el ratón por el logo
aparecen cinco rombos que se van rellenando con cada clic: hacen descubrible
el secreto sin explicarlo y dicen cuántos faltan. En táctil, donde no hay
hover, el primer toque los deja visibles. La ventana entre clics es de 3 s y
se reinicia sola.

**La ruta.** El recorrido cruza Guatemala en ocho tramos de 500 m: Tikal
(Petén) → Semuc Champey (Alta Verapaz) → Río Dulce (Izabal) → Antigua
(Sacatepéquez) → Atitlán (Sololá) → Chichicastenango (Quiché) → Tajumulco
(San Marcos) → Monterrico (Santa Rosa), y vuelta a empezar. Cada tramo trae
su cielo, su niebla, su luz, el material de su calzada, el color de sus
obstáculos y su propio hito en el horizonte —templo escalonado, karst,
palmera, arco colonial, volcán, mercado, pico nevado—. Un minimapa en el HUD
dibuja la silueta del país y va moviendo el marcador.

**El juego.** Tres vidas (hasta cinco con mejoras), escudo que absorbe un
golpe, multiplicador por racha de jade, hitos cada 250 m, jaguar que se acerca
conforme pierdes vidas y quetzal de acompañante.

**Poderes** que aparecen en la calzada: escudo, imán de jade, jade doble,
ámbar de Verapaz (ralentiza el mundo sin ralentizarte a ti) y vuelo del
quetzal (te eleva y sobrevuelas todo unos segundos).

**Taller.** El jade recogido se guarda al morir y se gasta en seis trajes
(Ajaw, Tejedora, Guerrero Jaguar, Quetzal, Chapín, Ceniza) y ocho mejoras
permanentes: vidas, escudo de salida, imán, duración de poderes, valor del
jade, agilidad de carril, salto doble y frecuencia de poderes. Los tramos se
abren al llegar a ellos corriendo, y una vez abiertos se puede salir desde
cualquiera de ellos.

Lo que importa mantener si se toca:

- **No sobrecarga la página principal.** `index.html` no referencia ni
  `arcade.js` ni three.js: el juego (192 KB) solo se descarga si alguien lo
  encuentra. El disparador añade 1,1 KB al total inicial.
- **Todo el escenario usa una única `BoxGeometry` compartida** y va en
  `InstancedMesh`. Son ~25 draw calls y ~4.900 triángulos por frame.
- **La calzada y el horizonte son periódicos.** Desplazarlos es mover su
  `Group` con un módulo, no recolocar 180 instancias por paso de simulación.
  Es la razón de que `ROAD_PERIOD` y `LAND_PERIOD` existan: si se cambia el
  espaciado hay que mantener la periodicidad o la costura se ve.
- **En `InstancedMesh` el color del material multiplica al de instancia.** Por
  eso los materiales con `setColorAt` van en blanco: ponerles el mismo tono lo
  elevaría al cuadrado y saldría oscurecido.
- **Los materiales de calzada y obstáculos son compartidos.** Antes cada uno
  de los obstáculos del pool creaba los suyos (más de 180 en total); ahora son
  seis. Es también lo que hace posible retematizar la escena entera por
  departamento cambiando un puñado de colores, sin tocar geometría.
- **El paisaje no se cambia de golpe al pasar de departamento: se interpola
  cubo a cubo.** Todas las siluetas ocupan los mismos `LAND_PARTS` huecos y
  las piezas sobrantes quedan a escala cero, así que el templo de Tikal se
  convierte en el karst de Semuc creciendo. Un cambio instantáneo se leía como
  un fallo de carga. La interpolación cuesta 336 matrices, pero solo se
  recalcula cuando la mezcla cambia de verdad: durante el 62 % de cada tramo
  vale exactamente 0 y no se repinta nada.
- **El cambio de carril es un tween con final garantizado, no un lerp
  exponencial.** El lerp nunca llegaba del todo al carril y dejaba el cuerpo a
  medio camino, lo que volvía confusas las colisiones.
- **El salto es de altura variable** (`JUMP_CUT` al soltar) y la bajada pesa
  más que la subida (`FALL_GRAVITY`): un salto de arco fijo y simétrico se
  siente flotante y hace difícil calcular dónde vas a caer.
- **Abajo en el aire es un picado que encadena con el deslizamiento.** Antes
  solo restaba algo de velocidad vertical y el deslizamiento caducaba antes de
  aterrizar, así que no servía para nada.
- **El HUD se repinta solo cuando algo cambia.** `renderHud` corría en cada
  frame reescribiendo el `innerHTML` de las vidas 60 veces por segundo, para
  un texto que casi nunca cambia.
- **La cámara sale toda de `cam`**, que se recalcula según la relación de
  aspecto. En vertical se inclina más, o media pantalla se va en cielo vacío.
- **La pista del logo no usa `transform`.** Escalarlo movía el objetivo del
  clic y hacía fallar tiros; pulsa un brillo, que deja la caja donde estaba.
- **Las colisiones comparan la posición real del jugador, no su índice de
  carril.** El índice cambia de golpe al pulsar mientras el cuerpo aún se
  desplaza (~0,2 s, que a velocidad máxima son 6 unidades): usarlo producía
  esquivas fantasma y golpes injustos.
- **El paso fijo es de 60 Hz con tope de 6 pasos por frame.** A 120 Hz con
  tope de 8 el juego entraba en cámara lenta por debajo de ~15 fps.
- **La sombra de contacto no es decorativa**: sin ella no hay forma de juzgar
  el aterrizaje ni si vas lo bastante alto para librar un cenote.
- **La cercanía del jaguar ES el indicador de vidas.** Cuenta lo mismo que los
  rombos del HUD sin obligar a apartar la vista de la calzada.
- **`COMBO_STEP` está en 3, no en 5.** Midiendo con un jugador activo, el
  máximo de jade en una carrera de 500 m era 4: con el umbral en 5 el
  multiplicador era inalcanzable y la mecánica no existía.
- Los obstáculos se reciclan en `DESPAWN_Z = 11` y la cámara está en 14: con
  el valor anterior pasaban por encima ocupando media pantalla.
- **`REGION_LENGTH` está en 500 m.** Con los 900 del ciclo de ambiente
  anterior la mayoría de partidas moría sin salir del primer tramo, y el viaje
  por el país no llegaba a existir. Poder elegir el punto de salida en el
  taller es la otra mitad de lo mismo: hace visible un contenido que si no
  solo veían los que llegan a 4.000 m.
- **El ámbar frena el mundo pero no el reloj de los poderes.** Si frenase
  también su propio temporizador se prolongaría a sí mismo.
- **Al terminar el vuelo del quetzal se conceden 0,8 s de margen.** El jugador
  cae desde casi cuatro unidades y aterrizaba encima de la estela que acababa
  de sobrevolar, perdiendo una vida sin haber hecho nada mal.
- **En pausa solo responden P, Esc y M.** Se podía cambiar de carril y saltar
  con el juego detenido, y al reanudar el personaje aparecía donde no debía.
- **El acumulador del paso fijo se vacía al empezar y al reanudar.** Si no, el
  tiempo muerto de los menús se gastaba de golpe en pasos de simulación y el
  mundo daba un salto de varios metros antes del primer frame.
- **El gesto táctil se resuelve en `touchmove`, no en `touchend`.** Esperar a
  que se levante el dedo metía hasta 200 ms en cada esquiva, que a velocidad
  máxima son seis unidades.
- El aviso de `prefers-reduced-motion` es voluntario: un runner es movimiento
  puro y no se puede atenuar, así que se avisa y decide el jugador.

## Idiomas y URLs

El idioma se resuelve en este orden: `?lang=es|en` → `localStorage` → idioma del
navegador. El parámetro existe para poder compartir un enlace directo en un
idioma y para dar a los buscadores una URL indexable por idioma, que es lo que
respaldan los `<link rel="alternate" hreflang>` del `<head>` y del `sitemap.xml`:

- Español: `https://willianhuit.github.io/Portfolio/`
- Inglés: `https://willianhuit.github.io/Portfolio/?lang=en`

## Despliegue

GitHub Pages sirve la rama `main` directamente. No hay paso de build: al hacer
push, los cambios quedan publicados.

## Contacto

- **Email**: willian.huit.soporte@gmail.com
- **LinkedIn**: [willian-huit](https://gt.linkedin.com/in/willian-huit)
- **GitHub**: [@WillianHuit](https://github.com/WillianHuit)
