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
endless runner voxel que cruza Guatemala. Al pasar el ratón por el logo
aparecen cinco rombos que se van rellenando con cada clic: hacen descubrible
el secreto sin explicarlo y dicen cuántos faltan. En táctil, donde no hay
hover, el primer toque los deja visibles. La ventana entre clics es de 3 s y
se reinicia sola.

**La ruta.** Doce tramos de 500 m, en circuito: Tikal y Flores (Petén) → Semuc
Champey (Alta Verapaz) → Río Dulce (Izabal) → Esquipulas (Chiquimula) →
Antigua (Sacatepéquez) → Volcán de Fuego (Chimaltenango) → Atitlán (Sololá) →
Chichicastenango (Quiché) → Todos Santos (Huehuetenango) → Tajumulco (San
Marcos) → Monterrico (Santa Rosa), y vuelta a empezar. Cada tramo trae su
cielo, su niebla, su luz, **el material de su calzada**, el color de sus
obstáculos, lo que crece en sus cunetas y su propio hito en el horizonte
—templo escalonado, isla, karst, palmera, basílica, arco colonial, volcán,
mercado, pico nevado—. Un minimapa en el HUD dibuja la silueta del país y va
moviendo el marcador.

**El juego.** Tres vidas (hasta cinco con mejoras), escudo que absorbe un
golpe, multiplicador por racha de jade, hitos cada 250 m, jaguar que se acerca
conforme pierdes vidas y quetzal de acompañante.

**Las señales.** Rombos amarillos y un ceda el paso al borde de la calzada,
dibujados en canvas. **No son decorado**: cada uno se planta porque viene lo
que anuncia, treinta y cuatro unidades por delante. Derrumbe antes de un
tronco o de una piedra rodante, puente angosto antes de un vacío, paso de
ganado antes del camazotz, pendiente antes de una rampa, curva antes de un
giro real del trazado y bifurcación en Y antes de un cruce. Zona escolar,
paso de peatones y calzada resbaladiza son las únicas de ambiente, atadas al
tipo de departamento y con cuentagotas.

**Los distribuidores viales.** Cada 620 m la calzada llega a un cruce. Un
pórtico con dos rótulos verdes anuncia las salidas —una lleva a otro
departamento, la otra es el **retorno** al actual— y sesenta unidades después
**la calzada se parte de verdad**: desde la X salen dos vías de tres carriles
que se separan hacia los lados, y el mundo se recoloca sobre la que llevas
puesta mientras la otra se abre hacia fuera hasta perderse. **Qué lado es cuál
se sortea cada vez.** El retorno paga en jade; el cambio, en paisaje nuevo.

**La calzada no es recta ni plana.** Gira, ondula y a partir de los 120 m
aparecen tramos elevados: uno de los cinco repartos alto/bajo entre los tres
carriles, cada carril alto con su rampa de subida y de bajada. Se sube por la
rampa del propio carril o saltando; por el costado no se pasa.

**Y algo viene de frente.** A partir de los 220 m entran amenazas que cierran
distancia por su cuenta en vez de dejarse arrastrar por el mundo: el
*camazotz*, el murciélago de Xibalbá, que vuela a la altura del pecho y se
esquiva agachándose, y la *piedra rodante*, que solo se salta.

**Poderes** que aparecen en la calzada: escudo, imán de jade, jade doble,
ámbar de Verapaz (ralentiza el mundo sin ralentizarte a ti) y vuelo del
quetzal: el ave baja, te agarra con las garras y te sube a casi siete
unidades, donde se siembra un rastro de jade serpenteante que desde el suelo
no existe.

**Taller.** Seis trajes y ocho mejoras permanentes, pagados con el jade que se
guarda al morir. Los tramos se abren corriendo y luego se puede salir desde
cualquiera de ellos.

**Música.** Un vals de marimba sintetizado con osciladores, como el resto del
sonido: cero archivos. Cincuenta y dos compases en 3/4 —entrada de corcheas,
cuerpo en sol menor y segunda parte en sol mayor— con melodía, cifrado y
**segunda voz escrita**; el bucle dura 56 s. Se enciende y apaga por separado
de los efectos (tecla `N`).

**Patrocinio (Cefas Panadería).** Todo sale del objeto `CEFAS` en `arcade.js`:
cambiar de anunciante, de enlaces o de vídeos es tocar ese objeto y nada más.
Dos formatos, y ninguno interrumpe la partida:

