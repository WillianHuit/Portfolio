// ===========================================================================
// SACBE - easter egg del portafolio
// ===========================================================================
// Endless runner de estetica voxel que recorre Guatemala de norte a sur.
//
// Notas de implementacion que conviene no deshacer:
//
//  - Todo el escenario se dibuja con UNA sola BoxGeometry compartida. Los
//    elementos repetidos (losas de la calzada, bordillos, hitos del fondo)
//    van en InstancedMesh, asi que cada grupo cuesta una draw call en vez de
//    una por objeto.
//  - Los obstaculos y las recogidas se reciclan desde un pool: nada se crea
//    ni se destruye durante la partida, de modo que el recolector de basura
//    no provoca tirones.
//  - Los materiales de obstaculos y calzada son COMPARTIDOS. Antes cada uno
//    de los 26 obstaculos creaba sus siete materiales (mas de 180 en total);
//    ahora son seis, y ademas eso es lo que permite retematizar la escena
//    entera por region cambiando un punado de colores.
//  - El jugador no avanza: el mundo se mueve hacia el. Asi las colisiones se
//    reducen a comprobar la Z de cada objeto contra una franja fija.
//  - El bucle usa paso fijo acumulado, para que la dificultad no dependa de
//    los Hz del monitor.
//  - El paisaje del fondo no se cambia de golpe al pasar de departamento: se
//    INTERPOLA instancia a instancia entre la silueta saliente y la entrante.
//    Un cambio instantaneo se veia como un fallo de carga.
// ===========================================================================

import * as THREE from '../vendor/three.module.min.js';

// ===========================================================================
// Constantes de diseno
// ===========================================================================
const LANE_X = [-2.3, 0, 2.3];      // posicion de los tres carriles
const TILE_DEPTH = 4;               // profundidad de cada losa de la calzada
const TILE_COUNT = 60;              // cubre el rango visible con margen de giro
const ROAD_WIDTH = 8.4;
const ROAD_FROM = -204;             // z local de la primera losa

// La calzada alterna dos tonos, asi que su patron se repite cada dos losas.
// Aprovechandolo, el desplazamiento se resuelve moviendo un Group con un
// modulo en vez de recolocar 180 instancias en cada paso de simulacion.
const ROAD_PERIOD = TILE_DEPTH * 2;

// Los hitos del fondo tambien son periodicos: se define un tramo de
// LAND_PERIOD unidades y se repite, de modo que al reiniciar el modulo el
// horizonte encaja consigo mismo sin salto visible.
const LAND_PERIOD = 210;
const LAND_SPACING = 15;
const LAND_PER_CYCLE = LAND_PERIOD / LAND_SPACING;   // 14
const LAND_CYCLES = 3;                               // cubre lo visible
const LAND_TOTAL = LAND_PER_CYCLE * LAND_CYCLES;     // 42 hitos
const LAND_PARTS = 8;                                // cubos por hito

const SPEED_START = 15;
// Techo duro por seguridad, no por diseno: a un paso fijo de 1/60 el mundo
// avanza speed/60 por paso, y la ventana de colision mide 2,2 de fondo. Por
// encima de unos 66 los obstaculos empezarian a colarse entre dos pasos.
const SPEED_MAX = 52;

// La velocidad sube con la DISTANCIA RECORRIDA y no con el reloj. Con el reloj,
// quedarse quieto en el menu de pausa aceleraba igual, y sobre todo el que
// juega bien no notaba ninguna recompensa: llegaba al techo a los 32 segundos
// y de ahi no se movia. Ahora acelera el que avanza.
//
// La curva es una raiz: sube deprisa al principio, donde se nota, y se va
// aplanando, de modo que nunca hay un salto brusco. A los 100 m van 21, a los
// 500 m van 29, a los 1000 m van 35 y a los 3000 m se roza el techo.
const SPEED_GAIN = 6.2;

// El hueco entre compases se mide en SEGUNDOS, no en unidades. Con un hueco
// fijo en unidades, doblar la velocidad partia por la mitad el tiempo de
// reaccion y el juego se volvia imposible en vez de dificil. Asi lo que se
// estrecha es el margen, de un segundo y medio a menos de uno, y la
// dificultad la pone la velocidad y no un muro de obstaculos.
const GAP_TIME_START = 1.55;
const GAP_TIME_MIN = 0.92;
const GAP_TIME_OVER = 2500;         // metros en los que se cierra del todo

const GRAVITY = -58;
const FALL_GRAVITY = 1.32;          // la bajada pesa mas que la subida
const JUMP_V = 17.5;
const JUMP_CUT = 0.42;              // al soltar, se recorta lo que queda de subida
const DOUBLE_JUMP_V = 15.2;
const FAST_FALL_V = -36;            // picado al pulsar abajo en el aire
const SLIDE_TIME = 0.55;
const LANE_TIME = 0.13;             // segundos en completar un cambio de carril
const LAND_SQUASH = 0.16;           // duracion del aplastado al aterrizar

const PLAYER_Z = 0;                 // el jugador vive aqui; el mundo pasa
const SPAWN_Z = -170;               // donde aparecen los objetos
const DESPAWN_Z = 11;               // pasado esto se reciclan (la camara esta en 14)

const HIT_WINDOW = 1.1;             // media profundidad de colision en Z
// Media anchura de colision en X. Se compara contra la posicion REAL del
// jugador, no contra su indice de carril: el indice cambia de golpe al pulsar
// mientras el cuerpo aun se desplaza, y esa discrepancia producia esquivas
// fantasma y golpes injustos.
const LANE_HALF = 1.02;
const JADE_REACH = 1.5;             // el jade se recoge con mas margen

const INVULN_TIME = 1.4;            // margen tras recibir un golpe
const LANDING_GRACE = 0.8;          // margen al terminar el vuelo
const START_LIVES = 3;

const COYOTE_TIME = 0.09;           // salto valido justo despues de dejar suelo
const JUMP_BUFFER = 0.13;           // salto pulsado justo antes de aterrizar

// Cada 250 m y no cada 500: una partida corriente muere entre 300 y 400 m,
// asi que con 500 la mayoria de jugadores no llegaria a ver un solo hito.
const MILESTONE_EVERY = 250;
// Probando con un jugador activo, el maximo de jade en una carrera de 500 m
// era 4: con el umbral en 5 el multiplicador resultaba inalcanzable y la
// mecanica no existia en la practica. Con 3 se alcanza jugando bien.
const COMBO_STEP = 3;
const COMBO_MAX = 5;

const PARTICLE_POOL = 64;

// Metros por departamento. A 500 una partida decente cruza dos o tres, que
// es lo minimo para que el viaje se note; con los 900 del ciclo anterior la
// mayoria de partidas moria sin salir del primero.

// La transicion ocupa el ultimo 38 % del tramo: el resto se sostiene, para
// que cada departamento tenga identidad y no sea un degradado continuo.
const REGION_BLEND = 0.62;

// Celdas por losa de calzada. Dieciocho porque el adoquin de Antigua es de
// seis por tres; los tramos que usan menos dejan las sobrantes a escala cero.
const ROAD_CELLS = 18;
// Punto del tramo en el que la calzada cambia de material. Coincide con la
// mitad de la transicion de cielo y luces, de modo que el cambio de firme cae
// donde el resto del paisaje ya esta a medio camino.


// --- Capas de parallax ---------------------------------------------------
// Cuatro profundidades moviendose a velocidades distintas: matorral al borde
// de la calzada (1x), hitos (0.82x), sierra del fondo (0.22x) y cielo
// (0.05x). Con una sola capa el mundo se veia vacio y plano; con cuatro, la
// velocidad se lee sin necesidad de mirar el marcador.
const PROP_SLOTS = 44;              // 22 por lado
const PROP_PARTS = 3;
const PROP_SPACING = 10;
const PROP_PERIOD = PROP_SLOTS / 2 * PROP_SPACING;
const PROP_FROM = -220;

const RIDGE_COUNT = 34;
const RIDGE_PERIOD = 320;

const SKY_COUNT = 28;
const SKY_PERIOD = 460;

const OBSTACLE_POOL = 30;
// 96 y no 56: el rastro de jade del vuelo del quetzal siembra una veintena de
// piezas de golpe, y con el pool anterior se comia el recorrido de a pie.
const PICKUP_POOL = 96;
const PLATFORM_POOL = 9;            // tres tramos de terreno a la vez, como mucho
const BOOST_POOL = 8;

// --- Intersecciones -------------------------------------------------------
// Cada cierto tramo la calzada llega a un distribuidor vial: un rotulo verde
// colgado sobre la via anuncia las dos salidas y, mas adelante, una isleta
// central obliga a tomar una o la otra. Una devuelve al mismo departamento
// (RETORNO) y la otra lleva a uno nuevo (el CAMBIO).
//
// Cual esta a la izquierda y cual a la derecha se sortea cada vez. Si fuera
// siempre el mismo lado dejaria de ser una decision a los dos minutos: lo que
// se lee es el rotulo, no la costumbre.
// Metros entre bifurcaciones. Subio de 620 a 780 por sitio: entre una y la
// siguiente tienen que caber la zona limpia de las dos y ademas un tramo
// especial entero con sus margenes. Con 620 no cabia, y el resultado medido
// era que no salia ni una bajada ni una curva en dos mil metros.
const CROSS_EVERY = 780;
const CROSS_SIGN_AHEAD = 62;        // el rotulo, adelantado a la isleta
const CROSS_ISLAND_LEN = 22;
// A que coordenada de trazado cae la isleta cuando el cruce nace en SPAWN_Z.
// Se necesita ANTES de que el cruce exista para poder ir dejando limpio lo que
// viene, asi que se calcula en vez de leerse.
const CROSS_ISLAND_AT = -SPAWN_Z + CROSS_SIGN_AHEAD;      // 232

// Zona sin nada alrededor de la bifurcacion. Antes solo se despejaba el compas
// que cayera justo encima, y como los enemigos se generaban ANTES de esa
// comprobacion, se colaban dentro: aparecia un murcielago mientras el jugador
// cruzaba de carril para tomar una salida, sin sitio donde meterse. Ahora la
// zona se calcula por delante y no se genera nada cuyo destino caiga dentro.
const QUIET_PRE = 105;              // limpio antes de la isleta
const QUIET_POST = 105;             // ...y despues de que los ramales se abran

// --- La bifurcacion ------------------------------------------------------
// La version anterior resolvia el cruce con una isleta y ya: pasabas por un
// lado o por el otro y el paisaje cambiaba de golpe. No habia forma de saber
// que camino habias tomado, porque los dos eran el mismo camino.
//
// Ahora la calzada se parte de verdad. Desde la X salen DOS calzadas de tres
// carriles que se separan hacia los lados, y el mundo se recoloca sobre la que
// llevas puesta: el ramal que dejas se va abriendo hacia fuera hasta perderse.
// Es la separacion lo que dice por donde te fuiste, no un rotulo.
const FORK_SPREAD = 8.4;            // cuanto se separan los dos ramales
const FORK_LEN = 105;               // unidades en las que se abren
const FORK_CLEAR = 70;              // margen sin objetos alrededor de la X

// Cuanto tarda el paisaje en pasar de un departamento al otro al tomar el
// desvio. Antes se cambiaba de golpe, en un frame, y se leia como un fallo de
// carga; segundo y medio basta para que se entienda como que has cambiado de
// carretera y no de juego.
const SNAP_TIME = 1.6;

// --- Sistemas que se arman por delante -------------------------------------
// La bajada, la curva cerrada y el estrechamiento cambian la GEOMETRIA de la
// calzada en funcion de la coordenada de trazado. Los tres comparten un
// problema y una solucion.
//
// El problema: la calzada se recompone cada frame y ya lleva el cambio, pero
// los objetos guardan su desplazamiento del trazado UNA vez al aparecer. Si
// uno de estos sistemas se enciende afectando a un tramo que ya tiene objetos
// puestos, la calzada se mueve y ellos no: quedan flotando o enterrados. Y
// ademas el tramo ya visible da un tiron delante de los ojos.
//
// La solucion: armarlos SIEMPRE mas alla de lo que se ve y de donde se
// genera. La calzada llega a 204 unidades y los compases nacen a 170, asi que
// a 215 no hay nada que corregir: cuando el tramo llega, ya nacio con el
// cambio dentro. Es lo que hace que se entre y se salga sin que se note.
const ARM_AHEAD = 215;

// --- La bajada -------------------------------------------------------------
// La senal de pendiente peligrosa avisaba de una rampa y se quedaba ahi. Ahora
// anuncia una bajada de verdad: la calzada se hunde por delante, la camara
// cabecea y se corre mas durante un tramo. Es la unica de las senales cuyo
// aviso no es "ojo con eso" sino "prepara las manos".
const SLOPE_LEN = 150;              // largo de la bajada
const SLOPE_DROP = 15;              // cuanto baja la calzada en total
const SLOPE_SPEED = 1.2;            // lo que se gana en el punto mas empinado

// --- La curva cerrada ------------------------------------------------------
// La senal de curva anunciaba el serpenteo de siempre. Ahora abre una curva
// propia, mucho mas cerrada, hacia el lado en el que se planto el cartel. El
// tramo va limpio de obstaculos —solo entran los enemigos— y se corre mas: lo
// que hay que resolver ahi es la curva, no un obstaculo dentro de la curva.
const TURN_LEN = 165;               // largo de la curva
// Cuanto se desplaza el trazado. Parece mucho al lado de las 6,4 unidades del
// serpenteo de siempre, pero es que la mascara de distancia se come todo lo de
// dentro de 158 unidades: lo que llega a verse es la ultima franja de calzada,
// que en pantalla mide cuatro dedos. Con treinta la curva se leia como una
// carretera casi recta.
const TURN_AMP = 46;
const TURN_SPEED = 1.16;
// Segundos que se aguantan por el lado hacia el que cierra la curva antes de
// salirse. Es tiempo de sobra para cruzar los tres carriles dos veces: quien
// se sale es porque se quedo, no porque no le diera tiempo.
const TURN_HOLD = 1.9;

// --- El estrechamiento -----------------------------------------------------
// La senal ] [ dice que los tres carriles se vuelven uno. Los de los lados
// dejan de existir: no son un obstaculo que golpea, son un sitio donde ya no
// hay calzada, y quien siga ahi se cae.
// El tramo cerrado de verdad es corto —lo que queda al descontar las dos
// transiciones— pero las transiciones son largas a proposito: medidas, con
// ocho unidades la calzada se cerraba en un tercio de segundo y no daba tiempo
// ni a verla estrecharse. Lo que hay que ver venir es el embudo.
const NARROW_LEN = 62;
const NARROW_TAPER = 22;            // lo que tarda en cerrarse a cada extremo
const NARROW_MIN = 1 / 3;           // se queda en un carril de los tres

// --- Salirse de la carretera -----------------------------------------------
const FALL_TIME = 1.15;             // lo que dura la caida antes del final

// --- Senalizacion de aviso -------------------------------------------------
// Las senales no son decorado: cada una se planta porque VIENE lo que anuncia.
// Se colocan por delante de aquello que avisan, de modo que el jugador lee el
// rombo antes de poder distinguir la silueta entre la bruma. Lo que ganan no
// es tiempo de reaccion —el obstaculo ya se ve venir— sino saber DE QUE se
// trata, que es lo que decide si hay que saltar, agacharse o cambiarse.
const WARN_POOL = 12;
// Treinta y cuatro unidades de adelanto. Mas seria plantarla fuera del punto
// de aparicion, donde apareceria de golpe en mitad del campo visible; asi nace
// a 136 y la bruma, que cierra a 185, se come su entrada.
const WARN_AHEAD = 34;
// Unidades que tarda una senal en acabar de aparecer. Nacian ya visibles a 136
// del jugador —la bruma cierra a 185, asi que a esa distancia todavia se ven un
// tercio— y el efecto era que se materializaban de la nada. Apareciendo desde
// transparente, entran como si salieran de la niebla.
const WARN_FADE = 26;
// Y separacion minima entre dos senales seguidas. Sin ella salia mas de una
// por compas: un pasillo de rombos deja de ser senalizacion y pasa a ser
// ruido, y lo primero que se pierde es la costumbre de mirarlas.
const WARN_MIN_GAP = 95;

// --- Placas de impulso ---------------------------------------------------
// Van pegadas al suelo y se pisan al pasar por encima: no son un objeto que
// se recoge, son un trozo de calzada que empuja. Breve a proposito, porque
// ir mas rapido con los mismos huecos entre obstaculos es tambien mas
// peligroso: el premio y el riesgo son la misma cosa.
const BOOST_TIME = 2.6;
const BOOST_MULT = 1.45;
// Lo que cada placa deja para siempre. El empujon fuerte se pasa en un par de
// segundos, pero un pellizco se queda: la partida larga acaba corriendo mas
// que la corta porque se la ha ganado, no porque haya durado.
const BOOST_KEEP = 0.03;
const BOOST_KEEP_MAX = 0.3;         // diez placas y ya no sube mas
// Placas necesarias para recuperar una vida.
const BOOST_PER_LIFE = 3;
const HAZARD_POOL = 10;

// Tipos de obstaculo. Los tres verbos del juego: esquivar, agacharse, saltar.
const ESTELA = 0;   // monolito alto: hay que cambiar de carril
const DINTEL = 1;   // viga elevada: hay que deslizarse
const CENOTE = 2;   // sumidero de un carril: hay que saltar
// Los dos siguientes cruzan la calzada ENTERA. No se esquivan cambiandose de
// carril: o se saltan o no se pasa, y son lo que convierte el salto en una
// herramienta obligatoria en vez de un adorno.
const TRONCO = 3;   // arbol caido de lado a lado
const VACIO = 4;    // la calzada se acaba y vuelve a empezar mas alla
const MURO = 5;     // el ramal cortado del cruce: no se salta ni se rodea

// Ancho de los que cruzan de lado a lado: no dependen del carril.
const WIDE = [false, false, false, true, true, true];
// Media profundidad de colision de cada tipo. El vacio es el unico que mide
// mas que la ventana normal, porque su peligro no es un borde sino un tramo.
const VACIO_LEN = 7.5;

// ---------------------------------------------------------------------------
// Terreno a dos niveles
// ---------------------------------------------------------------------------
// La calzada base sigue siendo plana y periodica; lo que sube es un tramo
// elevado por carril, con su rampa de entrada y su rampa de salida. Modelarlo
// como objeto del pool y no como parte de la calzada es lo que permite
// conservar el truco del modulo: la calzada no sabe que hay desniveles.
const LEVEL_HIGH = 1.6;             // la "semi subida": se salta, pero se nota
const RAMP_LEN = 8;                 // largo de cada rampa
const PLAT_MIN = 30;                // largo del tramo llano, sin rampas
const PLAT_MAX = 56;
// Cuanto puede subir el jugador de un paso al cambiar de carril. Por encima de
// esto el carril vecino es un muro y el cambio se rechaza: no hace dano, pero
// obliga a buscar la rampa o a saltar.
const STEP_UP = 0.55;
// Caida minima para considerar que te has salido del tramo. Por debajo se
// pega al suelo, que es lo que hace que las rampas se bajen andando en vez de
// a saltitos.
const STEP_DOWN = 0.4;

// Los cinco perfiles de altura pedidos. Todos dejan al menos un carril bajo y
// al menos uno alto: siempre hay eleccion, y siempre hay algo que sortear.
const LANE_PATTERNS = [
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [0, 0, 1]
];

// ---------------------------------------------------------------------------
// Amenazas que vienen hacia ti
// ---------------------------------------------------------------------------
// A diferencia de los obstaculos, que estan quietos y el mundo se los lleva,
// estas cierran distancia por su cuenta. Es lo que rompe la sensacion de que
// la calzada solo te pasa por al lado.
const CAMAZOTZ = 0;   // murcielago de Xibalba: vuela a la altura del pecho
const RODANTE = 1;    // piedra que baja rodando por el carril
const VACA = 2;       // cruza la calzada de lado a lado, sin prisa
const BUS = 3;        // viene de frente por su carril y no se aparta

const HAZ_SPEED = [15, 9, 0, 17];        // velocidad propia, sumada a la del mundo
// Franja vertical que ocupa cada amenaza sobre su suelo. Debajo del
// murcielago se pasa deslizandose; la piedra solo se salta.
const HAZ_LOW = [1.25, 0, 0, 0];
// La vaca y la camioneta son mas altas que un salto a proposito: la respuesta
// a las dos es apartarse, y dejar que ademas se pudieran saltar convertiria
// tres respuestas distintas en una sola.
const HAZ_HIGH = [2.35, 1.45, 2.55, 3.7];
// Lo que avanza la vaca de lado por cada unidad que avanza el mundo. Al ir
// atada a la velocidad y no al reloj, cruza siempre por el mismo sitio: se
// puede aprender, que es lo unico que hace justo un obstaculo movil.
const COW_CROSS = 0.105;

// ---------------------------------------------------------------------------
// Curvas y relieve lejano
// ---------------------------------------------------------------------------
// La calzada no gira de verdad: se desplaza lateralmente en funcion de la
// distancia recorrida, y la camara sigue la tangente.
//
// PERO SOLO A PARTIR DE CIERTA DISTANCIA. La primera version curvaba desde el
// metro cero, y ahi el truco se rompia: un tramo elevado es una pieza recta de
// hasta setenta unidades, y sobre una calzada que se dobla bajo sus pies no
// encajaba con el suelo que el jugador estaba pisando. Con la mascara, las
// cincuenta unidades donde de verdad se juega son rectas —y por tanto todo
// casa— y el giro vive en el fondo, que es donde se lee.
const CURVE_NEAR = 52;              // hasta aqui, recto
const CURVE_FULL = 158;             // a partir de aqui, curva entera
const CURVE_A1 = 6.4, CURVE_L1 = 118;
const CURVE_A2 = 3.8, CURVE_L2 = 263;
const CURVE_FOLLOW = 0.66;          // cuanto compensa la camara el giro

// Ondulacion vertical: la calzada sube y baja en la distancia, asi que a veces
// el camino "viene de abajo" y aparece por encima de una loma. Igual que el
// giro, es cero cerca del jugador, asi que el suelo que pisa sigue siendo
// plano y nada de la fisica se entera.
const CURVE_AY = 4.6, CURVE_LY = 197;

// Altura de crucero del vuelo. Muy por encima de todo lo que hay en la
// calzada, porque ahi arriba el juego es otro: filas de jade en el aire.
const FLY_Y = 6.8;
const AMBER_SCALE = 0.62;           // cuanto frena el ambar el mundo

// Solo lo que sobrevive al cambio de departamento: el jade, el jaguar y el
// quetzal se ven igual en los ocho tramos. Todo lo demas (calzada, obstaculos,
// cielo, horizonte) lo define la region, no esta paleta.
const C = {
    jade: 0x2ec4a0,
    ochre: 0xc8862f,
    jaguarFur: 0xd9a24b,
    jaguarSpot: 0x3b2a14,
    quetzal: 0x1fae7e,
    quetzalBreast: 0xd8484a
};

// ===========================================================================
// La ruta: doce puntos de Guatemala
// ===========================================================================
// Cada tramo define su cielo, su niebla, su suelo, sus luces, el material de
// la calzada, el color de los obstaculos, que crece a los lados y que se ve
// en el horizonte. Las coordenadas mm son las del minimapa (viewBox 108x116),
// derivadas de la posicion real de cada sitio.
//
// road: [cortes a lo ancho, filas a lo largo, junta, irregularidad]
//   Es lo que convierte la calzada en losa grande de caliza, en adoquin, en
//   tablon de muelle o en arena sin juntas. El color solo no bastaba: Antigua
//   y Tikal salian iguales con distinto tono, y el adoquin es precisamente lo
//   que se reconoce de Antigua.
// prop: que crece o se amontona a los lados de la calzada.
// ridge: silueta de la sierra del fondo, la capa mas lenta del parallax.
// sky: 'cloud' de dia, 'star' de noche.
const REGIONS = [
    {
        id: 'tikal', name: 'Tikal', dept: 'Petén', mm: [69.2, 21.8],
        skyTop: 0x27456b, skyBot: 0xe8a86e, fog: 0xcb9b74, ground: 0x2b4a3b,
        sun: 0xffd2a0, sunI: 1.7, hemi: 0xdcc6b2, hemiI: 1.7,
        roadA: 0xefe6d2, roadB: 0xd9cdb2, kerb: 0xb9a888,
        stone: 0xa1937f, accent: 0xc8862f, hazard: 0x14776a, pit: 0x040d0b,
        land: 'temple', landA: 0xa1937f, landB: 0xc8862f,
        ridge: 0x6e5c46, sky: 'cloud', skyC: 0xf3d3ae,
        road: [1, 1, 0.94, 0], prop: 'jungle', propA: 0x2f6b4a, propB: 0x8a6a3f,
        ob: [1.0, 1.0, 1.0]
    },
    {
        id: 'flores', name: 'Flores', dept: 'Petén', mm: [62.4, 29.1],
        skyTop: 0x2f7fc4, skyBot: 0xbfe3ea, fog: 0x7fb9c4, ground: 0x2f6b52,
        sun: 0xfff4de, sunI: 2.15, hemi: 0xdff0f4, hemiI: 2.35,
        roadA: 0xe8dfc8, roadB: 0xd0c4a6, kerb: 0xc0644a,
        stone: 0xf0e8d8, accent: 0xc0472f, hazard: 0x1f88b8, pit: 0x06222e,
        land: 'town', landA: 0xf0e6d2, landB: 0xc0472f,
        ridge: 0x4f7f86, sky: 'cloud', skyC: 0xffffff,
        road: [3, 2, 0.9, 0.02], prop: 'reed', propA: 0x3f8f6a, propB: 0xe0b25c,
        ob: [0.95, 1.05, 0.95]
    },
    {
        id: 'semuc', name: 'Semuc Champey', dept: 'Alta Verapaz', mm: [60.9, 64.1],
        skyTop: 0x5d93b8, skyBot: 0xd7e6c4, fog: 0x8fb79a, ground: 0x1f4a33,
        sun: 0xfff0d2, sunI: 2.0, hemi: 0xdfeee0, hemiI: 2.2,
        roadA: 0xe4dcc0, roadB: 0xcdc2a2, kerb: 0x9aa87f,
        stone: 0x8fa08b, accent: 0x3fbfa6, hazard: 0x2fd0c4, pit: 0x07332f,
        land: 'karst', landA: 0x7d8f77, landB: 0x2f7a52,
        ridge: 0x3f6a52, sky: 'cloud', skyC: 0xeef6ea,
        road: [2, 1, 0.9, 0.05], prop: 'fern', propA: 0x2a7a52, propB: 0x9fb08a,
        ob: [1.1, 0.92, 1.15]
    },
    {
        id: 'riodulce', name: 'Río Dulce', dept: 'Izabal', mm: [86.0, 61.1],
        skyTop: 0x2f86c9, skyBot: 0xa8e0e6, fog: 0x6fb3c0, ground: 0x2e6b4e,
        sun: 0xfff6e0, sunI: 2.2, hemi: 0xe4f4f6, hemiI: 2.4,
        roadA: 0xd9c9a4, roadB: 0xbfab82, kerb: 0x8a6b45,
        stone: 0x9b7448, accent: 0xe0b25c, hazard: 0x1f7fb0, pit: 0x06222f,
        land: 'palm', landA: 0x6f4f2f, landB: 0x2f9e5e,
        ridge: 0x3f7f7a, sky: 'cloud', skyC: 0xffffff,
        road: [1, 3, 0.84, 0.02], prop: 'palm', propA: 0x6f4f2f, propB: 0x2f9e5e,
        ob: [1.25, 0.85, 1.1]
    },
    {
        id: 'esquipulas', name: 'Esquipulas', dept: 'Chiquimula', mm: [75.9, 88.2],
        skyTop: 0x6f8fc0, skyBot: 0xe8c896, fog: 0xcfae82, ground: 0x4a5a3a,
        sun: 0xffe0b0, sunI: 2.0, hemi: 0xe4d2ba, hemiI: 1.9,
        roadA: 0xb8a684, roadB: 0x9e8b68, kerb: 0x8a7a5c,
        stone: 0xf2ece0, accent: 0xd4a63a, hazard: 0x3a2f24, pit: 0x1a140e,
        land: 'colonial', landA: 0xf2ece0, landB: 0xd4a63a,
        ridge: 0x7a7250, sky: 'cloud', skyC: 0xf6e2c2,
        road: [2, 2, 0.87, 0.06], prop: 'agave', propA: 0x5f7a44, propB: 0xb8a06a,
        ob: [0.95, 1.1, 0.95]
    },
    {
        id: 'antigua', name: 'Antigua', dept: 'Sacatepéquez', mm: [41.3, 88.4],
        skyTop: 0x5a7fb8, skyBot: 0xf0c48a, fog: 0xd0a479, ground: 0x3a5340,
        sun: 0xffd9a4, sunI: 1.95, hemi: 0xdcc4ad, hemiI: 1.85,
        roadA: 0x9c8f80, roadB: 0x857868, kerb: 0xb5a08a,
        stone: 0xe8d9b8, accent: 0xd4762f, hazard: 0x3b3128, pit: 0x18120c,
        land: 'colonial', landA: 0xe0c9a6, landB: 0xc0472f,
        ridge: 0x5a6a52, sky: 'cloud', skyC: 0xf7dcbe,
        // El adoquin: seis cortes a lo ancho y tres a lo largo, junta marcada
        // y piedras desigualadas. Es la calle de Antigua, y no se parece a
        // ninguna otra del recorrido.
        road: [6, 3, 0.85, 0.05], prop: 'jacaranda', propA: 0x4f6a44, propB: 0x8a6ac0,
        ob: [0.9, 1.15, 0.95]
    },
    {
        id: 'fuego', name: 'Volcán de Fuego', dept: 'Chimaltenango', mm: [37.6, 90.7],
        skyTop: 0x18131f, skyBot: 0xd4501f, fog: 0x8a3a22, ground: 0x241d1a,
        sun: 0xff8a4a, sunI: 1.5, hemi: 0x8a5a4a, hemiI: 1.2,
        roadA: 0x6a625c, roadB: 0x534d47, kerb: 0x4a423c,
        stone: 0x3a332e, accent: 0xff5a1f, hazard: 0xff3d00, pit: 0x2a0a02,
        land: 'volcano', landA: 0x2e2622, landB: 0xff5a1f,
        ridge: 0x3a2822, sky: 'star', skyC: 0xff8a4a,
        road: [3, 2, 0.9, 0.08], prop: 'lava', propA: 0x2e2622, propB: 0xff5a1f,
        ob: [1.05, 1.0, 1.0]
    },
    {
        id: 'atitlan', name: 'Lago de Atitlán', dept: 'Sololá', mm: [29.6, 85.2],
        skyTop: 0x3a3a6d, skyBot: 0xe37a45, fog: 0xc2724a, ground: 0x2c4436,
        sun: 0xffad6a, sunI: 1.9, hemi: 0xd9aea0, hemiI: 1.8,
        roadA: 0xc9b9a0, roadB: 0xb0a088, kerb: 0x8f6f5a,
        stone: 0x6d5a72, accent: 0xd94f6a, hazard: 0x1d4f7a, pit: 0x081c2c,
        land: 'volcano', landA: 0x3f4a55, landB: 0x8d6a4f,
        ridge: 0x46405f, sky: 'cloud', skyC: 0xf0a483,
        road: [3, 1, 0.9, 0.03], prop: 'maize', propA: 0x4f7a3f, propB: 0xd94f6a,
        ob: [0.95, 1.05, 1.0]
    },
    {
        id: 'chichi', name: 'Chichicastenango', dept: 'Quiché', mm: [31.8, 78.9],
        skyTop: 0x1f2a52, skyBot: 0x6b4a7a, fog: 0x4a3f63, ground: 0x22362c,
        sun: 0xc9a8e0, sunI: 1.15, hemi: 0x8f7fa8, hemiI: 1.35,
        roadA: 0xb9ae95, roadB: 0xa0957c, kerb: 0x7d6f5a,
        stone: 0xd8d2c4, accent: 0xe0483f, hazard: 0x2a1f33, pit: 0x120c18,
        land: 'market', landA: 0xe6e0d2, landB: 0xe0483f,
        ridge: 0x3a3550, sky: 'star', skyC: 0xdfe6ff,
        road: [2, 2, 0.91, 0.04], prop: 'stall', propA: 0xe0483f, propB: 0xf0c34a,
        ob: [1.05, 0.95, 1.05]
    },
    {
        id: 'todossantos', name: 'Todos Santos', dept: 'Huehuetenango', mm: [19.5, 64.6],
        skyTop: 0x2f5fa8, skyBot: 0xcfe4f0, fog: 0x9fb8c4, ground: 0x3a5a44,
        sun: 0xf2f8ff, sunI: 2.0, hemi: 0xd6e6f0, hemiI: 2.1,
        roadA: 0xa8a89c, roadB: 0x8f8f7d, kerb: 0x7a7a68,
        stone: 0x8a8f88, accent: 0xd93a3a, hazard: 0x2a3f4a, pit: 0x131c22,
        land: 'peak', landA: 0x445a4a, landB: 0xdfe8ee,
        ridge: 0x51707a, sky: 'cloud', skyC: 0xffffff,
        road: [2, 1, 0.89, 0.07], prop: 'pine', propA: 0x2f5a3f, propB: 0xd93a3a,
        ob: [1.0, 1.05, 1.0]
    },
    {
        id: 'tajumulco', name: 'Volcán Tajumulco', dept: 'San Marcos', mm: [12.0, 76.4],
        skyTop: 0x081120, skyBot: 0x1d3b46, fog: 0x17313b, ground: 0x152720,
        sun: 0xa8c6e6, sunI: 0.85, hemi: 0x6d90a4, hemiI: 1.05,
        roadA: 0x8c9aa0, roadB: 0x717e87, kerb: 0x5a666b,
        stone: 0x4a5560, accent: 0xcfe4ef, hazard: 0xd4451f, pit: 0x2a0e06,
        land: 'peak', landA: 0x2b3540, landB: 0xe8f2f7,
        ridge: 0x1e2b34, sky: 'star', skyC: 0xdfeaff,
        road: [3, 2, 0.93, 0.06], prop: 'rock', propA: 0x3a4550, propB: 0xcfe4ef,
        ob: [1.0, 1.1, 0.9]
    },
    {
        id: 'monterrico', name: 'Monterrico', dept: 'Santa Rosa', mm: [47.4, 105.0],
        skyTop: 0x3b4f8a, skyBot: 0xf2a86b, fog: 0xd09a72, ground: 0x2b2b2e,
        sun: 0xffcf9c, sunI: 1.75, hemi: 0xcdb6a6, hemiI: 1.75,
        roadA: 0x5a544f, roadB: 0x484340, kerb: 0x7a6a55,
        stone: 0x6f5a3f, accent: 0xe8c98a, hazard: 0x2f6f8a, pit: 0x07202b,
        land: 'palm', landA: 0x4a3a26, landB: 0x2f7a4e,
        ridge: 0x6a5a54, sky: 'cloud', skyC: 0xffd9b0,
        // Arena negra: sin cortes y sin junta, para que se lea como superficie
        // continua y no como losas.
        road: [1, 1, 1.0, 0.02], prop: 'palm', propA: 0x4a3a26, propB: 0x2f7a4e,
        ob: [1.2, 0.88, 1.12]
    }
];


const REGION_N = REGIONS.length;

// ===========================================================================
// Patrocinio
// ===========================================================================
// Todo lo del patrocinador sale de aqui. Cambiar de anunciante, de enlaces o
// de videos es tocar este objeto y nada mas.
//
// Dos formatos, y ninguno interrumpe la partida:
//   - La franja, en el menu y en la pantalla de fin: momentos en los que el
//     jugador ya esta parado leyendo.
//   - El panel de revivir, que solo se ofrece DESPUES de perder, cuando la
//     alternativa es cerrar la pestana, y una sola vez por carrera.
//
// Nota deliberada: revivir se gana viendo el video, NO siguiendo las redes.
// Un boton de seguir no se puede verificar desde aqui, asi que premiarlo
// seria premiar el clic; y ademas las tres plataformas desaconsejan el
// seguimiento incentivado. Los enlaces sociales estan, pero no dan nada.
const CEFAS = {
    name: 'Cefas Panadería',
    tag: 'Patrocina esta calzada',
    blurb: 'Pan de todos los días, hecho en Guatemala.',
    // Si el archivo falta, el hueco lo ocupa un sustituto tipografico del
    // mismo tamano y no se rompe nada.
    logo: 'src/img/logo-cefas.png',
    initials: 'CP',
    order: 'https://www.pedidosya.com.gt/restaurantes/ciudad-de-guatemala/cefas-panaderia-6374a132-54b4-4157-8e55-ebbc0e6cf786-menu',
    channel: 'https://www.youtube.com/@cefas.panaderia/shorts',
    social: [
        { id: 'ig', name: 'Instagram', url: 'https://www.instagram.com/cefas.pan/' },
        { id: 'fb', name: 'Facebook',  url: 'https://facebook.com/cefas.pan' },
        { id: 'tt', name: 'TikTok',    url: 'https://www.tiktok.com/@cefas.pan' }
    ],
    // Identificadores de los Shorts que se rotan al revivir: se elige uno al
    // azar cada vez, para que quien muera dos partidas seguidas no vea el
    // mismo anuncio. Vaciar la lista no rompe nada: el panel cae al cartel
    // del patrocinador y concede el revivir igual.
    shorts: ['wQpgQAirBr0', 'MEt51UHtAkM', '50d_PAI9jc4'],
    // Segundos antes de habilitar "Continuar". Corre por reloj propio y no
    // depende de que el reproductor llegue a cargar: si un bloqueador tumba
    // el iframe, el jugador revive igual. Castigarle por tener un bloqueador
    // seria cobrarle el fallo de otro.
    watch: 8
};

