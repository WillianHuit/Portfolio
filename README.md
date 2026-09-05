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

**La ruta.** Trece sitios de Guatemala encadenados en **un camino, no en un
circuito**: se sale siempre de Tikal y se llega —o no— a Ciudad de Guatemala.
Entre un punto y el siguiente hay carretera de verdad, aproximando, que en
Guatemala no todo conecta con todo:

> Tikal → Flores *(CA-13)* → Semuc Champey *(FTN por Sayaxché y Raxrujá)* →
> Río Dulce *(FTN hasta Modesto Méndez)* → Esquipulas *(CA-9 y CA-10)* →
> Monterrico *(oriente por Ipala, Jutiapa y Taxisco)* → Tajumulco *(CA-2, la
> costera)* → Todos Santos *(por Huehuetenango)* → Chichicastenango
> *(Sacapulas)* → Atitlán *(Los Encuentros)* → Volcán de Fuego *(CA-1)* →
> Antigua → **Ciudad de Guatemala** *(RN-14)*.

**La ruta solo se mueve en una bifurcación**, y solo hacia delante: de las dos
salidas del distribuidor, una lleva al **siguiente punto** y la otra es el
**retorno**, que deja donde estabas. Qué lado es cuál se sortea cada vez, así
que hay que leer el rótulo. Y ahí está el juego: la velocidad no deja de
subir, de modo que cada retorno son 780 m corridos más rápido para acabar en
el mismo sitio. Equivocarse no mata, cansa.

Antes el destino se sorteaba entre los doce y se saltaba de Petén a San Marcos
y de ahí a Izabal: el mapa no significaba nada porque no había forma de estar
cerca ni lejos de ninguna parte. Ahora el minimapa dibuja los **tramos como
caminos** —discontinuos los que faltan, encendidos los recorridos— y decir
cuánto queda es mirarlo.

Cada tramo trae su cielo, su niebla, su luz, **el material de su calzada**, el
color de sus obstáculos, lo que crece en sus cunetas y su propio hito en el
horizonte —templo escalonado, isla, karst, palmera, basílica, arco colonial,
volcán, mercado, pico nevado y, al final, un skyline con las coronaciones
encendidas sobre el único asfalto del recorrido—.

### Repaso zona por zona: Petén

Con las zonas midiendo tres minutos, cada sitio se mira seguido mucho más rato
que en las carreras de dos minutos de antes, y los defectos que no daba tiempo
a ver ahora se ven enteros. Petén es el primer repaso, y salieron cuatro:

- **El templo de Tikal no parecía Tikal.** Eran cinco gradas anchas que
  encogían y nada encima: exactamente la misma receta —cajas que menguan— que el
  pico de Tajumulco y el cono de Atitlán, con otro color. Lo que hace
  inconfundible al Templo I son tres cosas y no había ninguna: es **alto y
  estrecho**, lleva la **escalinata** partiéndole la cara de arriba abajo, y
  remata en **crestería**, ese muro vertical sobre el templete que no sostiene
  nada. Con cuatro gradas más empinadas, la escalinata y el templete coronado
  pasa de 9 a 12,8 de alto con una proporción de 1,49 a 1, y cabe en los ocho
  huecos que tiene asignados cada hito.
- **La selva era un seto de altura constante.** Una pared verde plana a los dos
  lados, igual de alta cada dos metros de principio a fin. Ahora **una de cada
  tres ranuras es una ceiba emergente** —doce de cuarenta y cuatro—: el mismo
  presupuesto de tres cubos, más del doble de alta, tronco de madera y copa
  plana por encima del dosel. La cuneta pasa a tener fondo.
- **El suelo de Flores era verde monte, y Flores es una ISLA.** Lo que hay a los
  dos lados de la calzada es el lago Petén Itzá. Con el suelo verde, el muelle
  de madera del final de zona, los juncos de la cuneta y los peces saltando de
  un margen al otro estaban los cuatro contando algo que la escena desmentía.
- **El tinte del camazotz era verde oscuro sobre una selva verde.** El suceso se
  anunciaba, caía el tinte… y la escena se quedaba igual. El camazotz es el
  murciélago del inframundo, así que lo que tiene que caer sobre la selva es la
  **noche**: violeta. Y las guacamayas, rojas.

### Repaso zona por zona: Semuc Champey

- **El karst no eran torres.** `karst` era un montón de cajas solapadas **más
  ancho que alto** —8 de ancho por 7,75 de alto, 0,97 a 1— y eso no es un
  mogote, es una loma: desde la calzada se leía igual que cualquier cerro del
  resto de la ruta. Alta Verapaz es karst **de torre**: laderas casi verticales,
  cima redondeada y siempre en grupo. Ahora son tres torres de alturas distintas
  sobre una base común, la más alta a **2,62 a 1**, y cada una con su monte
  encima —en el karst la roca se ve en la ladera y la vegetación se queda
  arriba, que es lo que hace que se lean como piedra y no como árboles juntos—.
- **La cuneta era una alfombra.** Los tres discos de `fern` no pasaban de **2,2
  de alto**, cuando todo lo demás del juego anda entre 3 y 5, así que la calzada
  parecía cruzar un prado abierto. Semuc es un **cañón**: una de cada tres
  ranuras pasa a ser un paredón de caliza con monte encima y el helecho a su
  pie, y la cuneta llega a 8,4.
- **El suelo era verde monte, y Semuc ES el agua.** Las pozas turquesa son la
  postal entera del sitio. Con el suelo verde, la boca de cueva del final de
  zona —que es por donde el Cahabón se mete bajo el puente natural—, los peces
  saltando de un margen al otro y el turquesa de sus propios obstáculos estaban
  los cuatro contando algo que la escena desmentía. **Es el mismo fallo que
  tenía Flores.**
- **Y el mismo tinte invisible que tenía Tikal**: 0x24503a, verde oscuro, sobre
  un cañón verde. Lo que llena el aire cuando se desploma media ladera de caliza
  es **polvo de piedra**, y el gris cal es además lo que más lejos está del verde
  de Alta Verapaz.

### Repaso zona por zona: Río Dulce

- **Río Dulce y Monterrico eran el mismo sitio.** Compartían la silueta del
  horizonte *y* el matorral de la cuneta —los dos `palm`—, así que el cañón de
  Izabal y la playa del Pacífico, dos paradas que están a cuatro de distancia
  en la ruta, desde la calzada se veían idénticos. Río Dulce se lleva silueta
  propia y Monterrico se queda la palmera, que en una playa es exactamente lo
  que toca.
- **La suya es el paredón**, no la palmera: una pared de caliza cayendo a plomo,
  con la selva colgando arriba y el castillo de San Felipe a sus pies. Pasa de
  7,1 de alto y 1,62 a 1 a **12,3 y 1,99 a 1**. Y es *una* pared y no un cañón
  de dos, porque **el hito se planta a un lado de la calzada, no a caballo de
  ella**: un hueco en medio no se leería como «se pasa por entre las dos», se
  leería como una muesca en un bulto del margen.
- **La orilla es manglar, no palmeral.** El mangle se reconoce por una sola
  cosa: parece estar de pie sobre el agua, sobre raíces en zanco. Dos zancos
  abiertos y una copa baja y ancha, con el mismo presupuesto de tres cubos.
- **Y el tercer tinte verde oscuro sobre suelo verde**, a 5° del suelo que tiñe.
  Lo que trae troncos río abajo es la **crecida**, y una crecida se ve porque el
  agua se pone de color barro: 129°.
- **El suelo, otra vez, decía monte** mientras cinco cosas del propio sitio
  decían agua: los peces que saltan de un margen al otro, el muelle del final de
  zona, sus obstáculos azules, el fondo casi negro de los huecos y un suceso que
  se llama «troncos del río». Verde jade oscuro, que es el color del Río Dulce
  metido en el cañón y lo que lo separa del turquesa claro de Semuc, dos paradas
  antes: mismo tono, pero 0,44 de luz contra 0,26.

### Repaso zona por zona: Esquipulas

- **La Basílica del Cristo Negro no estaba.** Esquipulas usaba la silueta
  `colonial` de Antigua pintada de otro color, así que el mayor santuario de
  Centroamérica y la ciudad de las ruinas tenían el mismo perfil. **Y el color
  no salva una silueta**: a la distancia a la que vive el horizonte, lo primero
  que llega es la forma. Ahora tiene la suya —fachada ancha, cuatro torres con
  cúpula y el cimborrio en medio, con su cruz—, y pasa de 7,9 de alto y 0,99 a 1
  a **10,0 y 1,32 a 1**. `colonial` vuelve a ser sólo de Antigua.
