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

// Se sale corriendo, no andando. Con 15 los primeros doscientos metros eran un
// paseo por un sitio bonito y el juego no empezaba hasta pasado el minuto.
const SPEED_START = 23;
// Techo de lo que el REPARTO puede dar: hasta aqui llega la velocidad por
// haber recorrido distancia, y nada mas. A 68 el mundo avanza 1,13 por paso de
// simulacion, muy dentro de la ventana de colision de 2,2.
const SPEED_MAX = 68;

// Y el techo ABSOLUTO, ya con todos los multiplicadores encima. Son dos cosas
// distintas: los impulsos pasan del de reparto a proposito —esa es su gracia—
// pero ninguno puede pasar de este, porque a un paso fijo de 1/60 el mundo
// avanza speed/60 y la ventana de colision mide 2,2 de fondo. Por encima de
// 132 un obstaculo se cuela entre dos pasos sin que nadie lo compruebe.
//
// Con el reparto en 52 el peor caso encadenado —placas al maximo por impulso
// por curva— se quedaba en 127 por los pelos. Subiendo el reparto a 60 se iba
// a 147, y eso no es un juego mas dificil: es un obstaculo atravesado.
const SPEED_HARD = 120;

// La velocidad sube con la DISTANCIA RECORRIDA y no con el reloj. Con el reloj,
// quedarse quieto en el menu de pausa aceleraba igual, y sobre todo el que
// juega bien no notaba ninguna recompensa: llegaba al techo a los 32 segundos
// y de ahi no se movia. Ahora acelera el que avanza.
//
// La curva es una raiz: sube deprisa al principio, donde se nota, y se va
// aplanando, de modo que nunca hay un salto brusco. A los 100 m van 32, a los
// 500 m van 43, a los 1000 m van 51 y a los 2600 m se toca el techo.
//
// Subio de 6,2 a 8,8: la ruta entera son mas de veinte kilometros y con el
// reparto anterior se llegaba al kilometro tres con margen de sobra para
// pensar. Lo que tiene que costar es llegar, no empezar.
const SPEED_GAIN = 8.8;

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
// Lo que dura el destello del golpe. Corto a proposito: un golpe tiene que
// interrumpir, no estorbar, y media pantalla roja tapando la calzada justo
// cuando hay que reaccionar al siguiente obstaculo seria lo segundo.
const HURT_TIME = 0.42;
const HURT_RED = '180, 22, 22';         // una vida menos
const HURT_AMBER = '176, 104, 22';      // el escudo, que se puede recuperar
const LANDING_GRACE = 0.8;          // margen al terminar el vuelo
const START_LIVES = 3;

const COYOTE_TIME = 0.09;           // salto valido justo despues de dejar suelo
const JUMP_BUFFER = 0.13;           // salto pulsado justo antes de aterrizar

// Cada 250 m y no cada 500: una partida corriente muere entre 300 y 400 m,
// asi que con 500 la mayoria de jugadores no llegaria a ver un solo hito.
// Con zonas de doce minutos la ruta entera son mas de seiscientos kilometros,
// asi que un hito cada 250 m son dos mil quinientas fanfarrias por partida:
// una cada cuatro segundos durante dos horas y media. A 2.000 sale una cada
// medio minuto, que es lo que sigue siendo un hito y no un tic.
const MILESTONE_EVERY = 2000;
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
// Y las del ramal descartado de una bifurcacion: el mismo despiece mas la
// sub-base y los dos bordillos. Lleva adoquin propio porque los dos ramales se
// intercambian cuando el jugador cambia de carril —el detallado tiene que ser
// siempre el que pisa— y si uno fuera losa lisa el relevo se veria.
const FORK_CELLS = ROAD_CELLS + 3;
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
// Cada cuanto se parte la calzada. Ya NO decide cuanto dura una zona: eso se
// desacoplo (ver ZONE_SPAN). Aqui manda solo el ritmo de las decisiones, y una
// cada veinte segundos largos es lo que aguanta sin cansar.
const CROSS_EVERY = 1250;
const CROSS_SIGN_AHEAD = 62;        // el rotulo, adelantado a la isleta
// El divisor. Es lo unico que impide cruzar de un ramal al otro mientras los
// dos siguen pegados, asi que mide lo que mide por eso y no por estetica.
const CROSS_ISLAND_LEN = 30;
// A que coordenada de trazado empieza a partirse la calzada cuando el cruce
// nace en SPAWN_Z. Se necesita ANTES de que el cruce exista para poder ir
// dejando limpio lo que viene, asi que se calcula en vez de leerse.
//
// Es la COLA de la isleta, no su centro: mientras el divisor esta ahi la
// calzada es una sola, y los dos ramales arrancan justo donde el divisor se
// acaba. Poniendolo en el centro, la mitad trasera de la isleta quedaba ya
// dentro del reparto y se veia el muro escorado sobre uno de los dos ramales.
const CROSS_ISLAND_AT =
    -SPAWN_Z + CROSS_SIGN_AHEAD + CROSS_ISLAND_LEN / 2;   // 247

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
// Ahora la calzada se parte de verdad. Desde la cola del divisor salen DOS
// calzadas de tres carriles que se separan hacia los lados hasta quedar a
// veintiseis unidades una de otra —mas del doble de lo que miden de ancho— y a
// partir de ahi siguen paralelas. Lo que se ve por delante es esto:
//
//     ####      ####      dos calzadas, muy separadas y paralelas
//     ####      ####
//      ###    ###         abriendose
//        ######
//          ##             una sola, con el divisor
//          ##
//
// Y no se abren en abanico: SE DESVIAN, a cuarenta y cinco grados clavados.
// Todos los intentos anteriores repartian la separacion a lo largo de cien o
// ciento cincuenta unidades, y eso da angulos de ocho o catorce grados: una
// carretera que se dobla despacio, no un cruce. Un desvio se lee porque SALE,
// y sale con un angulo que se ve.
//
// Los dos numeros estan atados: con un smoothstep la pendiente maxima vale
// 1,5 x separacion / largo, asi que largo = 1,5 x separacion da exactamente
// pendiente 1, o sea 45 grados, en el punto medio del desvio. Cambiar uno sin
// el otro cambia el angulo. El smoothstep ademas entra y sale con pendiente
// cero, de modo que el desvio empalma con la recta sin un solo pico.
const FORK_SPREAD = 16;             // cuanto se separa cada ramal del eje
const FORK_LEN = 24;                // = 1,5 x FORK_SPREAD -> 45 grados clavados
const FORK_CLEAR = 70;              // margen sin objetos alrededor de la X
// Hueco libre entre el bordillo de una calzada y el de la otra. Nada mas
// partirse, las dos calzadas de 8,4 de ancho comparten sitio: sus centros
// estan a unos centimetros y quedan UNA ENCIMA DE LA OTRA, peleandose por el
// pixel. Lo que se veia no eran dos caminos sino una mancha con cuatro
// bordillos dentro. Ahora el ramal secundario se RECORTA contra el borde del
// principal —nace pegado a su bordillo, con este hueco de por medio, y crece
// hacia fuera segun se abren—, de modo que no se pisan nunca.
const FORK_GAP = 2.2;
// Media anchura visible a la altura del jugador. Es la base del recorte por
// encuadre del ramal descartado: mas alla de esto, y creciendo con la
// distancia, sus losas ya no caben en pantalla. Antes se apagaba con un reloj
// —medio segundo despues de elegir— y eso lo hacia desaparecer EN EL AIRE, a
// mitad de su curva. Ahora se apaga por donde esta, asi que se le ve marchar.
const FORK_CULL = 13;
// Y en las ultimas unidades el ramal descartado se HUNDE bajo la explanada.
// Cortarlo en seco al caducar la bifurcacion dejaba una carretera entera
// esfumandose de golpe a cien unidades por delante —dentro de la niebla no
// llega, la bruma cierra a 185— que es justo donde el jugador esta mirando.
// Hundiendose se va por debajo del suelo, que es opaco, y no hay corte.
const FORK_SINK = 40;               // unidades que dura el hundimiento
const FORK_SINK_DEEP = 4.5;         // cuanto baja: de sobra para pasar el suelo

// Ultimo tramo, ya dentro de la capital, entre tomar el desvio que lleva a ella
// y el final de la carrera. Acabar en el propio cruce habria cerrado la partida
// en el mismo frame en el que aparece el rotulo; asi da tiempo a ver la ciudad,
// que es el premio.
//
// 420 estaba bien cuando una carrera duraba dos minutos. Con la ruta en
// cuarenta, el premio por llegar eran SEIS SEGUNDOS de ciudad: la capital
// duraba el 3 % de lo que dura cualquier otra parada. Y arrastraba un fallo
// peor, porque el suceso de cada zona se arma a 9.040 de haber entrado y aqui
// la carrera se acababa a las 420: "Hora pico" era el unico suceso del juego
// que no se podia ver JAMAS. A 4.200 la capital dura un minuto largo, que es
// lo que hace falta para entrar, que te pase por encima la hora pico y llegar.
const FINISH_RUN = 4200;
// Y donde cae su suceso, contado desde que se entra. La capital es la unica
// zona que no cierra un cruce sino la meta, asi que su suceso no puede colgar
// de ZONE_SPAN como el de las demas: va al primer cuarto del tramo final, y
// deja el resto para la entrada a la ciudad.
const FINISH_ZONE_AT = 0.25;

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
// Largo de la curva. Subio de 165 a 225: a la velocidad de crucero, 165
// unidades son dos segundos y medio y la curva se acababa antes de que el
// jugador terminara de colocarse por dentro. Una curva tiene que durar lo
// bastante para que aguantar la linea sea el ejercicio, no un golpe de volante.
const TURN_LEN = 225;
// Cuanto se desplaza el trazado. Parece mucho al lado de las 6,4 unidades del
// serpenteo de siempre, pero es que la mascara de distancia se come todo lo de
// dentro de 158 unidades: lo que llega a verse es la ultima franja de calzada,
// que en pantalla mide cuatro dedos. Con treinta la curva se leia como una
// carretera casi recta. Y sube con el largo: repartir el mismo desplazamiento
// en mas unidades habria alargado la curva abriendola, que es lo contrario.
const TURN_AMP = 60;
// Lo que se gana en el punto mas cerrado. La curva es el unico tramo donde
// correr mas es lo que hace que cueste: lo que aprieta contra el borde de
// fuera es la velocidad, asi que subirla es subir la curva entera.
const TURN_SPEED = 1.3;
// Peralte. La curva movia el trazado y subia la velocidad, pero el ENCUADRE
// seguia igual de recto que en una recta, asi que el peligro no se sentia en
// ninguna parte: se veia. Ahora la camara se tumba hacia dentro del giro y
// ademas se va hacia fuera, que es lo que hace la inercia. Diecisiete grados
// serian una barbaridad en primera persona; aqui, donde lo unico que se ve del
// jugador es su espalda y la calzada ya se esta yendo de lado, es lo que hace
// que la curva se note en el cuerpo. Con ocho no se notaba nada.
//
// El alabeo de la calzada de siempre —`curveAtZ(cam.aimZ) * 0.022`— no valia
// aqui: va por la mascara de distancia, que es cero dentro de 158 unidades, y
// el punto de mira de la camara esta mucho mas cerca que eso.
const TURN_ROLL = 0.3;              // radianes de alabeo en el punto cerrado
const TURN_DRIFT = 2.1;             // unidades que la camara se va hacia fuera
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
// --- Hundimiento del firme ---
// Uno o dos carriles se desploman y dejan un agujero de verdad. Se pintan de
// rojo y parpadean mucho antes de caerse: un suelo que desaparece sin avisar
// no es un obstaculo, es una trampa.
//
// Dentro del tramo la calzada se dibuja en TRES TABLAS iguales, una por
// carril, en vez de con el despiece de la zona. El despiece no sirve: en
// Tikal la losa es una sola pieza de lado a lado —medido, cuts = 1— y no
// habria forma de tirar solo un tercio.
// El desplome no es del TRAMO, es de cada tabla por separado, y se mide en
// unidades de calzada y no en segundos. Antes las treinta y cuatro unidades se
// caian a la vez en cuanto el jugador entraba en el radio: para cuando llegaba,
// el agujero llevaba abierto y quieto un buen rato y lo unico que quedaba por
// ver era el hueco. Ahora cada tabla empieza a hundirse cuando el jugador esta
// a SINK_TRIGGER DE ELLA, asi que la rotura viene hacia el en oleada y el firme
// se sigue rompiendo a pocos metros de sus pies hasta que llega. Medido en
// unidades y no en tiempo, ademas, la oleada se ve igual a cualquier velocidad.
const SINK_LEN = 34;                // largo del agujero
const SINK_TRIGGER = 46;            // a que distancia por delante empieza a caerse cada tabla
const SINK_DROP = 30;               // en cuantas unidades se desploma
const SINK_DEEP = 16;               // cuanto baja la tabla antes de desaparecer
const SINK_W = ROAD_WIDTH / 3;      // ancho de cada tabla
const SINK_X = [-SINK_W, 0, SINK_W];

// --- Sacudidas de camara ---
// OJO CON LA ESCALA: la sacudida entra al cuadrado —`g = shake * shake`— para
// que el primer instante sea el que se nota. Eso significa que los valores
// pequenos no son sacudidas suaves, son NADA: con 0,3 el desplazamiento de
// camara sale de cinco centesimas de unidad, que a catorce unidades de
// distancia no se ve. Un golpe de verdad vale 1,05. Todo lo que quiera
// sentirse tiene que estar por encima de 0,4.
//
// Y hay tres, no una, porque no todas dicen lo mismo:
//   FALL - retumbo mientras las rocas del derrumbe caen por el aire. Es un
//          aviso: algo viene, todavia no ha llegado.
//   ROCK - el impacto contra la calzada, escalado con lo cerca que cae. Es lo
//          que separa una piedra que aterriza al lado de una que aterriza en
//          el horizonte, y sin ese escalado las dos se sentian igual, que no
//          se lee como peso sino como una averia.
//   SOFT - el firme rompiendose por delante. Lo provoca el propio jugador al
//          acercarse, asi que es un retumbo sostenido y no un golpe: una
//          sacudida de impacto ahi se leeria como que ya le ha pasado algo.
const SHAKE_FALL = 0.4;
const SHAKE_ROCK = 0.9;
const SHAKE_SOFT = 0.42;
const SHAKE_NEAR = 150;             // a esta distancia una roca ya solo retumba

const NARROW_LEN = 62;
const NARROW_TAPER = 22;            // lo que tarda en cerrarse a cada extremo
const NARROW_MIN = 1 / 3;           // se queda en un carril de los tres

// --- Salirse de la carretera -----------------------------------------------
const FALL_TIME = 1.15;             // lo que dura la caida antes del final

// --- Morir de un golpe -----------------------------------------------------
// La ultima vida se perdia y el menu de fin aparecia EN EL MISMO FRAME. No
// habia forma de ver contra que se habia chocado, y la partida se cerraba como
// si el juego se hubiera cortado en vez de como si te hubieras matado. Ahora
// el golpe se ve: el cuerpo sale despedido hacia atras dando vueltas, el mundo
// frena hasta pararse, y solo entonces se abre el final.
const DEATH_TIME = 1.5;             // lo que dura la muerte antes del final
const DEATH_UP = 12;                // impulso hacia arriba del cuerpo
const DEATH_BACK = 11;              // ...y hacia la camara

// --- Y la vuelta ------------------------------------------------------------
// Morir tenia su animacion desde hace dos versiones; volver, no: se cerraba el
// panel y el corredor aparecia de golpe corriendo, como si nada hubiera pasado.
// Eso hacia que revivir se leyese como un menu, no como un suceso, y con cuatro
// vueltas por carrera es algo que se va a ver cuatro veces.
//
// La vuelta es una caida al reves: el cuerpo baja desde lo alto girando sobre
// si mismo dentro de una columna de luz, y el mundo arranca desde parado en vez
// de estar ya a toda velocidad cuando se toca el suelo. Es lo mismo que hace el
// frenado de la muerte, del derecho.
const REZ_TIME = 1.45;              // lo que dura la bajada
const REZ_UP = 15;                  // desde que altura baja
const REZ_GOLD = 0xffd98a;          // el oro de la columna y de las plumas

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

// Metros entre sucesos anunciados —derrumbe, ganado, camioneta—. Se reparten
// por turnos en vez de sortearse: son tres, y con 240 sale algo mas de tres
// por ciclo de bifurcacion, asi que en un ciclo normal se ven los tres.
const EVENT_EVERY = 240;

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
// Bomba volcanica. Se comporta como la piedra rodante —cae del cielo y luego
// rueda— pero va al rojo vivo y no se tine con la zona: la lava es lava en
// Tajumulco y en el Fuego, y que cambiase de color con el departamento la
// convertiria en decorado.
const BOMBA = 4;

const HAZ_SPEED = [15, 9, 0, 17, 9];     // velocidad propia, sumada a la del mundo
// Franja vertical que ocupa cada amenaza sobre su suelo. Debajo del
// murcielago se pasa deslizandose; la piedra solo se salta.
const HAZ_LOW = [1.25, 0, 0, 0, 0];
// La vaca y la camioneta son mas altas que un salto a proposito: la respuesta
// a las dos es apartarse, y dejar que ademas se pudieran saltar convertiria
// tres respuestas distintas en una sola.
const HAZ_HIGH = [2.35, 1.45, 2.55, 3.7, 1.5];
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
// Cuantas gotas llenan el pachon del runner. Cien es un numero redondo y
// ademas es lo que se recoge en unos dos minutos de carrera limpia, o sea algo
// menos de una vida por zona: bastante para que corregir la linea y pasar por
// encima del jade merezca la pena, y poco para que no sustituya a las mejoras.
const GOTAS_VIDA = 100;

const C = {
    jade: 0x2ec4a0,
    agua: 0x8fd8ee,
    ochre: 0xc8862f,
    jaguarFur: 0xd9a24b,
    jaguarSpot: 0x3b2a14,
    quetzal: 0x1fae7e,
    quetzalBreast: 0xd8484a
};

// ===========================================================================
// La ruta: de Tikal a la capital, trece puntos
// ===========================================================================
// EL ORDEN DEL ARRAY ES LA RUTA, y la ruta es un camino, no una lista. Se sale
// siempre de Tikal y se llega a Ciudad de Guatemala, y entre un punto y el
// siguiente hay carretera de verdad —aproximando, que en Guatemala no todo
// conecta con todo—:
//
//   Tikal -> Flores            CA-13
//   Flores -> Semuc Champey    FTN por Sayaxché y Raxrujá
//   Semuc -> Río Dulce         FTN hasta Modesto Méndez
//   Río Dulce -> Esquipulas    CA-9 y CA-10 por Zacapa y Chiquimula
//   Esquipulas -> Monterrico   oriente por Ipala, Jutiapa y Taxisco
//   Monterrico -> Tajumulco    CA-2, la costera, hasta San Marcos
//   Tajumulco -> Todos Santos  por Huehuetenango
//   Todos Santos -> Chichi     Sacapulas y Santa Cruz del Quiché
//   Chichi -> Atitlán          Los Encuentros
//   Atitlán -> Fuego           CA-1 hasta Chimaltenango
//   Fuego -> Antigua           al lado
//   Antigua -> Guatemala       RN-14
//
// Ese orden es lo que hace que el mapa signifique algo: el minimapa dibuja los
// tramos como caminos y se van encendiendo al recorrerlos. Reordenar el array
// reordena la ruta y nada mas; nadie depende de los indices por su valor.
//
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
        // Petén es llano de punta a punta: la cordillera que habia aqui estaba
        // inventada. Queda una linea baja en la bruma, que es lo que de verdad
        // se ve por encima del dosel.
        ridge: 0x6e5c46, ridgeH: 0.3, sky: 'cloud', skyC: 0xf3d3ae,
        road: [1, 1, 0.94, 0], prop: 'jungle', propA: 0x2f6b4a, propB: 0x8a6a3f,
        ob: [1.0, 1.0, 1.0]
    },
    {
        id: 'flores', name: 'Flores', dept: 'Petén', mm: [62.4, 29.1],
        // El suelo de Flores era verde monte, y Flores es una ISLA: lo que hay
        // a los dos lados de la calzada es el lago Petén Itzá. Con el suelo
        // verde, el muelle de madera del final de zona, los juncos de la cuneta
        // y los peces saltando de un margen al otro estaban los cuatro
        // contando algo que la escena desmentia.
        skyTop: 0x2f7fc4, skyBot: 0xbfe3ea, fog: 0x7fb9c4, ground: 0x1d6273,
        sun: 0xfff4de, sunI: 2.15, hemi: 0xdff0f4, hemiI: 2.35,
        roadA: 0xe8dfc8, roadB: 0xd0c4a6, kerb: 0xc0644a,
        stone: 0xf0e8d8, accent: 0xc0472f, hazard: 0x1f88b8, pit: 0x06222e,
        land: 'town', landA: 0xf0e6d2, landB: 0xc0472f,
        ridge: 0x4f7f86, ridgeH: 0.3, sky: 'cloud', skyC: 0xffffff,
        road: [3, 2, 0.9, 0.02], prop: 'reed', propA: 0x3f8f6a, propB: 0xe0b25c,
        ob: [0.95, 1.05, 0.95]
    },
    {
        id: 'semuc', name: 'Semuc Champey', dept: 'Alta Verapaz', mm: [60.9, 64.1],
        // El suelo era verde monte oscuro, y Semuc ES el agua: las pozas de
        // caliza turquesa son la postal entera del sitio. Con el suelo verde,
        // la boca de cueva del final de zona —que es por donde el Cahabón se
        // mete bajo el puente natural—, los peces saltando de un margen al otro
        // y el turquesa de sus propios obstáculos estaban los cuatro contando
        // algo que la escena desmentia. Es el mismo fallo que tenia Flores.
        skyTop: 0x5d93b8, skyBot: 0xd7e6c4, fog: 0x8fb79a, ground: 0x2b8477,
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
        // Y el suelo era verde monte, con cinco cosas del propio sitio diciendo
        // que esto va sobre el agua: los peces que saltan de un margen al otro,
        // el muelle del final de zona, sus obstaculos azules, el fondo casi
        // negro de los huecos y un suceso que se llama "troncos del río". Es la
        // misma contradiccion de Flores y de Semuc, la tercera. Verde jade
        // oscuro, que es el color del Río Dulce metido en el cañón y lo que lo
        // separa del turquesa claro de las pozas de Semuc, dos paradas antes.
        skyTop: 0x2f86c9, skyBot: 0xa8e0e6, fog: 0x6fb3c0, ground: 0x1c4f3f,
        sun: 0xfff6e0, sunI: 2.2, hemi: 0xe4f4f6, hemiI: 2.4,
        roadA: 0xd9c9a4, roadB: 0xbfab82, kerb: 0x8a6b45,
        stone: 0x9b7448, accent: 0xe0b25c, hazard: 0x1f7fb0, pit: 0x06222f,
        land: 'gorge', landA: 0x8a9a86, landB: 0x2f9e5e,
        ridge: 0x3f7f7a, sky: 'cloud', skyC: 0xffffff,
        road: [1, 3, 0.84, 0.02], prop: 'mangrove', propA: 0x6f4f2f, propB: 0x2f9e5e,
        ob: [1.25, 0.85, 1.1]
    },
    {
        id: 'esquipulas', name: 'Esquipulas', dept: 'Chiquimula', mm: [75.9, 88.2],
        skyTop: 0x6f8fc0, skyBot: 0xe8c896, fog: 0xcfae82, ground: 0x4a5a3a,
        sun: 0xffe0b0, sunI: 2.0, hemi: 0xe4d2ba, hemiI: 1.9,
        roadA: 0xb8a684, roadB: 0x9e8b68, kerb: 0x8a7a5c,
        stone: 0xf2ece0, accent: 0xd4a63a, hazard: 0x3a2f24, pit: 0x1a140e,
        land: 'basilica', landA: 0xf2ece0, landB: 0xd4a63a,
        ridge: 0x7a7250, sky: 'cloud', skyC: 0xf6e2c2,
        road: [2, 2, 0.87, 0.06], prop: 'agave', propA: 0x5f7a44, propB: 0xb8a06a,
        ob: [0.95, 1.1, 0.95]
    },
    {
        id: 'monterrico', name: 'Monterrico', dept: 'Santa Rosa', mm: [47.4, 105.0],
        skyTop: 0x3b4f8a, skyBot: 0xf2a86b, fog: 0xd09a72, ground: 0x2b2b2e,
        sun: 0xffcf9c, sunI: 1.75, hemi: 0xcdb6a6, hemiI: 1.75,
        roadA: 0x5a544f, roadB: 0x484340, kerb: 0x7a6a55,
        stone: 0x6f5a3f, accent: 0xe8c98a, hazard: 0x2f6f8a, pit: 0x07202b,
        land: 'palm', landA: 0x4a3a26, landB: 0x2f7a4e,
        // Llanura costera: la cadena volcanica queda tierra adentro y muy lejos,
        // asi que se ve, pero baja. Es la misma correccion que en Petén.
        ridge: 0x6a5a54, ridgeH: 0.35, sky: 'cloud', skyC: 0xffd9b0,
        // Arena negra: sin cortes y sin junta, para que se lea como superficie
        // continua y no como losas.
        road: [1, 1, 1.0, 0.02], prop: 'palm', propA: 0x4a3a26, propB: 0x2f7a4e,
        ob: [1.2, 0.88, 1.12]
    },
    {
        id: 'tajumulco', name: 'Volcán Tajumulco', dept: 'San Marcos', mm: [12.0, 76.4],
        skyTop: 0x081120, skyBot: 0x1d3b46, fog: 0x17313b, ground: 0x152720,
        sun: 0xa8c6e6, sunI: 0.85, hemi: 0x6d90a4, hemiI: 1.05,
        roadA: 0x8c9aa0, roadB: 0x717e87, kerb: 0x5a666b,
        stone: 0x4a5560, accent: 0xcfe4ef, hazard: 0xd4451f, pit: 0x2a0e06,
        land: 'peak', landA: 0x2b3540, landB: 0xe8f2f7,
        // A cuatro mil metros el horizonte es sierra por todos lados.
        ridge: 0x1e2b34, ridgeH: 1.4, sky: 'star', skyC: 0xdfeaff,
        road: [3, 2, 0.93, 0.06], prop: 'rock', propA: 0x3a4550, propB: 0xcfe4ef,
        ob: [1.0, 1.1, 0.9]
    },
    {
        id: 'todossantos', name: 'Todos Santos', dept: 'Huehuetenango', mm: [19.5, 64.6],
        skyTop: 0x2f5fa8, skyBot: 0xcfe4f0, fog: 0x9fb8c4, ground: 0x3a5a44,
        sun: 0xf2f8ff, sunI: 2.0, hemi: 0xd6e6f0, hemiI: 2.1,
        roadA: 0xa8a89c, roadB: 0x8f8f7d, kerb: 0x7a7a68,
        stone: 0x8a8f88, accent: 0xd93a3a, hazard: 0x2a3f4a, pit: 0x131c22,
        // Caliza y no monte: los Cuchumatanes son roca desnuda por encima de los
        // tres mil, y el verde que tenia landA aqui lo hacia parecer un cerro
        // arbolado mas.
        land: 'mesa', landA: 0x8a8f7e, landB: 0xdfe8ee,
        ridge: 0x51707a, ridgeH: 1.3, sky: 'cloud', skyC: 0xffffff,
        road: [2, 1, 0.89, 0.07], prop: 'pine', propA: 0x2f5a3f, propB: 0xd93a3a,
        ob: [1.0, 1.05, 1.0]
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
        id: 'atitlan', name: 'Lago de Atitlán', dept: 'Sololá', mm: [29.6, 85.2],
        // El suelo era verde monte, y ademas el MISMO verde que el de Chichi, la
        // parada inmediatamente anterior: dos sitios seguidos con el suelo a
        // cinco grados de tono son un sitio contado dos veces. Y Atitlán es un
        // LAGO, con sus peces saltando y su muelle de fin de zona ya puestos.
        // Azul de atardecer, que ademas lo separa del turquesa de Semuc, del
        // lago de Flores y del jade del Río Dulce.
        skyTop: 0x3a3a6d, skyBot: 0xe37a45, fog: 0xc2724a, ground: 0x24405e,
        sun: 0xffad6a, sunI: 1.9, hemi: 0xd9aea0, hemiI: 1.8,
        roadA: 0xc9b9a0, roadB: 0xb0a088, kerb: 0x8f6f5a,
        stone: 0x6d5a72, accent: 0xd94f6a, hazard: 0x1d4f7a, pit: 0x081c2c,
        // landB pasa a ser el agua encendida por la puesta de sol: los tres
        // conos van oscuros a contraluz y lo que brilla es el lago.
        land: 'lake', landA: 0x3f4a55, landB: 0xe0956a,
        ridge: 0x46405f, sky: 'cloud', skyC: 0xf0a483,
        road: [3, 1, 0.9, 0.03], prop: 'maize', propA: 0x4f7a3f, propB: 0xd94f6a,
        ob: [0.95, 1.05, 1.0]
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
        id: 'antigua', name: 'Antigua', dept: 'Sacatepéquez', mm: [41.3, 88.4],
        skyTop: 0x5a7fb8, skyBot: 0xf0c48a, fog: 0xd0a479, ground: 0x3a5340,
        sun: 0xffd9a4, sunI: 1.95, hemi: 0xdcc4ad, hemiI: 1.85,
        roadA: 0x9c8f80, roadB: 0x857868, kerb: 0xb5a08a,
        stone: 0xe8d9b8, accent: 0xd4762f, hazard: 0x3b3128, pit: 0x18120c,
        land: 'colonial', landA: 0xe0c9a6, landB: 0xc0472f,
        // Antigua sin el Agua detras no es Antigua: es un pueblo colonial
        // cualquiera. Es la unica parada del recorrido que esta METIDA en un
        // valle, con tres volcanes alrededor y uno encima, y el horizonte tiene
        // que decirlo. La sierra sube y una cumbre se levanta sobre las demas.
        ridge: 0x5a6a52, ridgeH: 1.45, ridgeBig: 1, sky: 'cloud', skyC: 0xf7dcbe,
        // El adoquin: seis cortes a lo ancho y tres a lo largo, junta marcada
        // y piedras desigualadas. Es la calle de Antigua, y no se parece a
        // ninguna otra del recorrido.
        road: [6, 3, 0.85, 0.05], prop: 'jacaranda', propA: 0x4f6a44, propB: 0x8a6ac0,
        ob: [0.9, 1.15, 0.95]
    },
    {
        // La meta. Es el unico punto del que no se sale: llegar aqui cierra la
        // carrera. De noche y con las torres encendidas, porque despues de doce
        // desvios acertados el sitio tiene que verse distinto desde lejos.
        id: 'guate', name: 'Ciudad de Guatemala', dept: 'Guatemala', mm: [46.6, 86.6],
        // En el rotulo va corto. "CIUDAD DE GUATEMALA" a 62 px se aplasta
        // contra los 440 de ancho utiles del cartel y deja de leerse a la
        // distancia a la que hay que leerlo, que es toda la gracia. En las
        // señales de la CA-9 tambien pone GUATEMALA y nadie se confunde.
        sign: 'Guatemala',
        skyTop: 0x131a30, skyBot: 0xd9743c, fog: 0x7a5f55, ground: 0x2a2c30,
        sun: 0xffc48a, sunI: 1.6, hemi: 0xb4aab8, hemiI: 1.6,
        // Asfalto: junta casi cerrada y sin irregularidad. Es la unica calzada
        // del recorrido que no es piedra puesta a mano.
        roadA: 0x4c4c50, roadB: 0x3e3e42, kerb: 0xd8d2c4,
        stone: 0x8f9298, accent: 0xf0c34a, hazard: 0x2f6f8a, pit: 0x090b0f,
        land: 'city', landA: 0x3a3f4a, landB: 0xf0c34a,
        ridge: 0x2b3242, sky: 'star', skyC: 0xffe0b0,
        road: [3, 1, 0.97, 0], prop: 'block', propA: 0x4a4f58, propB: 0xf0c34a,
        ob: [1.0, 1.0, 1.0]
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
    order: 'https://cefaspan.github.io/web/menu/',
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
    // Cada cuanto toca video en vez de cartel. El video pide un iframe a
    // YouTube, arranca solo y tarda en cargar; el cartel es una imagen del
    // propio origen que aparece al instante. Uno de cada veinte es bastante
    // para que el canal siga apareciendo sin que revivir se vuelva un tramite.
    videoOdds: 0.05,
    // Carteles verticales, del mismo formato 9/16 que el hueco del panel: no
    // hace falta reservar sitio distinto ni el panel da un salto al entrar.
    posters: [
        'src/img/ads/ad-game.webp', 'src/img/ads/ad-game-2.webp',
        'src/img/ads/ad-food.webp', 'src/img/ads/ad-bagget.webp',
        'src/img/ads/ad-love.webp', 'src/img/ads/ad-more.webp'
    ],
    // Y las tiras apaisadas, para el menu y el fin de partida. Ahi no
    // interrumpen nada: son las dos pantallas en las que el jugador ya ha
    // dejado de jugar.
    banners: [
        'src/img/ads/banner-pan-fresco.webp', 'src/img/ads/banner-antojo.webp',
        'src/img/ads/banner-pausa.webp', 'src/img/ads/banner-sube-nivel.webp',
        'src/img/ads/banner-mas-dulce.webp', 'src/img/ads/banner-conecta.webp'
    ],
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

// Uno al azar de una lista, o cadena vacia si esta vacia. Sale aparte porque
// se usa para los carteles y para los banners, y en los dos casos lo que
// importa es que no salga el mismo dos veces seguidas por casualidad de
// escribirlo dos veces.
function pickAd(lista) {
    return lista && lista.length ? lista[(Math.random() * lista.length) | 0] : '';
}

// La tira apaisada. Va detras de la franja del patrocinador, nunca encima del
// juego y nunca durante una partida: el trato es que la publicidad ocupe las
// pantallas en las que ya se ha parado de jugar.
//
// Si el archivo no esta, el enlace se quita entero en vez de dejar el hueco
// roto de una imagen que no carga.
function sponsorBanner() {
    const src = pickAd(CEFAS.banners);
    if (!src) return '';
    return '<a class="sponsor-banner" href="' + CEFAS.order + '" ' +
        'target="_blank" rel="noopener noreferrer" ' +
        'aria-label="' + CEFAS.name + '">' +
        '<img src="' + src + '" alt="" loading="lazy" decoding="async" ' +
        'onerror="this.parentElement.remove()">' +
        '</a>';
}

// La franja. Se pinta en el menu, en el fin de partida y bajo el panel de
// revivir; el mismo trozo de HTML en los tres sitios. El banner solo en los
// dos primeros: en el panel de revivir ya hay un cartel a pantalla completa,
// y dos anuncios en la misma tarjeta es justo lo que hace que se cierre.
function sponsorStrip(conBanner) {
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
        link(CEFAS.order, 'order', 'Ver la carta', 'slink-order') +
        CEFAS.social.map(x => link(x.url, x.id, x.name)).join('') +
        link(CEFAS.channel, 'yt', 'Shorts') +
        '</div>' +
        (conBanner ? sponsorBanner() : '');
}

// Se repinta cada vez que se entra al menu o se acaba una partida, no una vez
// al arrancar: si se pintara una sola vez, el banner elegido seria el mismo
// durante toda la sesion y la rotacion no serviria de nada.
function paintSponsors() {
    if (dom.sponsorMenu) dom.sponsorMenu.innerHTML = sponsorStrip(true);
    if (dom.sponsorOver) dom.sponsorOver.innerHTML = sponsorStrip(true);
    if (dom.sponsorRevive) dom.sponsorRevive.innerHTML = sponsorStrip(false);
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
    // Tres trajes y no ocho, y los tres hacen algo DISTINTO. Los cinco que
    // habia en medio -Tejedora, Jaguar, Quetzal, Chapín y Ceniza- eran el mismo
    // muneco con otros siete colores: se compraban una vez, se miraban diez
    // segundos y no cambiaban nada. Una lista corta en la que cada entrada es
    // una forma de jugar vale mas que una larga de recolores.
    { id: 'runner', name: 'Runner', icon: '⏱', runner: true,
      desc: 'Pantaloneta, playera y pachón. Recoge gotas: a las 100 se llena y ' +
            'te da una vida. Y el camino se le llena de publicidad.',
      cost: 500, cloth: 0x2ec4a0, skin: 0xd9a066, crest: 0xf2f6fa, legs: 0x2a3038,
      trim: 0xf0c34a, hair: 0x241810, boot: 0xef4444 },
    // El unico traje que NO es solo color. Trae maquina debajo y casco encima, y
    // el casco es lo primero que se come un golpe: por eso cuesta lo que cuesta
    // y por eso va el ultimo de la lista.
    { id: 'bici', name: 'Bicicleta', icon: '◎', veh: 'bici',
      desc: 'Rueda libre: en las bajadas ganas un 38 % en vez de un 20 %. ' +
            'Más metros, y más deprisa de lo que da tiempo a leer.',
      cost: 700, cloth: 0xf0c34a, skin: 0xd9a066, crest: 0x1f2a52, legs: 0x1f2a52,
      trim: 0xd9d9d9, hair: 0x241810, boot: 0x2a2f38,
      bike: 0x2ec4a0, bikeDark: 0x14161a, visor: 0x1b2430 },
    { id: 'patineta', name: 'Patineta', icon: '▭', veh: 'patineta',
      desc: 'Talla en vez de dar el paso: cambias de carril un tercio más ' +
            'rápido. De pie y con los brazos abiertos.',
      cost: 800, cloth: 0xd94f6a, skin: 0xd9a066, crest: 0x2a2f38, legs: 0x3a4250,
      trim: 0xd9d9d9, hair: 0x1a1008, boot: 0xf2f6fa,
      bike: 0xc8862f, bikeDark: 0x14161a, visor: 0x1b2430 },
    { id: 'monopatin', name: 'Monopatín', icon: '⌐', veh: 'monopatin',
      desc: 'Levanta la tabla: saltas un tercio más alto. De pie y agarrado ' +
            'al manubrio, con un pie en el estribo.',
      cost: 1000, cloth: 0x4a90d9, skin: 0xd9a066, crest: 0xf2f6fa, legs: 0x2a3038,
      trim: 0xd9d9d9, hair: 0x241810, boot: 0x22242a,
      bike: 0xef4444, bikeDark: 0x14161a, visor: 0x1b2430 },
    { id: 'moto', name: 'Moto', icon: '≡', moto: true, veh: 'moto',
      desc: 'Con casco, y el casco aguanta un golpe antes que el escudo. Uno por carrera.',
      cost: 1500, cloth: 0x2a2f38, skin: 0xd9a066, crest: 0xd93a3a, legs: 0x1a1c20,
      trim: 0xd9d9d9, hair: 0x1a1008, boot: 0x22242a,
      bike: 0xd93a3a, bikeDark: 0x14161a, visor: 0x1b2430 }
];

// ===========================================================================
// Lo que trae cada vehiculo
// ===========================================================================
// Un numero por vehiculo y por cosa, todos en la misma tabla, para que el
// reparto se vea de un vistazo y no haya que ir a buscarlo a tres sitios del
// bucle. Cada dote sale de lo que ESE vehiculo hace de verdad y no de repartir
// ventajas a partes iguales:
//
//   bici      - rueda libre cuesta abajo. Una bici baja mas rapido que
//               cualquier otra cosa de esta lista, y ademas es lo unico que
//               puede hacer sin motor.
//   patineta  - talla. Cambiar de carril en una tabla es inclinarse, no dar un
//               paso, y por eso sale antes de donde estaba.
//   monopatin - salta. Vas de pie y con el peso encima del estribo, que es
//               justo la postura desde la que se levanta la tabla.
//   moto      - el casco, que ya lo tiene y es la unica dote defensiva.
//
// Y ninguna es gratis: las cuatro se compran, y la mas cara es la que protege.
const VEH_NADA = { cuesta: 1, carril: 1, salto: 1 };
const VEH_DOTE = {
    bici:      { cuesta: 1.9, carril: 1,    salto: 1 },
    patineta:  { cuesta: 1,   carril: 0.66, salto: 1 },
    monopatin: { cuesta: 1,   carril: 1,    salto: 1.16 },
    moto:      VEH_NADA
};
const dote = () => VEH_DOTE[vehOn] || VEH_NADA;

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
// El ángel de la guarda
// ===========================================================================
// La unica cosa de la tienda que se GASTA. Todo lo demas se compra una vez y se
// queda para siempre; el angel se compra, viaja en el zurron y desaparece al
// usarlo, y por eso no cabe en UPGRADES —donde el nivel solo sube— y lleva su
// propio contador.
//
// Y por eso hace falta: hasta ahora morir ofrecia UNA salida, ver el anuncio, y
// solo una vez por carrera. En carreras de dos minutos eso bastaba; en una ruta
// de dos horas y media, morir en la zona once y que la unica alternativa sea
// empezar otra vez desde Tikal no es dificultad, es tirar hora y pico. Con tres
// angeles comprados mas el del patrocinador salen cuatro vueltas por carrera, y
// el jade deja de servir solo para trajes.
//
// El angel NO pasa por el anuncio: se paga con jade y devuelve al jugador a la
// calzada en el sitio, sin reloj y sin esperar. Ese es exactamente el trato
// —el jade compra tu tiempo—, y si ademas pidiera el video no seria nada.
const ANGEL_MAX = 3;
const ANGEL_COST = 240;

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
    luck:    '<path d="M12 2l2.6 6.6L21 11l-6.4 2.4L12 20l-2.6-6.6L3 11l6.4-2.4z"/>',
    // Dos alas abiertas y una aureola: se lee a dieciseis pixeles, que es el
    // tamano al que se va a ver de verdad en la tarjeta del taller.
    angel:   '<circle cx="12" cy="4.4" r="2"/><path d="M12 8c2 0 3.4 1.5 3.4 3.6V20h-6.8v-8.4C8.6 9.5 10 8 12 8z"/><path d="M8.4 10.4C6 9.4 3.4 9.8 1.6 11.6c2.6.4 4.6 1.8 6.8 3.4zM15.6 10.4c2.4-1 5-.6 6.8 1.2-2.6.4-4.6 1.8-6.8 3.4z"/>'
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
    monterrico:  '<circle cx="18" cy="6" r="3.4"/><path d="M2 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="2"/>',
    guate:       '<path d="M2 21h20v1H2z"/><rect x="4" y="11" width="4.6" height="10"/><rect x="9.8" y="5" width="4.6" height="16"/><rect x="15.6" y="13" width="4.4" height="8"/><path d="M11.6 2h1v3h-1z"/>'
};