// Marcas de las redes. Trazos simples y genericos, no calcos del logotipo:
// aqui solo hacen falta para que se reconozca a donde lleva el enlace.
const SOCIAL_ICONS = {
    ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5zM17.8 6a1.2 1.2 0 1 1-1.2 1.2A1.2 1.2 0 0 1 17.8 6z"/></svg>',
    fb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.25-1.5 1.55-1.5h1.65V4.63A22 22 0 0 0 14.3 4.5c-2.4 0-4 1.47-4 4.16v2.23H7.6V14h2.7v8z"/></svg>',
    tt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2h3a5.5 5.5 0 0 0 4.5 4.4v3A8.4 8.4 0 0 1 17 8v6.6A6.4 6.4 0 1 1 10.6 8.2c.3 0 .6 0 .9.06v3.1a3.4 3.4 0 1 0 2.5 3.28z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12s0-3.3-.42-4.88a2.54 2.54 0 0 0-1.79-1.8C18.2 4.9 12 4.9 12 4.9s-6.2 0-7.79.42a2.54 2.54 0 0 0-1.79 1.8C2 8.7 2 12 2 12s0 3.3.42 4.88a2.54 2.54 0 0 0 1.79 1.8C5.8 19.1 12 19.1 12 19.1s6.2 0 7.79-.42a2.54 2.54 0 0 0 1.79-1.8C22 15.3 22 12 22 12zM10 15.2V8.8l5.5 3.2z"/></svg>',
    order: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h13l-1.6 8.4a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.65L5.6 3.5A1 1 0 0 0 4.6 2.7H2.5v2h1.3zM9.5 17.8a1.85 1.85 0 1 1-1.85 1.85A1.85 1.85 0 0 1 9.5 17.8zm7.4 0a1.85 1.85 0 1 1-1.85 1.85A1.85 1.85 0 0 1 16.9 17.8z"/></svg>'
};

// La franja. Se pinta en el menu, en el fin de partida y bajo el panel de
// revivir; el mismo trozo de HTML en los tres sitios.
function sponsorStrip() {
    const link = (url, icon, label, cls) =>
        '<a class="slink' + (cls ? ' ' + cls : '') + '" href="' + url +
        '" target="_blank" rel="noopener noreferrer">' +
        (SOCIAL_ICONS[icon] || '') + '<span>' + label + '</span></a>';

    return '<div class="sponsor-head">' +
        // El logo se oculta solo si el archivo no existe todavia, y entonces
        // queda a la vista el sustituto con las iniciales.
        '<img class="sponsor-logo" src="' + CEFAS.logo + '" alt="" hidden ' +
        'onload="this.hidden=false;this.nextElementSibling.hidden=true" ' +
        'onerror="this.remove()">' +
        '<span class="sponsor-mark">' + CEFAS.initials + '</span>' +
        '<span><span class="sponsor-tag">' + CEFAS.tag + '</span>' +
        '<b class="sponsor-name">' + CEFAS.name + '</b></span>' +
        '</div>' +
        '<div class="sponsor-links">' +
        link(CEFAS.order, 'order', 'Pedir en PedidosYa', 'slink-order') +
        CEFAS.social.map(x => link(x.url, x.id, x.name)).join('') +
        link(CEFAS.channel, 'yt', 'Shorts') +
        '</div>';
}

function paintSponsors() {
    const html = sponsorStrip();
    for (const el of [dom.sponsorMenu, dom.sponsorOver, dom.sponsorRevive]) {
        if (el) el.innerHTML = html;
    }
}

// ===========================================================================
// Trajes
// ===========================================================================
// Cada traje solo cambia colores: la silueta del corredor se mantiene para
// que la lectura de la postura (salto, deslizamiento) no dependa del traje.
const SKINS = [
    { id: 'ajaw', name: 'Ajaw', icon: '◈',
      desc: 'El corredor de la calzada, con tocado de jade.',
      cost: 0, cloth: 0xc0453a, skin: 0xd9a066, crest: 0x2ec4a0, legs: 0x10201c,
      trim: 0xc8862f, hair: 0x2a1a10, boot: 0x6b4a2a },
    { id: 'tejedora', name: 'Tejedora', icon: '✦',
      desc: 'Huipil de telar de cintura del altiplano.',
      cost: 120, cloth: 0x7b2d8e, skin: 0xc98b58, crest: 0xe0483f, legs: 0x1b2b26,
      trim: 0xf0c34a, hair: 0x1a1008, boot: 0x8a5a30 },
    { id: 'jaguar', name: 'Guerrero Jaguar', icon: '◉',
      desc: 'Piel moteada de la orden militar maya.',
      cost: 260, cloth: 0xd9a24b, skin: 0xd9a066, crest: 0x3b2a14, legs: 0x3b2a14,
      trim: 0x10201c, hair: 0x2a1a10, boot: 0x3b2a14 },
    { id: 'quetzal', name: 'Quetzal', icon: '➤',
      desc: 'Verde tornasol y pecho carmesí.',
      cost: 420, cloth: 0x1fae7e, skin: 0xd8484a, crest: 0x2ec4a0, legs: 0x14776a,
      trim: 0xd8484a, hair: 0x0f5a44, boot: 0xc8862f },
    { id: 'chapin', name: 'Chapín', icon: '⚑',
      desc: 'Azul y blanco, de un extremo al otro del país.',
      cost: 620, cloth: 0x4a90d9, skin: 0xd9a066, crest: 0xf2f6fa, legs: 0xf2f6fa,
      trim: 0x4a90d9, hair: 0x241810, boot: 0x2f5f96 },
    { id: 'ceniza', name: 'Ceniza', icon: '▲',
      desc: 'Lo que queda cuando el Fuego hace de las suyas.',
      cost: 900, cloth: 0x33312f, skin: 0xb06a4a, crest: 0xff6b2c, legs: 0x1a1a1a,
      trim: 0xff6b2c, hair: 0x141414, boot: 0x2a2a2a }
];

// ===========================================================================
// Mejoras permanentes
// ===========================================================================
const UPGRADES = [
    { id: 'lives',   name: 'Corazón de jade',   max: 2, cost: l => 220 + l * 320,
      desc: 'Una vida más al empezar cada carrera.' },
    { id: 'shield',  name: 'Escudo ancestral',  max: 1, cost: () => 380,
      desc: 'Sales de la salida con el escudo puesto.' },
    { id: 'magnet',  name: 'Imán de jade',      max: 3, cost: l => 160 + l * 210,
      desc: 'El jade cercano se viene solo a tu mano.' },
    { id: 'power',   name: 'Ofrenda de copal',  max: 3, cost: l => 190 + l * 230,
      desc: 'Los poderes duran un 20 % más por nivel.' },
    { id: 'value',   name: 'Jade pulido',       max: 3, cost: l => 170 + l * 250,
      desc: 'Cada pieza de jade vale un 25 % más.' },
    { id: 'agility', name: 'Pies ligeros',      max: 3, cost: l => 130 + l * 170,
      desc: 'Cambias de carril más rápido y más seco.' },
    { id: 'djump',   name: 'Alas de quetzal',   max: 1, cost: () => 540,
      desc: 'Salto doble: un segundo impulso en el aire.' },
    { id: 'luck',    name: 'Suerte del ajq\u2019ij', max: 3, cost: l => 210 + l * 260,
      desc: 'Aparecen poderes con más frecuencia.' }
];

// ===========================================================================
// Iconos del taller
// ===========================================================================
// SVG en linea y no glifos Unicode: el HUD ya enseño el problema, porque la
// tipografia solo trae el rango latino y todo simbolo raro cae en la fuente
// de respaldo del sistema, que en Windows dibujo una "O" donde deberia haber
// un escudo. Con SVG el icono es el mismo en cualquier maquina.
const ICON_PATHS = {
    lives:   '<path d="M12 21C6 16.5 3 13.4 3 9.8 3 7.1 5 5 7.6 5c1.6 0 3.1.8 4.4 2.3C13.3 5.8 14.8 5 16.4 5 19 5 21 7.1 21 9.8c0 3.6-3 6.7-9 11.2z"/>',
    shield:  '<path d="M12 2l8 3v6.5c0 5-3.4 9.4-8 10.5-4.6-1.1-8-5.5-8-10.5V5z" fill="none" stroke="currentColor" stroke-width="2"/>',
    magnet:  '<path d="M5 20V10a7 7 0 0 1 14 0v10" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M5 20h4M15 20h4" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>',
    power:   '<path d="M12 2c3 4 5 6.2 5 9a5 5 0 0 1-10 0c0-2.8 2-5 5-9z"/><path d="M12 22c-2.5 0-4-1.2-4-3h8c0 1.8-1.5 3-4 3z"/>',
    value:   '<path d="M12 2l6 6-6 14-6-14z"/>',
    agility: '<path d="M4 7l7 5-7 5z"/><path d="M13 7l7 5-7 5z"/>',
    djump:   '<path d="M12 4l3 5 7 2-7 2-3 5-3-5-7-2 7-2z"/>',
    luck:    '<path d="M12 2l2.6 6.6L21 11l-6.4 2.4L12 20l-2.6-6.6L3 11l6.4-2.4z"/>'
};

// Un glifo por sitio: piramide, isla, karst, palmera, basilica, arco,
// volcan, lago, mercado, sierra, pico nevado y playa.
const REGION_ICONS = {
    tikal:       '<path d="M2 21h20L12 4z"/><path d="M8 21v-4h8v4z" fill="#0b1512" opacity=".55"/>',
    flores:      '<path d="M3 21h18c-1-4-4-6-9-6s-8 2-9 6z"/><path d="M12 3l5 6H7z"/><rect x="10" y="9" width="4" height="5"/>',
    semuc:       '<path d="M2 21h20v-4c-3 0-4-3-7-3s-4 3-6 3-4-1-7-1z"/><path d="M4 12c2-4 5-6 8-6s6 2 8 6z"/>',
    riodulce:    '<path d="M11 21h2V9h-2z"/><path d="M12 8C9 4 5 4 3 7c3-1 6 0 9 1zM12 8c3-4 7-4 9-1-3-1-6 0-9 1z"/><path d="M2 21h20" stroke="currentColor" stroke-width="2"/>',
    esquipulas:  '<path d="M12 1v4M10 3h4" stroke="currentColor" stroke-width="1.8"/><path d="M6 21V9l6-4 6 4v12z"/><rect x="10" y="14" width="4" height="7" fill="#0b1512" opacity=".5"/>',
    antigua:     '<path d="M3 21V10h18v11z"/><path d="M8 21v-6a4 4 0 0 1 8 0v6z" fill="#0b1512" opacity=".55"/><path d="M2 10l10-6 10 6z"/>',
    fuego:       '<path d="M2 21h20L14 7h-4z"/><path d="M12 2c1.5 2 3 2.6 3 4.4A3 3 0 0 1 9 6.4C9 4.6 10.5 4 12 2z"/>',
    atitlan:     '<path d="M2 17h20v4H2z"/><path d="M1 17L8 5l6 12zM10 17l5-8 8 8z"/>',
    chichi:      '<path d="M2 9l4-5h12l4 5z"/><path d="M4 9h16v12H4z"/><path d="M9 21v-6h6v6z" fill="#0b1512" opacity=".5"/>',
    todossantos: '<path d="M1 21L9 6l5 9 3-5 6 11z"/><path d="M9 6l2.6 4.7-2.6 1-2.6-1z" fill="#0b1512" opacity=".4"/>',
    tajumulco:   '<path d="M2 21L12 3l10 18z"/><path d="M12 3l3.4 6.2-3.4-1.4-3.4 1.4z" fill="#0b1512" opacity=".45"/>',
    monterrico:  '<circle cx="18" cy="6" r="3.4"/><path d="M2 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="2"/>'
};

const svg = body => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';

// Los trajes no llevan glifo sino un muñeco pintado con SUS colores: es a la
// vez icono y vista previa, y ahorra tener que ponerselo para saber como es.
function skinIcon(sk) {
    const c = h => '#' + h.toString(16).padStart(6, '0');
    return svg(
        // Placa de fondo clara. Sin ella los trajes de piernas oscuras (el
        // Ajaw lleva obsidiana) se comian las piernas contra la tarjeta, que
        // tambien es oscura, y el muneco salia sin mitad inferior.
        '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
        '<rect x="7" y="1.2" width="10" height="2.6" rx="1" fill="' + c(sk.crest) + '"/>' +
        '<rect x="8.4" y="3.8" width="7.2" height="5" rx="1.2" fill="' + c(sk.skin) + '"/>' +
        '<rect x="8.4" y="3.8" width="7.2" height="1.6" rx=".8" fill="' + c(sk.hair) + '"/>' +
        '<rect x="6.4" y="9.4" width="11.2" height="7" rx="1.6" fill="' + c(sk.cloth) + '"/>' +
        '<rect x="6.4" y="14" width="11.2" height="1.8" fill="' + c(sk.trim) + '"/>' +
        '<rect x="3.6" y="9.8" width="2.4" height="5.6" rx="1.2" fill="' + c(sk.skin) + '"/>' +
        '<rect x="18" y="9.8" width="2.4" height="5.6" rx="1.2" fill="' + c(sk.skin) + '"/>' +
        '<rect x="8" y="16.6" width="3.2" height="4.6" rx="1" fill="' + c(sk.legs) + '"/>' +
        '<rect x="12.8" y="16.6" width="3.2" height="4.6" rx="1" fill="' + c(sk.legs) + '"/>' +
        '<rect x="7.6" y="21" width="4" height="1.8" rx=".8" fill="' + c(sk.boot) + '"/>' +
        '<rect x="12.4" y="21" width="4" height="1.8" rx=".8" fill="' + c(sk.boot) + '"/>'
    );
}

// ===========================================================================
// Poderes
// ===========================================================================
const POWERS = {
    shield: { name: 'Escudo',              time: 0,    color: 0xc8862f, weight: 30 },
    magnet: { name: 'Imán de jade',        time: 9,    color: 0xa86ad9, weight: 22 },
    double: { name: 'Jade doble',          time: 11,   color: 0x4affd0, weight: 20 },
    amber:  { name: 'Ámbar de Verapaz',    time: 6,    color: 0xe0a02c, weight: 16 },
    flight: { name: 'Vuelo del quetzal',   time: 6.5,  color: 0x7fd4ff, weight: 12 }
};
const POWER_KEYS = Object.keys(POWERS);
const POWER_CHANCE = 0.17;          // por compas de recorrido

// ===========================================================================
// Estado
// ===========================================================================
const State = {
    MENU: 'menu', SHOP: 'shop', PLAYING: 'playing', PAUSED: 'paused',
    REVIVE: 'revive', OVER: 'over'
};

const game = {
    state: State.MENU,
    speed: SPEED_START,
    distance: 0,
    jade: 0,
    jadeScore: 0,        // puntos de jade ya multiplicados por la racha
    combo: 0,
    lives: START_LIVES,
    shield: false,
    invuln: 0,
    elapsed: 0,
    nextSpawnZ: SPAWN_Z,
    nextMilestone: MILESTONE_EVERY,
    best: 0,
    startRegion: 0,
    region: 0,           // indice del departamento actual
    powers: { magnet: 0, double: 0, amber: 0, flight: 0 },
    powerMax: { magnet: 1, double: 1, amber: 1, flight: 1 },
    boost: 0,            // segundos que quedan de impulso
    routePos: 0,         // en que punto de la ruta se esta; solo lo mueven los cruces
    roadS0: -1,          // trazado donde el firme cambia de departamento, -1 si no
    roadFrom: 0,         // firme que queda por detras de esa linea
    // Bifurcacion en curso. s0 es la distancia recorrida a la que empieza a
    // abrirse; mainBand dice cual de los dos ramales dibuja la calzada
    // principal, y se voltea al elegir para que el jugador siempre corra sobre
    // la malla detallada y no sobre la del ramal descartado.
    fork: { active: false, s0: 0, chosen: 0, mainBand: -1, away: 0, blocked: 0 },
    // Cruce suave de departamento: de donde se venia y cuanto lleva.
    snapFrom: -1,
    snapT: 1,
    slopeS0: -1,         // distancia en la que empieza la bajada, -1 si no hay
    turn: { active: false, s0: 0, dir: 1 },
    turnHold: 0,         // segundos aguantando por el lado que cierra
    narrowS0: -1,        // distancia en la que empieza el estrechamiento
    nextTramo: 0,        // distancia a la que toca armar el proximo tramo
    lastTramo: -1,       // cual salio la vez anterior, para no repetirlo
    crossKind: 1,        // 0 = cruce de destino, 1 = bifurcacion cortada
    boostTaken: 0,       // aceleradores pisados, para la vida extra
    boostPerm: 0,        // velocidad que se queda para siempre
    wrongC: null,        // cruce en el que se metio por el ramal cortado
    wrongLane: 1,        // ...y el carril por el que tendria que haber ido
    nextCross: CROSS_EVERY,
    crossTaken: 0,
    lastWarn: -999,      // distancia a la que se planto la ultima senal
    revived: false,      // el revivir del patrocinador ya se gasto en esta carrera
    curveBase: 0,        // desplazamiento de la curva justo donde esta el jugador
    riseBase: 0,         // altura de la ondulacion en ese mismo punto
    slopeBase: 0,        // lo que ha bajado la cuesta bajo los pies del jugador
    camLift: 0           // 0 a pie, 1 en el aire: reencuadra la camara al volar
};

const player = {
    lane: 1,
    lanePrev: 1,      // de donde viene el cambio en curso, para leer su relieve
    laneFrom: 0,
    laneT: 1,         // progreso 0..1 del cambio de carril en curso
    x: 0,
    y: 0,
    vy: 0,
    grounded: true,
    sliding: 0,
    out: 0,              // segundos de caida fuera de la calzada, 0 = en pista
    outVX: 0,            // lo que se aleja de lado mientras cae
    wantSlide: false, // picado que se convierte en deslizamiento al tocar suelo
    jumps: 0,         // saltos gastados desde que dejo el suelo
    holding: false,   // la tecla de salto sigue pulsada
    run: 0,           // fase del ciclo de carrera
    coyote: 0,        // margen para saltar tras dejar el suelo
    buffer: 0,        // salto pulsado un instante antes de aterrizar
    land: 0,          // temporizador del aplastado de aterrizaje
    groundY: 0,       // altura del suelo bajo los pies, ya no siempre cero
    bump: 0,          // rebote contra el muro de un carril alto
    bumpDir: 1        // hacia que lado intentaba ir cuando choco
};

// ===========================================================================
// Referencias del DOM
// ===========================================================================
const $ = id => document.getElementById(id);

const dom = {
    menu: $('menu'), shop: $('shop'), over: $('over'), unsupported: $('unsupported'),
    hud: $('hud'), pauseTag: $('pauseTag'), motionNotice: $('motionNotice'),
    playBtn: $('playBtn'), againBtn: $('againBtn'), shopBtn: $('shopBtn'),
    overShopBtn: $('overShopBtn'), shopClose: $('shopClose'),
    soundPref: $('soundPref'), soundBtn: $('soundBtn'), musicPref: $('musicPref'),
    lives: $('lives'), dist: $('dist'), jade: $('jade'),
    overTitle: $('overTitle'), recordTag: $('recordTag'),
    finalDist: $('finalDist'), finalJade: $('finalJade'), finalScore: $('finalScore'),
    finalRegion: $('finalRegion'), finalBank: $('finalBank'),
    bestScore: $('bestScore'), hudBest: $('hudBest'),
    combo: $('combo'), shield: $('shield'),
    milestone: $('milestone'), banner: $('banner'),
    speedVeil: $('speedVeil'), pauseBtn: $('pauseBtn'),
    menuRoute: $('menuRoute'), menuBank: $('menuBank'), menuBest: $('menuBest'),
    shopBank: $('shopBank'), tabSkins: $('tabSkins'), tabUpg: $('tabUpg'), tabRoute: $('tabRoute'),
    minimap: $('minimap'), mmDots: $('mmDots'), mmYou: $('mmYou'),
    mmName: $('mmName'), mmDept: $('mmDept'), mmFill: $('mmFill'),
    revive: $('revive'), reviveBtn: $('reviveBtn'), reviveSkip: $('reviveSkip'),
    reviveTimer: $('reviveTimer'), reviveSub: $('reviveSub'),
    shortHost: $('shortHost'), shortFallback: $('shortFallback'),
    sponsorMenu: $('sponsorMenu'), sponsorOver: $('sponsorOver'),
    sponsorRevive: $('sponsorRevive'),
    powers: $('powers'),
    pw: {
        magnet: $('pwMagnet'), flight: $('pwFlight'),
        double: $('pwDouble'), amber: $('pwAmber'), boost: $('pwBoost')
    }
};

// ===========================================================================
// Persistencia
// ===========================================================================
// Todo bajo el prefijo sacbe-. Cada lectura va envuelta: en modo incognito
// de algunos navegadores localStorage lanza en vez de devolver null.
const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    json(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
};

const save = {
    best: 0,
    bank: 0,            // jade disponible para gastar
    upg: {},            // niveles de mejora por id
    skin: 'ajaw',
    skins: ['ajaw'],    // trajes comprados
    regions: ['tikal'], // tramos alcanzados
    start: 0,           // indice del tramo de salida elegido
    sound: true,
    music: true
};

function loadSave() {
    save.best = parseInt(store.get('sacbe-best', '0'), 10) || 0;
    save.bank = parseInt(store.get('sacbe-bank', '0'), 10) || 0;
    save.upg = store.json('sacbe-upg', {}) || {};
    save.skin = store.get('sacbe-skin', 'ajaw');
    save.skins = store.json('sacbe-skins', ['ajaw']) || ['ajaw'];
    save.regions = store.json('sacbe-regions', ['tikal']) || ['tikal'];
    save.start = parseInt(store.get('sacbe-start', '0'), 10) || 0;
    const s = store.get('sacbe-sound', null);
    save.sound = s === null ? true : s === '1';
    const m = store.get('sacbe-music', null);
    save.music = m === null ? true : m === '1';

    // Saneado: un localStorage manipulado a mano no debe romper el arranque
    if (!SKINS.some(s2 => s2.id === save.skin)) save.skin = 'ajaw';
    if (!save.skins.includes('ajaw')) save.skins.push('ajaw');
    if (!save.regions.includes('tikal')) save.regions.push('tikal');
    if (!(save.start >= 0 && save.start < REGION_N)) save.start = 0;
    if (!save.regions.includes(REGIONS[save.start].id)) save.start = 0;
}

function persist() {
    store.set('sacbe-best', String(save.best));
    store.set('sacbe-bank', String(save.bank));
    store.set('sacbe-upg', JSON.stringify(save.upg));
    store.set('sacbe-skin', save.skin);
    store.set('sacbe-skins', JSON.stringify(save.skins));
    store.set('sacbe-regions', JSON.stringify(save.regions));
    store.set('sacbe-start', String(save.start));
}

// --- Lo que cada mejora hace, en un solo sitio ---
const lvl = id => save.upg[id] || 0;
const maxLives = () => START_LIVES + lvl('lives');
const laneTime = () => LANE_TIME - lvl('agility') * 0.021;
const powerScale = () => 1 + lvl('power') * 0.2;
const jadeScale = () => 1 + lvl('value') * 0.25;
const jadeReach = () => JADE_REACH + lvl('magnet') * 0.3;
const powerChance = () => POWER_CHANCE * (1 + lvl('luck') * 0.3);
// Alcance del iman: el poder lo dispara a lo grande, la mejora deja un tiron
// permanente pero corto.
const magnetRange = () => (game.powers.magnet > 0 ? 16 : lvl('magnet') * 1.9);

const skinById = id => SKINS.find(s => s.id === id) || SKINS[0];

// ===========================================================================
// Sonido: osciladores de Web Audio, cero archivos
// ===========================================================================
const audio = { ctx: null, on: true, master: null };

function initAudio() {
    // Los navegadores no permiten arrancar audio sin un gesto previo, por eso
    // esto se llama desde el boton de jugar y no al cargar la pagina.
    if (audio.ctx) {
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { audio.on = false; return; }

    audio.ctx = new Ctor();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.22;
    audio.master.connect(audio.ctx.destination);
}

function blip(freq, dur, type = 'triangle', vol = 1, slideTo = null) {
    if (!audio.on || !audio.ctx) return;

    const t = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);

    // Envolvente corta: ataque inmediato y caida exponencial
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

// Arpegio con retardo. Guarda los identificadores para poder cancelarlos: la
// fanfarria de fin de partida sonaba encima del inicio de la siguiente si
// reiniciabas rapido.
let pendingTones = [];
function arp(freqs, dur, gap, type = 'triangle', vol = 0.55) {
    freqs.forEach((f, i) => {
        pendingTones.push(setTimeout(() => blip(f, dur, type, vol), i * gap));
    });
}
function stopPendingTones() {
    pendingTones.forEach(clearTimeout);
    pendingTones = [];
}

// Escala pentatonica: cualquier combinacion suena bien, asi que las rachas
// de jade nunca desafinan.
const PENTA = [523.25, 587.33, 698.46, 783.99, 932.33, 1046.5];
let jadeStreak = 0;

const sfx = {
    jump: () => blip(360, 0.16, 'square', 0.5, 620),
    djump: () => blip(520, 0.18, 'square', 0.45, 900),
    slide: () => blip(220, 0.2, 'sawtooth', 0.32, 120),
    lane: () => blip(480, 0.07, 'square', 0.22),
    land: () => blip(150, 0.07, 'sine', 0.22),
    // Topetazo contra el costado de un tramo alto. Seco y grave: no es un
    // golpe, es un "por ahi no".
    bump: () => blip(110, 0.1, 'square', 0.3, 70),
    ramp: () => blip(300, 0.12, 'sine', 0.2, 430),
    boost: () => blip(420, 0.26, 'sawtooth', 0.45, 1180),
    jade: () => {
        blip(PENTA[Math.min(jadeStreak, PENTA.length - 1)], 0.19, 'triangle', 0.55);
        jadeStreak++;
    },
    hit: () => {
        blip(130, 0.32, 'sawtooth', 0.75, 55);
        blip(78, 0.4, 'square', 0.5);
        jadeStreak = 0;
    },
    over: () => arp([523.25, 415.3, 349.23, 261.63], 0.42, 130, 'triangle', 0.6),
    start: () => arp([523.25, 698.46, 1046.5], 0.26, 90, 'triangle', 0.5),
    shield: () => arp([659.25, 830.61, 987.77], 0.3, 70, 'triangle', 0.55),
    shieldBreak: () => {
        blip(300, 0.26, 'square', 0.6, 120);
        blip(180, 0.3, 'sawtooth', 0.4);
    },
    milestone: () => arp([783.99, 1046.5], 0.34, 110, 'triangle', 0.5),
    region: () => arp([392, 523.25, 659.25, 783.99], 0.36, 105, 'triangle', 0.5),
    power: () => arp([587.33, 880, 1174.66], 0.24, 65, 'triangle', 0.5),
    buy: () => arp([659.25, 987.77], 0.2, 80, 'triangle', 0.45),
    deny: () => blip(160, 0.16, 'square', 0.35, 110)
};

// ===========================================================================
// Musica de fondo: vals de marimba
// ===========================================================================
// NOTA SOBRE LA PIEZA. El arreglo de VALS.bars lo aporto el dueno del sitio:
// cincuenta y dos compases con melodia, cifrado y segunda voz escrita. No lo
// he verificado contra el original —no hay transcripcion libre y fiable de
// "Luna de Xelaju" en la red, que es por lo que en su dia se escribio una
// pieza propia—, asi que lo que suena es exactamente lo que se entrego. Si
// algo desafina, el sitio donde mirar es ese array.
//
// Cada compas puede traer:
//   mel  la melodia, como [nota, tiempos]
//   v2   una segunda voz con SU PROPIO ritmo, que no tiene por que coincidir
//        con el de la melodia
// Donde no hay v2 —los ocho compases de entrada— la segunda voz se calcula
// sola a partir del acorde. Donde la hay, manda la escrita.
//
// La pieza empieza en SOL MENOR (con si bemol y mi bemol) y pasa a SOL MAYOR
// en el compas trece. Eso obligo a dos cambios en el motor:
//   - La tabla de notas ahora conoce los bemoles. Antes solo tenia sostenidos
//     y un "Eb5" se convertia en NaN, es decir en silencio.
//   - La segunda voz ya no se saca de una escala fija. Se saca del ACORDE que
//     suena, que es lo unico que sigue siendo correcto cuando la pieza cambia
//     de tonalidad a mitad de camino.
//
// La marimba se sintetiza como lo que es: una barra golpeada. Un seno para el
// fundamental, otro cuatro veces mas agudo y muy corto para el golpe de la
// baqueta, y caida exponencial en los dos.

// Semitonos respecto al la. Los bemoles son alias de su sostenido: sin ellos
// un "Eb5" daba undefined, la frecuencia salia NaN y la nota no sonaba.
const NOTE_STEP = {
    C: -9, 'C#': -8, 'Db': -8, D: -7, 'D#': -6, 'Eb': -6, E: -5, F: -4,
    'F#': -3, 'Gb': -3, G: -2, 'G#': -1, 'Ab': -1, A: 0, 'A#': 1, 'Bb': 1, B: 2
};

// Distancia en semitonos desde el la central. Se trabaja con este numero y no
// con el nombre de la nota: asi la segunda voz se puede calcular por
// intervalos sin tener que inventarle un nombre al resultado.
function semis(n) {
    const step = NOTE_STEP[n.slice(0, -1)];
    return step + (parseInt(n.slice(-1), 10) - 4) * 12;
}

const hz = n => 440 * Math.pow(2, semis(n) / 12);
const hzOf = sm => 440 * Math.pow(2, sm / 12);

// bass y notes son lo que se toca (bajo y acompanamiento). tones son las
// notas del acorde SIN octava, y existen solo para armonizar la melodia: la
// segunda voz se busca entre ellas, de modo que nunca puede caer fuera de la
// armonia por mucho que la pieza cambie de tonalidad.
const CHORDS = {
    Gm: { bass: 'G2',  notes: ['G3', 'Bb3', 'D4'],  tones: ['G', 'Bb', 'D'] },
    Cm: { bass: 'C3',  notes: ['C4', 'Eb4', 'G4'],  tones: ['C', 'Eb', 'G'] },
    D7: { bass: 'D3',  notes: ['F#3', 'A3', 'C4'],  tones: ['D', 'F#', 'A', 'C'] },
    G:  { bass: 'G2',  notes: ['G3', 'B3', 'D4'],   tones: ['G', 'B', 'D'] },
    Em: { bass: 'E3',  notes: ['G3', 'B3', 'E4'],   tones: ['E', 'G', 'B'] },
    C:  { bass: 'C3',  notes: ['C4', 'E4', 'G4'],   tones: ['C', 'E', 'G'] },
    Am: { bass: 'A2',  notes: ['A3', 'C4', 'E4'],   tones: ['A', 'C', 'E'] },
    G7: { bass: 'G2',  notes: ['B3', 'D4', 'F4'],   tones: ['G', 'B', 'D', 'F'] },
    Eb: { bass: 'Eb3', notes: ['Eb4', 'G4', 'Bb4'], tones: ['Eb', 'G', 'Bb'] },
    E7: { bass: 'E3',  notes: ['G#3', 'B3', 'D4'],  tones: ['E', 'G#', 'B', 'D'] },
    Gm7:{ bass: 'G2',  notes: ['Bb3', 'D4', 'F4'],  tones: ['G', 'Bb', 'D', 'F'] },
    Bb: { bass: 'Bb2', notes: ['Bb3', 'D4', 'F4'],  tones: ['Bb', 'D', 'F'] },
    Dm: { bass: 'D3',  notes: ['D4', 'F4', 'A4'],   tones: ['D', 'F', 'A'] },
    F:  { bass: 'F2',  notes: ['F3', 'A3', 'C4'],   tones: ['F', 'A', 'C'] }
};

// Dieciseis compases. La melodia va como [nota, tiempos]; null es silencio.
const VALS = {
    bpm: 168,
    bars: [
        { ch: 'Gm', mel: [['D5', 0.5], ['Eb5', 0.5], ['D5', 0.5], ['Bb4', 0.5], ['D5', 0.5], ['Bb4', 0.5]] },
        { ch: 'Gm', mel: [['D5', 0.5], ['Eb5', 0.5], ['D5', 0.5], ['Bb4', 0.5], ['D5', 0.5], ['Bb4', 0.5]] },
        { ch: 'D7', mel: [['C5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5]] },
        { ch: 'D7', mel: [['C5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5]] },
        { ch: 'Gm', mel: [['G4', 0.5], ['A4', 0.5], ['Bb4', 0.5], ['C5', 0.5], ['D5', 0.5], ['Eb5', 0.5]] },
        { ch: 'Gm', mel: [['F5', 0.5], ['Eb5', 0.5], ['D5', 0.5], ['C5', 0.5], ['Bb4', 0.5], ['A4', 0.5]] },
        { ch: 'Cm', mel: [['C5', 0.5], ['D5', 0.5], ['Eb5', 0.5], ['F5', 0.5], ['G5', 0.5], ['F5', 0.5]] },
        { ch: 'D7', mel: [['Eb5', 1], ['D5', 1], ['C5', 1]] },
        { ch: 'Gm', mel: [['Bb4', 1.5], ['G4', 1.5]], v2: [['D4', 1], ['A4', 1], ['D5', 1]] },
        { ch: 'Gm', mel: [['G4', 0.5], ['A4', 0.5], ['Bb4', 0.5], ['C5', 0.5], ['D5', 1]], v2: [['D4', 1], ['A4', 1], ['D5', 1]] },
        { ch: 'Gm', mel: [['G5', 2], ['F5', 1]], v2: [['D4', 1], ['A4', 1], ['D5', 1]] },
        { ch: 'D7', mel: [['F5', 0.5], ['Eb5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 1]], v2: [['D4', 1], ['A4', 1], ['D5', 1]] },
        { ch: 'Gm', mel: [['D5', 1.5], ['C5', 0.5], ['Bb4', 1]], v2: [['G3', 3]] },
        { ch: 'Eb', mel: [['Bb4', 2], ['G4', 1]], v2: [['Eb3', 3]] },
        { ch: 'Cm', mel: [['C5', 1], ['Bb4', 1], ['A4', 1]], v2: [['Eb3', 1.5], ['G3', 1.5]] },
        { ch: 'D7', mel: [['A4', 3]], v2: [['F#3', 1.5], ['C4', 1.5]] },
        { ch: 'Gm', mel: [['Bb4', 2], ['A4', 1]], v2: [['D4', 1], ['G4', 1], ['D4', 1]] },
        { ch: 'Cm', mel: [['G4', 1.5], ['Eb5', 0.5], ['D5', 1]], v2: [['C4', 1], ['Eb4', 1], ['C4', 1]] },
        { ch: 'D7', mel: [['C5', 2], ['Bb4', 1]], v2: [['A3', 1], ['D4', 1], ['A3', 1]] },
        { ch: 'Gm', mel: [['A4', 1], ['G4', 2]], v2: [['D4', 1], ['Bb3', 1], ['G3', 1]] },
        { ch: 'Gm7', mel: [['D5', 2], ['Eb5', 1]], v2: [['F4', 1], ['Bb3', 1], ['D4', 1]] },
        { ch: 'Cm', mel: [['D5', 1.5], ['C5', 0.5], ['Bb4', 1]], v2: [['Eb4', 1], ['G4', 1], ['Eb4', 1]] },
        { ch: 'Eb', mel: [['G5', 2], ['F5', 1]], v2: [['Bb3', 1], ['Eb4', 1], ['G4', 1]] },
        { ch: 'D7', mel: [['Eb5', 1.5], ['D5', 0.5], ['C5', 1]], v2: [['A3', 1], ['F#4', 1], ['A4', 1]] },
        { ch: 'Cm', mel: [['Eb5', 1], ['D5', 1], ['C5', 1]], v2: [['G3', 1], ['C4', 1], ['Eb4', 1]] },
        { ch: 'Bb', mel: [['Bb4', 2], ['D5', 1]], v2: [['F3', 1], ['Bb3', 1], ['D4', 1]] },
        { ch: 'D7', mel: [['C5', 1.5], ['A4', 0.5], ['F#4', 1]], v2: [['A3', 1], ['D4', 1], ['C4', 1]] },
        { ch: 'Gm', mel: [['G4', 3]], v2: [['Bb3', 1], ['D4', 2]] },
        { ch: 'G',  mel: [['D5', 1], ['G5', 1.5], ['F#5', 0.5]], v2: [['B3', 1], ['D4', 1], ['B3', 1]] },
        { ch: 'Em', mel: [['E5', 2], ['D5', 1]], v2: [['G3', 1], ['B3', 1], ['E4', 1]] },
        { ch: 'D7', mel: [['C5', 1.5], ['B4', 0.5], ['A4', 1]], v2: [['F#3', 1], ['A3', 1], ['C4', 1]] },
        { ch: 'G',  mel: [['B4', 2], ['D5', 1]], v2: [['G3', 1], ['D4', 1], ['B3', 1]] },
        { ch: 'C',  mel: [['E5', 1], ['G5', 1], ['E5', 1]], v2: [['C4', 1], ['E4', 1], ['G4', 1]] },
        { ch: 'Am', mel: [['D5', 2], ['C5', 1]], v2: [['A3', 1], ['C4', 1], ['E4', 1]] },
        { ch: 'D7', mel: [['B4', 1.5], ['A4', 0.5], ['G4', 1]], v2: [['F#3', 1], ['A3', 1], ['D4', 1]] },
        { ch: 'Em', mel: [['E5', 3]], v2: [['G3', 1], ['B3', 1], ['E4', 1]] },
        { ch: 'G',  mel: [['D5', 1], ['G5', 2]], v2: [['B3', 1], ['D4', 1], ['G4', 1]] },
        { ch: 'Em', mel: [['F#5', 1.5], ['E5', 0.5], ['D5', 1]], v2: [['E4', 1], ['G4', 1], ['B3', 1]] },
        { ch: 'G7', mel: [['B4', 1], ['D5', 1], ['F5', 1]], v2: [['G3', 1], ['B3', 1], ['F4', 1]] },
        { ch: 'C',  mel: [['E5', 2], ['C5', 1]], v2: [['C4', 1], ['G3', 1], ['E4', 1]] },
        { ch: 'Cm', mel: [['Eb5', 1.5], ['C5', 0.5], ['G4', 1]], v2: [['C4', 1], ['Eb4', 1], ['G4', 1]] },
        { ch: 'G',  mel: [['B4', 2], ['D5', 1]], v2: [['G3', 1], ['D4', 1], ['B3', 1]] },
        { ch: 'E7', mel: [['G#4', 1], ['B4', 1], ['E5', 1]], v2: [['E4', 1], ['G#4', 1], ['D5', 1]] },
        { ch: 'Am', mel: [['C5', 1.5], ['B4', 0.5], ['A4', 1]], v2: [['A3', 1], ['E4', 1], ['C4', 1]] },
        { ch: 'D7', mel: [['F#5', 2], ['E5', 1]], v2: [['A3', 1], ['C4', 1], ['A3', 1]] },
        { ch: 'G',  mel: [['D5', 1], ['G5', 2]], v2: [['B3', 1], ['G4', 2]] },
        { ch: 'Cm', mel: [['Eb5', 1.5], ['D5', 0.5], ['Bb4', 1]], v2: [['C4', 1], ['Eb4', 1], ['G4', 1]] },
        { ch: 'G',  mel: [['B4', 3]], v2: [['G3', 1], ['D4', 2]] },
        { ch: 'Cm', mel: [['Eb5', 1.5], ['D5', 0.5], ['C5', 1]], v2: [['G3', 1], ['C4', 1], ['Eb4', 1]] },
        { ch: 'G',  mel: [['B4', 2], ['A4', 1]], v2: [['G3', 1], ['D4', 1], ['B3', 1]] },
        { ch: 'Cm', mel: [['G4', 1.5], ['Eb4', 0.5], ['D4', 1]], v2: [['C4', 3]] },
        { ch: 'G',  mel: [['G4', 3]], v2: [['D4', 3]] }
    ]
};

const music = { on: true, gain: null, next: 0, bar: 0, timer: null };

function marimba(freq, t, dur, vol) {
    const ctx = audio.ctx;
    if (!ctx || !music.gain) return;

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(vol, t + 0.008);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(g1);
    g1.connect(music.gain);
    o1.start(t);
    o1.stop(t + dur + 0.03);

    // El golpe de la baqueta: cuarto armonico, muy corto. Sin el, la marimba
    // suena a flauta.
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 4.01;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(vol * 0.3, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.3);
    o2.connect(g2);
    g2.connect(music.gain);
    o2.start(t);
    o2.stop(t + dur * 0.35 + 0.03);
}

// La marimba guatemalteca casi nunca toca la melodia sola: va en terceras,
// dos baquetas a la vez. Es lo que mas distingue su sonido, y sin ello el
// vals suena a piano de juguete por muy bien que esten las notas.
//
// La segunda voz se busca entre las notas del ACORDE que suena, no en una
// escala fija. La primera version bajaba dos grados de la menor y punto, lo
// cual funcionaba mientras la pieza estuvo en la menor; con una que empieza
// en sol menor y se muda a sol mayor a mitad, esa cuenta devuelve notas de
// otra tonalidad. Buscando en el acorde, la segunda voz no puede desafinar
// aunque la pieza module donde quiera.
//
// De entre las candidatas se prefiere la que cae a una tercera mayor (cuatro
// semitonos); si no hay, la mas cercana a esa distancia. El margen va de la
// tercera menor a la sexta menor: mas cerca suena a golpe sucio y mas lejos
// deja de leerse como una sola linea.
function harmonyBelow(n, ch) {
    const top = semis(n);
    let best = null, bestScore = 99;
    for (const t of ch.tones) {
        const base = NOTE_STEP[t];
        for (let oct = 2; oct <= 6; oct++) {
            const cand = base + (oct - 4) * 12;
            const gap = top - cand;
            if (gap < 3 || gap > 8) continue;
            const score = Math.abs(gap - 4);
            if (score < bestScore || (score === bestScore && cand > best)) {
                best = cand;
                bestScore = score;
            }
        }
    }
    return best;
}

// Un golpe de baqueta, con su repique si la nota es larga. Una barra de
// madera no sostiene: lo que en un violin es una nota larga, en marimba es un
// redoble. Solo a partir de dos tiempos: repicar tambien las de tiempo y
// medio emborrona el ritmo punteado del vals, que es la mitad de su caracter.
function strike(freq, t, dur, vol, len) {
    const hits = len >= 2 ? Math.round(len * 2.5) : 1;
    const step = dur / hits;
    for (let k = 0; k < hits; k++) {
        marimba(freq, t + k * step,
                hits > 1 ? step * 1.6 : dur * 0.92,
                k === 0 ? vol : vol * 0.6);
    }
}

function scheduleBar(bar, t0, beat) {
    const ch = CHORDS[bar.ch];
    const hasV2 = !!bar.v2;

    // Bajo en el primer tiempo y acordes en el segundo y el tercero: el patron
    // del vals, y lo que hace que suene a vals y no a sucesion de notas.
    marimba(hz(ch.bass), t0, beat * 1.5, 0.5);

    // Cuando el arreglo trae su propia segunda voz, esos acordes bajan mucho
    // de volumen: la v2 ya hace de relleno armonico, y sonando los dos a la
    // vez el compas se emborrona. Pero no desaparecen, porque hay compases con
    // v2 de nota tenida y sin ellos se perderia el pulso de vals.
    const compVol = hasV2 ? 0.085 : 0.16;
    for (let b = 1; b < 3; b++) {
        for (const n of ch.notes) {
            marimba(hz(n), t0 + b * beat, beat * 0.75, compVol);
        }
    }

    let t = t0;
    for (const [n, len] of bar.mel) {
        if (n) {
            strike(hz(n), t, beat * len, 0.34, len);
            // La tercera automatica SOLO donde el arreglo no escribio nada.
            // Si hay v2, manda la v2: inventarle una voz encima a un arreglo
            // que ya trae la suya es pisarlo.
            if (!hasV2) {
                const low = harmonyBelow(n, ch);
                if (low !== null) strike(hzOf(low), t, beat * len, 0.21, len);
            }
        }
        t += beat * len;
    }

    // Segunda voz escrita: lleva su propio ritmo, que no tiene por que
    // coincidir con el de la melodia, asi que va en su propia linea de tiempo.
    if (hasV2) {
        let t2 = t0;
        for (const [n, len] of bar.v2) {
            if (n) strike(hz(n), t2, beat * len, 0.22, len);
            t2 += beat * len;
        }
    }
}

function musicTick() {
    if (!music.on || !audio.ctx || !music.gain) return;
    const beat = 60 / VALS.bpm;
    const barDur = beat * 3;
    const now = audio.ctx.currentTime;
    if (music.next < now) music.next = now + 0.06;
    // Se programa con medio segundo de adelanto: Web Audio suena solo, y asi
    // un frame lento no abre un hueco en el compas.
    while (music.next < now + 0.6) {
        scheduleBar(VALS.bars[music.bar % VALS.bars.length], music.next, beat);
        music.next += barDur;
        music.bar++;
    }
}

function startMusic() {
    if (!audio.ctx) return;
    if (!music.gain) {
        music.gain = audio.ctx.createGain();
        // Por debajo de los efectos a proposito: es fondo, y tapar el aviso
        // de un golpe con un acorde seria cambiar musica por informacion.
        music.gain.gain.value = 0.075;
        music.gain.connect(audio.ctx.destination);
    }
    music.gain.gain.value = music.on ? 0.075 : 0;
    if (!music.timer) music.timer = setInterval(musicTick, 90);
    musicTick();
}

function setMusic(on) {
    music.on = on;
    if (music.gain) music.gain.gain.value = on ? 0.075 : 0;
    if (on) startMusic();
    if (dom.musicPref) {
        dom.musicPref.textContent = 'Música: ' + (on ? 'activada' : 'apagada');
        dom.musicPref.setAttribute('aria-pressed', String(on));
    }
    store.set('sacbe-music', on ? '1' : '0');
}

function setSound(on) {
    audio.on = on;
    save.sound = on;
    if (dom.soundPref) {
        dom.soundPref.textContent = 'Sonido: ' + (on ? 'activado' : 'apagado');
        dom.soundPref.setAttribute('aria-pressed', String(on));
    }
    if (dom.soundBtn) {
        dom.soundBtn.textContent = on ? '♪' : '✕';
        dom.soundBtn.setAttribute('aria-label', on ? 'Silenciar sonido' : 'Activar sonido');
    }
    store.set('sacbe-sound', on ? '1' : '0');
}

// ===========================================================================
// Three.js: escena
// ===========================================================================
let renderer, scene, camera;
let roadMesh, kerbMesh, baseMesh, landMesh, propMesh, ridgeMesh, skyMesh, forkMesh;
let roadGroup, landGroup;
let playerGroup, playerBody, playerParts, playerMats, shadowMesh;
let jaguar, quetzal, groundMesh, sunLight, hemiLight;
let particleMesh;

// Materiales compartidos por todo lo tematizable. Cambiar de departamento es
// reescribir estos colores, no reconstruir la escena.
const mat = {};

const obstacles = [];
const pickups = [];
const platforms = [];
const boosts = [];
const crossings = [];
const warns = [];
const hazards = [];
const particles = [];

// Geometria unica compartida por todo el escenario
const BOX = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

// Geometrias de las recogidas, una por tipo
const GEO = {
    jade:   new THREE.OctahedronGeometry(0.42),
    shield: new THREE.TorusGeometry(0.44, 0.15, 6, 12),
    magnet: new THREE.TorusGeometry(0.42, 0.14, 6, 10, Math.PI),
    double: new THREE.IcosahedronGeometry(0.44),
    amber:  new THREE.DodecahedronGeometry(0.42),
    flight: new THREE.ConeGeometry(0.4, 0.95, 4)
};

const cam = { y: 6.6, aimY: 1.6, aimZ: -16, fov: 60 };

function layoutCamera() {
    const aspect = window.innerWidth / window.innerHeight;

    if (aspect < 0.85) {
        // Vertical (movil): la camara sube y apunta mas abajo, de modo que el
        // horizonte queda alto y la calzada ocupa el encuadre. El campo se
        // abre un poco para compensar lo estrecho de la vista.
        cam.y = 8.4; cam.aimY = 0.1; cam.aimZ = -21; cam.fov = 72;
    } else if (aspect < 1.4) {
        cam.y = 7.4; cam.aimY = 0.9; cam.aimZ = -18; cam.fov = 66;
    } else {
        cam.y = 6.6; cam.aimY = 1.6; cam.aimZ = -16; cam.fov = 60;
    }

    camera.fov = cam.fov;
    camera.aspect = aspect;
    camera.position.y = cam.y;
    camera.updateProjectionMatrix();
}

function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return false;
        // Se suelta el contexto: dejarlo vivo consume uno de los pocos que el
        // navegador concede por pestana, y el juego necesita el suyo.
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return true;
    } catch (e) { return false; }
}

let skyTexture, skyCanvas, skyCtx;

function buildScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.insertBefore(renderer.domElement, document.body.firstChild);

    scene = new THREE.Scene();

    // Cielo en degradado. Un color plano aplanaba el horizonte; con dos
    // paradas de color se lee la altura y ademas permite el viaje por el pais.
    // Es un canvas de 4x64 px: se redibuja unas 8 veces por segundo, que es
    // imperceptible en coste y suficiente para una transicion suave.
    skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 64;
    skyCtx = skyCanvas.getContext('2d');
    skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTexture;

    // La niebla oculta el reciclado: los objetos aparecen fundiendose, no de golpe
    scene.fog = new THREE.Fog(0x6f9a86, 55, 185);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, cam.y, 14);
    layoutCamera();
    camera.lookAt(0, cam.aimY, cam.aimZ);

    // --- Luces: sin shadow maps, demasiado caro para lo que aporta aqui ---
    hemiLight = new THREE.HemisphereLight(0xe8f4ea, 0x2f5a49, 2.3);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff2d6, 2.1);
    sunLight.position.set(-9, 20, 7);
    scene.add(sunLight);
    // Relleno tenue desde el lado opuesto, para que las caras en sombra de
    // estelas y dinteles no queden planas del todo
    const fill = new THREE.DirectionalLight(0xbfd8e8, 0.55);
    fill.position.set(8, 6, -10);
    scene.add(fill);

    buildMaterials();
    buildGround();
    buildRoad();
    buildLandmarks();
    buildProps();
    buildRidge();
    buildSky();
    buildPools();
    buildParticles();
    buildPlayer();
    buildJaguar();
    buildQuetzal();
    applyBlend(save.start);
}

// --- Materiales compartidos ---
function buildMaterials() {
    const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra));

    mat.kerb   = lam(0xb9a888);
    mat.stone  = lam(0xa1937f);      // cuerpo de estelas y postes del dintel
    mat.accent = lam(0xc8862f);      // remates: capiteles, vigas, tejados
    mat.water  = lam(0x14776a);      // lo que llena el hueco del cenote
    mat.pit    = new THREE.MeshBasicMaterial({ color: 0x040d0b });   // el hueco
    mat.ground = lam(0x2f5a49);

    // Terreno elevado: la superficie imita la losa de la calzada y el costado
    // el bordillo, para que se lea como calzada que sube y no como un cajon.
    mat.deck     = lam(0xefe6d2);
    mat.deckSide = lam(0xb9a888);

    // Las amenazas NO se tematizan. Todo lo demas cambia de color ocho veces
    // por vuelta, y una fuente de dano que a veces es clara sobre fondo oscuro
    // y a veces al reves se vuelve ilegible justo cuando importa. Silueta
    // oscura y filo rojo, iguales en los ocho departamentos.
    // La placa de impulso tampoco se tematiza: es informacion de juego, y
    // tiene que decir lo mismo en las doce zonas.
    // Senalizacion: verde de carretera y gris de poste, iguales en las doce
    // zonas. Un rotulo que cambiase de color por departamento dejaria de
    // leerse como senal y pasaria a ser decorado.
    mat.signPost  = lam(0x8d9298);
    mat.island    = lam(0xb9b2a4);
    mat.islandTop = lam(0xe8e2d4);

    mat.boostPad  = lam(0x0d3a33);
    mat.boostMark = lam(0x4affd0, { emissive: 0x4affd0, emissiveIntensity: 0.7 });

    mat.danger     = lam(0x4a352e);
    // Emisivo: en las zonas de noche —Tajumulco, Chichicastenango, el Fuego—
    // una silueta oscura sobre fondo oscuro no se ve venir, y una amenaza que
    // no se ve venir no se puede esquivar.
    mat.dangerTrim = lam(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.5 });

    // La vaca y la camioneta son las dos unicas amenazas que no son piedra ni
    // bicho de Xibalba, y tienen que reconocerse de lejos por lo que SON: si
    // se pintaran del pardo de peligro se leerian como otra piedra mas y el
    // aviso de la senal dejaria de significar nada.
    mat.cow      = lam(0xf1ece2);
    mat.cowSpot  = lam(0x2c2823);
    mat.cowSkin  = lam(0xd98c74);
    // Camioneta: el azul y el rojo de las Bluebird repintadas, que es lo que
    // de verdad se cruza uno en la CA-1.
    mat.bus      = lam(0x2f6fd0);
    mat.busTrim  = lam(0xe23b3b);
    mat.busGlass = lam(0x9fd8e8, { emissive: 0x2b4a55, emissiveIntensity: 0.4 });
    mat.busTire  = lam(0x1b1b1b);

    // Emisivos de las recogidas: uno por tipo, para que el pulso de brillo se
    // anime una vez por frame en vez de una vez por pieza.
    mat.jade = lam(C.jade, { emissive: C.jade, emissiveIntensity: 0.35 });
    for (const k of POWER_KEYS) {
        mat[k] = lam(POWERS[k].color, { emissive: POWERS[k].color, emissiveIntensity: 0.5 });
    }
}

// --- Suelo ---
// Es un unico plano estatico. No necesita desplazarse porque es de color
// uniforme: la sensacion de avance la dan la calzada y el horizonte. Sin el,
// los hitos del fondo parecian flotar sobre la bruma.
const GROUND_Y = -1.02;
const GROUND_Z = -320;

function buildGround() {
    groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 900), mat.ground);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(0, GROUND_Y, GROUND_Z);
    scene.add(groundMesh);
}