- **Y va simétrica a propósito.** El hito se refleja según el lado de la calzada
  en el que caiga, así que las siluetas asimétricas cambian de mano; ésta es la
  única del recorrido a la que eso le da igual, que es justo lo que se espera de
  una fachada de iglesia.
- **El corredor seco era una pradera rapada.** El agave es planta de suelo y no
  pasaba de 3,2 de alto. Una de cada tres ranuras pasa a ser **cactus de
  candelabro** —el columnar que llega a los cinco o seis metros y no se parece a
  nada más del recorrido—, y la cuneta sube a 6,3.
- **Y un tinte que fallaba por donde no miraba la métrica.** Pasaba la prueba
  del tono por los pelos (59°) pero tenía **exactamente la misma luz que el
  suelo que tiñe**: 0,315 contra 0,331. Un tinte que ni cambia de tono ni cambia
  de claro a oscuro no hace nada. Y aquí además iba al revés: el polvo que
  levanta una caravana en el corredor seco no oscurece la escena, la
  **blanquea**, porque es polvo en el aire y el polvo en el aire coge luz. Ahora
  0,64 contra 0,33.

**De aquí salió una métrica, y con ella una cola de trabajo.** El tinte de un
suceso hay que medirlo **en tono contra el SUELO de su región**, no contra la
niebla: el suelo es el plano grande que el jugador tiene a los dos lados de la
calzada y el tinte se lo lleva al 50 %. Medido contra la niebla, el tinte viejo
de Tikal aprobaba —la niebla de Tikal es ocre de amanecer— y aun así no se veía
nada. Contra el suelo, los dos tintes viejos quedan a **4° y 2°**: el mismo
verde, sólo que más oscuro, y oscurecer una escena verde se lee como que ha
pasado una nube por delante, no como que está pasando algo.

Pasada la métrica a las trece zonas, **el arreglo de Petén se había comido a sí
mismo**: al poner el suelo de Flores del color del lago, su tinte azul se quedó
a 12° de la superficie que tiñe. Ahora es color limo —lo que un cenote remueve
al tragarse la calzada—, a 140°.

Y con Río Dulce salió la segunda medida: **dos paradas seguidas no pueden
parecerse**, porque la ruta se recorre en orden y lo único con lo que el jugador
puede comparar un sitio es con el que acaba de dejar atrás. Dos vecinos con el
mismo suelo, la misma silueta o el mismo matorral son un sitio contado dos
veces, aunque por separado los dos estén bien. La cola que queda, por orden de
ruta:

| Parada | Qué le falta |
|---|---|
| Monterrico | Tinte a 43° de su suelo |
| Tajumulco | Cuneta de 2,6 · **misma silueta que Todos Santos, y van seguidas** |
| Todos Santos | La otra mitad de lo anterior |
| Chichicastenango | Cuneta de 2,8 · **mismo suelo que Atitlán, y van seguidas** |
| Atitlán | **Misma silueta que el Fuego, y van seguidas** |
| Volcán de Fuego | Cuneta de 2,0 · la otra mitad de lo anterior |
| Ciudad de Guatemala | Tinte a 4° de su suelo |

**Y la métrica del tinte tiene dos mitades, no una.** Esquipulas enseñó la
segunda: su tinte pasaba el tono (59°) y aun así no hacía nada, porque tenía la
misma luz que el suelo. Un tinte tiene que separarse **en tono o en claridad**,
y lo honesto es mirar las dos columnas.

**El juego.** Tres vidas (hasta cinco con mejoras), escudo que absorbe un
golpe, multiplicador por racha de jade, hitos cada 2.000 m, jaguar que se acerca
conforme pierdes vidas y quetzal de acompañante. Al morir se ofrece volver
mientras quede con qué: **hasta cuatro vueltas por carrera**, tres con ángeles
comprados y una con el anuncio del patrocinador.

**Las señales.** Rombos amarillos, un ceda el paso y un disco rojo de
prohibición al borde de la calzada, dibujados en canvas. **No son decorado ni
un aviso genérico: cada una dispara un suceso concreto, y del lado en el que
está plantada.**

| Señal | Lo que provoca |
|---|---|
| Derrumbe | Caen piedras del cerro **sobre ese carril**. En los dos márgenes, un tronco de lado a lado. |
| Ganado | Una **vaca** entra por ese margen y cruza la calzada al paso hasta el otro. |
| Parada de camioneta | Por ese carril viene un **bus** de frente, que no se aparta ni se salta. |
| Curva | La calzada **cierra de verdad hacia ese lado** durante 225 unidades, se corre un 30 % más en el punto cerrado y el tramo va limpio de obstáculos: solo entran enemigos. **El carril de FUERA se pinta de rojo**: es hacia donde tira la inercia, y quedarse ~2 s en él te saca de la carretera. |
| Pendiente | Bajada real de 150 unidades: la calzada se hunde por delante, la cámara cabecea y se corre un 20 % más. Sin obstáculos ni tramos elevados. |
| `] [` Carril estrecho | Los tres carriles **se vuelven uno**. Por los lados ya no hay calzada: quien siga ahí se cae. |
| Bifurcación en Y | Viene una bifurcación. |
| Prohibido virar (disco rojo) | Ese ramal del cruce está **cortado por un derrumbe**. Meterse por ahí se acabó. |
| Hueco | Uno de dos: un vacío de lado a lado, o **un hundimiento del firme** en uno o dos carriles. En el segundo caso los carriles que se van a caer parpadean en rojo mucho antes, y el que se salva lleva una viga o un sumidero: se pasa agachándose o saltando, nunca cambiándose de carril. |
| Viento | Rachas de costado que **te sacan de la línea**. No golpean: descolocan, y hay que corregir. |

Zona escolar, paso de peatones y calzada resbaladiza son las únicas de
ambiente, atadas al tipo de departamento y con cuentagotas. **El murciélago y
la piedra rodante sueltos salen SIN señal**, a propósito: son el ruido de
fondo del camino, y ponerles cartel llenaría el margen de rombos hasta que
dejaran de mirarse los que sí anuncian algo gordo.

**El suceso de cada zona.** Cada punto de la ruta tiene **una cosa que solo
pasa ahí**, y pasa **una vez por visita, al final del tramo**. Antes las
trece zonas se distinguían por el color del cielo y por lo que crecía en la
cuneta: distintas de mirar, idénticas de **jugar** —la misma piedra rodante y
el mismo murciélago en la selva, en la playa y en la cumbre nevada—.

| Zona | Lo que pasa |
|---|---|
| Tikal | **Vuelo de camazotz**: los murciélagos salen del templo en fila |
| Flores | **El lago se la traga**: sumideros encadenados sobre el agua |
| Semuc Champey | **Desprendimiento**: cae piedra caliza del cañón |
| Río Dulce | **Troncos del río**: de lado a lado, uno detrás de otro |
| Esquipulas | **Caravana de romería**: camionetas de frente |
| Monterrico | **Marejada**: la ola barre la calzada y hay que saltarla |
| Volcán Tajumulco | **Erupción**: llueven bombas volcánicas al rojo vivo |
| Todos Santos | **Ventisca**: el viento te saca de la línea |
| Chichicastenango | **Camino del mercado**: ganado cruzando |
| Lago de Atitlán | **Xocomil**: el viento del lago, más fuerte |
| Volcán de Fuego | **El Fuego escupe**: la erupción, pero de verdad |
| Antigua | **Temblor**: retumba y caen sillares |
| Ciudad de Guatemala | **Hora pico**: buses de frente, sin parar |

Trece sucesos con arte propio serían trece juegos. Lo que hay es un vocabulario
de **seis patrones** —lluvia, enjambre, cruce, pasillo, viento y temblor— y una
ficha por zona que los compone y los tematiza: el nombre, el color con el que se
tiñe la escena mientras dura, de qué color son las chispas que caen y con qué
cadencia viene lo que viene. **La única pieza nueva es la bomba volcánica**, que
es la que el suceso de Tajumulco necesitaba de verdad; todo lo demás recombina
lo que ya había. El tinte de la escena hace la mitad del trabajo: sin el aire
rojo, las bombas serían piedras naranjas cayendo en un día normal.

**Y viene en OLEADAS, no goteando.** Cada oleada suelta algo en todos los
carriles menos el libre, de golpe, y llegan cada ~1 a 2 s según la zona. La
primera versión soltaba una pieza por hueco y salía **menos densa que el ruido
de fondo del camino**: cinco murciélagos repartidos en 380 unidades son uno cada
76, y los sueltos de siempre salen cada 35. Se armaba, sonaba el rótulo, caía el
tinte… y no había nada que ver, porque un suceso más flojo que lo normal no es
un suceso.

