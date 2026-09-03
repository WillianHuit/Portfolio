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
const SPEED_MAX = 31;
const SPEED_RAMP = 0.5;             // unidades/s ganadas por segundo

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
const REGION_LENGTH = 500;
// La transicion ocupa el ultimo 38 % del tramo: el resto se sostiene, para
// que cada departamento tenga identidad y no sea un degradado continuo.
const REGION_BLEND = 0.62;

const OBSTACLE_POOL = 30;
const PICKUP_POOL = 56;

// Tipos de obstaculo. Los tres verbos del juego: esquivar, agacharse, saltar.
const ESTELA = 0;   // monolito alto: hay que cambiar de carril
const DINTEL = 1;   // viga elevada: hay que deslizarse
const CENOTE = 2;   // sumidero: hay que saltar

// Altura de crucero del vuelo. Tiene que quedar por encima del remate de la
// estela mas alta (3,4 x 1,15 de proporcion regional, mas el capitel), o el
// jugador la atraviesa por dentro: no le hace dano, pero se ve como un fallo.
const FLY_Y = 4.5;
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
// La ruta: ocho puntos de Guatemala
// ===========================================================================
// Cada tramo define su cielo, su niebla, su suelo, sus luces, el material de
// la calzada, el color de los obstaculos y que se ve en el horizonte. Las
// coordenadas mm son las del minimapa (viewBox 108x116), derivadas de la
// posicion real de cada sitio.
const REGIONS = [
    {
        id: 'tikal', name: 'Tikal', dept: 'Petén', mm: [69.2, 21.8],
        skyTop: 0x27456b, skyBot: 0xe8a86e, fog: 0xcb9b74, ground: 0x2b4a3b,
        sun: 0xffd2a0, sunI: 1.7, hemi: 0xdcc6b2, hemiI: 1.7,
        roadA: 0xefe6d2, roadB: 0xd9cdb2, kerb: 0xb9a888,
        stone: 0xa1937f, accent: 0xc8862f, hazard: 0x14776a, pit: 0x040d0b,
        land: 'temple', landA: 0xa1937f, landB: 0xc8862f,
        ob: [1.0, 1.0, 1.0]
    },
    {
        id: 'semuc', name: 'Semuc Champey', dept: 'Alta Verapaz', mm: [60.9, 64.1],
        skyTop: 0x5d93b8, skyBot: 0xd7e6c4, fog: 0x8fb79a, ground: 0x1f4a33,
        sun: 0xfff0d2, sunI: 2.0, hemi: 0xdfeee0, hemiI: 2.2,
        roadA: 0xe4dcc0, roadB: 0xcdc2a2, kerb: 0x9aa87f,
        stone: 0x8fa08b, accent: 0x3fbfa6, hazard: 0x2fd0c4, pit: 0x07332f,
        land: 'karst', landA: 0x7d8f77, landB: 0x2f7a52,
        ob: [1.1, 0.92, 1.15]
    },
    {
        id: 'riodulce', name: 'Río Dulce', dept: 'Izabal', mm: [86.0, 61.1],
        skyTop: 0x2f86c9, skyBot: 0xa8e0e6, fog: 0x6fb3c0, ground: 0x2e6b4e,
        sun: 0xfff6e0, sunI: 2.2, hemi: 0xe4f4f6, hemiI: 2.4,
        roadA: 0xd9c9a4, roadB: 0xc2af87, kerb: 0x8a6b45,
        stone: 0x9b7448, accent: 0xe0b25c, hazard: 0x1f7fb0, pit: 0x06222f,
        land: 'palm', landA: 0x6f4f2f, landB: 0x2f9e5e,
        ob: [1.25, 0.85, 1.1]
    },
    {
        id: 'antigua', name: 'Antigua', dept: 'Sacatepéquez', mm: [41.3, 88.4],
        skyTop: 0x5a7fb8, skyBot: 0xf0c48a, fog: 0xd0a479, ground: 0x3a5340,
        sun: 0xffd9a4, sunI: 1.95, hemi: 0xdcc4ad, hemiI: 1.85,
        roadA: 0x9c8f80, roadB: 0x877a6b, kerb: 0xb5a08a,
        stone: 0xe8d9b8, accent: 0xd4762f, hazard: 0x3b3128, pit: 0x18120c,
        land: 'colonial', landA: 0xe0c9a6, landB: 0xc0472f,
        ob: [0.9, 1.15, 0.95]
    },
    {
        id: 'atitlan', name: 'Lago de Atitlán', dept: 'Sololá', mm: [29.6, 85.2],
        skyTop: 0x3a3a6d, skyBot: 0xe37a45, fog: 0xc2724a, ground: 0x2c4436,
        sun: 0xffad6a, sunI: 1.9, hemi: 0xd9aea0, hemiI: 1.8,
        roadA: 0xc9b9a0, roadB: 0xb2a28a, kerb: 0x8f6f5a,
        stone: 0x6d5a72, accent: 0xd94f6a, hazard: 0x1d4f7a, pit: 0x081c2c,
        land: 'volcano', landA: 0x3f4a55, landB: 0x8d6a4f,
        ob: [0.95, 1.05, 1.0]
    },
    {
        id: 'chichi', name: 'Chichicastenango', dept: 'Quiché', mm: [31.8, 78.9],
        skyTop: 0x1f2a52, skyBot: 0x6b4a7a, fog: 0x4a3f63, ground: 0x22362c,
        sun: 0xc9a8e0, sunI: 1.15, hemi: 0x8f7fa8, hemiI: 1.35,
        roadA: 0xb9ae95, roadB: 0xa2977e, kerb: 0x7d6f5a,
        stone: 0xd8d2c4, accent: 0xe0483f, hazard: 0x2a1f33, pit: 0x120c18,
        land: 'market', landA: 0xe6e0d2, landB: 0xe0483f,
        ob: [1.05, 0.95, 1.05]
    },
    {
        id: 'tajumulco', name: 'Volcán Tajumulco', dept: 'San Marcos', mm: [12.0, 76.4],
        skyTop: 0x081120, skyBot: 0x1d3b46, fog: 0x17313b, ground: 0x152720,
        sun: 0xa8c6e6, sunI: 0.85, hemi: 0x6d90a4, hemiI: 1.05,
        roadA: 0x8c9aa0, roadB: 0x74818a, kerb: 0x5a666b,
        stone: 0x4a5560, accent: 0xcfe4ef, hazard: 0xd4451f, pit: 0x2a0e06,
        land: 'peak', landA: 0x2b3540, landB: 0xe8f2f7,
        ob: [1.0, 1.1, 0.9]
    },
    {
        id: 'monterrico', name: 'Monterrico', dept: 'Santa Rosa', mm: [47.4, 105.0],
        skyTop: 0x3b4f8a, skyBot: 0xf2a86b, fog: 0xd09a72, ground: 0x2b2b2e,
        sun: 0xffcf9c, sunI: 1.75, hemi: 0xcdb6a6, hemiI: 1.75,
        roadA: 0x5a544f, roadB: 0x484340, kerb: 0x7a6a55,
        stone: 0x6f5a3f, accent: 0xe8c98a, hazard: 0x2f6f8a, pit: 0x07202b,
        land: 'palm', landA: 0x4a3a26, landB: 0x2f7a4e,
        ob: [1.2, 0.88, 1.12]
    }
];