// La explanada tiene que bajar con la calzada.
//
// Era ESTE el motivo de que en la bajada no se viera lo que venia. La calzada
// se hunde quince unidades y el suelo se quedaba clavado a -1,02: a sesenta
// unidades por delante el firme ya iba ocho por DEBAJO del plano, asi que el
// plano tapaba literalmente la calzada, los obstaculos y todo lo demas. Lo que
// se veia era una pared de color de suelo.
//
// Se inclina, que para un plano de color liso es suficiente. Y se ajusta a la
// parte de CERCA, no a la del fondo: el perfil de la cuesta se va aplanando
// con la distancia, asi que la tangente de cerca queda por debajo del resto
// del trazado y el plano no vuelve a asomar por encima en ningun punto.
// Con la inclinacion puesta, la altura del plano en una z vale
//     y(z) = -z * e + GROUND_Y
// asi que exigir que quede por debajo de la calzada en un punto es despejar e.
// Se hace en cinco puntos repartidos hasta donde llega la bruma y se toma el
// mas exigente: una sola tangente no basta porque el perfil de la cuesta no es
// una recta, y medido dejaba dos puntos con la calzada por debajo del plano.
const GROUND_PROBES = [-20, -35, -55, -85, -125, -180];

function updateGroundTilt() {
    // Exigir  y(z) <= riseAtZ(z) - HOLGURA  y despejar e. La constante sale de
    // HOLGURA - GROUND_Y = 0.9 - 1.02, y es lo que hace que en llano no se
    // pida nada: con la calzada a su altura de siempre el plano ya cumple de
    // sobra y el angulo se queda en cero.
    //
    // Se mira SIEMPRE, no solo en las cuestas. La ondulacion de siempre ya
    // hundia el trazado un par de unidades por debajo del plano a ciento
    // ochenta, justo en el limite de la bruma: poco, pero era lo mismo que
    // pasaba en la bajada a lo grande, y corregirlo no cuesta nada.
    let e = 0;
    for (const z of GROUND_PROBES) {
        e = Math.min(e, (riseAtZ(z) + 0.12) / -z);
    }
    groundMesh.rotation.x = -Math.PI / 2 + e;
    groundMesh.position.y = GROUND_Y - GROUND_Z * e;
}

// --- Calzada: losas alternadas para que se perciba el avance ---
// Van dentro de un Group. Como el patron de dos tonos se repite cada
// ROAD_PERIOD unidades, desplazar la calzada es mover el Group y aplicar un
// modulo: las 180 instancias no se tocan nunca despues de construirlas. Solo
// el color se reescribe, y unicamente al cambiar de departamento.
function buildRoad() {
    roadGroup = new THREE.Group();
    scene.add(roadGroup);

    roadMesh = new THREE.InstancedMesh(
        BOX,
        // Blanco a proposito: el color real lo aporta setColorAt. Poner aqui
        // el mismo tono lo multiplicaria por si mismo y saldria oscurecido.
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        TILE_COUNT * ROAD_CELLS
    );
    roadMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * ROAD_CELLS * 3), 3
    );

    // Todas las celdas arrancan apagadas, y esto NO es una precaucion
    // decorativa. Una instancia recien creada lleva la matriz identidad: un
    // cubo de 1x1x1 en el origen. Y el origen es justo donde vive el jugador.
    //
    // Como updateRoadCurve solo apaga las celdas que ALGUNA VEZ estuvieron
    // encendidas, las que una zona no llega a usar —diecisiete de dieciocho en
    // Tikal— se quedaban con esa identidad, y con el color en cero del buffer
    // recien reservado. Resultado: un cubo negro pegado a los pies del
    // corredor que lo seguia a todas partes. Solo Antigua se libraba, porque
    // su adoquin de seis por tres gasta las dieciocho.
    for (let i = 0; i < TILE_COUNT * ROAD_CELLS; i++) {
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        roadMesh.setMatrixAt(i, dummy.matrix);
    }
    roadMesh.instanceMatrix.needsUpdate = true;
    // Sin descarte por frustum: three.js lo calcula sobre la caja de la
    // geometria base, que en un InstancedMesh no dice nada de donde estan
    // realmente las instancias. Con la calzada curvada, el descarte empezaba a
    // equivocarse y hacia parpadear el tramo lejano.
    roadMesh.frustumCulled = false;
    roadGroup.add(roadMesh);

    // Bordillos: los sacbeob tenian los cantos levantados
    // El otro ramal. Va sin el detalle por celdas de la calzada principal: solo
    // se ve de refilon y unos segundos, y darle adoquin propio seria pagar mil
    // matrices por frame para algo que se esta yendo de plano. Losa, sub-base y
    // dos bordillos por tramo, y basta.
    forkMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), TILE_COUNT * 4
    );
    forkMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * 4 * 3), 3
    );
    forkMesh.frustumCulled = false;
    for (let i = 0; i < TILE_COUNT * 4; i++) {
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        forkMesh.setMatrixAt(i, dummy.matrix);
    }
    roadGroup.add(forkMesh);

    // Sub-base: una losa corrida bajo las celdas, doce centimetros mas abajo.
    // Sin ella las juntas del adoquin son agujeros por los que se ve el suelo.
    baseMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), TILE_COUNT
    );
    baseMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * 3), 3
    );
    baseMesh.frustumCulled = false;
    roadGroup.add(baseMesh);

    // El bordillo tambien lleva color por instancia: cambia de material en la
    // misma linea que la calzada, y con un solo material compartido se habria
    // ido fundiendo de forma global mientras el firme daba el salto.
    kerbMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), TILE_COUNT * 2
    );
    kerbMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * 2 * 3), 3
    );
    kerbMesh.frustumCulled = false;
    roadGroup.add(kerbMesh);
}

// ===========================================================================
// Curvas
// ===========================================================================
// Dos senos de periodo largo y primo entre si: el trazado nunca se repite de
// forma reconocible y no hace falta guardar ni generar nada.
//
// La clave de todo esto es que la curva se ancla a la DISTANCIA RECORRIDA, no
// a la pantalla. Cada objeto tiene una coordenada de trazado invariante
// s = distancia - z (los dos crecen a la vez, asi que la resta no cambia), de
// modo que su desplazamiento lateral se calcula UNA vez al aparecer y luego
// solo se le resta el del jugador. La curva sale practicamente gratis.
// La curva cerrada se suma AQUI DENTRO y no aparte, para que la hereden por
// la misma via la calzada, los objetos que ya guardaron su desplazamiento y la
// camara. Que sea funcion pura de la coordenada de trazado es lo que permite
// que un objeto la calcule una vez y no se descuadre nunca.
function curveX(s) {
    return CURVE_A1 * Math.sin(s / CURVE_L1) +
           CURVE_A2 * Math.sin(s / CURVE_L2 + 1.7) +
           turnX(s);
}

function curveY(s) {
    return CURVE_AY * Math.sin(s / CURVE_LY + 0.6) - slopeAt(s) * SLOPE_DROP;
}

// Separacion de un ramal respecto al eje de la bifurcacion, para una
// coordenada de trazado dada. Cero antes de la X y creciendo suave despues.
function forkSpread(s) {
    const f = game.fork;
    if (!f.active) return 0;
    const t = (s - f.s0) / FORK_LEN;
    if (t <= 0) return 0;
    if (t >= 1) return FORK_SPREAD;
    return FORK_SPREAD * t * t * (3 - 2 * t);
}

// Desplazamiento lateral de un ramal en la z dada.
//
// El segundo termino es el truco: se resta la separacion del ramal que lleva
// EL JUGADOR en su propia posicion. Con eso su calzada queda siempre centrada
// —el mundo se recoloca sobre ella— y la otra se abre hacia fuera al doble de
// velocidad hasta salirse de plano. Y en cuanto la bifurcacion queda atras,
// los dos terminos se cancelan solos y todo vuelve a la normalidad sin tener
// que desactivar nada.
function forkDX(z, band) {
    const f = game.fork;
    if (!f.active) return 0;
    // El ramal que NO se tomo se abre cada vez mas a partir del momento de
    // elegir. Como la separacion vale cero en la X y crece hacia el fondo,
    // multiplicarla entera hace que el ramal PIVOTE sobre el cruce: se ve
    // curvarse y marcharse, en vez de deslizarse de lado en bloque.
    const mio = f.chosen !== 0 && band === f.chosen;
    const k = mio ? 1 : 1 + f.away * f.away * 5;
    return band * forkSpread(game.distance - z) * k -
           f.chosen * forkSpread(game.distance);
}

// Cuanto ha BAJADO ya la calzada en una coordenada de trazado: cero antes de
// la cuesta, uno despues, y una S suave en medio.
//
// La primera version usaba un seno, que sube y vuelve a bajar. Eso no es una
// bajada: es un hoyo. Delante se abria un socavon de trece unidades y detras
// se cerraba solo, asi que el camino desaparecia del encuadre justo al entrar
// —que es exactamente lo que se veia—. Una cuesta de verdad no vuelve: se
// baja y uno se queda abajo. Como todas las alturas se miden restando la del
// propio jugador, quedarse abajo no cuesta nada.
function slopeAt(sc) {
    if (game.slopeS0 < 0) return 0;
    const t = (sc - game.slopeS0) / SLOPE_LEN;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
}

// Lo empinado que esta la cuesta en un punto: la derivada de lo anterior,
// normalizada. Esto SI es una campana —arranca en cero, aprieta en el medio y
// afloja al final— y es lo que mueven la velocidad y el cabeceo de la camara,
// que tienen que volver a su sitio al terminar.
function slopeSteep(sc) {
    if (game.slopeS0 < 0) return 0;
    const t = (sc - game.slopeS0) / SLOPE_LEN;
    if (t <= 0 || t >= 1) return 0;
    return 4 * t * (1 - t);
}

// --- Curva cerrada ---
// Desplazamiento lateral propio de la curva: sale de cero, cierra hacia el
// lado del cartel y SE QUEDA ahi.
//
// La primera version usaba un seno, que va y vuelve. Eso no es una curva: es
// una ese. Medido, la calzada a ciento cincuenta unidades se iba treinta a la
// derecha y luego cuarenta a la izquierda, o sea que el cartel de "curva a la
// derecha" acababa anunciando una curva a la izquierda. Una carretera que
// tuerce se queda torcida, y aqui eso ademas sale gratis: el desplazamiento
// siempre se mide restando el del propio jugador, asi que quedarse desviado no
// desplaza nada y apagar la curva al final no mueve un pixel.
function turnX(sc) {
    const T = game.turn;
    if (!T.active) return 0;
    const t = (sc - T.s0) / TURN_LEN;
    if (t <= 0) return 0;
    if (t >= 1) return T.dir * TURN_AMP;
    return T.dir * TURN_AMP * t * t * (3 - 2 * t);
}

// Cuanto aprieta la curva ahi: uno en el punto mas cerrado. Manda sobre la
// velocidad y sobre la cuenta de la fuerza centrifuga.
function turnGrip(sc) {
    const T = game.turn;
    if (!T.active) return 0;
    const t = (sc - T.s0) / TURN_LEN;
    if (t <= 0 || t >= 1) return 0;
    return Math.sin(t * Math.PI);
}

// --- Estrechamiento ---
// Fraccion del ancho de calzada que queda en pie. Uno fuera del tramo, un
// tercio en el medio, con una transicion a cada extremo: sin ella la calzada
// se cortaria en seco y no habria forma de leer por donde hay que entrar.
function narrowAt(sc) {
    if (game.narrowS0 < 0) return 1;
    const a = sc - game.narrowS0;
    if (a <= 0 || a >= NARROW_LEN) return 1;
    let t = 1;
    if (a < NARROW_TAPER) t = a / NARROW_TAPER;
    else if (a > NARROW_LEN - NARROW_TAPER) t = (NARROW_LEN - a) / NARROW_TAPER;
    t = t * t * (3 - 2 * t);
    return 1 - t * (1 - NARROW_MIN);
}

// La coordenada de trazado de un punto ya pasada la X.
const pastFork = z => game.fork.active && (game.distance - z) > game.fork.s0;

// Mascara de distancia: 0 en la zona de juego, 1 en el fondo. Es lo que hace
// que el giro y la ondulacion sean decorado y no un problema de geometria.
function curveMask(z) {
    const d = -z;
    if (d <= CURVE_NEAR) return 0;
    const t = Math.min(1, (d - CURVE_NEAR) / (CURVE_FULL - CURVE_NEAR));
    return t * t * (3 - 2 * t);              // smoothstep
}

// Desplazamiento visible de un objeto: cuanto se aparta de su carril respecto
// a donde esta el jugador. En la zona de juego vale cero, y por eso ni las
// colisiones ni los tramos elevados se enteran de que la calzada gira.
const curveOf = o => (o.curve - game.curveBase) * curveMask(o.z);
// La ondulacion de siempre es decorado y solo existe lejos; la bajada NO: si
// se enmascarase cerca, la cuesta arrancaria a diez metros de los pies y se
// veria el escalon. Por eso van separadas y solo una lleva mascara.
const slopeOfZ = z => -slopeAt(game.distance - z) * SLOPE_DROP;
const riseOf = o => {
    const sl = slopeOfZ(o.z);
    return (o.rise - sl - (game.riseBase - game.slopeBase)) * curveMask(o.z) +
           (sl - game.slopeBase);
};

// Lo mismo para una z arbitraria (camara, jaguar, quetzal, piezas sueltas de
// un tramo elevado), que no tienen coordenada de trazado guardada.
const curveAtZ = z => (curveX(game.distance - z) - game.curveBase) * curveMask(z);
function riseAtZ(z) {
    const s = game.distance - z;
    const dr = -slopeAt(s) * SLOPE_DROP;
    return (curveY(s) - dr - (game.riseBase - game.slopeBase)) * curveMask(z) +
           (dr - game.slopeBase);
}
// Lo mismo para la calzada, que ya tiene calculada la coordenada de trazado.
function riseAtS(s, z) {
    const dr = -slopeAt(s) * SLOPE_DROP;
    return (curveY(s) - dr - (game.riseBase - game.slopeBase)) * curveMask(z) +
           (dr - game.slopeBase);
}

// Se conserva por compatibilidad con las llamadas sueltas, pero ya no hace
// nada: la bajada vive dentro de curveY, que es por donde pasan todos.
function slopeDropAtZ(z) { return 0; }

// La calzada si hay que recomponerla entera cada frame: sus losas van dentro
// de un Group que se mueve con un modulo, asi que la z con la que se dibujan
// cambia de forma continua y su desplazamiento lateral tambien. Son 180
// matrices por FRAME; el codigo original hacia ese mismo trabajo por PASO DE
// SIMULACION, que a 60 Hz eran seis veces mas.
// Region a la que pertenece un punto del trazado. Cada losa consulta la suya,
// asi que el cambio de firme es una LINEA en el mundo que se ve venir de
// lejos, no un fundido global: llegar a Antigua es ver aparecer el adoquin.
// Region del firme en un punto del trazado. Con la ruta quieta entre cruces,
// el firme es uniforme; lo que hace falta es que el CAMBIO tenga una linea en
// el mundo, y esa linea es la propia bifurcacion: al tomar la salida se apunta
// una coordenada de trazado unas decenas de unidades por delante, y de ahi en
// adelante la calzada ya es la del departamento nuevo. Se ve venir el adoquin.
function roadRegionOf(s) {
    if (game.roadS0 >= 0 && s < game.roadS0) return game.roadFrom;
    const i = Math.floor(game.routePos) % REGION_N;
    return i < 0 ? i + REGION_N : i;
}

// Bandera de celda ocupada. Los tramos con pocas celdas dejarian las
// sobrantes con la matriz de la region anterior, asi que hay que apagarlas;
// pero solo la primera vez, o cada frame reescribiria mil matrices en cero.
const roadCellOn = new Uint8Array(TILE_COUNT * ROAD_CELLS);
// Region que tenia cada losa la ultima vez. El color de la calzada solo
// cambia cuando una losa cruza la linea entre departamentos, es decir un
// punado de veces por minuto; subir el buffer de color entero en cada frame
// era medio megabyte por segundo a la GPU para reescribir los mismos valores.
const roadTileRegion = new Int8Array(TILE_COUNT).fill(-1);
const _rc = new THREE.Color();

// La calzada si hay que recomponerla entera cada frame: sus losas van dentro
// de un Group que se mueve con un modulo, asi que la z con la que se dibujan
// cambia de forma continua, y con ella su curva, su altura y su material. El
// codigo original hacia este mismo trabajo por PASO DE SIMULACION, que a 60 Hz
// eran seis veces mas.
// Tramos de calzada que ahora mismo NO existen. Se recogen una vez por frame
// en vez de preguntarle a los treinta obstaculos por cada una de las sesenta
// losas, que serian mil ochocientas comprobaciones.
const gapZ0 = new Float32Array(6);
const gapZ1 = new Float32Array(6);
let gapCount = 0;

function collectGaps() {
    gapCount = 0;
    for (const o of obstacles) {
        if (!o.active || o.type !== VACIO || gapCount >= 6) continue;
        gapZ0[gapCount] = o.z - VACIO_LEN / 2;
        gapZ1[gapCount] = o.z + VACIO_LEN / 2;
        gapCount++;
    }
}

function inGap(z) {
    for (let g = 0; g < gapCount; g++) {
        if (z > gapZ0[g] && z < gapZ1[g]) return true;
    }
    return false;
}

// Esconde una instancia sacandola del mundo y encogiendola: mas barato que
// quitarla de la malla y sin agujeros en el indice.
function hideAt(mesh, id) {
    dummy.position.set(0, -999, 0);
    dummy.scale.set(0.0001, 0.0001, 0.0001);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(id, dummy.matrix);
}

function updateRoadCurve() {
    updateGroundTilt();
    const off = roadGroup.position.z;
    let colorDirty = false;
    collectGaps();

    for (let i = 0; i < TILE_COUNT; i++) {
        const zLocal = ROAD_FROM + i * TILE_DEPTH;
        const zWorld = zLocal + off;
        const mask = curveMask(zWorld);
        // El desplazamiento del ramal NO pasa por la mascara de distancia: la
        // bifurcacion tiene que verse abrirse justo delante de los pies, que es
        // donde se decide. Es lo contrario que la curva, que solo existe lejos.
        const dx = (curveX(game.distance - zWorld) - game.curveBase) * mask +
                   forkDX(zWorld, game.fork.mainBand);
        const dy = riseAtS(game.distance - zWorld, zWorld);

        // Dentro de un vacio la losa no se dibuja: el agujero es de verdad, no
        // una mancha oscura pintada encima. Es lo que hace que se lea como un
        // sitio por el que se puede caer.
        if (inGap(zWorld)) {
            for (let c = 0; c < ROAD_CELLS; c++) {
                const id = i * ROAD_CELLS + c;
                if (!roadCellOn[id]) continue;
                roadCellOn[id] = 0;
                dummy.position.set(0, -999, 0);
                dummy.scale.set(0.0001, 0.0001, 0.0001);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                roadMesh.setMatrixAt(id, dummy.matrix);
            }
            dummy.position.set(0, -999, 0);
            dummy.scale.set(0.0001, 0.0001, 0.0001);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            baseMesh.setMatrixAt(i, dummy.matrix);
            kerbMesh.setMatrixAt(i * 2, dummy.matrix);
            kerbMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
            // La losa vuelve a existir al salir del hueco, y entonces hay que
            // repintarla: se invalida su cache de region.
            roadTileRegion[i] = -1;
            continue;
        }

        const ri = roadRegionOf(game.distance - zWorld);
        const R = REGIONS[ri];
        const recolor = roadTileRegion[i] !== ri;
        if (recolor) { roadTileRegion[i] = ri; colorDirty = true; }
        const cuts = R.road[0], rows = R.road[1], gap = R.road[2], jit = R.road[3];
        const cw = ROAD_WIDTH / cuts;
        const cd = TILE_DEPTH / rows;
        // Ancho que queda en pie. La piedra no se encoge: se RECORTA contra el
        // borde. Escalarla habria hecho que el firme se estrechase de tamano
        // en vez de acabarse, y lo que hay que leer ahi es que la calzada se
        // acaba, no que las piedras son mas pequenas.
        const halfW = ROAD_WIDTH * narrowAt(game.distance - zWorld) / 2;

        let c = 0;
        for (let rr = 0; rr < rows; rr++) {
            for (let cc = 0; cc < cuts; cc++, c++) {
                const id = i * ROAD_CELLS + c;
                let x0 = -ROAD_WIDTH / 2 + cw * cc;
                let x1 = x0 + cw;
                if (x0 < -halfW) x0 = -halfW;
                if (x1 > halfW) x1 = halfW;
                if (x1 - x0 < 0.03) {
                    if (roadCellOn[id]) {
                        roadCellOn[id] = 0;
                        hideAt(roadMesh, id);
                        // Se salta el repintado, asi que hay que invalidar la
                        // cache: si el firme cambia de departamento mientras
                        // esta escondida, al reaparecer llevaria el color de
                        // la region anterior para siempre.
                        roadTileRegion[i] = -1;
                    }
                    continue;
                }
                // Desnivel de piedra a piedra, determinista por indice: si
                // fuera aleatorio por frame la calzada herviria.
                const bump = jit ? (((i * 7 + c * 13) % 7) - 3) / 3 * jit : 0;
                dummy.position.set(
                    dx + (x0 + x1) / 2,
                    -0.5 + dy + bump,
                    zLocal - TILE_DEPTH / 2 + cd * (rr + 0.5)
                );
                dummy.scale.set((x1 - x0) * gap, 1, cd * gap);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                roadMesh.setMatrixAt(id, dummy.matrix);
                if (recolor) {
                    roadMesh.setColorAt(id, _rc.setHex((i + cc + rr) % 2 ? R.roadA : R.roadB));
                }
                roadCellOn[id] = 1;
            }
        }
        for (; c < ROAD_CELLS; c++) {
            const id = i * ROAD_CELLS + c;
            if (!roadCellOn[id]) continue;
            roadCellOn[id] = 0;
            dummy.position.set(0, -999, 0);
            dummy.scale.set(0.0001, 0.0001, 0.0001);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            roadMesh.setMatrixAt(id, dummy.matrix);
        }

        // Sub-base, con el tono de la losa oscura bajado a la mitad: lo que
        // se ve por las juntas es sombra de junta, no jungla.
        dummy.position.set(dx, -0.62 + dy, zLocal);
        dummy.scale.set(halfW * 2, 1, TILE_DEPTH);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        baseMesh.setMatrixAt(i, dummy.matrix);
        if (recolor) baseMesh.setColorAt(i, _rc.setHex(R.roadB).multiplyScalar(0.55));

        for (let sd = 0; sd < 2; sd++) {
            dummy.position.set(
                dx + (sd ? halfW : -halfW), -0.1 + dy, zLocal
            );
            dummy.scale.set(0.55, 0.8, TILE_DEPTH * 0.94);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            kerbMesh.setMatrixAt(i * 2 + sd, dummy.matrix);
            if (recolor) kerbMesh.setColorAt(i * 2 + sd, _rc.setHex(R.kerb));
        }
    }
    updateForkBand(off);

    roadMesh.instanceMatrix.needsUpdate = true;
    baseMesh.instanceMatrix.needsUpdate = true;
    kerbMesh.instanceMatrix.needsUpdate = true;
    if (colorDirty) {
        roadMesh.instanceColor.needsUpdate = true;
        baseMesh.instanceColor.needsUpdate = true;
        kerbMesh.instanceColor.needsUpdate = true;
    }
}