**Aprieta según lo avanzada que esté la ruta.** No hay contador de dificultad
aparte: la ruta va de Tikal a la capital, así que *lo avanzado del recorrido es*
la dificultad. En Petén el suceso sale a cinco oleadas espaciadas; en la
capital, a ocho y encima.

**Cuánto dura una zona es UNA constante, y ya no la decide el ritmo de los
cruces.** `ZONE_MINUTES` son los minutos de carrera a velocidad de crucero que
se está en un sitio: **tres**, o sea 12.240 unidades de calzada y unos cuarenta
minutos de ruta entera. Antes lo decidía `CROSS_EVERY` —los cruces alternaban
destino y cortada, así que la zona duraba exactamente dos cruces— y eso ataba
dos cosas que no tienen nada que ver: cada cuánto se decide un camino y cuánto
se está en un sitio. Ahora **el cruce de destino no aparece hasta que la zona
cumple su tiempo**: dentro de una zona todos son cortadas, y el que cambia de
sitio es el que la cierra. Y si se toma el retorno el contador sigue vencido,
así que el siguiente cruce vuelve a ser de destino: equivocarse cuesta un cruce,
no una zona entera.

**Y el suceso de la zona es UNO, y va al final.** Se repetía cada 6.000 m —unas
ocho veces por zona— y eso lo estropeaba dos veces: de tanto verlo dejaba de ser
*el suceso del sitio* y pasaba a ser ruido de fondo con rótulo, y encima caía en
cualquier punto del tramo, así que no significaba nada. Ocurriendo **una sola
vez y cerca del final**, la zona tiene forma: se entra, se corre, y lo gordo pasa
justo antes de la estructura de despedida y la bifurcación.

El momento se cuenta **desde el final de la zona y no como fracción**, para que
siga significando lo mismo si `ZONE_MINUTES` cambia: `ZONE_CLIMAX` son las
unidades que quedan de zona cuando el suceso se arma. Con tres minutos sale al
74 % del tramo, y después quedan todavía unos treinta y cinco segundos hasta que
la zona cumple. Medido simulando la ruta entera: **un suceso por zona, siempre al
74 %, y ninguno pasado el tiempo de su zona**.

**Y cada zona se despide con una estructura, distinta según el sitio.** Se ve
emerger de la bruma mucho antes de llegar, no golpea, no se esquiva y no pide
nada: se pasa por dentro o por debajo. Lo único que hace es decir *este sitio se
acaba aquí*, y 400 m después aparece el distribuidor que cambia de zona. Antes
el tramo se terminaba sin ceremonia: aparecía el rótulo verde y ya estabas
eligiendo.

| Forma | Dónde | Qué es |
|---|---|---|
| Pirámide | Tikal | Se pasa **por dentro**: los cuerpos de abajo van partidos en dos para dejar el túnel, y de la altura del dintel para arriba son macizos y de lado a lado |
| Arco colonial | Esquipulas, Chichicastenango, Antigua | Dos pilares escalonados y un dintel con crestería |
| Boca de cueva | Semuc, Tajumulco, Todos Santos, Fuego | Dos macizos de roca girados y un dintel irregular |
| Muelle | Flores, Río Dulce, Monterrico, Atitlán | Postes de madera, travesaños y un cartel colgado |
| Paso elevado | Ciudad de Guatemala | Dos pilas de hormigón y un tablero con quitamiedos |

Las cinco van con los materiales tematizados de la región, así que además son de
caliza en Tikal, de adoquín en Antigua y de hormigón en la capital sin una sola
línea de más.

**Y en cada sitio se mueve algo que no te quiere matar.** Donde hay agua saltan
peces de un margen al otro, cruzando la calzada de un salto y entrando con su
chapoteo; donde hay cielo cruzan bandadas de tres aves batiendo alas por lo
alto. Y siempre caen motas del color del sitio. Un sitio en el que no se mueve
nada más que lo que te quiere matar no es un sitio, es un decorado. La regla que
los mantiene fuera del juego: **el pez cruza siempre por delante y a ras, y el
ave va a más de doce de altura**, así que ninguno comparte sitio con nada que
golpee y no hay forma de confundirlos con una amenaza. **Y cada bicho va del
color de su sitio**: las aves eran gris pizarra en las trece zonas, así que la
bandada de guacamayas de Petén y las gaviotas de Monterrico eran la misma
silueta oscura. El color es lo único que las separa a la distancia a la que se
ven.

### Un rótulo para cada cosa

El mismo rótulo servía para dos cosas que no se parecen en nada: *has llegado a
un sitio nuevo* y *está pasando algo aquí*. Y como el suceso de la zona salía
ocho veces por visita, el jugador veía **«Vuelo de camazotz / Tikal»** en verde
jade —exactamente igual que «Tikal / Petén»— y ocho veces por zona creía haber
cambiado de departamento. Ahora el suceso sale **en ocre y con la palabra
PELIGRO debajo** en vez del nombre del sitio: dos rótulos que no se confunden ni
de reojo. Y sale **una sola vez por zona**, que era la otra mitad del problema:
por muy bien pintado que esté un rótulo, uno que aparece cada minuto y medio
deja de significar nada.

### El panel de pruebas: `Ctrl` + `Shift` + `D`

No hay botón que lo llame ni pista de que exista. Con una zona cada tres
minutos, ir a ver cómo queda el muelle de Atitlán costaba media hora de partida
**y no morirse por el camino**, y un repaso visual zona por zona no se puede
hacer así: «juégalo otra vez a ver si esta vez llegas» no es una forma de
trabajar. Lleva:

| Botón | Qué hace |
|---|---|
| **Al suceso de la zona** | Deja el contador justo en el punto del clímax, para ver el suceso ya |
| **Al final de la zona** | Deja 900 unidades de zona: entra la estructura de despedida y el cruce de destino |
| **Zona siguiente** | Cambia de sitio sin pasar por el cruce |
| **Invulnerable** | Los golpes no hacen nada |
| **Ir despacio** | El mundo a un tercio, para poder mirar en vez de esquivar |
| **+1000 jade y 3 ángeles** | Para probar la tienda y las cuatro vueltas |

**«Al suceso» no dispara nada a mano: mueve el contador y deja que lo arme el
reparto de siempre.** Así lo que se ve probando es exactamente lo que va a ver
el jugador —con su ventana limpia, su cartel forzado y su hueco antes del
cruce— y no una versión de laboratorio que funcione sólo desde el botón.

Con el panel cerrado no cuesta ni una línea por frame: todo lo que hace está
detrás de banderas que nacen apagadas.

### Cuánto falta para cambiar de zona

Con un cruce cada veinte segundos, la pregunta que el
jugador se hace todo el rato es *«¿este cruce me saca de aquí?»*. Sin respuesta,
los diez cruces de una zona se leen todos igual y la única forma de
enterarse es tomar uno y ver qué pasa. **El minimapa lleva ahora dos barras
porque son dos relojes distintos**: la de arriba, en jade, dice cuándo toca
elegir camino; la de abajo, en ocre, cuándo esa elección te saca del
departamento, con el nombre del siguiente punto y los metros que faltan. Cumplido
el tiempo de la zona, el texto cambia a **«en el próximo cruce»** y se enciende:
es la única vez en toda la zona que elegir salida importa.

Y lo que cuenta no es *cuánto falta para que se cumpla el tiempo*, sino **las
unidades hasta el cruce concreto que cierra la zona**, que es el primero
posterior a que se cumpla. Con un detalle que costó un fallo: `nextCross` salta
a la siguiente en el mismo momento en que una se planta, así que durante las 247
unidades en las que el distribuidor viene de frente —justo cuando el dato
importa, porque es cuando hay que decidir carril— mirar sólo a `nextCross` se
saltaba el cruce que se tiene delante y anunciaba 1.250 unidades de más. El
rótulo decía «faltan 1 400» con el cambio de departamento a cuatro segundos.

**Las bifurcaciones.** Cada 1.150 m la calzada se parte de verdad, y no se abre:
**se desvía, a 45° clavados**. Desde la cola del divisor los dos ramales salen
en aspa y en 24 unidades ya están a 32 uno de otro, casi cuatro veces lo que
miden de ancho:

```
   ####            ####
     ####        ####        a 45 grados
       ####    ####
          ######
            ##               una sola, con el divisor
            ##
```

Los tres intentos anteriores repartían la separación a lo largo de 105 o 150
unidades, y eso da ángulos de 8° o 14°: una carretera que se dobla despacio, no
un cruce. **Un desvío se lee porque SALE**, y sale con un ángulo que se ve. Los
dos números están atados: con un `smoothstep` la pendiente máxima vale
`1,5 × separación / largo`, así que `largo = 1,5 × separación` da exactamente
pendiente 1 —la tangente de 45°— en el punto medio, y el perfil entra y sale con
pendiente cero, de modo que el desvío empalma con la recta sin un solo pico.