- **La franja**, en el menú y en la pantalla de fin: PedidosYa, Instagram,
  Facebook, TikTok y el canal de Shorts. Son momentos en los que el jugador ya
  está parado leyendo.
- **El panel de revivir**, que solo se ofrece *después* de perder —cuando la
  alternativa es cerrar la pestaña— y una sola vez por carrera. Se ve un Short
  y se vuelve con una vida y el escudo puesto.

Lo que importa mantener si se toca:

- **No sobrecarga la página principal.** `index.html` no referencia ni
  `arcade.js` ni three.js: el juego solo se descarga si alguien lo encuentra.
  El disparador añade 1,1 KB al total inicial.
- **El escenario repetido usa una única `BoxGeometry` compartida** y va en
  `InstancedMesh`: calzada, sub-base, bordillos, matorral, hitos, sierra,
  cielo y partículas son ocho draw calls entre todos, pasara lo que pasara. Lo
  que sí cuenta son los objetos sueltos —tramos elevados, obstáculos,
  recogidas, amenazas—: en el peor caso el frame ronda las 150 draw calls.
- **Cuatro profundidades a cuatro velocidades.** Matorral al borde (1x), hitos
  (0,82x), sierra del fondo (deriva lateral) y cielo (0,045x). Con una sola
  capa el mundo se veía vacío y plano; con cuatro, la velocidad se lee sin
  mirar el marcador.
- **La sierra del fondo no se acerca nunca.** Una cordillera a kilómetros no
  crece porque camines, y reciclarla en Z daba un salto de tamaño cada vuelta.
  Lo que hace es derivar de lado, con un periodo más ancho que el cono de
  visión para que el reciclado ocurra fuera de pantalla. Va sin niebla a
  propósito: la niebla se cierra en 185 y la sierra vive más allá.
- **La curva es puramente visual y por eso no cuesta nada.** Cada objeto tiene
  una coordenada de trazado `s = distancia − z` que es invariante, así que su
  desplazamiento lateral se calcula UNA vez al aparecer y luego solo se le
  resta el del jugador.
- **Pero la curva empieza a las 52 unidades, no en el metro cero.** La primera
  versión curvaba desde los pies del jugador, y ahí el truco se rompía: un
  tramo elevado es una pieza recta de hasta setenta unidades y no encajaba con
  una calzada que se doblaba bajo ella. Con la máscara de distancia, la zona
  donde se juega es recta —y por tanto todo casa— y el giro vive en el fondo,
  que es donde se lee. La ondulación vertical va por la misma máscara.
- **Toda instancia de un `InstancedMesh` hay que apagarla al crearla.** Una
  instancia recién creada lleva la matriz identidad: un cubo de 1×1×1 en el
  origen —que es exactamente donde vive el jugador—. Como
  `updateRoadCurve` solo apaga las celdas que alguna vez estuvieron encendidas, las que una zona
  no llega a usar (diecisiete de dieciocho en Tikal) se quedaban ahí, con el
  color en cero del buffer recién reservado: un cubo negro pegado a los pies
  del corredor. Antigua era la única zona que se libraba, porque su adoquín de
  seis por tres gasta las dieciocho.
- **Nunca dos caras en el mismo plano.** Tres bugs distintos eran el mismo
  error: el hueco y el agua del cenote acababan los dos en `y = 0.09` (y ganaba
  el material casi negro, así que el cenote era una plancha sin agua ni borde);
  la tapa y el costado de los tramos elevados terminaban los dos en
  `LEVEL_HIGH`, y el z-fighting resultante se arrastraba al avanzar, que se
  veía como una textura moviéndose. Las capas van a alturas separadas.
- **Las vetas rojas de la piedra rodante van por FUERA del núcleo.** Medían
  1,5 dentro de un cubo de 1,45: sobresalían dos centímetros y quedaban
  enterradas, y la amenaza se veía como un cubo negro sin más. El filo rojo es
  además emisivo, o en las zonas de noche no se ve venir.
- **La bifurcación se recoloca sobre el jugador, no al revés.** A la
  separación de cada ramal se le resta la del ramal que él lleva en su propia
  posición: así su calzada queda siempre centrada, la otra se abre al doble de
  velocidad, y en cuanto la X queda atrás los dos términos se cancelan solos
  sin tener que desactivar nada. La versión anterior resolvía el cruce con una
  isleta y ya: no había forma de saber qué camino habías tomado, porque los dos
  eran el mismo camino.
- **El ramal se fija incluso si se salta el divisor por arriba.** Sin fijarlo,
   pierde el término que recoloca el mundo y la calzada se le desliza
  al jugador de debajo de los pies hasta ocho unidades.