// Al empezar una partida las losas tienen la region de la carrera anterior y
// nadie las repintaria hasta que alguna cruzase una linea: se fuerza el
// repintado invalidando la cache.
function resetRoadColors() {
    roadTileRegion.fill(-1);
}

// El ramal que no se ha tomado. Solo existe pasada la X: antes de ella los dos
// ramales estarian exactamente en el mismo sitio y se pelearian por el pixel.
let forkBandOn = false;

function updateForkBand(off) {
    const f = game.fork;
    const band = -f.mainBand;

    // Una vez elegido, el otro ramal se abre y se va; pasado el segundo largo
    // ya esta fuera de plano y mantenerlo dibujado no aporta nada.
    if (!f.active || f.away >= 1) {
        if (forkBandOn) {
            forkBandOn = false;
            for (let k = 0; k < TILE_COUNT * 4; k++) {
                dummy.position.set(0, -999, 0);
                dummy.scale.set(0.0001, 0.0001, 0.0001);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                forkMesh.setMatrixAt(k, dummy.matrix);
            }
            forkMesh.instanceMatrix.needsUpdate = true;
        }
        return;
    }
    forkBandOn = true;

    for (let i = 0; i < TILE_COUNT; i++) {
        const zLocal = ROAD_FROM + i * TILE_DEPTH;
        const zWorld = zLocal + off;
        const base = i * 4;

        // Fuera de la bifurcacion, o dentro de un vacio, este ramal no existe
        if (!pastFork(zWorld) || inGap(zWorld)) {
            for (let k = 0; k < 4; k++) {
                dummy.position.set(0, -999, 0);
                dummy.scale.set(0.0001, 0.0001, 0.0001);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                forkMesh.setMatrixAt(base + k, dummy.matrix);
            }
            continue;
        }

        const mask = curveMask(zWorld);
        const dx = (curveX(game.distance - zWorld) - game.curveBase) * mask +
                   forkDX(zWorld, band);
        const dy = riseAtS(game.distance - zWorld, zWorld);
        const R = REGIONS[roadRegionOf(game.distance - zWorld)];

        dummy.rotation.set(0, 0, 0);

        dummy.position.set(dx, -0.5 + dy, zLocal);
        dummy.scale.set(ROAD_WIDTH, 1, TILE_DEPTH * 0.94);
        dummy.updateMatrix();
        forkMesh.setMatrixAt(base, dummy.matrix);
        forkMesh.setColorAt(base, _rc.setHex(i % 2 ? R.roadA : R.roadB));

        dummy.position.set(dx, -0.62 + dy, zLocal);
        dummy.scale.set(ROAD_WIDTH, 1, TILE_DEPTH);
        dummy.updateMatrix();
        forkMesh.setMatrixAt(base + 1, dummy.matrix);
        forkMesh.setColorAt(base + 1, _rc.setHex(R.roadB).multiplyScalar(0.55));

        for (let sd = 0; sd < 2; sd++) {
            dummy.position.set(
                dx + (sd ? ROAD_WIDTH / 2 : -ROAD_WIDTH / 2), -0.1 + dy, zLocal
            );
            dummy.scale.set(0.55, 0.8, TILE_DEPTH * 0.94);
            dummy.updateMatrix();
            forkMesh.setMatrixAt(base + 2 + sd, dummy.matrix);
            forkMesh.setColorAt(base + 2 + sd, _rc.setHex(R.kerb));
        }
    }
    forkMesh.instanceMatrix.needsUpdate = true;
    forkMesh.instanceColor.needsUpdate = true;
}

// ===========================================================================
// Capas de parallax: matorral, sierra y cielo
// ===========================================================================
// Tres mallas instanciadas mas, tres draw calls. Es lo que llena el hueco
// entre la calzada y el horizonte: sin ellas el juego era una cinta blanca
// sobre un plano verde y no habia nada por lo que pasar.

// --- Lo que crece al borde de la calzada ---
// Tres cubos por mata. La forma sale del tipo de la region y la variedad del
// indice de la ranura, asi que dos matas seguidas nunca son iguales pero la
// misma ranura siempre es igual a si misma.
function propSpec(kind, k, out) {
    const v = ((k * 37) % 11) / 11;          // 0..1 estable por ranura
    const t = 0.8 + v * 0.6;
    const put = (n, x, y, z, w, h, d, rz, ci) => {
        const o = out[n];
        o.x = x; o.y = y; o.z = z; o.w = w; o.h = h; o.d = d; o.rz = rz; o.ci = ci;
    };
    switch (kind) {
        case 'jungle':
            put(0, 0, 0.9 * t, 0, 0.5, 1.8 * t, 0.5, 0, 1);
            put(1, 0, 2.2 * t, 0, 2.6 * t, 1.5 * t, 2.6 * t, 0, 0);
            put(2, 0.7 * t, 3.1 * t, -0.4, 1.8 * t, 1.1 * t, 1.8 * t, 0, 0);
            break;
        case 'reed':
            put(0, -0.5, 1.4 * t, 0, 0.22, 2.8 * t, 0.22, 0.12, 0);
            put(1, 0.2, 1.8 * t, 0.3, 0.22, 3.6 * t, 0.22, -0.1, 0);
            put(2, 0.7, 1.1 * t, -0.2, 0.3, 2.2 * t, 0.3, 0.18, 1);
            break;
        case 'fern':
            put(0, 0, 0.5 * t, 0, 2.4 * t, 0.35, 2.4 * t, 0.1, 0);
            put(1, 0.4, 1.0 * t, 0.2, 1.8 * t, 0.3, 1.8 * t, -0.14, 0);
            put(2, -0.4, 1.4 * t, -0.3, 1.2 * t, 0.28, 1.2 * t, 0.2, 1);
            break;
        case 'palm':
            put(0, 0, 2.4 * t, 0, 0.42, 4.8 * t, 0.42, 0.08, 0);
            put(1, -1.2 * t, 4.7 * t, 0, 2.6 * t, 0.3, 1.0, -0.3, 1);
            put(2, 1.2 * t, 4.7 * t, 0.2, 2.6 * t, 0.3, 1.0, 0.3, 1);
            break;
        case 'agave':
            put(0, 0, 0.9 * t, 0, 0.4, 1.8 * t, 1.4, 0.25, 0);
            put(1, 0.5, 0.8 * t, 0.3, 0.4, 1.6 * t, 1.2, -0.35, 0);
            put(2, -0.4, 1.2 * t, -0.2, 0.35, 2.2 * t, 0.9, 0.12, 1);
            break;
        case 'jacaranda':
            put(0, 0, 1.6 * t, 0, 0.55, 3.2 * t, 0.55, 0.05, 0);
            put(1, 0, 3.9 * t, 0, 3.2 * t, 1.3 * t, 3.2 * t, 0, 1);
            put(2, 0.8 * t, 4.7 * t, -0.5, 2.0 * t, 0.9 * t, 2.0 * t, 0, 1);
            break;
        case 'lava':
            put(0, 0, 0.6 * t, 0, 2.0 * t, 1.2 * t, 1.8 * t, 0.1, 0);
            put(1, 1.0, 0.4 * t, 0.6, 1.2 * t, 0.8 * t, 1.2 * t, -0.2, 0);
            put(2, 0.2, 1.35 * t, 0.1, 0.9 * t, 0.28, 0.9 * t, 0, 1);
            break;
        case 'maize':
            put(0, -0.4, 1.5 * t, 0, 0.26, 3.0 * t, 0.26, 0.1, 0);
            put(1, 0.4, 1.7 * t, 0.3, 0.26, 3.4 * t, 0.26, -0.12, 0);
            put(2, 0, 3.2 * t, 0.1, 0.5, 0.7 * t, 0.5, 0.2, 1);
            break;
        case 'stall':
            put(0, 0, 0.9 * t, 0, 0.28, 1.8 * t, 0.28, 0, 1);
            put(1, 0, 2.0 * t, 0, 2.8 * t, 0.3, 2.4 * t, 0.14, 0);
            put(2, 0.3, 0.5 * t, 0.4, 1.2 * t, 1.0 * t, 1.0 * t, 0, 1);
            break;
        case 'pine':
            put(0, 0, 0.9 * t, 0, 0.4, 1.8 * t, 0.4, 0, 1);
            put(1, 0, 2.6 * t, 0, 2.4 * t, 2.0 * t, 2.4 * t, 0, 0);
            put(2, 0, 4.2 * t, 0, 1.4 * t, 1.6 * t, 1.4 * t, 0, 0);
            break;
        default:   // rock
            put(0, 0, 0.7 * t, 0, 2.2 * t, 1.4 * t, 2.0 * t, 0.12, 0);
            put(1, 1.1, 0.45 * t, -0.5, 1.3 * t, 0.9 * t, 1.3 * t, -0.2, 0);
            put(2, -0.6, 1.5 * t, 0.3, 0.9 * t, 0.8 * t, 0.9 * t, 0.3, 1);
            break;
    }
}

const propBuf = [];
for (let i = 0; i < PROP_PARTS; i++) {
    propBuf.push({ x: 0, y: 0, z: 0, w: 0, h: 0, d: 0, rz: 0, ci: 0 });
}

function buildProps() {
    propMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }),
        PROP_SLOTS * PROP_PARTS
    );
    propMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(PROP_SLOTS * PROP_PARTS * 3), 3
    );
    propMesh.frustumCulled = false;
    scene.add(propMesh);
}

function buildRidge() {
    // Sin niebla a proposito: la niebla se cierra en 185 y la sierra vive mas
    // alla, asi que fogueada seria invisible. Se pinta con un tono cercano al
    // de la bruma para que siga leyendose como fondo y no como decorado.
    ridgeMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), RIDGE_COUNT
    );
    ridgeMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(RIDGE_COUNT * 3), 3
    );
    ridgeMesh.frustumCulled = false;
    ridgeMesh.renderOrder = -2;
    scene.add(ridgeMesh);
}

function buildSky() {
    skyMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.85 }),
        SKY_COUNT
    );
    skyMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(SKY_COUNT * 3), 3
    );
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -3;
    scene.add(skyMesh);
}

const _sc = new THREE.Color();
// Temporales propios de la escenografia. mixHex usa _cA/_cB internamente, asi
// que pasarle uno de esos dos como destino lo pisa a mitad de calculo.
const _sA = new THREE.Color();
const _sB = new THREE.Color();

function updateScenery(A, B, e) {
    // --- Matorral al borde (1x, la capa que corre) ---
    const propOff = game.distance % PROP_PERIOD;
    for (let k = 0; k < PROP_SLOTS; k++) {
        const side = k % 2 ? 1 : -1;
        const slot = k >> 1;
        // El modulo va DENTRO: sin el, la mitad de las matas acababa detras
        // de la camara y se dibujaban veintidos arbustos que nadie ve.
        const zWorld = PROP_FROM + (slot * PROP_SPACING + propOff) % PROP_PERIOD;
        // A que region pertenece este trozo de cuneta: el matorral cambia en
        // la misma linea que el firme, o la selva de Peten seguiria creciendo
        // en la arena de Monterrico.
        const R = REGIONS[roadRegionOf(game.distance - zWorld)];
        propSpec(R.prop, k, propBuf);

        const mask = curveMask(zWorld);
        const dx = (curveX(game.distance - zWorld) - game.curveBase) * mask;
        const dy = (curveY(game.distance - zWorld) - game.riseBase) * mask;
        const base = side * (ROAD_WIDTH / 2 + 2.2 + ((slot * 5) % 4) * 1.3);

        for (let t = 0; t < PROP_PARTS; t++) {
            const q = propBuf[t];
            const id = k * PROP_PARTS + t;
            dummy.position.set(base + q.x * side + dx, q.y - 1 + dy, zWorld + q.z);
            dummy.scale.set(Math.max(0.02, q.w), Math.max(0.02, q.h), Math.max(0.02, q.d));
            dummy.rotation.set(0, 0, q.rz * side);
            dummy.updateMatrix();
            propMesh.setMatrixAt(id, dummy.matrix);
            propMesh.setColorAt(id, _sc.setHex(q.ci ? R.propB : R.propA));
        }
    }
    propMesh.instanceMatrix.needsUpdate = true;
    propMesh.instanceColor.needsUpdate = true;

    // --- Sierra del fondo ---
    // No se acerca: una cordillera a kilometros no crece porque camines, y
    // reciclarla en Z daba un salto de tamano cada vuelta. Lo que hace es
    // DERIVAR de lado, que es justo lo que se ve desde una carretera. El
    // periodo lateral (RIDGE_PERIOD) es mas ancho que el cono de vision, asi
    // que el reciclado ocurre fuera de pantalla y no se nota.
    const ridgeOff = game.distance * 0.16;
    mixHex(A.ridge, B.ridge, e, _sA);
    mixHex(A.fog, B.fog, e, _sB);
    _sc.copy(_sA).lerp(_sB, 0.45);          // medio velada por la bruma
    for (let k = 0; k < RIDGE_COUNT; k++) {
        const w = 26 + ((k * 23) % 44);
        const h = 12 + ((k * 29) % 46);
        const zk = -400 + ((k * 41) % 130);
        const x = ((k * 97 + ridgeOff) % RIDGE_PERIOD) - RIDGE_PERIOD / 2;
        // Tapa inclinada, alterna a un lado y a otro: con la caja recta el
        // fondo era un muro liso, y basta este giro para que el perfil de
        // arriba se quiebre y parezca una cordillera.
        const tilt = (((k * 7) % 5) - 2) * 0.13;
        dummy.position.set(x + curveAtZ(zk) * 0.55, h / 2 - 9, zk);
        dummy.scale.set(w, h, 26);
        dummy.rotation.set(0, ((k * 13) % 7) * 0.05, tilt);
        dummy.updateMatrix();
        ridgeMesh.setMatrixAt(k, dummy.matrix);
        ridgeMesh.setColorAt(k, _sc);
    }
    ridgeMesh.instanceMatrix.needsUpdate = true;
    ridgeMesh.instanceColor.needsUpdate = true;

    // --- Cielo (0.05x): nubes de dia, estrellas de noche ---
    const star = (e < 0.5 ? A.sky : B.sky) === 'star';
    const skyOff = game.distance * 0.045;
    mixHex(A.skyC, B.skyC, e, _sc);
    for (let k = 0; k < SKY_COUNT; k++) {
        const zk = -150 - ((k * 53) % 210);
        const x = ((k * 71 + skyOff) % SKY_PERIOD) - SKY_PERIOD / 2;
        const y = 20 + ((k * 37) % 30);
        if (star) {
            dummy.position.set(x, y + 10, zk);
            dummy.scale.set(1.1, 1.1, 1.1);
        } else {
            dummy.position.set(x, y, zk);
            dummy.scale.set(18 + ((k * 19) % 26), 3.4 + ((k * 7) % 3), 10);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        skyMesh.setMatrixAt(k, dummy.matrix);
        skyMesh.setColorAt(k, _sc);
    }
    skyMesh.instanceMatrix.needsUpdate = true;
    skyMesh.instanceColor.needsUpdate = true;
}

// ===========================================================================
// Horizonte: un hito distinto por departamento
// ===========================================================================
// Mismo truco periodico que la calzada: se define un tramo de LAND_PERIOD
// unidades y se repite LAND_CYCLES veces. Los rasgos de cada hito (lado,
// distancia, tamano) se derivan de su indice DENTRO del ciclo, que es lo que
// garantiza que la costura sea invisible.
//
// Todas las siluetas ocupan los mismos LAND_PARTS huecos: las piezas que a
// una le sobran quedan a escala cero. Asi el paso de un departamento al
// siguiente puede interpolarse cubo a cubo, y el templo de Tikal se convierte
// en el karst de Semuc creciendo, no apareciendo de golpe.
function silhouette(kind, s, R) {
    const P = [];
    const put = (x, y, z, w, h, d, c, ry, rz) =>
        P.push({ x, y, z, w, h, d, c, ry: ry || 0, rz: rz || 0 });

    switch (kind) {
        case 'temple': {                                  // Tikal
            const base = 9 * s, th = 2 * s;
            for (let t = 0; t < 5; t++) {
                const w = base * (1 - t * 0.16);
                put(0, th * t + th / 2 - 1, 0, w, th, w, t === 4 ? R.landB : R.landA);
            }
            put(0, 0.9 * s, -2.7 * s, 1.6 * s, 2.2 * s, 0.6 * s, 0x1a1410);   // vano
            break;
        }
        case 'karst': {                                   // Semuc Champey
            put(0, 1.6 * s - 1, 0, 8 * s, 5 * s, 7 * s, R.landA);
            put(1.7 * s, 3.7 * s, -1 * s, 6 * s, 4.2 * s, 5.4 * s, R.landA);
            put(-1.9 * s, 2.9 * s, 1.2 * s, 4.6 * s, 3.2 * s, 4.4 * s, R.landA);
            put(0.4 * s, 6.0 * s, 0, 7.4 * s, 2.2 * s, 6.6 * s, R.landB);
            put(2.3 * s, 6.8 * s, -1 * s, 5 * s, 1.9 * s, 4.6 * s, R.landB);
            break;
        }
        case 'palm': {                                    // Río Dulce y Monterrico
            put(0, 3.2 * s - 1, 0, 0.75 * s, 7.4 * s, 0.75 * s, R.landA);
            for (let f = 0; f < 4; f++) {
                const a = f * Math.PI / 4 + 0.3;
                put(Math.cos(a) * 1.9 * s, 6.9 * s, Math.sin(a) * 1.9 * s,
                    4.4 * s, 0.42 * s, 1.1 * s, R.landB, a, -0.32);
            }
            put(3.4 * s, 2.2 * s - 1, 2 * s, 0.6 * s, 5.4 * s, 0.6 * s, R.landA);
            put(3.4 * s, 4.9 * s, 2 * s, 3.6 * s, 0.4 * s, 3.2 * s, R.landB);
            break;
        }
        case 'colonial': {                                // Antigua
            put(0, 0.7 * s, 0, 8 * s, 3.4 * s, 4 * s, R.landA);
            put(-2.6 * s, 1.3 * s, 2.1 * s, 0.9 * s, 4.6 * s, 0.9 * s, R.landA);
            put(2.6 * s, 1.3 * s, 2.1 * s, 0.9 * s, 4.6 * s, 0.9 * s, R.landA);
            put(0, 3.9 * s, 2.1 * s, 6.4 * s, 1.0 * s, 1.1 * s, R.landB);
            put(3.2 * s, 2.4 * s, -1.4 * s, 2.6 * s, 7.0 * s, 2.6 * s, R.landA);
            put(3.2 * s, 6.2 * s, -1.4 * s, 3.2 * s, 0.8 * s, 3.2 * s, R.landB);
            put(3.2 * s, 7.2 * s, -1.4 * s, 0.35 * s, 1.4 * s, 0.35 * s, R.landB);
            break;
        }
        case 'volcano': {                                 // Atitlán
            for (let t = 0; t < 4; t++) {
                const w = 15 * s * (1 - t * 0.21);
                put(0, 2.7 * s * t + 1.35 * s - 1, 0, w, 2.7 * s, w, R.landA);
            }
            put(0, 2.7 * s * 4 - 0.4, 0, 3.4 * s, 1.0 * s, 3.4 * s, R.landB);
            put(0.4 * s, 2.7 * s * 4 + 1.9 * s, 0, 2.4 * s, 2.2 * s, 2.4 * s, 0x8d97a0);
            break;
        }
        case 'peak': {                                    // Tajumulco
            for (let t = 0; t < 5; t++) {
                const w = 16 * s * (1 - t * 0.185);
                put(0, 3.0 * s * t + 1.5 * s - 1, 0, w, 3.0 * s, w, t >= 3 ? R.landB : R.landA);
            }
            break;
        }
        case 'town': {                                    // Flores, la isla
            // Un monticulo con casas de tejado rojo trepando por el. Flores es
            // eso visto desde el lago, y no se parece a ningun otro hito.
            put(0, 0.9 * s - 1, 0, 11 * s, 2.4 * s, 9 * s, R.landA);
            put(-2.2 * s, 2.9 * s, 1.2 * s, 2.4 * s, 2.2 * s, 2.4 * s, R.landA);
            put(-2.2 * s, 4.3 * s, 1.2 * s, 2.9 * s, 0.6 * s, 2.9 * s, R.landB);
            put(1.4 * s, 3.4 * s, -0.6 * s, 2.6 * s, 3.0 * s, 2.6 * s, R.landA);
            put(1.4 * s, 5.2 * s, -0.6 * s, 3.1 * s, 0.7 * s, 3.1 * s, R.landB);
            put(0, 5.6 * s, 1.8 * s, 2.0 * s, 4.4 * s, 2.0 * s, R.landA);
            put(0, 8.1 * s, 1.8 * s, 2.4 * s, 0.7 * s, 2.4 * s, R.landB);
            put(0, 8.9 * s, 1.8 * s, 0.3 * s, 1.1 * s, 0.3 * s, R.landB);
            break;
        }
        case 'market': {                                  // Chichicastenango
            for (let t = 0; t < 3; t++) {
                put(0, 0.35 * s + t * 0.7 * s - 1, 3.4 * s - t * 0.9 * s,
                    (10 - t * 1.4) * s, 0.7 * s, 1.6 * s, R.landA);
            }
            put(0, 3.4 * s, 0, 6.6 * s, 5.2 * s, 4.4 * s, R.landA);
            put(-2.7 * s, 4.2 * s, 0.4 * s, 1.7 * s, 6.8 * s, 1.7 * s, R.landA);
            put(2.7 * s, 4.2 * s, 0.4 * s, 1.7 * s, 6.8 * s, 1.7 * s, R.landA);
            put(-3.5 * s, 1.3 * s, 4.6 * s, 2.6 * s, 0.45 * s, 2.6 * s, R.landB);
            put(3.5 * s, 1.3 * s, 4.6 * s, 2.6 * s, 0.45 * s, 2.6 * s, R.landB);
            break;
        }
    }
    return P;
}

// Especificacion completa del horizonte de un departamento. Se calcula una
// sola vez por region y se guarda: durante la transicion se lee dos veces por
// repintado, y recalcularla ahi seria trabajo tirado.
const landCache = new Map();

function landSpec(ri) {
    if (landCache.has(ri)) return landCache.get(ri);

    const R = REGIONS[ri];
    const arr = new Array(LAND_TOTAL * LAND_PARTS);

    for (let k = 0; k < LAND_TOTAL; k++) {
        const j = k % LAND_PER_CYCLE;                     // posicion en el ciclo
        const z = -LAND_PERIOD * LAND_CYCLES + k * LAND_SPACING;
        const side = j % 2 ? 1 : -1;
        const dist = 18 + (j * 7) % 24;
        const s = 0.85 + ((j * 13) % 10) / 9;
        const parts = silhouette(R.land, s, R);

        for (let t = 0; t < LAND_PARTS; t++) {
            const p = parts[t];
            arr[k * LAND_PARTS + t] = p
                ? { x: side * dist + p.x * side, y: p.y, z: z + p.z,
                    w: p.w, h: p.h, d: p.d, ry: p.ry * side, rz: p.rz * side, c: p.c }
                // Los huecos sobrantes se quedan a tamano cero en la base del
                // hito, de modo que al interpolar broten desde donde toca.
                : { x: side * dist, y: -1, z, w: 0, h: 0, d: 0, ry: 0, rz: 0, c: R.landA };
        }
    }

    landCache.set(ri, arr);
    return arr;
}

function buildLandmarks() {
    landGroup = new THREE.Group();
    scene.add(landGroup);

    landMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshLambertMaterial({ color: 0xffffff }),   // ver nota en buildRoad
        LAND_TOTAL * LAND_PARTS
    );
    landMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(LAND_TOTAL * LAND_PARTS * 3), 3
    );
    landMesh.frustumCulled = false;
    landGroup.add(landMesh);
}

const lerp = (a, b, t) => a + (b - a) * t;

function paintLandmarks(a, b, e) {
    const n = LAND_TOTAL * LAND_PARTS;
    for (let i = 0; i < n; i++) {
        const p = a[i], q = b[i];
        dummy.position.set(lerp(p.x, q.x, e), lerp(p.y, q.y, e), lerp(p.z, q.z, e));
        // Nunca exactamente cero: una matriz sin escala no es invertible y
        // three.js se queja al calcular la normal.
        dummy.scale.set(
            Math.max(0.0001, lerp(p.w, q.w, e)),
            Math.max(0.0001, lerp(p.h, q.h, e)),
            Math.max(0.0001, lerp(p.d, q.d, e))
        );
        dummy.rotation.set(0, lerp(p.ry, q.ry, e), lerp(p.rz, q.rz, e));
        dummy.updateMatrix();
        landMesh.setMatrixAt(i, dummy.matrix);
        landMesh.setColorAt(i, mixHex(p.c, q.c, e, _cMix));
    }
    landMesh.instanceMatrix.needsUpdate = true;
    landMesh.instanceColor.needsUpdate = true;
}

// ===========================================================================
// Pools de obstaculos y recogidas
// ===========================================================================
function makeObstacle() {
    const group = new THREE.Group();

    // Estela: monolito tallado. Hay que cambiarse de carril.
    const estela = new THREE.Group();
    const shaft = new THREE.Mesh(BOX, mat.stone);
    shaft.scale.set(1.5, 3.4, 0.65);
    shaft.position.y = 1.7;
    estela.add(shaft);
    const cap = new THREE.Mesh(BOX, mat.accent);
    cap.scale.set(1.75, 0.4, 0.85);
    cap.position.y = 3.6;
    estela.add(cap);
    group.add(estela);

    // Dintel: viga elevada sobre dos apoyos. Hay que deslizarse.
    const dintel = new THREE.Group();
    const beam = new THREE.Mesh(BOX, mat.accent);
    beam.scale.set(2.1, 0.7, 0.7);
    beam.position.y = 2.5;
    dintel.add(beam);
    const posts = [];
    for (const s of [-1, 1]) {
        const post = new THREE.Mesh(BOX, mat.stone);
        post.scale.set(0.35, 2.2, 0.5);
        post.position.set(s * 0.88, 1.1, 0);
        dintel.add(post);
        posts.push(post);
    }
    group.add(dintel);

    // Cenote: hueco en la calzada. Hay que saltar.
    //
    // Las tres capas van a alturas SEPARADAS a proposito. Antes el hueco y el
    // agua acababan los dos en y = 0.09 —dos caras en el mismo plano peleando
    // por el pixel— y ganaba la del hueco, que es un material basico casi
    // negro: el cenote se veia como una plancha negra, sin agua y sin borde.
    // Con el brocal arriba, el agua en medio y el fondo debajo, se lee como lo
    // que es: un pozo.
    const cenote = new THREE.Group();

    const hole = new THREE.Mesh(BOX, mat.pit);
    hole.scale.set(2.05, 0.06, 2.6);
    hole.position.y = 0.0;                     // fondo oscuro, hasta y = 0.03
    cenote.add(hole);

    const water = new THREE.Mesh(BOX, mat.water);
    water.scale.set(1.5, 0.05, 2.0);
    water.position.y = 0.07;                   // agua, de 0.045 a 0.095
    cenote.add(water);

    // Brocal: cuatro piezas que enmarcan el pozo. Es lo que hace que se lea
    // como una abertura y no como una mancha pintada en el suelo.
    for (const [sx, sz, w, d] of [[0, -1, 2.3, 0.28], [0, 1, 2.3, 0.28],
                                  [-1, 0, 0.28, 2.86], [1, 0, 0.28, 2.86]]) {
        const kerbPiece = new THREE.Mesh(BOX, mat.stone);
        kerbPiece.scale.set(w, 0.18, d);
        kerbPiece.position.set(sx * 1.16, 0.09, sz * 1.44);
        cenote.add(kerbPiece);
    }
    group.add(cenote);

    // Tronco: un arbol caido cruzando los tres carriles. Se salta y punto.
    const tronco = new THREE.Group();
    const trunk = new THREE.Mesh(BOX, mat.stone);
    trunk.scale.set(9.2, 0.95, 1.05);
    trunk.position.y = 0.5;
    tronco.add(trunk);
    // Vetas y munones, para que se lea como madera y no como una barra
    for (const [x, y, z, w, h, d] of [[-2.2, 1.0, 0, 1.6, 0.22, 0.9],
                                      [1.4, 1.0, 0.1, 2.0, 0.22, 0.9],
                                      [-3.6, 1.15, 0.2, 0.5, 0.7, 0.5],
                                      [2.9, 1.2, -0.2, 0.45, 0.8, 0.45]]) {
        const bit = new THREE.Mesh(BOX, mat.accent);
        bit.scale.set(w, h, d);
        bit.position.set(x, y, z);
        tronco.add(bit);
    }
    group.add(tronco);

    // Vacio: la calzada se interrumpe. El agujero de verdad lo hace
    // updateRoadCurve apagando las losas; esto es el fondo del precipicio y
    // los dos bordes rotos, para que se vea profundidad y no un pintarrajo.
    const vacio = new THREE.Group();
    const chasm = new THREE.Mesh(BOX, mat.pit);
    chasm.scale.set(ROAD_WIDTH + 0.4, 2.4, VACIO_LEN);
    chasm.position.y = -1.35;
    vacio.add(chasm);
    for (const sd of [-1, 1]) {
        const lip = new THREE.Mesh(BOX, mat.kerb);
        lip.scale.set(ROAD_WIDTH + 0.5, 0.5, 0.7);
        lip.position.set(0, -0.22, sd * (VACIO_LEN / 2 - 0.3));
        vacio.add(lip);
    }
    group.add(vacio);

    // Muro de derrumbe: el ramal que el cartel de prohibido virar decia que no
    // se tomara. No es un obstaculo que se falla, es la consecuencia de haber
    // desobedecido una senal que estaba puesta; por eso es alto, macizo y de
    // lado a lado, para que se vea desde lejos que ahi no se pasa y quede
    // tiempo de entender por que.
    const muro = new THREE.Group();
    const roca = (w, h, d, x, y, z, m) => {
        const q = new THREE.Mesh(BOX, m || mat.stone);
        q.scale.set(w, h, d);
        q.position.set(x, y, z);
        muro.add(q);
        return q;
    };
    roca(ROAD_WIDTH + 1.6, 3.2, 2.6, 0, 1.5, 0);
    roca(3.4, 1.9, 3.0, -2.6, 3.0, 0.2);
    roca(3.0, 2.2, 2.8, 1.9, 3.2, -0.2);
    roca(2.2, 1.5, 2.4, -0.2, 4.4, 0.1);
    roca(1.6, 1.4, 1.9, 4.4, 1.0, 0.6);
    roca(1.8, 1.5, 2.0, -4.6, 1.1, -0.5);
    // Vetas al rojo: es la misma gramatica que la piedra rodante, y ahi lo que
    // tiene que leerse en dos decimas es "esto te mata".
    roca(ROAD_WIDTH + 1.8, 0.3, 0.3, 0, 2.6, 1.35, mat.dangerTrim);
    roca(ROAD_WIDTH + 1.8, 0.3, 0.3, 0, 0.7, 1.35, mat.dangerTrim);
    group.add(muro);

    group.visible = false;
    scene.add(group);

    return {
        group, parts: [estela, dintel, cenote, tronco, vacio, muro],
        shaft, cap, beam, posts,
        type: -1, lane: 1, z: 0, baseY: 0, curve: 0, rise: 0, active: false
    };
}

function makePickup() {
    const mesh = new THREE.Mesh(GEO.jade, mat.jade);
    mesh.visible = false;
    scene.add(mesh);
    return {
        mesh, lane: 1, z: 0, y: 1.1, curve: 0, rise: 0,
        active: false, kind: 'jade', pulled: false
    };
}

// ---------------------------------------------------------------------------
// Tramo elevado
// ---------------------------------------------------------------------------
// Geometria en coordenadas locales, con el origen en la BOCA de la rampa de
// entrada. El jugador esta fijo en z = 0 y el tramo avanza hacia el, asi que
// recorre sus z locales de 0 hacia negativo: primero la rampa que sube, luego
// el llano, y al final la rampa que baja. El largo del llano es lo unico que
// cambia entre unos y otros, y se ajusta escalando, sin reconstruir nada.
function makePlatform() {
    const group = new THREE.Group();
    const ang = Math.atan2(LEVEL_HIGH, RAMP_LEN);
    const rampLen = Math.hypot(RAMP_LEN, LEVEL_HIGH);

    // Rampa de subida: se recorre de z = 0 a z = -RAMP_LEN. Girando en +X el
    // extremo de z negativa es el que sube, que es justo lo que hace falta.
    //
    // El desplazamiento en Y no es la mitad del desnivel sino esa mitad menos
    // el medio grosor proyectado de la losa: asi la CARA de la rampa arranca
    // rasante con la calzada y termina justo en LEVEL_HIGH, que es la altura
    // que devuelve terrainAt. Con la mitad a secas quedaba un escalon de doce
    // centimetros en la boca, y el jugador andaba doce por encima del suelo
    // que pisaba.
    const rampY = LEVEL_HIGH / 2 - 0.25 * Math.cos(ang);
    const up = new THREE.Mesh(BOX, mat.deck);
    up.scale.set(2.15, 0.5, rampLen);
    up.position.set(0, rampY, -RAMP_LEN / 2);
    up.rotation.x = ang;
    group.add(up);

    // Cuerpo: el costado da el volumen y la tapa el color de la calzada.
    const side = new THREE.Mesh(BOX, mat.deckSide);
    // Hasta donde empieza la tapa y ni un milimetro mas. Llegando los dos a
    // LEVEL_HIGH sus caras superiores quedaban en el mismo plano, y el
    // z-fighting resultante se arrastraba al avanzar: parecia una textura
    // moviendose sobre la plataforma.
    side.scale.set(2.15, LEVEL_HIGH - 0.26, 1);
    group.add(side);

    const deck = new THREE.Mesh(BOX, mat.deck);
    deck.scale.set(2.2, 0.26, 1);
    group.add(deck);

    // Rampa de bajada, al otro extremo. Giro contrario.
    const down = new THREE.Mesh(BOX, mat.deck);
    down.scale.set(2.15, 0.5, rampLen);
    down.rotation.x = -ang;
    group.add(down);

    group.visible = false;
    scene.add(group);

    return {
        group, up, side, deck, down, rampY,
        lane: 1, z: 0, len: PLAT_MIN, curve: 0, rise: 0, active: false
    };
}

// ---------------------------------------------------------------------------
// Amenazas
// ---------------------------------------------------------------------------
function makeHazard() {
    const group = new THREE.Group();

    // Camazotz, el murcielago de Xibalba. Vuela a la altura del pecho: o te
    // agachas por debajo, o lo saltas por encima, o te apartas de carril.
    const bat = new THREE.Group();
    const piece = (parent, m, sx, sy, sz, x, y, z) => {
        const q = new THREE.Mesh(BOX, m);
        q.scale.set(sx, sy, sz);
        q.position.set(x, y, z);
        parent.add(q);
        return q;
    };
    piece(bat, mat.danger, 0.5, 0.5, 0.8, 0, 0, 0);            // cuerpo
    piece(bat, mat.danger, 0.34, 0.34, 0.34, 0, 0.2, 0.42);    // cabeza
    piece(bat, mat.dangerTrim, 0.1, 0.1, 0.08, -0.11, 0.24, 0.6);  // ojos
    piece(bat, mat.dangerTrim, 0.1, 0.1, 0.08, 0.11, 0.24, 0.6);
    piece(bat, mat.danger, 0.14, 0.3, 0.1, -0.14, 0.44, 0.38);     // orejas
    piece(bat, mat.danger, 0.14, 0.3, 0.1, 0.14, 0.44, 0.38);
    // Envergadura ajustada a la caja de colision (1,15 a cada lado). Con alas
    // mas largas el bicho invadia visualmente los carriles vecinos y parecia
    // que iba a golpear donde no golpea: asusta de mas, que en un juego de
    // reflejos es tan injusto como asustar de menos.
    const wingL = piece(bat, mat.danger, 0.95, 0.1, 0.62, -0.66, 0.06, 0);
    const wingR = piece(bat, mat.danger, 0.95, 0.1, 0.62, 0.66, 0.06, 0);
    piece(bat, mat.dangerTrim, 0.95, 0.06, 0.14, -0.66, 0.02, -0.3);
    piece(bat, mat.dangerTrim, 0.95, 0.06, 0.14, 0.66, 0.02, -0.3);
    group.add(bat);

    // Piedra rodante: baja por el carril girando. Solo se salta.
    const rock = new THREE.Group();
    piece(rock, mat.danger, 1.3, 1.3, 1.3, 0, 0, 0);          // nucleo
    // Salientes en los tres ejes: rompen la silueta de cubo y al girar dejan
    // ver que la cosa rueda. Un cubo liso girando parece quieto.
    piece(rock, mat.danger, 1.62, 0.86, 0.86, 0, 0, 0);
    piece(rock, mat.danger, 0.86, 1.62, 0.86, 0, 0, 0);
    piece(rock, mat.danger, 0.86, 0.86, 1.62, 0, 0, 0);
    // Vetas al rojo, POR FUERA del nucleo y no dentro como estaban. Son lo
    // unico que dice "esto te hace dano" en las doce zonas.
    piece(rock, mat.dangerTrim, 1.72, 0.3, 0.3, 0, 0.36, 0.36);
    piece(rock, mat.dangerTrim, 0.3, 0.3, 1.72, -0.36, -0.3, 0);
    piece(rock, mat.dangerTrim, 0.3, 1.72, 0.3, 0.38, 0, -0.34);
    group.add(rock);

    // Vaca suelta. Cruza la calzada al paso, de un margen al otro. No corre
    // hacia ti: pasa por delante, y lo que hay que calcular es por donde va a
    // estar cuando llegues, no como esquivarla en el ultimo momento.
    const vaca = new THREE.Group();
    const cuerpo = new THREE.Group();
    piece(cuerpo, mat.cow, 2.5, 1.25, 1.05, 0, 1.15, 0);            // tronco
    piece(cuerpo, mat.cowSpot, 0.8, 0.62, 1.08, -0.5, 1.35, 0);     // manchas
    piece(cuerpo, mat.cowSpot, 0.62, 0.5, 1.1, 0.65, 1.0, 0);
    piece(cuerpo, mat.cow, 0.78, 0.78, 0.86, -1.5, 1.3, 0);         // cabeza
    piece(cuerpo, mat.cowSkin, 0.42, 0.4, 0.5, -1.98, 1.12, 0);     // morro
    piece(cuerpo, mat.cowSpot, 0.13, 0.13, 0.13, -2.16, 1.2, 0.16);
    piece(cuerpo, mat.cowSpot, 0.13, 0.13, 0.13, -2.16, 1.2, -0.16);
    piece(cuerpo, mat.cow, 0.5, 0.16, 0.16, -1.72, 1.72, 0.3);      // cuernos
    piece(cuerpo, mat.cow, 0.5, 0.16, 0.16, -1.72, 1.72, -0.3);
    piece(cuerpo, mat.cowSkin, 0.42, 0.34, 0.42, 0.55, 0.55, 0);    // ubre
    const patas = [];
    for (const [px, pz] of [[-0.85, 0.4], [-0.85, -0.4], [0.9, 0.4], [0.9, -0.4]]) {
        const pv = new THREE.Group();
        pv.position.set(px, 1.05, pz);
        piece(pv, mat.cow, 0.26, 0.95, 0.26, 0, -0.48, 0);
        piece(pv, mat.cowSpot, 0.28, 0.2, 0.28, 0, -0.92, 0);
        cuerpo.add(pv);
        patas.push(pv);
    }
    const rabo = piece(cuerpo, mat.cow, 0.16, 0.8, 0.16, 1.32, 1.0, 0);
    piece(cuerpo, mat.cowSpot, 0.2, 0.24, 0.2, 1.32, 0.6, 0);
    vaca.add(cuerpo);
    group.add(vaca);

    // Camioneta. Ocupa el carril entero y es mas alta que un salto: no se
    // esquiva por arriba ni por debajo, solo apartandose.
    const bus = new THREE.Group();
    piece(bus, mat.bus, 2.1, 2.0, 6.4, 0, 1.5, 0);                  // caja
    piece(bus, mat.busTrim, 2.16, 0.34, 6.44, 0, 1.02, 0);          // franjas
    piece(bus, mat.busTrim, 2.16, 0.26, 6.44, 0, 2.4, 0);
    piece(bus, mat.bus, 1.9, 0.3, 6.0, 0, 2.62, 0);                 // techo
    for (let k = 0; k < 4; k++) {
        piece(bus, mat.busGlass, 2.14, 0.7, 1.1, 0, 1.95, -2.2 + k * 1.45);
    }
    piece(bus, mat.busGlass, 1.75, 0.85, 0.12, 0, 1.9, 3.22);       // parabrisas
    piece(bus, mat.busTrim, 2.2, 0.5, 0.5, 0, 0.75, 3.2);           // parachoques
    const faroL = piece(bus, mat.dangerTrim, 0.4, 0.3, 0.16, -0.66, 1.15, 3.26);
    const faroR = piece(bus, mat.dangerTrim, 0.4, 0.3, 0.16, 0.66, 1.15, 3.26);
    for (const [wx, wz] of [[-1.02, 2.1], [1.02, 2.1], [-1.02, -2.0], [1.02, -2.0]]) {
        piece(bus, mat.busTire, 0.26, 0.9, 0.9, wx, 0.5, wz);
    }
    group.add(bus);

    group.visible = false;
    scene.add(group);

    return {
        group, parts: [bat, rock, vaca, bus], bat, rock, vaca, bus,
        cuerpo, patas, rabo, faroL, faroR, wingL, wingR,
        type: CAMAZOTZ, lane: 1, z: 0, y: 0, phase: 0, entry: 0,
        drop: 0, dropV: 0, cross: 0, crossTo: 0, active: false
    };
}