**Y al tomar uno, el mundo gira contigo.** El mundo se recoloca sobre la calzada
elegida, así que te pasa por debajo de los pies; sin nada más, un desvío
pronunciado se vería como la carretera cruzándosete en diagonal mientras sigues
mirando al frente —patinando de lado, no girando—. La cámara y el personaje giran
con la calzada, y entonces lo que se ve es lo correcto: tuerces, y el mundo entero
rota a tu alrededor. De paso resuelve lo otro: **el ramal descartado sale del
encuadre por el lado durante el giro**, en vez de quedarse en el centro de la
pantalla justo cuando deja de dibujarse. Y en las últimas unidades se hunde bajo
la explanada, porque la niebla cierra a 185 y a cien por delante un corte en seco
sí se ve.

**Son dos cosas distintas, alternándose:**

- **Distribuidor de destino.** Un pórtico con dos rótulos verdes: una salida
  lleva al **siguiente punto de la ruta** —con su nombre y su departamento,
  como una señal de la CA-9— y la otra es el **retorno**, que deja donde
  estabas. Se decide leyendo, y qué lado es cuál se sortea cada vez. Avanzar
  paga en jade y en paisaje; el retorno no paga nada y cuesta 780 m.
- **Bifurcación cortada.** Sin pórtico. Un disco rojo de **prohibido virar**
  marca el ramal que está tapado por un derrumbe. Se decide mirando: acertar
  paga jade, meterse por ahí se acabó —y si revives, sales ya en el bueno—.
  **No mueve la ruta**: ni avanza ni retorna, es un obstáculo de la propia
  carretera dentro del mismo punto.

Iban mezcladas en el mismo cruce y eso las estropeaba a las dos: el disco rojo
se leía como una parte más de la señalización de destinos, y el rótulo verde
competía por la atención justo cuando lo único que importaba era no meterse por
un lado. **Alrededor de las dos hay 315 unidades sin absolutamente nada** —ni
obstáculos, ni rampas, ni enemigos, ni poderes—, porque lo que se pide ahí es
elegir, y un murciélago apareciendo a mitad de un cambio de carril no es
dificultad: es no dejar jugar.

**La meta.** Tomar el desvío a la capital no cierra la partida en ese mismo
frame: quedan 420 m de ciudad —sin cruces, sin nada que elegir— y ahí termina
la carrera con **¡LLEGASTE!** en vez de FIN. Es la única forma de acabar una
partida sin morir, y paga 40 de jade y 2.000 puntos de golpe: llegar tenía que
valer más que cualquier récord de distancia, o completar la ruta habría sido
solo dejar de correr.

**La calzada no es recta ni plana.** Gira, ondula y a partir de los 120 m
aparecen tramos elevados: uno de los cinco repartos alto/bajo entre los tres
carriles, cada carril alto con su rampa de subida y de bajada. Se sube por la
rampa del propio carril o saltando; por el costado no se pasa.

**Y algo viene de frente.** A partir de los 220 m entran amenazas que cierran
distancia por su cuenta en vez de dejarse arrastrar por el mundo: el
*camazotz*, el murciélago de Xibalbá, que vuela a la altura del pecho y se
esquiva agachándose; la *piedra rodante*, que solo se salta; la *vaca*, que
cruza al paso de un margen al otro; y la *camioneta*, que baja por su carril
de frente. Las dos últimas son **más altas que un salto a propósito**: la
respuesta a las dos es apartarse, y dejar que además se pudieran saltar
convertiría tres respuestas distintas en una sola.

**Las placas de impulso.** Turquesa, pegadas al suelo, hay que **pisarlas**
—saltándolas no cuentan—. Dan un empujón fuerte de dos segundos y medio, dejan
un **3 % de velocidad para siempre** hasta un tope del 30 %, y **cada tres
devuelven una vida**. Es la única forma de recuperar vidas corriendo, y está
atada a lo único del juego que hay que salir a buscar: la placa no te la
encuentras, te desvías a pisarla.

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

- **La franja**, en el menú y en la pantalla de fin: la carta, Instagram,
  Facebook, TikTok y el canal de Shorts, más una **tira apaisada** que rota
  entre seis. Son momentos en los que el jugador ya
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
- **Un desvío a 45° obliga a enderezar las losas.** La calzada se dibuja como
  cajas alineadas con los ejes del mundo, desplazadas lateralmente según el
  trazado. Con desplazamientos suaves eso no se nota; con uno de metro por metro
  sale **una escalera de bloques solapados con el bordillo en zigzag**. Así que
  cada losa se gira con la pendiente del ramal, las celdas y los bordillos se
  corren por la PERPENDICULAR al trazado en vez de por la x del mundo, y el paso
  se estira `√(1+m²)` para que sigan juntándose. En recta la transformación es la
  identidad y no cuesta nada.
- **La elección se convierte en una curva con un solo término.** Cada ramal se
  dibuja a `ramal × S(s) − elegido × S(D)`: el primer sumando abre los dos por
  igual a partir del divisor —la Y simétrica, las dos opciones sobre la mesa— y
  el segundo resta la separación del ramal elegido **medida en la posición del
  jugador**. Eso recoloca el mundo sobre esa calzada: a su altura los dos
  términos se cancelan y le pasa por debajo de los pies, pero por delante se va
  abriendo, así que se ve torcer. Y el ramal descartado, que tiene el signo
  contrario en los dos sumandos, hace la curva simétrica hacia el otro lado. Un
  intento intermedio dibujaba el ramal apuntado **recto** y empujaba al otro
  fuera de plano con un término de fuerza bruta; se leía como que el camino
  descartado se evaporaba en mitad del aire.
- **Y el salto de ese término al elegir sale gratis.** Encenderlo en seco
  movería la calzada tres unidades de golpe… salvo que la bifurcación empiece
  justo donde la salida se resuelve. Empieza en la **cola del divisor**, que es
  exactamente el punto en el que la isleta deja atrás al jugador, y ahí `S(D)`
  todavía vale cero.
- **El carril que mata se pinta, no se tiñe.** El primer intento fue teñir de
  rojo las piedras del firme que cayeran en ese carril, y no vale: el despiece
  cambia por zona y en Tikal la losa es **una sola pieza de lado a lado**
  —medido, `cuts = 1`—, así que no hay ninguna celda que coincida con un carril
  y la marca no salía en la mitad del recorrido. Es una franja propia por
  encima del firme, como una pintura de carretera, que mide lo mismo en las
  doce zonas. Va tres centímetros por encima de la cara de la losa y nunca al
  ras: dos caras en el mismo plano pelean por el píxel y la franja parpadea.
  El bordillo de ese lado se tiñe también, porque a cien unidades la calzada
  mide cuatro píxeles de ancho y lo único que se distingue es su borde.
- **Y late.** Un rojo fijo se lee como parte del decorado de la zona; latiendo
  se lee como un aviso, que es lo que es.

- **El rojo va por FUERA de la curva.** La primera versión pintaba el carril
  de dentro, que es justo el seguro. Lo que saca al jugador de la carretera no
  es la curva: es la inercia, y la inercia empuja hacia el lado contrario al
  que cierra el trazado. Con el rojo por dentro la marca enseñaba a quedarse
  exactamente donde mata. El cartel sigue en el lado hacia el que gira la
  calzada, porque un cartel de curva dice para dónde va la carretera —es lo
  que dice en todas las carreteras—; quien avisa de dónde no hay que estar es
  el suelo.

- **El firme que se hunde se dibuja en tres tablas, no con el despiece de la
  zona.** Para tirar un tercio de la calzada hace falta que haya un tercio que
  tirar, y el despiece no lo garantiza: en Tikal la losa es una pieza única de
  lado a lado —el mismo `cuts = 1` que tumbó el primer intento del carril
  rojo—, así que ninguna celda coincide con un carril. Dentro del tramo la
  calzada se pinta en tres tablas iguales y cada una cae por su cuenta. La
  sub-base se quita entera: es una pieza de lado a lado y taparía el agujero
  desde abajo.

- **Se cae al cuadrado y volcando.** Bajar lineal y a plomo se leía como una
  plataforma de ascensor. Con la aceleración al cuadrado y un vuelco hacia
  fuera se lee como lo que es: un suelo que se rompe.