const svg = body => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';

// ===========================================================================
// El suceso de cada zona
// ===========================================================================
// Cada punto de la ruta tiene UNA cosa que solo pasa ahi, y pasa una vez por
// visita, cerca del final del tramo. No es decorado: es lo que convierte
// "estoy en Tajumulco" en "estoy en Tajumulco Y EL VOLCAN ESTA ESCUPIENDO".
// Antes, las trece zonas se distinguian por el color del cielo y por lo que
// crecia en la cuneta, y eso las hacia distintas de mirar pero identicas de
// JUGAR: la misma piedra rodante y el mismo murcielago en la selva, en la
// playa y en la cumbre nevada.
//
// Trece sucesos con arte propio serian trece juegos. Lo que hay es un
// vocabulario de seis patrones y una ficha por zona que los compone y los
// tematiza —el nombre, el color con el que se tine la escena mientras dura, de
// que color son las chispas y con que cadencia viene lo que viene—:
//
//   lluvia   - algo cae del cielo sobre los carriles
//   enjambre - amenazas que vienen a por ti, seguidas y por el mismo sitio
//   cruce    - algo cruza la calzada de un margen al otro
//   pasillo  - obstaculos del suelo encadenados
//   viento   - empuja de lado; no golpea, descoloca
//   temblor  - retumba y cae piedra de los margenes
//
// La UNICA pieza nueva es la bomba volcanica, que es la que el suceso de
// Tajumulco necesitaba de verdad. Todo lo demas recombina lo que ya hay.
//
// n es el numero de OLEADAS, no de piezas. Cada oleada suelta algo en todos
// los carriles menos el libre, de golpe: eso es lo que se lee como un suceso.
//
// La primera version soltaba una pieza por hueco y salia MENOS densa que el
// ruido de fondo del camino: cinco murcielagos repartidos en 380 unidades son
// uno cada 76, y los sueltos de siempre salen cada 35. Se armaba, sonaba el
// rotulo, caia el tinte... y no habia nada que ver, porque un suceso mas flojo
// que lo normal no es un suceso. En oleadas, con el hueco libre moviendose, se
// pide lo mismo que antes -leer y moverse- pero se ve.
// Las cinco formas de despedirse de una zona. No todas se despiden igual: por
// Tikal se pasa POR DENTRO de una piramide, en Semuc por la boca de una cueva y
// en la capital por debajo de un paso elevado. Todas comparten los materiales
// tematizados de la region, asi que ademas van del color del sitio.
const GATE_PIRAMIDE = 0, GATE_ARCO = 1, GATE_TUNEL = 2;
const GATE_MUELLE = 3, GATE_PASO = 4;
// Alto libre del vano. Por debajo se pasa incluso volando con el quetzal, que
// sube a seis: un portico que se pudiera golpear seria un obstaculo, y esto no
// pide nada, solo dice donde se acaba el sitio.
const GATE_CLEAR = 11;

// gate  - por que estructura se sale de la zona.
// vida  - que se ve moverse ahi todo el rato, sin tocar nada: 'pez' salta de un
//         margen al otro donde hay agua, 'ave' cruza por lo alto.
// bicho - de que color es ESE bicho aqui. Las aves eran gris pizarra en las
//         trece zonas, asi que la bandada de guacamayas de Peten y las gaviotas
//         de Monterrico eran la misma silueta oscura. El color es lo unico que
//         separa una cosa de la otra a la distancia a la que se ven.
// polvo - motas de ambiente que caen siempre, del color del sitio.
const ZONES = {
    // El tinte de Tikal era 0x0d2a1e, verde oscuro, sobre una selva verde al
    // amanecer: el suceso se anunciaba, caia el tinte... y la escena se quedaba
    // igual. El camazotz es el murcielago del inframundo, asi que lo que tiene
    // que caer sobre la selva es la NOCHE, y el violeta es lo que mas lejos
    // esta del ocre del amanecer de Peten.
    tikal:       { name: 'Vuelo de camazotz',   kind: 'enjambre', what: CAMAZOTZ, n: 7,
                   warn: 'animal',   tint: 0x241a3a, spark: 0x9f7ad9,
                   gate: GATE_PIRAMIDE, vida: 'ave', bicho: 0xd8484a, polvo: 0xe8d8a0 },
    // Este tinte era azul lago, y funcionaba mientras el suelo de Flores fue
    // verde monte. Al poner el suelo del color del lago —que es lo que Flores
    // es— el tinte se quedo a doce grados de tono de la superficie que tine, o
    // sea invisible: se lo comio su propio arreglo. Lo que hace un cenote al
    // tragarse la calzada es remover el fondo, asi que el agua se pone del color
    // del limo, y eso ademas esta a ciento cuarenta grados del turquesa.
    flores:      { name: 'El lago se la traga', kind: 'pasillo',  what: CENOTE,   n: 7,
                   warn: 'hueco',    tint: 0x6b6330, spark: 0xd8c98a,
                   gate: GATE_MUELLE, vida: 'pez', bicho: 0xdfe8d8, polvo: 0xbfe3ea },
    // Mismo fallo que tenia Tikal: el tinte era 0x24503a, verde oscuro, sobre
    // un canon verde. Se anunciaba el desprendimiento, caia el tinte... y la
    // escena se quedaba igual. Lo que llena el aire cuando se desploma media
    // ladera de caliza es POLVO DE PIEDRA, y el gris cal es ademas lo que mas
    // lejos esta del verde de Alta Verapaz.
    semuc:       { name: 'Desprendimiento',     kind: 'lluvia',   what: RODANTE,  n: 8,
                   warn: 'derrumbe', tint: 0xa89a7a, spark: 0xe8e0cc,
                   gate: GATE_TUNEL, vida: 'pez', bicho: 0xd8e8e0, polvo: 0xd8f0ea },
    // Tercer tinte verde oscuro sobre suelo verde, a cinco grados de tono del
    // suelo que tine. Lo que trae troncos rio abajo es la CRECIDA, y una
    // crecida se ve porque el agua se pone de color barro.
    riodulce:    { name: 'Troncos del río',     kind: 'pasillo',  what: TRONCO,   n: 7,
                   warn: 'derrumbe', tint: 0x8a6234, spark: 0xb08a52,
                   gate: GATE_MUELLE, vida: 'pez', bicho: 0xc8b078, polvo: 0x8fe0c0 },
    // Este tinte pasaba la prueba del tono por los pelos —59 grados— pero
    // suspendia la otra: tenia exactamente la MISMA LUZ que el suelo que tine,
    // 0,315 contra 0,331. Un tinte que ni cambia de tono ni cambia de claro a
    // oscuro no hace nada, y aqui ademas iba al reves de lo que deberia: el
    // polvo que levanta una caravana en el corredor seco no oscurece la escena,
    // la BLANQUEA, porque es polvo en el aire y el polvo en el aire coge luz.
    esquipulas:  { name: 'Caravana de romería', kind: 'enjambre', what: BUS,      n: 7,
                   warn: 'parada',   tint: 0xc9a05a, spark: 0xf0c34a,
                   gate: GATE_ARCO, vida: 'ave', bicho: 0x2b3138, polvo: 0xe8c896 },
    monterrico:  { name: 'Marejada',            kind: 'pasillo',  what: TRONCO,   n: 7,
                   warn: 'derrumbe', tint: 0x1a5f7a, spark: 0xcfeef6,
                   gate: GATE_MUELLE, vida: 'pez', bicho: 0xc0c8b0, polvo: 0xffd9b0 },
    tajumulco:   { name: 'Erupción',            kind: 'lluvia',   what: BOMBA,    n: 9,
                   warn: 'derrumbe', tint: 0xd4451f, spark: 0xff8a4a,
                   gate: GATE_TUNEL, vida: 'ave', bicho: 0x4a3a2a, polvo: 0xa8c6e6 },
    todossantos: { name: 'Ventisca',            kind: 'viento',   what: 0,        n: 0,
                   warn: 'viento',   tint: 0xdfeaf4, spark: 0xffffff,
                   gate: GATE_TUNEL, vida: 'ave', bicho: 0x3a3a44, polvo: 0xffffff },
    chichi:      { name: 'Camino del mercado',  kind: 'cruce',    what: VACA,     n: 6,
                   warn: 'animal',   tint: 0x5a2f52, spark: 0xf0c34a,
                   gate: GATE_ARCO, vida: 'ave', bicho: 0x2ec4a0, polvo: 0xdfe6ff },
    // Al poner el suelo de Atitlán del color del lago, este tinte azul se quedo
    // a seis grados de la superficie que tine: el mismo accidente que le paso a
    // Flores, y por eso ahora se comprueba antes de cambiar un suelo. El Xocomil
    // es el viento de la tarde que pone el lago picado y plomizo, asi que lo que
    // tiene que hacer el tinte es JUSTO LO CONTRARIO de tener color: quitarselo
    // a la escena. Contra un azul saturado, un gris se separa por saturacion.
    atitlan:     { name: 'Xocomil',             kind: 'viento',   what: 0,        n: 0,
                   warn: 'viento',   tint: 0x6a6478, spark: 0xcfe4ef,
                   gate: GATE_MUELLE, vida: 'pez', bicho: 0xa8c0d0, polvo: 0xf0a483 },
    fuego:       { name: 'El Fuego escupe',     kind: 'lluvia',   what: BOMBA,    n: 8,
                   warn: 'derrumbe', tint: 0xff4a10, spark: 0xffb04a,
                   gate: GATE_TUNEL, vida: 'none', bicho: 0x2b3138, polvo: 0xff8a4a },
    antigua:     { name: 'Temblor',             kind: 'temblor',  what: RODANTE,  n: 8,
                   warn: 'derrumbe', tint: 0x9a8250, spark: 0xe8dcc0,
                   gate: GATE_ARCO, vida: 'ave', bicho: 0x1f2a20, polvo: 0xe0c9a6 },
    guate:       { name: 'Hora pico',           kind: 'enjambre', what: BUS,      n: 7,
                   warn: 'parada',   tint: 0x1a2440, spark: 0xf0c34a,
                   gate: GATE_PASO, vida: 'ave', bicho: 0x2b3138, polvo: 0x8f9298 }
};

// Cuanto dura el suceso, en unidades de trazado, y cuando se arma.
//
// --- Cuanto dura una zona ---------------------------------------------------
// LA PERILLA. Antes lo decidia CROSS_EVERY —los cruces alternaban destino y
// cortada, asi que la zona duraba dos cruces— y eso ataba dos cosas que no
// tienen nada que ver: cada cuanto se decide un camino y cuanto se esta en un
// sitio. Con zonas de doce minutos, atados, habria un cruce cada seis.
//
// Ahora la zona dura ZONE_SPAN unidades de calzada y el cruce que cambia de
// sitio no aparece hasta que se cumplen: hasta entonces todos son cortadas. Y
// si se toma el retorno, el contador sigue vencido, asi que el siguiente cruce
// vuelve a ser de destino y equivocarse cuesta un cruce, no una zona entera.
const ZONE_MINUTES = 3;
const ZONE_SPAN = ZONE_MINUTES * 60 * SPEED_MAX;

// --- Cuando pasa el suceso de la zona ---------------------------------------
// UNA vez por visita, y al FINAL. Antes se repetia cada 6.000 unidades —unas
// ocho veces por zona— y eso lo estropeaba dos veces: de tanto verlo dejaba de
// ser el suceso del sitio y pasaba a ser ruido de fondo con rotulo, y ademas
// caia en cualquier punto del tramo, asi que no significaba nada. Ocurriendo
// una sola vez y cerca del final, la zona tiene forma: se entra, se corre, y lo
// gordo pasa justo antes de la estructura de despedida y la bifurcacion.
//
// Se cuenta desde el FINAL de la zona y no como fraccion, para que siga
// significando lo mismo si ZONE_MINUTES cambia: son las unidades que quedan de
// zona cuando el suceso se arma. El suceso ocupa ARM_AHEAD + ZONE_LEN, unas
// 675, asi que despues quedan todavia unos treinta y cinco segundos de carrera
// hasta que la zona cumple, y ahi entra la estructura y luego el cruce.
//
// El maximo con un tercio del tramo es la red de seguridad: con zonas muy
// cortas, restar 3.200 daria un numero negativo y el suceso saldria antes de
// haber entrado.
const ZONE_CLIMAX = 3200;
const zoneClimaxAt = () => Math.max(ZONE_SPAN * 0.35, ZONE_SPAN - ZONE_CLIMAX);

// Cuanto antes del cruce se planta el arco de fin de zona. Sumadas las 170 que
// tarda en llegar desde el punto de aparicion, se pasa por debajo unas 400
// unidades antes del distribuidor: lo bastante para que el arco asome en la
// bruma, se acerque y quede atras antes de que aparezca el rotulo verde.
const GATE_AHEAD = 300;
const ZONE_LEN = 460;
const ZONE_WIND = 2.6;              // unidades que llega a apartar la ventisca

// Los trajes no llevan glifo sino un muñeco pintado con SUS colores: es a la
// vez icono y vista previa, y ahorra tener que ponerselo para saber como es.
function skinIcon(sk) {
    const c = h => '#' + h.toString(16).padStart(6, '0');
    // El de la moto es otro dibujo, no el muneco con otros colores: es lo unico
    // que hay en la tienda que no es un traje, y la tarjeta tiene que decirlo
    // antes de leer una palabra.
    if (sk.runner) {
        // Gorra con visera, playera, pantaloneta y el pachon a la cintura. Es
        // el mismo muneco que los demas trajes pero con OTRA ropa, asi que aqui
        // el dibujo si es un muneco: lo que cambia de verdad es lo que lleva.
        return svg(
            '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
            '<rect x="7.6" y="1.4" width="8.8" height="2.4" rx="1.1" fill="' + c(sk.crest) + '"/>' +
            '<rect x="6" y="3.2" width="6" height="1.1" rx=".5" fill="' + c(sk.crest) + '"/>' +
            '<rect x="8.6" y="4.2" width="6.8" height="4.6" rx="1.1" fill="' + c(sk.skin) + '"/>' +
            '<rect x="6.6" y="9" width="10.8" height="6.2" rx="1.5" fill="' + c(sk.cloth) + '"/>' +
            '<rect x="10.2" y="10.6" width="3.6" height="2.8" rx=".5" fill="' + c(sk.crest) + '"/>' +
            '<rect x="3.8" y="9.6" width="2.2" height="5" rx="1.1" fill="' + c(sk.skin) + '"/>' +
            '<rect x="18" y="9.6" width="2.2" height="5" rx="1.1" fill="' + c(sk.skin) + '"/>' +
            '<rect x="17.4" y="12" width="2.4" height="4" rx=".9" fill="' + c(sk.trim) + '"/>' +
            '<rect x="8" y="15.4" width="3.4" height="4" rx=".9" fill="' + c(sk.legs) + '"/>' +
            '<rect x="12.6" y="15.4" width="3.4" height="4" rx=".9" fill="' + c(sk.legs) + '"/>' +
            '<rect x="7.4" y="19.6" width="4.4" height="2" rx="1" fill="' + c(sk.boot) + '"/>' +
            '<rect x="12.2" y="19.6" width="4.4" height="2" rx="1" fill="' + c(sk.boot) + '"/>'
        );
    }
    if (sk.veh === 'bici') {
        return svg(
            '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
            '<circle cx="12" cy="6" r="2.1" fill="' + c(sk.crest) + '"/>' +
            '<path d="M10.6 8.4h4l2 4.2h-8z" fill="' + c(sk.cloth) + '"/>' +
            '<circle cx="5.6" cy="17.4" r="4.3" fill="none" stroke="' + c(sk.bike) +
                '" stroke-width="1.5"/>' +
            '<circle cx="18.4" cy="17.4" r="4.3" fill="none" stroke="' + c(sk.bike) +
                '" stroke-width="1.5"/>' +
            '<path d="M5.6 17.4 12 12.4l6.4 5M12 12.4v5" fill="none" stroke="' + c(sk.bike) +
                '" stroke-width="1.4"/>' +
            '<rect x="15.6" y="10.4" width="4" height="1.3" rx=".6" fill="' + c(sk.trim) + '"/>'
        );
    }
    if (sk.veh === 'patineta') {
        return svg(
            '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
            '<circle cx="12" cy="4.6" r="2.1" fill="' + c(sk.crest) + '"/>' +
            '<path d="M10.4 7h3.2l2.2 5h-7.6z" fill="' + c(sk.cloth) + '"/>' +
            // Los brazos abiertos, que es lo que distingue a la patineta del
            // monopatin de un vistazo: aqui no hay de que agarrarse.
            '<path d="M4 8.6l5.2 1.6-.6 2-5.2-1.6zM20 8.6l-5.2 1.6.6 2 5.2-1.6z" fill="' +
                c(sk.skin) + '"/>' +
            '<rect x="8.6" y="12" width="2.4" height="4.4" rx=".8" fill="' + c(sk.legs) + '"/>' +
            '<rect x="13" y="12" width="2.4" height="4.4" rx=".8" fill="' + c(sk.legs) + '"/>' +
            '<rect x="4.6" y="17" width="14.8" height="1.8" rx=".9" fill="' + c(sk.bike) + '"/>' +
            '<circle cx="8" cy="20.4" r="1.5" fill="' + c(sk.bikeDark) + '"/>' +
            '<circle cx="16" cy="20.4" r="1.5" fill="' + c(sk.bikeDark) + '"/>'
        );
    }
    if (sk.veh === 'monopatin') {
        return svg(
            '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
            '<circle cx="10.4" cy="4.6" r="2.1" fill="' + c(sk.crest) + '"/>' +
            '<path d="M8.8 7h3.2l2 5h-7.2z" fill="' + c(sk.cloth) + '"/>' +
            '<rect x="7.4" y="12" width="2.4" height="4.6" rx=".8" fill="' + c(sk.legs) + '"/>' +
            '<rect x="11" y="12.6" width="2.2" height="4" rx=".8" fill="' + c(sk.legs) + '"/>' +
            // El mastil y el manubrio, agarrado: lo contrario de la patineta.
            '<rect x="16.4" y="5.4" width="1.7" height="12.6" rx=".8" fill="' + c(sk.bike) + '"/>' +
            '<rect x="13.6" y="4.6" width="7" height="1.6" rx=".8" fill="' + c(sk.trim) + '"/>' +
            '<path d="M11.6 8.4l5 -2.4.8 1.9-5 2.4z" fill="' + c(sk.skin) + '"/>' +
            '<rect x="5.4" y="17.6" width="13" height="1.7" rx=".85" fill="' + c(sk.bike) + '"/>' +
            '<circle cx="7.4" cy="20.8" r="1.6" fill="' + c(sk.bikeDark) + '"/>' +
            '<circle cx="17.2" cy="20.8" r="1.6" fill="' + c(sk.bikeDark) + '"/>'
        );
    }
    if (sk.moto) {
        return svg(
            '<rect x="1" y="0" width="22" height="24" rx="4" fill="#efe6d2" opacity=".16"/>' +
            // Piloto: casco con visera, tronco echado hacia delante
            '<rect x="8" y="2.2" width="7" height="6" rx="2.6" fill="' + c(sk.crest) + '"/>' +
            '<rect x="7.4" y="4.4" width="3" height="2.2" rx="1" fill="' + c(sk.visor) + '"/>' +
            '<path d="M9 8.6h5.4l2.4 5.2h-9z" fill="' + c(sk.cloth) + '"/>' +
            // Maquina
            '<rect x="6" y="13" width="12" height="2.6" rx="1.2" fill="' + c(sk.bike) + '"/>' +
            '<rect x="4.2" y="11.4" width="4" height="1.5" rx=".7" fill="' + c(sk.trim) + '"/>' +
            '<circle cx="6.4" cy="19" r="3.6" fill="' + c(sk.bikeDark) + '"/>' +
            '<circle cx="17.6" cy="19" r="3.6" fill="' + c(sk.bikeDark) + '"/>' +
            '<circle cx="6.4" cy="19" r="1.2" fill="' + c(sk.trim) + '"/>' +
            '<circle cx="17.6" cy="19" r="1.2" fill="' + c(sk.trim) + '"/>'
        );
    }
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
    flight: { name: 'Vuelo del quetzal',   time: 6.5,  color: 0x7fd4ff, weight: 12 },
    // El poder PROPIO del traje que lleves. Es un solo hueco con cinco
    // significados y no cinco poderes sueltos, y eso no es un atajo: solo se
    // puede llevar un traje a la vez, asi que dos de ellos no pueden coincidir
    // NUNCA. Con cinco entradas habria cinco materiales, cinco geometrias,
    // cinco casillas de HUD y cinco relojes para que cuatro estuvieran siempre
    // a cero. Con uno, el nombre, el color y el efecto se cambian al vestirse.
    propio: { name: '', time: 8, color: 0xffffff, weight: 18 }
};

// Lo que ese hueco significa segun lo que lleves puesto. El de Ajaw no existe a
// proposito: es el traje de referencia y es gratis, asi que no le toca nada.
const PROPIOS = {
    runner:    { name: 'Segundo aire', time: 9, color: 0x8fd8ee, icon: '≈',
                 corto: 'Cada gota cuenta por dos' },
    bici:      { name: 'Escapada',     time: 7, color: 0xf0c34a, icon: '»',
                 corto: 'Te sueltas: un tercio más de velocidad' },
    patineta:  { name: 'Ollie',        time: 8, color: 0xc8862f, icon: '⌃',
                 corto: 'La tabla salta sola lo que se salta' },
    monopatin: { name: 'Brinco',       time: 8, color: 0xef4444, icon: '⇈',
                 corto: 'Saltos sin contar, uno detrás de otro' },
    moto:      { name: 'Embestida',    time: 6, color: 0xd93a3a, icon: '◈',
                 corto: 'Te llevas por delante lo que toques' }
};