- **Toda la bifurcación va limpia de objetos.** Un obstáculo ahí dentro caería
  sobre un ramal que se está abriendo, o sobre el que no se ha tomado, o justo
  donde hay que estar leyendo y colocándose.
- **El cambio de departamento se cruza en segundo y medio.** Antes saltaba en
  un frame y se leía como un fallo de carga.
- **Las señales entran desde transparente y van racionadas.** Nacían ya
  visibles a 136 del jugador y se materializaban de la nada; y salía más de una
  por compás, que es un pasillo de rombos y no señalización. Ahora hay 95
  unidades mínimas entre dos, salvo las del cruce y las de lo que cruza la
  calzada entera, que no se pueden dejar sin avisar.
- **La señal manda sobre el peligro, no al revés.** Se planta primero, se mira
  por qué lado quedó, y la piedra o el murciélago entran justo por ahí —desde
  fuera de la calzada, meténdose hacia su carril—. Una señal de derrumbe a la
  derecha con la piedra cayendo por la izquierda es peor que no ponerla, porque
  enseña a no fiarse.
- **La pendiente anuncia una bajada de verdad**: la calzada se hunde por
  delante, la cámara cabecea y se corre un 22 % más durante 150 unidades. Es el
  único sitio donde la velocidad sube sin que el jugador haya hecho nada, y por
  eso se avisa siempre.
- **Una señal que no anuncia nada envenena a las demás.** Si la de curva
  saliera en las rectas, el jugador dejaría de mirar todas: por eso se mide el
  desplazamiento REAL del trazado treinta unidades más allá y solo se planta
  si la calzada se va a mover de verdad. Las de ambiente salen al 7 % por
  compás justamente para no devaluar a las que sí avisan.
- **Treinta y cuatro unidades de adelanto, ni una más.** La señal nace a 136
  del jugador y la bruma, que cierra a 185, se come su entrada. Con más
  adelanto aparecería de golpe en mitad del campo visible. Lo que gana no es
  tiempo de reacción —el obstáculo ya se ve venir— sino saber **de qué** se
  trata mientras aún es una silueta en la niebla.
- **Lo que cruza la calzada entera lleva señal a los DOS lados.** Una en un
  solo margen se lee como algo que afecta solo a ese carril, que es
  exactamente lo contrario de lo que hay que entender.
- **Las texturas de las señales se generan una vez y se comparten.** Rehacer
  el rombo en cada aparición sería pintar el mismo dibujo cientos de veces por
  partida; el pool solo intercambia el `map`.
- **La velocidad sube con la DISTANCIA, no con el reloj.** Con el reloj,
  quedarse en el menú de pausa aceleraba igual, y sobre todo el que juega bien
  no notaba recompensa: llegaba al techo a los 32 s y de ahí no se movía. La
  curva es una raíz —sube donde se nota y se va aplanando—: 21 a los 100 m,
  29 a los 500, 35 a los 1000 y el techo de 52 hacia los 3600. El techo es de
  seguridad, no de diseño: por encima de unos 66 los obstáculos empezarían a
  colarse entre dos pasos de simulación.
- **El hueco entre compáses se mide en SEGUNDOS, no en unidades.** Con un hueco
  fijo, doblar la velocidad partía por la mitad el tiempo de reacción y el
  juego se volvía imposible en vez de difícil. Lo que se estrecha es el margen,
  de 1,55 s a 0,92 s, y la dificultad la pone la velocidad.
- **El tronco y el vacío van solos en su compás y se deciden los primeros.** Si
  se decidieran después, la placa de impulso ya estaría puesta y su losa de 3,4
  de largo acabaría flotando sobre el borde del vacío. Su filtro es la altura
  del terreno a lo largo de su huella, no `platformNear`: ese comprueba una
  ventana de casi cien unidades y, como los tramos elevados salen medio compás
  de cada dos, casi siempre había uno «cerca» —salía un tronco cada 900 m, o
  sea nunca—.
- **El agujero del vacío es de verdad**: `updateRoadCurve` apaga las losas que
  caen dentro, en vez de pintar una mancha oscura encima. Es lo que hace que se
  lea como un sitio por el que se puede caer.
- **La salida se resuelve cuando la COLA de la isleta deja atrás al jugador.**
  Resolverla al llegar la punta le quitaría al tramo toda su tensión: hasta el
  último momento se puede cambiar de carril.
- **Saltar la isleta no toma ninguna salida.** El muro se puede librar por
  arriba, pero entonces no se ha elegido nada, y cobrar el premio del retorno
  por ello sería pagar por no decidir.