// --- Placa de impulso ---
// Una losa hundida en la calzada con galones apuntando hacia delante. Los
// galones van por encima de la losa y no a su misma altura, o volveriamos al
// problema del cenote: dos caras en el mismo plano.
function makeBoost() {
    const group = new THREE.Group();

    const pad = new THREE.Mesh(BOX, mat.boostPad);
    pad.scale.set(2.05, 0.09, 3.4);
    pad.position.y = 0.04;
    group.add(pad);

    const marks = [];
    for (let k = 0; k < 3; k++) {
        for (const sx of [-1, 1]) {
            const m = new THREE.Mesh(BOX, mat.boostMark);
            m.scale.set(1.15, 0.1, 0.3);
            m.position.set(sx * 0.4, 0.13, -1.15 + k * 1.15);
            // El giro va con el signo CAMBIADO. Con el otro, las dos barras se
            // abrian hacia delante y el vertice quedaba detras: la placa que
            // empuja hacia delante dibujaba una flecha apuntando hacia atras.
            m.rotation.y = -sx * 0.58;
            group.add(m);
            marks.push(m);
        }
    }

    group.visible = false;
    scene.add(group);
    return { group, marks, lane: 1, z: 0, y: 0, curve: 0, rise: 0, active: false };
}

// ===========================================================================
// Senales de aviso
// ===========================================================================
// Cada senal es un canvas de 160 px con fondo transparente: el rombo o el
// disco se pintan dentro y las esquinas quedan vacias, de modo que basta
// un plano cuadrado con alpha y no hace falta geometria recortada.
//
// Las texturas se generan UNA vez al arrancar y se comparten. Rehacerlas en
// cada aparicion seria pintar el mismo rombo cientos de veces por partida.
function signCanvas(marco, dibujo) {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const x = c.getContext('2d');

    if (marco === 'circulo') {
        // Prohibicion: disco blanco con aro rojo. No avisa de un peligro, dice
        // que por ahi no se pasa, y por eso no es amarilla.
        x.setTransform(1, 0, 0, 1, 80, 80);
        x.beginPath();
        x.arc(0, 0, 60, 0, 6.283);
        x.fillStyle = '#ffffff';
        x.fill();
        x.lineWidth = 15;
        x.strokeStyle = '#d62828';
        x.stroke();
        x.setTransform(1, 0, 0, 1, 0, 0);
    } else {
        x.save();
        x.translate(80, 80);
        x.rotate(Math.PI / 4);
        x.fillStyle = '#f5c518';
        x.strokeStyle = '#141414';
        x.lineWidth = 8;
        x.lineJoin = 'round';
        x.beginPath();
        x.rect(-52, -52, 104, 104);
        x.fill();
        x.stroke();
        x.restore();
    }

    if (dibujo) {
        x.save();
        x.translate(80, 80);
        x.scale(marco === 'circulo' ? 0.62 : 0.82, marco === 'circulo' ? 0.62 : 0.82);
        x.fillStyle = '#141414';
        x.strokeStyle = '#141414';
        x.lineJoin = 'round';
        dibujo(x);
        x.restore();
    }

    // La barra tachada se pinta la ultima, por encima del dibujo: es lo que
    // convierte "esto" en "esto no".
    if (marco === 'circulo') {
        x.save();
        x.translate(80, 80);
        x.rotate(-Math.PI / 4);
        x.fillStyle = '#d62828';
        x.fillRect(-58, -6, 116, 12);
        x.restore();
    }

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// Los pictogramas. Simplificados a proposito: a treinta metros y en
// movimiento, lo que se lee es la silueta, no el detalle.
const SIGN_ART = {
    // Algo se ha caido sobre la calzada: el tronco y la piedra rodante.
    derrumbe: x => {
        x.beginPath();
        x.moveTo(34, 40); x.lineTo(34, -34); x.lineTo(-6, 40);
        x.closePath(); x.fill();
        for (const [cx, cy, r] of [[-20, -12, 10], [-2, 6, 8], [-26, 18, 7], [10, -26, 6]]) {
            x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill();
        }
    },
    // La calzada se acaba y vuelve a empezar mas alla: el vacio. Antes lo
    // anunciaba el de carril estrecho, pero ese ya significa otra cosa muy
    // concreta y compartirlo dejaba las dos senales sin significado.
    hueco: x => {
        // La calzada partida en dos, con los bordes desprendidos hacia dentro,
        // y una flecha cayendo por el hueco. La primera version eran dos rayas
        // finas y una flecha, y se leia como un "prohibido el paso": lo que
        // hay que reconocer aqui es una CARRETERA que se acaba.
        x.fillRect(-46, 10, 30, 18);
        x.fillRect(16, 10, 30, 18);
        x.beginPath(); x.moveTo(-16, 10); x.lineTo(-16, 28); x.lineTo(-4, 28);
        x.closePath(); x.fill();
        x.beginPath(); x.moveTo(16, 10); x.lineTo(16, 28); x.lineTo(4, 28);
        x.closePath(); x.fill();
        x.fillRect(-6, -40, 12, 26);
        x.beginPath();
        x.moveTo(0, 6); x.lineTo(-19, -18); x.lineTo(19, -18);
        x.closePath(); x.fill();
    },
    // Los tres carriles se vuelven uno. Los de los lados dejan de existir.
    puente: x => {
        x.lineWidth = 11; x.lineCap = 'round';
        for (const sd of [-1, 1]) {
            x.beginPath();
            x.moveTo(sd * 28, -40); x.lineTo(sd * 13, -10);
            x.lineTo(sd * 13, 10); x.lineTo(sd * 28, 40);
            x.stroke();
        }
    },
    // Ganado suelto. Es la senal que de verdad se ve en las carreteras de
    // Guatemala, y aqui significa exactamente lo que dice: va a cruzar una
    // vaca por el lado en el que esta plantado el cartel.
    animal: x => {
        x.beginPath(); x.ellipse(3, -4, 28, 16, 0, 0, 6.283); x.fill();
        // Cabeza gacha y morro, que es lo que hace que se lea vaca y no perro
        x.beginPath(); x.ellipse(-27, 2, 12, 10, -0.35, 0, 6.283); x.fill();
        x.beginPath(); x.ellipse(-38, 10, 7, 6, -0.35, 0, 6.283); x.fill();
        // Cuernos
        x.lineWidth = 5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(-30, -8); x.quadraticCurveTo(-40, -20, -32, -25); x.stroke();
        x.beginPath(); x.moveTo(-22, -10); x.quadraticCurveTo(-26, -24, -17, -26); x.stroke();
        // Ubre, patas y rabo
        x.beginPath(); x.ellipse(8, 11, 8, 6, 0, 0, 6.283); x.fill();
        for (const lx of [-14, -4, 14, 23]) x.fillRect(lx, 9, 6, 26);
        x.beginPath();
        x.moveTo(29, -16); x.quadraticCurveTo(41, -6, 35, 16);
        x.lineWidth = 5; x.stroke();
        x.beginPath(); x.arc(35, 20, 6, 0, 6.283); x.fill();
    },
    // Viene desnivel: los tramos elevados y sus rampas.
    pendiente: x => {
        x.beginPath();
        x.moveTo(-38, -8); x.lineTo(38, 36); x.lineTo(-38, 36);
        x.closePath(); x.fill();
        x.save();
        x.translate(2, -2); x.rotate(0.53);
        x.fillRect(-24, -20, 34, 15);
        x.fillRect(10, -14, 13, 9);
        x.restore();
    },
    // La calzada gira de verdad mas adelante.
    curva: x => {
        x.lineWidth = 15; x.lineCap = 'butt';
        x.beginPath();
        x.moveTo(-8, 40);
        x.quadraticCurveTo(-8, -8, 20, -16);
        x.stroke();
        x.beginPath();
        x.moveTo(38, -18); x.lineTo(12, -34); x.lineTo(14, 0);
        x.closePath(); x.fill();
    },
    // Distribuidor vial: hay que elegir salida.
    bifurcacion: x => {
        x.lineWidth = 17; x.lineCap = 'butt';
        x.beginPath();
        x.moveTo(0, 40); x.lineTo(0, 2);
        x.moveTo(0, 4); x.lineTo(-28, -32);
        x.moveTo(0, 4); x.lineTo(28, -32);
        x.stroke();
    },
    // Zonas habitadas: Flores, Antigua, Chichicastenango, Todos Santos.
    escolar: x => {
        const fig = (cx, sc) => {
            x.beginPath(); x.arc(cx, -26 * sc, 9 * sc, 0, 6.283); x.fill();
            x.beginPath();
            x.moveTo(cx - 10 * sc, -15 * sc); x.lineTo(cx + 10 * sc, -15 * sc);
            x.lineTo(cx + 7 * sc, 13 * sc); x.lineTo(cx - 7 * sc, 13 * sc);
            x.closePath(); x.fill();
            x.fillRect(cx - 8 * sc, 13 * sc, 6 * sc, 21 * sc);
            x.fillRect(cx + 2 * sc, 13 * sc, 6 * sc, 21 * sc);
        };
        fig(-15, 1.05);
        fig(17, 0.76);
    },
    peaton: x => {
        x.beginPath(); x.arc(2, -32, 9, 0, 6.283); x.fill();
        x.save(); x.translate(2, -7); x.rotate(0.14);
        x.fillRect(-7, -15, 14, 23);
        x.restore();
        x.fillRect(-16, 6, 7, 21);
        x.fillRect(9, 6, 7, 23);
        for (let i = 0; i < 4; i++) x.fillRect(-32 + i * 17, 32, 11, 7);
    },
    // Zonas de agua: Semuc, Rio Dulce, Monterrico.
    resbaladiza: x => {
        x.fillRect(-26, -38, 48, 17);
        x.fillRect(-15, -49, 28, 13);
        x.lineWidth = 8; x.lineCap = 'round';
        for (const sd of [-1, 1]) {
            x.beginPath();
            x.moveTo(sd * 17, -12);
            x.bezierCurveTo(sd * 2, 2, sd * 32, 16, sd * 13, 38);
            x.stroke();
        }
    },
    // Parada de camioneta. Mas adelante viene un bus por ese mismo carril y
    // no se va a apartar: el que se aparta es uno.
    parada: x => {
        x.fillRect(-34, -30, 68, 44);
        x.fillStyle = '#f5c518';
        for (let i = 0; i < 3; i++) x.fillRect(-28 + i * 21, -24, 16, 16);
        x.fillStyle = '#141414';
        x.beginPath(); x.arc(-19, 20, 9, 0, 6.283); x.fill();
        x.beginPath(); x.arc(19, 20, 9, 0, 6.283); x.fill();
        // Poste de la parada, que es lo que la distingue de "bus" a secas
        x.fillRect(-3, 22, 6, 18);
        x.fillRect(-16, 36, 32, 6);
    },
    // Prohibido virar hacia ese lado: el ramal de ese lado esta cortado.
    // Se dibuja siempre girando a la derecha y el plano se voltea en X cuando
    // toca el otro lado, para no tener dos texturas de lo mismo.
    noVirar: x => {
        // La flecha se separa de la diagonal de la barra todo lo que puede: el
        // asta baja pegada al borde izquierdo y la punta sale por la derecha,
        // de modo que la barra la cruza sin llegar a borrarla.
        x.lineWidth = 18; x.lineCap = 'butt';
        x.beginPath();
        x.moveTo(-26, 48);
        x.lineTo(-26, 6);
        x.quadraticCurveTo(-26, -14, -4, -14);
        x.stroke();
        x.beginPath();
        x.moveTo(38, -14); x.lineTo(0, -40); x.lineTo(0, 12);
        x.closePath(); x.fill();
    },
};

const SIGN_TEX = {};
const SIGN_GEO_W = new THREE.PlaneGeometry(2.5, 2.5);

// Que marco lleva cada una. El rombo amarillo avisa y el disco rojo prohibe:
// dos formas para dos cosas distintas, legibles antes de haber podido leer el
// dibujo de dentro.
const SIGN_FRAME = { noVirar: 'circulo' };

function buildSignTextures() {
    for (const k in SIGN_ART) {
        SIGN_TEX[k] = signCanvas(SIGN_FRAME[k] || 'rombo', SIGN_ART[k]);
    }
}

function makeWarn() {
    const group = new THREE.Group();

    const post = new THREE.Mesh(BOX, mat.signPost);
    post.scale.set(0.16, 2.6, 0.16);
    post.position.y = 1.3;
    group.add(post);

    const face = new THREE.Mesh(SIGN_GEO_W, new THREE.MeshBasicMaterial({
        transparent: true, fog: true, depthWrite: false
    }));
    face.position.y = 3.1;
    group.add(face);

    group.visible = false;
    scene.add(group);
    return { group, face, z: 0, curve: 0, rise: 0, active: false };
}

function freeWarn() {
    let best = null;
    for (const w of warns) {
        if (!w.active) return w;
        if (!best || w.z > best.z) best = w;
    }
    return best;
}

// Planta un aviso por delante de lo que anuncia. side null = lado al azar.
// Devuelve el lado en el que quedo, que es lo que permite que el peligro salga
// justo por ahi. force salta el racionamiento: lo usan la bifurcacion y el
// las de los tramos especiales, que anuncian algo que no se puede dejar sin
// avisar.
function spawnWarn(kind, z, side, force) {
    const tex = SIGN_TEX[kind];
    if (!tex) return 0;
    if (!force && game.distance - game.lastWarn < WARN_MIN_GAP) return 0;
    const w = freeWarn();
    if (!w) return 0;
    game.lastWarn = game.distance;

    w.face.material.map = tex;
    w.face.material.needsUpdate = true;
    // La flecha de prohibido virar esta dibujada girando a la derecha; para el
    // margen izquierdo se voltea el plano en vez de guardar otra textura.
    w.side = side === undefined || side === null
        ? (Math.random() < 0.5 ? -1 : 1)
        : side;
    // Las dos senales con SENTIDO se dibujan una sola vez, girando a la
    // derecha, y el plano se voltea para el margen izquierdo. Sin esto un
    // cartel de curva plantado a la izquierda dibujaba una flecha torciendo a
    // la derecha: decia lo contrario de lo que iba a pasar, que en una senal
    // es peor que no decir nada.
    //
    // Mira w.side y no el parametro: la curva no dice de que lado quiere ir,
    // se sortea AQUI, y comparando el parametro —que vale null— el espejo no
    // se aplicaba nunca.
    const espejo = (kind === 'noVirar' || kind === 'curva') && w.side < 0;
    w.face.scale.x = espejo ? -1 : 1;
    w.z = z;
    w.curve = trackCurve(z);
    w.rise = trackRise(z);
    w.active = true;
    w.born = z;
    w.face.material.opacity = 0;
    w.group.visible = true;
    w.group.position.set(w.side * (ROAD_WIDTH / 2 + 1.7) + curveOf(w), riseOf(w), z);
    return w.side;
}

// --- Rotulo de destino ---
// Texto blanco sobre verde en un canvas, como los de la CA-9. Es la unica
// forma de tener texto de verdad en la escena sin cargar una fuente 3D, y
// ademas permite que el rotulo diga el nombre real del departamento al que
// lleva cada salida.
function signTexture(titulo, sub, flecha) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d');

    x.fillStyle = '#1a6b3c';
    x.fillRect(0, 0, 512, 256);
    x.strokeStyle = '#ffffff';
    x.lineWidth = 7;
    x.strokeRect(14, 14, 484, 228);

    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = 'bold 62px Poppins, Arial, sans-serif';
    x.fillText(titulo, 256, sub ? 96 : 118, 440);
    if (sub) {
        x.font = '38px Poppins, Arial, sans-serif';
        x.fillText(sub, 256, 152, 440);
    }

    // La flecha, dibujada a mano: una punta y un asta.
    const cx = 256, cy = sub ? 206 : 186, d = flecha < 0 ? -1 : 1;
    x.beginPath();
    x.moveTo(cx + d * 46, cy);
    x.lineTo(cx + d * 12, cy - 24);
    x.lineTo(cx + d * 12, cy - 9);
    x.lineTo(cx - d * 46, cy - 9);
    x.lineTo(cx - d * 46, cy + 9);
    x.lineTo(cx + d * 12, cy + 9);
    x.lineTo(cx + d * 12, cy + 24);
    x.closePath();
    x.fill();

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

const SIGN_GEO = new THREE.PlaneGeometry(4.6, 2.3);

function makeCrossing() {
    const group = new THREE.Group();

    // Portico: dos postes y el travesano del que cuelgan los rotulos.
    for (const sd of [-1, 1]) {
        const post = new THREE.Mesh(BOX, mat.signPost);
        post.scale.set(0.34, 8.4, 0.34);
        post.position.set(sd * (ROAD_WIDTH / 2 + 1.1), 3.2, 0);
        group.add(post);
    }
    const beam = new THREE.Mesh(BOX, mat.signPost);
    beam.scale.set(ROAD_WIDTH + 2.8, 0.34, 0.34);
    beam.position.y = 7.2;
    group.add(beam);

    // Un rotulo por salida. La textura se rehace en cada aparicion, porque el
    // destino y el lado cambian.
    const panels = [];
    for (const sd of [-1, 1]) {
        const m = new THREE.Mesh(
            SIGN_GEO,
            new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true })
        );
        m.position.set(sd * 2.6, 5.6, 0);
        group.add(m);
        panels.push(m);
    }

    group.visible = false;
    scene.add(group);
    return { group, panels, tex: [null, null], z: 0, curve: 0, rise: 0, active: false };
}

// --- Isleta central ---
// El divisor que obliga a elegir. Ocupa el carril del medio: es un muro, no
// un adorno, y chocar con el cuesta una vida como cualquier otro.
function makeIsland() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(BOX, mat.island);
    body.scale.set(2.0, 1.0, CROSS_ISLAND_LEN);
    body.position.y = 0.5;
    group.add(body);

    const top = new THREE.Mesh(BOX, mat.islandTop);
    top.scale.set(2.1, 0.16, CROSS_ISLAND_LEN);
    top.position.y = 1.05;
    group.add(top);

    // Punta en cuna hacia el jugador, que es lo que hace legible por donde
    // hay que pasar antes de estar encima.
    const nose = new THREE.Mesh(BOX, mat.islandTop);
    nose.scale.set(1.3, 1.15, 2.6);
    nose.position.set(0, 0.55, CROSS_ISLAND_LEN / 2 + 1.0);
    nose.rotation.y = Math.PI / 4;
    group.add(nose);

    group.visible = false;
    scene.add(group);
    return { group, z: 0, curve: 0, rise: 0, active: false };
}

function buildPools() {
    for (let i = 0; i < OBSTACLE_POOL; i++) obstacles.push(makeObstacle());
    for (let i = 0; i < PICKUP_POOL; i++) pickups.push(makePickup());
    for (let i = 0; i < PLATFORM_POOL; i++) platforms.push(makePlatform());
    for (let i = 0; i < HAZARD_POOL; i++) hazards.push(makeHazard());
    for (let i = 0; i < BOOST_POOL; i++) boosts.push(makeBoost());
    buildSignTextures();
    for (let i = 0; i < WARN_POOL; i++) warns.push(makeWarn());
    // Dos cruces a la vez como mucho: el que se acerca y el que acaba de pasar
    for (let i = 0; i < 2; i++) {
        crossings.push({ sign: makeCrossing(), island: makeIsland(),
                         swapLane: 0, target: 0, blocked: 0, kind: 0,
                         z: 0, active: false, done: false });
    }
}

// ---------------------------------------------------------------------------
// Altura del terreno
// ---------------------------------------------------------------------------
// Unica fuente de verdad sobre a que altura esta el suelo: la usan el jugador,
// los obstaculos al aparecer, las recogidas y las piedras que ruedan. Con
// nueve tramos como maximo en vuelo, el barrido no se nota.
function terrainAt(lane, z) {
    let h = 0;
    for (const p of platforms) {
        if (!p.active || p.lane !== lane) continue;
        const u = p.z - z;                       // 0 en la boca, crece hacia dentro
        if (u < 0 || u > 2 * RAMP_LEN + p.len) continue;

        let y;
        if (u < RAMP_LEN) y = LEVEL_HIGH * (u / RAMP_LEN);                       // subiendo
        else if (u < RAMP_LEN + p.len) y = LEVEL_HIGH;                           // llano
        else y = LEVEL_HIGH * (1 - (u - RAMP_LEN - p.len) / RAMP_LEN);           // bajando

        if (y > h) h = y;
    }
    return h;
}

// Hay tramo (de cualquier carril) ocupando esa z? Evita encadenar perfiles
// nuevos encima de uno que todavia esta pasando.
function platformNear(z) {
    for (const p of platforms) {
        if (!p.active) continue;
        const u = p.z - z;
        if (u > -18 && u < 2 * RAMP_LEN + p.len + 18) return true;
    }
    return false;
}

// Proporciones de obstaculo por departamento: en Río Dulce los postes son de
// madera y mas gruesos, en Antigua son columnas esbeltas. Es un retoque de
// escala, no de forma, para que el jugador no tenga que reaprender medidas.
function applyObstacleShape(R) {
    const [w, hh, dd] = R.ob;
    for (const o of obstacles) {
        o.shaft.scale.set(1.5 * w, 3.4 * hh, 0.65 * dd);
        o.shaft.position.y = 1.7 * hh;
        o.cap.scale.set(1.75 * w * 1.05, 0.4, 0.85 * dd);
        o.cap.position.y = 3.4 * hh + 0.2;
        o.beam.scale.set(2.1, 0.7, 0.7 * dd);
        o.posts[0].scale.set(0.35 * w, 2.2, 0.5 * dd);
        o.posts[1].scale.set(0.35 * w, 2.2, 0.5 * dd);
    }
}

// --- Particulas ---
// Un solo InstancedMesh para todas: una draw call. Las inactivas se esconden
// escalandolas a cero, que es mas barato que quitarlas de la escena.
function buildParticles() {
    particleMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        PARTICLE_POOL
    );
    particleMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(PARTICLE_POOL * 3), 3
    );
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < PARTICLE_POOL; i++) {
        particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 1 });
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
        particleMesh.setColorAt(i, white);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    particleMesh.instanceColor.needsUpdate = true;
}

const _pc = new THREE.Color();

function burstParticles(x, y, z, count, size, color) {
    let spawned = 0;
    let dirty = false;
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (spawned >= count) break;
        if (p.life > 0) continue;
        p.x = x; p.y = y; p.z = z;
        p.vx = (Math.random() - 0.5) * 7;
        p.vy = Math.random() * 6 + 2;
        p.vz = (Math.random() - 0.5) * 7;
        p.life = 0.5 + Math.random() * 0.25;
        p.size = size;
        particleMesh.setColorAt(i, _pc.setHex(color === undefined ? C.jade : color));
        dirty = true;
        spawned++;
    }
    if (dirty) particleMesh.instanceColor.needsUpdate = true;
}

function updateParticles(dt) {
    let dirty = false;
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.life <= 0) continue;

        p.life -= dt;
        p.vy += GRAVITY * 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // Acompanan el desplazamiento del mundo, o se quedarian flotando
        p.z += p.vz * dt + game.speed * dt;

        // Escala pequena a proposito: con un factor mayor cada particula medía
        // casi lo mismo que el torso del jugador y tapaba la accion.
        const k = Math.max(0, p.life) * p.size * 0.34;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(Math.max(0.0001, k), Math.max(0.0001, k), Math.max(0.0001, k));
        dummy.rotation.set(p.x, p.y, 0);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
        dirty = true;

        if (p.life <= 0) {
            dummy.position.set(0, -999, 0);
            dummy.scale.set(0.0001, 0.0001, 0.0001);
            dummy.updateMatrix();
            particleMesh.setMatrixAt(i, dummy.matrix);
        }
    }
    if (dirty) particleMesh.instanceMatrix.needsUpdate = true;
}

function clearParticles() {
    for (let i = 0; i < particles.length; i++) {
        particles[i].life = 0;
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
}

// ===========================================================================
// Jugador
// ===========================================================================
// Los miembros cuelgan de un pivote colocado en el hombro o la cadera. Antes
// se movian trasladando el cubo entero, lo que hacia que las piernas
// resbalasen en vez de pivotar; girar desde la articulacion es lo que da la
// zancada.
function buildPlayer() {
    playerGroup = new THREE.Group();
    playerBody = new THREE.Group();
    playerGroup.add(playerBody);

    // transparent:true de entrada: la invulnerabilidad baja la opacidad, y
    // activarlo despues obligaria a recompilar el shader en mitad del golpe,
    // justo cuando peor sienta un tiron.
    const slot = () => new THREE.MeshLambertMaterial({
        color: 0xffffff, transparent: true, opacity: 1
    });

    playerMats = {
        cloth: slot(), skin: slot(), crest: slot(), legs: slot(),
        trim: slot(), hair: slot(), boot: slot()
    };

    const cube = (parent, m, sx, sy, sz, x, y, z) => {
        const mesh = new THREE.Mesh(BOX, m);
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };

    // Un miembro es un pivote en la articulacion, el miembro colgando de el y
    // un remate (mano o pie) en la punta. Sin el remate los brazos eran palos
    // que terminaban en nada, que es lo que hacia raro al personaje.
    const limb = (m, mEnd, hx, hy, sx, sy, sz, endS) => {
        const pivot = new THREE.Group();
        pivot.position.set(hx, hy, 0);
        playerBody.add(pivot);
        cube(pivot, m, sx, sy, sz, 0, -sy / 2, 0);
        cube(pivot, mEnd, endS[0], endS[1], endS[2], 0, -sy - endS[1] / 2 + 0.04, endS[3] || 0);
        return pivot;
    };

    // --- Tronco ---
    const torso = cube(playerBody, playerMats.cloth, 0.86, 0.95, 0.55, 0, 1.28, 0);
    cube(playerBody, playerMats.trim, 0.9, 0.16, 0.6, 0, 0.88, 0);        // faja
    cube(playerBody, playerMats.legs, 0.78, 0.34, 0.52, 0, 0.72, 0);      // taparrabo
    // Manta a la espalda. El jugador corre de espaldas a la camara: TODO el
    // detalle que se ve esta en este lado, y una espalda lisa era la mitad
    // del problema de que el personaje pareciera un bloque.
    cube(playerBody, playerMats.trim, 0.8, 1.05, 0.09, 0, 1.3, 0.31);
    cube(playerBody, playerMats.crest, 0.8, 0.12, 0.11, 0, 1.72, 0.32);
    cube(playerBody, playerMats.crest, 0.8, 0.12, 0.11, 0, 0.95, 0.32);
    // Morral cruzado, colgando de la cadera
    cube(playerBody, playerMats.boot, 0.14, 0.9, 0.12, -0.33, 1.4, 0.2);
    cube(playerBody, playerMats.boot, 0.34, 0.34, 0.24, -0.42, 0.95, 0.2);
    // Hombreras
    cube(playerBody, playerMats.trim, 0.3, 0.16, 0.4, -0.52, 1.72, 0);
    cube(playerBody, playerMats.trim, 0.3, 0.16, 0.4, 0.52, 1.72, 0);

    // --- Cabeza ---
    cube(playerBody, playerMats.skin, 0.3, 0.2, 0.3, 0, 1.85, 0);         // cuello
    const head = cube(playerBody, playerMats.skin, 0.62, 0.6, 0.6, 0, 2.05, 0);
    // Pelo: nuca y laterales. Es lo primero que se ve de el.
    cube(playerBody, playerMats.hair, 0.66, 0.5, 0.22, 0, 2.08, 0.22);
    cube(playerBody, playerMats.hair, 0.66, 0.22, 0.62, 0, 2.31, 0);
    cube(playerBody, playerMats.hair, 0.16, 0.42, 0.5, -0.35, 2.02, 0.06);
    cube(playerBody, playerMats.hair, 0.16, 0.42, 0.5, 0.35, 2.02, 0.06);
    // Tocado y tres plumas abiertas hacia atras
    cube(playerBody, playerMats.crest, 0.72, 0.24, 0.72, 0, 2.5, 0);
    cube(playerBody, playerMats.trim, 0.76, 0.1, 0.76, 0, 2.63, 0);
    const plume = (x, rz, h) => {
        const f = cube(playerBody, playerMats.crest, 0.13, h, 0.34, x, 2.62 + h / 2, 0.2);
        f.rotation.z = rz;
        f.rotation.x = 0.35;
        return f;
    };
    plume(0, 0, 0.66);
    plume(-0.2, 0.42, 0.52);
    plume(0.2, -0.42, 0.52);

    const armL = limb(playerMats.skin, playerMats.skin, -0.55, 1.66, 0.24, 0.72, 0.24, [0.28, 0.24, 0.28, 0]);
    const armR = limb(playerMats.skin, playerMats.skin, 0.55, 1.66, 0.24, 0.72, 0.24, [0.28, 0.24, 0.28, 0]);
    const legL = limb(playerMats.legs, playerMats.boot, -0.24, 0.85, 0.3, 0.8, 0.3, [0.34, 0.2, 0.5, -0.08]);
    const legR = limb(playerMats.legs, playerMats.boot, 0.24, 0.85, 0.3, 0.8, 0.3, [0.34, 0.2, 0.5, -0.08]);

    playerParts = { torso, head, armL, armR, legL, legR };
    scene.add(playerGroup);

    // Sombra de contacto. Sin ella no hay forma de juzgar donde vas a caer ni
    // si vas lo bastante alto para librar un cenote: es la ayuda de lectura
    // que mas se nota de todo el juego.
    shadowMesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 18),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38 })
    );
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.03, PLAYER_Z);
    scene.add(shadowMesh);

    applySkin(save.skin);
}

function applySkin(id) {
    const sk = skinById(id);
    playerMats.cloth.color.setHex(sk.cloth);
    playerMats.skin.color.setHex(sk.skin);
    playerMats.crest.color.setHex(sk.crest);
    playerMats.legs.color.setHex(sk.legs);
    playerMats.trim.color.setHex(sk.trim);
    playerMats.hair.color.setHex(sk.hair);
    playerMats.boot.color.setHex(sk.boot);
}

// --- Jaguar: la presion visual de las vidas ---
// No es un enemigo con colision propia. Su cercania ES el indicador de vidas:
// con todas esta fuera de plano, con una te respira en la nuca. Cuenta lo
// mismo que los rombos del HUD, pero sin apartar la vista de la calzada.
function buildJaguar() {
    jaguar = new THREE.Group();

    const piece = (color, sx, sy, sz, x, y, z) => {
        const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color }));
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        jaguar.add(m);
        return m;
    };

    piece(C.jaguarFur, 1.25, 0.95, 2.3, 0, 1.0, 0);          // cuerpo
    piece(C.jaguarFur, 0.95, 0.85, 0.9, 0, 1.25, -1.4);      // cabeza
    piece(C.jaguarSpot, 0.5, 0.3, 0.2, 0, 1.1, -1.85);       // hocico
    for (const sx of [-1, 1]) {
        piece(C.jaguarSpot, 0.22, 0.3, 0.2, sx * 0.3, 1.62, -1.35);   // orejas
    }
    for (const [x, y, z] of [[0.45, 1.4, 0.4], [-0.4, 1.35, -0.2],
                             [0.3, 1.4, -0.6], [-0.45, 1.3, 0.7]]) {
        piece(C.jaguarSpot, 0.3, 0.12, 0.3, x, y, z);        // manchas
    }

    const legs = [];
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            legs.push(piece(C.jaguarFur, 0.3, 0.85, 0.32, sx * 0.45, 0.42, sz * 0.75));
        }
    }
    const tail = piece(C.jaguarFur, 0.2, 0.2, 1.2, 0, 1.35, 1.5);

    jaguar.userData = { legs, tail };
    jaguar.visible = false;
    scene.add(jaguar);
}

// --- Quetzal: acompanante ---
// El ave nacional de Guatemala, y de paso su moneda. Solo decorativo.
function buildQuetzal() {
    quetzal = new THREE.Group();

    const piece = (color, sx, sy, sz, x, y, z) => {
        const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color }));
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        quetzal.add(m);
        return m;
    };

    piece(C.quetzal, 0.34, 0.36, 0.5, 0, 0, 0);              // cuerpo
    piece(C.quetzal, 0.26, 0.26, 0.26, 0, 0.24, -0.28);      // cabeza
    piece(C.ochre, 0.1, 0.1, 0.16, 0, 0.22, -0.46);          // pico
    piece(C.quetzalBreast, 0.26, 0.2, 0.18, 0, -0.1, -0.2);  // pecho rojo
    // La cola larga, que es lo que hace reconocible al quetzal
    piece(C.quetzal, 0.12, 0.08, 1.15, 0, -0.02, 0.8);
    piece(C.quetzal, 0.1, 0.07, 0.8, 0.07, -0.05, 1.15);

    const wingL = piece(C.quetzal, 0.5, 0.08, 0.34, -0.36, 0.06, 0);
    const wingR = piece(C.quetzal, 0.5, 0.08, 0.34, 0.36, 0.06, 0);

    // Garras: solo se ven mientras carga al jugador. Son lo que convierte
    // "el pajaro esta encima" en "el pajaro me lleva".
    const talonL = piece(C.ochre, 0.09, 0.34, 0.09, -0.13, -0.3, -0.1);
    const talonR = piece(C.ochre, 0.09, 0.34, 0.09, 0.13, -0.3, -0.1);
    talonL.visible = false;
    talonR.visible = false;

    quetzal.userData = { wingL, wingR, talonL, talonR };
    quetzal.visible = false;
    scene.add(quetzal);
}

// ===========================================================================
// Generacion del recorrido
// ===========================================================================
function resetWorld() {
    obstacles.forEach(o => { o.active = false; o.group.visible = false; });
    pickups.forEach(p => { p.active = false; p.mesh.visible = false; });
    platforms.forEach(p => { p.active = false; p.group.visible = false; });
    hazards.forEach(h => { h.active = false; h.group.visible = false; });
    boosts.forEach(b => { b.active = false; b.group.visible = false; });
    warns.forEach(w => { w.active = false; w.group.visible = false; });
    crossings.forEach(c => {
        c.active = false;
        c.done = false;
        c.sign.active = false;
        c.sign.group.visible = false;
        c.island.active = false;
        c.island.group.visible = false;
    });
    pending.length = 0;
    game.nextSpawnZ = SPAWN_Z + 40;   // margen inicial para orientarse
}

// Si el pool se agota, en vez de perder el objeto en silencio se recicla el
// que ya esta mas cerca del despawn: el jugador nunca lo llega a ver.
function freeObstacle() {
    let best = null;
    for (const o of obstacles) {
        if (!o.active) return o;
        if (!best || o.z > best.z) best = o;
    }
    return best;
}

function freePickup() {
    let best = null;
    for (const p of pickups) {
        if (!p.active) return p;
        if (!best || p.z > best.z) best = p;
    }
    return best;
}

function freePlatform() {
    let best = null;
    for (const p of platforms) {
        if (!p.active) return p;
        if (!best || p.z > best.z) best = p;
    }
    return best;
}

function freeHazard() {
    let best = null;
    for (const h of hazards) {
        if (!h.active) return h;
        if (!best || h.z > best.z) best = h;
    }
    return best;
}