// El traje puesto tiene poder propio o no. Ajaw no lo tiene.
let propioAct = null;
// Cuantas chispas dan la vuelta al personaje. Doce es lo que hace falta para
// que a la velocidad a la que va esto se lea un anillo y no cuatro puntos.
const AURA_ORBS = 12;

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
    casco: false,        // el casco de la moto, uno por carrera y antes que el escudo
    gotas: 0,            // agua en el pachon del runner, 0..GOTAS_VIDA
    invuln: 0,
    elapsed: 0,
    nextSpawnZ: SPAWN_Z,
    nextMilestone: MILESTONE_EVERY,
    best: 0,
    startRegion: 0,
    region: 0,           // indice del departamento actual
    // Distancia a la que se cierra la carrera por haber llegado a la capital,
    // -1 mientras quede ruta. No se acaba en el propio cruce: queda un ultimo
    // tramo de ciudad, que es lo que convierte la llegada en llegada.
    finishS: -1,
    won: false,          // la carrera se cerro por llegar, no por morir
    powers: { magnet: 0, double: 0, amber: 0, flight: 0, propio: 0 },
    powerMax: { magnet: 1, double: 1, amber: 1, flight: 1, propio: 1 },
    boost: 0,            // segundos que quedan de impulso
    routePos: 0,         // en que punto de la ruta se esta; solo lo mueven los cruces
    roadS0: -1,          // trazado donde el firme cambia de departamento, -1 si no
    roadFrom: 0,         // firme que queda por detras de esa linea
    // Bifurcacion en curso. s0 es la distancia recorrida a la que empieza a
    // abrirse; mainBand dice cual de los dos ramales dibuja la calzada
    // principal, y se voltea al elegir para que el jugador siempre corra sobre
    // la malla detallada y no sobre la del ramal descartado.
    //
    // mainBand sigue al carril mientras no se ha elegido: antes del divisor
    // los dos ramales son simetricos, asi que el relevo entre las dos mallas
    // no mueve un solo pixel y el jugador corre siempre sobre la detallada.
    fork: { active: false, s0: 0, chosen: 0, mainBand: -1, blocked: 0 },
    // Cruce suave de departamento: de donde se venia y cuanto lleva.
    snapFrom: -1,
    snapT: 1,
    slopeS0: -1,         // distancia en la que empieza la bajada, -1 si no hay
    turn: { active: false, s0: 0, dir: 1 },
    turnHold: 0,         // segundos aguantando por el lado que cierra
    narrowS0: -1,        // distancia en la que empieza el estrechamiento
    // Hundimiento: mask lleva un bit por carril que se cae y free el carril por
    // el que se puede pasar. No hay reloj: cada tabla se hunde en funcion de lo
    // cerca que este el jugador de ella.
    sink: { active: false, s0: 0, mask: 0, free: 1 },
    nextTramo: 0,        // distancia a la que toca armar el proximo tramo
    lastTramo: -1,       // cual salio la vez anterior, para no repetirlo
    nextEvento: 0,       // distancia a la que toca el proximo suceso anunciado
    lastEvento: -1,      // cual salio la vez anterior, para no repetirlo
    // Suceso de zona: i es la region a la que pertenece, k lo que lleva
    // soltado, libre el carril que se respeta mientras la dureza lo permita y
    // dur lo apretado que va, de 0 a 1, segun lo avanzada que este la ruta.
    zone: { active: false, s0: 0, i: 0, k: 0, libre: 1, dur: 0, dicho: false },
    nextZone: 0,         // distancia a la que se puede armar el proximo suceso
    zoneFrom: 0,         // distancia a la que se entro en la zona actual
    nextFauna: 0,        // distancia a la que sale el proximo bicho de adorno
    nextValla: 0,        // ...y el proximo anuncio al borde de la calzada
    // 0 = cruce de destino, 1 = bifurcacion cortada. Ya no se alterna: lo
    // decide si la zona ha cumplido su tiempo. Se guarda solo para consultarlo.
    crossKind: 1,
    boostTaken: 0,       // aceleradores pisados, para la vida extra
    boostPerm: 0,        // velocidad que se queda para siempre
    hurt: 0,             // segundos que queda del destello de golpe
    hurtMax: 0.85,       // lo fuerte que entra: distingue vida de escudo
    wrongC: null,        // cruce en el que se metio por el ramal cortado
    wrongLane: 1,        // ...y el carril por el que tendria que haber ido
    nextCross: CROSS_EVERY,
    crossTaken: 0,
    lastWarn: -999,      // distancia a la que se planto la ultima senal
    // El revivir del patrocinador ya se gasto en esta carrera. Los angeles no
    // se cuentan aqui: viven en el zurron (save.angels), se compran entre
    // carreras y sobreviven a la partida.
    adUsed: false,
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
    rez: 0,              // segundos que quedan de la vuelta a la vida, 0 = normal
    out: 0,              // segundos que quedan de la animacion final, 0 = vivo
    outMax: 1,           // lo que duraba entera, para el frenado del mundo
    outKind: 0,          // 0 = se salio de la calzada, 1 = murio de un golpe
    outVX: 0,            // lo que se aleja de lado mientras cae
    outVZ: 0,            // ...y lo que sale despedido hacia la camara
    outZ: 0,             // desplazamiento acumulado hacia la camara
    push: 0,             // lo que la ventisca lo aparta de su carril
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
    combo: $('combo'), shield: $('shield'), casco: $('casco'),
    pachon: $('pachon'), pachonN: $('pachonN'),
    milestone: $('milestone'), banner: $('banner'),
    speedVeil: $('speedVeil'), hitVeil: $('hitVeil'), pauseBtn: $('pauseBtn'),
    menuRoute: $('menuRoute'), menuBank: $('menuBank'), menuBest: $('menuBest'),
    shopBank: $('shopBank'), tabSkins: $('tabSkins'), tabUpg: $('tabUpg'), tabRoute: $('tabRoute'),
    minimap: $('minimap'), mmDots: $('mmDots'), mmRoute: $('mmRoute'),
    mmYou: $('mmYou'),
    mmName: $('mmName'), mmDept: $('mmDept'), mmFill: $('mmFill'),
    mmZone: $('mmZone'), mmGoal: $('mmGoal'),
    dbg: $('dbg'), dbgInfo: $('dbgInfo'), dbgGod: $('dbgGod'), dbgSlow: $('dbgSlow'),
    revive: $('revive'), reviveBtn: $('reviveBtn'), reviveSkip: $('reviveSkip'),
    angelBtn: $('angelBtn'), reviveAd: $('reviveAd'),
    reviveTimer: $('reviveTimer'), reviveSub: $('reviveSub'),
    shortHost: $('shortHost'), shortFallback: $('shortFallback'),
    sponsorMenu: $('sponsorMenu'), sponsorOver: $('sponsorOver'),
    sponsorRevive: $('sponsorRevive'),
    powers: $('powers'),
    pw: {
        magnet: $('pwMagnet'), flight: $('pwFlight'),
        double: $('pwDouble'), amber: $('pwAmber'), boost: $('pwBoost'),
        propio: $('pwPropio')
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
    angels: 0,          // angeles de la guarda en el zurron, 0..ANGEL_MAX
    // Ya no se guarda la salida: la ruta es una y empieza en Tikal. Elegir por
    // donde entrar rompia lo unico que el mapa tenia que decir, que es cuanto
    // te falta para la capital.
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
    // Con tope y suelo: es un contador de consumibles, y un localStorage
    // retocado a mano no debe poder regalar cien vidas ni dejarlo en -3.
    save.angels = Math.max(0, Math.min(ANGEL_MAX,
        parseInt(store.get('sacbe-angels', '0'), 10) || 0));
    const s = store.get('sacbe-sound', null);
    save.sound = s === null ? true : s === '1';
    const m = store.get('sacbe-music', null);
    save.music = m === null ? true : m === '1';

    // Saneado: un localStorage manipulado a mano no debe romper el arranque
    if (!SKINS.some(s2 => s2.id === save.skin)) save.skin = 'ajaw';
    if (!save.skins.includes('ajaw')) save.skins.push('ajaw');
    if (!save.regions.includes('tikal')) save.regions.push('tikal');
    // Un guardado de la version anterior puede traer ids que ya no existen
    save.regions = save.regions.filter(id => REGIONS.some(R => R.id === id));
}

function persist() {
    store.set('sacbe-best', String(save.best));
    store.set('sacbe-bank', String(save.bank));
    store.set('sacbe-upg', JSON.stringify(save.upg));
    store.set('sacbe-skin', save.skin);
    store.set('sacbe-skins', JSON.stringify(save.skins));
    store.set('sacbe-regions', JSON.stringify(save.regions));
    store.set('sacbe-angels', String(save.angels));
}

// --- Lo que cada mejora hace, en un solo sitio ---
const lvl = id => save.upg[id] || 0;
const maxLives = () => START_LIVES + lvl('lives');
// Con suelo: la mejora de agilidad al maximo y la patineta encima dejarian el
// cambio de carril en cuatro centesimas, que a esa velocidad es teletransporte
// y el jugador deja de ver por donde ha pasado.
const laneTime = () =>
    Math.max(0.055, (LANE_TIME - lvl('agility') * 0.021) * dote().carril);
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
let powerAura, powerOrbs;
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
const fauna = [];                   // peces y aves: adorno, no golpean
let gate = null;                    // la estructura de fin de zona, una sola
let rezBeam = null;                 // la columna de luz de la vuelta a la vida

// Geometria unica compartida por todo el escenario
const BOX = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

// Geometrias de las recogidas, una por tipo
const GEO = {
    jade:   new THREE.OctahedronGeometry(0.42),
    // La gota del runner. Redonda a proposito: la piedra de jade es un rombo de
    // aristas duras, y lo que tiene que decir esta a la velocidad a la que se
    // ve es "esto NO es lo de antes". Redondo y azul no se confunde con
    // facetado y verde ni de refilon.
    gota:   new THREE.SphereGeometry(0.38, 9, 7),
    shield: new THREE.TorusGeometry(0.44, 0.15, 6, 12),
    magnet: new THREE.TorusGeometry(0.42, 0.14, 6, 10, Math.PI),
    double: new THREE.IcosahedronGeometry(0.44),
    amber:  new THREE.DodecahedronGeometry(0.42),
    flight: new THREE.ConeGeometry(0.4, 0.95, 4),
    // El poder propio: un tetraedro, que es la unica forma de la lista con una
    // punta hacia arriba y tres caras. No se parece a ninguna de las otras
    // cinco, que es lo unico que se le pide a la pieza de un poder.
    propio: new THREE.TetrahedronGeometry(0.52)
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

let warnMesh;
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
    rezBeam = makeRezBeam();
    applyBlend(0);
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

    // Lava. Tampoco se tine con la zona, y por el mismo motivo que las
    // senales: una bomba volcanica que cambiase de color con el departamento
    // dejaria de leerse como algo que quema. Emisiva, o en las zonas de noche
    // -que son justo las de los dos volcanes- se veria como una piedra gris.
    mat.ember     = lam(0x8a2408, { emissive: 0xd4451f, emissiveIntensity: 0.85 });
    mat.emberCore = lam(0xff9a3c, { emissive: 0xffb04a, emissiveIntensity: 1.15 });

    // La fauna de adorno. Tampoco se tine con la zona: un pez plateado es
    // plateado en el Petén y en Izabal, y lo que tiene que decir es "esto esta
    // vivo y no te va a hacer nada", no de que departamento es.
    mat.fishBody  = lam(0xc8d8e0);
    mat.fishFin   = lam(0x6f9fb8);
    mat.bird      = lam(0x2b3138);

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
    mat.gota = lam(0x8fd8ee, { emissive: 0x3fa8d0, emissiveIntensity: 0.35 });
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
    // El otro ramal. Lleva el mismo despiece que la calzada principal, mas la
    // sub-base y los dos bordillos.
    forkMesh = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }),
        TILE_COUNT * FORK_CELLS
    );
    forkMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * FORK_CELLS * 3), 3
    );
    forkMesh.frustumCulled = false;
    for (let i = 0; i < TILE_COUNT * FORK_CELLS; i++) {
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

    // Pintura del carril que la curva se lleva por delante. Va justo por
    // encima de la cara de la losa, nunca al ras: dos caras en el mismo plano
    // pelean por el pixel y el resultado es una franja que parpadea.
    warnMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshBasicMaterial({
            color: WARN_LANE_RGB, transparent: true, opacity: 0, depthWrite: false
        }),
        TILE_COUNT * 3
    );
    warnMesh.frustumCulled = false;
    warnMesh.renderOrder = 1;
    roadGroup.add(warnMesh);
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

// Medio reparto: cuanto se ha abierto ya la bifurcacion en una coordenada de
// trazado. Cero hasta la cola del divisor y creciendo despues.
//
// Un smoothstep, y ahora si: entra y sale con pendiente cero —el desvio empalma
// con la recta de antes y con la de despues sin un solo pico— y en el medio
// alcanza exactamente pendiente 1, porque FORK_LEN vale 1,5 x FORK_SPREAD. Los
// perfiles anteriores repartian la separacion a lo largo de cien unidades o
// mas, y eso no es un desvio: es una carretera doblandose despacio.
function forkSpread(s) {
    const f = game.fork;
    if (!f.active) return 0;
    const t = (s - f.s0) / FORK_LEN;
    if (t <= 0) return 0;
    if (t >= 1) return FORK_SPREAD;
    return FORK_SPREAD * t * t * (3 - 2 * t);
}

// Lo inclinada que va la calzada de un ramal respecto al eje del mundo, en
// unidades de lado por unidad de avance: la derivada de lo anterior. Vale 1 en
// el punto mas cerrado del desvio, que es la tangente de 45 grados.
//
// Es lo que endereza las losas. Sin ella, una calzada que se va un metro de
// lado por cada metro de avance se dibuja como una escalera de bloques
// solapados con el bordillo en zigzag, porque las losas son cajas alineadas
// con los ejes del mundo. Con ella, cada losa se gira y se estira para que el
// firme se lea como lo que es: una carretera que sale en diagonal.
function forkSlope(s, band) {
    const f = game.fork;
    if (!f.active) return 0;
    const t = (s - f.s0) / FORK_LEN;
    if (t <= 0 || t >= 1) return 0;
    return band * FORK_SPREAD * 6 * t * (1 - t) / FORK_LEN;
}

// El giro que le toca a un tramo de calzada por ir en diagonal, y lo que hay
// que estirarle el paso para que las losas sigan juntandose. Se devuelven los
// tres numeros de golpe porque los cuatro sitios que dibujan calzada los
// necesitan los tres.
// El giro que le toca a la CAMARA y al personaje: el mismo que lleva la
// calzada justo debajo de los pies del jugador.
//
// Sin esto un desvio de 45 grados no se puede hacer. El mundo se recoloca de
// modo que la calzada elegida siempre pasa por debajo del jugador, asi que un
// desvio pronunciado se veria como la carretera cruzandosele en diagonal
// mientras el sigue mirando al frente: patinando de lado, no girando. Girando
// la camara con la calzada, lo que se ve es lo contrario y lo correcto: el
// personaje tuerce y el mundo entero rota a su alrededor.
//
// Y de paso resuelve lo otro: el ramal descartado sale del encuadre por el
// lado durante el giro, en vez de quedarse en el centro de la pantalla justo
// cuando deja de dibujarse.
function forkCamYaw() {
    const f = game.fork;
    if (!f.active) return 0;
    return -Math.atan(forkSlope(game.distance, f.mainBand));
}

const _yaw = { ang: 0, ca: 1, sa: 0, zst: 1 };
function forkYawAt(s, band) {
    const m = forkSlope(s, band);
    if (m === 0) {
        _yaw.ang = 0; _yaw.ca = 1; _yaw.sa = 0; _yaw.zst = 1;
        return _yaw;
    }
    _yaw.ang = -Math.atan(m);
    _yaw.ca = Math.cos(_yaw.ang);
    _yaw.sa = Math.sin(_yaw.ang);
    _yaw.zst = Math.sqrt(1 + m * m);
    return _yaw;
}

// Desplazamiento lateral de un ramal en la z dada. Son dos terminos y cada uno
// hace una cosa distinta.
//
// El primero, `band * S(s)`, abre los dos ramales por igual a partir del
// divisor. Antes de elegir es lo unico que hay: una Y simetrica, las dos
// opciones puestas encima de la mesa.
//
// El segundo, `- chosen * S(D)`, es el que convierte la eleccion en una CURVA.
// Al restar la separacion del ramal elegido MEDIDA EN LA POSICION DEL JUGADOR,
// el mundo se recoloca sobre esa calzada: le pasa siempre por debajo de los
// pies —a su altura los dos terminos se cancelan— pero por delante se va
// abriendo, o sea que se ve TORCER hacia el lado que tomo. Y el otro ramal,
// que tiene el signo contrario en los dos terminos, hace la curva simetrica
// hacia el lado opuesto y se va por ahi. No se le empuja fuera de plano: se
// marcha porque es una carretera que va a otro sitio, que es lo que es.
//
// El salto de este termino cuando se toma la salida sale gratis porque la
// bifurcacion empieza justo en la cola del divisor, o sea exactamente donde se
// resuelve: ahi S(D) todavia vale cero y encenderlo no mueve nada.
function forkDX(z, band) {
    const f = game.fork;
    if (!f.active) return 0;
    return band * forkSpread(game.distance - z) -
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

// --- Hundimiento ---
// Cuanto ha caido ya la tabla de este carril en esta coordenada de trazado:
// -1 si ahi no hay hundimiento, 0 mientras aguanta, 1 cuando ya no hay suelo.
//
// Cada tabla lleva su propio reloj, y ese reloj es la distancia que le queda al
// jugador para llegar a ELLA. Con un reloj unico para todo el tramo, las
// treinta y cuatro unidades se desplomaban a la vez y el agujero estaba abierto
// y quieto mucho antes de pisarlo. Asi la rotura avanza hacia el jugador y el
// suelo se sigue cayendo a pocos metros por delante hasta el ultimo momento.
function sinkFall(sc, lane) {
    const S = game.sink;
    if (!S.active || !(S.mask & (1 << lane))) return -1;
    if (sc < S.s0 || sc > S.s0 + SINK_LEN) return -1;
    const d = game.distance - (sc - SINK_TRIGGER);
    if (d <= 0) return 0;
    return Math.min(1, d / SINK_DROP);
}

// Ahi ya no hay nada sobre lo que correr.
function sinkHole(sc, lane) { return sinkFall(sc, lane) >= 1; }

// Que tabla pisa una x dada. No se usa player.lane: a media pasada de carril
// el cuerpo esta ya sobre la de al lado, y lo que decide es donde estan los
// pies, no a que carril apunta la ultima tecla.
function sinkSlabAt(x) { return x < -SINK_W / 2 ? 0 : (x > SINK_W / 2 ? 2 : 1); }

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

// Cae este punto de la cuneta encima del OTRO ramal? El matorral se coloca
// respecto al eje de la calzada que pisa el jugador, y a partir del divisor el
// otro ramal le pasa por encima: se veian pinos creciendo en mitad del asfalto
// del camino que no habias tomado. Lo que hay ENTRE los dos ramales si se
// queda —una cuna de monte entre dos carreteras que se separan es justo lo que
// hay en una bifurcacion de verdad—; lo que se quita es lo que estorba.
function overOtherFork(x, z) {
    const f = game.fork;
    if (!f.active || !pastFork(z)) return false;
    const otro = (curveX(game.distance - z) - game.curveBase) * curveMask(z) +
                 forkDX(z, -f.mainBand);
    return Math.abs(x - otro) < ROAD_WIDTH / 2 + 1.4;
}

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
// Carriles marcados en rojo en cada losa, un bit por carril. Va aparte de la
// region porque cambia por otro motivo, y como el repintado solo ocurre cuando
// alguno de los dos se mueve, marcar la curva no cuesta un solo color de mas
// por frame.
const roadTileWarn = new Int8Array(TILE_COUNT);
const _rw = new THREE.Color();
let warnAny = false;
// El carril se marca con una franja PROPIA por encima del firme, como una
// pintura de carretera, y no tinendo las piedras de la calzada.
//
// Tenirlas fue el primer intento y no vale: el despiece cambia por zona y en
// Tikal la losa es UNA sola pieza de lado a lado —medido, cuts = 1—, asi que
// no hay ninguna celda que coincida con un carril y la marca no salia. Una
// franja propia mide lo que tiene que medir en las doce zonas.
const WARN_LANE_RGB = 0xd42a2a;
const WARN_LANE_W = 2.5;            // algo menos que el carril, para que se vea el borde
// A partir de que agarre de la curva se pinta. Va por debajo del 0,25 que
// dispara la fuerza centrifuga, para que la marca este PUESTA cuando el carril
// empieza a matar y no aparezca a la vez.
const WARN_LANE_GRIP = 0.16;

// Que carril hay que marcar en un punto del trazado, o -1 si ninguno.
//
// El de FUERA. La calzada cierra hacia game.turn.dir, asi que la inercia
// empuja hacia el contrario: por ahi es por donde se sale uno. Marcar el de
// dentro —que es lo que hacia— senalaba justo el carril seguro.
function warnLaneAt(sc) {
    if (!game.turn.active) return -1;
    if (turnGrip(sc) < WARN_LANE_GRIP) return -1;
    return game.turn.dir < 0 ? 2 : 0;
}
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

        const sWorld = game.distance - zWorld;
        const ri = roadRegionOf(sWorld);
        const R = REGIONS[ri];
        // El carril que la curva se va a llevar por delante, pintado de rojo.
        // Es la unica marca del juego que dice "no estes AQUI" en vez de
        // "cuidado con eso": la senal avisa de que viene una curva, pero solo
        // el suelo puede decir cual de los tres carriles es el que te tira.
        const wl = warnLaneAt(sWorld);
        const sf0 = sinkFall(sWorld, 0);
        const sf1 = sinkFall(sWorld, 1);
        const sf2 = sinkFall(sWorld, 2);
        const enSink = sf0 >= 0 || sf1 >= 0 || sf2 >= 0;
        // El despiece cambia dentro del hundimiento, asi que el estado entra
        // en la cache de color: al entrar y al salir del tramo hay que
        // repintar, o las tablas saldrian con el color de la losa anterior.
        const warn = (wl < 0 ? 0 : 1 << wl) | (enSink ? 8 : 0);
        const recolor = roadTileRegion[i] !== ri || roadTileWarn[i] !== warn;
        if (recolor) {
            roadTileRegion[i] = ri;
            roadTileWarn[i] = warn;
            colorDirty = true;
        }
        const cuts = R.road[0], rows = R.road[1], gap = R.road[2], jit = R.road[3];
        const cw = ROAD_WIDTH / cuts;
        const cd = TILE_DEPTH / rows;
        // Ancho que queda en pie. La piedra no se encoge: se RECORTA contra el
        // borde. Escalarla habria hecho que el firme se estrechase de tamano
        // en vez de acabarse, y lo que hay que leer ahi es que la calzada se
        // acaba, no que las piedras son mas pequenas.
        const halfW = ROAD_WIDTH * narrowAt(game.distance - zWorld) / 2;

        // Enderezado del desvio. En una recta vale identidad y no cuesta nada;
        // dentro de la bifurcacion gira cada losa para que apunte adonde va la
        // calzada, corre las celdas y los bordillos por la PERPENDICULAR al
        // trazado en vez de por la x del mundo, y estira el paso para que las
        // losas sigan juntandose. Sin esto una calzada a 45 grados sale como
        // una escalera de bloques solapados con el bordillo en zigzag.
        const yw = forkYawAt(sWorld, game.fork.mainBand);

        if (enSink) {
            // Dentro del hundimiento la calzada se dibuja en tres tablas
            // iguales, una por carril, y cada una cae por su cuenta. Es la
            // unica forma de tirar un tercio del firme: el despiece de la zona
            // no se alinea con los carriles —en Tikal es una pieza unica— y
            // ninguna celda coincidiria con lo que hay que hundir.
            for (let l = 0; l < 3; l++) {
                const id = i * ROAD_CELLS + l;
                const pf = l === 0 ? sf0 : (l === 1 ? sf1 : sf2);
                if (pf >= 1) {
                    if (roadCellOn[id]) { roadCellOn[id] = 0; hideAt(roadMesh, id); }
                    continue;
                }
                // Al cuadrado: la tabla arranca despacio y se desploma. Lineal
                // parecia una plataforma bajando, no un suelo que se rompe.
                const cai = pf > 0 ? pf * pf : 0;
                dummy.position.set(
                    dx + SINK_X[l], -0.5 + dy - cai * SINK_DEEP, zLocal
                );
                dummy.scale.set(SINK_W * 0.97, 1, TILE_DEPTH * 0.97);
                // Y se vuelca hacia fuera mientras cae: una tabla que baja
                // recta se lee como un ascensor.
                dummy.rotation.set(0, 0, cai * 0.5 * (l === 2 ? -1 : 1));
                dummy.updateMatrix();
                roadMesh.setMatrixAt(id, dummy.matrix);
                if (recolor) {
                    roadMesh.setColorAt(id, _rc.setHex((i + l) % 2 ? R.roadA : R.roadB));
                }
                roadCellOn[id] = 1;
            }
            for (let cc = 3; cc < ROAD_CELLS; cc++) {
                const id = i * ROAD_CELLS + cc;
                if (!roadCellOn[id]) continue;
                roadCellOn[id] = 0;
                hideAt(roadMesh, id);
            }
            // La sub-base es una pieza de lado a lado, asi que aqui taparia el
            // agujero desde abajo. Se quita entera: lo que queda de calzada son
            // tablas de una unidad de canto y se leen solas.
            hideAt(baseMesh, i);
        } else {
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
                            // Se salta el repintado, asi que hay que invalidar
                            // la cache: si el firme cambia de departamento
                            // mientras esta escondida, al reaparecer llevaria
                            // el color de la region anterior para siempre.
                            roadTileRegion[i] = -1;
                        }
                        continue;
                    }
                    // Desnivel de piedra a piedra, determinista por indice: si
                    // fuera aleatorio por frame la calzada herviria.
                    const bump = jit ? (((i * 7 + c * 13) % 7) - 3) / 3 * jit : 0;
                    const u = (x0 + x1) / 2;
                    dummy.position.set(
                        dx + u * yw.ca,
                        -0.5 + dy + bump,
                        zLocal - TILE_DEPTH / 2 + cd * (rr + 0.5) + u * yw.sa
                    );
                    dummy.scale.set((x1 - x0) * gap, 1, cd * gap * yw.zst);
                    dummy.rotation.set(0, yw.ang, 0);
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
                hideAt(roadMesh, id);
            }

            // Sub-base, con el tono de la losa oscura bajado a la mitad: lo
            // que se ve por las juntas es sombra de junta, no jungla.
            dummy.position.set(dx, -0.62 + dy, zLocal);
            dummy.scale.set(halfW * 2, 1, TILE_DEPTH * yw.zst);
            dummy.rotation.set(0, yw.ang, 0);
            dummy.updateMatrix();
            baseMesh.setMatrixAt(i, dummy.matrix);
            if (recolor) baseMesh.setColorAt(i, _rc.setHex(R.roadB).multiplyScalar(0.55));
        }

        // --- Pintura de aviso ---
        // El carril que la curva se va a llevar por delante, y los que se
        // estan a punto de hundir. Es la unica marca del juego que dice "no
        // estes AQUI" en vez de "cuidado con eso": el cartel avisa de que viene
        // una curva o un hueco, pero solo el suelo puede decir cual de los tres
        // carriles es el que te tira.
        for (let l = 0; l < 3; l++) {
            const mid = i * 3 + l;
            const pf = enSink ? (l === 0 ? sf0 : (l === 1 ? sf1 : sf2)) : -1;
            // La marca vive con la tabla: cuando ya no hay suelo tampoco hay
            // nada sobre lo que pintar, y el agujero se explica solo.
            if (l !== wl && !(pf >= 0 && pf < 1)) { hideAt(warnMesh, mid); continue; }
            warnAny = true;
            const cai = pf > 0 ? pf * pf : 0;
            const ul = pf >= 0 ? SINK_X[l] : LANE_X[l];
            dummy.position.set(
                dx + ul * yw.ca,
                0.03 + dy - cai * SINK_DEEP,
                zLocal + ul * yw.sa
            );
            dummy.scale.set(
                pf >= 0 ? SINK_W * 0.9 : WARN_LANE_W, 0.05, TILE_DEPTH * 0.96 * yw.zst
            );
            dummy.rotation.set(0, yw.ang, cai * 0.5 * (l === 2 ? -1 : 1));
            dummy.updateMatrix();
            warnMesh.setMatrixAt(mid, dummy.matrix);
        }

        for (let sd = 0; sd < 2; sd++) {
            // Dentro del hundimiento el bordillo se va con SU carril: dejarlo
            // en pie al borde del agujero lo convertiria en una cornisa por la
            // que parece que se puede pasar.
            const kp = enSink ? (sd ? sf2 : sf0) : -1;
            if (kp >= 1) { hideAt(kerbMesh, i * 2 + sd); continue; }
            const kc = kp > 0 ? kp * kp : 0;
            const uk = sd ? halfW : -halfW;
            dummy.position.set(
                dx + uk * yw.ca, -0.1 + dy - kc * SINK_DEEP, zLocal + uk * yw.sa
            );
            dummy.scale.set(0.55, 0.8, TILE_DEPTH * 0.94 * yw.zst);
            dummy.rotation.set(0, yw.ang, kc * 0.5 * (sd ? -1 : 1));
            dummy.updateMatrix();
            kerbMesh.setMatrixAt(i * 2 + sd, dummy.matrix);
            if (recolor) {
                _rc.setHex(R.kerb);
                // El bordillo de ese lado tambien: a cien unidades la calzada
                // mide cuatro pixeles de ancho y lo unico que se distingue del
                // carril es su borde.
                if (wl >= 0 && (sd === 1) === (wl === 2)) {
                    _rc.lerp(_rw.setHex(WARN_LANE_RGB), 0.75);
                }
                kerbMesh.setColorAt(i * 2 + sd, _rc);
            }
        }
    }
    updateForkBand(off);

    // La pintura late despacio. Un rojo fijo se lee como parte del decorado de
    // la zona; latiendo se lee como un aviso, que es lo que es.
    warnMesh.instanceMatrix.needsUpdate = true;
    // La curva late despacio; el hundimiento PARPADEA, encendido y apagado, que
    // es lo que se lee como cuenta atras. Los dos tramos no coinciden nunca
    // —trackBusy no deja armar uno con el otro puesto—, asi que un solo
    // material puede servir a los dos.
    warnMesh.material.opacity = !warnAny ? 0
        : game.sink.active
            ? (Math.sin(game.elapsed * 11) > 0 ? 0.88 : 0.22)
            : 0.5 + Math.sin(game.elapsed * 5.5) * 0.16;
    warnAny = false;

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
    roadTileWarn.fill(0);
}

// El ramal que no se ha tomado. Solo existe pasada la cola del divisor: antes
// de ella la calzada es una sola y no hay dos ramales que dibujar.
let forkBandOn = false;