- **El desplome es de cada tabla, no del tramo, y se mide en metros.** Antes
  había un reloj único: en cuanto el jugador entraba en el radio, las 34
  unidades enteras se caían a la vez en medio segundo. El resultado medido era
  que para cuando llegabas el agujero llevaba abierto y **quieto** un buen
  rato, y lo único que quedaba por ver era el hueco. Ahora cada tabla empieza a
  hundirse cuando el jugador está a 46 unidades **de ella**, así que la rotura
  viene hacia él en oleada y el firme se sigue partiendo a pocos metros de sus
  pies hasta el último momento. Y en unidades y no en segundos, de modo que la
  oleada se ve igual a cualquier velocidad. Lo que separa el obstáculo de la
  trampa sigue siendo la marca roja, que aparece mucho antes.

- **Las sacudidas pequeñas no eran suaves: eran nada.** La sacudida entra **al
  cuadrado** (`g = shake * shake`) para que el primer instante sea el que se
  nota, y eso significa que la escala no es lineal ni por asomo: un golpe de
  verdad vale 1,05, pero con el 0,3 que tenía la roca del derrumbe el
  desplazamiento de cámara salía de **cinco centésimas de unidad**, que a
  catorce unidades de distancia no se ve. Todo lo que quiera sentirse tiene que
  estar por encima de 0,4. Tres valores, y no uno, porque no dicen lo mismo:
  **0,40** de retumbo mientras las rocas caen por el aire —el aviso: algo viene
  y todavía no ha llegado—, **0,90** en el impacto contra la calzada y **0,42**
  sostenido mientras el firme se rompe por delante. Ese último va bajo a
  propósito: lo provoca el propio jugador al acercarse, y un golpe ahí se leería
  como que ya le ha pasado algo.
- **Y el impacto de la roca se escala con lo cerca que cae** (nunca por debajo
  del retumbo: una piedra lejana golpea flojo, pero golpea). Antes una que
  tocaba suelo en el horizonte movía la cámara exactamente igual que una que
  caía al lado, y eso no se lee como peso, se lee como una avería.

- **La curva late y el hundimiento parpadea.** El mismo material sirve a los
  dos —no coinciden nunca, `trackBusy` no deja armar un tramo con otro puesto—
  pero no dicen lo mismo. El latido de la curva es un aviso que dura todo el
  tramo; el parpadeo cuadrado del hundimiento es una cuenta atrás.

- **En el carril que se salva solo puede haber lo que se libra con el cuerpo.**
  Una estela ahí sería muerte segura: solo se esquiva cambiándose de carril, y
  los otros dos son agujero. El tramo se arma con su propio obstáculo —viga o
  sumidero— y con su propio jade, y `enHundido` cierra la puerta a todo lo
  demás. También se niega a armarse si hay un tramo elevado cerca: su tablero
  cruzaría por encima del agujero y el jugador lo pasaría andando por el aire.

- **Los dos ramales se pisaban, y no había perfil que lo arreglase.** La
  separación de la bifurcación vale cero donde nace y crece hacia el fondo, que
  es lo que hace que se vea abrirse. Pero eso significa que durante las primeras
  decenas de unidades las dos calzadas de 8,4 de ancho tienen los centros a
  menos de lo que miden: **una encima de la otra**, peleándose por el píxel. Lo
  que se veía no eran dos caminos, era una mancha con cuatro bordillos dentro.
  Se atacó por tres sitios a la vez: el reparto **arranca deprisa** en vez de
  con un `smoothstep`, que sale plano; la bifurcación empieza en la **cola del
  divisor** y no en su centro, así que mientras el muro está ahí la calzada es
  una sola; y el ramal secundario **se recorta contra el bordillo del
  principal**, con 2,2 unidades de aire, de modo que nace como una franja
  pegada al borde y crece hacia fuera según se abren. No se pisan nunca.

- **Y por eso el ramal descartado lleva adoquín propio.** Cuesta 1.260 matrices
  por frame en vez de 240, y antes iba con losa lisa a propósito. Pero la
  calzada detallada tiene que ser **siempre la que pisa el jugador**, y cuál es
  esa se decide por su carril hasta el último momento, así que las dos mallas se
  intercambian si cambia de idea en la aproximación. El relevo se hace en seco
  porque antes del divisor los dos ramales son simétricos y cada malla acaba
  exactamente donde estaba la otra; con una lisa y otra empedrada, en cambio, se
  veía como un parpadeo de toda la carretera.
- **La cuneta va con su calzada, y se aparta del otro ramal.** El matorral se
  posicionaba solo con la curva de siempre, así que en la bifurcación se quedaba
  en el eje del cruce mientras la calzada elegida se abría: el jugador corría
  por una carretera que se separaba de sus propios árboles. Al engancharlo al
  ramal bueno apareció el problema contrario —pinos creciendo en mitad del
  asfalto del camino que no habías tomado—, así que las matas que caen encima
  del otro ramal se apagan. Lo que queda ENTRE los dos sí se deja: una cuña de
  monte entre dos carreteras que se separan es justo lo que hay en una
  bifurcación de verdad.
- **El ramal que se va se apaga por dónde está, no por un reloj.** Se apagaba
  medio segundo después de elegir, y eso lo hacía desaparecer en el aire a mitad
  de su curva. Ahora se recorta contra el encuadre, y el límite **se abre con la
  distancia**: a la altura del jugador se sale de plano a doce unidades, pero a
  ciento cincuenta por delante esas mismas veintiséis se siguen viendo
  perfectamente, que es justo la parte que hay que ver marcharse.

- **Los poderes se llevan puestos.** El HUD ya dice cuál está activo, pero
  mirarlo cuesta el medio segundo que no hay. El escudo es una burbuja —es el
  único poder sin reloj, así que es el único que puede permitirse una forma
  cerrada y quieta— y los demás son un puñado de chispas del color del poder.
  Cuelgan de `playerGroup` y no de `playerBody`: el cuerpo se tumba y se estira
  al deslizarse, y una burbuja aplastada en un óvalo no se lee como escudo.

- **Y cada poder mueve las chispas de otra manera.** El color solo no basta: a
  esta velocidad dos naranjas parecidos son el mismo naranja. El imán las trae
  en anillo cerrado y bajo, el jade doble las sube en espiral, el ámbar las
  deja atrás como un rastro y el vuelo las manda arriba dando vueltas deprisa.
  La forma se lee de un vistazo; el color, no siempre.

- **El golpe se ve y se siente.** Viñeta roja a pantalla completa que entra
  llena y se despeja al cuadrado en cuatro décimas —una pantalla teñida durante
  todo el margen de invulnerabilidad taparía la calzada justo cuando hay que
  reaccionar al siguiente obstáculo— más una sacudida de cámara con alabeo. La
  sacudida mezcla una vertical a frecuencia fija con una horizontal al azar:
  el azar puro se lee como ruido, la mezcla se lee como un impacto. Perder una
  vida y perder el escudo se acusan **distinto** —rojo fuerte contra ámbar
  suave— para poder distinguirlos sin mirar el HUD, que es justo lo que no hay
  tiempo de hacer.

- **La explanada tapaba la bajada, y ese era todo el misterio.** El suelo es un
  único plano liso clavado a y = −1,02, y la calzada se hunde quince unidades:
  a sesenta por delante el firme ya iba ocho por DEBAJO del plano, así que lo
  que se veía en la cuesta no era una cuesta, era el plano tapando la calzada,
  los obstáculos y todo lo demás. Ahora se inclina con la pendiente. Se despeja
  el ángulo en cinco puntos repartidos hasta donde llega la bruma y se toma el
  más exigente: con una sola tangente quedaban dos puntos con la calzada por
  debajo del plano, porque el perfil de la cuesta no es una recta.
- **El firme cambia de departamento en la propia bifurcación.** Con la ruta
  quieta entre cruces ya no hay una línea que se mueva sola, así que al tomar la
  salida se apunta una coordenada de trazado sesenta unidades por delante —justo
  donde los dos ramales acaban de abrirse— y de ahí en adelante la calzada ya es
  la del sitio nuevo. Se ve venir el adoquín.
- **La barra del minimapa mide otra cosa.** Medía el avance dentro del
  departamento; con la ruta quieta eso no existe, así que ahora mide lo que
  falta para el próximo cruce, que es lo único que puede cambiarlo. Y en el
  último tramo, lo que falta para la meta.
- **Los caminos del minimapa se dibujan una vez y se encienden por clase.** Un
  `<line>` por cada par de puntos consecutivos, discontinuos de salida y
  continuos en cuanto se recorren. Los puntos recuerdan lo alcanzado alguna vez
  —son el mapa de lo descubierto y se guardan— pero el trazo dice por dónde va
  uno **en esta carrera**, así que se repinta solo cuando cambia el índice, no
  cada frame.