// Coordenada de trazado de un objeto que aparece en z. Es invariante durante
// toda su vida, asi que la curva se resuelve con una resta por frame.
const trackCurve = z => curveX(game.distance - z);
const trackRise  = z => curveY(game.distance - z);

function spawnObstacle(type, lane, z, baseY) {
    const o = freeObstacle();
    if (!o) return;
    o.type = type;
    o.lane = lane;
    o.z = z;
    o.baseY = baseY || 0;
    o.curve = trackCurve(z);
    o.rise = trackRise(z);
    o.active = true;
    o.group.visible = true;
    o.group.position.set(LANE_X[lane] + curveOf(o), o.baseY + riseOf(o), z);
    o.parts.forEach((p, i) => { p.visible = (i === type); });
}

function spawnPickup(lane, z, height, kind = 'jade') {
    const p = freePickup();
    if (!p) return;
    p.lane = lane;
    p.z = z;
    p.y = height;
    p.curve = trackCurve(z);
    p.rise = trackRise(z);
    p.active = true;
    p.kind = kind;
    p.pulled = false;
    p.mesh.geometry = GEO[kind] || GEO.jade;
    p.mesh.material = mat[kind] || mat.jade;
    p.mesh.visible = true;
    p.mesh.position.set(LANE_X[lane] + curveOf(p), height + riseOf(p), z);
}

function spawnPlatform(lane, z, len) {
    const p = freePlatform();
    if (!p) return;
    p.lane = lane;
    p.z = z;
    p.len = len;
    p.curve = trackCurve(z);
    p.rise = trackRise(z);
    p.active = true;
    p.group.visible = true;
    p.group.position.set(LANE_X[lane], 0, z);

    // El llano y su costado se estiran al largo pedido; las rampas son fijas.
    const mid = -RAMP_LEN - len / 2;
    p.side.scale.z = len;
    p.side.position.set(0, (LEVEL_HIGH - 0.26) / 2, mid);
    p.deck.scale.z = len + 0.3;
    // La tapa tambien termina exactamente en LEVEL_HIGH: es la superficie que
    // el jugador pisa, y tiene que coincidir con lo que dice terrainAt.
    p.deck.position.set(0, LEVEL_HIGH - 0.13, mid);
    p.down.position.set(0, p.rampY, -RAMP_LEN - len - RAMP_LEN / 2);
}

function freeBoost() {
    let best = null;
    for (const b of boosts) {
        if (!b.active) return b;
        if (!best || b.z > best.z) best = b;
    }
    return best;
}

function spawnBoost(lane, z, baseY) {
    const b = freeBoost();
    if (!b) return;
    b.lane = lane;
    b.z = z;
    b.y = baseY;
    b.curve = trackCurve(z);
    b.rise = trackRise(z);
    b.active = true;
    b.group.visible = true;
    b.group.position.set(LANE_X[lane] + curveOf(b), baseY + riseOf(b), z);
}

// side: de que margen viene (la vaca) o desde donde cae (el derrumbe).
// drop: altura desde la que cae, para las piedras del derrumbe.
function spawnHazard(type, lane, z, side, drop) {
    const h = freeHazard();
    if (!h) return;
    h.type = type;
    h.lane = lane;
    h.z = z;
    h.phase = Math.random() * 6.283;
    h.entry = 0;
    h.drop = drop || 0;
    h.dropV = 0;
    // Sin curva guardada, a proposito: una amenaza cierra distancia por su
    // cuenta, asi que su coordenada de trazado NO es invariante y hay que
    // recalcularla en cada paso. Es el unico objeto del juego que lo necesita.
    h.active = true;
    h.group.visible = true;
    h.parts.forEach((p, i) => { p.visible = (i === type); });

    if (type === VACA) {
        // Entra andando por el margen del lado que anuncio el cartel y sale
        // por el contrario. La x va suelta, sin carril: lo que hay que leer es
        // por donde va a ir pasando, no en que carril esta.
        const sd = side || 1;
        h.cross = sd * (ROAD_WIDTH / 2 + 3.4);
        h.crossTo = -sd;
        h.vaca.rotation.y = sd > 0 ? 0 : Math.PI;
    }

    // Se coloca ya, sin esperar al siguiente paso: el bucle de amenazas corre
    // ANTES que la generacion de compases, asi que una recien nacida pasaria
    // un frame entero dibujada donde estuvo la anterior.
    h.y = terrainAt(lane, z) + hazBaseY(h);
    h.group.position.set(hazX(h, z), h.y + riseAtZ(z), z);
}

// Altura del ancla de cada amenaza sobre el suelo que pisa.
function hazBaseY(h) {
    if (h.type === CAMAZOTZ) return 1.8;
    if (h.type === RODANTE) return 0.72;
    return 0;                                  // vaca y camioneta van al ras
}

function hazX(h, z) {
    const base = h.type === VACA ? h.cross : LANE_X[h.lane];
    return base + curveAtZ(z);
}

// Elige un poder segun su peso. El escudo solo entra en el sorteo si no
// llevas uno: ofrecer un escudo a quien ya lo tiene es un premio vacio.
function rollPower() {
    let total = 0;
    for (const k of POWER_KEYS) {
        if (k === 'shield' && game.shield) continue;
        total += POWERS[k].weight;
    }
    let r = Math.random() * total;
    for (const k of POWER_KEYS) {
        if (k === 'shield' && game.shield) continue;
        r -= POWERS[k].weight;
        if (r <= 0) return k;
    }
    return 'magnet';
}

// Levanta un perfil de alturas: uno de los cinco repartos alto/bajo, con su
// rampa de subida y de bajada en cada carril alto. Se hace de una vez para los
// tres carriles y con el mismo largo, para que el perfil se lea de un vistazo.
function generateTerrain(z) {
    const pat = LANE_PATTERNS[(Math.random() * LANE_PATTERNS.length) | 0];
    const len = PLAT_MIN + Math.random() * (PLAT_MAX - PLAT_MIN);
    for (let l = 0; l < 3; l++) {
        if (pat[l]) spawnPlatform(l, z, len);
    }
}

// Genera un "compas" de recorrido: un patron de obstaculos mas su jade.
// La dificultad sube reduciendo el hueco entre compases.
// --- Eventos programados ---
// Una senal y lo que anuncia no pueden nacer a la vez. La senal se planta a
// treinta y cuatro unidades por delante del compas, asi que llega ANTES; pero
// una camioneta que viene de frente cierra distancia mucho mas deprisa que la
// senal, y naciendo las dos a la vez adelantaria al cartel que la anuncia.
//
// Con esto la senal se planta ya y lo que anuncia se apunta para dentro de
// unos metros, que es como funciona una senal de verdad.
const pending = [];

function schedule(dist, fn) {
    pending.push({ d: game.distance + dist, fn });
}

function runPending() {
    for (let i = pending.length - 1; i >= 0; i--) {
        if (game.distance < pending[i].d) continue;
        const f = pending[i].fn;
        pending.splice(i, 1);
        // Si para cuando le toca ha quedado dentro de la zona limpia, se cae.
        // Es la unica promesa rota que el juego se permite, y se permite
        // porque la alternativa es peor: una vaca cruzando justo cuando el
        // jugador esta eligiendo salida.
        if (limpioEntre(game.distance + 85, game.distance + 190)) continue;
        f();
    }
}

// --- La zona limpia de la bifurcacion ---
// Devuelve las franjas de trazado que tienen que quedar vacias: la de la
// bifurcacion en curso, si la hay, y la de la siguiente. La siguiente se
// calcula a partir de game.nextCross, que se conoce con setecientas unidades
// de antelacion; hace falta saberlo con tanto adelanto porque un compas suelta
// cosas que no llegan al jugador hasta ciento setenta unidades despues, y para
// cuando el cruce existe ya seria tarde para no ponerlas.
function forkWindows() {
    const w = [];
    if (game.fork.active) {
        w.push([game.fork.s0 - QUIET_PRE, game.fork.s0 + FORK_LEN + QUIET_POST]);
    }
    const s0 = game.nextCross + CROSS_ISLAND_AT;
    w.push([s0 - QUIET_PRE, s0 + FORK_LEN + QUIET_POST]);
    return w;
}

// Se solapa el tramo de trazado [a, b] con alguna zona limpia?
function limpioEntre(a, b) {
    for (const q of forkWindows()) if (b > q[0] && a < q[1]) return true;
    return false;
}

// --- Armado de los tramos especiales ---
// Los tres cambian la calzada y ninguno puede solaparse con otro ni con una
// bifurcacion: dos geometrias a la vez no se leen, se estorban.
//
// La comprobacion es de VENTANAS, no de banderas. Antes bastaba con que
// hubiera una bifurcacion activa para bloquear el armado, y como el tramo
// armado no empieza hasta doscientas quince unidades despues, se estaba
// descartando sitio de sobra: medido, salia un tramo especial cada dos mil
// metros y una partida normal no veia ninguno.
function trackBusy(len) {
    if (game.slopeS0 >= 0 || game.turn.active || game.narrowS0 >= 0) return true;
    // Donde caeria el tramo si se armase ahora mismo, con margen a los lados
    return limpioEntre(game.distance + ARM_AHEAD - 45,
                       game.distance + ARM_AHEAD + len + 45);
}

// Uno de los tres, evitando repetir el de la vez anterior: con tres cosas y
// sorteo libre, ver la misma dos veces seguidas pasa una de cada tres.
function armTramo() {
    let t = (Math.random() * 3) | 0;
    if (t === game.lastTramo) t = (t + 1 + ((Math.random() * 2) | 0)) % 3;
    const len = t === 0 ? TURN_LEN : (t === 1 ? SLOPE_LEN : NARROW_LEN);
    if (trackBusy(len)) return false;
    if (t === 0) armTurn();
    else if (t === 1) armSlope();
    else armNarrow();
    game.lastTramo = t;
    return true;
}

// Donde se planta el cartel de un tramo que se arma a ARM_AHEAD.
const ARM_SIGN_Z = -(ARM_AHEAD - WARN_AHEAD);

function armSlope() {
    if (spawnWarn('pendiente', ARM_SIGN_Z, null, true) === 0) return;
    game.slopeS0 = game.distance + ARM_AHEAD;
}

function armTurn() {
    // El lado sale del cartel, no al reves: se planta, se mira donde quedo y
    // la calzada cierra hacia ahi. Una curva a la derecha anunciada por un
    // cartel a la izquierda ensena a no mirar los carteles.
    const lado = spawnWarn('curva', ARM_SIGN_Z, null, true);
    if (lado === 0) return;
    game.turn.active = true;
    game.turn.s0 = game.distance + ARM_AHEAD;
    game.turn.dir = lado;
    game.turnHold = 0;
}

function armNarrow() {
    // A los dos lados: lo que se estrecha es la calzada entera, y un cartel en
    // un solo margen se leeria como algo que solo afecta a ese carril.
    if (spawnWarn('puente', ARM_SIGN_Z, -1, true) === 0) return;
    spawnWarn('puente', ARM_SIGN_Z, 1, true);
    game.narrowS0 = game.distance + ARM_AHEAD;
}

// Se apagan cuando el jugador los ha dejado atras del todo: pasado ese punto
// ya no queda nada dibujado dentro y apagarlos no mueve un solo pixel.
function updateTrackSystems() {
    const d = game.distance;

    // La linea del firme se apaga cuando ya no queda calzada por detras de
    // ella: a partir de ahi los dos lados de la comparacion dan lo mismo.
    if (game.roadS0 >= 0 && d > game.roadS0 + 60) game.roadS0 = -1;

    if (game.slopeS0 >= 0 && d > game.slopeS0 + SLOPE_LEN + 40) {
        game.slopeS0 = -1;
        // La cuesta no vuelve a subir: deja el mundo quince unidades mas
        // abajo. Al apagarla, todo lo que ya nacio con esa bajada dentro se
        // queda quince unidades descolgado, asi que se les devuelve. En este
        // punto TODO lo vivo esta pasada la cuesta —por eso se espera— y la
        // correccion es la misma para todos, de modo que nada se mueve.
        liftRises(SLOPE_DROP);
    }
    if (game.turn.active && d > game.turn.s0 + TURN_LEN + 40) {
        game.turn.active = false;
        game.turnHold = 0;
    }
    if (game.narrowS0 >= 0 && d > game.narrowS0 + NARROW_LEN + 40) {
        game.narrowS0 = -1;
    }
}

function liftRises(dy) {
    for (const o of obstacles) if (o.active) o.rise += dy;
    for (const o of pickups) if (o.active) o.rise += dy;
    for (const o of boosts) if (o.active) o.rise += dy;
    for (const o of warns) if (o.active) o.rise += dy;
    for (const c of crossings) {
        if (c.sign.active) c.sign.rise += dy;
        if (c.island.active) c.island.rise += dy;
    }
}

// Margen alrededor de un tramo especial en el que tampoco se pone nada: si el
// ultimo obstaculo cae justo en la boca, se lee dentro del tramo.
const TRAMO_MARGEN = 25;

// Esta este punto del trazado dentro de una cuesta o de una curva cerrada?
function enTramo(sc) {
    for (let k = -1; k <= 1; k++) {
        const q = sc + k * TRAMO_MARGEN;
        if (slopeSteep(q) > 0 || turnGrip(q) > 0) return true;
    }
    return false;
}

function enEstrecho(sc) {
    for (let k = -1; k <= 1; k++) {
        if (narrowAt(sc + k * TRAMO_MARGEN) < 1) return true;
    }
    return false;
}

function generateChunk(z) {
    const hard = Math.min(game.elapsed / 95, 1);        // 0 -> 1 en poco mas de un minuto
    const sz = game.distance - z;                       // trazado de este compas

    // --- Armado de los tramos especiales ---
    // Uno por ciclo de bifurcacion, en cuanto haya sitio. Antes era un sorteo
    // al 9 % por compas y salia uno cada dos mil metros: con una probabilidad
    // no se reparte nada, solo se deja al azar decidir si el jugador llega a
    // ver una mecanica entera del juego o no.
    if (game.distance > 260 && game.distance > game.nextTramo) {
        if (armTramo()) game.nextTramo = game.distance + 200;
    }

    // --- La zona limpia de la bifurcacion ---
    // Un compas suelta cosas que llegan al jugador entre noventa y cinco y
    // ciento ochenta unidades mas adelante: los estaticos a ciento setenta y
    // las amenazas antes, porque cierran distancia por su cuenta. Si ese rango
    // toca la zona limpia, el compas no genera NADA —ni obstaculos, ni rampas,
    // ni enemigos, ni poderes—.
    //
    // Iba al final de la funcion y por eso no servia: los enemigos se
    // generaban veinte lineas antes y se colaban dentro de la bifurcacion,
    // justo mientras el jugador cruzaba de carril para tomar una salida.
    if (limpioEntre(game.distance + 78, game.distance + 192)) return;

    // --- Dentro de un tramo especial ---
    // En el estrechamiento no cabe nada: es un carril, y meterle algo dentro
    // seria pedir dos cosas a la vez en el sitio donde menos margen hay.
    if (enEstrecho(sz)) return;

    // En la cuesta y en la curva entran los enemigos y el jade, nada mas. Un
    // obstaculo del suelo ahi no se ve venir —la calzada se va hacia abajo o
    // hacia un lado— y un tramo elevado ni siquiera se apoyaria bien.
    if (enTramo(sz)) {
        if (game.distance > 220 && Math.random() < 0.42) {
            spawnHazard(Math.random() < 0.5 ? CAMAZOTZ : RODANTE,
                        (Math.random() * 3) | 0, z);
        }
        const carril = (Math.random() * 3) | 0;
        for (let k = 0; k < 4; k++) spawnPickup(carril, z - k * 4, 1.3);
        return;
    }

    // --- Relieve ---
    // Nunca antes de los primeros metros ni encima de un tramo que aun pasa:
    // encadenarlos deja al jugador sin suelo bajo que reorientarse.
    // La boca de la rampa se adelanta unas unidades respecto al compas: si
    // arrancase justo en z, los obstaculos de este mismo compas caerian dentro
    // de la rampa, que es donde peor se leen.
    // Medio compas de cada dos, y desde los 120 m. Con valores mas timidos un
    // tramo elevado salia cada 190 unidades y la partida corriente veia dos:
    // demasiado poco para que el desnivel llegue a ser una mecanica y no una
    // curiosidad.
    // El filtro de la zona limpia se mira aparte y con mas margen: un tramo
    // elevado mide hasta setenta y dos unidades de la boca a la cola, asi que
    // uno que nazca justo antes de la bifurcacion sigue pasando por debajo del
    // jugador cuando este ya esta eligiendo salida. Medido, era el 5 % de las
    // muestras sucias dentro de la zona.
    if (game.distance > 120 && !platformNear(z) && Math.random() < 0.4 &&
        !limpioEntre(game.distance + 95,
                     game.distance + 190 + 2 * RAMP_LEN + PLAT_MAX)) {
        generateTerrain(z - 10);
    }

    // --- Amenazas sueltas ---
    // El murcielago y la piedra rodante salen SIN cartel, a proposito. Son el
    // ruido de fondo del camino: si cada uno llevase su senal, el margen se
    // llenaria de rombos y los que si anuncian algo gordo dejarian de mirarse.
    if (game.distance > 220 && Math.random() < 0.16 + hard * 0.2) {
        const type = Math.random() < 0.55 ? CAMAZOTZ : RODANTE;
        spawnHazard(type, (Math.random() * 3) | 0, z - 20);
    }

    // --- Sucesos anunciados ---
    // Aqui cada senal manda sobre algo que pasa de verdad, y por eso se planta
    // PRIMERO: se mira por que lado quedo y el suceso ocurre justo por ahi.
    // Y lo que anuncia no nace con ella, sino unos metros mas tarde: la
    // camioneta viene de frente y cierra distancia mucho mas deprisa que el
    // cartel, asi que naciendo a la vez adelantaria a su propio aviso.
    if (game.distance > 240 && Math.random() < 0.22 &&
        !limpioEntre(game.distance + 180, game.distance + 330)) {
        const r = Math.random();
        if (r < 0.4) {
            // Derrumbe: caen piedras del cerro sobre el carril de ese lado.
            const lado = spawnWarn('derrumbe', z + WARN_AHEAD);
            if (lado !== 0) {
                const carril = lado < 0 ? 0 : 2;
                schedule(78, () => {
                    for (let k = 0; k < 3; k++) {
                        spawnHazard(RODANTE, carril, -120 - k * 14, 0, 22 + k * 5);
                    }
                });
            }
        } else if (r < 0.72) {
            // Ganado suelto: la vaca entra por ese margen y cruza al otro.
            const lado = spawnWarn('animal', z + WARN_AHEAD);
            if (lado !== 0) schedule(80, () => spawnHazard(VACA, 1, -85, lado));
        } else {
            // Parada de camioneta: mas adelante viene un bus por ese carril.
            const lado = spawnWarn('parada', z + WARN_AHEAD);
            if (lado !== 0) {
                schedule(64, () => spawnHazard(BUS, lado < 0 ? 0 : 2, SPAWN_Z));
            }
        }
    }

    const at = l => terrainAt(l, z);
    // En rampa no se pone nada: un obstaculo sobre una cuesta no se lee bien y
    // un cenote en mitad de una subida no significa nada.
    const flat = l => { const y = at(l); return (y < 0.01 || y > LEVEL_HIGH - 0.01) ? y : -1; };

    // Nivel de cada carril, y si el compas cae sobre terreno desigual.
    const lv = [at(0), at(1), at(2)].map(y => y > LEVEL_HIGH * 0.5 ? 1 : 0);
    const mixed = !(lv[0] === lv[1] && lv[1] === lv[2]);
    // En terreno desigual, el nivel que ocupa DOS carriles. Es donde se puede
    // poner un obstaculo sin dejar a nadie sin salida.
    const major = lv[0] + lv[1] + lv[2] >= 2 ? 1 : 0;
    // Carriles donde es seguro estorbar: si el terreno es plano, cualquiera.
    const safeLanes = [0, 1, 2].filter(l => !mixed || lv[l] === major);
    const pick = arr => arr[(Math.random() * arr.length) | 0];

    // --- Senales de sitio ---
    // Las unicas que no anuncian un peligro concreto, y por eso son las unicas
    // que salen con cuentagotas: zona escolar y paso de peatones donde hay
    // pueblo, calzada resbaladiza donde hay agua. Si salieran a menudo
    // devaluarian a las que si avisan de algo.
    if (Math.random() < 0.07) {
        const R = REGIONS[Math.floor(routePos()) % REGION_N];
        const pueblo = ['flores', 'antigua', 'chichi', 'todossantos', 'esquipulas'];
        const agua = ['semuc', 'riodulce', 'monterrico', 'atitlan'];
        if (pueblo.includes(R.id)) {
            spawnWarn(Math.random() < 0.5 ? 'escolar' : 'peaton', z + WARN_AHEAD);
        } else if (agua.includes(R.id)) {
            spawnWarn('resbaladiza', z + WARN_AHEAD);
        }
    }


    // --- Obstaculos que cruzan de lado a lado ---
    // Van solos en su compas y solo sobre terreno llano y parejo: un tronco
    // tumbado sobre carriles a distinta altura no se entiende, y un vacio en
    // un tramo elevado dejaria al jugador cayendo a ninguna parte. Al no
    // haber carril donde librarse, el compas no lleva nada mas.
    //
    // La probabilidad parece alta, pero se le acumulan tres filtros: terreno
    // llano, parejo y sin tramo elevado cerca. Con 0,14 salia uno cada 900 m,
    // es decir casi nunca, y el salto volvia a ser un adorno.
    //
    // Va lo PRIMERO del compas y corta con return: si se decidiera despues,
    // la placa de impulso ya estaria puesta en z-4 y su losa de 3,4 de
    // largo acabaria flotando sobre el borde del vacio.
    // El filtro es la altura del terreno a lo LARGO de su huella, no
    // platformNear. Ese comprueba una ventana de casi cien unidades alrededor
    // del compas, y como los tramos elevados salen medio compas de cada dos,
    // casi siempre habia uno "cerca": con el filtro ancho salia un tronco cada
    // novecientos metros, o sea nunca. Lo que de verdad hace falta es que los
    // tres carriles esten al ras donde va a caer la pieza y donde cae el jade.
    const raso = zz => terrainAt(0, zz) < 0.01 &&
                       terrainAt(1, zz) < 0.01 &&
                       terrainAt(2, zz) < 0.01;
    if (game.distance > 200 && raso(z + 8) && raso(z) && raso(z - 16) &&
        Math.random() < 0.5 + hard * 0.12) {
        const tipo = Math.random() < 0.55 ? TRONCO : VACIO;
        spawnObstacle(tipo, 1, z, 0);
        // Los dos avisos van a los DOS lados. Lo que viene cruza la calzada
        // entera, y una senal en un solo margen se lee como algo que solo
        // afecta a ese carril.
        const av = tipo === TRONCO ? 'derrumbe' : 'hueco';
        spawnWarn(av, z + WARN_AHEAD, -1, true);
        spawnWarn(av, z + WARN_AHEAD, 1, true);
        // Jade justo detras: premia el salto y, de paso, ensena donde cae.
        for (let k = 0; k < 3; k++) {
            spawnPickup(1, z - 9 - k * 3, 1.4);
        }
        return;
    }

    if (Math.random() < powerChance()) {
        const l = (Math.random() * 3) | 0;
        const y = flat(l);
        if (y >= 0) spawnPickup(l, z - 12, y + 1.3, rollPower());
    }

    // --- Placa de impulso ---
    // Nunca en el mismo compas que un obstaculo del propio carril: la placa
    // es un premio, y un premio que te mete de cabeza en una estela no lo es.
    // Por eso se pone antes y se apunta el carril para no estorbarlo.
    let boostLane = -1;
    if (game.distance > 90 && Math.random() < 0.2) {
        const l = (Math.random() * 3) | 0;
        const y = flat(l);
        if (y >= 0) { spawnBoost(l, z - 4, y); boostLane = l; }
    }

    let pattern = Math.random();
    // Sobre terreno desigual se descarta el patron de dos obstaculos. Deja un
    // unico carril libre, y si ese carril esta arriba y el jugador abajo, el
    // muro lateral le cierra la unica salida: golpe seguro sin haber fallado
    // nada. El relieve ya es el reto de ese tramo; no hace falta apretar mas.
    if (mixed && pattern >= 0.3 + hard * 0.15 && pattern < 0.62 + hard * 0.1) {
        pattern = Math.random() * (0.3 + hard * 0.15);
    }

    if (pattern < 0.3 + hard * 0.15) {
        // Un solo obstaculo, jade en los carriles libres. En terreno desigual
        // va siempre en el nivel que tiene dos carriles, para que quien corra
        // por ahi pueda apartarse sin cambiar de altura.
        const free2 = safeLanes.filter(l => l !== boostLane);
        const lane = pick(free2.length ? free2 : safeLanes);
        const y = flat(lane);
        // Sobre un tramo elevado no hay cenotes: un agujero en una plataforma
        // que ya esta en alto no se entiende, y ademas se sale por los lados.
        const type = y > 0 ? (Math.random() * 2) | 0 : (Math.random() * 3) | 0;
        if (y >= 0) spawnObstacle(type, lane, z, y);
        for (let l = 0; l < 3; l++) {
            const ly = flat(l);
            if (l !== lane && ly >= 0 && Math.random() < 0.72) spawnPickup(l, z, ly + 1.1);
        }
    } else if (pattern < 0.62 + hard * 0.1) {
        // Dos obstaculos: queda un unico carril libre
        const free = (Math.random() * 3) | 0;
        for (let l = 0; l < 3; l++) {
            if (l === free) continue;
            const y = flat(l);
            if (y < 0) continue;
            spawnObstacle(y > 0 ? (Math.random() * 2) | 0 : (Math.random() * 3) | 0, l, z, y);
        }
        const fy = flat(free);
        if (fy >= 0) spawnPickup(free, z, fy + 1.1);
    } else if (pattern < 0.82) {
        // Pasillo de jade: recompensa sin riesgo, para respirar. Es el patron
        // que hace alcanzable la racha, asi que da de sobra. Sigue el relieve
        // del carril, asi que un pasillo sobre un tramo alto sube con el.
        const lane = (Math.random() * 3) | 0;
        for (let k = 0; k < 5; k++) {
            const pz = z - k * 3.2;
            spawnPickup(lane, pz, terrainAt(lane, pz) + 1.1);
        }
    } else {
        // Dintel en los tres carriles: hay que deslizarse, con jade alto
        // colocado justo detras para premiar el momento exacto
        for (let l = 0; l < 3; l++) {
            const y = flat(l);
            if (y >= 0) spawnObstacle(DINTEL, l, z, y);
        }
        spawnPickup(1, z - 6, terrainAt(1, z - 6) + 1.1);
    }
}

// Rastro de jade en el aire: se siembra al recoger el vuelo del quetzal, a la
// altura de crucero y serpenteando entre carriles. Sin el, volar era solo
// invulnerabilidad temporal; con el, el vuelo es otro juego durante seis
// segundos y de verdad compensa subir.
function spawnSkyTrail() {
    const n = 22;
    const step = 7;
    const base = Math.random() * 6.283;
    for (let k = 0; k < n; k++) {
        const lane = 1 + Math.round(Math.sin(base + k * 0.42));
        const z = -34 - k * step;
        // El rastro se siembra de golpe a lo largo de ciento cincuenta
        // unidades, asi que puede alcanzar la zona limpia de una bifurcacion
        // aunque el jugador este lejos de ella. Las piezas que caigan dentro
        // no se ponen: la zona limpia lo es tambien para los premios.
        if (limpioEntre(game.distance - z, game.distance - z)) continue;
        if (k === 11) spawnPickup(lane, z, FLY_Y + 1.1, rollPower());
        else spawnPickup(lane, z, FLY_Y + 1.1);
    }
}

// ===========================================================================
// Distribuidores viales
// ===========================================================================
// Un cruce se compone de dos piezas separadas en el tiempo: primero el rotulo
// colgado del portico, y sesenta unidades despues la isleta que obliga a
// elegir. Ese hueco es el que da tiempo a leer y a colocarse; juntos serian
// una trampa.
function freeCrossing() {
    for (const c of crossings) if (!c.active) return c;
    return null;
}

// Las bifurcaciones se alternan y son DOS COSAS DISTINTAS:
//
//   destino  - portico con rotulos verdes. Una salida lleva a otro
//              departamento y la otra es el retorno. Se decide leyendo.
//   cortada  - sin portico. Un disco rojo de prohibido virar marca el ramal
//              que esta tapado por un derrumbe. Se decide mirando.
//
// Antes iban mezcladas —el disco rojo colgaba del mismo cruce que los rotulos
// de destino— y eso las estropeaba a las dos: el disco se leia como una parte
// mas de la senalizacion de destinos, y el rotulo verde competia por la
// atencion justo cuando lo unico que importaba era no meterse por un lado.
function spawnCrossing(z) {
    const c = freeCrossing();
    if (!c) return;

    game.crossKind = 1 - game.crossKind;
    c.kind = game.crossKind;                       // 0 = destino, 1 = cortada

    const here = Math.floor(routePos()) % REGION_N;
    // Destino: cualquier departamento menos en el que ya se esta.
    let target = (Math.random() * (REGION_N - 1)) | 0;
    if (target >= here) target++;

    // El sorteo del lado es lo que obliga a leer el rotulo en vez de
    // memorizar. 0 = el cambio esta a la izquierda, 2 = a la derecha.
    c.swapLane = Math.random() < 0.5 ? 0 : 2;
    c.target = target;
    c.z = z - CROSS_SIGN_AHEAD;
    c.active = true;
    c.done = false;
    c.blocked = 0;

    if (c.kind === 0) {
        const izq = c.swapLane === 0;
        const nombre = REGIONS[target].name.toUpperCase();
        const aqui = REGIONS[here].name.toUpperCase();

        // Se rehacen las dos texturas: el destino y el lado cambian cada vez.
        const put = (i, titulo, sub, flecha) => {
            if (c.sign.tex[i]) c.sign.tex[i].dispose();
            c.sign.tex[i] = signTexture(titulo, sub, flecha);
            c.sign.panels[i].material.map = c.sign.tex[i];
            c.sign.panels[i].material.needsUpdate = true;
        };
        put(0, izq ? nombre : 'RETORNO', izq ? 'DESVÍO' : aqui, -1);
        put(1, izq ? 'RETORNO' : nombre, izq ? aqui : 'DESVÍO', 1);

        c.sign.z = z;
        c.sign.curve = trackCurve(c.sign.z);
        c.sign.rise = trackRise(c.sign.z);
        c.sign.active = true;
        c.sign.group.visible = true;
    } else {
        // Sin portico: aqui no hay nada que leer, hay que mirar de que lado
        // esta el disco rojo. Un portico verde vacio seria ruido.
        c.sign.active = false;
        c.sign.group.visible = false;
        c.blocked = Math.random() < 0.5 ? -1 : 1;
        spawnWarn('noVirar', z - 26, c.blocked, true);
        spawnWarn('noVirar', z - 74, c.blocked, true);
    }

    // La bifurcacion empieza donde esta la isleta. s0 se guarda como distancia
    // recorrida y no como z, porque la z se mueve y la coordenada de trazado no.
    game.fork.active = true;
    game.fork.s0 = game.distance - (z - CROSS_SIGN_AHEAD);
    game.fork.chosen = 0;
    game.fork.mainBand = -1;
    game.fork.away = 0;

    c.island.z = z - CROSS_SIGN_AHEAD;
    c.island.curve = trackCurve(c.island.z);
    c.island.rise = trackRise(c.island.z);
    c.island.active = true;
    c.island.group.visible = true;
}

// Tomar una salida. El CAMBIO adelanta la ruta al principio del departamento
// elegido; el RETORNO la devuelve al principio del actual. En los dos casos se
// mueve routePos, que es lo unico que decide en que departamento se esta.
function takeExit(c, lane) {
    // El ramal se fija SIEMPRE, incluso si se ha saltado el divisor por
    // arriba. Dejandolo sin fijar, forkDX pierde el termino que recentra el
    // mundo sobre el jugador y la calzada se le desliza de debajo de los pies
    // hasta ocho unidades. Quien salta el divisor cae en el ramal izquierdo.
    game.fork.chosen = lane === 2 ? 1 : -1;
    game.fork.mainBand = game.fork.chosen;

    // --- Bifurcacion cortada ---
    // No lleva a ninguna parte: lo unico que hay que hacer es no meterse por
    // donde el disco rojo dice que no. Si se hace, el derrumbe aparece unas
    // decenas de unidades mas alla —tiempo de verlo llegar y de entender que
    // era eso del cartel— y se apunta por donde tendria que haber ido, para
    // devolverlo ahi si decide revivir.
    if (c.kind === 1) {
        if (lane === 1) return;                    // saltar el divisor no elige
        if (game.fork.chosen === c.blocked) {
            spawnObstacle(MURO, 1, -52, 0);
            game.wrongC = c;
            game.wrongLane = c.blocked < 0 ? 2 : 0;
        } else {
            // Acertar tambien paga algo: si no, la unica consecuencia posible
            // de la senal seria mala y no habria razon para alegrarse de verla.
            game.jade += 2;
            game.jadeScore += Math.round(50 * jadeScale());
            burstParticles(player.x, player.y + 1.2, PLAYER_Z, 14, 1, C.jade);
            hudDirty = true;
        }
        return;
    }

    // Pero por encima del divisor no se TOMA ninguna salida: el muro se puede
    // librar, pero entonces no se ha elegido nada, y cobrar el premio del
    // retorno por ello seria pagar por no decidir.
    if (lane === 1) return;

    const cambio = lane === c.swapLane;
    const desde = Math.floor(routePos()) % REGION_N;
    const destino = cambio ? c.target : desde;

    // La ruta salta aqui y en ningun otro sitio.
    const antes = Math.floor(game.routePos) % REGION_N;
    game.routePos = destino + 0.02;
    // Y el firme cambia en una linea que se ve venir: sesenta unidades por
    // delante, justo donde los dos ramales acaban de abrirse.
    if (destino !== antes) {
        game.roadFrom = antes;
        game.roadS0 = game.distance + 60;
    }

    game.crossTaken++;
    lastBlendKey = -1;          // la escena se repinta entera, sin cache
    mmLastName = '';
    resetRoadColors();
    showRegionBanner(destino);

    // Solo se cruza el paisaje si de verdad se cambia de departamento
    if (destino !== desde) {
        game.snapFrom = desde;
        game.snapT = 0;
    }

    if (cambio) {
        const id = REGIONS[destino].id;
        if (!save.regions.includes(id)) {
            save.regions.push(id);
            persist();
            refreshMinimapDots();
        }
    } else {
        // El retorno no lleva a ningun sitio nuevo, asi que paga en jade: sin
        // nada a cambio nadie lo tomaria jamas y la mitad del cruce sobraria.
        game.jade += 3;
        game.jadeScore += Math.round(75 * jadeScale());
        burstParticles(player.x, player.y + 1.2, PLAYER_Z, 18, 1.1, C.jade);
    }

    game.region = destino;
    hudDirty = true;
    sfx.region();
}

function updateCrossings(dt) {
    const dz = game.speed * dt;

    if (game.snapT < 1) game.snapT = Math.min(1, game.snapT + dt / SNAP_TIME);

    // Elegido un ramal, el otro se abre y se pierde de vista en poco mas de un
    // segundo. Es lo que hace legible por donde se fue uno: si los dos siguen
    // ahi, abiertos y paralelos, no hay forma de saber cual es el tuyo.
    if (game.fork.active && game.fork.chosen !== 0) {
        game.fork.away = Math.min(1, game.fork.away + dt / 1.1);
    }

    for (const c of crossings) {
        if (!c.active) continue;
        c.z += dz;

        const sg = c.sign;
        sg.z += dz;
        sg.group.position.set(curveOf(sg), riseOf(sg), sg.z);
        if (sg.active && sg.z > DESPAWN_Z + 8) { sg.active = false; sg.group.visible = false; }

        const il = c.island;
        il.z += dz;
        il.group.position.set(curveOf(il), riseOf(il), il.z);

        // La salida se resuelve cuando la COLA de la isleta deja atras al
        // jugador: antes de eso todavia puede cambiarse de carril, y decidirlo
        // al llegar la punta le quitaria al tramo toda su tension.
        if (!c.done && il.z - CROSS_ISLAND_LEN / 2 > PLAYER_Z) {
            c.done = true;
            takeExit(c, player.lane);
        }

        if (il.z - CROSS_ISLAND_LEN / 2 > DESPAWN_Z) {
            il.active = false;
            il.group.visible = false;
            if (!sg.active) c.active = false;
        }
    }

    // La bifurcacion se apaga cuando el jugador la ha dejado del todo atras:
    // pasado ese punto los dos terminos de forkDX ya se cancelan y apagarla no
    // mueve nada, asi que no hay tiron.
    if (game.fork.active && game.distance > game.fork.s0 + FORK_LEN + 40) {
        game.fork.active = false;
        game.fork.chosen = 0;
        game.fork.mainBand = -1;
    }

}

// La isleta es un muro. Se comprueba aparte de los obstaculos porque es larga
// y porque no vive en el pool de obstaculos.
function islandHit() {
    for (const c of crossings) {
        if (!c.active || !c.island.active) continue;
        const il = c.island;
        if (Math.abs(il.z - PLAYER_Z) > CROSS_ISLAND_LEN / 2 + 1.4) continue;
        if (Math.abs(player.x - LANE_X[1]) > LANE_HALF) continue;
        if (player.y > 1.35) continue;            // por encima si que se pasa
        return true;
    }
    return false;
}

// ===========================================================================
// Entrada
// ===========================================================================
function moveLane(dir) {
    const next = Math.max(0, Math.min(2, player.lane + dir));
    if (next === player.lane) return;

    // El costado de un tramo elevado es un muro. Se rechaza el cambio en vez
    // de cobrar una vida: el desnivel es un problema de ruta, no una trampa, y
    // castigarlo con dano lo volveria injusto justo cuando aun no lo entiendes.
    // Para subir: la rampa de tu carril, o un salto.
    if (game.powers.flight <= 0 && terrainAt(next, PLAYER_Z) > player.y + STEP_UP) {
        player.bump = 0.18;
        player.bumpDir = dir;
        shake = Math.max(shake, 0.16);
        sfx.bump();
        return;
    }

    // El tween arranca desde donde esta el cuerpo AHORA, no desde el carril
    // anterior: encadenar dos cambios seguidos ya no da un tiron hacia atras.
    player.laneFrom = player.x;
    player.lanePrev = player.lane;
    player.lane = next;
    player.laneT = 0;
    sfx.lane();
}