const REGION_N = REGIONS.length;

// ===========================================================================
// Trajes
// ===========================================================================
// Cada traje solo cambia colores: la silueta del corredor se mantiene para
// que la lectura de la postura (salto, deslizamiento) no dependa del traje.
const SKINS = [
    { id: 'ajaw', name: 'Ajaw', desc: 'El corredor de la calzada, con tocado de jade.',
      cost: 0, cloth: 0xc0453a, skin: 0xd9a066, crest: 0x2ec4a0, legs: 0x10201c, trim: 0xc8862f },
    { id: 'tejedora', name: 'Tejedora', desc: 'Huipil de telar de cintura del altiplano.',
      cost: 120, cloth: 0x7b2d8e, skin: 0xc98b58, crest: 0xe0483f, legs: 0x1b2b26, trim: 0xf0c34a },
    { id: 'jaguar', name: 'Guerrero Jaguar', desc: 'Piel moteada de la orden militar maya.',
      cost: 260, cloth: 0xd9a24b, skin: 0xd9a066, crest: 0x3b2a14, legs: 0x3b2a14, trim: 0x10201c },
    { id: 'quetzal', name: 'Quetzal', desc: 'Verde tornasol y pecho carmesí.',
      cost: 420, cloth: 0x1fae7e, skin: 0xd8484a, crest: 0x2ec4a0, legs: 0x14776a, trim: 0xd8484a },
    { id: 'chapin', name: 'Chapín', desc: 'Azul y blanco, de un extremo al otro del país.',
      cost: 620, cloth: 0x4a90d9, skin: 0xd9a066, crest: 0xf2f6fa, legs: 0xf2f6fa, trim: 0x4a90d9 },
    { id: 'ceniza', name: 'Ceniza', desc: 'Lo que queda cuando el Fuego hace de las suyas.',
      cost: 900, cloth: 0x33312f, skin: 0xb06a4a, crest: 0xff6b2c, legs: 0x1a1a1a, trim: 0xff6b2c }
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
    { id: 'luck',    name: 'Suerte del ajq’ij', max: 3, cost: l => 210 + l * 260,
      desc: 'Aparecen poderes con más frecuencia.' }
];

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
const State = { MENU: 'menu', SHOP: 'shop', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

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
    powerMax: { magnet: 1, double: 1, amber: 1, flight: 1 }
};