function updateForkBand(off) {
    const f = game.fork;
    const band = -f.mainBand;

    if (!f.active) {
        if (forkBandOn) {
            forkBandOn = false;
            for (let k = 0; k < TILE_COUNT * FORK_CELLS; k++) hideAt(forkMesh, k);
            forkMesh.instanceMatrix.needsUpdate = true;
        }
        return;
    }
    forkBandOn = true;

    // Lo que ya lleva hundido. Arranca justo cuando el desvio termina de
    // abrirse y llega al fondo exactamente cuando la bifurcacion caduca, de
    // modo que al dejar de dibujarse ya estaba debajo del suelo.
    const fin = f.s0 + FORK_LEN + 40;
    const bajo = Math.max(0, Math.min(1,
        (game.distance - (fin - FORK_SINK)) / FORK_SINK)) * FORK_SINK_DEEP;

    for (let i = 0; i < TILE_COUNT; i++) {
        const zLocal = ROAD_FROM + i * TILE_DEPTH;
        const zWorld = zLocal + off;
        const base = i * FORK_CELLS;

        // Fuera de la bifurcacion, o dentro de un vacio, este ramal no existe
        if (!pastFork(zWorld) || inGap(zWorld)) {
            for (let k = 0; k < FORK_CELLS; k++) hideAt(forkMesh, base + k);
            continue;
        }

        const sWorld = game.distance - zWorld;
        const curve = (curveX(sWorld) - game.curveBase) * curveMask(zWorld);
        const dx = curve + forkDX(zWorld, band);
        const dy = riseAtS(sWorld, zWorld) - bajo;
        const R = REGIONS[roadRegionOf(sWorld)];

        // --- Recorte contra la calzada principal ---
        // Junto al divisor las dos calzadas caerian una encima de la otra: la
        // separacion vale cero ahi y crece hacia el fondo, asi que durante las
        // primeras decenas de unidades sus centros estan a menos de lo que
        // miden de ancho. Este ramal se corta contra el bordillo del otro —con
        // FORK_GAP de aire— y crece hacia fuera segun se abren. Nace como una
        // franja pegada al borde y acaba siendo una calzada entera: eso se lee
        // como un camino que se separa, no como dos capas superpuestas.
        const mainX = curve + forkDX(zWorld, f.mainBand);
        const outer = dx + band * ROAD_WIDTH / 2;
        let inner = dx - band * ROAD_WIDTH / 2;
        const lim = mainX + band * (ROAD_WIDTH / 2 + FORK_GAP);
        if ((lim - inner) * band > 0) inner = lim;
        // Nada que dibujar: o el recorte se lo ha comido entero —esta pegado al
        // otro, justo detras del divisor— o ya se fue tan de lado que no cabe
        // en pantalla. El limite se abre con la distancia porque el encuadre
        // tambien se abre: a la altura del jugador, el ramal descartado se sale
        // de plano a doce unidades, y a ciento cincuenta por delante esas mismas
        // veintiseis unidades siguen viendose perfectamente. Comparar contra un
        // numero fijo habria borrado justo la parte que hay que ver marcharse.
        const cabe = FORK_CULL - zWorld * 0.5;
        if ((outer - inner) * band < 0.2 ||
            Math.min(Math.abs(inner), Math.abs(outer)) > cabe) {
            for (let k = 0; k < FORK_CELLS; k++) hideAt(forkMesh, base + k);
            continue;
        }
        const lo = Math.min(inner, outer), hi = Math.max(inner, outer);

        // Este ramal se va por el otro lado, asi que se endereza con SU propia
        // pendiente: el descartado sale girado al reves que el tomado, y verlos
        // salir en aspa es la mitad de lo que hace legible el cruce.
        const yw = forkYawAt(sWorld, band);
        dummy.rotation.set(0, yw.ang, 0);

        // Mismo despiece que la calzada principal, y anclado a SU eje: las
        // juntas tienen que caer donde caerian si el ramal fuera entero, o al
        // ensancharse el adoquin se veria deslizarse de lado.
        const cuts = R.road[0], rows = R.road[1], gap = R.road[2], jit = R.road[3];
        const cw = ROAD_WIDTH / cuts;
        const cd = TILE_DEPTH / rows;
        let c = 0;
        for (let rr = 0; rr < rows; rr++) {
            for (let cc = 0; cc < cuts; cc++, c++) {
                const id = base + c;
                let x0 = dx - ROAD_WIDTH / 2 + cw * cc;
                let x1 = x0 + cw;
                if (x0 < lo) x0 = lo;
                if (x1 > hi) x1 = hi;
                if (x1 - x0 < 0.03) { hideAt(forkMesh, id); continue; }
                const bump = jit ? (((i * 7 + c * 13) % 7) - 3) / 3 * jit : 0;
                const u = (x0 + x1) / 2 - dx;
                dummy.position.set(
                    dx + u * yw.ca,
                    -0.5 + dy + bump,
                    zLocal - TILE_DEPTH / 2 + cd * (rr + 0.5) + u * yw.sa
                );
                dummy.scale.set((x1 - x0) * gap, 1, cd * gap * yw.zst);
                dummy.rotation.set(0, yw.ang, 0);
                dummy.updateMatrix();
                forkMesh.setMatrixAt(id, dummy.matrix);
                forkMesh.setColorAt(id, _rc.setHex((i + cc + rr) % 2 ? R.roadA : R.roadB));
            }
        }
        for (; c < ROAD_CELLS; c++) hideAt(forkMesh, base + c);

        const ub = (lo + hi) / 2 - dx;
        dummy.position.set(dx + ub * yw.ca, -0.62 + dy, zLocal + ub * yw.sa);
        dummy.scale.set(hi - lo, 1, TILE_DEPTH * yw.zst);
        dummy.rotation.set(0, yw.ang, 0);
        dummy.updateMatrix();
        forkMesh.setMatrixAt(base + ROAD_CELLS, dummy.matrix);
        forkMesh.setColorAt(base + ROAD_CELLS, _rc.setHex(R.roadB).multiplyScalar(0.55));

        // Bordillo a los dos bordes, incluido el recortado: ahi la calzada se
        // acaba de verdad, y un canto es justo lo que dice donde acaba.
        for (let sd = 0; sd < 2; sd++) {
            const uk = (sd ? hi : lo) - dx;
            dummy.position.set(dx + uk * yw.ca, -0.1 + dy, zLocal + uk * yw.sa);
            dummy.scale.set(0.55, 0.8, TILE_DEPTH * 0.94 * yw.zst);
            dummy.rotation.set(0, yw.ang, 0);
            dummy.updateMatrix();
            forkMesh.setMatrixAt(base + ROAD_CELLS + 1 + sd, dummy.matrix);
            forkMesh.setColorAt(base + ROAD_CELLS + 1 + sd, _rc.setHex(R.kerb));
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
            // Una de cada tres ranuras es una CEIBA EMERGENTE: mismo
            // presupuesto de tres cubos, mas del doble de alta. La selva de
            // Peten no es un seto de altura constante, y eso era justo lo que
            // se veia desde la calzada: una pared verde plana a los dos lados,
            // igual de alta cada dos metros durante doce minutos. Rota por
            // arboles que se salen del dosel, la cuneta pasa a tener fondo.
            if (v > 0.66) {
                put(0, 0, 3.6 * t, 0, 0.62, 7.2 * t, 0.62, 0, 1);           // tronco
                put(1, 0, 7.5 * t, 0, 4.8 * t, 0.95 * t, 4.8 * t, 0, 0);    // copa plana
                put(2, 0.8 * t, 1.5 * t, -0.4, 2.4 * t, 3.0 * t, 2.4 * t, 0, 0);
                break;
            }
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
            // Una de cada tres es un PAREDON de caliza con monte encima. Los
            // tres discos planos de siempre no pasaban de 2,2 de alto —cuando
            // todo lo demas del juego anda entre 3 y 5— asi que la cuneta de
            // Semuc era una alfombra y la calzada parecia cruzar un prado
            // abierto. Semuc es un CANON: lo que tiene que haber a los lados es
            // pared, y el helecho al pie de ella.
            if (v > 0.66) {
                put(0, 0, 2.9 * t, 0, 2.2 * t, 5.8 * t, 1.8 * t, 0.06, 1);
                put(1, 0.3, 6.0 * t, 0.2, 2.0 * t, 0.5 * t, 1.6 * t, -0.1, 0);
                put(2, -0.9, 0.5 * t, 0.4, 1.6 * t, 0.3, 1.6 * t, 0.14, 0);
                break;
            }
            put(0, 0, 0.5 * t, 0, 2.4 * t, 0.35, 2.4 * t, 0.1, 0);
            put(1, 0.4, 1.0 * t, 0.2, 1.8 * t, 0.3, 1.8 * t, -0.14, 0);
            put(2, -0.4, 1.4 * t, -0.3, 1.2 * t, 0.28, 1.2 * t, 0.2, 1);
            break;
        case 'palm':
            put(0, 0, 2.4 * t, 0, 0.42, 4.8 * t, 0.42, 0.08, 0);
            put(1, -1.2 * t, 4.7 * t, 0, 2.6 * t, 0.3, 1.0, -0.3, 1);
            put(2, 1.2 * t, 4.7 * t, 0.2, 2.6 * t, 0.3, 1.0, 0.3, 1);
            break;
        case 'mangrove':
            // La orilla del Río Dulce no es playa de palmeras —eso es
            // Monterrico, y era literalmente el mismo matorral— sino MANGLE, y
            // el mangle se reconoce por una sola cosa: parece estar de pie
            // sobre el agua, sobre raices en zanco que salen del tronco por
            // encima de la superficie. Dos zancos abiertos y una copa baja y
            // ancha, con el mismo presupuesto de tres cubos.
            put(0, -0.5, 1.0 * t, 0.2, 0.26, 2.0 * t, 0.26, 0.42, 0);
            put(1, 0.6, 1.0 * t, -0.2, 0.26, 2.0 * t, 0.26, -0.38, 0);
            put(2, 0, 2.9 * t, 0, 3.4 * t, 1.9 * t, 3.0 * t, 0, 1);
            break;
        case 'agave':
            // Una de cada tres es un CACTUS DE CANDELABRO. El agave es planta
            // de suelo y no pasaba de 3,2 de alto, asi que el corredor seco de
            // Chiquimula salia como una pradera rapada. Lo que sobresale de
            // verdad ahi es el cactus columnar, que llega a los cinco o seis
            // metros y no se parece a nada mas del recorrido.
            if (v > 0.66) {
                put(0, 0, 2.2 * t, 0, 0.62, 4.4 * t, 0.62, 0, 0);       // tronco
                put(1, -0.85, 3.0 * t, 0, 0.5, 2.2 * t, 0.5, 0.22, 0);  // brazo
                put(2, 0.85, 3.4 * t, 0.2, 0.5, 2.6 * t, 0.5, -0.2, 0); // brazo
                break;
            }
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
            // Una de cada tres es un TRONCO QUEMADO de pie. La colada es baja
            // por naturaleza —es roca derramada— y por eso la cuneta del Fuego
            // era la mas rasa de la ruta, dos unidades. Lo que queda de pie
            // despues de una erupcion son los arboles muertos, y ademas dicen
            // lo que acaba de pasar ahi mejor que ninguna otra cosa.
            if (v > 0.66) {
                put(0, 0, 2.6 * t, 0, 0.44, 5.2 * t, 0.44, 0.05, 0);
                put(1, 0.7 * t, 4.2 * t, 0.2, 1.5 * t, 0.22, 0.4, -0.25, 0);
                put(2, -0.6 * t, 3.4 * t, -0.2, 1.2 * t, 0.2, 0.4, 0.3, 0);
                break;
            }
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
            // Una de cada tres lleva el PALO CON EL TOLDO ALTO. Los puestos son
            // bajos por naturaleza, pero el mercado de Chichi se arma con varas
            // largas y lonas tendidas por encima de todo, y de noche eso es lo
            // unico que se recorta contra el cielo.
            if (v > 0.66) {
                put(0, -1.0, 2.1 * t, 0, 0.22, 4.2 * t, 0.22, 0, 0);
                put(1, 1.0, 2.1 * t, 0.2, 0.22, 4.2 * t, 0.22, 0, 0);
                put(2, 0, 4.4 * t, 0.1, 3.4 * t, 0.34, 2.6 * t, 0.1, 1);
                break;
            }
            put(0, 0, 0.9 * t, 0, 0.28, 1.8 * t, 0.28, 0, 1);
            put(1, 0, 2.0 * t, 0, 2.8 * t, 0.3, 2.4 * t, 0.14, 0);
            put(2, 0.3, 0.5 * t, 0.4, 1.2 * t, 1.0 * t, 1.0 * t, 0, 1);
            break;
        case 'block':
            // Manzana de ciudad: bloque, cornisa encendida y un anexo bajo. Lo
            // que hay al borde de la calzada en la capital no crece, se
            // construye, asi que ni una sola pieza va girada.
            put(0, 0, 1.9 * t, 0, 2.2 * t, 3.8 * t, 2.2 * t, 0, 0);
            put(1, 0, 3.95 * t, 0, 1.6 * t, 0.32 * t, 1.6 * t, 0, 1);
            put(2, 1.7 * t, 0.8 * t, 0.5, 1.1 * t, 1.6 * t, 1.1 * t, 0, 0);
            break;
        case 'pine':
            put(0, 0, 0.9 * t, 0, 0.4, 1.8 * t, 0.4, 0, 1);
            put(1, 0, 2.6 * t, 0, 2.4 * t, 2.0 * t, 2.4 * t, 0, 0);
            put(2, 0, 4.2 * t, 0, 1.4 * t, 1.6 * t, 1.4 * t, 0, 0);
            break;
        default:   // rock
            // Una de cada tres es un RISCO de pie. Lo usa solo el Tajumulco, y
            // a cuatro mil metros no crece nada: la unica forma de que esa
            // cuneta tenga altura es la propia roca, que ademas es lo que hay de
            // verdad por encima del limite del bosque. El remate va en propB,
            // que ahi es el azul palido del hielo.
            if (v > 0.66) {
                put(0, 0, 2.3 * t, 0, 1.6 * t, 4.6 * t, 1.4 * t, 0.07, 0);
                put(1, 0.9 * t, 0.8 * t, 0.5, 1.4 * t, 1.6 * t, 1.4 * t, -0.16, 0);
                put(2, -0.3, 4.4 * t, -0.2, 1.0 * t, 0.9 * t, 1.0 * t, 0.2, 1);
                break;
            }
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
        // La cuneta va con SU calzada, tambien en la bifurcacion. Sin este
        // termino el matorral se quedaba en el eje del cruce mientras la
        // calzada elegida se abria trece unidades hacia un lado: el jugador
        // corria por una carretera que se separaba de sus propios arboles.
        const dx = (curveX(game.distance - zWorld) - game.curveBase) * mask +
                   forkDX(zWorld, game.fork.mainBand);
        const dy = (curveY(game.distance - zWorld) - game.riseBase) * mask;
        const base = side * (ROAD_WIDTH / 2 + 2.2 + ((slot * 5) % 4) * 1.3);
        const tapa = overOtherFork(base + dx, zWorld);

        for (let t = 0; t < PROP_PARTS; t++) {
            const q = propBuf[t];
            const id = k * PROP_PARTS + t;
            if (tapa) { hideAt(propMesh, id); continue; }
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
    // La sierra tenia UNA sola forma para las trece paradas: cambiaba el color y
    // nada mas. O sea que habia cordillera en Petén, que es llano de punta a
    // punta, y en la playa de Monterrico; y en Antigua, que esta metida en un
    // valle con el Agua encima, el horizonte era el mismo teloncito que en la
    // selva. Dos numeros por region lo arreglan sin tocar la malla: ridgeH es lo
    // alta que va la sierra —0,3 la deja en una linea lejana, 1,45 la hace
    // asomarse— y ridgeBig levanta UNA cumbre por encima de las demas.
    const rh = lerp(A.ridgeH === undefined ? 1 : A.ridgeH,
                    B.ridgeH === undefined ? 1 : B.ridgeH, e);
    const rb = lerp(A.ridgeBig || 0, B.ridgeBig || 0, e);
    for (let k = 0; k < RIDGE_COUNT; k++) {
        // Una de cada once es la que manda. Se estrecha mientras crece, porque
        // una caja que solo sube sigue leyendose como muro y lo que hace falta
        // es que se lea como pico.
        const jefa = (k % 11) === 3 ? rb : 0;
        const w = (26 + ((k * 23) % 44)) * (1 - 0.42 * jefa);
        const h = (12 + ((k * 29) % 46)) * rh * (1 + 1.7 * jefa);
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
            // Cinco gradas anchas y nada encima daban exactamente la misma
            // receta que el pico de Tajumulco y el cono de Atitlán —cajas que
            // encogen— con otro color, asi que el horizonte de Tikal no se
            // reconocia como Tikal. Lo que hace inconfundible al Templo I son
            // tres cosas, y ninguna estaba: es ALTO Y ESTRECHO, lleva la
            // escalinata partiendole la cara de arriba abajo, y remata en
            // CRESTERIA, ese muro vertical sobre el templete que no sostiene
            // nada y que es la firma del sitio.
            const base = 8.6 * s, th = 2.1 * s;
            for (let t = 0; t < 4; t++) {
                const w = base * (1 - t * 0.17);
                put(0, th * t + th / 2 - 1, 0, w, th, w, R.landA);
            }
            const top = th * 4 - 1;
            // Escalinata: una banda clara que baja por la cara delantera. Va
            // ligeramente por fuera del cuerpo para que se lea como resalte.
            put(0, top / 2 - 0.5, base * 0.46, base * 0.24, th * 4, base * 0.14, R.landB);
            put(0, top + 1.4 * s, 0, 3.4 * s, 2.8 * s, 3.2 * s, R.landA);   // templete
            put(0, top + 4.1 * s, -0.6 * s, 2.8 * s, 2.6 * s, 0.7 * s, R.landB); // cresteria
            put(0, top + 1.1 * s, 1.7 * s, 1.1 * s, 1.9 * s, 0.5 * s, 0x1a1410); // vano
            break;
        }
        case 'karst': {                                   // Semuc Champey
            // Alta Verapaz es karst de TORRE: mogotes de laderas casi
            // verticales y cima redondeada, siempre en grupo. Lo que habia era
            // un monton de cajas solapadas mas ANCHO que alto —8 de ancho por
            // 7,75 de alto— y eso no es un mogote, es una loma: desde la
            // calzada se leia igual que cualquier cerro del resto de la ruta.
            // Tres torres de alturas distintas sobre una base comun, la mas
            // alta a 2,6 de alto por 1 de ancho, y la silueta ya solo puede ser
            // esta.
            const torre = (x, z, w, h) => {
                put(x, h / 2 - 1, z, w, h, w * 0.92, R.landA);
                // Monte encima: en el karst la roca se ve en la ladera y la
                // vegetacion se queda arriba, que es lo que hace que las torres
                // se lean como roca y no como arboles muy juntos.
                put(x, h - 0.7 * s, z, w * 0.86, 1.4 * s, w * 0.8, R.landB);
            };
            put(0, 0.7 * s - 1, 0, 11 * s, 1.6 * s, 8 * s, R.landA);   // base comun
            torre(-2.6 * s, 1.4 * s, 4.2 * s, 11 * s);
            torre(2.9 * s, -1.2 * s, 3.4 * s, 8.2 * s);
            torre(0.6 * s, 3.6 * s, 2.6 * s, 5.4 * s);
            break;
        }
        case 'gorge': {                                   // Río Dulce
            // Un PAREDON, no una palmera. La palmera la compartian el Río
            // Dulce y Monterrico —la silueta Y el matorral—, asi que el cañón
            // de Izabal y la playa del Pacífico tenian literalmente el mismo
            // horizonte: dos sitios a cuatro paradas de distancia que desde la
            // calzada eran el mismo. Lo que se ve en el Río Dulce es una pared
            // de caliza cayendo a plomo, con la selva colgando arriba y el
            // castillo de San Felipe a sus pies.
            //
            // Y una pared y no un cañón de dos paredes, porque el hito se
            // planta A UN LADO de la calzada y no a caballo de ella: un hueco
            // en medio no se leeria como "se pasa por entre las dos", se leeria
            // como una muesca en un bulto del margen.
            put(0, 5.75 * s - 1, 0, 5.6 * s, 11.5 * s, 5.0 * s, R.landA);
            put(-0.3 * s, 11.4 * s, 0.3 * s, 6.2 * s, 1.9 * s, 5.4 * s, R.landB);
            put(3.1 * s, 3.1 * s - 1, 1.6 * s, 3.0 * s, 6.2 * s, 3.4 * s, R.landA);
            put(3.1 * s, 6.5 * s, 1.6 * s, 3.4 * s, 1.2 * s, 3.8 * s, R.landB);
            put(-3.4 * s, 1.0 * s - 1, 3.0 * s, 2.2 * s, 2.0 * s, 2.2 * s, R.landB);
            put(-3.4 * s, 2.3 * s, 3.0 * s, 2.6 * s, 0.5 * s, 2.6 * s, R.landA);
            break;
        }
        case 'palm': {                                    // Monterrico
            // La palmera, y a su lado un RANCHO DE PALMA. Sola, la palmera dice
            // "playa tropical" y podria ser de cualquier sitio del mundo; el
            // rancho de horcones y techo de hoja es lo que hace que la playa sea
            // ESTA. Ocupa los dos huecos que gastaba una segunda palmera mas
            // pequena, que no anadia nada que la grande no dijera ya.
            //
            // Y se queda baja a proposito: Monterrico es costa llana y es el
            // unico sitio del recorrido donde el horizonte tiene que estar
            // vacio. Levantarlo para igualar a los demas seria inventarse una
            // sierra en el Pacifico.
            put(0, 3.2 * s - 1, 0, 0.75 * s, 7.4 * s, 0.75 * s, R.landA);
            for (let f = 0; f < 4; f++) {
                const a = f * Math.PI / 4 + 0.3;
                put(Math.cos(a) * 1.9 * s, 6.9 * s, Math.sin(a) * 1.9 * s,
                    4.4 * s, 0.42 * s, 1.1 * s, R.landB, a, -0.32);
            }
            // El techo va con color propio y no con landB: landB es el verde de
            // las hojas vivas de la palmera, y una hoja de palma SECA —que es de
            // lo que estan hechos los techos— es dorada. Es el mismo recurso que
            // usan el vano negro del templo y el humo gris del volcan.
            const paja = 0xb8955c;
            put(3.6 * s, 0.4 * s - 1, 2.2 * s, 4.0 * s, 2.8 * s, 3.4 * s, R.landA);
            put(3.6 * s, 2.6 * s - 1, 2.2 * s, 4.8 * s, 1.6 * s, 4.2 * s, paja);
            put(3.6 * s, 3.9 * s - 1, 2.2 * s, 2.6 * s, 1.0 * s, 2.4 * s, paja);
            break;
        }
        case 'basilica': {                                // Esquipulas
            // La Basílica del Cristo Negro, que es la razón de que Esquipulas
            // exista: fachada ancha, CUATRO torres con cúpula y el cimborrio en
            // medio. Compartia la silueta 'colonial' con Antigua, asi que el
            // mayor santuario de Centroamérica y la ciudad de las ruinas tenian
            // el mismo perfil pintado de otro color —y el color no salva una
            // silueta, porque a la distancia a la que vive el horizonte lo
            // primero que llega es la forma—.
            //
            // Y va simetrica a proposito. El hito se refleja segun el lado de
            // la calzada en el que caiga, asi que las siluetas asimetricas
            // cambian de mano; esta es la unica del recorrido a la que eso le
            // da igual, que es justo lo que se espera de una fachada de iglesia.
            put(0, 2.2 * s - 1, 0, 7.6 * s, 4.4 * s, 4.6 * s, R.landA);   // cuerpo
            const campanario = (x) => {
                put(x, 5.0 * s - 1, 1.7 * s, 1.5 * s, 10.0 * s, 1.5 * s, R.landA);
                put(x, 10.5 * s - 1, 1.7 * s, 1.8 * s, 1.0 * s, 1.8 * s, R.landB);
            };
            campanario(-3.1 * s);
            campanario(3.1 * s);
            put(0, 5.7 * s - 1, -0.8 * s, 3.2 * s, 2.6 * s, 3.2 * s, R.landB);  // cimborrio
            put(0, 7.9 * s - 1, -0.8 * s, 0.3 * s, 1.8 * s, 0.3 * s, R.landB);  // cruz
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
        case 'volcano': {                                 // el Fuego
            // El Fuego es EL QUE ESTA EN ERUPCION, y eso es lo unico que lo
            // separa de los conos dormidos de Atitlán —con los que compartia
            // silueta, y encima yendo seguidos en la ruta—. Asi que lo que
            // tiene que dominar no es el cono sino la COLUMNA: tres bloques de
            // ceniza que crecen y se ladean con el viento, y que suben mas alto
            // que ninguna cumbre del recorrido, que es exactamente lo que hace
            // una columna eruptiva de verdad.
            const ceniza = 0x574e48;
            for (let t = 0; t < 4; t++) {
                const w = 15 * s * (1 - t * 0.21);
                put(0, 2.7 * s * t + 1.35 * s - 1, 0, w, 2.7 * s, w, R.landA);
            }
            put(0, 10.6 * s - 1, 0, 3.4 * s, 1.0 * s, 3.4 * s, R.landB);   // crater al rojo
            put(0.4 * s, 12.4 * s - 1, 0, 2.6 * s, 2.4 * s, 2.6 * s, ceniza);
            put(1.2 * s, 15.0 * s - 1, -0.4 * s, 3.8 * s, 2.8 * s, 3.6 * s, ceniza);
            put(2.2 * s, 17.6 * s - 1, -0.9 * s, 5.0 * s, 3.0 * s, 4.6 * s, ceniza);
            break;
        }
        case 'lake': {                                    // Atitlán
            // Atitlán no es UN volcan: son TRES vistos por encima del agua —el
            // Atitlán, el Tolimán y el San Pedro, en fila—, y es lo unico del
            // recorrido que se lee como panorama y no como bulto. Con un solo
            // cono era el lago sin lago y sin dos de sus tres volcanes, y
            // ademas era el mismo cono que el del Fuego, la parada siguiente.
            //
            // Los conos van en landA oscuro y el agua en landB claro: a
            // contraluz de la puesta de sol los volcanes son siluetas negras y
            // lo que brilla es el lago, que es como se ve Atitlán a esa hora.
            const cono = (x, w, h) => {
                put(x, h / 4 + 0.7 * s - 1, 0, w, h / 2, w, R.landA);
                put(x, h * 0.75 + 0.7 * s - 1, 0, w * 0.52, h / 2, w * 0.52, R.landA);
            };
            put(0, -0.3 * s - 1, 2.6 * s, 14 * s, 1.4 * s, 4.2 * s, R.landB);  // el agua
            cono(-4.2 * s, 5.6 * s, 8.6 * s);
            cono(0.8 * s, 6.6 * s, 12.0 * s);
            cono(5.4 * s, 4.6 * s, 7.2 * s);
            break;
        }
        case 'mesa': {                                    // Todos Santos
            // Los Cuchumatanes NO son volcanicos: son una meseta de caliza, el
            // altiplano mas alto y mas LLANO de Centroamérica. Compartir el cono
            // de Tajumulco no era solo repetirse yendo seguidos, era decir lo
            // contrario de lo que ese sitio es. Es la silueta mas ancha que alta
            // de la ruta a proposito —0,65 a 1, contra el 1,26 del Tajumulco—,
            // porque eso es justo lo que la distingue.
            put(0, 4.2 * s - 1, 0, 15 * s, 8.4 * s, 9 * s, R.landA);
            put(0, 8.7 * s - 1, 0, 15.6 * s, 0.6 * s, 9.4 * s, R.landB);   // el borde
            put(-4.6 * s, 9.6 * s - 1, 1.2 * s, 3.0 * s, 1.2 * s, 3.0 * s, R.landA);
            put(5.0 * s, 9.9 * s - 1, -0.8 * s, 2.4 * s, 1.8 * s, 2.4 * s, R.landA);
            put(5.0 * s, 11.0 * s - 1, -0.8 * s, 2.6 * s, 0.4 * s, 2.6 * s, R.landB);
            break;
        }
        case 'peak': {                                    // Tajumulco
            // El punto mas alto de Centroamerica, y ahora que no comparte
            // silueta puede parecerlo: seis gradas en vez de cinco, base mas
            // estrecha y las dos ultimas nevadas. Pasa de 0,88 a 1 —mas ancho
            // que alto, que para el techo del istmo era decir lo contrario— a
            // 1,26, y es la cumbre mas alta del recorrido.
            for (let t = 0; t < 6; t++) {
                const w = 13 * s * (1 - t * 0.15);
                put(0, 2.9 * s * t + 1.45 * s - 1, 0, w, 2.9 * s, w, t >= 4 ? R.landB : R.landA);
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
        case 'city': {                                    // Ciudad de Guatemala
            // Torres de distinta altura con la coronacion encendida. Es el
            // unico hito del recorrido que se reconoce por sus luces y no por
            // su forma, que es exactamente como se reconoce una ciudad de
            // noche desde la carretera.
            const T = [[-3.4, 5.2, 2.6], [0, 8.4, 3.2], [3.6, 6.4, 2.8]];
            for (let t = 0; t < 3; t++) {
                const x = T[t][0] * s, h = T[t][1] * s, w = T[t][2] * s;
                put(x, h / 2 - 1, 0, w, h, w, R.landA);
                put(x, h - 0.55 * s, 0, w * 0.68, 0.5 * s, w * 0.68, R.landB);
            }
            put(0, 9.7 * s, 0, 0.3 * s, 2.2 * s, 0.3 * s, R.landB);   // antena
            put(0, 0.5 * s - 1, 3.4 * s, 11 * s, 1.0 * s, 2.4 * s, R.landA);
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

    // Bomba volcanica: el mismo cuerpo de la piedra rodante pero al rojo, con
    // el nucleo incandescente asomando por las juntas. Se reconoce de lejos
    // por el color, que es lo unico que hay tiempo de mirar.
    const bomba = new THREE.Group();
    piece(bomba, mat.ember, 1.35, 1.35, 1.35, 0, 0, 0);
    piece(bomba, mat.ember, 1.66, 0.9, 0.9, 0, 0, 0);
    piece(bomba, mat.ember, 0.9, 1.66, 0.9, 0, 0, 0);
    piece(bomba, mat.ember, 0.9, 0.9, 1.66, 0, 0, 0);
    piece(bomba, mat.emberCore, 1.78, 0.34, 0.34, 0, 0.34, 0.34);
    piece(bomba, mat.emberCore, 0.34, 0.34, 1.78, -0.34, -0.3, 0);
    piece(bomba, mat.emberCore, 0.34, 1.78, 0.34, 0.36, 0, -0.34);
    piece(bomba, mat.emberCore, 0.5, 0.5, 0.5, 0, 0, 0);
    group.add(bomba);

    return {
        group, parts: [bat, rock, vaca, bus, bomba], bat, rock, vaca, bus, bomba,
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
    // Viento fuerte de costado. Una manga cateada y tres rafagas: el unico
    // suceso de zona para el que no habia rombo que no mintiera. Usar el de
    // curva —que fue el primer apano— decia que la calzada iba a torcer, y no
    // tuerce: lo que se mueve es el jugador.
    viento: x => {
        x.lineWidth = 9; x.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
            const y = -14 + k * 17;
            x.beginPath();
            x.moveTo(-36, y); x.lineTo(6 + k * 9, y);
            x.stroke();
        }
        // La punta de la manga, abierta hacia donde sopla
        x.beginPath();
        x.moveTo(14, -30); x.lineTo(40, 2); x.lineTo(14, 34);
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

// --- El arco de fin de zona ------------------------------------------------
// Un portico de piedra que cruza la calzada entera y se ve emerger de la bruma
// mucho antes de llegar. No golpea, no se esquiva y no pide nada: se pasa por
// debajo. Lo unico que hace es DECIR algo, y lo que dice es "este sitio se
// acaba aqui" —trescientas y pico unidades despues viene el distribuidor que
// cambia de zona—. Antes, el tramo se terminaba sin ceremonia: aparecia el
// rotulo verde y ya estabas eligiendo.
//
// Va con los materiales tematizados de la region, asi que es de caliza en
// Tikal, de adoquin en Antigua y de hormigon en la capital sin una sola linea
// de mas.
function makeGate() {
    const group = new THREE.Group();
    const forma = () => { const g = new THREE.Group(); g.visible = false; group.add(g); return g; };
    const put = (g, m, sx, sy, sz, x, y, z, ry) => {
        const q = new THREE.Mesh(BOX, m);
        q.scale.set(sx, sy, sz);
        q.position.set(x, y, z);
        if (ry) q.rotation.y = ry;
        g.add(q);
    };
    const off = ROAD_WIDTH / 2 + 1.9;         // donde empiezan las jambas
    const luz = off * 2;                      // ancho del vano

    // --- Piramide: se pasa por un tunel abierto en la base -----------------
    // Los cuerpos de abajo van partidos en dos para dejar el paso; a partir del
    // dintel son macizos y de lado a lado. Es lo que hace que se entre en ella
    // y no que se pase por al lado.
    const pir = forma();
    for (let t = 0; t < 6; t++) {
        const w = 34 - t * 4.6, h = 3.2, y = 1.6 + t * h, d = 15 - t * 1.7;
        if (y + h / 2 <= GATE_CLEAR) {
            const lado = (w - luz) / 2;
            for (const s of [-1, 1]) {
                put(pir, t % 2 ? mat.stone : mat.kerb, lado, h, d, s * (luz + lado) / 2, y, 0);
            }
        } else {
            put(pir, t % 2 ? mat.stone : mat.kerb, w, h, d, 0, y, 0);
        }
    }
    put(pir, mat.accent, 7.4, 2.2, 7.4, 0, 21.2, 0);        // templo de la cima
    put(pir, mat.stone, 1.2, 3.0, 1.2, 0, 23.6, 0);         // crestería
    // Y la boca del tunel enmarcada, para que se vea que ES una entrada.
    for (const s of [-1, 1]) put(pir, mat.accent, 1.0, GATE_CLEAR, 1.2, s * luz / 2, GATE_CLEAR / 2, 7.8);
    put(pir, mat.accent, luz + 2, 1.1, 1.2, 0, GATE_CLEAR, 7.8);

    // --- Arco colonial -----------------------------------------------------
    const arc = forma();
    for (const s of [-1, 1]) {
        put(arc, mat.stone, 3.4, 5.6, 3.4, s * off, 2.8, 0);
        put(arc, mat.stone, 2.8, 3.8, 2.8, s * off, 7.5, 0);
        put(arc, mat.accent, 3.1, 0.5, 3.1, s * off, 9.6, 0);
        put(arc, mat.stone, 1.1, 7.0, 2.2, s * (off - 2.0), 3.5, 0);
    }
    put(arc, mat.stone, luz + 3.4, 1.6, 2.6, 0, GATE_CLEAR, 0);
    put(arc, mat.accent, luz + 4.0, 0.55, 3.0, 0, GATE_CLEAR + 1.1, 0);
    for (const s of [-1, 0, 1]) put(arc, mat.stone, 1.6, 1.9, 1.6, s * (off - 1.2), GATE_CLEAR + 2.3, 0);

    // --- Boca de cueva: dos macizos de roca girados y un dintel irregular ---
    const tun = forma();
    for (const s of [-1, 1]) {
        put(tun, mat.stone, 8.0, 7.0, 9.0, s * (off + 2.2), 3.5, 0, s * 0.22);
        put(tun, mat.stone, 6.4, 5.0, 7.0, s * (off + 1.0), 9.0, -1.5, s * -0.3);
        put(tun, mat.kerb, 3.2, 3.6, 4.0, s * (off - 0.6), 7.6, 2.0, s * 0.4);
    }
    put(tun, mat.stone, luz + 9, 3.4, 8.0, 0, GATE_CLEAR + 1.4, 0);
    put(tun, mat.stone, luz + 4, 2.6, 5.0, -2.0, GATE_CLEAR + 3.6, 1.0, 0.18);

    // --- Muelle: postes de madera y un travesano ---------------------------
    const mue = forma();
    for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
            put(mue, mat.deckSide, 0.9, GATE_CLEAR + 1.6, 0.9,
                s * (off + k * 1.6), (GATE_CLEAR + 1.6) / 2, k * 4 - 2);
        }
        put(mue, mat.deckSide, 0.6, 0.6, 5.4, s * (off + 0.8), GATE_CLEAR - 2.2, 0, 0);
    }
    put(mue, mat.deck, luz + 4.6, 1.0, 1.4, 0, GATE_CLEAR, -2);
    put(mue, mat.deck, luz + 4.6, 1.0, 1.4, 0, GATE_CLEAR, 2);
    put(mue, mat.accent, luz * 0.55, 1.8, 0.5, 0, GATE_CLEAR - 1.4, 2.1);   // el cartel

    // --- Paso elevado: dos pilas y un tablero de hormigon ------------------
    const pas = forma();
    for (const s of [-1, 1]) {
        put(pas, mat.stone, 3.0, GATE_CLEAR, 5.0, s * (off + 0.6), GATE_CLEAR / 2, 0);
        put(pas, mat.kerb, 4.0, 0.8, 6.0, s * (off + 0.6), GATE_CLEAR + 0.4, 0);
    }
    put(pas, mat.stone, luz + 9, 1.8, 8.0, 0, GATE_CLEAR + 0.9, 0);
    put(pas, mat.kerb, luz + 9, 0.9, 0.5, 0, GATE_CLEAR + 2.2, -3.9);
    put(pas, mat.kerb, luz + 9, 0.9, 0.5, 0, GATE_CLEAR + 2.2, 3.9);
    for (let k = -2; k <= 2; k++) {
        put(pas, mat.accent, 0.4, 0.9, 0.4, k * 4.5, GATE_CLEAR + 2.2, -3.9);
    }

    // La lona del patrocinador, colgada del dintel. Va en el GRUPO y no dentro
    // de cada forma: las cinco estructuras tienen el mismo vano libre, asi que
    // el mismo panel sirve para la piramide, el arco, la cueva, el muelle y el
    // paso elevado sin repetirlo cinco veces. Y es lo que las convierte en un
    // arco de meta: en una carrera, el portico por el que se pasa lleva
    // publicidad, siempre.
    const lona = new THREE.Mesh(VALLA_GEO, new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.DoubleSide, toneMapped: false
    }));
    lona.scale.set(ROAD_WIDTH + 1.6, 1.9, 1);
    lona.position.set(0, GATE_CLEAR - 1.1, 0.6);
    group.add(lona);

    group.visible = false;
    scene.add(group);
    return {
        group, parts: [pir, arc, tun, mue, pas], lona,
        z: 0, curve: 0, rise: 0, active: false
    };
}

// ===========================================================================
// La vida de cada sitio
// ===========================================================================
// Bichos de adorno: no golpean, no se esquivan y no cuentan para nada. Estan
// porque un sitio en el que no se mueve nada mas que lo que te quiere matar no
// es un sitio, es un decorado. Donde hay agua saltan peces de un margen al
// otro; donde hay cielo cruzan bandadas por lo alto.
//
// La regla que los mantiene fuera del juego: el pez cruza SIEMPRE por delante
// del jugador —entre cuarenta y ciento veinte unidades— y a ras, y el ave va a
// mas de doce de altura. Ni uno ni otro comparten sitio con nada que golpee,
// asi que no hay forma de confundirlos con una amenaza.
const FAUNA_POOL = 6;
const FAUNA_EVERY = 190;            // unidades entre bichos

function makeFauna() {
    const group = new THREE.Group();
    const put = (g, m, sx, sy, sz, x, y, z) => {
        const q = new THREE.Mesh(BOX, m);
        q.scale.set(sx, sy, sz);
        q.position.set(x, y, z);
        g.add(q);
        return q;
    };

    // Pez: cuerpo, cola y una aleta. Pequeno a proposito.
    const pez = new THREE.Group();
    put(pez, mat.fishBody, 1.1, 0.5, 0.42, 0, 0, 0);
    put(pez, mat.fishBody, 0.42, 0.34, 0.3, 0.42, 0.14, 0);
    put(pez, mat.fishFin, 0.5, 0.62, 0.14, -0.72, 0.06, 0);      // cola
    put(pez, mat.fishFin, 0.34, 0.3, 0.12, 0.05, 0.34, 0);       // dorsal
    pez.visible = false;
    group.add(pez);

    // Ave: cuerpo y dos alas que baten. Tres por bandada, montadas en fila.
    const ave = new THREE.Group();
    const alas = [];
    for (let k = 0; k < 3; k++) {
        const b = new THREE.Group();
        b.position.set((k - 1) * 2.4, (k === 1 ? 0.9 : 0), (k - 1) * 1.6);
        put(b, mat.bird, 0.66, 0.34, 0.34, 0, 0, 0);
        put(b, mat.bird, 0.26, 0.2, 0.2, 0.42, 0.08, 0);
        alas.push([
            put(b, mat.bird, 1.5, 0.1, 0.5, -0.8, 0.1, 0),
            put(b, mat.bird, 1.5, 0.1, 0.5, 0.8, 0.1, 0)
        ]);
        ave.add(b);
    }
    ave.visible = false;
    group.add(ave);

    group.visible = false;
    scene.add(group);
    return {
        group, pez, ave, alas,
        kind: 'ave', t: 0, dur: 1, z: 0, from: 0, to: 0, y0: 0, active: false
    };
}

function spawnFauna(kind, z, color) {
    let f = null;
    for (const c of fauna) if (!c.active) { f = c; break; }
    if (!f) return;
    // El bicho se pinta del color de SU sitio. Los materiales son compartidos
    // por todo el pozo, asi que se tinen al soltar y no por instancia: una
    // bandada dura tres segundos y las zonas doce minutos, de modo que dos
    // bichos de zonas distintas no llegan a coincidir nunca en pantalla.
    if (color) {
        if (kind === 'pez') mat.fishBody.color.setHex(color);
        else mat.bird.color.setHex(color);
    }
    const lado = Math.random() < 0.5 ? -1 : 1;
    f.kind = kind;
    f.z = z;
    f.t = 0;
    f.active = true;
    f.group.visible = true;
    f.pez.visible = kind === 'pez';
    f.ave.visible = kind === 'ave';
    if (kind === 'pez') {
        // De un margen al otro, cruzando la calzada de un salto.
        f.from = lado * (ROAD_WIDTH / 2 + 5.5);
        f.to = -f.from;
        f.y0 = 0.2;
        f.dur = 0.85 + Math.random() * 0.35;
    } else {
        // Las aves cruzan mas abierto, mas alto y mas despacio.
        f.from = lado * 34;
        f.to = -lado * (18 + Math.random() * 20);
        f.y0 = 13 + Math.random() * 9;
        f.dur = 2.6 + Math.random() * 1.6;
    }
    f.group.position.set(f.from, f.y0, z);
}

function updateFauna(dt, dz) {
    for (const f of fauna) {
        if (!f.active) continue;
        f.z += dz;
        f.t += dt;
        const p = f.t / f.dur;
        if (p >= 1 || f.z > DESPAWN_Z + 10) {
            // El pez entra al agua con su chapoteo; el ave simplemente se va.
            if (f.kind === 'pez' && p >= 1) {
                burstParticles(f.to, 0.4, f.z, 5, 0.6, 0xbfe3ea);
            }
            f.active = false;
            f.group.visible = false;
            continue;
        }
        const x = f.from + (f.to - f.from) * p;
        if (f.kind === 'pez') {
            // Parabola: sale del agua, cruza y vuelve a entrar.
            const y = f.y0 + Math.sin(p * Math.PI) * 4.2;
            f.group.position.set(x, y, f.z);
            // Y se inclina con la trayectoria, que es lo que hace que se lea
            // como un salto y no como una pieza deslizandose por el aire.
            f.group.rotation.z = Math.cos(p * Math.PI) * 0.9 * (f.to > f.from ? -1 : 1);
            f.group.rotation.y = f.to > f.from ? 0 : Math.PI;
        } else {
            const y = f.y0 + Math.sin(f.t * 1.7) * 0.8;
            f.group.position.set(x, y, f.z - p * 26);
            f.group.rotation.y = f.to > f.from ? -0.5 : 0.5;
            const bat = Math.sin(f.t * 9) * 0.9;
            for (let k = 0; k < f.alas.length; k++) {
                f.alas[k][0].rotation.z = bat;
                f.alas[k][1].rotation.z = -bat;
            }
        }
    }
}

// ===========================================================================
// La vuelta a la vida
// ===========================================================================
// Una columna de luz y el cuerpo bajando por dentro. La columna es UN cubo con
// material aditivo y sin escritura de profundidad: aditivo para que sume luz
// sobre lo que tenga detras en vez de taparlo —que es lo que hace que se lea
// como luz y no como una caja amarilla—, y sin depthWrite para que no recorte
// al propio corredor cuando lo atraviesa.
function makeRezBeam() {
    const m = new THREE.MeshBasicMaterial({
        color: REZ_GOLD, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const beam = new THREE.Mesh(BOX, m);
    beam.scale.set(2.6, REZ_UP * 2, 2.6);
    beam.visible = false;
    beam.renderOrder = 3;
    scene.add(beam);
    return beam;
}

function startRez() {
    player.rez = REZ_TIME;
    player.y = player.groundY + REZ_UP;
    player.vy = 0;
    player.grounded = false;
    if (rezBeam) {
        rezBeam.visible = true;
        rezBeam.material.opacity = 0.85;
    }
    // La columna cae ANTES que el cuerpo: se ve de donde va a salir.
    burstParticles(player.x, player.groundY + 1, PLAYER_Z, 18, 1.6, REZ_GOLD);
    sfx.region();
}

function updateRez(dt) {
    player.rez -= dt;
    // k va de 1 a 0. La altura con k al cuadrado, asi que la bajada frena
    // sola al acercarse al suelo en vez de estrellarse contra el.
    const k = Math.max(0, player.rez / REZ_TIME);
    player.y = player.groundY + REZ_UP * k * k;
    player.vy = 0;

    // La posicion la escribe updatePlayer, y aqui se sale antes de llegar,
    // asi que hay que ponerla: sin esto el cuerpo se quedaba clavado donde
    // murio y solo se movia la columna de luz.
    playerGroup.position.set(player.x, player.y, PLAYER_Z);
    playerGroup.rotation.set(0, k * Math.PI * 5, 0);
    shadowMesh.position.set(player.x, player.groundY + 0.03, PLAYER_Z);
    shadowMesh.material.opacity = 0.4 * (1 - k);

    if (rezBeam) {
        // Sin curveBase ni riseBase: en la zona cercana la mascara de la curva
        // vale cero y el jugador se dibuja en su x tal cual. Sumarlos aqui
        // habria dejado la columna desplazada respecto al cuerpo que envuelve.
        rezBeam.position.set(player.x, player.groundY + REZ_UP * 0.6, PLAYER_Z);
        rezBeam.material.opacity = 0.85 * k;
        const w = 1.0 + 2.4 * k;
        rezBeam.scale.set(w, REZ_UP * 2, w);
    }

    // Plumas cayendo con el, no cada frame: esto corre sesenta veces por
    // segundo y el pozo de particulas lo comparte con todo lo demas.
    if (Math.random() < 0.5) {
        burstParticles(
            player.x + (Math.random() - 0.5) * 3.2,
            player.y + 1 + Math.random() * 2.5,
            PLAYER_Z - 1 + Math.random() * 2,
            2, 1.1, REZ_GOLD
        );
    }

    if (player.rez <= 0) {
        player.rez = 0;
        player.y = player.groundY;
        player.grounded = true;
        playerGroup.position.set(player.x, player.y, PLAYER_Z);
        playerGroup.rotation.set(0, 0, 0);
        shadowMesh.material.opacity = 0.4;
        if (rezBeam) { rezBeam.visible = false; rezBeam.material.opacity = 0; }
        // El golpe de aterrizaje: es lo que convierte la bajada en una llegada.
        // Por encima de 0.4, que es donde el temblor empieza a verse: entra al
        // cuadrado en la camara, asi que 0.3 son cinco centesimas de nada.
        burstParticles(player.x, player.groundY + 0.5, PLAYER_Z, 26, 2.2, REZ_GOLD);
        shake = Math.max(shake, 0.55);
        sfx.shield();
    }
}

// ===========================================================================
// Publicidad en la calzada
// ===========================================================================
// Las vallas del borde de carretera, que en Guatemala estan por todas partes.
// Dos formas: la VALLA, un panel sobre dos postes en el margen, y la PANCARTA,
// una tira cruzada por encima de la calzada de lado a lado. Ninguna de las dos
// toca a nadie: la valla vive fuera del asfalto y la pancarta va a mas de once
// de altura, que es por encima incluso del vuelo del quetzal.
//
// Las telas son las seis tiras apaisadas que ya estaban en el repositorio para
// el menu y el fin de partida, asi que esto no anade ni un archivo: se cargan
// una vez, la primera que haga falta, y se reparten entre todo el pozo.
const VALLA_POOL = 5;
const VALLA_EVERY = 620;            // unidades entre anuncios, de serie
const VALLA_RUNNER = 240;           // ...y con el runner puesto
const VALLA_ALTA = 11.6;            // alto libre de la pancarta

const vallas = [];
let vallaTex = null;                // se cargan la primera vez que se pide una

function loadVallaTex() {
    if (vallaTex) return vallaTex;
    const loader = new THREE.TextureLoader();
    vallaTex = CEFAS.banners.map(src => {
        // Sin onError: si un archivo falta, la textura se queda en negro y el
        // panel sigue ahi como una valla apagada. Romper la partida porque no
        // cargo un anuncio seria exactamente al reves de lo que debe pasar.
        const t = loader.load(src);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    });
    return vallaTex;
}

const VALLA_GEO = new THREE.PlaneGeometry(1, 1);

function makeValla() {
    const group = new THREE.Group();

    // La valla del margen: dos patas y el panel encima.
    const lado = new THREE.Group();
    for (const sd of [-1, 1]) {
        const pata = new THREE.Mesh(BOX, mat.signPost);
        pata.scale.set(0.26, 4.2, 0.26);
        pata.position.set(sd * 1.5, 2.1, 0);
        lado.add(pata);
    }
    const panelL = new THREE.Mesh(VALLA_GEO, new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.DoubleSide, toneMapped: false
    }));
    panelL.scale.set(4.6, 2.6, 1);
    panelL.position.y = 5.4;
    lado.add(panelL);
    // Marco, para que el panel no flote recortado contra el cielo
    const marco = new THREE.Mesh(BOX, mat.signPost);
    marco.scale.set(5.0, 3.0, 0.12);
    marco.position.set(0, 5.4, 0.09);
    lado.add(marco);
    group.add(lado);

    // La pancarta: dos mastiles altos y la tela cruzando de lado a lado.
    const alta = new THREE.Group();
    for (const sd of [-1, 1]) {
        const mastil = new THREE.Mesh(BOX, mat.signPost);
        mastil.scale.set(0.3, VALLA_ALTA + 2.6, 0.3);
        mastil.position.set(sd * (ROAD_WIDTH / 2 + 1.4), (VALLA_ALTA + 2.6) / 2, 0);
        alta.add(mastil);
    }
    const panelA = new THREE.Mesh(VALLA_GEO, new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.DoubleSide, toneMapped: false
    }));
    panelA.scale.set(ROAD_WIDTH + 2.4, 2.2, 1);
    panelA.position.y = VALLA_ALTA + 1.2;
    alta.add(panelA);
    alta.visible = false;
    group.add(alta);

    group.visible = false;
    scene.add(group);
    return { group, lado, alta, panelL, panelA, z: 0, curve: 0, rise: 0, active: false };
}

function spawnValla(z, alta) {
    let v = null;
    for (const c of vallas) if (!c.active) { v = c; break; }
    if (!v) return;
    const tex = loadVallaTex();
    const t = tex[(Math.random() * tex.length) | 0];
    v.panelL.material.map = t;
    v.panelA.material.map = t;
    v.panelL.material.needsUpdate = true;
    v.panelA.material.needsUpdate = true;

    v.alta.visible = !!alta;
    v.lado.visible = !alta;
    // La del margen se planta a un lado u otro, y girada hacia el jugador: una
    // valla de perfil no es una valla, es un poste.
    if (!alta) {
        const sd = Math.random() < 0.5 ? -1 : 1;
        v.lado.position.x = sd * (ROAD_WIDTH / 2 + 4.2);
        v.lado.rotation.y = -sd * 0.42;
    }
    v.z = z;
    v.curve = trackCurve(z);
    v.rise = trackRise(z);
    v.active = true;
    v.group.visible = true;
    v.group.position.set(curveOf(v), riseOf(v), z);
}

function updateVallas(dz) {
    for (const v of vallas) {
        if (!v.active) continue;
        v.z += dz;
        v.group.position.set(curveOf(v), riseOf(v), v.z);
        if (v.z > DESPAWN_Z) { v.active = false; v.group.visible = false; }
    }
}

// --- Confeti ---
// No es decorado suelto: sale donde algo se ha CONSEGUIDO —al pasar bajo la
// estructura que cierra una zona y al llenar el pachon—, que es exactamente
// donde lo tiran en una carrera de verdad. Seis colores en vez de uno, porque
// confeti de un solo color son chispas.
const CONFETI = [0xef4444, 0xf0c34a, 0x2ec4a0, 0x4a90d9, 0xf2f6fa, 0xd94f6a];

function throwConfeti(z, n) {
    for (let i = 0; i < n; i++) {
        burstParticles(
            (Math.random() - 0.5) * (ROAD_WIDTH + 6),
            5.5 + Math.random() * 5,
            z + (Math.random() - 0.5) * 26,
            2, 1.9, CONFETI[(Math.random() * CONFETI.length) | 0]
        );
    }
}

function spawnGate(z, kind) {
    gate.z = z;
    gate.curve = trackCurve(z);
    gate.rise = trackRise(z);
    gate.active = true;
    gate.parts.forEach((p, i) => { p.visible = (i === kind); });
    // Lona nueva en cada estructura: si fuera siempre la misma, cerrar doce
    // zonas seria pasar doce veces por debajo del mismo cartel.
    const tex = loadVallaTex();
    gate.lona.material.map = tex[(Math.random() * tex.length) | 0];
    gate.lona.material.needsUpdate = true;
    gate.group.visible = true;
    gate.group.position.set(curveOf(gate), riseOf(gate), z);
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
    // El racionamiento es SOLO entre las de ambiente, y las forzadas ya no lo
    // alimentan. Antes si: cada bifurcacion planta dos Y forzadas, la cortada
    // otros dos discos y cada tramo especial su cartel, o sea que el reloj de
    // los 95 se reiniciaba constantemente y los sucesos anunciados —derrumbe,
    // ganado, camioneta— se quedaban sin plantar una y otra vez. Medido en una
    // ruta entera: varios enemigos no llegaban a salir ni una sola vez.
    if (!force) game.lastWarn = game.distance;

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
    // Una sola: la estructura pasa cuatrocientas unidades antes que su cruce y
    // los cruces van a mas de mil, asi que nunca hay dos a la vez.
    gate = makeGate();
    for (let i = 0; i < FAUNA_POOL; i++) fauna.push(makeFauna());
    for (let i = 0; i < VALLA_POOL; i++) vallas.push(makeValla());
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

    // bike, bikeDark y visor van AQUI dentro y no en un sitio aparte, aunque no
    // los toque ningun traje salvo la moto: la invulnerabilidad parpadea
    // recorriendo Object.values(playerMats), asi que metidos aqui la maquina
    // parpadea con su jinete en vez de quedarse opaca mientras el desaparece.
    playerMats = {
        cloth: slot(), skin: slot(), crest: slot(), legs: slot(),
        trim: slot(), hair: slot(), boot: slot(),
        bike: slot(), bikeDark: slot(), visor: slot()
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
    // Pelo, tocado y plumas se guardan juntos: con el casco puesto hay que
    // apagarlos, y tres plumas de quetzal saliendo por debajo de un integral
    // no es un guino, es un fallo de montaje.
    const tocado = [];
    const pelo = (m, sx, sy, sz, x, y, z) => {
        tocado.push(cube(playerBody, m, sx, sy, sz, x, y, z));
    };
    pelo(playerMats.hair, 0.66, 0.5, 0.22, 0, 2.08, 0.22);
    pelo(playerMats.hair, 0.66, 0.22, 0.62, 0, 2.31, 0);
    pelo(playerMats.hair, 0.16, 0.42, 0.5, -0.35, 2.02, 0.06);
    pelo(playerMats.hair, 0.16, 0.42, 0.5, 0.35, 2.02, 0.06);
    pelo(playerMats.crest, 0.72, 0.24, 0.72, 0, 2.5, 0);
    pelo(playerMats.trim, 0.76, 0.1, 0.76, 0, 2.63, 0);
    const plume = (x, rz, h) => {
        const f = cube(playerBody, playerMats.crest, 0.13, h, 0.34, x, 2.62 + h / 2, 0.2);
        f.rotation.z = rz;
        f.rotation.x = 0.35;
        tocado.push(f);
        return f;
    };
    plume(0, 0, 0.66);
    plume(-0.2, 0.42, 0.52);
    plume(0.2, -0.42, 0.52);

    // --- El casco ---
    // Va colgado del cuerpo como el pelo, para que herede la inclinacion del
    // tronco sin ningun calculo aparte. La visera mira al frente, o sea a -z,
    // que es adonde corre el jugador.
    const casco = new THREE.Group();
    casco.visible = false;
    playerBody.add(casco);
    cube(casco, playerMats.crest, 0.74, 0.72, 0.76, 0, 2.06, 0);          // calota
    cube(casco, playerMats.crest, 0.78, 0.26, 0.5, 0, 2.34, 0.06);        // cresta
    cube(casco, playerMats.visor, 0.66, 0.28, 0.1, 0, 2.06, -0.36);       // visera
    cube(casco, playerMats.trim, 0.7, 0.08, 0.12, 0, 2.22, -0.36);        // ceja
    cube(casco, playerMats.bikeDark, 0.6, 0.22, 0.5, 0, 1.78, -0.1);      // mentonera

    const armL = limb(playerMats.skin, playerMats.skin, -0.55, 1.66, 0.24, 0.72, 0.24, [0.28, 0.24, 0.28, 0]);
    const armR = limb(playerMats.skin, playerMats.skin, 0.55, 1.66, 0.24, 0.72, 0.24, [0.28, 0.24, 0.28, 0]);
    const legL = limb(playerMats.legs, playerMats.boot, -0.24, 0.85, 0.3, 0.8, 0.3, [0.34, 0.2, 0.5, -0.08]);
    const legR = limb(playerMats.legs, playerMats.boot, 0.24, 0.85, 0.3, 0.8, 0.3, [0.34, 0.2, 0.5, -0.08]);

    // --- El equipo del runner ---
    // Gorra, dorsal y pachon. Va colgado del cuerpo como el casco, y como el
    // casco apaga el tocado: un corredor de asfalto con penacho de plumas seria
    // otro traje distinto, no este.
    const runner = new THREE.Group();
    runner.visible = false;
    playerBody.add(runner);
    cube(runner, playerMats.crest, 0.68, 0.26, 0.66, 0, 2.34, 0);          // gorra
    cube(runner, playerMats.crest, 0.6, 0.08, 0.34, 0, 2.24, -0.42);       // visera
    cube(runner, playerMats.trim, 0.7, 0.07, 0.68, 0, 2.2, 0);             // ribete
    // El dorsal va a la ESPALDA y no al pecho. En una carrera de verdad va
    // delante, pero al jugador se le ve por detras todo el rato: puesto donde
    // no se ve, seria un detalle que no existe.
    cube(runner, playerMats.crest, 0.52, 0.42, 0.06, 0, 1.36, 0.36);
    cube(runner, playerMats.boot, 0.34, 0.1, 0.05, 0, 1.36, 0.39);

    // El pachon, a la cintura. Se llena de verdad conforme se recogen gotas:
    // el cuerpo del bote es fijo y el agua de dentro sube. Es el mismo dato que
    // el contador del HUD, pero sin apartar la vista de la calzada.
    const pachon = cube(runner, playerMats.trim, 0.2, 0.44, 0.2, 0.34, 1.02, 0.24);
    const pachonAgua = cube(runner, playerMats.cloth, 0.15, 0.36, 0.15, 0.34, 0.86, 0.24);
    cube(runner, playerMats.boot, 0.12, 0.08, 0.12, 0.34, 1.27, 0.24);     // tapon

    // --- La maquina ---
    // Cuelga de playerGroup y NO de playerBody: el cuerpo se inclina hacia
    // delante con la velocidad y se agacha al esconderse tras el carenado, y una
    // moto que se tumba con su piloto no es una moto, es un accidente. El jinete
    // se mueve encima de ella; ella se queda a plomo sobre la calzada.
    //
    // Las ruedas son cilindros y no cajas, que es la unica geometria nueva de
    // todo esto: una caja girando sobre su eje se lee como una caja girando.
    // Cuatro vehiculos con el mismo molde, no cuatro bloques copiados. Lo que
    // cambia de uno a otro es la chatarra, el tamano de las ruedas y a que
    // altura queda el jinete; todo lo demas —colgar de playerGroup, girar las
    // ruedas con el mundo, levantar el morro en el aire— es identico y se
    // escribe una vez.
    //
    // El cilindro va de radio 1 y se escala en cada rueda: la de la bici mide
    // mas del doble que la de la patineta, y con una geometria fija por vehiculo
    // habria cuatro cilindros donde basta uno.
    const RUEDA = new THREE.CylinderGeometry(1, 1, 1, 14);
    const vehs = {};

    function vehiculo(id, alto) {
        const group = new THREE.Group();
        group.visible = false;
        playerGroup.add(group);
        const ruedas = [];
        // alto es donde quedan los pies del jinete: cero si va sentado, la
        // altura de la tabla si va de pie encima.
        const v = { group, ruedas, alto, radio: 0.52 };
        vehs[id] = v;

        const rueda = (r, ancho, x, y, z, llanta) => {
            const w = new THREE.Mesh(RUEDA, playerMats.bikeDark);
            w.scale.set(r, ancho, r);
            w.position.set(x, y, z);
            w.rotation.z = Math.PI / 2;      // el eje pasa a ser el X
            group.add(w);
            ruedas.push(w);
            if (llanta) {
                const l = new THREE.Mesh(BOX, playerMats.trim);
                l.scale.set(ancho + 0.02, r * 1.2, r * 0.25);
                l.position.set(x, y, z);
                group.add(l);
            }
            v.radio = r;
            return w;
        };
        const pieza = (m, sx, sy, sz, x, y, z, rx, rz) => {
            const q = new THREE.Mesh(BOX, m);
            q.scale.set(sx, sy, sz);
            q.position.set(x, y, z);
            if (rx) q.rotation.x = rx;
            if (rz) q.rotation.z = rz;
            group.add(q);
            return q;
        };
        return { rueda, pieza, v };
    }

    // --- Moto ---
    {
        const { rueda, pieza } = vehiculo('moto', 0);
        rueda(0.52, 0.24, 0, 0.52, 1.05, true);
        rueda(0.52, 0.24, 0, 0.52, -1.15, true);
        pieza(playerMats.bike, 0.42, 0.34, 2.0, 0, 0.86, 0);                // cuna
        pieza(playerMats.bike, 0.56, 0.46, 0.92, 0, 1.12, -0.34);           // deposito
        pieza(playerMats.bikeDark, 0.62, 0.16, 0.72, 0, 1.02, 0.5);         // asiento
        pieza(playerMats.bike, 0.5, 0.5, 0.34, 0, 1.28, -0.98, -0.32);      // carenado
        pieza(playerMats.trim, 0.18, 0.78, 0.18, -0.3, 0.9, -1.1, -0.28);   // horquilla
        pieza(playerMats.trim, 0.18, 0.78, 0.18, 0.3, 0.9, -1.1, -0.28);
        pieza(playerMats.trim, 1.0, 0.12, 0.12, 0, 1.36, -0.86);            // manillar
        pieza(playerMats.bikeDark, 0.16, 0.16, 0.8, -0.34, 0.72, 0.72);     // escape
        pieza(playerMats.bikeDark, 0.16, 0.16, 0.8, 0.34, 0.72, 0.72);
        pieza(playerMats.trim, 0.5, 0.08, 0.16, -0.42, 0.6, 0.1);           // estriberas
        pieza(playerMats.trim, 0.5, 0.08, 0.16, 0.42, 0.6, 0.1);
    }

    // --- Bicicleta ---
    // Ruedas grandes y finas, cuadro de tubos y nada de carroceria: una bici se
    // reconoce por lo que NO tiene. El plato y las bielas van puestos porque son
    // lo que explica que las piernas den la vuelta entera.
    {
        const { rueda, pieza } = vehiculo('bici', 0);
        rueda(0.64, 0.1, 0, 0.64, 0.98, true);
        rueda(0.64, 0.1, 0, 0.64, -1.02, true);
        pieza(playerMats.bike, 0.1, 0.1, 1.7, 0, 1.16, -0.05, 0.1);         // tubo alto
        pieza(playerMats.bike, 0.1, 1.0, 0.1, 0, 0.9, 0.5, 0.42);           // tubo diagonal
        pieza(playerMats.bike, 0.1, 0.72, 0.1, 0, 1.0, 0.66);               // tija
        pieza(playerMats.bike, 0.1, 0.9, 0.1, 0, 1.05, -0.86, -0.25);       // horquilla
        pieza(playerMats.bikeDark, 0.34, 0.1, 0.44, 0, 1.38, 0.68);         // sillin
        pieza(playerMats.trim, 0.9, 0.09, 0.09, 0, 1.44, -0.8);             // manubrio
        pieza(playerMats.trim, 0.09, 0.09, 0.3, -0.42, 1.42, -0.72);        // punos
        pieza(playerMats.trim, 0.09, 0.09, 0.3, 0.42, 1.42, -0.72);
        pieza(playerMats.bikeDark, 0.06, 0.42, 0.42, 0.16, 0.42, 0.1);      // plato
        pieza(playerMats.trim, 0.28, 0.06, 0.06, -0.26, 0.42, 0.1);         // bielas
        pieza(playerMats.trim, 0.28, 0.06, 0.06, 0.26, 0.42, 0.1);
    }

    // --- Patineta ---
    // La tabla va a 0,32 y el jinete ENCIMA, no sentado: es el primer vehiculo
    // en el que el cuerpo entero sube. Cuatro ruedas pequenas y dos ejes.
    {
        const { rueda, pieza } = vehiculo('patineta', 0.32);
        for (const sd of [-1, 1]) {
            rueda(0.15, 0.12, sd * 0.26, 0.15, 0.58, false);
            rueda(0.15, 0.12, sd * 0.26, 0.15, -0.58, false);
        }
        pieza(playerMats.bike, 0.78, 0.09, 2.5, 0, 0.32, 0);                // tabla
        pieza(playerMats.bike, 0.62, 0.09, 0.4, 0, 0.36, 1.32, -0.42);      // cola
        pieza(playerMats.bike, 0.62, 0.09, 0.4, 0, 0.36, -1.32, 0.42);      // punta
        pieza(playerMats.trim, 0.5, 0.1, 0.16, 0, 0.24, 0.58);              // ejes
        pieza(playerMats.trim, 0.5, 0.1, 0.16, 0, 0.24, -0.58);
        pieza(playerMats.bikeDark, 0.74, 0.02, 2.4, 0, 0.375, 0);           // lija
    }

    // --- Monopatin ---
    // La misma tabla baja, pero con mastil y manubrio, y dos ruedas en vez de
    // cuatro. Es lo que lo separa de la patineta a la distancia a la que se ve:
    // uno lleva las manos en el aire y el otro agarrado.
    {
        const { rueda, pieza } = vehiculo('monopatin', 0.28);
        rueda(0.2, 0.11, 0, 0.2, 0.82, false);
        rueda(0.2, 0.11, 0, 0.2, -0.9, false);
        pieza(playerMats.bike, 0.5, 0.1, 1.9, 0, 0.28, 0);                  // tabla
        pieza(playerMats.trim, 0.44, 0.02, 1.7, 0, 0.34, 0);                // lija
        pieza(playerMats.bike, 0.16, 1.35, 0.16, 0, 1.0, -0.9, -0.12);      // mastil
        pieza(playerMats.trim, 0.92, 0.09, 0.09, 0, 1.62, -0.95);           // manubrio
        pieza(playerMats.bikeDark, 0.1, 0.1, 0.28, -0.42, 1.62, -0.9);      // punos
        pieza(playerMats.bikeDark, 0.1, 0.1, 0.28, 0.42, 1.62, -0.9);
        pieza(playerMats.trim, 0.2, 0.36, 0.2, 0, 0.4, -0.84);              // horquilla
    }

    playerParts = { torso, head, armL, armR, legL, legR,
                    tocado, casco, vehs,
                    runner, pachon, pachonAgua };
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

    // --- Lo que se lleva puesto ---
    // El HUD ya dice que poder esta activo, pero mirarlo cuesta el medio
    // segundo que no hay. Lo que se lleva encima se ve sin dejar de mirar la
    // calzada, que es donde estan los ojos todo el rato.
    //
    // Van colgados de playerGroup y no de playerBody a proposito: el cuerpo se
    // tumba y se estira al deslizarse, y una burbuja aplastada en un ovalo no
    // se lee como escudo.
    powerAura = new THREE.Mesh(
        new THREE.SphereGeometry(1.28, 16, 12),
        new THREE.MeshBasicMaterial({
            color: POWERS.shield.color, transparent: true, opacity: 0.2,
            side: THREE.DoubleSide, depthWrite: false
        })
    );
    powerAura.position.y = 1.3;
    powerAura.renderOrder = 2;
    powerAura.visible = false;
    playerGroup.add(powerAura);

    // El aro del ecuador. La esfera sola, translucida y sin aristas, se pierde
    // contra un fondo claro; el aro le da un borde que siempre se ve.
    powerAura.add(new THREE.Mesh(
        new THREE.TorusGeometry(1.27, 0.05, 6, 20),
        new THREE.MeshBasicMaterial({
            color: 0xffe2a8, transparent: true, opacity: 0.75, depthWrite: false
        })
    ));
    powerAura.children[0].rotation.x = Math.PI / 2;

    powerOrbs = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false
        }),
        AURA_ORBS
    );
    powerOrbs.frustumCulled = false;
    powerOrbs.renderOrder = 2;
    powerOrbs.visible = false;
    playerGroup.add(powerOrbs);

    applySkin(save.skin);
}

// Si el traje puesto trae maquina. Se guarda aparte y no se consulta el traje
// en cada frame: la postura lo pregunta sesenta veces por segundo y skinById
// recorre la lista entera.
let motoOn = false;         // solo la moto: es la unica que trae casco
let runnerOn = false;
let vehOn = null;           // 'moto' | 'bici' | 'patineta' | 'monopatin' | null
let vehAct = null;          // el vehiculo puesto, ya resuelto

function applySkin(id) {
    const sk = skinById(id);
    playerMats.cloth.color.setHex(sk.cloth);
    playerMats.skin.color.setHex(sk.skin);
    playerMats.crest.color.setHex(sk.crest);
    playerMats.legs.color.setHex(sk.legs);
    playerMats.trim.color.setHex(sk.trim);
    playerMats.hair.color.setHex(sk.hair);
    playerMats.boot.color.setHex(sk.boot);
    playerMats.bike.color.setHex(sk.bike || sk.cloth);
    playerMats.bikeDark.color.setHex(sk.bikeDark || sk.legs);
    playerMats.visor.color.setHex(sk.visor || sk.legs);

    motoOn = !!sk.moto;
    runnerOn = !!sk.runner;
    vehOn = sk.veh || null;
    vehAct = vehOn ? playerParts.vehs[vehOn] : null;
    for (const k in playerParts.vehs) {
        playerParts.vehs[k].group.visible = (k === vehOn);
    }
    playerParts.casco.visible = motoOn;
    playerParts.runner.visible = runnerOn;
    // El tocado maya solo lo lleva el principal. Se apaga con la gorra del
    // runner, con el casco de la moto y tambien encima de la bici, la patineta
    // y el monopatin: un patinador con penacho de plumas de quetzal es el mismo
    // fallo de montaje que las plumas saliendo por debajo de un integral.
    // Antes la condicion miraba solo a motoOn y a runnerOn, asi que los tres
    // vehiculos nuevos salian emplumados.
    for (const p of playerParts.tocado) p.visible = !vehOn && !runnerOn;

    // Y el hueco del poder propio se viste con el traje: nombre, color, reloj y
    // glifo. La pieza de la calzada, el aura del jugador y la casilla del HUD
    // salen todas de aqui, asi que cambiarlo en un sitio lo cambia en los tres.
    propioAct = PROPIOS[sk.veh] || (sk.runner ? PROPIOS.runner : null);
    if (propioAct) {
        POWERS.propio.name = propioAct.name;
        POWERS.propio.time = propioAct.time;
        POWERS.propio.color = propioAct.color;
        mat.propio.color.setHex(propioAct.color);
        mat.propio.emissive.setHex(propioAct.color);
        dom.pw.propio.style.setProperty('--c', '#' + propioAct.color.toString(16).padStart(6, '0'));
        dom.pw.propio.firstChild.nodeValue = propioAct.icon;
    }
    fillPachon();
}

// El agua del pachon, de vacio a lleno. El bote mide 0,44 y el agua vive
// dentro: crece hacia arriba desde su fondo, que es lo que hace que se lea como
// que se llena y no como que se infla.
function fillPachon() {
    if (!runnerOn) return;
    const t = Math.min(1, game.gotas / GOTAS_VIDA);
    const alto = Math.max(0.02, 0.36 * t);
    playerParts.pachonAgua.scale.set(0.15, alto, 0.15);
    playerParts.pachonAgua.position.y = 0.84 - 0.18 + alto / 2;
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
    if (gate) { gate.active = false; gate.group.visible = false; }
    for (const f of fauna) { f.active = false; f.group.visible = false; }
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
    // Con el runner puesto, el jade se recoge como AGUA. Es la misma pieza y el
    // mismo valor —cambiar la moneda dejaria al runner sin poder comprar nada—
    // pero se ve distinta y ademas llena el pachon. El cambio se hace aqui, al
    // soltar la pieza, y no rehaciendo el pozo al cambiar de traje.
    const gota = kind === 'jade' && runnerOn;
    p.mesh.geometry = gota ? GEO.gota : (GEO[kind] || GEO.jade);
    p.mesh.material = gota ? mat.gota : (mat[kind] || mat.jade);
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
    if (h.type === RODANTE || h.type === BOMBA) return 0.72;
    return 0;                                  // vaca y camioneta van al ras
}

function hazX(h, z) {
    const base = h.type === VACA ? h.cross : LANE_X[h.lane];
    return base + curveAtZ(z);
}

// Elige un poder segun su peso. El escudo solo entra en el sorteo si no
// llevas uno: ofrecer un escudo a quien ya lo tiene es un premio vacio.
// Y el poder propio solo entra en el sorteo si llevas un traje que TENGA uno:
// con el Ajaw puesto no existe, porque soltar en la calzada una pieza que al
// recogerla no hace nada seria peor que no soltarla.
function rollPower() {
    const fuera = k => (k === 'shield' && game.shield) ||
                       (k === 'propio' && !propioAct);
    let total = 0;
    for (const k of POWER_KEYS) {
        if (fuera(k)) continue;
        total += POWERS[k].weight;
    }
    let r = Math.random() * total;
    for (const k of POWER_KEYS) {
        if (fuera(k)) continue;
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
    // Tomado el desvio a la capital ya no viene ninguna mas, y reservarle sitio
    // dejaria el ultimo tramo vacio justo cuando tiene que estar mas lleno.
    if (game.finishS < 0) {
        const s0 = game.nextCross + CROSS_ISLAND_AT;
        w.push([s0 - QUIET_PRE, s0 + FORK_LEN + QUIET_POST]);
    }
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
    if (game.slopeS0 >= 0 || game.turn.active || game.narrowS0 >= 0 ||
        game.sink.active || game.zone.active) return true;
    // Donde caeria el tramo si se armase ahora mismo, con margen a los lados
    return limpioEntre(game.distance + ARM_AHEAD - 45,
                       game.distance + ARM_AHEAD + len + 45);
}

// Uno de los cuatro, evitando repetir el de la vez anterior: con sorteo libre,
// ver el mismo dos veces seguidas pasa una de cada cuatro.
function armTramo() {
    let t = (Math.random() * 4) | 0;
    if (t === game.lastTramo) t = (t + 1 + ((Math.random() * 3) | 0)) % 4;
    const len = t === 0 ? TURN_LEN
              : t === 1 ? SLOPE_LEN
              : t === 2 ? NARROW_LEN : SINK_LEN;
    if (trackBusy(len)) return false;
    if (t === 0) armTurn();
    else if (t === 1) armSlope();
    else if (t === 2) armNarrow();
    else armSink();
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

function armSink() {
    // Un tramo elevado puesto ANTES de armar esto puede llegar hasta aqui: se
    // arma doscientas quince unidades por delante, y una plataforma nacida en
    // el punto de aparicion mide lo bastante para cruzar esa linea. Su tablero
    // pasaria por encima del agujero y el jugador lo cruzaria andando por el
    // aire.
    if (platformNear(-ARM_AHEAD) || platformNear(-ARM_AHEAD - SINK_LEN)) return;

    // Los dos avisos van a los DOS lados: lo que se cae es el firme, y un
    // cartel en un solo margen se leeria como algo que solo afecta a ese lado.
    if (spawnWarn('hueco', ARM_SIGN_Z, -1, true) === 0) return;
    spawnWarn('hueco', ARM_SIGN_Z, 1, true);

    // Se elige primero el carril que SE SALVA y despues cuantos se caen. Al
    // reves —sortear los que caen— sale la mitad de las veces un tramo con los
    // tres hundidos, que no es un obstaculo sino un final.
    const libre = (Math.random() * 3) | 0;
    let mask = 7 & ~(1 << libre);
    if (Math.random() < 0.45) {
        // Solo uno de los dos de al lado: quedan dos carriles buenos.
        mask = 1 << (Math.random() < 0.5 ? (libre + 1) % 3 : (libre + 2) % 3);
    }

    game.sink.active = true;
    game.sink.s0 = game.distance + ARM_AHEAD;
    game.sink.mask = mask;
    game.sink.free = libre;

    // El unico obstaculo del tramo, y en el carril que se salva. Tiene que
    // poder pasarse SIN cambiarse de carril, asi que solo vale uno de los dos
    // que se libran con el cuerpo: la viga agachandose o el sumidero saltando.
    // Una estela ahi, que solo se esquiva de lado, seria muerte segura.
    const zc = -(ARM_AHEAD + SINK_LEN / 2);
    spawnObstacle(Math.random() < 0.5 ? DINTEL : CENOTE, libre, zc, 0);
    // Jade por el carril bueno: ademas de premiar, ensena por donde se pasa.
    for (let k = 0; k < 5; k++) spawnPickup(libre, zc + 14 - k * 5, 1.3);
}

function armNarrow() {
    // A los dos lados: lo que se estrecha es la calzada entera, y un cartel en
    // un solo margen se leeria como algo que solo afecta a ese carril.
    if (spawnWarn('puente', ARM_SIGN_Z, -1, true) === 0) return;
    spawnWarn('puente', ARM_SIGN_Z, 1, true);
    game.narrowS0 = game.distance + ARM_AHEAD;
}

// ===========================================================================
// El suceso de la zona
// ===========================================================================
// Se arma como los demas tramos —por delante de lo que se ve, sin pisar una
// bifurcacion ni otro tramo— pero no se dispara por sorteo ni por reparto: es
// de la ZONA, y ocurre una vez por visita.
function armZone() {
    const ri = Math.floor(routePos()) % REGION_N;
    const spec = ZONES[REGIONS[ri].id];
    if (!spec) return false;

    // Si ya no da tiempo a que quepa ENTERO antes del proximo cruce, no se
    // arma tarde: se aplaza a despues del cruce. Sin esta comprobacion, un
    // suceso que no encontraba sitio se acababa armando encima del
    // distribuidor y sonaba pasado el: el jugador veia el vuelo de camazotz de
    // Tikal con el rotulo de Tikal puesto... estando ya en Flores.
    // Salvo en la capital: ahi ya no se arma ningun cruce mas —lo que cierra el
    // tramo es la meta— y nextCross se quedo con el valor que tuviera, casi
    // siempre POR DETRAS del jugador. Sin esta salvedad la comprobacion daba
    // siempre que "no cabe", y el aplazamiento apuntaba a un sitio ya pasado,
    // asi que se reintentaba y se volvia a aplazar al mismo punto en cada
    // compas: "Hora pico" no llegaba a armarse nunca por un segundo motivo,
    // independiente del tramo corto.
    if (game.finishS < 0) {
        const cruce = game.nextCross + CROSS_ISLAND_AT;
        if (game.distance + ARM_AHEAD + ZONE_LEN + 60 > cruce) {
            game.nextZone = cruce + 140;
            return false;
        }
    }
    if (trackBusy(ZONE_LEN)) return false;

    // Cuanto aprieta: de un tercio en Peten a entero en la capital. La ruta va
    // de Tikal a Ciudad de Guatemala, asi que lo avanzado del recorrido ES la
    // dificultad, y no hace falta ningun contador aparte.
    const dur = 0.34 + 0.66 * (ri / (REGION_N - 1));

    // El cartel es forzado: un suceso de zona no puede pillar a nadie sin
    // avisar, y menos el primero que se ve en la vida.
    if (spawnWarn(spec.warn, ARM_SIGN_Z, null, true) === 0) return false;

    game.zone.active = true;
    game.zone.s0 = game.distance + ARM_AHEAD;
    game.zone.i = ri;
    game.zone.k = 0;
    game.zone.dur = dur;
    game.zone.dicho = false;
    game.zone.libre = (Math.random() * 3) | 0;
    return true;
}

// Lo que aprieta el suceso en un punto del trazado: una campana, como la de la
// curva. Manda sobre el tinte de la escena, sobre las chispas y sobre el
// retumbo del temblor, y vuelve sola a cero al salir.
function zoneGrip(sc) {
    const Z = game.zone;
    if (!Z.active) return 0;
    const t = (sc - Z.s0) / ZONE_LEN;
    if (t <= 0 || t >= 1) return 0;
    return Math.sin(t * Math.PI);
}

// Un carril cualquiera que NO sea el libre. Siempre queda uno por el que se
// pasa; lo que cambia con la dureza es cada cuantas piezas se MUEVE.
//
// La primera version quitaba el carril libre del todo en las ultimas zonas, y
// eso no es dificultad: con una bomba cada seis decimas en un carril al azar de
// tres, sobrevivir pasa a ser cuestion de suerte y morir deja de ser culpa de
// nadie. Moviendo el hueco cada dos piezas se pide exactamente lo mismo —no
// parar de leer y no parar de moverse— pero siempre hay una respuesta correcta.
function zoneLane() {
    const Z = game.zone;
    let l = (Math.random() * 2) | 0;
    if (l >= Z.libre) l++;
    return l;
}

// Mueve el hueco. Se llama SOLO al soltar una pieza y no dentro de zoneLane:
// el pasillo de jade tambien pregunta por el carril libre, y si moverlo fuera
// efecto de preguntar, el jade acabaria corriendo el hueco de las bombas.
function zoneShift() {
    const Z = game.zone;
    const cada = Math.max(2, Math.round(5 - 3 * Z.dur));
    if (Z.k === 0 || Z.k % cada !== 0) return;
    let n = (Math.random() * 2) | 0;
    if (n >= Z.libre) n++;
    Z.libre = n;
}

function updateZone(dt) {
    const Z = game.zone;
    if (!Z.active) return;
    const spec = ZONES[REGIONS[Z.i].id];
    const d = game.distance;

    if (d > Z.s0 + ZONE_LEN + 60) {
        Z.active = false;
        player.push = 0;
        return;
    }

    // El rotulo, al entrar y no al armar: armar ocurre doscientas quince
    // unidades por delante y el nombre saldria sobre una recta vacia.
    if (!Z.dicho && d > Z.s0 - 40) {
        Z.dicho = true;
        showBanner(spec.name, 'Peligro', true);
    }

    const grip = zoneGrip(d);

    // --- Lo que suelta ---
    // Se va soltando segun el punto de aparicion alcanza cada hueco, en vez de
    // programarse entero al armar: asi la cadencia sale en unidades de calzada
    // y se ve igual a cualquier velocidad.
    // Oleadas de verdad, entre cinco y ocho. El hueco entre ellas es
    // ZONE_LEN / n unidades, o sea entre nueve decimas y algo mas de dos
    // segundos a la velocidad de crucero de esa zona: el tiempo justo para
    // leer donde esta el hueco libre y llegar. Con el reparto anterior a Tikal
    // le tocaban cuatro oleadas para catorce segundos de tramo.
    const n = Math.max(4, Math.round(spec.n * (0.6 + 0.4 * Z.dur)));
    if (spec.kind !== 'viento') {
        const paso = ZONE_LEN / n;
        while (Z.k < n && d - (Z.s0 + Z.k * paso) >= SPAWN_Z) {
            emitZone(spec, Z.s0 + Z.k * paso);
            Z.k++;
        }
    }

    // --- Ventisca ---
    // No golpea: descoloca. El empuje va con la DISTANCIA y no con el reloj,
    // asi que las rafagas caen siempre en el mismo sitio del tramo y se pueden
    // aprender, que es lo que separa un obstaculo de una loteria. Se asigna
    // SIEMPRE, tambien fuera de la campana: multiplicado por grip vale cero
    // ahi, y si se saltase el jugador se quedaria empujado hasta que el suceso
    // caducara.
    if (spec.kind === 'viento') {
        player.push = Math.sin(d * 0.055) * ZONE_WIND * grip * (0.5 + 0.5 * Z.dur);
    }

    if (grip <= 0) return;

    // --- Temblor ---
    if (spec.kind === 'temblor') {
        shake = Math.max(shake, SHAKE_SOFT * grip * 1.3);
    }

    // --- Ceniza, espuma, polvo ---
    // Dos chispas de vez en cuando alrededor del jugador. Es barato y es la
    // mitad de lo que hace que el suceso se lea como un suceso y no como una
    // tanda de obstaculos con otro nombre. La tasa va baja a proposito: esto
    // corre por PASO DE SIMULACION, sesenta veces por segundo, y el pozo de
    // particulas lo comparten el jade, los golpes y los poderes.
    if (Math.random() < grip * 0.12) {
        burstParticles(
            player.x + (Math.random() - 0.5) * 16,
            3.5 + Math.random() * 5,
            PLAYER_Z - 8 - Math.random() * 60,
            2, 0.8, spec.spark
        );
    }
}

// Una OLEADA del suceso, en la coordenada de trazado dada. Todo lo que sale
// aqui sale a la vez y por todos los carriles menos el libre: es lo que
// convierte "van cayendo piedras" en "esta cayendo el volcan encima".
function emitZone(spec, sc) {
    const z = game.distance - sc;
    const Z = game.zone;
    zoneShift();

    // Los que cruzan la calzada entera no tienen carril: uno por oleada y ya.
    if (spec.kind === 'pasillo' && spec.what === TRONCO) {
        spawnObstacle(TRONCO, 1, z, 0);
        return;
    }
    if (spec.kind === 'cruce') {
        spawnHazard(spec.what, 1, z, Math.random() < 0.5 ? -1 : 1);
        return;
    }

    for (let l = 0; l < 3; l++) {
        if (l === Z.libre) continue;
        // Un poco de desorden en la profundidad: una fila perfectamente
        // alineada se lee como una reja y no como algo que esta pasando.
        const dz = ((l * 7 + Z.k * 3) % 5 - 2) * 3.5;
        switch (spec.kind) {
            case 'lluvia':
            case 'temblor':
                // Cae del cielo y despues rueda. La altura se escalona para
                // que no aterricen todas a la vez: eso suena a lluvia y no a
                // un solo golpe.
                spawnHazard(spec.what, l, z + dz, 0, 20 + ((l + Z.k) % 4) * 6);
                break;
            case 'enjambre':
                spawnHazard(spec.what, l, z + dz);
                break;
            case 'pasillo':
                spawnObstacle(spec.what, l, z + dz, 0);
                break;
        }
    }
}

// Se apagan cuando el jugador los ha dejado atras del todo: pasado ese punto
// ya no queda nada dibujado dentro y apagarlos no mueve un solo pixel.
function updateTrackSystems(dt) {
    const d = game.distance;

    if (game.sink.active) {
        // Retumbo mientras hay firme rompiendose por delante. Al minimo: lo
        // provoca el propio jugador al acercarse, y una sacudida de las de
        // impacto ahi se leeria como que ya le ha pasado algo.
        if (d > game.sink.s0 - SINK_TRIGGER && d < game.sink.s0 + SINK_LEN) {
            shake = Math.max(shake, SHAKE_SOFT);
        }
        if (d > game.sink.s0 + SINK_LEN + 40) game.sink.active = false;
    }

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

// El hundimiento se arma con su propio obstaculo y su propio jade, y no cabe
// nada mas: dos carriles son agujero y el tercero ya lleva algo.
function enHundido(sc) {
    if (!game.sink.active) return false;
    for (let k = -1; k <= 1; k++) {
        const q = sc + k * TRAMO_MARGEN;
        if (q > game.sink.s0 - 10 && q < game.sink.s0 + SINK_LEN + 10) return true;
    }
    return false;
}

function enEstrecho(sc) {
    for (let k = -1; k <= 1; k++) {
        if (narrowAt(sc + k * TRAMO_MARGEN) < 1) return true;
    }
    return false;
}

// El suceso de zona trae lo suyo y no cabe nada mas. Sin esto, la erupcion del
// Tajumulco caia ENCIMA del reparto normal de obstaculos y lo que salia no era
// un suceso: era ruido. Se deja pasar el jade, que es lo unico que ahi dentro
// sigue significando algo.
function enZona(sc) {
    const Z = game.zone;
    if (!Z.active) return false;
    return sc > Z.s0 - TRAMO_MARGEN && sc < Z.s0 + ZONE_LEN + TRAMO_MARGEN;
}

function generateChunk(z) {
    const hard = Math.min(game.elapsed / 95, 1);        // 0 -> 1 en poco mas de un minuto
    const sz = game.distance - z;                       // trazado de este compas

    // --- Armado de los tramos especiales ---
    // Uno por ciclo de bifurcacion, en cuanto haya sitio. Antes era un sorteo
    // al 9 % por compas y salia uno cada dos mil metros: con una probabilidad
    // no se reparte nada, solo se deja al azar decidir si el jugador llega a
    // ver una mecanica entera del juego o no.
    // --- El suceso de la zona ---
    // Una vez por visita. Comparte la comprobacion de sitio de los tramos
    // especiales, de modo que nunca cae encima de una bajada, una curva ni una
    // bifurcacion. Si no cabe, no se gasta el turno: se reintenta en el compas
    // siguiente. Y armado, no vuelve a haber turno hasta cambiar de zona.
    //
    // Va ANTES del armado de tramos, y ademas los tramos se apartan cuando le
    // toca —ver abajo—, porque el reparto no es simetrico: de tramos especiales
    // salen varios por zona y de suceso hay UNO. La primera version los ponia
    // al reves y el resultado medido era que el primer tramo especial de la
    // partida, armado a los 260 m, ocupaba la unica ventana que le quedaba al
    // suceso de Tikal antes del cruce. No salia nunca.
    // Armado, no vuelve a haber turno hasta cambiar de zona: es UNO por visita.
    // Infinity y no un numero grande porque asi tampoco entra en la ventana de
    // preferencia de abajo, que mira a nextZone - 400.
    if (!game.zone.active && game.distance > game.nextZone) {
        if (armZone()) game.nextZone = Infinity;
    }

    // El suceso tiene preferencia sobre el reparto de tramos: cuatrocientas
    // unidades antes de su turno, y hasta que se arme, no se arma nada mas.
    const zonaCerca = !game.zone.active && game.distance > game.nextZone - 400;
    if (!zonaCerca && game.distance > 260 && game.distance > game.nextTramo) {
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
    if (enEstrecho(sz) || enHundido(sz)) return;

    // Dentro del suceso de zona, solo jade. Lo que hay que resolver ahi es el
    // suceso, y lo que trae ya viene medido: anadirle el reparto normal de
    // obstaculos encima convertia la erupcion en ruido.
    if (enZona(sz)) {
        // Y el jade va por el carril LIBRE, que ademas de premiar ensena por
        // donde se pasa. Es la unica pista que hay ahi dentro.
        for (let k = 0; k < 4; k++) spawnPickup(game.zone.libre, z - k * 4, 1.3);
        return;
    }

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
    // Con una probabilidad no se reparte nada —la misma leccion que ya costo
    // los tramos especiales—. Un dado al 22 % por compas, con la mitad de los
    // compases descartados por la zona limpia de la bifurcacion y el cartel
    // racionado ademas por su cuenta, daba rutas enteras en las que la vaca o
    // la camioneta no salian NI UNA VEZ. Ahora se reparten: uno cada
    // EVENT_EVERY unidades en cuanto haya sitio, y sin repetir el anterior,
    // que es lo unico que garantiza que los tres lleguen a verse.
    if (game.distance > 240 && game.distance > game.nextEvento &&
        !limpioEntre(game.distance + 180, game.distance + 330)) {
        let ev = (Math.random() * 3) | 0;
        if (ev === game.lastEvento) ev = (ev + 1 + ((Math.random() * 2) | 0)) % 3;
        let lado = 0;
        if (ev === 0) {
            // Derrumbe: caen piedras del cerro sobre el carril de ese lado.
            lado = spawnWarn('derrumbe', z + WARN_AHEAD);
            if (lado !== 0) {
                const carril = lado < 0 ? 0 : 2;
                schedule(78, () => {
                    for (let k = 0; k < 3; k++) {
                        spawnHazard(RODANTE, carril, -120 - k * 14, 0, 22 + k * 5);
                    }
                });
            }
        } else if (ev === 1) {
            // Ganado suelto: la vaca entra por ese margen y cruza al otro.
            lado = spawnWarn('animal', z + WARN_AHEAD);
            if (lado !== 0) schedule(80, () => spawnHazard(VACA, 1, -85, lado));
        } else {
            // Parada de camioneta: mas adelante viene un bus por ese carril.
            lado = spawnWarn('parada', z + WARN_AHEAD);
            if (lado !== 0) {
                schedule(64, () => spawnHazard(BUS, lado < 0 ? 0 : 2, SPAWN_Z));
            }
        }
        // Solo cuenta si de verdad se planto: si el cartel no cabia, el turno
        // no se gasta y se vuelve a intentar en el compas siguiente.
        if (lado !== 0) {
            game.lastEvento = ev;
            game.nextEvento = game.distance + EVENT_EVERY;
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

    // 0 = destino, 1 = cortada. El de destino no sale hasta que la zona ha
    // cumplido su tiempo: dentro de una zona todos los cruces son cortadas, y
    // el que cambia de sitio es el que la cierra. Antes se alternaban, y con
    // zonas de doce minutos eso habria sido cambiar de departamento cada dos
    // cruces pasara lo que pasara.
    const cumplida = game.distance - game.zoneFrom > ZONE_SPAN;
    const ultima = Math.floor(routePos()) % REGION_N >= REGION_N - 1;
    c.kind = (cumplida && !ultima) ? 0 : 1;
    game.crossKind = c.kind;

    const here = Math.floor(routePos()) % REGION_N;
    // El destino ya NO se sortea. La ruta es una sola y va de Tikal a la
    // capital, asi que solo hay dos salidas posibles: el SIGUIENTE punto del
    // camino, o el retorno, que deja al jugador donde ya estaba. Sorteando el
    // destino, el mapa no significaba nada —se saltaba de Petén a San Marcos y
    // de ahi a Izabal— y no habia forma de estar cerca ni lejos de ninguna
    // parte. Con la ruta encadenada, cada cruce acertado es un punto menos.
    const target = Math.min(here + 1, REGION_N - 1);

    // Lo que si se sortea es el LADO, y es lo que obliga a leer el rotulo en
    // vez de memorizar. 0 = seguir la ruta es por la izquierda, 2 = derecha.
    c.swapLane = Math.random() < 0.5 ? 0 : 2;
    c.target = target;
    c.z = z - CROSS_SIGN_AHEAD;
    c.active = true;
    c.done = false;
    c.blocked = 0;

    if (c.kind === 0) {
        const izq = c.swapLane === 0;
        const nombre = (REGIONS[target].sign || REGIONS[target].name).toUpperCase();
        const depto = REGIONS[target].dept.toUpperCase();
        const aqui = (REGIONS[here].sign || REGIONS[here].name).toUpperCase();

        // Se rehacen las dos texturas: el destino y el lado cambian cada vez.
        // El rotulo bueno lleva sitio y departamento, como una senal de
        // carretera de verdad; el otro dice RETORNO y adonde no lleva.
        const put = (i, titulo, sub, flecha) => {
            if (c.sign.tex[i]) c.sign.tex[i].dispose();
            c.sign.tex[i] = signTexture(titulo, sub, flecha);
            c.sign.panels[i].material.map = c.sign.tex[i];
            c.sign.panels[i].material.needsUpdate = true;
        };
        put(0, izq ? nombre : 'RETORNO', izq ? depto : aqui, -1);
        put(1, izq ? 'RETORNO' : nombre, izq ? aqui : depto, 1);

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

    // La bifurcacion empieza donde ACABA la isleta: mientras el divisor esta
    // ahi la calzada es una sola y los dos ramales salen de su cola. s0 se
    // guarda como distancia recorrida y no como z, porque la z se mueve y la
    // coordenada de trazado no.
    game.fork.active = true;
    game.fork.s0 = game.distance - (z - CROSS_SIGN_AHEAD) + CROSS_ISLAND_LEN / 2;
    game.fork.chosen = 0;
    game.fork.mainBand = -1;

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
    // arriba: es lo que hace que el otro se aparte y se pierda de vista, y sin
    // fijarlo los dos se quedarian abiertos y paralelos hasta que la
    // bifurcacion caduca. Quien salta el divisor cae en el ramal izquierdo.
    game.fork.chosen = lane === 2 ? 1 : -1;
    game.fork.mainBand = game.fork.chosen;

    // --- Bifurcacion cortada ---
    // NO MUEVE LA RUTA. Ni avanza al siguiente punto ni retorna al actual: es
    // un obstaculo de la propia carretera, dentro del mismo tramo, y por eso
    // sale de esta funcion antes de tocar routePos. Lo unico que hay que hacer
    // es no meterse por donde el disco rojo dice que no. Si se hace, el
    // derrumbe aparece unas decenas de unidades mas alla —tiempo de verlo
    // llegar y de entender que era eso del cartel— y se apunta por donde
    // tendria que haber ido, para devolverlo ahi si decide revivir.
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
    // librar, pero entonces no se ha elegido nada, y avanzar de punto por ello
    // seria pagar por no decidir.
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

    // Solo se cruza el paisaje si de verdad se cambia de departamento
    if (destino !== desde) {
        game.snapFrom = desde;
        game.snapT = 0;
    }

    if (cambio) {
        showRegionBanner(destino);
        // Zona nueva: empieza a contar su tiempo y se apunta SU suceso, que es
        // uno y va al final del tramo.
        game.zoneFrom = game.distance;
        game.nextZone = game.distance + zoneClimaxAt();
        const id = REGIONS[destino].id;
        if (!save.regions.includes(id)) {
            save.regions.push(id);
            persist();
            refreshMinimapDots();
        }
        // Avanzar es lo unico que paga. Antes pagaba el retorno —"si no, nadie
        // lo tomaria jamas"—, y eso era premiar la respuesta equivocada: ahora
        // el camino lleva a un sitio, y quedarse ya no es media opcion sino un
        // error que cuesta setecientos ochenta metros a una velocidad que no
        // deja de subir.
        game.jade += 3;
        game.jadeScore += Math.round(75 * jadeScale());
        burstParticles(player.x, player.y + 1.2, PLAYER_Z, 18, 1.1, C.jade);

        // Y si lo que se acaba de tomar es el desvio a la capital, la carrera
        // tiene final: un ultimo tramo de ciudad y se cierra.
        if (destino === REGION_N - 1) {
            game.finishS = game.distance + FINISH_RUN;
            // Y se reapunta el suceso DENTRO del tramo final. El bloque de
            // arriba acaba de dejarlo a 9.040 como en cualquier zona, y aqui
            // eso cae mas alla de la meta.
            game.nextZone = game.distance + FINISH_RUN * FINISH_ZONE_AT;
        }
    } else {
        // El retorno deja al jugador donde estaba. El rotulo lo dice con todas
        // las letras para que no se lea como un fallo del juego.
        showBanner('Retorno', 'Sigues en ' + REGIONS[destino].name);
        sfx.region();
    }

    game.region = destino;
    hudDirty = true;
}

function updateCrossings(dt) {
    const dz = game.speed * dt;

    if (game.snapT < 1) game.snapT = Math.min(1, game.snapT + dt / SNAP_TIME);

    // --- Cual de las dos mallas lleva los carriles ---
    // La calzada detallada —la del adoquin, los avisos y las colisiones— tiene
    // que ser SIEMPRE aquella por la que el jugador va a pasar, asi que sigue
    // a su carril mientras no se ha resuelto la salida. Se hace en seco y sin
    // suavizado a proposito: antes del divisor los dos ramales son simetricos,
    // de modo que intercambiar las mallas las deja exactamente donde estaba la
    // otra y no se ve nada. Por el carril del medio no se cambia: ahi todavia
    // no se ha elegido.
    const fk = game.fork;
    if (fk.active && fk.chosen === 0) {
        if (player.lane === 0) fk.mainBand = -1;
        else if (player.lane === 2) fk.mainBand = 1;
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

    // La bifurcacion se apaga cuando el jugador la ha dejado del todo atras.
    // Para entonces el reparto ya coincide con el ramal tomado y el
    // desplazamiento de la calzada principal vale cero en todo el trazado, asi
    // que apagarla no mueve nada y no hay tiron.
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

    // El BRINCO del monopatin: mientras dura, los saltos no se cuentan y se
    // encadenan en el aire. Va antes que todo lo demas porque no depende de
    // estar en el suelo ni de tener la mejora del salto doble.
    if (game.powers.propio > 0 && vehOn === 'monopatin' && !player.grounded) {
        doJump(DOUBLE_JUMP_V * dote().salto);
        sfx.djump();
        burstParticles(player.x, player.y + 0.4, PLAYER_Z, 6, 0.6, PROPIOS.monopatin.color);
        return;
    }

    if (player.grounded || player.coyote > 0) {
        // Coyote time: un salto pulsado justo despues de dejar el borde sigue
        // valiendo. Es la queja clasica del genero cuando falta.
        // El salto del monopatin. La altura va con el CUADRADO de la velocidad
        // de salida, asi que un 16 % mas de impulso son un 34 % mas de alto: el
        // numero de la tabla parece pequeno y no lo es.
        doJump(JUMP_V * dote().salto);
        player.jumps = 1;
        sfx.jump();
    } else if (lvl('djump') > 0 && player.jumps < 2) {
        doJump(DOUBLE_JUMP_V * dote().salto);
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

        // El panel de pruebas, antes que nada y en cualquier estado. Ctrl+Shift
        // porque no lo pisa ningun control del juego —que usa flechas, WASD,
        // espacio, P, Esc, M y N a secas— y porque nadie lo pulsa sin querer.
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
            e.preventDefault();
            toggleDebug();
            return;
        }

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
    player.outMax = FALL_TIME;
    player.outKind = 0;
    player.outVX = vx;
    player.outVZ = 0;
    player.outZ = 0;
    player.vy = 2.5;                 // un empujoncito hacia arriba: se tropieza
    player.sliding = 0;
    player.wantSlide = false;
    player.grounded = false;
    game.powers.flight = 0;
    shake = 1.3;
    flashHurt(HURT_RED, 0.95);
    sfx.hit();
}

// Morir de un golpe. A diferencia de salirse, aqui SI hay suelo: el cuerpo
// sale despedido hacia atras y hacia arriba, da vueltas y rebota en la
// calzada. Cae mas despacio que en una caida de verdad —la gravedad va al 70 %—
// porque lo que hay que ver es el vuelo, no el aterrizaje.
function deathBlow() {
    if (player.out > 0 || game.state !== State.PLAYING) return;
    player.out = DEATH_TIME;
    player.outMax = DEATH_TIME;
    player.outKind = 1;
    player.outVX = (Math.random() - 0.5) * 7;
    player.outVZ = DEATH_BACK;
    player.outZ = 0;
    player.vy = DEATH_UP;
    player.sliding = 0;
    player.wantSlide = false;
    player.grounded = false;
    game.powers.flight = 0;
    shake = 1.6;
    flashHurt(HURT_RED, 1);
}

function updateFall(dt) {
    player.out -= dt;
    const golpe = player.outKind === 1;

    player.vy += GRAVITY * (golpe ? 0.7 : 1.1) * dt;
    player.y += player.vy * dt;
    player.x += player.outVX * dt;
    player.outVX *= 1 - Math.min(1, 0.7 * dt);

    if (golpe) {
        // Sale despedido hacia la camara y va frenando. Es lo que hace que el
        // golpe se vea de cerca en vez de por encima del hombro.
        player.outZ += player.outVZ * dt;
        player.outVZ *= 1 - Math.min(1, 1.6 * dt);
        // Y rebota en la calzada en vez de atravesarla: aqui hay suelo, y el
        // cuerpo hundiendose en el firme se leeria como un fallo de colision.
        if (player.y < 0.4 && player.vy < 0) {
            player.y = 0.4;
            player.vy *= -0.34;
            if (player.vy < 2) player.vy = 0;
            player.outVX *= 0.55;
        }
    }

    playerGroup.position.set(player.x, player.y, PLAYER_Z + player.outZ);
    // Da vueltas al caer. Es lo que separa una caida de un salto largo.
    playerGroup.rotation.z += dt * (golpe ? 6.5 : 4.2) * (player.outVX >= 0 ? -1 : 1);
    playerGroup.rotation.x -= dt * (golpe ? 5.4 : 2.6);
    shadowMesh.material.opacity = 0;

    if (player.out <= 0) {
        player.out = 0;
        endGame();
    }
}

// Cada poder mueve las chispas de otra manera. El color solo no basta: a esta
// velocidad dos naranjas parecidos son el mismo naranja, y la FORMA si se lee
// de un vistazo. El iman las trae en anillo cerrado y bajo, el jade doble las
// sube en espiral, el ambar las deja atras como un rastro y el vuelo las manda
// arriba dando vueltas deprisa.
const AURA_SHAPE = {
    magnet: { r: 1.4,  y: 1.2, sube: 0,   atras: 0,   giro: 3.4, onda: 0.14 },
    double: { r: 0.95, y: 0.45, sube: 2.0, atras: 0,   giro: 2.6, onda: 0.1 },
    amber:  { r: 0.8,  y: 1.05, sube: 0,   atras: 2.2, giro: 1.4, onda: 0.45 },
    flight: { r: 1.2,  y: 1.55, sube: 1.0, atras: 0,   giro: 4.8, onda: 0.22 },
    // El poder propio TIENE que estar aqui aunque sea uno solo para los cinco
    // trajes: updateAuras busca la forma por la clave del poder activo y no
    // comprueba que exista, asi que sin esta linea el juego reventaba en el
    // momento exacto de recoger la pieza. Lo destapo la sonda al primer intento.
    // Va rapido y ceñido, que es lo que le pega a un poder de vehiculo.
    propio: { r: 1.05, y: 0.95, sube: 0.6, atras: 0.8, giro: 5.4, onda: 0.18 }
};

// El poder con cuenta atras que mas dura de los que hay puestos. Si hay dos,
// manda el que va a seguir ahi: es el que el jugador tiene que tener en la
// cabeza cuando el otro se apague.
function activePower() {
    let mejor = null, t = 0;
    for (const k in game.powers) {
        if (game.powers[k] > t) { t = game.powers[k]; mejor = k; }
    }
    return mejor;
}

function updateAuras() {
    // El escudo es el unico poder sin reloj, asi que es el unico que puede
    // permitirse una forma cerrada y quieta. Respira despacio para que no se
    // confunda con una parte del personaje.
    powerAura.visible = game.shield;
    if (game.shield) {
        const b = 1 + Math.sin(game.elapsed * 3.1) * 0.05;
        powerAura.scale.set(b, b, b);
        powerAura.material.opacity = 0.17 + Math.sin(game.elapsed * 3.1) * 0.06;
    }

    const k = activePower();
    powerOrbs.visible = !!k;
    if (!k) return;
    const S = AURA_SHAPE[k];
    powerOrbs.material.color.setHex(POWERS[k].color);
    // Los ultimos dos segundos parpadea. Es el mismo aviso que da la barra del
    // HUD, puesto donde ya se esta mirando.
    const queda = game.powers[k];
    powerOrbs.material.opacity =
        queda < 2 && Math.sin(queda * 18) < 0 ? 0.18 : 0.95;

    for (let i = 0; i < AURA_ORBS; i++) {
        const f = i / AURA_ORBS;
        const a = game.elapsed * S.giro + f * Math.PI * 2;
        // Las que suben o se van hacia atras recorren su camino en bucle, cada
        // una desfasada: asi el chorro es continuo y no una tanda que aparece
        // y desaparece de golpe.
        const t = (game.elapsed * 0.9 + f) % 1;
        const sc = 0.15 + Math.sin(a * 3) * 0.035;
        dummy.position.set(
            Math.cos(a) * S.r,
            S.y + t * S.sube + Math.sin(a * 2 + game.elapsed * 4) * S.onda,
            Math.sin(a) * S.r * 0.8 + t * S.atras
        );
        dummy.scale.set(sc, sc, sc);
        dummy.rotation.set(a, a * 0.7, a * 0.4);
        dummy.updateMatrix();
        powerOrbs.setMatrixAt(i, dummy.matrix);
    }
    powerOrbs.instanceMatrix.needsUpdate = true;
}

function updatePlayer(dt) {
    if (player.out > 0) { updateFall(dt); return; }
    // Durante la vuelta no se controla nada: el cuerpo esta cayendo del cielo
    // dentro de una columna de luz, y aceptar un cambio de carril ahi dejaria
    // al corredor aterrizando de lado con la animacion a medias.
    if (player.rez > 0) { updateRez(dt); return; }

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

    // --- Ventisca ---
    // El viento de zona se suma DESPUES del carril y no lo sustituye: el
    // jugador sigue mandando sobre a que carril va, pero el viento lo saca de
    // la linea y hay que corregir. Y se recorta contra el borde de la calzada:
    // el viento descoloca, no mata, o seria una muerte que no se puede evitar.
    if (player.push !== 0) {
        const tope = ROAD_WIDTH / 2 - 0.9;
        player.x = Math.max(-tope, Math.min(tope, player.x + player.push));
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

    // El OLLIE de la patineta: la tabla salta sola lo que se salta. Mira solo
    // por delante y solo en el carril propio, y solo lo que se libra saltando:
    // el dintel, que se pasa AGACHADO, lo deja a proposito. Un automatico que
    // resuelve cuatro de cinco cosas y calla en la quinta es peor que ninguno,
    // asi que la tarjeta de la tienda lo dice con todas las letras.
    if (game.powers.propio > 0 && vehOn === 'patineta' && player.grounded) {
        for (const o of obstacles) {
            if (!o.active) continue;
            if (o.type === DINTEL || o.type === MURO) continue;
            const d = PLAYER_Z - o.z;                  // lo que le falta por llegar
            if (d < 2.5 || d > 13) continue;
            if (!WIDE[o.type] && Math.abs(player.x - LANE_X[o.lane]) > LANE_HALF) continue;
            jump();
            break;
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

    if (vehOn) {
        // Encima de cualquier vehiculo no hay tumbada ni aplastamiento:
        // agacharse es meterse hacia delante, y el cuerpo no se estira porque
        // debajo hay algo rigido que no da de si. Lo que cambia entre uno y
        // otro es cuanto se echa y a que altura van los pies.
        playerBody.scale.set(1, 1, 1);
        const echa = vehOn === 'bici' ? -0.42 : vehOn === 'patineta' ? -0.14 : -0.2;
        const agacha = vehOn === 'patineta' ? -0.72 : -0.62;
        playerBody.rotation.x = sliding
            ? agacha
            : echa - (game.speed - SPEED_START) * 0.004;
        // La altura de la tabla: en la patineta y el monopatin el jinete va DE
        // PIE encima, asi que el cuerpo entero sube. Sentado, esto vale cero.
        playerBody.position.y = (vehAct ? vehAct.alto : 0) + (sliding ? -0.1 : 0);
        // Vibracion del motor, muy corta y muy rapida, y solo en la moto: es lo
        // unico que hace que una moto parada en el sitio no parezca una
        // pegatina, y una bici no vibra.
        playerBody.rotation.z = motoOn ? Math.sin(game.elapsed * 46) * 0.006 : 0;
    } else {
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
    }

    // Inclinacion lateral: se calcula contra el destino, asi que el cuerpo se
    // tumba al salir y se endereza al llegar.
    const lean = (LANE_X[player.lane] - player.x) / 2.3;
    playerGroup.rotation.z = -lean * 0.34;
    // Y el desvio: el personaje tuerce con su calzada. La camara gira lo mismo,
    // asi que en pantalla se le sigue viendo de espaldas y lo que rota es el
    // mundo, que es exactamente lo que pasa cuando uno toma una salida.
    playerGroup.rotation.y = lean * 0.28 + forkCamYaw();

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
    } else if (vehOn) {
        const tuck = sliding ? 1 : 0;
        playerParts.torso.position.y = 1.28;

        if (vehOn === 'moto') {
            // Sentado: brazos al manillar, rodillas dobladas y pies en las
            // estriberas. Las piernas van a rotacion NEGATIVA para que la
            // cadera las mande hacia delante, que es donde estan los estribos.
            playerParts.armL.rotation.set(-1.5 + tuck * 0.28, 0, 0.3);
            playerParts.armR.rotation.set(-1.5 + tuck * 0.28, 0, -0.3);
            playerParts.legL.rotation.set(-1.15, 0, 0.16);
            playerParts.legR.rotation.set(-1.15, 0, -0.16);
            playerParts.head.rotation.set(0.2 + tuck * 0.34, 0, 0);

        } else if (vehOn === 'bici') {
            // PEDALEA. Es lo unico que separa a una bici de una moto sin motor,
            // y va con player.run, o sea con la distancia recorrida: parado, los
            // pies se paran. Las dos piernas en contrafase, como el pedal.
            playerParts.armL.rotation.set(-1.32 + tuck * 0.2, 0, 0.2);
            playerParts.armR.rotation.set(-1.32 + tuck * 0.2, 0, -0.2);
            playerParts.legL.rotation.set(-0.88 + s * 0.46, 0, 0.1);
            playerParts.legR.rotation.set(-0.88 - s * 0.46, 0, -0.1);
            playerParts.head.rotation.set(0.42 + tuck * 0.3, 0, 0);

        } else if (vehOn === 'patineta') {
            // DE PIE y sin nada a que agarrarse: los brazos van abiertos y
            // desiguales, que es como se mantiene el equilibrio de verdad. Los
            // pies escalonados, uno delante y otro detras, que es la postura
            // que hace que una tabla se lea como una tabla.
            const balan = Math.sin(game.elapsed * 2.4) * 0.12;
            playerParts.armL.rotation.set(-0.5 + balan, 0, 1.0);
            playerParts.armR.rotation.set(-0.28 - balan, 0, -1.15);
            playerParts.legL.rotation.set(-0.34, 0, 0.22);
            playerParts.legR.rotation.set(0.24, 0, -0.26);
            playerParts.head.rotation.set(0.16 + tuck * 0.38, 0, 0);

        } else {
            // Monopatin: de pie pero agarrado, que es justo lo contrario. Un pie
            // en la tabla y el otro recogido detras, listo para empujar.
            playerParts.armL.rotation.set(-1.42 + tuck * 0.22, 0, 0.14);
            playerParts.armR.rotation.set(-1.42 + tuck * 0.22, 0, -0.14);
            playerParts.legL.rotation.set(-0.12, 0, 0.1);
            playerParts.legR.rotation.set(0.4, 0, -0.12);
            playerParts.head.rotation.set(0.18 + tuck * 0.34, 0, 0);
        }
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

    // Las ruedas. Giran con el mundo y no con el reloj, asi que a poca
    // velocidad ruedan despacio: si fueran con el reloj, frenar dejaria la moto
    // parada con las ruedas a tope, que es lo que delata a un juguete.
    if (vehAct) {
        // Y giran segun SU radio: la rueda de la patineta mide 0,15 y la de la
        // bici 0,64, asi que a la misma velocidad la pequena tiene que dar
        // cuatro vueltas por cada una de la grande. Con una tasa fija, las
        // ruedas pequenas se veian patinando.
        const giro = -player.run * (0.52 / vehAct.radio) * 1.6;
        for (const w of vehAct.ruedas) w.rotation.x = giro;
        // En el aire el vehiculo levanta el morro, y al aterrizar lo baja.
        const aire = player.grounded ? 0 : (player.vy > 0 ? 1 : -0.55);
        vehAct.group.rotation.x = aire * 0.16 - squashK * 0.1;
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

    updateAuras();

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
        } else if (h.type === RODANTE || h.type === BOMBA) {
            // Las del derrumbe caen del cerro antes de empezar a rodar.
            // Mientras estan en el aire su ancla va alta, y como la franja de
            // golpe se mide desde el ancla, no golpean hasta tocar la calzada:
            // sale gratis y es lo correcto.
            if (h.drop > 0) {
                h.dropV -= 62 * dt;
                h.drop = Math.max(0, h.drop + h.dropV * dt);
                // Mientras la piedra esta en el aire, el suelo ya retumba. Es
                // lo que hace que el derrumbe se SIENTA venir en vez de
                // aparecer: cuando llega la sacudida del impacto, el jugador ya
                // sabia que algo se estaba cayendo.
                shake = Math.max(shake, SHAKE_FALL);
                if (h.drop === 0) {
                    // Y el impacto, escalado con lo cerca que cae. Nunca por
                    // debajo del retumbo: una piedra lejana golpea flojo, pero
                    // golpea.
                    const cerca = Math.max(0, 1 + Math.min(0, h.z) / SHAKE_NEAR);
                    shake = Math.max(shake, SHAKE_ROCK * (0.62 + 0.38 * cerca));
                    // La bomba volcanica revienta en brasas, no en polvo.
                    burstParticles(x, riseAtZ(h.z), h.z, h.type === BOMBA ? 14 : 10,
                                   1, h.type === BOMBA ? 0xff8a4a : 0x8a7a68);
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

    // --- La vida del sitio ---
    // Un bicho cada FAUNA_EVERY unidades, del tipo que le toque a la zona, y
    // motas de ambiente cayendo todo el rato. Es lo unico del juego que se
    // mueve sin querer nada del jugador.
    const zr = ZONES[REGIONS[Math.floor(routePos()) % REGION_N].id];
    if (zr && game.distance > game.nextFauna) {
        game.nextFauna = game.distance + FAUNA_EVERY * (0.7 + Math.random() * 0.7);
        if (zr.vida !== 'none') {
            spawnFauna(zr.vida, zr.vida === 'pez'
                ? -40 - Math.random() * 80          // cruza por delante, a la vista
                : -60 - Math.random() * 90, zr.bicho);
        }
    }
    updateFauna(dt, dz);

    // --- La publicidad de la calzada ---
    // Cada VALLA_EVERY unidades, y con el runner puesto dos veces y media mas
    // seguido: el runner corre una CARRERA, no un camino, y una carrera se
    // reconoce porque el margen esta forrado de anuncios. Una de cada cuatro va
    // cruzada por encima, que es lo que rompe la fila de paneles al mismo lado.
    if (game.distance > game.nextValla) {
        const cada = runnerOn ? VALLA_RUNNER : VALLA_EVERY;
        game.nextValla = game.distance + cada * (0.75 + Math.random() * 0.5);
        // Nunca encima de la bifurcacion: ahi hay que leer el rotulo verde y un
        // anuncio al lado es exactamente lo que no debe haber.
        if (!limpioEntre(game.distance - SPAWN_Z - 60, game.distance - SPAWN_Z + 60)) {
            spawnValla(SPAWN_Z, Math.random() < 0.25);
        }
    }
    updateVallas(dz);

    // Motas: pocas y constantes. No son un suceso, son el aire del sitio.
    if (zr && Math.random() < 0.05) {
        burstParticles(
            player.x + (Math.random() - 0.5) * 26,
            5 + Math.random() * 8,
            PLAYER_Z - 15 - Math.random() * 80,
            1, 0.5, zr.polvo
        );
    }

    // La estructura de fin de zona viaja como cualquier otra cosa del mundo
    if (gate && gate.active) {
        const antes = gate.z;
        gate.z += dz;
        gate.group.position.set(curveOf(gate), riseOf(gate), gate.z);
        // Confeti justo al pasar POR DEBAJO, no al verla ni al dejarla atras.
        // Cerrar una zona es lo unico que se consigue sin que te lo den, y en
        // una carrera de verdad el confeti cae exactamente ahi.
        if (antes < PLAYER_Z && gate.z >= PLAYER_Z) throwConfeti(PLAYER_Z - 8, 16);
        if (gate.z > DESPAWN_Z + 14) {
            gate.active = false;
            gate.group.visible = false;
        }
    }

    updateCrossings(dt);
    updateTrackSystems(dt);
    updateZone(dt);
    runPending();

    // --- Nuevos compases ---
    // El hueco se estrecha con el tiempo, pero nunca por debajo de lo que el
    // jugador alcanza a leer: a velocidad maxima 24 unidades son ~0.8 s.
    // --- Distribuidor vial ---
    // Se dispara por distancia y no dentro de un compas: tiene que aparecer
    // donde toca, no cuando le venga bien al generador.
    // --- El arco de fin de zona ---
    // Se planta GATE_AHEAD antes que el cruce, y solo antes del que cambia de
    // sitio: los cruces alternan destino y cortada, asi que el proximo sera el
    // contrario del ultimo. Pasa por debajo unas cuatrocientas unidades antes
    // del distribuidor, que es el tiempo que hace falta para verlo venir desde
    // que asoma en la bruma.
    if (gate && !gate.active && game.finishS < 0 &&
        game.distance > game.nextCross - GATE_AHEAD &&
        game.distance - game.zoneFrom > ZONE_SPAN &&
        Math.floor(routePos()) % REGION_N < REGION_N - 1) {
        const zs = ZONES[REGIONS[Math.floor(routePos()) % REGION_N].id];
        spawnGate(SPAWN_Z, zs ? zs.gate : GATE_ARCO);
    }

    // Con la llegada ya tomada no se planta ninguno mas: el ultimo tramo de
    // ciudad es de una sola pieza, sin nada que elegir.
    if (game.finishS < 0 && game.distance > game.nextCross) {
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
    if (player.out > 0 || player.rez > 0) return;
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

    // Lo mismo por el firme que se hundio, y por el mismo motivo: no es un
    // golpe del que protegerse, es que no hay suelo. Cae en vertical, sin
    // empujon lateral: no le ha dado nada, se ha ido lo que pisaba.
    if (!flying && player.y < 1.3 &&
        sinkHole(game.distance, sinkSlabAt(player.x))) {
        fallOut(0);
        return;
    }

    // --- Fuerza centrifuga en la curva cerrada ---
    // Aguantar por el lado de FUERA de la curva acaba sacandote de la
    // carretera: es hacia donde tira la inercia, y es el carril pintado de
    // rojo. Se cuenta el tiempo y se descuenta al doble en cuanto te apartas:
    // castiga quedarse, no pasar.
    const giro = turnGrip(game.distance);
    if (giro > 0.25 && !flying) {
        const fuera = game.turn.dir < 0 ? 2 : 0;
        if (player.lane === fuera) {
            game.turnHold += 1 / 60;
            if (game.turnHold > TURN_HOLD) {
                game.turnHold = 0;
                // Hacia fuera, que es donde tira la inercia.
                fallOut(-game.turn.dir * 16);
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

        if (!hit) continue;

        // La EMBESTIDA de la moto: lo que se pueda romper, se rompe. Pero NO
        // los huecos ni el muro del ramal cortado: un agujero no se embiste, se
        // cae uno dentro, y el muro es la consecuencia de haberse metido por
        // donde decia que no. Dejar que se atraviese convertiria la unica
        // decision del cruce en un tramite.
        if (embistiendo() && o.type !== VACIO && o.type !== CENOTE && o.type !== MURO) {
            romper(o.group.position.x, o.baseY + 1, o.z);
            o.active = false;
            o.group.visible = false;
            continue;
        }
        takeHit();
        return;
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

        if (!(head > lo && feet < hi)) continue;

        // Las amenazas SI se embisten todas: son bichos, piedras y camionetas,
        // y ninguna es una decision del jugador ni un agujero en el suelo.
        if (embistiendo()) {
            romper(h.group.position.x, h.y, h.z);
            h.active = false;
            h.group.visible = false;
            continue;
        }
        takeHit();
        return;
    }
}

// La embestida esta activa. Se pregunta en dos sitios del bucle de colisiones,
// asi que vale la pena tenerla escrita una vez.
const embistiendo = () => game.powers.propio > 0 && vehOn === 'moto';

// Lo que se lleva por delante se rompe A LA VISTA. Sin esto, un obstaculo
// embestido simplemente desaparecia, que se lee como un fallo de dibujo y no
// como haberselo llevado puesto.
function romper(x, y, z) {
    burstParticles(x, y, z, 14, 1.4, PROPIOS.moto.color);
    shake = Math.max(shake, 0.5);
    sfx.shieldBreak();
    game.jade += 1;
    game.jadeScore += Math.round(20 * jadeScale());
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
        burstParticles(x, y, z, 8, 0.85, runnerOn ? C.agua : C.jade);

        // El pachon del runner. Cien gotas lo llenan y valen una vida, y el
        // contador vuelve a cero: es una vida que se GANA corriendo bien, no
        // una que se compra, y por eso no tiene tope de mejoras ni cuesta jade.
        if (runnerOn) {
            // El SEGUNDO AIRE: cada gota cuenta por dos. No cambia el jade
            // —eso seria el poder del doble, que ya existe— sino lo que llena
            // el pachon, que es lo unico que el runner tiene y nadie mas.
            game.gotas += game.powers.propio > 0 ? 2 : 1;
            if (game.gotas >= GOTAS_VIDA) {
                // A cero y no restando: con el segundo aire se puede llegar a
                // 101, y arrastrar esa gota suelta a la siguiente vuelta seria
                // un detalle que nadie ve y que descuadra el contador del HUD.
                game.gotas = 0;
                // Solo hasta el maximo de la partida: pasarse de ahi
                // desbordaria los rombos del HUD, que se dibujan contra
                // maxLives(). Si ya va lleno, el agua se bebe y ya esta.
                const cabe = game.lives < maxLives();
                if (cabe) game.lives++;
                sfx.shield();
                burstParticles(player.x, player.y + 1.4, PLAYER_Z, 26, 1.6, C.agua);
                showBanner('PACHÓN LLENO', cabe ? 'Una vida más' : 'Un trago');
            }
            fillPachon();
        }
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

// El destello se arma con su color; la opacidad la baja el bucle de frames.
function flashHurt(rgb, fuerza) {
    game.hurt = HURT_TIME;
    game.hurtMax = fuerza;
    dom.hitVeil.style.background =
        'radial-gradient(ellipse at 50% 52%, rgba(' + rgb +
        ', 0.10) 18%, rgba(' + rgb + ', 0.94) 100%)';
}

// Destello del golpe: entra lleno y se despeja al cuadrado, en vez de dejar
// media pantalla tenida durante todo el margen de invulnerabilidad.
function updateHurt(dt) {
    if (game.hurt <= 0) return;
    game.hurt = Math.max(0, game.hurt - dt);
    const k = game.hurt / HURT_TIME;
    dom.hitVeil.style.opacity = (k * k * game.hurtMax).toFixed(3);
}

function takeHit() {
    // El modo invulnerable del panel de pruebas. Se come el golpe ENTERO —ni
    // vida, ni escudo, ni destello— porque su unico proposito es poder llegar
    // andando hasta el final de una zona a mirar el paisaje.
    if (dbg.god) { game.invuln = INVULN_TIME; return; }

    game.invuln = INVULN_TIME;
    game.combo = 0;
    jadeStreak = 0;

    // El casco va PRIMERO, antes incluso que el escudo: es lo que llevas puesto
    // encima de todo lo demas. Uno por carrera y no vuelve —revivir devuelve el
    // escudo, no el casco—, porque si se repusiera la moto no seria un traje con
    // ventaja sino un traje con otra regla de vidas.
    if (game.casco) {
        game.casco = false;
        playerParts.casco.visible = false;
        shake = 0.7;
        flashHurt(HURT_AMBER, 0.55);
        sfx.shieldBreak();
        burstParticles(player.x, player.y + 1.9, PLAYER_Z, 20, 1.3, C.ochre);
        hudDirty = true;
        return;
    }

    // El escudo absorbe el golpe antes que las vidas. Se acusa distinto: el
    // escudo cuesta algo que se puede volver a encontrar, perder una vida no.
    // Mismo lenguaje, distinta intensidad y distinto color, para que se
    // distingan sin mirar el HUD justo cuando no hay tiempo de mirarlo.
    if (game.shield) {
        game.shield = false;
        shake = 0.55;
        flashHurt(HURT_AMBER, 0.5);
        sfx.shieldBreak();
        burstParticles(player.x, player.y + 1.2, PLAYER_Z, 18, 1.2, C.ochre);
        hudDirty = true;
        return;
    }

    game.lives--;
    shake = 1.05;
    flashHurt(HURT_RED, 0.88);
    sfx.hit();
    burstParticles(player.x, player.y + 1.2, PLAYER_Z, 22, 1.5, 0xef4444);
    hudDirty = true;

    if (game.lives <= 0) deathBlow();
}

function updatePowers(dt) {
    let changed = false;
    if (game.boost > 0) {
        game.boost = Math.max(0, game.boost - dt);
        if (game.boost === 0) changed = true;
    }
    for (const k of ['magnet', 'double', 'amber', 'flight', 'propio']) {
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

// El mismo rotulo servia para dos cosas que no se parecen en nada: "has
// llegado a un sitio nuevo" y "esta pasando algo aqui". Y como el suceso de la
// zona se repite unas ocho veces por visita, el jugador veia "Vuelo de
// camazotz / Tikal" en verde jade, igual que "Tikal / Petén", y ocho veces por
// zona creia haber cambiado de departamento. Ahora el suceso sale en ocre, con
// la palabra PELIGRO debajo en vez del nombre del sitio: dos rotulos que no se
// pueden confundir ni de reojo.
function showBanner(titulo, sub, peligro) {
    dom.banner.firstElementChild.textContent = titulo;
    dom.banner.lastElementChild.textContent = sub;
    dom.banner.hidden = false;
    dom.banner.classList.remove('show');
    dom.banner.classList.toggle('evento', !!peligro);
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
const hudLast = { lives: -1, shield: null, casco: null, gotas: -1, jade: -1, dist: -1, combo: -1 };

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

    if (game.casco !== hudLast.casco) {
        hudLast.casco = game.casco;
        dom.casco.hidden = !game.casco;
    }

    // El pachon. Solo aparece con el runner puesto: los otros dos trajes no
    // tienen nada que contar ahi y un contador a cero permanente es ruido.
    if (game.gotas !== hudLast.gotas) {
        hudLast.gotas = game.gotas;
        if (runnerOn) {
            dom.pachon.hidden = false;
            dom.pachon.firstElementChild.style.width =
                Math.round(game.gotas / GOTAS_VIDA * 100) + '%';
            dom.pachonN.textContent = game.gotas + '/' + GOTAS_VIDA;
        } else if (!dom.pachon.hidden) {
            dom.pachon.hidden = true;
        }
    }

}

// ---------------------------------------------------------------------------
// Las barras de cuenta atras
// ---------------------------------------------------------------------------
// Van APARTE de renderHud, y esto era un fallo de verdad. renderHud solo corre
// cuando hudDirty esta puesto, y hudDirty solo se pone cuando algo CAMBIA de
// estado: se recoge un poder, se gasta una vida, se acaba el ambar. Pero una
// barra de cuenta atras no cambia de estado, cambia de ANCHO sesenta veces por
// segundo, asi que estaba dentro de la puerta equivocada: se pintaba al 100 %
// al recoger el poder, se quedaba clavada ahi los nueve segundos y desaparecia
// de golpe al caducar. Las cinco barras del HUD no se movian.
//
// Y se arregla sin pagar lo que renderHud queria ahorrar: se escribe el ancho
// en enteros y solo cuando el entero cambia. Un poder de nueve segundos hace
// cien escrituras en total —once por segundo— en vez de 540, y con nada puesto
// no hace ninguna.
const barLast = { boost: -1, magnet: -1, flight: -1, double: -1, amber: -1, propio: -1 };

function setBar(el, key, frac) {
    const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (pct === barLast[key]) return;
    barLast[key] = pct;
    el.firstElementChild.style.width = pct + '%';
}

function renderBars() {
    if (game.boost > 0) {
        if (dom.pw.boost.hidden) dom.pw.boost.hidden = false;
        setBar(dom.pw.boost, 'boost', game.boost / BOOST_TIME);
    } else if (!dom.pw.boost.hidden) {
        dom.pw.boost.hidden = true;
        barLast.boost = -1;
    }

    for (const k of ['magnet', 'flight', 'double', 'amber', 'propio']) {
        const el = dom.pw[k];
        const t = game.powers[k];
        if (t <= 0) {
            if (!el.hidden) { el.hidden = true; barLast[k] = -1; }
            continue;
        }
        if (el.hidden) el.hidden = false;
        setBar(el, k, t / game.powerMax[k]);
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
    hudLast.casco = null;
    hudLast.gotas = -1;
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
const _cZ = new THREE.Color();
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

// Cuanto se lleva recorrido hacia el proximo distribuidor, de 0 a 1. Y en el
// ultimo tramo, lo que falta para la meta: es lo que hay que saber ahi.
function crossProgress() {
    const t = game.finishS >= 0
        ? 1 - (game.finishS - game.distance) / FINISH_RUN
        : 1 - (game.nextCross - game.distance) / CROSS_EVERY;
    return Math.max(0, Math.min(1, t));
}

// ---------------------------------------------------------------------------
// Cuanto falta para cambiar de sitio
// ---------------------------------------------------------------------------
// Con zonas de doce minutos y un cruce cada veinte segundos, la pregunta que el
// jugador se hace todo el rato es "¿este cruce me saca de aqui?". Sin
// respuesta, los treinta y pico cruces de una zona se leen todos igual, y la
// unica forma de enterarse es tomar uno y ver que pasa.
//
// La respuesta no es "cuanto falta para que se cumpla el tiempo": la zona se
// cierra en el primer CRUCE posterior a que se cumpla, asi que lo que hay que
// contar son las unidades hasta ese cruce concreto. Ni una menos, o el rotulo
// llegaria a cero con el cambio todavia a un cruce de distancia.
function zoneProgress() {
    return Math.min(1, (game.distance - game.zoneFrom) / ZONE_SPAN);
}

function zoneAhead() {
    if (game.finishS >= 0) return Math.max(0, game.finishS - game.distance);

    // El cruce QUE YA VIENE DE FRENTE cuenta primero. nextCross salta a la
    // siguiente en el mismo momento en que se planta una, asi que durante las
    // 247 unidades en las que el distribuidor se acerca —que es justo cuando el
    // dato importa, porque es cuando hay que decidir carril— mirar solo a
    // nextCross se saltaba el cruce que se tiene delante y anunciaba mil
    // doscientas unidades de mas. El rotulo decia "faltan 1 400" con el cambio
    // de departamento a cuatro segundos.
    const vivo = game.nextCross - CROSS_EVERY + CROSS_ISLAND_AT;
    if (game.crossKind === 0 && vivo > game.distance) return vivo - game.distance;

    let c = game.nextCross;
    while (c - game.zoneFrom <= ZONE_SPAN) c += CROSS_EVERY;
    return Math.max(0, c + CROSS_ISLAND_AT - game.distance);
}

// Miles con espacio fino. A doce minutos por zona los numeros llegan a cinco
// cifras y "48960" en un HUD de tres milimetros no se lee, se descifra.
function milesDe(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function applyBlend(pos) {
    const i = Math.floor(pos) % REGION_N;
    // El siguiente de la ruta, no el siguiente del array dando la vuelta: la
    // ruta se acaba en la capital y despues de ella no hay nada.
    const j = Math.min(i + 1, REGION_N - 1);
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

    // Y encima de todo, el suceso de zona. Va DESPUES de la mezcla de
    // departamento y no dentro: es un estado pasajero, no un sitio, y tiene que
    // poder tenirlo todo sin ensuciar la region a la que pertenece. Es la mitad
    // de lo que hace que una erupcion se lea como una erupcion: sin el aire
    // rojo, las bombas volcanicas serian piedras naranjas en un dia normal.
    //
    // Y va DESPUES DE LAS CUATRO LUCES, no en medio. Estaba entre el sol y el
    // hemisferico, asi que la linea siguiente le pisaba el tinte del segundo:
    // la escena se tenia a medias y con las luces peleandose.
    const zg = zoneGrip(game.distance);
    if (zg > 0) {
        const zs = ZONES[REGIONS[game.zone.i].id];
        if (zs) {
            _cZ.setHex(zs.tint);
            scene.fog.color.lerp(_cZ, zg * 0.88);
            groundMesh.material.color.lerp(_cZ, zg * 0.5);
            sunLight.color.lerp(_cZ, zg * 0.55);
            sunLight.intensity *= 1 - zg * 0.4;
            hemiLight.color.lerp(_cZ, zg * 0.5);
            hemiLight.groundColor.lerp(_cZ, zg * 0.5);
        }
    }

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
    // Primero los caminos: un segmento por cada par de puntos consecutivos de
    // la ruta. Son lo que hace legible que esto es un recorrido y no una
    // coleccion de sitios, y ademas dicen cuantas paradas faltan para la
    // capital sin escribir un solo numero.
    for (let i = 0; i + 1 < REGION_N; i++) {
        const ln = document.createElementNS(ns, 'line');
        ln.setAttribute('x1', REGIONS[i].mm[0]);
        ln.setAttribute('y1', REGIONS[i].mm[1]);
        ln.setAttribute('x2', REGIONS[i + 1].mm[0]);
        ln.setAttribute('y2', REGIONS[i + 1].mm[1]);
        ln.setAttribute('class', 'mm-leg');
        dom.mmRoute.appendChild(ln);
    }
    REGIONS.forEach((R, i) => {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', R.mm[0]);
        dot.setAttribute('cy', R.mm[1]);
        dot.setAttribute('r', i === REGION_N - 1 ? '2.9' : '2.2');
        dot.setAttribute('class', 'mm-dot' + (i === REGION_N - 1 ? ' goal' : ''));
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
let mmLastLeg = -1;
let mmLastLeft = -1;
let mmLastX = '', mmLastY = '';
let mmLastCross = -1, mmLastZone = -1;

// Los caminos recorridos EN ESTA CARRERA, no los de siempre. Los puntos si
// recuerdan lo alcanzado alguna vez —son el mapa de lo descubierto—, pero el
// trazo tiene que decir por donde va uno ahora.
function paintRouteLegs(upto) {
    if (upto === mmLastLeg) return;
    mmLastLeg = upto;
    const legs = dom.mmRoute.children;
    for (let k = 0; k < legs.length; k++) legs[k].classList.toggle('done', k < upto);
}

function renderMinimap(i, j, raw, e) {
    // El marcador viaja del punto actual al siguiente durante la transicion,
    // asi que el mapa se mueve incluso mientras el nombre no cambia.
    // Con memoria de lo ultimo escrito. El marcador solo se mueve durante el
    // cruce de departamento —que dura segundo y medio de los tres minutos que
    // dura una zona— y las dos barras avanzan un uno por ciento cada varios
    // segundos, asi que esto eran cuatro escrituras al DOM por frame, con sus
    // cuatro cadenas nuevas, para mover numeros que el 99 % del tiempo son los
    // mismos. Comparar cuatro cadenas sale mucho mas barato que escribirlas.
    const A = REGIONS[i].mm, B = REGIONS[j].mm;
    const cx = lerp(A[0], B[0], e).toFixed(1);
    const cy = lerp(A[1], B[1], e).toFixed(1);
    if (cx !== mmLastX) { mmLastX = cx; dom.mmYou.setAttribute('cx', cx); }
    if (cy !== mmLastY) { mmLastY = cy; dom.mmYou.setAttribute('cy', cy); }
    paintRouteLegs(i);

    if (REGIONS[i].id !== mmLastName) {
        mmLastName = REGIONS[i].id;
        dom.mmName.textContent = REGIONS[i].name;
        dom.mmDept.textContent = REGIONS[i].dept;
    }
    // La barra ya no mide el avance dentro del departamento —no hay tal cosa,
    // la ruta esta quieta— sino lo que falta para el proximo cruce, que es lo
    // unico que puede cambiarlo. Y en el ultimo tramo, lo que falta para la
    // meta.
    const pc = Math.round(raw * 100);
    if (pc !== mmLastCross) { mmLastCross = pc; dom.mmFill.style.width = pc + '%'; }

    // Y debajo, la otra cuenta: la de la ZONA. Son dos relojes distintos y por
    // eso son dos barras: la de arriba dice cuando toca elegir y la de abajo
    // cuando esa eleccion te saca de aqui.
    const zp = zoneProgress();
    const pz = Math.round(zp * 100);
    if (pz !== mmLastZone) { mmLastZone = pz; dom.mmZone.style.width = pz + '%'; }

    // El texto en decenas de metro: a cero coma cinco segundos por unidad,
    // repintar cada metro es reescribir el DOM sesenta veces por segundo para
    // mover una cifra que nadie mira a esa resolucion.
    const falta = zoneAhead();
    const paso = Math.round(falta / 10);
    if (paso !== mmLastLeft) {
        mmLastLeft = paso;
        if (game.finishS >= 0) {
            dom.mmGoal.textContent = 'Meta · ' + milesDe(falta) + ' m';
        } else if (zp >= 1) {
            // Cumplida: el proximo cruce ES el que cambia de sitio, y eso hay
            // que decirlo con todas las letras porque es la unica vez en doce
            // minutos que elegir salida importa.
            dom.mmGoal.textContent = REGIONS[j].name + ' · en el próximo cruce';
        } else {
            dom.mmGoal.textContent = REGIONS[j].name + ' · ' + milesDe(falta) + ' m';
        }
        dom.mmGoal.classList.toggle('listo', zp >= 1 && game.finishS < 0);
    }
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
    // El casco viene con el traje, no con las mejoras: se tiene por llevar la
    // moto puesta y se recupera al empezar otra carrera, no al revivir.
    game.casco = motoOn;
    playerParts.casco.visible = motoOn;
    // El pachon empieza vacio en cada carrera: es agua que se bebe, no una
    // mejora que se guarda.
    game.gotas = 0;
    fillPachon();
    game.invuln = 0;
    game.elapsed = 0;
    game.nextMilestone = MILESTONE_EVERY;
    game.best = save.best;
    // Siempre se sale de Petén: la ruta es una y empieza en Tikal.
    game.startRegion = 0;
    game.region = 0;
    for (const k of POWER_KEYS) if (k !== 'shield') game.powers[k] = 0;
    game.boost = 0;
    game.boostTaken = 0;
    game.boostPerm = 0;
    game.hurt = 0;
    dom.hitVeil.style.opacity = '0';
    game.nextTramo = 0;
    game.lastTramo = -1;
    game.nextEvento = 0;
    game.lastEvento = -1;
    // Tikal tambien tiene el suyo, y es el primero que se ve en la vida. Va en
    // el mismo sitio que en cualquier otra zona —al final del tramo— porque a
    // Tikal se entra por la salida en vez de por un cruce, pero su tramo dura
    // exactamente lo mismo que los demas.
    game.nextZone = zoneClimaxAt();
    game.zoneFrom = 0;
    game.nextFauna = 120;
    game.nextValla = 260;
    game.gotas = 0;
    for (const v of vallas) { v.active = false; v.group.visible = false; }
    game.zone.active = false;
    game.zone.k = 0;
    player.push = 0;
    game.crossKind = 1;
    game.routePos = 0.02;
    game.finishS = -1;
    game.won = false;
    mmLastLeg = -1;
    game.roadS0 = -1;
    game.roadFrom = 0;
    game.nextCross = CROSS_EVERY;
    game.fork.active = false;
    game.fork.chosen = 0;
    game.fork.mainBand = -1;
    game.turn.active = false;
    game.turnHold = 0;
    game.narrowS0 = -1;
    game.sink.active = false;
    game.wrongC = null;
    game.snapT = 1;
    game.crossTaken = 0;
    game.lastWarn = -999;
    game.slopeS0 = -1;
    game.adUsed = false;
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
    player.rez = 0;
    player.outVX = 0;
    player.outVZ = 0;
    player.outZ = 0;
    player.outKind = 0;
    player.push = 0;
    playerGroup.position.z = PLAYER_Z;
    playerGroup.rotation.set(0, 0, 0);
    shadowMesh.material.opacity = 0.4;
    if (rezBeam) { rezBeam.visible = false; rezBeam.material.opacity = 0; }
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
    mmLastLeft = -1;
    mmLastX = ''; mmLastY = '';
    mmLastCross = -1; mmLastZone = -1;
    for (const k in barLast) barLast[k] = -1;
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

// Morir ya no cierra la carrera directamente: se ofrece volver mientras quede
// con que. Hay dos monedas y son independientes —el anuncio del patrocinador,
// una vez por carrera, y los angeles comprados, hasta tres—, asi que una
// carrera admite cuatro vueltas. Solo cuando no queda ninguna se cierra.
function endGame() {
    if (!game.adUsed || save.angels > 0) { offerRevive(); return; }
    finishGame();
}

// Llegar a la capital. Es la unica forma de terminar una carrera sin morir, y
// paga de golpe lo que doce desvios acertados valen: sin premio, llegar seria
// solo dejar de jugar.
function winGame() {
    game.won = true;
    game.jade += 40;
    game.jadeScore += Math.round(2000 * jadeScale());
    burstParticles(player.x, player.y + 1.2, PLAYER_Z, 40, 1.8, C.jade);
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
    const cartel = dom.shortHost.querySelector('.ad-poster');
    if (cartel) cartel.remove();
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

    // El boton del angel, si queda alguno. Va SIEMPRE arriba del todo y sin
    // reloj: quien ha pagado por el no tiene que esperar diez segundos a que
    // se le permita usar lo que ya compro.
    const conAngel = save.angels > 0;
    dom.angelBtn.hidden = !conAngel;
    dom.angelBtn.textContent = 'Usar ángel · quedan ' + save.angels;

    // Gastado el anuncio, el panel deja de ser un anuncio. Volver a plantar un
    // video de treinta segundos delante de alguien que ya lo vio esta carrera y
    // que ademas trae su propio angel es cobrarle dos veces por lo mismo.
    if (game.adUsed) {
        dom.reviveAd.hidden = true;
        dom.reviveTimer.hidden = true;
        dom.reviveSub.textContent = save.angels > 1
            ? 'Te quedan ' + save.angels + ' ángeles. Uno te levanta aquí mismo, ' +
              'con una vida y el escudo puesto.'
            : 'Te queda un ángel. Te levanta aquí mismo, con una vida y el ' +
              'escudo puesto.';
        dom.reviveBtn.hidden = true;
        dom.revive.hidden = false;
        return;
    }
    dom.reviveAd.hidden = false;
    dom.reviveTimer.hidden = false;
    dom.reviveBtn.hidden = false;

    // Uno de cada veinte lleva video; el resto, cartel. El video pide un
    // iframe a un tercero, arranca solo y tarda; el cartel es una imagen del
    // propio origen y esta puesta antes de que el jugador levante la vista.
    const cartel = pickAd(CEFAS.posters);
    const list = CEFAS.shorts;
    const conVideo = list.length && (!cartel || Math.random() < CEFAS.videoOdds);

    if (cartel && !conVideo) {
        dom.reviveSub.textContent =
            'Un momento con nuestro patrocinador y vuelves a la calzada con una ' +
            'vida y el escudo puesto. Solo una vez por carrera.';
        // El cartel entero es el enlace: a esta altura de la partida el
        // jugador esta mirando justo ahi, y pedirle que busque un boton
        // pequeno seria pedirle dos cosas.
        const a = document.createElement('a');
        a.className = 'ad-poster';
        a.href = CEFAS.order;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', CEFAS.name);
        const img = document.createElement('img');
        img.src = cartel;
        img.alt = 'Anuncio de ' + CEFAS.name;
        img.decoding = 'async';
        // Si la imagen falta, se quita el enlace y queda a la vista el cartel
        // tipografico de debajo. El revivir se concede igual: corre por reloj
        // propio y no depende de que llegue a cargar nada.
        img.onerror = () => a.remove();
        a.appendChild(img);
        dom.shortFallback.hidden = true;
        dom.shortHost.appendChild(a);
    } else if (conVideo) {
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
    game.adUsed = true;
    reviveNow();
}

// El angel no espera: se compro con jade y esa es toda la transaccion.
function doAngel() {
    if (save.angels <= 0) return;
    save.angels--;
    persist();
    reviveNow();
}

function reviveNow() {
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
    player.rez = 0;
    player.outVX = 0;
    player.outVZ = 0;
    player.outZ = 0;
    player.outKind = 0;
    player.push = 0;
    playerGroup.position.z = PLAYER_Z;
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
    // Y ahora la vuelta se VE. El sonido del escudo ya no suena aqui: suena al
    // tocar el suelo, que es cuando el jugador vuelve a tener el mando.
    startRez();
    showBanner('DE PIE', 'Vuelves a la calzada');
}

// Rechazar cierra la carrera aunque queden angeles: el jugador acaba de decir
// que no quiere seguir, y volver a preguntarle con otro boton seria insistir.
function declineRevive() {
    game.adUsed = true;
    teardownRevive();
    dom.revive.hidden = true;
    finishGame();
}

function finishGame() {
    game.state = State.OVER;
    stopPendingTones();
    if (game.won) sfx.milestone(); else sfx.over();

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
    // Llegar manda sobre el record: son dos cosas distintas y la que cierra la
    // ruta entera es la que tiene que salir en el titulo.
    dom.recordTag.textContent = game.won
        ? 'Ruta completa, de Tikal a la capital.'
        : isRecord ? '¡Nueva mejor marca!' : '';
    dom.overTitle.textContent = game.won ? '¡LLEGASTE!' : isRecord ? '¡RÉCORD!' : 'FIN';

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
    game.sink.active = false;
    game.finishS = -1;
    // Y el suceso de zona: si no, el menu se quedaba con el aire rojo de la
    // erupcion en la que acababas de morir.
    game.zone.active = false;
    player.push = 0;

    // Los poderes se apagan al morir. Si el vuelo sobreviviese a la partida,
    // la camara se quedaria encuadrada en el aire durante todo el menu.
    for (const k of ['magnet', 'double', 'amber', 'flight', 'propio']) game.powers[k] = 0;

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
// Panel de pruebas
// ===========================================================================
// Ctrl+Shift+D. No aparece por ningun otro sitio, no hay boton que lo llame y
// con el cerrado no cuesta ni una linea por frame: todo lo que hace esta detras
// de banderas que nacen apagadas.
//
// Existe por una razon muy concreta: con una zona por cada tres minutos, mirar
// como queda el final de Semuc o el muelle de Atitlán costaba media hora de
// partida y no morirse por el camino. Un repaso visual zona por zona no se
// puede hacer asi, y "juegalo otra vez a ver si esta vez llegas" no es una
// forma de trabajar.
const dbg = {
    on: false,      // el panel esta abierto
    god: false,     // los golpes no hacen nada
    slow: false     // el mundo va a un tercio, para poder mirar
};
let dbgLast = -1e9;   // distancia del ultimo repintado del panel

function toggleDebug() {
    dbg.on = !dbg.on;
    dom.dbg.hidden = !dbg.on;
    if (dbg.on) renderDebug();
}

// Lo que el panel enseña. Se repinta al abrirlo y despues de cada boton, no en
// cada frame: son cifras para leer, no un telemetro.
function renderDebug() {
    if (!dbg.on) return;
    const ri = Math.floor(routePos()) % REGION_N;
    const dentro = game.distance - game.zoneFrom;
    const pct = Math.round(Math.min(1, dentro / ZONE_SPAN) * 100);
    const suceso = game.zone.active
        ? 'EN CURSO'
        : game.nextZone === Infinity
            ? 'ya pasó'
            : 'en ' + milesDe(Math.max(0, game.nextZone - game.distance)) + ' m';
    dom.dbgInfo.innerHTML =
        '<b>' + REGIONS[ri].name + '</b> · ' + (ri + 1) + ' de ' + REGION_N + '<br>' +
        'zona: ' + pct + ' % (' + milesDe(dentro) + ' de ' + milesDe(ZONE_SPAN) + ')<br>' +
        'suceso: ' + suceso + '<br>' +
        'cambio: ' + milesDe(zoneAhead()) + ' m<br>' +
        'jade ' + save.bank + ' · ángeles ' + save.angels;
    dom.dbgGod.setAttribute('aria-pressed', String(dbg.god));
    dom.dbgSlow.setAttribute('aria-pressed', String(dbg.slow));
}

// Deja la zona a punto de soltar su suceso. No se dispara a mano: se mueve el
// contador y se deja que lo arme el reparto de siempre, para que lo que se ve
// probando sea EXACTAMENTE lo que va a ver el jugador —con su ventana limpia,
// su cartel forzado y su hueco antes del cruce— y no una version de laboratorio.
function dbgAlSuceso() {
    game.zone.active = false;
    game.zoneFrom = game.distance - zoneClimaxAt();
    game.nextZone = game.distance;
    renderDebug();
}

// Y esto deja la zona a punto de acabarse: el tiempo cumplido, asi que el
// proximo cruce ya es el de destino, con la estructura de despedida por delante.
// Se dejan 900 unidades —unos trece segundos— para que dé tiempo a verla venir.
function dbgAlFinal() {
    game.zoneFrom = game.distance - (ZONE_SPAN - 900);
    if (game.nextZone !== Infinity) game.nextZone = Infinity;  // el suceso, por visto
    renderDebug();
}

// Cambiar de sitio sin pasar por el cruce. Hace lo mismo que hace tomar la
// salida buena, menos cobrar el jade: mover la ruta, cambiar el firme en una
// linea que se ve venir, arrancar el cruce de paisaje y reiniciar los contadores
// de la zona.
function dbgZonaSiguiente() {
    const desde = Math.floor(routePos()) % REGION_N;
    const destino = Math.min(desde + 1, REGION_N - 1);
    if (destino === desde) return;

    game.routePos = destino + 0.02;
    game.roadFrom = desde;
    game.roadS0 = game.distance + 60;
    game.snapFrom = desde;
    game.snapT = 0;

    game.zoneFrom = game.distance;
    game.nextZone = game.distance + zoneClimaxAt();
    game.zone.active = false;
    game.zone.k = 0;
    player.push = 0;

    lastBlendKey = -1;
    mmLastName = '';
    mmLastLeft = -1;
    resetRoadColors();
    if (!save.regions.includes(REGIONS[destino].id)) {
        save.regions.push(REGIONS[destino].id);
        persist();
        refreshMinimapDots();
    }
    showRegionBanner(destino);
    renderDebug();
}

function initDebug() {
    dom.dbg.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        switch (btn.dataset.dbg) {
            case 'suceso': dbgAlSuceso(); break;
            case 'final':  dbgAlFinal(); break;
            case 'zona':   dbgZonaSiguiente(); break;
            case 'god':    dbg.god = !dbg.god; renderDebug(); break;
            case 'slow':   dbg.slow = !dbg.slow; renderDebug(); break;
            case 'jade':
                save.bank += 1000;
                save.angels = ANGEL_MAX;
                persist();
                renderDebug();
                break;
            case 'cerrar': toggleDebug(); break;
        }
    });
}

// ===========================================================================
// Taller: trajes, mejoras y punto de salida
// ===========================================================================
let shopTab = 'skins';
let shopReturn = State.MENU;

function refreshMenu() {
    dom.menuBank.textContent = save.bank;
    dom.menuBest.textContent = save.best;
    // Ya no es "de donde sales" —siempre es Tikal— sino cuanto de la ruta
    // llevas visto. Es lo unico que se acumula entre carreras.
    const vistos = REGIONS.filter(R => save.regions.includes(R.id)).length;
    dom.menuRoute.textContent = vistos + ' de ' + REGION_N;
    // Aqui, y no al arrancar: es el unico sitio por el que se pasa siempre al
    // volver al menu o al acabar una partida, y es lo que hace que el banner
    // rote en vez de quedarse el mismo toda la sesion.
    paintSponsors();
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
        // El poder propio, en su propia linea y con su color. Va aparte de la
        // descripcion porque no es lo que el traje ES, sino lo que le sale en
        // la calzada solo a el.
        const pr = PROPIOS[s.veh] || (s.runner ? PROPIOS.runner : null);
        const linea = pr
            ? '<span class="card-poder" style="--c:#' +
              pr.color.toString(16).padStart(6, '0') + '">' +
              pr.icon + ' <b>' + pr.name + '</b> · ' + pr.corto + '</span>'
            : '';
        return '<div class="card' + (on ? ' on' : '') + (owned ? '' : ' locked') + '">' +
            '<span class="card-ic skin-ic">' + skinIcon(s) + '</span>' +
            '<b>' + s.name + '</b><p>' + s.desc + '</p>' + linea +
            '<button type="button" data-skin="' + s.id + '"' +
            (dis ? ' disabled' : '') + (on ? ' class="equipped"' : '') + '>' + label + '</button>' +
            '</div>';
    }).join('');

    // --- Mejoras ---
    // El angel va PRIMERO y no al final de la lista: es lo unico de esta
    // pestana que se gasta, y es lo que se viene a comprar despues de morir en
    // la zona diez. Enterrado entre ocho mejoras permanentes no se encuentra.
    const ang = save.angels;
    const angFull = ang >= ANGEL_MAX;
    const angPips = Array.from({ length: ANGEL_MAX }, (_, k) =>
        '<i class="' + (k < ang ? 'full' : '') + '"></i>').join('');
    dom.tabUpg.innerHTML =
        '<div class="card angel' + (ang > 0 ? ' on' : '') + '">' +
        '<span class="card-ic">' + svg(ICON_PATHS.angel) + '</span>' +
        '<b>Ángel de la guarda</b>' +
        '<p>Te levanta donde caíste, sin anuncio y sin esperar. Se gasta al ' +
        'usarlo y llevas hasta ' + ANGEL_MAX + '.</p>' +
        '<span class="card-lvl">' + angPips + '</span>' +
        '<button type="button" data-angel="1"' +
        (angFull || save.bank < ANGEL_COST ? ' disabled' : '') + '>' +
        (angFull ? 'Zurrón lleno' : ANGEL_COST + ' jade') + '</button>' +
        '</div>' +
        UPGRADES.map(u => {
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
    // Ya no se compra ni se elige nada: la ruta es una y va en orden. Esto es
    // el itinerario, y lo unico que cambia de una carrera a otra es hasta
    // donde se ha llegado. El boton se queda porque la tarjeta sin el se
    // descuadra, pero solo dice en que estado esta cada punto.
    dom.tabRoute.innerHTML = REGIONS.map((R, i) => {
        const open = save.regions.includes(R.id);
        const meta = i === REGION_N - 1;
        const label = i === 0 ? 'Salida' : meta ? 'Meta' : open ? 'Visitado' : 'Por descubrir';
        const paso = meta ? 'Final de la ruta.' : 'Parada ' + (i + 1) + ' de ' + REGION_N + '.';
        return '<div class="card' + (open ? ' on' : ' locked') + '">' +
            '<span class="card-ic">' + svg(REGION_ICONS[R.id] || '') + '</span>' +
            swatch([R.skyBot, R.landA, R.landB, R.roadA]) +
            '<b>' + R.name + '</b><p>' + R.dept + '. ' + paso + '</p>' +
            '<button type="button" disabled' + (open ? ' class="equipped"' : '') + '>' +
            label + '</button>' +
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

        if (btn.dataset.angel) {
            if (save.angels >= ANGEL_MAX) return;
            if (save.bank < ANGEL_COST) { sfx.deny(); return; }
            save.bank -= ANGEL_COST;
            save.angels++;
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
let camRoll = 0;      // alabeo momentaneo al recibir un golpe

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
            // La bici multiplica ESTO y no la velocidad de crucero: lo suyo es
            // la rueda libre, o sea bajar mas rapido, no correr mas en llano.
            // Puesto sobre la velocidad base habria sido otra cosa —una moto
            // sin motor— y ademas habria empujado el techo todo el rato.
            const cuesta = slopeSteep(game.distance);
            if (cuesta > 0) game.speed *= 1 + (SLOPE_SPEED - 1) * cuesta * dote().cuesta;
            // La ESCAPADA de la bici: un tercio mas, en llano y en cuesta. Es
            // lo unico que multiplica la velocidad de crucero, y por eso dura
            // siete segundos y no los nueve del resto.
            if (game.powers.propio > 0 && vehOn === 'bici') game.speed *= 1.33;
            const giro = turnGrip(game.distance);
            if (giro > 0) game.speed *= 1 + (TURN_SPEED - 1) * giro;
            // Y al morir el mundo frena hasta pararse, en lo que dura la
            // animacion. Seguir corriendo a toda velocidad mientras el cuerpo
            // da vueltas por el aire se leia como que el juego continuaba sin
            // el jugador; frenando, la carrera se acaba DONDE se acaba.
            if (player.out > 0) game.speed *= player.out / player.outMax;
            // Y al revivir, el mundo arranca desde parado mientras el cuerpo
            // baja. Sin esto se volvia a la calzada a setenta por hora con la
            // animacion todavia en el aire, y la vuelta no se veia: solo se
            // notaba que el paisaje ya iba disparado.
            if (player.rez > 0) game.speed *= 1 - player.rez / REZ_TIME;
            // Y el freno del panel de pruebas, para poder mirar el paisaje en
            // vez de esquivarlo. Va aqui y no en el tope porque es un
            // multiplicador mas, y solo puede BAJAR la velocidad.
            if (dbg.slow) game.speed *= 0.34;
            // Y el tope absoluto, el ultimo de todos: ningun encadenado de
            // multiplicadores puede dejar que un obstaculo se cuele entre dos
            // pasos de simulacion.
            if (game.speed > SPEED_HARD) game.speed = SPEED_HARD;
            updatePowers(STEP);
            updatePlayer(STEP);
            scrollWorld(STEP);
            checkCollisions();
            checkMilestone();
            // La meta. Va DESPUES de las colisiones: morir en el ultimo metro
            // es morir, y cobrar la llegada por haber cruzado la linea ya
            // muerto seria regalarla.
            if (game.finishS >= 0 && game.distance > game.finishS &&
                game.state === State.PLAYING) {
                winGame();
            }
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
        // Las barras SI van en cada frame: son cuentas atras, y lo que cambia
        // en ellas no es el estado sino el ancho. Se escriben solas cuando el
        // entero cambia, asi que con nada puesto no cuestan una escritura.
        renderBars();
        renderDistance();

        // El panel de pruebas se refresca cada cincuenta unidades, no cada
        // frame: son cifras para leer y no un telemetro, y con el cerrado la
        // comprobacion es una bandera.
        if (dbg.on && game.distance - dbgLast > 50) {
            dbgLast = game.distance;
            renderDebug();
        }

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
        mat.gota.emissiveIntensity = mat.jade.emissiveIntensity;
        const pulse = 0.45 + Math.sin(t * 8) * 0.3;
        for (const k of POWER_KEYS) mat[k].emissiveIntensity = pulse;

        // Vineta y campo de vision segun la velocidad: es la unica pista de
        // que aceleras. El rango se mide desde la salida hasta el techo y no
        // contra un numero fijo: con 34 escrito a mano y una salida de 20, la
        // vineta se saturaba a los cuatrocientos metros y de ahi al final de la
        // ruta ya no decia nada.
        const rush = Math.max(0, Math.min(1.25,
            (game.speed - SPEED_START) / (SPEED_MAX - SPEED_START)));
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
        const mb = applyBlend(0);
        updateRoadCurve();
        updateScenery(mb.A, mb.B, mb.e);
    }

    // Va fuera del bloque de PLAYING para que tambien se apague al morir: si
    // no, la ultima vineta se quedaba encendida sobre la pantalla de fin.
    updateHurt(delta);

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

    // Lo que aprieta la curva cerrada aqui mismo. Manda sobre el peralte y
    // sobre la deriva de la camara, y es cero fuera del tramo.
    const giro = game.state === State.PLAYING ? turnGrip(game.distance) : 0;
    const peralte = giro * game.turn.dir;

    // Camara: sigue al jugador con retardo, acusa el golpe y en la curva se va
    // hacia FUERA. La deriva entra por el objetivo y no por la posicion, asi
    // que se suaviza con el mismo retardo que el seguimiento y no da tirones.
    const targetX = player.x * 0.32 + aimCurve * 0.5 - peralte * TURN_DRIFT;
    camera.position.x += (targetX - camera.position.x) * Math.min(1, 6 * delta);
    camera.position.y = cam.y + player.y * (0.12 + 0.85 * f);

    if (shake > 0) {
        shake = Math.max(0, shake - delta * 2.6);
        // Una sacudida al azar puro se lee como ruido. La vertical va a una
        // frecuencia fija y la horizontal al azar: la mezcla se lee como un
        // impacto —algo golpeo, y ademas todo tiembla— y no como una averia.
        // Y al cuadrado, para que el primer instante sea el que se nota.
        const g = shake * shake;
        camera.position.x += (Math.random() - 0.5) * g * 1.2;
        camera.position.y += (Math.sin(t * 62) + (Math.random() - 0.5) * 0.7) * g * 0.9;
        camRoll = Math.sin(t * 47) * g * 0.05;
    } else if (camRoll !== 0) {
        camRoll = 0;
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

    // Alabeo. Va DESPUES de lookAt, que reescribe la rotacion entera, y suma
    // tres cosas: el bamboleo de la calzada de siempre, el del golpe, y el
    // peralte de la curva cerrada, que es el que de verdad se nota.
    //
    // El signo: en una curva a la derecha (dir = +1) la camara se tumba hacia
    // la derecha, o sea que rota en sentido horario, que en Three.js es una
    // rotacion.z NEGATIVA. Si alguna vez se lee al reves, es este menos.
    camera.rotation.z += curveAtZ(cam.aimZ) * 0.022 + camRoll - peralte * TURN_ROLL;
    // Y el giro del desvio, tambien despues de lookAt y por el mismo motivo.
    // Es lo que convierte una bifurcacion de 45 grados en un giro y no en un
    // derrape lateral.
    if (game.state === State.PLAYING) camera.rotation.y += forkCamYaw();

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
    initDebug();
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
    dom.angelBtn.addEventListener('click', doAngel);
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