- **Se quitó elegir por dónde salir.** El taller vendía el punto de salida y
  eso rompía lo único que el mapa tenía que decir: cuánto te falta para la
  capital. La pestaña Ruta se quedó como itinerario de solo lectura.

- **El cartel de curva se dibuja una vez y se voltea.** Está dibujado torciendo
  a la derecha, y para el margen izquierdo se invierte el plano. La primera
  versión miraba el parámetro `side` en vez del lado ya sorteado —que para la
  curva se decide DENTRO de `spawnWarn`, y llega como `null`—, así que el espejo
  no se aplicaba nunca: un cartel plantado a la izquierda dibujaba una flecha
  torciendo a la derecha. Una señal que dice lo contrario de lo que va a pasar
  es peor que ninguna señal.
- **Fuera el ceda el paso.** No anunciaba nada que el jugador pudiera hacer —no
  hay a quién ceder el paso— y su triángulo rojo y blanco se confundía de lejos
  con el disco rojo de prohibido virar, que sí dice algo y muy concreto. Una
  señal que no significa nada no es neutra: le quita crédito a las que sí.

- **Con una probabilidad no se reparte nada.** Los tramos especiales —bajada,
  curva cerrada, estrechamiento— se armaban con un sorteo al 9 % por compás y
  con un bloqueo grosero: bastaba que hubiera una bifurcación activa para
  descartar el armado, cuando el tramo armado no empieza hasta 215 unidades
  después. Medido, salía **uno cada dos mil metros** y una partida normal no
  veía ninguno. Ahora la comprobación es de VENTANAS —¿se solapa el tramo que
  saldría con la zona limpia de alguna bifurcación?— y el reparto es firme: uno
  por ciclo, sin repetir el anterior. Medido: **1,3 tramos por km**, y las
  bifurcaciones alternando destino/cortada sin fallar una.
- **Y CUÁNDO se arma también hubo que medirlo, y a la primera salió mal.** El
  turno estaba puesto a ojo a 1.350 m de entrar en la zona. Simulado el reparto
  completo, los trece sucesos caían **una zona tarde**: el de Tikal se
  programaba en 1.399–1.779 y Tikal se acaba en 1.197, así que el vuelo de
  camazotz sonaba ya en Flores con el rótulo de Tikal puesto. Cada zona dura
  1.900 y solo tiene dos huecos limpios entre bifurcaciones —`(+129, +845)` y
  `(+1079, +1795)`—; el suceso ocupa 380 más 90 de margen y se arma 215 por
  delante, así que cae dentro del segundo hueco y con margen por los dos lados.
  Tikal es aparte: no se entra por un cruce, dura menos y solo tiene un hueco,
  así que su turno va a **+200**.
- **Tres cosas más que hacían falta para que saliera de verdad.** El suceso se
  arma **antes** que los tramos especiales y los aparta 400 m mientras espera su
  turno —de tramos salen varios por zona y de suceso hay uno, y medido, el
  primer tramo de la partida ocupaba la única ventana que le quedaba al de
  Tikal—; y si aun así no cabe entero antes del próximo cruce, **renuncia** en
  vez de armarse tarde. Verificado simulando 26 km: 13 de 13, cada uno dentro de
  su zona.
- **Y aun con el reparto arreglado, el suceso seguía sin verse.** Cargado
  `arcade.js` en un arnés con THREE y el DOM apuntalados, el sistema hacía
  exactamente lo que tenía que hacer: armaba en D=224, sonaba el rótulo en 416,
  soltaba sus piezas. El fallo era de **diseño**, no de código: en Tikal el
  suceso son murciélagos —los mismos que ya salen sueltos—, repartidos más
  espaciados que el ruido de fondo, con un tinte verde oscuro sobre una escena ya
  verde. Todo ocurría. No había nada que ver. De ahí las oleadas, los tintes
  reelegidos para contrastar con su región y el tinte aplicado a las cuatro
  luces en vez de a dos.
- **Y el hito de distancia hubo que reescalarlo con la ruta.** Uno cada 250 m
  estaba bien para carreras de uno o dos kilómetros; con la ruta en 600 y pico
  son **2.500 fanfarrias por partida**, una cada cuatro segundos durante dos
  horas y media. A 2.000 sale una cada medio minuto, que sigue siendo un hito y
  no un tic.
- **El tinte se pisaba a sí mismo.** Iba entre el sol y el hemisférico, así que
  la línea siguiente —`hemiLight.color.copy(...)`— le borraba la mitad del
  trabajo. Ahora va después de las cuatro luces.
- **La cadencia del suceso de zona está medida en tiempo, no elegida a ojo.** El
  hueco entre piezas es `ZONE_LEN / n` unidades, y a la velocidad de crucero de
  esa zona tiene que dar entre seis décimas y segundo y medio. Los primeros
  números que escribí daban **un autobús de frente cada media décima** en la
  capital, que no es difícil: es imposible.
- **Y el carril libre no desaparece nunca: se MUEVE.** La primera versión lo
  quitaba del todo en las últimas zonas, y eso tampoco es dificultad —con una
  bomba cada seis décimas en un carril al azar de tres, sobrevivir pasa a ser
  cuestión de suerte y morir deja de ser culpa de nadie—. Moviendo el hueco cada
  dos piezas en vez de cada cinco se pide exactamente lo mismo (no parar de leer
  y no parar de moverse) pero siempre hay una respuesta correcta. **El jade va
  por el carril libre**, que además de premiar enseña por dónde se pasa.
- **Dentro del suceso no entra el reparto normal.** Solo jade. La erupción caía
  encima de la tanda de obstáculos de siempre, y lo que salía no era un suceso:
  era ruido.
- **Y hubo que dibujar un rombo nuevo para el viento.** Era el único patrón para
  el que no había señal que no mintiera; el apaño inicial usó el de curva, que
  dice que la calzada va a torcer, y no tuerce: lo que se mueve es el jugador.
  Una señal que dice lo contrario de lo que pasa es peor que ninguna señal.
- **Y la misma lección hubo que aprenderla otra vez con los enemigos
  anunciados.** El derrumbe, el ganado y la camioneta salían de un dado al 22 %
  por compás, con la mitad de los compases descartados por la zona limpia de la
  bifurcación **y** con el cartel racionado además por su cuenta. Medido en una
  ruta entera: varios de ellos no salían ni una sola vez. Ahora se reparten por
  turnos, uno cada 240 m en cuanto haya sitio y sin repetir el anterior, y el
  turno **no se gasta si el cartel no llegó a plantarse**.
- **El racionamiento de señales es solo entre las de ambiente.** Las forzadas
  —las dos Y de cada bifurcación, los dos discos de la cortada, el cartel de
  cada tramo especial— ya no reinician el reloj de los 95 m. Lo reiniciaban, y
  como son unas cuantas y van seguidas, los sucesos anunciados se quedaban sin
  plantar una y otra vez: esa era la otra mitad de por qué no aparecían.
- **Y para eso hubo que separar las bifurcaciones: 620 → 780 → 950 → 1.150.**
  Entre una y la siguiente tienen que caber las dos zonas limpias más un tramo
  especial entero con sus márgenes; con 620 no cabía, el hueco libre era de poco
  más de cien unidades y casi nunca coincidía con un compás. Los saltos
  posteriores son por otra razón: los cruces alternan destino y cortada, así que
  solo uno de cada dos cambia de sitio, y con 780 se pasaba de departamento cada
  1.560 m —menos de treinta segundos por lugar—. Un sitio que se abandona antes
  de haberlo mirado no es un sitio, es un color. Con 1.150 cada punto de la ruta
  dura 2.300 y le caben el suceso de zona **y** su despedida.
- **La zona limpia se calcula por delante, no cuando el cruce ya existe.** Un
  compás suelta cosas que no llegan al jugador hasta 170 unidades después, así
  que para cuando el cruce nace ya sería tarde para no ponerlas: la posición de
  la próxima bifurcación se deduce de `nextCross`, que se conoce con 780
  unidades de antelación. Y la comprobación va **la primera** de la función:
  estaba al final, veinte líneas por debajo de donde se generan los enemigos,
  así que se colaban dentro.
- **Los tramos elevados necesitan su propio margen.** Miden hasta 72 unidades de
  la boca a la cola, así que uno que nazca justo antes de la bifurcación sigue
  pasando por debajo del jugador cuando este ya está eligiendo. Era el 5 % de
  muestras sucias que quedaba.

- **La flecha de la placa de impulso apuntaba hacia atrás.** Las dos barras se
  abrían hacia delante y el vértice quedaba detrás: la placa que empuja hacia
  delante dibujaba una flecha señalando el sentido contrario. Un signo.