const player = {
    lane: 1,
    laneFrom: 0,
    laneT: 1,         // progreso 0..1 del cambio de carril en curso
    x: 0,
    y: 0,
    vy: 0,
    grounded: true,
    sliding: 0,
    wantSlide: false, // picado que se convierte en deslizamiento al tocar suelo
    jumps: 0,         // saltos gastados desde que dejo el suelo
    holding: false,   // la tecla de salto sigue pulsada
    run: 0,           // fase del ciclo de carrera
    coyote: 0,        // margen para saltar tras dejar el suelo
    buffer: 0,        // salto pulsado un instante antes de aterrizar
    land: 0           // temporizador del aplastado de aterrizaje
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
    soundPref: $('soundPref'), soundBtn: $('soundBtn'),
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
    powers: $('powers'),
    pw: {
        magnet: $('pwMagnet'), flight: $('pwFlight'),
        double: $('pwDouble'), amber: $('pwAmber')
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
    sound: true
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
let roadMesh, kerbMesh, landMesh;
let roadGroup, landGroup;
let playerGroup, playerBody, playerParts, playerMats, shadowMesh;
let jaguar, quetzal, groundMesh, sunLight, hemiLight;
let particleMesh;

// Materiales compartidos por todo lo tematizable. Cambiar de departamento es
// reescribir estos colores, no reconstruir la escena.
const mat = {};

const obstacles = [];
const pickups = [];
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
function buildGround() {
    groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 900), mat.ground);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(0, -1.02, -320);
    scene.add(groundMesh);
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
        TILE_COUNT
    );
    roadMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TILE_COUNT * 3), 3
    );

    for (let i = 0; i < TILE_COUNT; i++) {
        dummy.position.set(0, -0.5, ROAD_FROM + i * TILE_DEPTH);
        dummy.scale.set(ROAD_WIDTH, 1, TILE_DEPTH * 0.94);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        roadMesh.setMatrixAt(i, dummy.matrix);
    }
    roadMesh.instanceMatrix.needsUpdate = true;
    roadGroup.add(roadMesh);

    // Bordillos: los sacbeob tenian los cantos levantados
    kerbMesh = new THREE.InstancedMesh(BOX, mat.kerb, TILE_COUNT * 2);
    for (let i = 0; i < TILE_COUNT; i++) {
        const z = ROAD_FROM + i * TILE_DEPTH;
        for (let sd = 0; sd < 2; sd++) {
            dummy.position.set(sd ? ROAD_WIDTH / 2 : -ROAD_WIDTH / 2, -0.1, z);
            dummy.scale.set(0.55, 0.8, TILE_DEPTH * 0.94);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            kerbMesh.setMatrixAt(i * 2 + sd, dummy.matrix);
        }
    }
    kerbMesh.instanceMatrix.needsUpdate = true;
    roadGroup.add(kerbMesh);
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
    const cenote = new THREE.Group();
    const hole = new THREE.Mesh(BOX, mat.pit);
    hole.scale.set(2.05, 0.12, 2.6);
    hole.position.y = 0.03;
    cenote.add(hole);
    const water = new THREE.Mesh(BOX, mat.water);
    water.scale.set(1.6, 0.08, 2.1);
    water.position.y = 0.05;
    cenote.add(water);
    group.add(cenote);

    group.visible = false;
    scene.add(group);

    return {
        group, parts: [estela, dintel, cenote],
        shaft, cap, beam, posts,
        type: -1, lane: 1, z: 0, active: false
    };
}