function doJump(v) {
    player.vy = v;
    player.grounded = false;
    player.coyote = 0;
    player.buffer = 0;
    player.sliding = 0;
    player.wantSlide = false;
}

function jump() {
    if (game.powers.flight > 0) return;      // volando no hay nada que saltar

    if (player.grounded || player.coyote > 0) {
        // Coyote time: un salto pulsado justo despues de dejar el borde sigue
        // valiendo. Es la queja clasica del genero cuando falta.
        doJump(JUMP_V);
        player.jumps = 1;
        sfx.jump();
    } else if (lvl('djump') > 0 && player.jumps < 2) {
        doJump(DOUBLE_JUMP_V);
        player.jumps = 2;
        sfx.djump();
        burstParticles(player.x, player.y + 0.4, PLAYER_Z, 6, 0.6, 0x7fd4ff);
    } else {
        // Buffer: pulsado un instante antes de aterrizar, se atiende al tocar
        // suelo en vez de perderse.
        player.buffer = JUMP_BUFFER;
    }
}

function releaseJump() {
    player.holding = false;
    // Salto de altura variable: soltar pronto corta la subida. Es lo que
    // convierte un unico salto fijo en un control con matices.
    if (player.vy > 0) player.vy *= JUMP_CUT;
}

function slide() {
    if (game.powers.flight > 0) return;

    if (!player.grounded) {
        // En el aire, abajo es un picado. Antes solo restaba un poco de
        // velocidad vertical y el deslizamiento caducaba antes de aterrizar,
        // asi que no servia para nada.
        player.vy = FAST_FALL_V;
        player.wantSlide = true;
        return;
    }
    if (player.sliding > 0) return;
    player.sliding = SLIDE_TIME;
    sfx.slide();
}

function initInput() {
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;

        if (game.state === State.REVIVE) {
            if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); doRevive(); }
            else if (e.code === 'Escape') { e.preventDefault(); declineRevive(); }
            return;
        }

        if (game.state === State.SHOP) {
            if (e.code === 'Escape') { e.preventDefault(); closeShop(); }
            return;
        }

        if ((game.state === State.MENU || game.state === State.OVER) &&
            (e.code === 'Enter' || e.code === 'Space')) {
            e.preventDefault();
            startGame();
            return;
        }

        // Estando en pausa solo se admite salir de ella o cambiar el sonido.
        // Antes se podia cambiar de carril y saltar con el juego detenido, y
        // al reanudar el personaje aparecia donde no debia.
        if (game.state === State.PAUSED) {
            if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); }
            else if (e.code === 'KeyM') setSound(!audio.on);
            else if (e.code === 'KeyN') setMusic(!music.on);
            return;
        }

        if (game.state !== State.PLAYING) return;

        switch (e.code) {
            case 'ArrowLeft': case 'KeyA': moveLane(-1); break;
            case 'ArrowRight': case 'KeyD': moveLane(1); break;
            case 'ArrowUp': case 'KeyW': case 'Space':
                e.preventDefault();
                player.holding = true;
                jump();
                break;
            case 'ArrowDown': case 'KeyS': e.preventDefault(); slide(); break;
            case 'KeyP': case 'Escape': togglePause(); break;
            case 'KeyM': setSound(!audio.on); break;
            case 'KeyN': setMusic(!music.on); break;
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') releaseJump();
    });

    // Gestos tactiles. El gesto se resuelve en cuanto el dedo pasa el umbral,
    // sin esperar a que se levante: esperar al touchend metia hasta 200 ms de
    // retraso en cada esquiva, que a velocidad maxima son seis unidades.
    let sx = 0, sy = 0, tracking = false, resolved = false;
    const MIN_SWIPE = 26;

    window.addEventListener('touchstart', (e) => {
        if (game.state !== State.PLAYING) return;
        tracking = true;
        resolved = false;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        player.holding = true;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!tracking || resolved || game.state !== State.PLAYING) return;
        const dx = e.touches[0].clientX - sx;
        const dy = e.touches[0].clientY - sy;
        if (Math.abs(dx) < MIN_SWIPE && Math.abs(dy) < MIN_SWIPE) return;

        resolved = true;
        if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
        else if (dy < 0) jump();
        else slide();
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (!tracking) return;
        tracking = false;
        if (game.state === State.PLAYING && !resolved) jump();   // toque simple = salto
        // En tactil no hay forma de "mantener": el salto sale siempre entero.
        player.holding = false;
    }, { passive: true });

    window.addEventListener('touchcancel', () => {
        tracking = false;
        player.holding = false;
    }, { passive: true });
}

// ===========================================================================
// Simulacion
// ===========================================================================
// --- Salirse de la carretera ---
// No es un golpe: es que debajo ya no hay calzada. Por eso no descuenta una
// vida ni respeta el escudo —un escudo no pone suelo donde no lo hay— y por
// eso se ve caer antes de que termine la partida. Sin esa caida, quedarse en
// el carril que desaparece se leeria como un fallo del juego y no como uno
// propio, que es justo lo que hay que evitar cuando algo mata de golpe.
function fallOut(vx) {
    if (player.out > 0 || game.state !== State.PLAYING) return;
    player.out = FALL_TIME;
    player.outVX = vx;
    player.vy = 2.5;                 // un empujoncito hacia arriba: se tropieza
    player.sliding = 0;
    player.wantSlide = false;
    player.grounded = false;
    game.powers.flight = 0;
    shake = 0.6;
    sfx.hit();
}

function updateFall(dt) {
    player.out -= dt;
    player.vy += GRAVITY * 1.1 * dt;
    player.y += player.vy * dt;
    player.x += player.outVX * dt;
    player.outVX *= 1 - Math.min(1, 0.7 * dt);

    playerGroup.position.set(player.x, player.y, PLAYER_Z);
    // Da vueltas al caer. Es lo que separa una caida de un salto largo.
    playerGroup.rotation.z += dt * 4.2 * (player.outVX >= 0 ? -1 : 1);
    playerGroup.rotation.x -= dt * 2.6;
    shadowMesh.material.opacity = 0;

    if (player.out <= 0) {
        player.out = 0;
        endGame();
    }
}

function updatePlayer(dt) {
    if (player.out > 0) { updateFall(dt); return; }

    // --- Carril: tween con final garantizado ---
    // El lerp exponencial anterior nunca llegaba del todo al carril, asi que
    // el cuerpo quedaba a medio camino y las colisiones se volvian confusas.
    if (player.laneT < 1) {
        player.laneT = Math.min(1, player.laneT + dt / laneTime());
        const e = 1 - Math.pow(1 - player.laneT, 3);       // easeOutCubic
        player.x = player.laneFrom + (LANE_X[player.lane] - player.laneFrom) * e;
    } else {
        player.x = LANE_X[player.lane];
    }

    const flying = game.powers.flight > 0;

    // --- Suelo bajo los pies ---
    // Ya no es siempre cero. Durante un cambio de carril se toma la altura MAS
    // ALTA de los dos carriles implicados: como entrar en un carril alto desde
    // abajo ya esta prohibido en moveLane, aqui las dos alturas siempre son
    // compatibles, y usar el maximo hace que salir de un tramo elevado sea
    // correr hasta el borde y caer, en vez de desaparecer a mitad de camino.
    const gTo = terrainAt(player.lane, PLAYER_Z);
    const gy = player.laneT < 1
        ? Math.max(gTo, terrainAt(player.lanePrev, PLAYER_Z))
        : gTo;
    player.groundY = gy;

    if (flying) {
        // Vuelo: se sube a altura de crucero y se queda ahi. La gravedad se
        // desconecta del todo para que aterrizar sea decision del temporizador
        // y no del jugador.
        player.y += (FLY_Y - player.y) * Math.min(1, 4 * dt);
        player.vy = 0;
        player.grounded = false;
        player.sliding = 0;
        player.jumps = 0;
        // Sin esto el margen de coyote se congelaba durante todo el vuelo y al
        // terminar permitia un salto desde el aire, como si hubiera suelo.
        player.coyote = 0;
    } else if (!player.grounded) {
        player.coyote = Math.max(0, player.coyote - dt);
        // La bajada pesa mas que la subida: el salto deja de ser flotante y se
        // vuelve mucho mas facil calcular donde vas a caer.
        player.vy += GRAVITY * (player.vy < 0 ? FALL_GRAVITY : 1) * dt;
        player.y += player.vy * dt;

        if (player.y <= gy) {
            player.y = gy;
            player.vy = 0;
            player.grounded = true;
            player.jumps = 0;
            player.land = LAND_SQUASH;
            sfx.land();

            if (player.buffer > 0) {
                player.buffer = 0;
                jump();
            } else if (player.wantSlide) {
                // El picado se encadena con el deslizamiento: pulsas abajo en
                // el aire y llegas al suelo ya agachado.
                player.wantSlide = false;
                player.sliding = SLIDE_TIME;
                sfx.slide();
            }
        }
    } else {
        // En el suelo se sigue el relieve. La rampa se sube y se baja pegado a
        // ella; solo una caida de verdad (el borde del tramo) suelta al
        // jugador al aire, o cada rampa se bajaria a saltitos.
        if (gy < player.y - STEP_DOWN) {
            player.grounded = false;
            player.vy = 0;
            player.coyote = COYOTE_TIME;
        } else {
            if (gy > player.y + 0.001 && player.y < 0.05) sfx.ramp();
            player.y = gy;
            player.coyote = COYOTE_TIME;
            player.jumps = 0;
            player.wantSlide = false;
        }
    }

    if (player.buffer > 0) player.buffer = Math.max(0, player.buffer - dt);
    if (player.sliding > 0) player.sliding = Math.max(0, player.sliding - dt);
    if (player.land > 0) player.land = Math.max(0, player.land - dt);
    if (player.bump > 0) player.bump = Math.max(0, player.bump - dt);

    // Ciclo de carrera
    player.run += dt * game.speed * 0.55;

    // ===== Postura =====
    playerGroup.position.set(player.x, player.y, PLAYER_Z);

    const sliding = player.sliding > 0 && player.grounded;
    const squashK = player.land / LAND_SQUASH;             // 1 al tocar, 0 al recuperarse

    // Aplastado al aterrizar: peso sin coste, y avisa de que ya tocaste suelo
    let sy = 1 - squashK * 0.26;
    let sxz = 1 + squashK * 0.16;

    // Ya no se achata: lo que baja la silueta es la inclinacion del cuerpo.
    // Achatar Y tumbar dejaba una figura deforme.
    if (sliding) { sy = 0.92; sxz = 1; }

    playerBody.scale.set(sxz, sy, sliding ? 1.6 : sxz);
    // Deslizarse no es agacharse: es tirarse de barriga. El cuerpo se pone
    // practicamente horizontal —cinco grados de plano— y baja hasta rozar la
    // calzada. Con la inclinacion anterior seguia leyendose como alguien en
    // cuclillas, que es una postura de la que se puede uno levantar; esta no.
    playerBody.rotation.x = sliding ? -1.48 : -0.06 - (game.speed - SPEED_START) * 0.006;
    playerBody.position.y = sliding ? -0.06 : 0;
    // Bamboleo del roce, cortito y rapido: es lo unico que dice que se esta
    // arrastrando por el suelo y no volando a un palmo de el.
    playerBody.rotation.z = sliding ? Math.sin(player.run * 3.4) * 0.05 : 0;

    // Inclinacion lateral: se calcula contra el destino, asi que el cuerpo se
    // tumba al salir y se endereza al llegar.
    const lean = (LANE_X[player.lane] - player.x) / 2.3;
    playerGroup.rotation.z = -lean * 0.34;
    playerGroup.rotation.y = lean * 0.28;

    const s = Math.sin(player.run);
    const c = Math.cos(player.run);

    if (flying) {
        // Colgado de las garras del quetzal: cuerpo casi vertical, brazos
        // estirados hacia arriba agarrandose y piernas balanceandose sueltas.
        // La postura de planeo anterior no explicaba por que no caia.
        playerBody.rotation.x = 0.05 + Math.sin(game.elapsed * 2.2) * 0.05;
        playerParts.armL.rotation.set(-2.85, 0, -0.12);
        playerParts.armR.rotation.set(-2.85, 0, 0.12);
        playerParts.legL.rotation.set(Math.sin(game.elapsed * 2.6) * 0.28 + 0.12, 0, 0);
        playerParts.legR.rotation.set(Math.sin(game.elapsed * 2.6 + 0.9) * 0.28 + 0.05, 0, 0);
        playerParts.torso.position.y = 1.28;
        playerParts.head.rotation.set(-0.12, 0, 0);
    } else if (sliding) {
        // Los DOS brazos estirados hacia delante, como quien se tira de cabeza
        // a una piscina. Con el cuerpo ya tumbado, un brazo a -2,7 queda
        // apuntando al frente y pegado al suelo. Antes iba uno estirado y otro
        // recogido y la silueta salia torcida: se leia como una caida, no como
        // un deslizamiento controlado.
        const roce = Math.sin(player.run * 3.4);
        playerParts.armL.rotation.set(-2.72 + roce * 0.06, 0, 0.16);
        playerParts.armR.rotation.set(-2.72 - roce * 0.06, 0, -0.16);
        // Piernas estiradas hacia atras y muy juntas, aleteando un poco. Con
        // el cuerpo horizontal, giro cero ya las deja apuntando atras.
        playerParts.legL.rotation.set(0.06 + roce * 0.12, 0, 0.05);
        playerParts.legR.rotation.set(0.06 - roce * 0.12, 0, -0.05);
        playerParts.torso.position.y = 1.28;
        // La cabeza compensa la inclinacion entera del cuerpo para seguir
        // mirando al frente. Sin esto va de cara contra el suelo.
        playerParts.head.rotation.set(1.42, 0, 0);
    } else if (player.grounded) {
        // Zancada: los miembros giran desde la articulacion y los brazos van
        // en contrafase con las piernas, como al correr de verdad.
        playerParts.legL.rotation.set(s * 0.95, 0, 0);
        playerParts.legR.rotation.set(-s * 0.95, 0, 0);
        playerParts.armL.rotation.set(-s * 0.8, 0, 0.1);
        playerParts.armR.rotation.set(s * 0.8, 0, -0.1);
        playerParts.torso.position.y = 1.28 + Math.abs(c) * 0.05;
        playerParts.head.rotation.x = -0.05 + Math.abs(c) * 0.06;
        playerParts.head.rotation.z = s * 0.05;
    } else {
        // En el aire: piernas recogidas al subir, estiradas al caer, brazos
        // arriba. La silueta cambia lo bastante para saber de un vistazo si
        // estas subiendo o bajando.
        const rising = player.vy > 0 ? 1 : 0;
        playerParts.legL.rotation.set(rising ? -1.0 : -0.25, 0, 0);
        playerParts.legR.rotation.set(rising ? -0.55 : 0.25, 0, 0);
        playerParts.armL.rotation.set(-2.0, 0, 0.25);
        playerParts.armR.rotation.set(-2.0, 0, -0.25);
        playerParts.head.rotation.set(rising ? -0.15 : 0.2, 0, 0);
    }

    // Topetazo contra el muro de un carril alto: el cuerpo se asoma y vuelve.
    // Sin este acuse, un cambio de carril rechazado parece que no se registro.
    if (player.bump > 0) {
        const b = player.bump / 0.18;
        playerGroup.position.x += Math.sin(b * Math.PI) * 0.5 * player.bumpDir;
        playerGroup.rotation.z += Math.sin(b * Math.PI) * 0.18 * player.bumpDir;
    }

    // Sombra de contacto: se encoge y se aclara con la ALTURA SOBRE EL SUELO,
    // no sobre el cero absoluto. Sobre un tramo elevado la sombra va con el
    // jugador; si se quedase abajo, aterrizar dejaria de poder calcularse.
    const h = Math.min(player.y - gy, 6);
    const k = 1 - h * 0.085;
    shadowMesh.position.set(player.x, gy + 0.03, PLAYER_Z);
    shadowMesh.scale.set(k, k, 1);
    shadowMesh.material.opacity = Math.max(0.08, 0.4 - h * 0.045);

    // Invulnerabilidad: se baja la opacidad en vez de ocultar al personaje.
    // Alternar visible lo hacia desaparecer 1,4 s justo cuando mas falta hace
    // saber donde estas.
    if (game.invuln > 0) {
        game.invuln -= dt;
        const flash = 0.35 + 0.45 * (Math.sin(game.invuln * 34) * 0.5 + 0.5);
        for (const m of Object.values(playerMats)) m.opacity = flash;
        if (game.invuln <= 0) for (const m of Object.values(playerMats)) m.opacity = 1;
    }
}

function scrollWorld(dt) {
    const dz = game.speed * dt;
    game.distance += dz;

    // Desplazamiento lateral de la curva en el punto donde esta el jugador.
    // Todo lo demas se dibuja restando este valor, de modo que el jugador
    // siempre queda sobre su carril y la calzada se dobla a su alrededor.
    game.curveBase = curveX(game.distance);
    game.riseBase = curveY(game.distance);
    game.slopeBase = -slopeAt(game.distance) * SLOPE_DROP;

    // --- Calzada y horizonte: solo se mueve el Group ---
    // La Z sigue resolviendose con el modulo del contenedor, que es lo que
    // evita recolocar 180 instancias por paso de simulacion. La X, en cambio,
    // ya no puede: la curva se recompone una vez por FRAME en updateRoadCurve.
    roadGroup.position.z = game.distance % ROAD_PERIOD;
    landGroup.position.z = (game.distance * 0.82) % LAND_PERIOD;
    // Los hitos del fondo no se doblan uno a uno (serian 336 matrices por
    // frame por un detalle que esta en la bruma): se desplaza el grupo entero
    // por la curva a media distancia, que da el mismo paralaje al ojo.
    landGroup.position.x = curveAtZ(-90) * 1.15;
    landGroup.position.y = riseAtZ(-90) * 0.9;

    // --- Tramos elevados ---
    for (const p of platforms) {
        if (!p.active) continue;
        p.z += dz;
        // El grupo va sobre su carril a pelo y CADA PIEZA se desplaza por su
        // cuenta segun la z que ocupa. Un tramo puede medir setenta unidades:
        // moverlo entero con un solo desplazamiento lo dejaba cruzado sobre la
        // calzada en cuanto esta empezaba a doblarse.
        p.group.position.x = LANE_X[p.lane];
        p.group.position.z = p.z;
        p.up.position.x = curveAtZ(p.z - RAMP_LEN / 2);
        p.up.position.y = p.rampY + riseAtZ(p.z - RAMP_LEN / 2);
        p.side.position.x = curveAtZ(p.z + p.side.position.z);
        p.side.position.y = (LEVEL_HIGH - 0.26) / 2 + riseAtZ(p.z + p.side.position.z);
        p.deck.position.x = curveAtZ(p.z + p.deck.position.z);
        p.deck.position.y = LEVEL_HIGH - 0.13 + riseAtZ(p.z + p.deck.position.z);
        p.down.position.x = curveAtZ(p.z + p.down.position.z);
        p.down.position.y = p.rampY + riseAtZ(p.z + p.down.position.z);
        // Se recicla cuando su COLA pasa de largo, no su boca: si no, el tramo
        // desapareceria con el jugador todavia encima.
        if (p.z - 2 * RAMP_LEN - p.len > DESPAWN_Z) {
            p.active = false;
            p.group.visible = false;
        }
    }

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        o.z += dz;
        o.group.position.x = LANE_X[o.lane] + curveOf(o);
        o.group.position.y = o.baseY + riseOf(o);
        o.group.position.z = o.z;
        if (o.z > DESPAWN_Z) { o.active = false; o.group.visible = false; }
    }

    // --- Senales ---
    for (const w of warns) {
        if (!w.active) continue;
        w.z += dz;
        w.group.position.set(
            w.side * (ROAD_WIDTH / 2 + 1.7) + curveOf(w), riseOf(w), w.z
        );
        // Entra desde transparente en sus primeras unidades de vida
        const t = Math.min(1, (w.z - w.born) / WARN_FADE);
        w.face.material.opacity = t * t * (3 - 2 * t);
        if (w.z > DESPAWN_Z) { w.active = false; w.group.visible = false; }
    }

    // --- Placas de impulso ---
    for (const b of boosts) {
        if (!b.active) continue;
        b.z += dz;
        b.group.position.x = LANE_X[b.lane] + curveOf(b);
        b.group.position.y = b.y + riseOf(b);
        b.group.position.z = b.z;
        // Los galones laten hacia delante: sin movimiento la placa se leia
        // como una mancha en el suelo y no como algo que hay que pisar.
        for (let k = 0; k < b.marks.length; k++) {
            const ph = (game.elapsed * 2.6 + k * 0.18) % 1;
            b.marks[k].position.y = 0.13 + ph * 0.06;
        }
        if (b.z > DESPAWN_Z) { b.active = false; b.group.visible = false; }
    }

    // --- Amenazas ---
    // Avanzan con el mundo MAS lo suyo propio, que es lo que hace que se lean
    // como algo que viene a por ti y no como parte del decorado.
    for (const h of hazards) {
        if (!h.active) continue;
        h.z += dz + HAZ_SPEED[h.type] * dt;
        h.phase += dt;

        const base = terrainAt(h.lane, h.z);
        let x = hazX(h, h.z);

        if (h.type === CAMAZOTZ) {
            // Zigzag corto: no cambia de carril, pero obliga a leerlo.
            x += Math.sin(h.phase * 3.1) * 0.55;
            h.y = base + 1.8 + Math.sin(h.phase * 4.6) * 0.16;
            const flap = Math.sin(h.phase * 19) * 0.9;
            h.wingL.rotation.z = flap;
            h.wingR.rotation.z = -flap;
            h.bat.rotation.z = Math.sin(h.phase * 3.1) * 0.2;
        } else if (h.type === RODANTE) {
            // Las del derrumbe caen del cerro antes de empezar a rodar.
            // Mientras estan en el aire su ancla va alta, y como la franja de
            // golpe se mide desde el ancla, no golpean hasta tocar la calzada:
            // sale gratis y es lo correcto.
            if (h.drop > 0) {
                h.dropV -= 62 * dt;
                h.drop = Math.max(0, h.drop + h.dropV * dt);
                if (h.drop === 0) {
                    shake = Math.max(shake, 0.3);
                    burstParticles(x, riseAtZ(h.z), h.z, 10, 1, 0x8a7a68);
                    sfx.bump();
                }
                h.rock.rotation.z += dt * 3.2;
            }
            h.y = base + 0.72 + h.drop;
            h.rock.rotation.x -= dt * 7.5;
        } else if (h.type === VACA) {
            // Cruza al paso. Avanza de lado en proporcion a lo que avanza el
            // mundo, no al reloj: asi pasa siempre por el mismo punto vaya el
            // jugador a la velocidad que vaya.
            h.cross += h.crossTo * dz * COW_CROSS;
            x = hazX(h, h.z);
            h.y = base;
            const paso = Math.sin(h.phase * 6.5);
            for (let k = 0; k < 4; k++) {
                h.patas[k].rotation.x = (k % 2 ? -paso : paso) * 0.42;
            }
            h.cuerpo.position.y = Math.abs(Math.cos(h.phase * 6.5)) * 0.06;
            h.rabo.rotation.z = Math.sin(h.phase * 2.4) * 0.35;
        } else {
            // Camioneta: viene de frente, se bambolea y lleva los faros
            // encendidos. Ese bamboleo es lo unico que la separa de un muro.
            h.y = base;
            h.bus.rotation.z = Math.sin(h.phase * 3.4) * 0.022;
            h.bus.position.y = Math.abs(Math.sin(h.phase * 6.8)) * 0.045;
        }

        h.group.position.set(x, h.y + riseAtZ(h.z), h.z);
        if (h.z > DESPAWN_Z + 6) { h.active = false; h.group.visible = false; }
    }

    // --- Recogidas ---
    const range = magnetRange();
    for (const p of pickups) {
        if (!p.active) continue;
        p.z += dz;
        p.mesh.rotation.y += dt * 3.4;
        p.mesh.rotation.x += dt * 1.6;

        // Iman: solo tira del jade. Robarle al jugador la decision de ir a por
        // un poder concreto le quitaria la gracia al poder.
        if (range > 0 && p.kind === 'jade' &&
            p.z > -range && p.z < 4 && Math.abs(LANE_X[p.lane] - player.x) < 6.5) {
            const pull = Math.min(1, 7 * dt);
            p.z += (PLAYER_Z - p.z) * Math.min(1, 3.2 * dt);
            p.mesh.position.x += (player.x - p.mesh.position.x) * pull;
            p.mesh.position.y += ((player.y + 1.1) - p.mesh.position.y) * pull;
            p.pulled = true;
        } else if (!p.pulled) {
            p.mesh.position.x = LANE_X[p.lane] + curveOf(p);
            p.mesh.position.y = p.y + riseOf(p);
        }

        p.mesh.position.z = p.z;
        if (p.z > DESPAWN_Z) { p.active = false; p.mesh.visible = false; }
    }

    updateCrossings(dt);
    updateTrackSystems();
    runPending();

    // --- Nuevos compases ---
    // El hueco se estrecha con el tiempo, pero nunca por debajo de lo que el
    // jugador alcanza a leer: a velocidad maxima 24 unidades son ~0.8 s.
    // --- Distribuidor vial ---
    // Se dispara por distancia y no dentro de un compas: tiene que aparecer
    // donde toca, no cuando le venga bien al generador.
    if (game.distance > game.nextCross) {
        game.nextCross += CROSS_EVERY;
        spawnCrossing(SPAWN_Z);
        // Solo la Y de bifurcacion, una a cada lado porque la decision es de
        // lado. El ceda el paso se ha quitado: no anunciaba nada que el
        // jugador pudiera hacer —no hay a quien ceder el paso— y ademas su
        // triangulo rojo y blanco se confundia de lejos con el disco rojo de
        // prohibido virar, que si dice algo y muy concreto.
        spawnWarn('bifurcacion', SPAWN_Z + WARN_AHEAD + 26, -1, true);
        spawnWarn('bifurcacion', SPAWN_Z + WARN_AHEAD + 26, 1, true);
    }

    game.nextSpawnZ += dz;
    const gapTime = GAP_TIME_START -
        Math.min(game.distance / GAP_TIME_OVER, 1) * (GAP_TIME_START - GAP_TIME_MIN);
    const gap = game.speed * gapTime;
    if (game.nextSpawnZ > SPAWN_Z + gap) {
        generateChunk(SPAWN_Z);
        game.nextSpawnZ = SPAWN_Z;
    }
}

function checkCollisions() {
    if (player.out > 0) return;
    const flying = game.powers.flight > 0;
    // Volando el jugador va muy por encima de la calzada: con la tolerancia
    // de a pie el jade le pasaria por debajo sin poder recogerlo.
    const yTol = flying ? 5.6 : 1.7;
    const reach = jadeReach();

    // --- Recogidas ---
    for (const p of pickups) {
        if (!p.active) continue;
        if (Math.abs(p.z - PLAYER_Z) > 1.3) continue;
        // Por posicion real de la pieza, no por su indice de carril: con el
        // iman activo la pieza ya no esta sobre su carril.
        if (Math.abs(player.x - p.mesh.position.x) > reach) continue;
        if (Math.abs(p.mesh.position.y - (player.y + 1.1)) > yTol) continue;

        p.active = false;
        p.mesh.visible = false;
        collect(p);
    }

    // --- Placas de impulso ---
    // Se pisan, no se recogen: hay que ir por el suelo. Pasar por encima
    // saltando no cuenta, y eso las convierte en una decision.
    for (const b of boosts) {
        if (!b.active) continue;
        if (Math.abs(b.z - PLAYER_Z) > 1.8) continue;
        if (Math.abs(player.x - b.group.position.x) > 1.15) continue;
        if (player.y - b.y > 1.2) continue;

        b.active = false;
        b.group.visible = false;
        game.boost = BOOST_TIME;
        game.boostPerm = Math.min(BOOST_KEEP_MAX, game.boostPerm + BOOST_KEEP);
        sfx.boost();
        burstParticles(player.x, player.y + 0.4, PLAYER_Z, 16, 0.9, 0x4affd0);

        // Cada tres placas, una vida. Es la unica forma de recuperar vidas
        // corriendo, y va atada a lo unico del juego que hay que salir a
        // buscar: la placa no te la encuentras, te desvias a pisarla.
        //
        // Si ya vas al completo, las tres placas NO se pierden: pagan en jade.
        // Perderlas por ir bien seria castigar precisamente al que no ha
        // fallado, y ademas hace ilegible la regla —pisas tres, no pasa nada,
        // y no sabes por que—.
        if (++game.boostTaken >= BOOST_PER_LIFE) {
            game.boostTaken = 0;
            burstParticles(player.x, player.y + 1.3, PLAYER_Z, 22, 1.3, 0x4affd0);
            if (game.lives < maxLives()) {
                game.lives++;
                showBanner('VIDA EXTRA', BOOST_PER_LIFE + ' aceleradores');
            } else {
                game.jade += 5;
                game.jadeScore += Math.round(120 * jadeScale());
                showBanner('+5 JADE', 'vidas al completo');
            }
        }
        hudDirty = true;
    }

    // --- Quedarse donde ya no hay calzada ---
    // Va ANTES del filtro de invulnerabilidad y del vuelo: no es un golpe del
    // que protegerse, es el suelo que se acabo. Volando si se pasa, que para
    // eso es volar, pero al aterrizar se cae igual.
    const anchoAqui = narrowAt(game.distance) * ROAD_WIDTH / 2;
    if (!flying && player.y < 1.3 && Math.abs(player.x) > anchoAqui - 0.45) {
        fallOut(Math.sign(player.x) * 6);
        return;
    }

    // --- Fuerza centrifuga en la curva cerrada ---
    // Aguantar por el lado hacia el que cierra la curva acaba sacandote de la
    // carretera. Se cuenta el tiempo y se descuenta al doble en cuanto te
    // apartas: castiga quedarse, no pasar.
    const giro = turnGrip(game.distance);
    if (giro > 0.25 && !flying) {
        const fuera = game.turn.dir < 0 ? 0 : 2;
        if (player.lane === fuera) {
            game.turnHold += 1 / 60;
            if (game.turnHold > TURN_HOLD) {
                game.turnHold = 0;
                fallOut(game.turn.dir * 16);
                return;
            }
        } else {
            game.turnHold = Math.max(0, game.turnHold - 2 / 60);
        }
    } else if (game.turnHold > 0) {
        game.turnHold = Math.max(0, game.turnHold - 2 / 60);
    }

    if (game.invuln > 0 || flying) return;

    if (islandHit()) { takeHit(); return; }

    const sliding = player.sliding > 0 && player.grounded;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        // El vacio ocupa un tramo entero, no un borde: su ventana es su largo.
        const zHalf = o.type === VACIO ? VACIO_LEN / 2 + 0.4 : HIT_WINDOW;
        if (Math.abs(o.z - PLAYER_Z) > zHalf) continue;
        // Igual que las recogidas: cuenta donde esta el cuerpo, no a que
        // carril apunta la ultima tecla pulsada. Los que cruzan de lado a
        // lado se saltan ese filtro: no hay carril donde librarse.
        if (!WIDE[o.type] && Math.abs(player.x - LANE_X[o.lane]) > LANE_HALF) continue;

        // Altura RELATIVA a la base del obstaculo: sobre un tramo elevado el
        // dintel esta a 1,6 mas arriba, y compararlo contra el cero absoluto
        // haria que se pasara por debajo sin agacharse.
        const rel = player.y - o.baseY;
        let hit = false;

        if (o.type === ESTELA) {
            hit = true;                       // demasiado alta: solo se esquiva
        } else if (o.type === DINTEL) {
            hit = !sliding;                   // hay que ir agachado
        } else if (o.type === CENOTE) {
            hit = rel < 0.9;                  // hay que estar en el aire
        } else if (o.type === TRONCO) {
            hit = rel < 1.15;                 // por encima del tronco o nada
        } else if (o.type === VACIO) {
            hit = rel < 0.9;                  // si no vas en el aire, caes
        } else if (o.type === MURO) {
            hit = true;                       // no se salta ni se rodea
        }

        if (hit) { takeHit(); return; }
    }

    // --- Amenazas ---
    // Cada una ocupa una franja vertical sobre su suelo: por debajo del
    // murcielago se pasa deslizandose, por encima de la piedra saltando. Que
    // el criterio sea una franja y no un "te toca o no" es lo que hace que
    // agacharse y saltar sean respuestas distintas y no intercambiables.
    for (const h of hazards) {
        if (!h.active) continue;
        // La camioneta es larga: su ventana de golpe es su caja, no un borde.
        const zH = h.type === BUS ? 3.4 : 1.25;
        const xH = h.type === BUS ? 1.25 : (h.type === VACA ? 1.5 : 1.15);
        if (Math.abs(h.z - PLAYER_Z) > zH) continue;
        // Se compara contra donde esta DIBUJADA, no contra su carril: la vaca
        // no tiene carril, y la piedra que aun cae tampoco esta en el suyo.
        if (Math.abs(player.x - h.group.position.x) > xH) continue;

        const base = h.y - hazBaseY(h);
        const lo = base + HAZ_LOW[h.type];
        const hi = base + HAZ_HIGH[h.type];

        // Franja que ocupa el jugador: de pie llega a 2,4; agachado, a 1,1.
        const feet = player.y;
        const head = player.y + (sliding ? 1.1 : 2.4);

        if (head > lo && feet < hi) { takeHit(); return; }
    }
}

function collect(p) {
    // Todo lo que hace falta de la pieza se copia AQUI, antes de tocar nada
    // mas. Recoger el vuelo del quetzal llama a spawnSkyTrail, que siembra
    // veintidos jades llamando a spawnPickup; y spawnPickup, cuando el pool
    // esta lleno, recicla el primer hueco libre... que es justo esta pieza,
    // marcada inactiva una linea antes de entrar aqui. A partir de ese momento
    // p.kind ya no vale 'flight' sino 'jade', y la ultima linea de la funcion
    // reventaba buscando el color de un poder que no existe. Con una copia
    // local no hay forma de que pase.
    const kind = p.kind;
    const x = p.mesh.position.x, y = p.mesh.position.y, z = p.z;

    if (kind === 'jade') {
        game.jade++;
        game.combo++;
        const mult = comboMultiplier() * (game.powers.double > 0 ? 2 : 1);
        game.jadeScore += Math.round(25 * mult * jadeScale());
        sfx.jade();
        burstParticles(x, y, z, 8, 0.85, C.jade);
        hudDirty = true;
        return;
    }

    if (kind === 'shield') {
        game.shield = true;
        sfx.shield();
    } else {
        const t = POWERS[kind].time * powerScale();
        // Encadenar un segundo vuelo no debe sembrar un rastro nuevo encima
        // del que aun esta en el aire: se alarga el tiempo y ya esta.
        const wasFlying = kind === 'flight' && game.powers.flight > 0;
        game.powers[kind] = t;
        game.powerMax[kind] = t;
        if (kind === 'flight') {
            player.wantSlide = false;
            if (!wasFlying) spawnSkyTrail();
        }
        sfx.power();
    }
    burstParticles(x, y, z, 16, 1.15, POWERS[kind].color);
    hudDirty = true;
}

function comboMultiplier() {
    return Math.min(COMBO_MAX, 1 + Math.floor(game.combo / COMBO_STEP));
}

function takeHit() {
    game.invuln = INVULN_TIME;
    game.combo = 0;
    jadeStreak = 0;
    shake = 0.5;

    // El escudo absorbe el golpe antes que las vidas
    if (game.shield) {
        game.shield = false;
        sfx.shieldBreak();
        burstParticles(player.x, player.y + 1.2, PLAYER_Z, 18, 1.2, C.ochre);
        hudDirty = true;
        return;
    }

    game.lives--;
    sfx.hit();
    burstParticles(player.x, player.y + 1.2, PLAYER_Z, 10, 1, 0xef4444);
    hudDirty = true;

    if (game.lives <= 0) endGame();
}

function updatePowers(dt) {
    let changed = false;
    if (game.boost > 0) {
        game.boost = Math.max(0, game.boost - dt);
        if (game.boost === 0) changed = true;
    }
    for (const k of ['magnet', 'double', 'amber', 'flight']) {
        if (game.powers[k] <= 0) continue;
        game.powers[k] = Math.max(0, game.powers[k] - dt);
        if (game.powers[k] === 0) {
            changed = true;
            // Al terminar el vuelo el jugador cae desde casi cuatro unidades:
            // sin este margen aterrizaba encima de la estela que acababa de
            // sobrevolar y perdia una vida sin haber hecho nada mal.
            if (k === 'flight') game.invuln = Math.max(game.invuln, LANDING_GRACE);
        }
    }
    if (changed) hudDirty = true;
}

// --- Hitos de distancia ---
function checkMilestone() {
    if (game.distance < game.nextMilestone) return;
    const m = game.nextMilestone;
    game.nextMilestone += MILESTONE_EVERY;

    sfx.milestone();
    dom.milestone.textContent = m + ' m';
    dom.milestone.hidden = false;
    dom.milestone.classList.remove('show');
    void dom.milestone.offsetWidth;      // reinicia la animacion
    dom.milestone.classList.add('show');
}

function showBanner(titulo, sub) {
    dom.banner.firstElementChild.textContent = titulo;
    dom.banner.lastElementChild.textContent = sub;
    dom.banner.hidden = false;
    dom.banner.classList.remove('show');
    void dom.banner.offsetWidth;         // reinicia la animacion
    dom.banner.classList.add('show');
}

function showRegionBanner(ri) {
    const R = REGIONS[ri];
    sfx.region();
    showBanner(R.name, R.dept);
}

// ===========================================================================
// HUD
// ===========================================================================
// Se repinta solo cuando algo cambia. Antes renderHud corria en cada frame y
// reescribia el innerHTML de las vidas 60 veces por segundo, forzando un
// recalculo de estilo continuo por un texto que casi nunca cambia.
let hudDirty = true;
const hudLast = { lives: -1, shield: null, jade: -1, dist: -1, combo: -1 };