- **`roadRegionOf` también suma `regionShift`.** Sin eso, al tomar la salida de
  cambio el cielo y la vegetación saltaban al departamento nuevo y la calzada se
  quedaba con el adoquín del anterior.
- **Deslizarse no es encogerse, es tirarse.** El cuerpo se tumba a 64° y baja al
  ras, con un brazo estirado y la cabeza compensando la inclinación para seguir
  mirando al frente. Achatar la figura en el sitio, como hacía antes, se leía
  como un personaje agachado y no como uno derrapando.
- **Las placas de impulso se pisan, no se recogen.** Saltando por encima no
  cuentan, y eso las convierte en una decisión. El empujón se aplica *después*
  del tope de velocidad: su gracia es pasar del techo unos segundos, con el
  riesgo que eso trae, porque los huecos entre obstáculos no se ensanchan.
- **Cada losa consulta su propia región**, así que el cambio de firme es una
  LÍNEA en el mundo que se ve venir de lejos, no un fundido global: llegar a
  Antigua es ver aparecer el adoquín. La línea cae en la mitad de la
  transición de cielo y luces.
- **El color por sí solo no bastaba para distinguir las zonas**: Antigua y
  Tikal salían iguales con distinto tono. `road: [cortes, filas, junta,
  irregularidad]` es lo que convierte la calzada en losa grande de caliza, en
  adoquín de seis por tres, en tablón de muelle o en arena sin juntas.
- **Bajo la calzada va una sub-base.** Sin ella las juntas del adoquín son
  agujeros por los que se ve el suelo de selva, y a ras de cámara la junta
  central dibujaba una raya verde de punta a punta.
- **El paisaje no se cambia de golpe al pasar de departamento: se interpola
  cubo a cubo.** Todas las siluetas ocupan los mismos `LAND_PARTS` huecos y
  las piezas sobrantes quedan a escala cero.
- **En `InstancedMesh` el color del material multiplica al de instancia.** Por
  eso los materiales con `setColorAt` van en blanco.
- **El desnivel es un problema de ruta, no una trampa.** Entrar por el costado
  de un tramo elevado rechaza el cambio de carril con un topetazo, no cobra
  una vida.
- **Sobre terreno desigual no se generan dos obstáculos.** Ese patrón deja un
  único carril libre, y si ese carril está arriba y el jugador abajo, el muro
  lateral le cierra la única salida: golpe seguro sin haber fallado nada.
- **`terrainAt` es la única fuente de verdad sobre la altura del suelo.** Las
  alturas de colisión son RELATIVAS a esa base.
- **Las amenazas no se tematizan.** Todo lo demás cambia de color doce veces
  por vuelta, y una fuente de daño que a veces es clara sobre fondo oscuro y a
  veces al revés se vuelve ilegible justo cuando importa.
- **El detalle del personaje va en la ESPALDA.** El jugador corre de espaldas
  a la cámara: los ojos no se ven nunca, y en cambio la nuca, la manta, el
  morral y las plumas del tocado se ven en todo momento. Poner detalle en la
  cara era trabajo invisible.
- **Los iconos del taller son SVG en línea, no glifos Unicode.** La tipografía
  solo trae el rango latino, así que cualquier símbolo raro cae en la fuente
  de respaldo del sistema: el `⬡` del escudo se dibujaba como una «O» en
  Windows. Los trajes no llevan glifo sino un muñeco pintado con sus propios
  colores, que es icono y vista previa a la vez.
- **Revivir se gana viendo el vídeo, no siguiendo las redes.** Un botón de
  «seguir» no se puede verificar desde el navegador, así que premiarlo sería
  premiar el clic; y las tres plataformas desaconsejan el seguimiento
  incentivado. Los enlaces sociales están, pero no dan nada a cambio.
- **La cuenta atrás del anuncio corre por reloj propio**, no por el estado del
  reproductor: si un bloqueador tumba el iframe, el jugador revive igual.
  Cobrarle el fallo de otro sería injusto, y además le dejaría sin salida.
- **El vídeo arranca silenciado, y `mute=1` no es un descuido.** Chrome bloquea
  el arranque automático con sonido en un iframe de otro dominio salvo que el
  usuario tenga historial con YouTube, así que sin silenciar se quedaba parado
  en el fotograma de portada para buena parte de la gente. Ya que va a
  arrancar solo, mejor que se vea moviéndose; el aviso bajo el título dice
  dónde está el altavoz.