function makePickup() {
    const mesh = new THREE.Mesh(GEO.jade, mat.jade);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, lane: 1, z: 0, y: 1.1, active: false, kind: 'jade', pulled: false };
}

function buildPools() {
    for (let i = 0; i < OBSTACLE_POOL; i++) obstacles.push(makeObstacle());
    for (let i = 0; i < PICKUP_POOL; i++) pickups.push(makePickup());
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
        cloth: slot(), skin: slot(), crest: slot(), legs: slot(), trim: slot()
    };

    const cube = (parent, m, sx, sy, sz, x, y, z) => {
        const mesh = new THREE.Mesh(BOX, m);
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };

    const limb = (m, hx, hy, sx, sy, sz) => {
        const pivot = new THREE.Group();
        pivot.position.set(hx, hy, 0);
        playerBody.add(pivot);
        cube(pivot, m, sx, sy, sz, 0, -sy / 2, 0);
        return pivot;
    };

    const torso = cube(playerBody, playerMats.cloth, 0.86, 0.95, 0.55, 0, 1.28, 0);
    cube(playerBody, playerMats.trim, 0.9, 0.16, 0.6, 0, 0.88, 0);       // faja
    const head = cube(playerBody, playerMats.skin, 0.62, 0.6, 0.6, 0, 2.05, 0);
    cube(playerBody, playerMats.crest, 0.7, 0.26, 0.7, 0, 2.45, 0);      // tocado
    cube(playerBody, playerMats.crest, 0.16, 0.5, 0.5, 0, 2.7, 0.06);    // pluma

    const armL = limb(playerMats.skin, -0.55, 1.66, 0.24, 0.72, 0.24);
    const armR = limb(playerMats.skin, 0.55, 1.66, 0.24, 0.72, 0.24);
    const legL = limb(playerMats.legs, -0.24, 0.85, 0.3, 0.8, 0.3);
    const legR = limb(playerMats.legs, 0.24, 0.85, 0.3, 0.8, 0.3);

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
    const s = skinById(id);
    playerMats.cloth.color.setHex(s.cloth);
    playerMats.skin.color.setHex(s.skin);
    playerMats.crest.color.setHex(s.crest);
    playerMats.legs.color.setHex(s.legs);
    playerMats.trim.color.setHex(s.trim);
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

    quetzal.userData = { wingL, wingR };
    quetzal.visible = false;
    scene.add(quetzal);
}