function renderHud() {
    if (game.lives !== hudLast.lives) {
        hudLast.lives = game.lives;
        const total = maxLives();
        let marks = '';
        for (let i = 0; i < total; i++) {
            marks += i < game.lives ? '◆ ' : '<span class="spent">◆</span> ';
        }
        dom.lives.innerHTML = marks.trim();
    }

    if (game.jade !== hudLast.jade) {
        hudLast.jade = game.jade;
        dom.jade.textContent = game.jade;
    }

    const mult = comboMultiplier() * (game.powers.double > 0 ? 2 : 1);
    if (mult !== hudLast.combo) {
        hudLast.combo = mult;
        if (mult > 1) {
            dom.combo.textContent = '×' + mult;
            dom.combo.hidden = false;
        } else {
            dom.combo.hidden = true;
        }
    }

    if (game.shield !== hudLast.shield) {
        hudLast.shield = game.shield;
        dom.shield.hidden = !game.shield;
    }

    if (game.boost > 0) {
        if (dom.pw.boost.hidden) dom.pw.boost.hidden = false;
        dom.pw.boost.firstElementChild.style.width =
            (game.boost / BOOST_TIME * 100).toFixed(1) + '%';
    } else if (!dom.pw.boost.hidden) {
        dom.pw.boost.hidden = true;
    }

    // Los poderes activos: solo cambia el ancho de la barra, nunca el arbol
    for (const k of ['magnet', 'flight', 'double', 'amber']) {
        const el = dom.pw[k];
        const t = game.powers[k];
        if (t <= 0) {
            if (!el.hidden) el.hidden = true;
            continue;
        }
        if (el.hidden) el.hidden = false;
        el.firstElementChild.style.width = (t / game.powerMax[k] * 100).toFixed(1) + '%';
    }
}

// La distancia si cambia en cada frame, pero es un solo textContent numerico
function renderDistance() {
    const d = Math.floor(game.distance);
    if (d !== hudLast.dist) {
        hudLast.dist = d;
        dom.dist.textContent = d;
    }
}

function resetHudCache() {
    hudLast.lives = -1;
    hudLast.shield = null;
    hudLast.jade = -1;
    hudLast.dist = -1;
    hudLast.combo = -1;
}

// El jade ya se puntua al recogerlo, aplicando el multiplicador vigente en
// ese momento: asi la racha premia de verdad el juego arriesgado.
function scoreOf() {
    return Math.floor(game.distance) + game.jadeScore;
}

// ===========================================================================
// El viaje por el pais
// ===========================================================================
// Se interpola entre departamentos segun la distancia: cielo, niebla, suelo,
// luces, calzada, obstaculos y horizonte cambian a la vez. Si solo cambiara
// el cielo, el resto de la escena delataria el truco.
const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _cMix = new THREE.Color();
let lastSkyPaint = -1;
let lastBlendKey = -1;

function mixHex(a, b, t, out) {
    _cA.setHex(a);
    _cB.setHex(b);
    return out.copy(_cA).lerp(_cB, t);
}

// Posicion en la ruta como numero real: la parte entera es el departamento,
// la decimal lo recorrido dentro de el.
function routePos() {
    // La ruta ya NO es una funcion de la distancia: es un numero que solo se
    // mueve al tomar la salida de un distribuidor. Antes el departamento
    // cambiaba solo cada quinientos metros y el cruce era un atajo; ahora el
    // cruce es la UNICA forma de cambiar de sitio, que es lo que convierte
    // elegir salida en la decision del juego y no en un adorno.
    return game.routePos;
}

// Cuanto se lleva recorrido hacia el proximo distribuidor, de 0 a 1.
function crossProgress() {
    const t = 1 - (game.nextCross - game.distance) / CROSS_EVERY;
    return Math.max(0, Math.min(1, t));
}

function applyBlend(pos) {
    const i = Math.floor(pos) % REGION_N;
    const j = (i + 1) % REGION_N;
    const raw = pos - Math.floor(pos);
    // El tramo se sostiene y la transicion ocurre al final, en vez de estar
    // cambiando de color permanentemente.
    const t0 = raw < REGION_BLEND ? 0 : (raw - REGION_BLEND) / (1 - REGION_BLEND);
    let e = t0 * t0 * (3 - 2 * t0);         // smoothstep

    let A = REGIONS[i], B = REGIONS[j];

    // Al tomar un desvio el departamento cambia de golpe. Sin esto el cielo,
    // la luz y la vegetacion saltaban en un frame y se leia como un fallo de
    // carga; interpolando desde el que se dejo atras, se lee como lo que es:
    // haber cambiado de carretera.
    if (game.snapT < 1) {
        A = REGIONS[game.snapFrom];
        B = REGIONS[i];
        const t = game.snapT;
        e = t * t * (3 - 2 * t);
    }

    // --- Lo barato: se hace en cada frame ---
    scene.fog.color.copy(mixHex(A.fog, B.fog, e, _cMix));
    groundMesh.material.color.copy(mixHex(A.ground, B.ground, e, _cMix));
    sunLight.color.copy(mixHex(A.sun, B.sun, e, _cMix));
    sunLight.intensity = lerp(A.sunI, B.sunI, e);
    hemiLight.color.copy(mixHex(A.hemi, B.hemi, e, _cMix));
    hemiLight.intensity = lerp(A.hemiI, B.hemiI, e);
    hemiLight.groundColor.copy(mixHex(A.ground, B.ground, e, _cMix));

    // --- Lo caro: solo cuando la mezcla cambia de verdad ---
    // Durante el 62 % del tramo e vale exactamente 0, asi que la clave no se
    // mueve y no se repinta nada.
    const key = (game.snapT < 1 ? -1 : i * 1000) + Math.round(e * 90);
    if (key !== lastBlendKey) {
        lastBlendKey = key;

        // La calzada y el bordillo ya NO se pintan aqui: cada losa consulta su
        // propia region en updateRoadCurve, para que el firme cambie en una
        // linea que se ve venir en vez de fundirse de forma global.
        //
        // Los tramos elevados si van con la mezcla: son piezas de paso y
        // siempre estan en la zona cercana, donde la region es la actual.
        mat.deck.color.copy(mixHex(A.roadA, B.roadA, e, _cMix));
        mat.deckSide.color.copy(mixHex(A.kerb, B.kerb, e, _cMix));

        // Obstaculos
        mat.stone.color.copy(mixHex(A.stone, B.stone, e, _cMix));
        mat.accent.color.copy(mixHex(A.accent, B.accent, e, _cMix));
        mat.water.color.copy(mixHex(A.hazard, B.hazard, e, _cMix));
        mat.pit.color.copy(mixHex(A.pit, B.pit, e, _cMix));

        // Las proporciones no se pueden interpolar sin recomponer 30 grupos en
        // cada repintado, asi que se cambian de golpe en el punto medio, donde
        // la escena ya esta a medio camino y el salto no se lee.
        applyObstacleShape(e < 0.5 ? A : B);

        // Horizonte
        paintLandmarks(landSpec(i), landSpec(j), e);
    }

    // El canvas del cielo tiene su propio umbral: es lo unico que sigue
    // moviendose de forma perceptible durante toda la transicion.
    const skyKey = Math.round((i + e) * 45);
    if (skyKey !== lastSkyPaint) {
        lastSkyPaint = skyKey;
        const top = mixHex(A.skyTop, B.skyTop, e, _cMix).getStyle();
        const bot = mixHex(A.skyBot, B.skyBot, e, _cMix).getStyle();
        const g = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
        g.addColorStop(0, top);
        g.addColorStop(1, bot);
        skyCtx.fillStyle = g;
        skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
        skyTexture.needsUpdate = true;
    }

    return { i, j, raw, e, A, B };
}

// ===========================================================================
// Minimapa
// ===========================================================================
// Los puntos se crean una sola vez al arrancar; durante la partida solo se
// mueve el marcador y se cambia una clase.
function buildMinimap() {
    const ns = 'http://www.w3.org/2000/svg';
    REGIONS.forEach((R, i) => {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', R.mm[0]);
        dot.setAttribute('cy', R.mm[1]);
        dot.setAttribute('r', '2.2');
        dot.setAttribute('class', 'mm-dot');
        dot.dataset.i = String(i);
        dom.mmDots.appendChild(dot);
    });
    refreshMinimapDots();
}

function refreshMinimapDots() {
    for (const dot of dom.mmDots.children) {
        const seen = save.regions.includes(REGIONS[+dot.dataset.i].id);
        dot.classList.toggle('seen', seen);
    }
}

let mmLastName = '';

function renderMinimap(i, j, raw, e) {
    // El marcador viaja del punto actual al siguiente durante la transicion,
    // asi que el mapa se mueve incluso mientras el nombre no cambia.
    const A = REGIONS[i].mm, B = REGIONS[j].mm;
    dom.mmYou.setAttribute('cx', lerp(A[0], B[0], e).toFixed(1));
    dom.mmYou.setAttribute('cy', lerp(A[1], B[1], e).toFixed(1));

    if (REGIONS[i].id !== mmLastName) {
        mmLastName = REGIONS[i].id;
        dom.mmName.textContent = REGIONS[i].name;
        dom.mmDept.textContent = REGIONS[i].dept;
    }
    // La barra ya no mide el avance dentro del departamento —no hay tal cosa,
    // la ruta esta quieta— sino lo que falta para el proximo cruce, que es lo
    // unico que puede cambiarlo.
    dom.mmFill.style.width = (raw * 100).toFixed(0) + '%';
}

// ===========================================================================
// Jaguar y quetzal
// ===========================================================================
function updateCompanions(dt) {
    // Jaguar: su cercania es el indicador de vidas. Con todas esta fuera de
    // plano; con una, encima del jugador. Aun asi no se le echa del todo:
    // tapar la calzada justo cuando mas importa no fallar seria injusto.
    const total = maxLives();
    const t = total > 1 ? (game.lives - 1) / (total - 1) : 1;
    const targetZ = 5.8 + Math.max(0, Math.min(1, t)) * 16;

    jaguar.visible = game.lives < total;
    jaguar.position.z += (targetZ - jaguar.position.z) * Math.min(1, 2.2 * dt);
    // Tambien va sobre la calzada, asi que tambien la sigue al girar: a veinte
    // unidades por detras la curva ya vale mas de una unidad y sin esto el
    // jaguar corria por el aire.
    const jx = player.x * 0.6 + curveAtZ(jaguar.position.z);
    jaguar.position.x += (jx - jaguar.position.x) * Math.min(1, 3 * dt);

    // Zancada y cola
    const gait = game.elapsed * game.speed * 0.55;
    jaguar.userData.legs.forEach((leg, k) => {
        leg.position.y = 0.42 + Math.abs(Math.sin(gait + k * 1.6)) * 0.12;
        leg.position.z = (k < 2 ? -1 : 1) * 0.75 + Math.sin(gait + k * 1.6) * 0.18;
    });
    jaguar.position.y = Math.abs(Math.sin(gait * 0.5)) * 0.14;
    jaguar.userData.tail.rotation.x = Math.sin(gait * 0.4) * 0.25;

    // Quetzal. En reposo vuela por delante y a un lado, sin colision ni
    // funcion: solo compania. Con el poder activo baja, se coloca ENCIMA del
    // jugador y lo levanta agarrado de las garras. El mismo pajaro haciendo de
    // premio explica el poder mejor que cualquier rotulo del HUD.
    quetzal.visible = true;
    const bob = Math.sin(game.elapsed * 3.4);
    const flying = game.powers.flight > 0;

    // La transicion se hace con el mismo valor que reencuadra la camara, asi
    // que el pajaro llega justo cuando el jugador termina de subir.
    const g = game.camLift;

    const idleX = player.x - 4.6 + Math.sin(game.elapsed * 0.7) * 0.4 + curveAtZ(PLAYER_Z - 7);
    const idleY = 3.5 + bob * 0.3;
    const idleZ = PLAYER_Z - 7 + Math.cos(game.elapsed * 0.9) * 0.7;

    const holdX = player.x;
    const holdY = player.y + 3.15 + bob * 0.12;
    const holdZ = PLAYER_Z + 0.45;

    quetzal.position.set(lerp(idleX, holdX, g), lerp(idleY, holdY, g), lerp(idleZ, holdZ, g));
    quetzal.scale.setScalar(lerp(0.85, 1.65, g));
    quetzal.rotation.z = bob * 0.12 * (1 - g) - (LANE_X[player.lane] - player.x) * 0.1;
    quetzal.rotation.x = lerp(0, -0.12, g);

    // Cargando bate mas fuerte y mas despacio: aletazos de esfuerzo, no de
    // planeo. Las garras solo salen cuando hay a quien agarrar.
    const flap = flying
        ? 0.35 + Math.sin(game.elapsed * 9) * 0.95
        : Math.sin(game.elapsed * 15) * 0.7;
    quetzal.userData.wingL.rotation.z = flap;
    quetzal.userData.wingR.rotation.z = -flap;
    quetzal.userData.talonL.visible = g > 0.05;
    quetzal.userData.talonR.visible = g > 0.05;
}

// ===========================================================================
// Ciclo de vida de la partida
// ===========================================================================
function startGame() {
    initAudio();
    if (music.on) startMusic();
    stopPendingTones();          // corta la fanfarria de la partida anterior
    sfx.start();

    game.state = State.PLAYING;
    game.speed = SPEED_START;
    game.distance = 0;
    game.jade = 0;
    game.jadeScore = 0;
    game.combo = 0;
    game.lives = maxLives();
    game.shield = lvl('shield') > 0;
    game.invuln = 0;
    game.elapsed = 0;
    game.nextMilestone = MILESTONE_EVERY;
    game.best = save.best;
    game.startRegion = save.start;
    game.region = save.start;
    for (const k of POWER_KEYS) if (k !== 'shield') game.powers[k] = 0;
    game.boost = 0;
    game.boostTaken = 0;
    game.boostPerm = 0;
    game.nextTramo = 0;
    game.lastTramo = -1;
    game.crossKind = 1;
    game.routePos = save.start + 0.02;
    game.roadS0 = -1;
    game.roadFrom = 0;
    game.nextCross = CROSS_EVERY;
    game.fork.active = false;
    game.fork.chosen = 0;
    game.fork.mainBand = -1;
    game.fork.away = 0;
    game.turn.active = false;
    game.turnHold = 0;
    game.narrowS0 = -1;
    game.wrongC = null;
    game.snapT = 1;
    game.crossTaken = 0;
    game.lastWarn = -999;
    game.slopeS0 = -1;
    game.revived = false;
    game.curveBase = curveX(0);
    game.riseBase = curveY(0);
    game.slopeBase = 0;
    game.camLift = 0;
    jadeStreak = 0;

    player.lane = 1;
    player.lanePrev = 1;
    player.laneFrom = 0;
    player.laneT = 1;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.grounded = true;
    player.sliding = 0;
    player.wantSlide = false;
    player.out = 0;
    player.outVX = 0;
    playerGroup.rotation.set(0, 0, 0);
    shadowMesh.material.opacity = 0.4;
    player.jumps = 0;
    player.holding = false;
    player.coyote = COYOTE_TIME;
    player.buffer = 0;
    player.land = 0;
    player.groundY = 0;
    player.bump = 0;

    playerGroup.visible = true;
    for (const m of Object.values(playerMats)) m.opacity = 1;

    jaguar.position.set(0, 0, 22);
    resetWorld();
    clearParticles();

    // El acumulador arrastraba el tiempo muerto de los menus: al empezar la
    // partida se gastaba en pasos de simulacion de golpe y el mundo daba un
    // salto de varios metros antes del primer frame.
    accumulator = 0;
    lastTime = 0;
    shake = 0;

    resetHudCache();
    resetRoadColors();
    mmLastName = '';
    lastBlendKey = -1;
    hudDirty = true;
    renderHud();
    renderDistance();
    dom.hudBest.textContent = save.best;
    refreshMinimapDots();
    showRegionBanner(game.startRegion);

    dom.menu.hidden = true;
    dom.shop.hidden = true;
    dom.over.hidden = true;
    dom.revive.hidden = true;
    dom.hud.hidden = false;
    dom.soundBtn.hidden = false;
    dom.pauseBtn.hidden = false;
    dom.pauseBtn.textContent = 'II';
    dom.pauseTag.hidden = true;
    dom.milestone.hidden = true;
    dom.milestone.classList.remove('show');
}

// Morir ya no cierra la carrera directamente: la primera vez se ofrece el
// anuncio del patrocinador. Solo si se rechaza (o si ya se gasto) se cierra.
function endGame() {
    if (!game.revived) { offerRevive(); return; }
    finishGame();
}

// ---------------------------------------------------------------------------
// Revivir viendo un anuncio
// ---------------------------------------------------------------------------
let reviveTimerId = null;
let reviveLeft = 0;

function teardownRevive() {
    if (reviveTimerId) { clearInterval(reviveTimerId); reviveTimerId = null; }
    // Quitar el iframe es lo que detiene el video: dejarlo escondido lo
    // mantiene sonando por debajo de la partida.
    const frame = dom.shortHost.querySelector('iframe');
    if (frame) frame.remove();
    dom.shortFallback.hidden = false;
    // La musica del juego se habia bajado para no pelearse con el anuncio
    if (music.gain) music.gain.gain.value = music.on ? 0.075 : 0;
}

function offerRevive() {
    game.state = State.REVIVE;
    stopPendingTones();

    dom.hud.hidden = true;
    dom.pauseBtn.hidden = true;
    dom.pauseTag.hidden = true;
    dom.milestone.hidden = true;
    dom.banner.hidden = true;
    dom.speedVeil.style.opacity = '0';
    jaguar.visible = false;
    quetzal.visible = false;

    // Silencio: dos musicas a la vez no es un anuncio, es ruido.
    if (music.gain) music.gain.gain.value = 0;

    const list = CEFAS.shorts;
    if (list.length) {
        const id = list[(Math.random() * list.length) | 0];
        dom.reviveSub.innerHTML =
            'Mira el anuncio de nuestro patrocinador y vuelves a la calzada con ' +
            'una vida y el escudo puesto. Solo una vez por carrera.' +
            '<br><small style="opacity:.7">Empieza sin sonido: toca el altavoz ' +
            'del vídeo para oírlo.</small>';
        const f = document.createElement('iframe');
        // nocookie: el dominio sin seguimiento de YouTube. Y el iframe no se
        // crea hasta este momento, asi que quien no llega a morir —o rechaza
        // el anuncio— no hace ni una peticion a terceros.
        //
        // mute=1 no es un descuido. Chrome bloquea el arranque automatico con
        // sonido en un iframe de otro dominio salvo que el usuario tenga
        // historial con YouTube, asi que sin silenciar el video se quedaba
        // parado en el fotograma de portada para buena parte de la gente. Ya
        // que va a arrancar solo, mejor que se vea moviendose y que quien
        // quiera oirlo le de al altavoz.
        f.src = 'https://www.youtube-nocookie.com/embed/' + id +
                '?autoplay=1&mute=1&rel=0&playsinline=1&modestbranding=1';
        f.title = 'Anuncio de ' + CEFAS.name;
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.setAttribute('allowfullscreen', '');
        dom.shortFallback.hidden = true;
        dom.shortHost.appendChild(f);
    } else {
        dom.reviveSub.textContent =
            'Un momento con nuestro patrocinador y vuelves a la calzada con una ' +
            'vida y el escudo puesto. Solo una vez por carrera.';
    }

    reviveLeft = CEFAS.watch;
    dom.reviveBtn.disabled = true;
    tickRevive();
    // Reloj propio, independiente del reproductor: si un bloqueador tumba el
    // iframe el jugador revive igual. Cobrarle el fallo de otro seria injusto.
    reviveTimerId = setInterval(tickRevive, 1000);

    dom.revive.hidden = false;
}

function tickRevive() {
    if (reviveLeft > 0) {
        dom.reviveTimer.innerHTML = 'Disponible en <b>' + reviveLeft + '</b> s';
        reviveLeft--;
        return;
    }
    dom.reviveTimer.textContent = '¡Listo!';
    dom.reviveBtn.disabled = false;
    if (reviveTimerId) { clearInterval(reviveTimerId); reviveTimerId = null; }
}

function doRevive() {
    if (dom.reviveBtn.disabled) return;
    game.revived = true;
    teardownRevive();
    dom.revive.hidden = true;

    // Vuelve con lo justo para tener otra oportunidad, no con la partida
    // entera regalada: una vida, el escudo y unos segundos de margen.
    game.lives = 1;
    game.shield = true;
    game.invuln = 3;
    game.combo = 0;
    jadeStreak = 0;

    // Se despeja el tramo que tiene delante. Sin esto revivias dentro del
    // mismo obstaculo que te acababa de matar.
    for (const o of obstacles) {
        if (o.active && o.z > -70) { o.active = false; o.group.visible = false; }
    }
    for (const h of hazards) {
        if (h.active && h.z > -90) { h.active = false; h.group.visible = false; }
    }

    // Si murio contra el derrumbe del ramal cortado, revivir lo devuelve al
    // ramal bueno: repetir la misma pared cinco segundos despues no seria una
    // segunda oportunidad, seria la misma muerte otra vez.
    if (game.wrongC) {
        takeExit(game.wrongC, game.wrongLane);
        game.wrongC = null;
        game.turnHold = 0;
    }

    // Se sale de la caida de pie y en el carril del medio: si se revive fuera
    // de la calzada, el primer paso vuelve a ser caerse.
    player.out = 0;
    player.outVX = 0;
    playerGroup.rotation.set(0, 0, 0);
    shadowMesh.material.opacity = 0.4;
    if (game.narrowS0 >= 0 || Math.abs(player.x) > ROAD_WIDTH / 2 - 1) {
        player.lane = 1;
        player.lanePrev = 1;
        player.laneT = 1;
        player.x = 0;
    }

    player.y = Math.max(player.y, player.groundY);
    player.vy = 0;
    player.sliding = 0;
    player.wantSlide = false;

    accumulator = 0;
    lastTime = 0;
    shake = 0;

    game.state = State.PLAYING;
    dom.hud.hidden = false;
    dom.pauseBtn.hidden = false;
    dom.pauseBtn.textContent = 'II';
    hudDirty = true;
    renderHud();
    sfx.shield();
}

function declineRevive() {
    game.revived = true;
    teardownRevive();
    dom.revive.hidden = true;
    finishGame();
}

function finishGame() {
    game.state = State.OVER;
    stopPendingTones();
    sfx.over();

    const score = scoreOf();
    const isRecord = score > save.best;
    if (isRecord) save.best = score;
    save.bank += game.jade;
    persist();

    dom.finalDist.textContent = Math.floor(game.distance) + ' m';
    dom.finalJade.textContent = game.jade;
    dom.finalScore.textContent = score;
    dom.finalRegion.textContent = REGIONS[game.region].name + ' · ' + REGIONS[game.region].dept;
    dom.finalBank.textContent = save.bank;
    dom.bestScore.textContent = save.best;
    dom.recordTag.textContent = isRecord ? '¡Nueva mejor marca!' : '';
    dom.overTitle.textContent = isRecord ? '¡RÉCORD!' : 'FIN';

    // Sin esto el jaguar y el quetzal se quedaban colgados en mitad de la
    // pantalla de fin, sobre un mundo que ya no se mueve.
    jaguar.visible = false;
    quetzal.visible = false;
    // Y la bifurcacion: si no, el ramal descartado se queda pintado de fondo
    // en la pantalla de fin y en el menu.
    game.fork.active = false;
    game.fork.chosen = 0;
    game.fork.mainBand = -1;
    game.snapT = 1;
    game.slopeS0 = -1;

    // Los poderes se apagan al morir. Si el vuelo sobreviviese a la partida,
    // la camara se quedaria encuadrada en el aire durante todo el menu.
    for (const k of ['magnet', 'double', 'amber', 'flight']) game.powers[k] = 0;

    dom.hud.hidden = true;
    dom.over.hidden = false;
    dom.pauseTag.hidden = true;
    dom.pauseBtn.hidden = true;
    dom.milestone.hidden = true;
    dom.banner.hidden = true;
    dom.speedVeil.style.opacity = '0';

    refreshMenu();
}

function togglePause() {
    if (game.state === State.PLAYING) {
        game.state = State.PAUSED;
        dom.pauseTag.hidden = false;
        dom.pauseBtn.textContent = '▶';
    } else if (game.state === State.PAUSED) {
        game.state = State.PLAYING;
        // El acumulador se vacia al reanudar: si no, el tiempo que el juego
        // estuvo detenido se descargaba de golpe en pasos de simulacion.
        accumulator = 0;
        lastTime = 0;
        dom.pauseTag.hidden = true;
        dom.pauseBtn.textContent = 'II';
    }
}

// ===========================================================================
// Taller: trajes, mejoras y punto de salida
// ===========================================================================
let shopTab = 'skins';
let shopReturn = State.MENU;

function refreshMenu() {
    dom.menuBank.textContent = save.bank;
    dom.menuBest.textContent = save.best;
    dom.menuRoute.textContent = REGIONS[save.start].name + ' · ' + REGIONS[save.start].dept;
}

function swatch(colors) {
    return '<span class="card-swatch">' +
        colors.map(c => '<span style="background:#' +
            c.toString(16).padStart(6, '0') + '"></span>').join('') +
        '</span>';
}

function renderShop() {
    dom.shopBank.textContent = save.bank;

    // --- Trajes ---
    dom.tabSkins.innerHTML = SKINS.map(s => {
        const owned = save.skins.includes(s.id);
        const on = save.skin === s.id;
        const label = on ? 'Puesto' : owned ? 'Ponérselo' : s.cost + ' jade';
        const dis = (!owned && save.bank < s.cost) || on;
        return '<div class="card' + (on ? ' on' : '') + (owned ? '' : ' locked') + '">' +
            '<span class="card-ic skin-ic">' + skinIcon(s) + '</span>' +
            '<b>' + s.name + '</b><p>' + s.desc + '</p>' +
            '<button type="button" data-skin="' + s.id + '"' +
            (dis ? ' disabled' : '') + (on ? ' class="equipped"' : '') + '>' + label + '</button>' +
            '</div>';
    }).join('');

    // --- Mejoras ---
    dom.tabUpg.innerHTML = UPGRADES.map(u => {
        const l = lvl(u.id);
        const full = l >= u.max;
        const price = full ? 0 : u.cost(l);
        const label = full ? 'Al máximo' : price + ' jade';
        const bars = Array.from({ length: u.max }, (_, k) =>
            '<i class="' + (k < l ? 'full' : '') + '"></i>').join('');
        return '<div class="card' + (l > 0 ? ' on' : '') + '">' +
            '<span class="card-ic">' + svg(ICON_PATHS[u.id]) + '</span>' +
            '<b>' + u.name + '</b><p>' + u.desc + '</p>' +
            '<span class="card-lvl">' + bars + '</span>' +
            '<button type="button" data-upg="' + u.id + '"' +
            (full || save.bank < price ? ' disabled' : '') + '>' + label + '</button>' +
            '</div>';
    }).join('');

    // --- Ruta ---
    dom.tabRoute.innerHTML = REGIONS.map((R, i) => {
        const open = save.regions.includes(R.id);
        const on = save.start === i;
        const label = on ? 'Salida' : open ? 'Salir de aquí' : 'Por descubrir';
        return '<div class="card' + (on ? ' on' : '') + (open ? '' : ' locked') + '">' +
            '<span class="card-ic">' + svg(REGION_ICONS[R.id] || '') + '</span>' +
            swatch([R.skyBot, R.landA, R.landB, R.roadA]) +
            '<b>' + R.name + '</b><p>' + R.dept + '. Tramo ' + (i + 1) + ' de ' + REGION_N + '.</p>' +
            '<button type="button" data-route="' + i + '"' +
            (!open || on ? ' disabled' : '') + (on ? ' class="equipped"' : '') + '>' + label + '</button>' +
            '</div>';
    }).join('');
}

function openShop(from) {
    shopReturn = from;
    game.state = State.SHOP;
    renderShop();
    dom.menu.hidden = true;
    dom.over.hidden = true;
    dom.shop.hidden = false;
}

function closeShop() {
    dom.shop.hidden = true;
    if (shopReturn === State.OVER) {
        game.state = State.OVER;
        dom.over.hidden = false;
    } else {
        game.state = State.MENU;
        dom.menu.hidden = false;
    }
    refreshMenu();
}

function setShopTab(tab) {
    shopTab = tab;
    dom.tabSkins.hidden = tab !== 'skins';
    dom.tabUpg.hidden = tab !== 'upg';
    dom.tabRoute.hidden = tab !== 'route';
    for (const btn of dom.shop.querySelectorAll('.tab')) {
        btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    }
}

function initShop() {
    dom.shop.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;

        if (btn.dataset.tab) { setShopTab(btn.dataset.tab); return; }

        if (btn.dataset.skin) {
            const s = skinById(btn.dataset.skin);
            if (!save.skins.includes(s.id)) {
                if (save.bank < s.cost) { sfx.deny(); return; }
                save.bank -= s.cost;
                save.skins.push(s.id);
            }
            save.skin = s.id;
            applySkin(s.id);
            sfx.buy();
            persist();
            renderShop();
            return;
        }

        if (btn.dataset.upg) {
            const u = UPGRADES.find(x => x.id === btn.dataset.upg);
            const l = lvl(u.id);
            if (l >= u.max) return;
            const price = u.cost(l);
            if (save.bank < price) { sfx.deny(); return; }
            save.bank -= price;
            save.upg[u.id] = l + 1;
            sfx.buy();
            persist();
            renderShop();
            return;
        }

        if (btn.dataset.route) {
            const i = +btn.dataset.route;
            if (!save.regions.includes(REGIONS[i].id)) { sfx.deny(); return; }
            save.start = i;
            sfx.buy();
            persist();
            renderShop();
            refreshMenu();
        }
    });

    setShopTab('skins');
}

// ===========================================================================
// Bucle principal: paso fijo acumulado
// ===========================================================================
// Paso fijo a 60 Hz con tope de 6 pasos por frame, es decir 0,1 s de
// simulacion por frame: aguanta hasta unos 10 fps antes de entrar en camara
// lenta. A 31 u/s un paso avanza 0,52 unidades, muy por debajo de la ventana
// de colision (2,2 de fondo), asi que nada se cuela.
const STEP = 1 / 60;
const MAX_STEPS = 6;
let accumulator = 0;
let lastTime = 0;
let shake = 0;

function frame(now) {
    requestAnimationFrame(frame);

    const t = now / 1000;
    let delta = lastTime ? t - lastTime : 0;
    lastTime = t;
    // Si la pestana estuvo oculta, delta puede ser enorme: se recorta para que
    // el jugador no aparezca de golpe dentro de un obstaculo.
    if (delta > 0.25) delta = 0.25;

    if (game.state === State.PLAYING) {
        // El ambar frena el mundo, pero no el reloj de los poderes: si lo
        // frenase tambien, se prolongaria a si mismo.
        const scale = game.powers.amber > 0 ? AMBER_SCALE : 1;

        accumulator += delta;
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS) {
            game.elapsed += STEP;
            // El impulso se aplica DESPUES del tope: su gracia es justamente
            // pasar del techo de velocidad, aunque sea unos segundos.
            game.speed = Math.min(
                SPEED_MAX,
                SPEED_START + SPEED_GAIN * Math.sqrt(game.distance / 100)
            ) * scale;
            // Lo que han dejado las placas pisadas va DESPUES del tope: el
            // tope es una red de seguridad del reparto de obstaculos, no un
            // techo de diseno, y lo que el jugador se gana tiene que notarse.
            if (game.boostPerm > 0) game.speed *= 1 + game.boostPerm;
            if (game.boost > 0) game.speed *= BOOST_MULT;
            // Cuesta abajo y en curva cerrada se corre mas. Son los dos unicos
            // sitios donde la velocidad sube sin que el jugador haya hecho
            // nada, y por eso los dos llevan cartel. Se usa lo EMPINADO de la
            // cuesta y no lo que lleva bajado: aquello se queda en uno al
            // final y dejaria la partida acelerada para siempre.
            const cuesta = slopeSteep(game.distance);
            if (cuesta > 0) game.speed *= 1 + (SLOPE_SPEED - 1) * cuesta;
            const giro = turnGrip(game.distance);
            if (giro > 0) game.speed *= 1 + (TURN_SPEED - 1) * giro;
            updatePowers(STEP);
            updatePlayer(STEP);
            scrollWorld(STEP);
            checkCollisions();
            checkMilestone();
            updateParticles(STEP);
            updateCompanions(STEP);
            accumulator -= STEP;
            steps++;
            // Una colision puede haber terminado la carrera a mitad del
            // bucle; sin este corte el mundo seguia avanzando pasos con la
            // partida ya cerrada.
            if (game.state !== State.PLAYING) break;
        }

        if (hudDirty) { renderHud(); hudDirty = false; }
        renderDistance();

        // Calzada y escenografia se recomponen una vez por FRAME, no una por
        // paso de simulacion: son trabajo de dibujo, no de simulacion.
        const blend = applyBlend(routePos());
        updateRoadCurve();
        updateScenery(blend.A, blend.B, blend.e);
        renderMinimap(blend.i, blend.j, crossProgress(), blend.e);

        // Al entrar en un departamento nuevo: bandera, sonido y desbloqueo
        if (blend.i !== game.region) {
            game.region = blend.i;
            showRegionBanner(blend.i);
            const id = REGIONS[blend.i].id;
            if (!save.regions.includes(id)) {
                save.regions.push(id);
                persist();
                refreshMinimapDots();
            }
        }

        // Pulso de las recogidas: materiales compartidos, asi que basta una
        // asignacion por tipo y frame para todas las piezas de la escena.
        mat.jade.emissiveIntensity = 0.3 + Math.sin(t * 5) * 0.22;
        const pulse = 0.45 + Math.sin(t * 8) * 0.3;
        for (const k of POWER_KEYS) mat[k].emissiveIntensity = pulse;

        // Vineta y campo de vision segun la velocidad: es la unica pista de
        // que aceleras de 15 a 31.
        const rush = Math.max(0, Math.min(1.25,
            (game.speed - SPEED_START) / (34 - SPEED_START)));
        dom.speedVeil.style.opacity = (rush * 0.85).toFixed(2);
        const wantFov = cam.fov + rush * 6;
        if (Math.abs(camera.fov - wantFov) > 0.05) {
            camera.fov = wantFov;
            camera.updateProjectionMatrix();
        }
    } else if (game.state === State.MENU || game.state === State.SHOP) {
        // Los menus se ven sobre la escena, asi que conviene que respire, y
        // ademas asi el fondo adelanta que aspecto tiene el tramo de salida.
        updateParticles(delta);
        // La calzada tambien se dobla de fondo: si no, el menu ensena una recta
        // y el juego arranca con una curva, que se lee como un salto.
        game.curveBase = curveX(game.distance);
        game.riseBase = curveY(game.distance);
        game.slopeBase = -slopeAt(game.distance) * SLOPE_DROP;
        const mb = applyBlend(save.start);
        updateRoadCurve();
        updateScenery(mb.A, mb.B, mb.e);
    }

    // Reencuadre al volar. Si la camara siguiera al jugador con el factor de a
    // pie, a casi siete unidades de altura se saldria del encuadre por arriba;
    // subiendo camara y punto de mira EN LA MISMA proporcion, el jugador se
    // queda exactamente donde estaba y lo que cambia es el horizonte.
    //
    // Depende solo del poder, no del estado: condicionarlo a PLAYING hacia que
    // al pausar en pleno vuelo la camara se recolocase como si el jugador
    // estuviera en el suelo, y el personaje se iba del encuadre por arriba.
    const wantLift = game.powers.flight > 0 ? 1 : 0;
    game.camLift += (wantLift - game.camLift) * Math.min(1, 2.6 * delta);
    const f = game.camLift;

    // Curva: la camara mira hacia donde va la calzada, no al frente. Sin esto
    // el trazado se iria de plano en cuanto la curva apretase.
    const aimCurve = curveAtZ(cam.aimZ) * CURVE_FOLLOW;

    // Camara: sigue al jugador con retardo y acusa el golpe
    const targetX = player.x * 0.32 + aimCurve * 0.5;
    camera.position.x += (targetX - camera.position.x) * Math.min(1, 6 * delta);
    camera.position.y = cam.y + player.y * (0.12 + 0.85 * f);

    if (shake > 0) {
        shake = Math.max(0, shake - delta * 2.2);
        camera.position.x += (Math.random() - 0.5) * shake * 0.9;
        camera.position.y += (Math.random() - 0.5) * shake * 0.9;
    }

    // La camara cabecea hacia abajo en la bajada. Sin esto la calzada se hunde
    // pero el encuadre sigue mirando al frente, y lo que se ve es un agujero en
    // el paisaje en vez de una cuesta.
    const drop = game.state === State.PLAYING ? slopeSteep(game.distance) : 0;

    camera.lookAt(
        player.x * 0.5 + aimCurve,
        cam.aimY + player.y * (0.2 + 0.77 * f) - drop * 5.2,
        cam.aimZ
    );

    // Alabeo: la camara se tumba un poco hacia dentro de la curva. Va DESPUES
    // de lookAt, que reescribe la rotacion entera. Un grado escaso: lo justo
    // para que el giro se sienta en el cuerpo sin marear.
    camera.rotation.z += curveAtZ(cam.aimZ) * 0.022;

    renderer.render(scene, camera);
}

// ===========================================================================
// Arranque
// ===========================================================================
function boot() {
    loadSave();

    if (!webglAvailable()) {
        dom.menu.hidden = true;
        dom.unsupported.hidden = false;
        return;
    }

    buildScene();
    buildMinimap();
    initInput();
    initShop();
    setSound(save.sound);
    setMusic(save.music);
    refreshMenu();

    // Aviso de movimiento: el juego es movimiento continuo y no se puede
    // atenuar, asi que se avisa y se deja entrar por voluntad propia.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dom.motionNotice.hidden = false;
    }

    dom.bestScore.textContent = save.best;

    dom.playBtn.addEventListener('click', startGame);
    dom.againBtn.addEventListener('click', startGame);
    dom.shopBtn.addEventListener('click', () => { initAudio(); if (music.on) startMusic(); openShop(State.MENU); });
    dom.overShopBtn.addEventListener('click', () => openShop(State.OVER));
    dom.shopClose.addEventListener('click', closeShop);
    dom.soundPref.addEventListener('click', () => { initAudio(); setSound(!audio.on); });
    dom.musicPref.addEventListener('click', () => { initAudio(); setMusic(!music.on); });
    dom.soundBtn.addEventListener('click', () => setSound(!audio.on));
    dom.pauseBtn.addEventListener('click', togglePause);
    dom.reviveBtn.addEventListener('click', doRevive);
    dom.reviveSkip.addEventListener('click', declineRevive);
    paintSponsors();

    // Pausa al perder el foco: si no, vuelves a una partida que siguio sin ti
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.state === State.PLAYING) togglePause();
    });

    window.addEventListener('resize', () => {
        layoutCamera();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, { passive: true });

    requestAnimationFrame(frame);
}

boot();