- **Recoger el vuelo del quetzal se pisaba a sí mismo.** `spawnSkyTrail` siembra
  veintidós jades llamando a `spawnPickup`, y `spawnPickup` con el pool lleno
  recicla el primer hueco libre… que es justo la pieza que se está recogiendo,
  marcada inactiva una línea antes. A partir de ahí `p.kind` valía `'jade'` y la
  última línea de `collect` reventaba buscando el color de un poder inexistente.
  Se copian los datos de la pieza al entrar y no hay forma de que vuelva a
  pasar. Estaba ahí desde que existe el rastro del quetzal.

- **El ramal que no se toma se marcha, no se queda.** Elegido uno, al otro se
  le multiplica la separación durante poco más de un segundo y luego se deja de
  dibujar. Como la separación vale cero en la X y crece hacia el fondo,
  multiplicarla entera hace que el ramal PIVOTE sobre el cruce: se ve curvarse y
  perderse. Dejando los dos ahí, abiertos y paralelos, no había forma de saber
  cuál era el tuyo —que era exactamente la queja—.
- **El ramal se fija incluso si se salta el divisor por arriba.** Es lo que
  hace que el otro se aparte y se pierda de vista; sin fijarlo los dos se
  quedarían abiertos y paralelos hasta que la bifurcación caduca. Quien salta
  el divisor cae en el ramal izquierdo.
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
  por qué lado quedó, y el suceso ocurre justo por ahí. Una señal de derrumbe a
  la derecha con las piedras cayendo por la izquierda es peor que no ponerla,
  porque enseña a no fiarse.
- **Y lo que anuncia no nace con ella: se programa unos metros más tarde.** La
  señal se planta 34 unidades por delante del compás, así que llega antes… pero
  la camioneta viene DE FRENTE y cierra distancia al doble de velocidad que el
  mundo: naciendo a la vez, adelantaba a su propio aviso. Hay una cola de
  eventos por distancia (`pending`) y cada suceso se apunta con el adelanto que
  le corresponde según lo deprisa que se acerque.
- **Una señal que no anuncia nada envenena a las demás.** Antes la de curva se
  plantaba cuando el serpenteo de siempre movía la calzada un poco; ahora abre
  una curva propia. Y el murciélago y la piedra sueltos van SIN cartel: si cada
  uno llevase el suyo, el margen sería un pasillo de rombos y los que anuncian
  algo gordo dejarían de mirarse. Las de ambiente salen al 7 % por compás por
  la misma razón.
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
  curva es una raíz —sube donde se nota y se va aplanando—: se sale a **23** y
  van 32 a los 100 m, 43 a los 500, 51 a los 1000 y el techo de 68 hacia los
  2600. Antes se salía a 15 y se subía a 6,2: los primeros doscientos metros
  eran un paseo por un sitio bonito y con la ruta entera midiendo casi veinte
  kilómetros, llegar al tercero con margen de sobra para pensar no era llegar
  lejos, era esperar.
- **Y hay DOS techos, que son cosas distintas.** El de reparto (68) es hasta
  dónde llega la velocidad por haber recorrido distancia; los impulsos lo pasan
  a propósito, porque esa es justamente su gracia. El absoluto (120) va después
  de todos los multiplicadores y es de seguridad pura: a un paso fijo de 1/60 el
  mundo avanza `speed/60` y la ventana de colisión mide 2,2 de fondo, así que
  por encima de 132 un obstáculo se cuela entre dos pasos sin que nadie lo
  compruebe. Con el reparto en 52 el peor caso encadenado —placas al máximo por
  impulso por curva— se quedaba en 127 por los pelos; subirlo a 60 lo llevaba a
  147, y eso no es un juego más difícil, es un obstáculo atravesado.
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
  arriba, pero entonces no se ha elegido nada, y avanzar de punto por ello
  sería pagar por no decidir. El ramal sí se fija —a la izquierda— o los dos se
  quedarían abiertos y paralelos hasta que la bifurcación caduca.
- **`roadRegionOf` también suma `regionShift`.** Sin eso, al tomar la salida de
  cambio el cielo y la vegetación saltaban al departamento nuevo y la calzada se
  quedaba con el adoquín del anterior.
- **Deslizarse no es agacharse, es tirarse de barriga.** El cuerpo se tumba a
  85° —cinco grados de horizontal—, baja hasta rozar la calzada y estira **los
  dos brazos** hacia delante, con la cabeza compensando la inclinación entera
  para seguir mirando al frente. Las dos versiones anteriores fallaban por lo
  mismo: achatar la figura en el sitio se leía como alguien en cuclillas, y
  tumbarla a 64° con un brazo estirado y otro recogido, como una caída. Una
  postura de la que uno se puede levantar no dice «me estoy deslizando».

- **Una cuesta con perfil de seno es un hoyo, no una bajada.** El seno sube y
  vuelve, así que por delante se abría un socavón de trece unidades y por
  detrás se cerraba solo: el camino desaparecía del encuadre justo al entrar.
  Ahora el perfil es una S que **sube a uno y se queda ahí** —se baja y uno se
  queda abajo, como en una carretera— y lo que mueve la velocidad y el cabeceo
  de la cámara es la *derivada*, que sí es una campana y sí vuelve a cero.
- **Y una curva con perfil de seno es una ese.** Medido: la calzada a 150
  unidades se iba treinta a la derecha y luego cuarenta a la izquierda, o sea
  que el cartel de «curva a la derecha» acababa anunciando una a la izquierda.
  Misma corrección: el desplazamiento cierra hacia el lado del cartel y **se
  queda ahí**. Sale gratis porque todo se mide restando el desplazamiento del
  propio jugador, así que quedarse desviado no desvía nada.
- **La curva se veía, pero no se sentía en ninguna parte.** Movía el trazado y
  subía la velocidad, y el encuadre seguía tan recto como en una recta. Ahora
  lleva **peralte**: la cámara se tumba 17° hacia dentro del giro y además
  deriva dos unidades hacia fuera, que es lo que hace la inercia. Diecisiete
  grados serían una barbaridad en primera persona; aquí, donde lo único que se
  ve del jugador es su espalda y la calzada ya se está yendo de lado, es lo que
  hace que la curva se note en el cuerpo. Con ocho no se notaba. El alabeo de la calzada de
  siempre no servía aquí —va por la máscara de distancia, que vale cero dentro
  de 158 unidades, y el punto de mira de la cámara está mucho más cerca que
  eso—, así que el peralte sale de `turnGrip`, que es una campana y devuelve la
  cámara a la horizontal al salir sin tener que apagar nada.
- **Y la curva duraba menos que el gesto de tomarla.** 165 unidades son dos
  segundos y medio a velocidad de crucero: se acababa antes de que el jugador
  terminara de colocarse por dentro, así que no se aguantaba una línea, se daba
  un volantazo. Ahora mide 225, cierra 60 en vez de 46 —repartir el mismo
  desplazamiento en más unidades habría sido alargarla abriéndola, que es lo
  contrario— y en el punto cerrado se corre un 30 % más en vez de un 16 %: lo
  que aprieta contra el borde de fuera es la velocidad, así que subirla es
  subir la curva entera.

- **Los tres tramos que cambian la calzada se arman 215 unidades por delante.**
  La calzada llega a 204 y los compases nacen a 170. Armar dentro de eso hacía
  dos destrozos a la vez: el tramo ya visible daba un tirón delante de los ojos,
  y los objetos que ya estaban puestos —que guardan su altura al nacer— se
  quedaban flotando mientras el suelo se movía bajo ellos. Armando a 215 no hay
  nada que corregir: cuando el tramo llega, ya nació con el cambio dentro.
  Medido: al armar, el desplazamiento a 60 y a 150 unidades es 0,01.
- **Apagar la bajada sí necesita corrección, apagar la curva no.** La curva
  entra por `(o.curve - curveBase) * mask`: es una resta, y al apagarla los dos
  términos caen a cero a la vez. La bajada va sin máscara —si se enmascarase
  cerca, la cuesta arrancaría a diez metros de los pies y se vería el escalón—,
  así que al apagarla hay que devolverles las quince unidades a todo lo vivo.
  Se espera a que TODO haya pasado la cuesta, y entonces la corrección es la
  misma para todos y no se mueve nada. Medido: cero salto al apagarla.
- **Dentro de una cuesta o una curva solo entran enemigos.** Un obstáculo del
  suelo no se ve venir cuando la calzada se va hacia abajo o hacia un lado, y un
  tramo elevado ni siquiera se apoyaría bien. Dentro del estrechamiento no entra
  nada: es un carril, y pedir dos cosas a la vez donde menos margen hay no es
  dificultad, es una encerrona.