// ===========================================================================
// Generacion del recorrido
// ===========================================================================
function resetWorld() {
    obstacles.forEach(o => { o.active = false; o.group.visible = false; });
    pickups.forEach(p => { p.active = false; p.mesh.visible = false; });
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

function spawnObstacle(type, lane, z) {
    const o = freeObstacle();
    if (!o) return;
    o.type = type;
    o.lane = lane;
    o.z = z;
    o.active = true;
    o.group.visible = true;
    o.group.position.set(LANE_X[lane], 0, z);
    o.parts.forEach((p, i) => { p.visible = (i === type); });
}

function spawnPickup(lane, z, height, kind = 'jade') {
    const p = freePickup();
    if (!p) return;
    p.lane = lane;
    p.z = z;
    p.y = height;
    p.active = true;
    p.kind = kind;
    p.pulled = false;
    p.mesh.geometry = GEO[kind] || GEO.jade;
    p.mesh.material = mat[kind] || mat.jade;
    p.mesh.visible = true;
    p.mesh.position.set(LANE_X[lane], height, z);
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

// Genera un "compas" de recorrido: un patron de obstaculos mas su jade.
// La dificultad sube reduciendo el hueco entre compases.
function generateChunk(z) {
    if (Math.random() < powerChance()) {
        spawnPickup((Math.random() * 3) | 0, z - 12, 1.3, rollPower());
    }

    const hard = Math.min(game.elapsed / 95, 1);        // 0 -> 1 en poco mas de un minuto
    const pattern = Math.random();

    if (pattern < 0.3 + hard * 0.15) {
        // Un solo obstaculo, jade en los carriles libres
        const lane = (Math.random() * 3) | 0;
        const type = (Math.random() * 3) | 0;
        spawnObstacle(type, lane, z);
        for (let l = 0; l < 3; l++) {
            if (l !== lane && Math.random() < 0.72) spawnPickup(l, z, 1.1);
        }
    } else if (pattern < 0.62 + hard * 0.1) {
        // Dos obstaculos: queda un unico carril libre
        const free = (Math.random() * 3) | 0;
        for (let l = 0; l < 3; l++) {
            if (l !== free) spawnObstacle((Math.random() * 3) | 0, l, z);
        }
        spawnPickup(free, z, 1.1);
    } else if (pattern < 0.82) {
        // Pasillo de jade: recompensa sin riesgo, para respirar. Es el patron
        // que hace alcanzable la racha, asi que da de sobra.
        const lane = (Math.random() * 3) | 0;
        for (let k = 0; k < 5; k++) spawnPickup(lane, z - k * 3.2, 1.1);
    } else {
        // Dintel en los tres carriles: hay que deslizarse, con jade alto
        // colocado justo detras para premiar el momento exacto
        for (let l = 0; l < 3; l++) spawnObstacle(DINTEL, l, z);
        spawnPickup(1, z - 6, 1.1);
    }
}

// ===========================================================================
// Entrada
// ===========================================================================
function moveLane(dir) {
    const next = Math.max(0, Math.min(2, player.lane + dir));
    if (next === player.lane) return;
    // El tween arranca desde donde esta el cuerpo AHORA, no desde el carril
    // anterior: encadenar dos cambios seguidos ya no da un tiron hacia atras.
    player.laneFrom = player.x;
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
function updatePlayer(dt) {
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

    if (flying) {
        // Vuelo: se sube a altura de crucero y se queda ahi. La gravedad se
        // desconecta del todo para que aterrizar sea decision del temporizador
        // y no del jugador.
        player.y += (FLY_Y - player.y) * Math.min(1, 5 * dt);
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

        if (player.y <= 0) {
            player.y = 0;
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
        player.coyote = COYOTE_TIME;
        player.jumps = 0;
        player.wantSlide = false;
    }

    if (player.buffer > 0) player.buffer = Math.max(0, player.buffer - dt);
    if (player.sliding > 0) player.sliding = Math.max(0, player.sliding - dt);
    if (player.land > 0) player.land = Math.max(0, player.land - dt);

    // Ciclo de carrera
    player.run += dt * game.speed * 0.55;

    // ===== Postura =====
    playerGroup.position.set(player.x, player.y, PLAYER_Z);

    const sliding = player.sliding > 0 && player.grounded;
    const squashK = player.land / LAND_SQUASH;             // 1 al tocar, 0 al recuperarse

    // Aplastado al aterrizar: peso sin coste, y avisa de que ya tocaste suelo
    let sy = 1 - squashK * 0.26;
    let sxz = 1 + squashK * 0.16;

    if (sliding) { sy *= 0.45; sxz = 1; }

    playerBody.scale.set(sxz, sy, sliding ? 1.5 : sxz);
    playerBody.rotation.x = sliding ? -0.55 : -0.06 - (game.speed - SPEED_START) * 0.006;

    // Inclinacion lateral: se calcula contra el destino, asi que el cuerpo se
    // tumba al salir y se endereza al llegar.
    const lean = (LANE_X[player.lane] - player.x) / 2.3;
    playerGroup.rotation.z = -lean * 0.34;
    playerGroup.rotation.y = lean * 0.28;

    const s = Math.sin(player.run);
    const c = Math.cos(player.run);

    if (flying) {
        playerBody.rotation.x = -0.42;
        playerParts.armL.rotation.x = 0.2;
        playerParts.armR.rotation.x = 0.2;
        playerParts.armL.rotation.z = 1.15 + Math.sin(player.run * 2.4) * 0.2;
        playerParts.armR.rotation.z = -1.15 - Math.sin(player.run * 2.4) * 0.2;
        playerParts.legL.rotation.x = -0.35;
        playerParts.legR.rotation.x = -0.2;
        playerParts.head.rotation.x = 0.15;
    } else if (sliding) {
        playerParts.armL.rotation.set(-0.4, 0, 0.3);
        playerParts.armR.rotation.set(-0.4, 0, -0.3);
        playerParts.legL.rotation.set(0.5, 0, 0);
        playerParts.legR.rotation.set(0.65, 0, 0);
        playerParts.head.rotation.x = 0.4;
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

    // Sombra de contacto: se encoge y se aclara con la altura, que es lo que
    // permite calcular el aterrizaje.
    const h = Math.min(player.y, 6);
    const k = 1 - h * 0.085;
    shadowMesh.position.x = player.x;
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

    // --- Calzada y horizonte: solo se mueve el Group ---
    // Antes se recolocaban las 180 instancias de la calzada y se reconstruian
    // los cubos del fondo en CADA paso de simulacion, reenviando ademas el
    // buffer de color entero. Al ser ambos escenarios periodicos basta con
    // desplazar su contenedor y envolver con un modulo.
    roadGroup.position.z = game.distance % ROAD_PERIOD;
    landGroup.position.z = (game.distance * 0.82) % LAND_PERIOD;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        o.z += dz;
        o.group.position.z = o.z;
        if (o.z > DESPAWN_Z) { o.active = false; o.group.visible = false; }
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
            p.mesh.position.x = LANE_X[p.lane];
            p.mesh.position.y = p.y;
        }

        p.mesh.position.z = p.z;
        if (p.z > DESPAWN_Z) { p.active = false; p.mesh.visible = false; }
    }

    // --- Nuevos compases ---
    // El hueco se estrecha con el tiempo, pero nunca por debajo de lo que el
    // jugador alcanza a leer: a velocidad maxima 24 unidades son ~0.8 s.
    game.nextSpawnZ += dz;
    const gap = 34 - Math.min(game.elapsed / 95, 1) * 10;   // 34 -> 24 unidades
    if (game.nextSpawnZ > SPAWN_Z + gap) {
        generateChunk(SPAWN_Z);
        game.nextSpawnZ = SPAWN_Z;
    }
}

function checkCollisions() {
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

    if (game.invuln > 0 || flying) return;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        if (Math.abs(o.z - PLAYER_Z) > HIT_WINDOW) continue;
        // Igual que las recogidas: cuenta donde esta el cuerpo, no a que
        // carril apunta la ultima tecla pulsada.
        if (Math.abs(player.x - LANE_X[o.lane]) > LANE_HALF) continue;

        const sliding = player.sliding > 0 && player.grounded;
        let hit = false;

        if (o.type === ESTELA) {
            hit = true;                       // demasiado alta: solo se esquiva
        } else if (o.type === DINTEL) {
            hit = !sliding;                   // hay que ir agachado
        } else if (o.type === CENOTE) {
            hit = player.y < 0.9;             // hay que estar en el aire
        }

        if (hit) { takeHit(); return; }
    }
}

function collect(p) {
    const x = p.mesh.position.x, y = p.mesh.position.y;

    if (p.kind === 'jade') {
        game.jade++;
        game.combo++;
        const mult = comboMultiplier() * (game.powers.double > 0 ? 2 : 1);
        game.jadeScore += Math.round(25 * mult * jadeScale());
        sfx.jade();
        burstParticles(x, y, p.z, 8, 0.85, C.jade);
        hudDirty = true;
        return;
    }

    if (p.kind === 'shield') {
        game.shield = true;
        sfx.shield();
    } else {
        const t = POWERS[p.kind].time * powerScale();
        game.powers[p.kind] = t;
        game.powerMax[p.kind] = t;
        if (p.kind === 'flight') player.wantSlide = false;
        sfx.power();
    }
    burstParticles(x, y, p.z, 16, 1.15, POWERS[p.kind].color);
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

function showRegionBanner(ri) {
    const R = REGIONS[ri];
    sfx.region();
    dom.banner.firstElementChild.textContent = R.name;
    dom.banner.lastElementChild.textContent = R.dept;
    dom.banner.hidden = false;
    dom.banner.classList.remove('show');
    void dom.banner.offsetWidth;
    dom.banner.classList.add('show');
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
    return game.startRegion + game.distance / REGION_LENGTH;
}

function applyBlend(pos) {
    const i = Math.floor(pos) % REGION_N;
    const j = (i + 1) % REGION_N;
    const raw = pos - Math.floor(pos);
    // El tramo se sostiene y la transicion ocurre al final, en vez de estar
    // cambiando de color permanentemente.
    const t = raw < REGION_BLEND ? 0 : (raw - REGION_BLEND) / (1 - REGION_BLEND);
    const e = t * t * (3 - 2 * t);          // smoothstep

    const A = REGIONS[i], B = REGIONS[j];

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
    const key = i * 1000 + Math.round(e * 90);
    if (key !== lastBlendKey) {
        lastBlendKey = key;

        // Calzada y bordillo
        for (let k = 0; k < TILE_COUNT; k++) {
            mixHex(k % 2 ? A.roadA : A.roadB, k % 2 ? B.roadA : B.roadB, e, _cMix);
            roadMesh.setColorAt(k, _cMix);
        }
        roadMesh.instanceColor.needsUpdate = true;
        mat.kerb.color.copy(mixHex(A.kerb, B.kerb, e, _cMix));

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

    return { i, j, raw, e };
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
    jaguar.position.x += (player.x * 0.6 - jaguar.position.x) * Math.min(1, 3 * dt);

    // Zancada y cola
    const gait = game.elapsed * game.speed * 0.55;
    jaguar.userData.legs.forEach((leg, k) => {
        leg.position.y = 0.42 + Math.abs(Math.sin(gait + k * 1.6)) * 0.12;
        leg.position.z = (k < 2 ? -1 : 1) * 0.75 + Math.sin(gait + k * 1.6) * 0.18;
    });
    jaguar.position.y = Math.abs(Math.sin(gait * 0.5)) * 0.14;
    jaguar.userData.tail.rotation.x = Math.sin(gait * 0.4) * 0.25;

    // Quetzal: vuela al lado, sin colision ni funcion. Solo compania. Cuando
    // el jugador vuela, se le acerca y lo escolta.
    quetzal.visible = true;
    const bob = Math.sin(game.elapsed * 3.4);
    const flying = game.powers.flight > 0;
    quetzal.position.set(
        player.x + (flying ? 2.4 : -4.6) + Math.sin(game.elapsed * 0.7) * 0.4,
        (flying ? player.y + 0.6 : 3.5) + bob * 0.3,
        PLAYER_Z - (flying ? 1.6 : 7) + Math.cos(game.elapsed * 0.9) * 0.7
    );
    quetzal.scale.setScalar(0.85);
    quetzal.rotation.z = bob * 0.12;
    const flap = Math.sin(game.elapsed * (flying ? 22 : 15)) * 0.7;
    quetzal.userData.wingL.rotation.z = flap;
    quetzal.userData.wingR.rotation.z = -flap;
}

// ===========================================================================
// Ciclo de vida de la partida
// ===========================================================================
function startGame() {
    initAudio();
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
    jadeStreak = 0;

    player.lane = 1;
    player.laneFrom = 0;
    player.laneT = 1;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.grounded = true;
    player.sliding = 0;
    player.wantSlide = false;
    player.jumps = 0;
    player.holding = false;
    player.coyote = COYOTE_TIME;
    player.buffer = 0;
    player.land = 0;

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
    dom.hud.hidden = false;
    dom.soundBtn.hidden = false;
    dom.pauseBtn.hidden = false;
    dom.pauseBtn.textContent = 'II';
    dom.pauseTag.hidden = true;
    dom.milestone.hidden = true;
    dom.milestone.classList.remove('show');
}

function endGame() {
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
            swatch([s.cloth, s.crest, s.trim, s.legs]) +
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
            game.speed = Math.min(SPEED_MAX, SPEED_START + game.elapsed * SPEED_RAMP) * scale;
            updatePowers(STEP);
            updatePlayer(STEP);
            scrollWorld(STEP);
            checkCollisions();
            checkMilestone();
            updateParticles(STEP);
            updateCompanions(STEP);
            accumulator -= STEP;
            steps++;
        }

        if (hudDirty) { renderHud(); hudDirty = false; }
        renderDistance();

        const blend = applyBlend(routePos());
        renderMinimap(blend.i, blend.j, blend.raw, blend.e);

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
        const rush = Math.max(0, (game.speed - SPEED_START) / (SPEED_MAX - SPEED_START));
        dom.speedVeil.style.opacity = (rush * 0.85).toFixed(2);
        const wantFov = cam.fov + rush * 6;
        if (Math.abs(camera.fov - wantFov) > 0.05) {
            camera.fov = wantFov;
            camera.updateProjectionMatrix();
        }
    } else if (game.state === State.MENU || game.state === State.SHOP) {
        // Los menus se ven sobre la escena, asi que conviene que respire, y
        // ademas asi el fondo adelanta que aspecto tiene el tramo de salida.
        applyBlend(save.start);
        updateParticles(delta);
    }

    // Camara: sigue al jugador con retardo y acusa el golpe
    const targetX = player.x * 0.32;
    camera.position.x += (targetX - camera.position.x) * Math.min(1, 6 * delta);
    camera.position.y = cam.y + player.y * 0.12;

    if (shake > 0) {
        shake = Math.max(0, shake - delta * 2.2);
        camera.position.x += (Math.random() - 0.5) * shake * 0.9;
        camera.position.y += (Math.random() - 0.5) * shake * 0.9;
    }
    camera.lookAt(player.x * 0.5, cam.aimY + player.y * 0.2, cam.aimZ);

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
    refreshMenu();

    // Aviso de movimiento: el juego es movimiento continuo y no se puede
    // atenuar, asi que se avisa y se deja entrar por voluntad propia.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dom.motionNotice.hidden = false;
    }

    dom.bestScore.textContent = save.best;

    dom.playBtn.addEventListener('click', startGame);
    dom.againBtn.addEventListener('click', startGame);
    dom.shopBtn.addEventListener('click', () => { initAudio(); openShop(State.MENU); });
    dom.overShopBtn.addEventListener('click', () => openShop(State.OVER));
    dom.shopClose.addEventListener('click', closeShop);
    dom.soundPref.addEventListener('click', () => { initAudio(); setSound(!audio.on); });
    dom.soundBtn.addEventListener('click', () => setSound(!audio.on));
    dom.pauseBtn.addEventListener('click', togglePause);

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