- **Se rota entre los Shorts al azar**, para que quien muera dos partidas
  seguidas no vea el mismo anuncio.
- **El iframe no existe hasta que se abre el panel.** `arcade.html` no hace ni
  una petición a terceros mientras nadie muera y acepte el anuncio, y se usa
  el dominio `youtube-nocookie.com`. Al cerrar el panel el iframe se
  **elimina**: esconderlo dejaba el vídeo sonando por debajo de la partida.
- **Al revivir se despeja el tramo que tienes delante** (obstáculos a menos de
  70 unidades, amenazas a menos de 90). Sin eso reaparecías dentro del mismo
  obstáculo que acababa de matarte.
- **El bucle de simulación corta al cambiar de estado.** Una colisión puede
  terminar la carrera a mitad del bucle de pasos fijos, y sin ese corte el
  mundo seguía avanzando con la partida ya cerrada.
- **La música se baja a cero mientras suena el anuncio.** Dos músicas a la vez
  no es un anuncio, es ruido.
- **La melodía la aporta `VALS.bars`, y no la he verificado.** No existe
  transcripción libre y fiable de la pieza en la red —lo que circula son vídeos
  y partituras de pago, y las dos páginas con las notas en texto devuelven
  403—, que es por lo que en su día se escribió un vals propio. Lo que suena
  ahora es exactamente lo que se entregó: si algo desafina, el sitio donde
  mirar es ese array y ningún otro.
- **La tabla de notas conoce los bemoles.** Tenía solo sostenidos, y un `Eb5`
  daba `undefined` → frecuencia `NaN` → nota muda. Los bemoles son alias de su
  sostenido.
- **La `v2` escrita manda sobre la calculada.** Cada compás puede traer una
  segunda voz con su propio ritmo, que no tiene por qué coincidir con el de la
  melodía, así que va en su propia línea de tiempo. Inventarle una tercera
  encima a un arreglo que ya trae la suya sería pisarlo: la armonización
  automática solo entra donde no hay `v2` (los ocho compases de entrada).
- **Donde hay `v2`, los acordes del acompañamiento bajan a la mitad de la
  mitad.** La segunda voz ya hace de relleno armónico y sonando los dos el
  compás se emborrona. Pero no desaparecen: hay compases con `v2` de nota
  tenida, y sin ellos se perdería el pulso de vals.
- **La segunda voz calculada sale del ACORDE, no de una escala fija.** La primera
  versión bajaba dos grados de la menor y punto, lo cual servía mientras la
  pieza estuvo en la menor; con una que empieza en sol menor y se muda a sol
  mayor a mitad, esa cuenta devuelve notas de otra tonalidad. Buscándola entre
  las notas del acorde no puede desafinar, module la pieza donde module. Se
  prefiere la que cae a una tercera mayor, con margen de tercera menor a sexta
  menor: más cerca suena a golpe sucio y más lejos deja de leerse como una
  sola línea.
- **Solo repican las notas de dos tiempos o más.** Repicar también las de
  tiempo y medio emborronaba el ritmo punteado del vals, que es la mitad de su
  carácter.
- **La marimba se sintetiza como lo que es**: una barra golpeada. Un seno para
  el fundamental y otro cuatro veces más agudo y muy corto para el golpe de la
  baqueta. Sin el segundo suena a flauta.
- **La música se programa con medio segundo de adelanto.** Web Audio suena por
  su cuenta; así un frame lento no abre un hueco en el compás.
- **La cámara sale toda de `cam`**, que se recalcula según la relación de
  aspecto. Al volar, cámara y punto de mira suben en la MISMA proporción, que
  es lo que mantiene al personaje donde estaba en el encuadre.
- **El cambio de carril es un tween con final garantizado, no un lerp
  exponencial**, que nunca llegaba del todo al carril y volvía confusas las
  colisiones.
- **El salto es de altura variable** y la bajada pesa más que la subida: un
  arco fijo y simétrico se siente flotante.
- **El HUD se repinta solo cuando algo cambia.**
- **El paso fijo es de 60 Hz con tope de 6 pasos por frame**, y el acumulador
  se vacía al empezar y al reanudar.
- **En pausa solo responden P, Esc, M y N.**
- **El gesto táctil se resuelve en `touchmove`, no en `touchend`.**
- **La sombra de contacto no es decorativa**: sin ella no hay forma de juzgar
  el aterrizaje. Va a la altura del suelo REAL, no del cero absoluto.
- **La cercanía del jaguar ES el indicador de vidas.**
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