- **Salirse de la carretera no es un golpe.** El estrechamiento y la curva
  cerrada no te quitan una vida: te quedas donde ya no hay calzada y te caes. Por
  eso ignoran el escudo —un escudo no pone suelo donde no lo hay— y por eso se
  ve al personaje caer dando vueltas antes de que termine. Sin esa caída, morir
  ahí se leería como un fallo del juego y no como uno propio, que es justo lo
  que hay que evitar cuando algo mata de golpe.
- **Y morir de un golpe tampoco cierra la partida en el mismo frame.** Se
  perdía la última vida y el menú de fin aparecía instantáneamente: no había
  forma de ver contra qué te habías chocado, y la carrera se cerraba como si el
  juego se hubiera cortado en vez de como si te hubieras matado. Ahora el cuerpo
  sale despedido **hacia la cámara** y hacia arriba, da vueltas y rebota en la
  calzada —hay suelo, a diferencia de la caída: hundirse en el firme se leería
  como un fallo de colisión— durante segundo y medio. Cae con la gravedad al
  70 %, porque lo que hay que ver es el vuelo y no el aterrizaje.
- **Y el mundo frena hasta pararse mientras dura.** Seguir corriendo a toda
  velocidad mientras el cuerpo da vueltas por el aire se leía como que el juego
  continuaba sin el jugador. Frenando, la carrera se acaba **donde** se acaba.
- **Volver también tiene su animación, y es la caída del revés.** Morir la tenía
  desde hace dos versiones; volver, no: se cerraba el panel y el corredor
  aparecía de golpe corriendo, como si no hubiera pasado nada. Eso hacía que
  revivir se leyese como un menú y no como un suceso, y con cuatro vueltas por
  carrera es algo que se ve cuatro veces. Ahora el cuerpo **baja desde quince
  unidades de altura girando sobre sí mismo dentro de una columna de luz**, que
  se estrecha y se apaga conforme baja, con plumas doradas cayendo con él y un
  golpe de polvo al tocar el suelo. La altura va con el cuadrado del reloj, así
  que la bajada frena sola al acercarse al suelo en vez de estrellarse contra
  él; durante ese segundo y medio no se controla nada, porque aceptar un cambio
  de carril ahí dejaría al corredor aterrizando de lado con la animación a
  medias. **Y el mundo arranca desde parado**, que es el frenado de la muerte
  aplicado del derecho: sin eso se volvía a la calzada a setenta por hora con la
  animación todavía en el aire y la vuelta no se veía, sólo se notaba que el
  paisaje ya iba disparado. El sonido del escudo suena **al tocar el suelo**, no
  al pulsar el botón: es cuando el jugador recupera el mando.
- **La columna de luz es un cubo con material aditivo y sin `depthWrite`.**
  Aditivo para que sume luz sobre lo que tenga detrás en vez de taparlo —que es
  lo que hace que se lea como luz y no como una caja amarilla— y sin escritura
  de profundidad para que no recorte al propio corredor cuando lo atraviesa.
- **La piedra que aún cae no golpea, y eso salió gratis.** La franja de daño se
  mide desde el ancla de la amenaza, y el ancla de una piedra en el aire va
  alta. Medido: caen desde y=30, 25 y 20 escalonadas y solo pegan al tocar.
- **La vaca cruza atada a la velocidad del mundo, no al reloj.** Así pasa
  siempre por el mismo punto vaya el jugador a la velocidad que vaya. Un
  obstáculo móvil que se pueda aprender es difícil; uno que no, es una lotería.
- **El ramal cortado devuelve al bueno al revivir.** Repetir la misma pared de
  piedras cinco segundos después no sería una segunda oportunidad, sería la
  misma muerte otra vez: `doRevive` vuelve a resolver la salida por el carril
  que tocaba. Medido: se entra por el ramal cortado, se muere, y al revivir el
  ramal es el contrario y el muro ya no está.
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
- **O comprando un ángel, que es la otra moneda.** Hasta ahora morir ofrecía
  *una* salida —el anuncio— y sólo una vez por carrera. En carreras de dos
  minutos bastaba; en una ruta de cuarenta minutos, morir en la zona once y que
  la única alternativa sea empezar otra vez desde Tikal no es dificultad, es
  tirar media hora. El **ángel de la guarda** se compra en el taller por 240 de
  jade, se llevan hasta tres, viaja en el zurrón entre carreras y se gasta al
  usarlo, así que **una carrera admite cuatro vueltas: tres compradas y una del
  patrocinador**. Y el jade deja de servir sólo para trajes.
- **El ángel NO pasa por el anuncio ni por el reloj.** Ése es exactamente el
  trato —el jade compra tu tiempo—, y si además pidiera el vídeo no sería nada.
  Por lo mismo, gastado el anuncio el panel deja de ser un anuncio: plantar otro
  vídeo de treinta segundos delante de alguien que ya lo vio esta carrera y que
  encima trae su propio ángel es cobrarle dos veces por lo mismo.
- **Es lo único de la tienda que se GASTA**, así que no cabe en la tabla de
  mejoras —donde el nivel sólo sube— y lleva su propio contador. Va en ocre en
  toda la tarjeta y **primero de la pestaña**: enterrado entre ocho mejoras
  permanentes no se encuentra, y es justo lo que se viene a comprar después de
  morir en la zona diez.
- **Rechazar cierra la carrera aunque queden ángeles.** El jugador acaba de
  decir que no quiere seguir; volver a preguntárselo con otro botón es insistir.
- **La cuenta atrás del anuncio corre por reloj propio**, no por el estado del
  reproductor: si un bloqueador tumba el iframe, el jugador revive igual.
  Cobrarle el fallo de otro sería injusto, y además le dejaría sin salida.
- **El vídeo arranca silenciado, y `mute=1` no es un descuido.** Chrome bloquea
  el arranque automático con sonido en un iframe de otro dominio salvo que el
  usuario tenga historial con YouTube, así que sin silenciar se quedaba parado
  en el fotograma de portada para buena parte de la gente. Ya que va a
  arrancar solo, mejor que se vea moviéndose; el aviso bajo el título dice
  dónde está el altavoz.
- **Uno de cada veinte anuncios lleva vídeo; los otros diecinueve son un
  cartel.** El vídeo pide un iframe a un tercero, arranca solo y tarda en
  cargar; el cartel es una imagen del propio origen y está puesta antes de que
  el jugador levante la vista. Un 5 % es bastante para que el canal siga
  apareciendo sin que revivir se convierta en un trámite. Medido sobre 600
  tiradas: 4,2 %.

- **El cartel va con `contain`, no con `cover`.** Los seis carteles son 9/16
  clavados y el hueco del panel también… salvo cuando `max-height: 46vh` lo
  achata, que es justo lo que pasa en un móvil apaisado. Con `cover` ahí se
  recortaban el logotipo de arriba y la dirección web de abajo, que son las dos
  cosas que un cartel tiene que decir. Prefiero dos franjas oscuras a los lados.

- **Y hubo que apagar a mano el texto de repuesto.** `.short-fallback` lleva
  `display: grid`, que gana al `display: none` del atributo `hidden`. Con el
  vídeo no se notaba —el iframe es opaco y lo tapaba entero—; con el cartel, el
  texto se colaba por las franjas de los lados.

- **Los banners solo en el menú y en el fin de partida**, nunca sobre el juego
  y nunca durante una partida. Y no en el panel de revivir: ahí ya hay un
  cartel a pantalla completa, y dos anuncios en la misma tarjeta es
  exactamente lo que hace que se cierre.

- **Se repintan en `refreshMenu`, no al arrancar.** Es el único sitio por el
  que se pasa siempre al volver al menú o al acabar una partida. Pintándolos
  una sola vez, el banner elegido era el mismo durante toda la sesión y la
  rotación no servía de nada. Verificado: los seis salen en 40 repintados.

- **Catorce megas de PNG no se sirven.** Los originales de los anuncios son
  941×1672 a dos megas cada uno. Reescalados a 720 de ancho (carteles) y 840
  (banners) y guardados en WebP quedan en **753 KB los doce**. Los originales
  se quedan en disco, ignorados por git, por si hay que volver a exportarlos.

- **La hoja de banners venía en una sola imagen** y se cortó midiendo los
  separadores, no a ojo: filas de color uniforme de lado a lado en
  310, 604, 897, 1190 y 1403. Cada tira conserva su propio alto —no todas
  miden lo mismo— y por eso el CSS no les impone `aspect-ratio`: forzarles una
  proporción común recortaría o estiraría la mitad.

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
