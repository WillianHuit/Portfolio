// ===========================================================================
// SACBE - easter egg del portafolio
// ===========================================================================
// Endless runner de estetica voxel sobre una calzada maya.
//
// Notas de implementacion que conviene no deshacer:
//
//  - Todo el escenario se dibuja con UNA sola BoxGeometry compartida. Los
//    elementos repetidos (losas de la calzada, bordillos, templos del fondo)
//    van en InstancedMesh, asi que cada grupo cuesta una draw call en vez de
//    una por objeto.
//  - Los obstaculos y el jade se reciclan desde un pool: nada se crea ni se
//    destruye durante la partida, de modo que el recolector de basura no
//    provoca tirones.
//  - El jugador no avanza: el mundo se mueve hacia el. Asi las colisiones se
//    reducen a comprobar la Z de cada objeto contra una franja fija.
//  - El bucle usa paso fijo acumulado, para que la dificultad no dependa de
//    los Hz del monitor.
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

// Los templos del fondo tambien son periodicos: se define un tramo de
// TEMPLE_PERIOD unidades y se repite, de modo que al reiniciar el modulo el
// horizonte encaja consigo mismo sin salto visible.
const TEMPLE_PERIOD = 210;
const TEMPLE_SPACING = 15;
const TEMPLE_PER_CYCLE = TEMPLE_PERIOD / TEMPLE_SPACING;   // 14
const TEMPLE_CYCLES = 3;                                   // cubre lo visible

const SPEED_START = 15;
const SPEED_MAX = 31;
const SPEED_RAMP = 0.5;             // unidades/s ganadas por segundo

const GRAVITY = -58;
const JUMP_V = 17.5;
const SLIDE_TIME = 0.55;
const LANE_LERP = 14;               // rapidez del cambio de carril

const PLAYER_Z = 0;                 // el jugador vive aqui; el mundo pasa
const SPAWN_Z = -170;               // donde aparecen los objetos
const DESPAWN_Z = 11;               // pasado esto se reciclan (la camara esta en 14)

const HIT_WINDOW = 1.1;             // media profundidad de colision en Z
// Media anchura de colision en X. Se compara contra la posicion REAL del
// jugador, no contra su indice de carril: el indice cambia de golpe al pulsar
// mientras el cuerpo aun se desplaza, y esa discrepancia (unos 0.2 s, que a
// velocidad maxima son 6 unidades) producia esquivas fantasma y golpes
// injustos.
const LANE_HALF = 1.02;
const JADE_REACH = 1.5;             // el jade se recoge con mas margen

const INVULN_TIME = 1.4;            // margen tras recibir un golpe
const START_LIVES = 3;

const COYOTE_TIME = 0.09;           // salto valido justo despues de dejar suelo
const JUMP_BUFFER = 0.13;           // salto pulsado justo antes de aterrizar

// Cada 250 m y no cada 500: una partida corriente muere entre 300 y 400 m,
// asi que con 500 la mayoria de jugadores no llegaria a ver un solo hito.
const MILESTONE_EVERY = 250;
// Probando con un jugador activo, el maximo de jade en una carrera de 500 m
// era 4: con el umbral en 5 el multiplicador resultaba inalcanzable y la
// mecanica no existia en la practica. Con 3 se alcanza jugando bien, que es
// lo que se pretendia premiar.
const COMBO_STEP = 3;
const COMBO_MAX = 5;

const PARTICLE_POOL = 48;
const SHIELD_CHANCE = 0.13;

// Ciclo de ambiente: el recorrido pasa por amanecer, mediodia, atardecer y
// noche. Sin esto, el kilometro 1 se ve identico al 10 y el juego se agota
// visualmente enseguida.
const PHASE_LENGTH = 900;           // metros por fase

const OBSTACLE_POOL = 26;
const JADE_POOL = 40;
const TEMPLE_TIERS = 5;

// Tipos de obstaculo
const ESTELA = 0;   // monolito alto: hay que cambiar de carril
const DINTEL = 1;   // viga elevada: hay que deslizarse
const CENOTE = 2;   // sumidero: hay que saltar

// Paleta (coincide con las variables CSS de arcade.html)
const C = {
    limestone: 0xefe6d2,
    limestoneDark: 0xd9cdb2,
    kerb: 0xb9a888,
    jade: 0x2ec4a0,
    jadeDeep: 0x14776a,
    ochre: 0xc8862f,
    stone: 0xa1937f,
    obsidian: 0x10201c,
    night: 0x1b2b26,
    jungle: 0x2f5a49,
    haze: 0x6f9a86,      // bruma del horizonte; tambien el color de la niebla
    skin: 0xd9a066,
    cloth: 0xc0453a,
    jaguarFur: 0xd9a24b,
    jaguarSpot: 0x3b2a14,
    quetzal: 0x1fae7e,
    quetzalBreast: 0xd8484a
};

// Fases del ciclo de ambiente. Cada entrada define cielo, niebla, suelo y
// luces; el juego interpola entre la fase actual y la siguiente segun la
// distancia recorrida.
const PHASES = [
    { name: 'amanecer',  skyTop: 0x27456b, skyBot: 0xe8a86e, fog: 0xcb9b74,
      ground: 0x2b4a3b, sun: 0xffd2a0, sunI: 1.7, hemi: 0xdcc6b2, hemiI: 1.7 },
    { name: 'mediodia',  skyTop: 0x5fa0d4, skyBot: 0xa9cfc6, fog: 0x6f9a86,
      ground: 0x2f5a49, sun: 0xfff2d6, sunI: 2.1, hemi: 0xe8f4ea, hemiI: 2.3 },
    { name: 'atardecer', skyTop: 0x3a3a6d, skyBot: 0xe37a45, fog: 0xc2724a,
      ground: 0x2c4436, sun: 0xffad6a, sunI: 1.9, hemi: 0xd9aea0, hemiI: 1.8 },
    { name: 'noche',     skyTop: 0x081120, skyBot: 0x1d3b46, fog: 0x17313b,
      ground: 0x152720, sun: 0xa8c6e6, sunI: 0.85, hemi: 0x6d90a4, hemiI: 1.05 }
];

// ===========================================================================
// Estado
// ===========================================================================
const State = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

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
    best: 0
};

const player = {
    lane: 1,
    x: 0,
    y: 0,
    vy: 0,
    grounded: true,
    sliding: 0,
    run: 0,           // fase del ciclo de carrera, para el balanceo
    coyote: 0,        // margen para saltar tras dejar el suelo
    buffer: 0         // salto pulsado un instante antes de aterrizar
};

// ===========================================================================
// Referencias del DOM
// ===========================================================================
const dom = {
    menu: document.getElementById('menu'),
    over: document.getElementById('over'),
    unsupported: document.getElementById('unsupported'),
    hud: document.getElementById('hud'),
    pauseTag: document.getElementById('pauseTag'),
    motionNotice: document.getElementById('motionNotice'),
    playBtn: document.getElementById('playBtn'),
    againBtn: document.getElementById('againBtn'),
    soundPref: document.getElementById('soundPref'),
    soundBtn: document.getElementById('soundBtn'),
    lives: document.getElementById('lives'),
    dist: document.getElementById('dist'),
    jade: document.getElementById('jade'),
    overTitle: document.getElementById('overTitle'),
    recordTag: document.getElementById('recordTag'),
    finalDist: document.getElementById('finalDist'),
    finalJade: document.getElementById('finalJade'),
    finalScore: document.getElementById('finalScore'),
    bestScore: document.getElementById('bestScore'),
    hudBest: document.getElementById('hudBest'),
    combo: document.getElementById('combo'),
    shield: document.getElementById('shield'),
    milestone: document.getElementById('milestone'),
    speedVeil: document.getElementById('speedVeil'),
    pauseBtn: document.getElementById('pauseBtn')
};

// ===========================================================================
// Sonido: osciladores de Web Audio, cero archivos
// ===========================================================================
const audio = {
    ctx: null,
    on: true,          // activado por defecto, como se decidio
    master: null
};

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

// Escala pentatonica: cualquier combinacion suena bien, asi que las rachas
// de jade nunca desafinan.
const PENTA = [523.25, 587.33, 698.46, 783.99, 932.33, 1046.5];
let jadeStreak = 0;

const sfx = {
    jump: () => blip(360, 0.16, 'square', 0.5, 620),
    slide: () => blip(220, 0.2, 'sawtooth', 0.32, 120),
    lane: () => blip(480, 0.07, 'square', 0.22),
    jade: () => {
        blip(PENTA[Math.min(jadeStreak, PENTA.length - 1)], 0.19, 'triangle', 0.55);
        jadeStreak++;
    },
    hit: () => {
        blip(130, 0.32, 'sawtooth', 0.75, 55);
        blip(78, 0.4, 'square', 0.5);
        jadeStreak = 0;
    },
    over: () => {
        [523.25, 415.3, 349.23, 261.63].forEach((f, i) => {
            setTimeout(() => blip(f, 0.42, 'triangle', 0.6), i * 130);
        });
    },
    start: () => {
        [523.25, 698.46, 1046.5].forEach((f, i) => {
            setTimeout(() => blip(f, 0.26, 'triangle', 0.5), i * 90);
        });
    },
    shield: () => {
        [659.25, 830.61, 987.77].forEach((f, i) => {
            setTimeout(() => blip(f, 0.3, 'triangle', 0.55), i * 70);
        });
    },
    shieldBreak: () => {
        blip(300, 0.26, 'square', 0.6, 120);
        blip(180, 0.3, 'sawtooth', 0.4);
    },
    milestone: () => {
        [783.99, 1046.5].forEach((f, i) => {
            setTimeout(() => blip(f, 0.34, 'triangle', 0.5), i * 110);
        });
    }
};

function setSound(on) {
    audio.on = on;
    if (dom.soundPref) {
        dom.soundPref.textContent = 'Sonido: ' + (on ? 'activado' : 'apagado');
        dom.soundPref.setAttribute('aria-pressed', String(on));
    }
    if (dom.soundBtn) {
        dom.soundBtn.textContent = on ? '♪' : '✕';
        dom.soundBtn.setAttribute('aria-label', on ? 'Silenciar sonido' : 'Activar sonido');
    }
    try { localStorage.setItem('sacbe-sound', on ? '1' : '0'); } catch (e) {}
}

// ===========================================================================
// Record en localStorage
// ===========================================================================
function readBest() {
    try { return parseInt(localStorage.getItem('sacbe-best') || '0', 10) || 0; }
    catch (e) { return 0; }
}

function writeBest(v) {
    try { localStorage.setItem('sacbe-best', String(v)); } catch (e) {}
}

// ===========================================================================
// Three.js: escena
// ===========================================================================
let renderer, scene, camera;
let roadMesh, kerbMesh, templeMesh;
let roadGroup, templeGroup;

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
    camera.updateProjectionMatrix();
}
let playerGroup, playerParts, playerMats, shadowMesh;
let jaguar, quetzal, groundMesh, sunLight, hemiLight;
let jadeMaterial, shieldMaterial, particleMesh;
let skyTexture, skyCanvas, skyCtx;
const obstacles = [];
const jades = [];
const particles = [];

// Geometria unica compartida por todo el escenario
const BOX = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext &&
                 (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
}

function buildScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.insertBefore(renderer.domElement, document.body.firstChild);

    scene = new THREE.Scene();

    // Cielo en degradado. Un color plano aplanaba el horizonte; con dos
    // paradas de color se lee la altura y ademas permite el ciclo de ambiente.
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
    scene.fog = new THREE.Fog(C.haze, 55, 185);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    // Retirada y elevada: con la posicion anterior el personaje comia un
    // tercio del encuadre y los obstaculos se veian demasiado tarde.
    camera.position.set(0, cam.y, 14);
    layoutCamera();
    camera.lookAt(0, cam.aimY, cam.aimZ);

    // --- Luces: sin shadow maps, demasiado caro para lo que aporta aqui ---
    hemiLight = new THREE.HemisphereLight(0xe8f4ea, C.jungle, 2.3);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff2d6, 2.1);
    sunLight.position.set(-9, 20, 7);
    scene.add(sunLight);
    // Relleno tenue desde el lado opuesto, para que las caras en sombra de
    // estelas y dinteles no queden planas del todo
    const fill = new THREE.DirectionalLight(0xbfd8e8, 0.55);
    fill.position.set(8, 6, -10);
    scene.add(fill);

    buildGround();
    buildRoad();
    buildTemples();
    buildPools();
    buildParticles();
    buildPlayer();
    buildJaguar();
    buildQuetzal();
    applyPhase(0);
}

// --- Suelo de selva ---
// Es un unico plano estatico. No necesita desplazarse porque es de color
// uniforme: la sensacion de avance la dan la calzada y los templos. Sin el,
// los templos del fondo parecian flotar sobre la bruma.
function buildGround() {
    groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(700, 900),
        new THREE.MeshLambertMaterial({ color: C.jungle })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(0, -1.02, -320);
    scene.add(groundMesh);
}

// --- Calzada: losas alternadas para que se perciba el avance ---
// Van dentro de un Group. Como el patron de dos tonos se repite cada
// ROAD_PERIOD unidades, desplazar la calzada es mover el Group y aplicar un
// modulo: las 180 instancias no se tocan nunca despues de construirlas.
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

    const light = new THREE.Color(C.limestone);
    const dark = new THREE.Color(C.limestoneDark);

    for (let i = 0; i < TILE_COUNT; i++) {
        dummy.position.set(0, -0.5, ROAD_FROM + i * TILE_DEPTH);
        dummy.scale.set(ROAD_WIDTH, 1, TILE_DEPTH * 0.94);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        roadMesh.setMatrixAt(i, dummy.matrix);
        roadMesh.setColorAt(i, i % 2 ? light : dark);
    }
    roadMesh.instanceMatrix.needsUpdate = true;
    roadGroup.add(roadMesh);

    // Bordillos: los sacbeob tenian los cantos levantados
    kerbMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshLambertMaterial({ color: C.kerb }),
        TILE_COUNT * 2
    );
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

// --- Templos escalonados del fondo, hechos de cubos apilados ---
// Mismo truco que la calzada: se define un tramo de TEMPLE_PERIOD unidades y
// se repite TEMPLE_CYCLES veces. Al aplicar el modulo, el horizonte encaja
// consigo mismo y el desplazamiento sale gratis. Los rasgos de cada templo
// (lado, distancia, tamano) se derivan de su indice DENTRO del ciclo, que es
// lo que garantiza que la costura sea invisible.
function buildTemples() {
    templeGroup = new THREE.Group();
    scene.add(templeGroup);

    const total = TEMPLE_PER_CYCLE * TEMPLE_CYCLES;

    templeMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshLambertMaterial({ color: 0xffffff }),   // ver nota en buildRoad
        total * TEMPLE_TIERS
    );
    templeMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(total * TEMPLE_TIERS * 3), 3
    );

    const stone = new THREE.Color(C.stone);
    const ochre = new THREE.Color(C.ochre);

    for (let k = 0; k < total; k++) {
        const j = k % TEMPLE_PER_CYCLE;        // posicion dentro del ciclo
        const z = -TEMPLE_PERIOD * TEMPLE_CYCLES + k * TEMPLE_SPACING;

        const side = j % 2 ? 1 : -1;
        const dist = 18 + (j * 7) % 24;
        const scale = 0.85 + ((j * 13) % 10) / 9;
        const base = 9 * scale;
        const tierH = 2 * scale;

        for (let t = 0; t < TEMPLE_TIERS; t++) {
            const w = base * (1 - t * 0.16);
            dummy.position.set(side * dist, tierH * t + tierH / 2 - 1, z);
            dummy.scale.set(w, tierH, w);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            const id = k * TEMPLE_TIERS + t;
            templeMesh.setMatrixAt(id, dummy.matrix);
            // El templete de la cima en ocre, como los tejados pintados
            templeMesh.setColorAt(id, t === TEMPLE_TIERS - 1 ? ochre : stone);
        }
    }
    templeMesh.instanceMatrix.needsUpdate = true;
    if (templeMesh.instanceColor) templeMesh.instanceColor.needsUpdate = true;
    templeGroup.add(templeMesh);
}

// --- Pools de obstaculos y jade ---
function makeObstacle() {
    const group = new THREE.Group();

    // Estela: monolito tallado
    const estela = new THREE.Group();
    const shaft = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: C.stone }));
    shaft.scale.set(1.5, 3.4, 0.65);
    shaft.position.y = 1.7;
    estela.add(shaft);
    const cap = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: C.ochre }));
    cap.scale.set(1.75, 0.4, 0.85);
    cap.position.y = 3.6;
    estela.add(cap);
    group.add(estela);

    // Dintel: viga elevada sobre dos apoyos
    const dintel = new THREE.Group();
    const beam = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: C.ochre }));
    beam.scale.set(2.1, 0.7, 0.7);
    beam.position.y = 2.5;
    dintel.add(beam);
    for (const s of [-1, 1]) {
        const post = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: C.stone }));
        post.scale.set(0.35, 2.2, 0.5);
        post.position.set(s * 0.88, 1.1, 0);
        dintel.add(post);
    }
    group.add(dintel);

    // Cenote: hueco oscuro en la calzada
    const cenote = new THREE.Group();
    const hole = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x040d0b }));
    hole.scale.set(2.05, 0.12, 2.6);
    hole.position.y = 0.03;
    cenote.add(hole);
    const water = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: C.jadeDeep }));
    water.scale.set(1.6, 0.08, 2.1);
    water.position.y = 0.05;
    cenote.add(water);
    group.add(cenote);

    group.visible = false;
    scene.add(group);

    return { group, parts: [estela, dintel, cenote], type: -1, lane: 1, z: 0, active: false };
}

// El material es compartido por todas las piezas de jade: asi el pulso de
// brillo se anima una vez por frame en vez de una vez por instancia.
const JADE_GEO = new THREE.OctahedronGeometry(0.42);
const SHIELD_GEO = new THREE.TorusGeometry(0.46, 0.15, 6, 12);

function makeJade() {
    if (!jadeMaterial) {
        jadeMaterial = new THREE.MeshLambertMaterial({
            color: C.jade, emissive: C.jade, emissiveIntensity: 0.35
        });
    }
    if (!shieldMaterial) {
        shieldMaterial = new THREE.MeshLambertMaterial({
            color: C.ochre, emissive: C.ochre, emissiveIntensity: 0.5
        });
    }

    const mesh = new THREE.Mesh(JADE_GEO, jadeMaterial);
    mesh.visible = false;
    scene.add(mesh);

    // Cada hueco del pool puede servir jade normal o un escudo; se cambia la
    // geometria y el material al activarlo.
    return { mesh, lane: 1, z: 0, active: false, kind: 'jade' };
}

// --- Particulas de recogida ---
// Un solo InstancedMesh para todas: una draw call. Las inactivas se esconden
// escalandolas a cero, que es mas barato que quitarlas de la escena.
function buildParticles() {
    particleMesh = new THREE.InstancedMesh(
        BOX,
        new THREE.MeshBasicMaterial({ color: C.jade }),
        PARTICLE_POOL
    );
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    for (let i = 0; i < PARTICLE_POOL; i++) {
        particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 1 });
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
}

function burstParticles(x, y, z, count, size) {
    let spawned = 0;
    for (const p of particles) {
        if (spawned >= count) break;
        if (p.life > 0) continue;
        p.x = x; p.y = y; p.z = z;
        p.vx = (Math.random() - 0.5) * 7;
        p.vy = Math.random() * 6 + 2;
        p.vz = (Math.random() - 0.5) * 7;
        p.life = 0.5 + Math.random() * 0.25;
        p.size = size;
        spawned++;
    }
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

        // Escala pequena a proposito: con el factor anterior cada particula
        // medía casi lo mismo que el torso del jugador y tapaba la accion.
        const k = Math.max(0, p.life) * p.size * 0.34;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(k, k, k);
        dummy.rotation.set(p.x, p.y, 0);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
        dirty = true;

        if (p.life <= 0) {
            dummy.position.set(0, -999, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            particleMesh.setMatrixAt(i, dummy.matrix);
        }
    }
    if (dirty) particleMesh.instanceMatrix.needsUpdate = true;
}

function buildPools() {
    for (let i = 0; i < OBSTACLE_POOL; i++) obstacles.push(makeObstacle());
    for (let i = 0; i < JADE_POOL; i++) jades.push(makeJade());
}

// --- Jugador: figura voxel ---
function buildPlayer() {
    playerGroup = new THREE.Group();
    playerMats = [];

    const add = (color, sx, sy, sz, x, y, z) => {
        // transparent:true de entrada: la invulnerabilidad baja la opacidad,
        // y activarlo despues obligaria a recompilar el shader en mitad del
        // golpe, justo cuando peor sienta un tiron.
        const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
        playerMats.push(mat);
        const m = new THREE.Mesh(BOX, mat);
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        playerGroup.add(m);
        return m;
    };

    const torso = add(C.cloth, 0.86, 0.95, 0.55, 0, 1.28, 0);
    const head = add(C.skin, 0.62, 0.6, 0.6, 0, 2.05, 0);
    // Tocado de plumas, guino al quetzal
    add(C.jade, 0.7, 0.26, 0.7, 0, 2.45, 0);
    const armL = add(C.skin, 0.24, 0.72, 0.24, -0.58, 1.3, 0);
    const armR = add(C.skin, 0.24, 0.72, 0.24, 0.58, 1.3, 0);
    const legL = add(C.obsidian, 0.3, 0.8, 0.3, -0.24, 0.42, 0);
    const legR = add(C.obsidian, 0.3, 0.8, 0.3, 0.24, 0.42, 0);

    playerParts = { torso, head, armL, armR, legL, legR };
    scene.add(playerGroup);

    // Sombra de contacto. Sin ella no hay forma de juzgar donde vas a caer
    // ni si vas lo bastante alto para librar un cenote: es la ayuda de
    // lectura que mas se nota de todo el juego.
    shadowMesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 18),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38 })
    );
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.03, PLAYER_Z);
    scene.add(shadowMesh);
}

// --- Jaguar: la presion visual de las vidas ---
// No es un enemigo con colision propia. Su cercania ES el indicador de vidas:
// con tres esta fuera de plano, con una te respira en la nuca. Cuenta lo mismo
// que los rombos del HUD, pero sin apartar la vista de la calzada.
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
    // Manchas
    for (const [x, y, z] of [[0.45, 1.4, 0.4], [-0.4, 1.35, -0.2], [0.3, 1.4, -0.6], [-0.45, 1.3, 0.7]]) {
        piece(C.jaguarSpot, 0.3, 0.12, 0.3, x, y, z);
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
    jades.forEach(j => { j.active = false; j.mesh.visible = false; });
    game.nextSpawnZ = SPAWN_Z + 40;   // margen inicial para orientarse
}

function freeObstacle() { return obstacles.find(o => !o.active); }
function freeJade() { return jades.find(j => !j.active); }

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

function spawnJade(lane, z, height, kind = 'jade') {
    const j = freeJade();
    if (!j) return;
    j.lane = lane;
    j.z = z;
    j.active = true;
    j.kind = kind;
    j.mesh.geometry = kind === 'shield' ? SHIELD_GEO : JADE_GEO;
    j.mesh.material = kind === 'shield' ? shieldMaterial : jadeMaterial;
    j.mesh.visible = true;
    j.mesh.position.set(LANE_X[lane], height, z);
}

// Genera un "compas" de recorrido: un patron de obstaculos mas su jade.
// La dificultad sube reduciendo el hueco entre compases.
function generateChunk(z) {
    // Escudo: recompensa rara y solo util si no llevas ya uno
    if (!game.shield && Math.random() < SHIELD_CHANCE) {
        spawnJade((Math.random() * 3) | 0, z - 12, 1.3, 'shield');
    }

    const t = game.elapsed;
    const hard = Math.min(t / 95, 1);              // 0 -> 1 en poco mas de un minuto
    const pattern = Math.random();

    if (pattern < 0.3 + hard * 0.15) {
        // Un solo obstaculo, jade en los carriles libres
        const lane = (Math.random() * 3) | 0;
        const type = (Math.random() * 3) | 0;
        spawnObstacle(type, lane, z);
        for (let l = 0; l < 3; l++) {
            if (l !== lane && Math.random() < 0.72) spawnJade(l, z, 1.1);
        }
    } else if (pattern < 0.62 + hard * 0.1) {
        // Dos obstaculos: queda un unico carril libre
        const free = (Math.random() * 3) | 0;
        for (let l = 0; l < 3; l++) {
            if (l !== free) spawnObstacle((Math.random() * 3) | 0, l, z);
        }
        spawnJade(free, z, 1.1);
    } else if (pattern < 0.82) {
        // Pasillo de jade: recompensa sin riesgo, para respirar. Es el
        // patron que hace alcanzable la racha, asi que da de sobra.
        const lane = (Math.random() * 3) | 0;
        for (let k = 0; k < 5; k++) spawnJade(lane, z - k * 3.2, 1.1);
    } else {
        // Dintel en los tres carriles: hay que deslizarse, con jade alto
        // colocado justo detras para premiar el momento exacto
        for (let l = 0; l < 3; l++) spawnObstacle(DINTEL, l, z);
        spawnJade(1, z - 6, 1.1);
    }
}

// ===========================================================================
// Entrada
// ===========================================================================
function moveLane(dir) {
    const next = Math.max(0, Math.min(2, player.lane + dir));
    if (next === player.lane) return;
    player.lane = next;
    sfx.lane();
}

function jump() {
    // Coyote time y buffer: sin ellos, un salto pulsado una milesima antes de
    // aterrizar (o justo despues de dejar el borde) se perdia sin mas, que es
    // la queja clasica del genero.
    if (!player.grounded && player.coyote <= 0) {
        player.buffer = JUMP_BUFFER;
        return;
    }
    player.vy = JUMP_V;
    player.grounded = false;
    player.coyote = 0;
    player.buffer = 0;
    player.sliding = 0;
    sfx.jump();
}

function slide() {
    if (player.sliding > 0) return;
    player.sliding = SLIDE_TIME;
    if (!player.grounded) player.vy = Math.min(player.vy, -6);  // cae mas rapido
    sfx.slide();
}

function initInput() {
    window.addEventListener('keydown', (e) => {
        if (game.state === State.MENU && (e.code === 'Enter' || e.code === 'Space')) {
            e.preventDefault();
            startGame();
            return;
        }
        if (game.state === State.OVER && (e.code === 'Enter' || e.code === 'Space')) {
            e.preventDefault();
            startGame();
            return;
        }
        if (game.state === State.PLAYING || game.state === State.PAUSED) {
            switch (e.code) {
                case 'ArrowLeft': case 'KeyA': moveLane(-1); break;
                case 'ArrowRight': case 'KeyD': moveLane(1); break;
                case 'ArrowUp': case 'KeyW': case 'Space': e.preventDefault(); jump(); break;
                case 'ArrowDown': case 'KeyS': slide(); break;
                case 'KeyP': case 'Escape': togglePause(); break;
                case 'KeyM': setSound(!audio.on); break;
            }
        }
    });

    // Gestos tactiles: un solo trazo decide carril, salto o deslizamiento
    let sx = 0, sy = 0, tracking = false;
    const MIN_SWIPE = 26;

    window.addEventListener('touchstart', (e) => {
        if (game.state !== State.PLAYING) return;
        tracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        if (!tracking || game.state !== State.PLAYING) return;
        tracking = false;
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;

        if (Math.abs(dx) < MIN_SWIPE && Math.abs(dy) < MIN_SWIPE) {
            jump();     // toque simple = salto
            return;
        }
        if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
        else if (dy < 0) jump();
        else slide();
    }, { passive: true });
}

// ===========================================================================
// Simulacion
// ===========================================================================
function updatePlayer(dt) {
    // Carril
    const targetX = LANE_X[player.lane];
    player.x += (targetX - player.x) * Math.min(1, LANE_LERP * dt);

    // Salto
    if (!player.grounded) {
        player.coyote = Math.max(0, player.coyote - dt);
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) {
            player.y = 0;
            player.vy = 0;
            player.grounded = true;
            // Se atiende el salto que se pulso justo antes de tocar suelo
            if (player.buffer > 0) { player.buffer = 0; jump(); }
        }
    } else {
        player.coyote = COYOTE_TIME;
    }
    if (player.buffer > 0) player.buffer = Math.max(0, player.buffer - dt);

    // Deslizamiento
    if (player.sliding > 0) player.sliding = Math.max(0, player.sliding - dt);

    // Ciclo de carrera
    player.run += dt * game.speed * 0.55;

    // --- Postura ---
    playerGroup.position.set(player.x, player.y, PLAYER_Z);

    const sliding = player.sliding > 0 && player.grounded;
    // Agacharse achatando el grupo y echandolo hacia delante
    const squash = sliding ? 0.45 : 1;
    playerGroup.scale.set(1, squash, sliding ? 1.5 : 1);
    playerGroup.rotation.x = sliding ? -0.5 : 0;
    // Inclinacion al cambiar de carril, para dar peso al movimiento
    playerGroup.rotation.z = (targetX - player.x) * 0.09;

    if (player.grounded && !sliding) {
        const s = Math.sin(player.run);
        playerParts.armL.rotation.x = s * 0.9;
        playerParts.armR.rotation.x = -s * 0.9;
        playerParts.legL.position.z = s * 0.22;
        playerParts.legR.position.z = -s * 0.22;
        playerParts.torso.position.y = 1.28 + Math.abs(s) * 0.05;
    } else if (!player.grounded) {
        playerParts.armL.rotation.x = -2.1;
        playerParts.armR.rotation.x = -2.1;
        playerParts.legL.position.z = 0.12;
        playerParts.legR.position.z = -0.12;
    }

    // Sombra de contacto: se encoge y se aclara con la altura, que es lo que
    // permite calcular el aterrizaje.
    const h = Math.min(player.y, 6);
    const k = 1 - h * 0.085;
    shadowMesh.position.x = player.x;
    shadowMesh.scale.set(k, k, 1);
    shadowMesh.material.opacity = Math.max(0.08, 0.4 - h * 0.045);

    // Invulnerabilidad: se baja la opacidad en vez de ocultar al personaje.
    // Alternar `visible` lo hacia desaparecer 1,4 s justo cuando mas falta
    // hace saber donde estas.
    if (game.invuln > 0) {
        game.invuln -= dt;
        const flash = 0.35 + 0.45 * (Math.sin(game.invuln * 34) * 0.5 + 0.5);
        for (const m of playerMats) m.opacity = flash;
        if (game.invuln <= 0) for (const m of playerMats) m.opacity = 1;
    }
}

function scrollWorld(dt) {
    const dz = game.speed * dt;
    game.distance += dz;

    // --- Calzada y templos: solo se mueve el Group ---
    // Antes se recolocaban las 180 instancias de la calzada y se reconstruian
    // los 70 cubos de los templos en CADA paso de simulacion (120 por segundo),
    // reenviando ademas el buffer de color entero. Al ser ambos escenarios
    // periodicos basta con desplazar su contenedor y envolver con un modulo.
    roadGroup.position.z = game.distance % ROAD_PERIOD;
    templeGroup.position.z = (game.distance * 0.82) % TEMPLE_PERIOD;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        o.z += dz;
        o.group.position.z = o.z;
        if (o.z > DESPAWN_Z) { o.active = false; o.group.visible = false; }
    }

    // --- Jade ---
    for (const j of jades) {
        if (!j.active) continue;
        j.z += dz;
        j.mesh.position.z = j.z;
        j.mesh.rotation.y += dt * 3.4;
        j.mesh.rotation.x += dt * 1.6;
        if (j.z > DESPAWN_Z) { j.active = false; j.mesh.visible = false; }
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
    // --- Jade y escudos ---
    for (const j of jades) {
        if (!j.active) continue;
        if (Math.abs(j.z - PLAYER_Z) > 1.3) continue;
        // Por posicion real, no por indice de carril
        if (Math.abs(player.x - LANE_X[j.lane]) > JADE_REACH) continue;
        if (Math.abs(j.mesh.position.y - (player.y + 1.1)) > 1.7) continue;

        j.active = false;
        j.mesh.visible = false;

        if (j.kind === 'shield') {
            game.shield = true;
            sfx.shield();
            burstParticles(j.mesh.position.x, j.mesh.position.y, j.z, 14, 1.1);
        } else {
            game.jade++;
            game.combo++;
            game.jadeScore += 25 * comboMultiplier();
            sfx.jade();
            burstParticles(j.mesh.position.x, j.mesh.position.y, j.z, 8, 0.85);
        }
        renderHud();
    }

    if (game.invuln > 0) return;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        if (Math.abs(o.z - PLAYER_Z) > HIT_WINDOW) continue;
        // Igual que el jade: cuenta donde esta el cuerpo, no a que carril
        // apunta la ultima tecla pulsada.
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
        burstParticles(player.x, player.y + 1.2, PLAYER_Z, 18, 1.2);
        renderHud();
        return;
    }

    game.lives--;
    sfx.hit();
    burstParticles(player.x, player.y + 1.2, PLAYER_Z, 10, 1);
    renderHud();

    if (game.lives <= 0) endGame();
}

// --- Hitos cada 500 m ---
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

// ===========================================================================
// HUD
// ===========================================================================
function renderHud() {
    let marks = '';
    for (let i = 0; i < START_LIVES; i++) {
        marks += i < game.lives ? '◆ ' : '<span class="spent">◆</span> ';
    }
    dom.lives.innerHTML = marks.trim();
    dom.jade.textContent = game.jade;
    dom.dist.textContent = Math.floor(game.distance);

    const mult = comboMultiplier();
    if (mult > 1) {
        dom.combo.textContent = '×' + mult;
        dom.combo.hidden = false;
    } else {
        dom.combo.hidden = true;
    }

    dom.shield.hidden = !game.shield;
}

// El jade ya se puntua al recogerlo, aplicando el multiplicador vigente en
// ese momento: asi la racha premia de verdad el juego arriesgado.
function scoreOf() {
    return Math.floor(game.distance) + game.jadeScore;
}

// ===========================================================================
// Ciclo de ambiente
// ===========================================================================
// Se interpola entre fases segun la distancia, de modo que el kilometro 3 no
// se ve igual que el 1. Cielo, niebla, suelo y luces cambian a la vez; si
// solo cambiara el cielo, el resto de la escena delataria el truco.
const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _cMix = new THREE.Color();
let lastSkyPaint = -1;

function mixHex(a, b, t, out) {
    _cA.setHex(a);
    _cB.setHex(b);
    return out.copy(_cA).lerp(_cB, t);
}

function applyPhase(distance) {
    const pos = distance / PHASE_LENGTH;
    const i = Math.floor(pos) % PHASES.length;
    const j = (i + 1) % PHASES.length;
    const raw = pos - Math.floor(pos);
    // Suavizado: las fases se sostienen y la transicion ocurre al final,
    // en vez de estar cambiando de color permanentemente.
    const t = raw < 0.65 ? 0 : (raw - 0.65) / 0.35;
    const e = t * t * (3 - 2 * t);          // smoothstep

    const A = PHASES[i], B = PHASES[j];

    mixHex(A.fog, B.fog, e, _cMix);
    scene.fog.color.copy(_cMix);

    mixHex(A.ground, B.ground, e, _cMix);
    groundMesh.material.color.copy(_cMix);

    mixHex(A.sun, B.sun, e, _cMix);
    sunLight.color.copy(_cMix);
    sunLight.intensity = A.sunI + (B.sunI - A.sunI) * e;

    mixHex(A.hemi, B.hemi, e, _cMix);
    hemiLight.color.copy(_cMix);
    hemiLight.intensity = A.hemiI + (B.hemiI - A.hemiI) * e;
    mixHex(A.ground, B.ground, e, _cMix);
    hemiLight.groundColor.copy(_cMix);

    // El canvas del cielo solo se redibuja cuando el color cambia lo bastante:
    // hacerlo en cada frame seria tirar trabajo a la basura.
    const key = Math.round((i + e) * 40);
    if (key !== lastSkyPaint) {
        lastSkyPaint = key;
        const top = mixHex(A.skyTop, B.skyTop, e, _cMix).getStyle();
        const bot = mixHex(A.skyBot, B.skyBot, e, _cMix).getStyle();
        const g = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
        g.addColorStop(0, top);
        g.addColorStop(1, bot);
        skyCtx.fillStyle = g;
        skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
        skyTexture.needsUpdate = true;
    }
}

// ===========================================================================
// Jaguar y quetzal
// ===========================================================================
function updateCompanions(dt) {
    // Jaguar: su cercania es el indicador de vidas. Con tres esta fuera de
    // plano; con una, encima del jugador.
    // Con una vida se acerca, pero no tanto como para tapar al jugador: la
    // lectura de la calzada tiene que seguir siendo limpia justo cuando mas
    // importa no fallar.
    const targetZ = [5.8, 9.5, 20][Math.max(0, Math.min(2, game.lives - 1))];
    jaguar.visible = game.lives < START_LIVES;
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

    // Quetzal: vuela al lado, sin colision ni funcion. Solo compania.
    quetzal.visible = true;
    const bob = Math.sin(game.elapsed * 3.4);
    quetzal.position.set(
        player.x - 4.6 + Math.sin(game.elapsed * 0.7) * 0.4,
        3.5 + bob * 0.3,
        PLAYER_Z - 7 + Math.cos(game.elapsed * 0.9) * 0.7
    );
    quetzal.scale.setScalar(0.85);
    quetzal.rotation.z = bob * 0.12;
    const flap = Math.sin(game.elapsed * 15) * 0.7;
    quetzal.userData.wingL.rotation.z = flap;
    quetzal.userData.wingR.rotation.z = -flap;
}

// ===========================================================================
// Ciclo de vida de la partida
// ===========================================================================
function startGame() {
    initAudio();
    sfx.start();

    game.state = State.PLAYING;
    game.speed = SPEED_START;
    game.distance = 0;
    game.jade = 0;
    game.jadeScore = 0;
    game.combo = 0;
    game.lives = START_LIVES;
    game.shield = false;
    game.invuln = 0;
    game.elapsed = 0;
    game.nextMilestone = MILESTONE_EVERY;
    game.best = readBest();
    jadeStreak = 0;

    player.lane = 1;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.grounded = true;
    player.sliding = 0;
    player.coyote = COYOTE_TIME;
    player.buffer = 0;
    playerGroup.visible = true;
    for (const m of playerMats) m.opacity = 1;

    jaguar.position.set(0, 0, 20);
    resetWorld();
    renderHud();
    dom.hudBest.textContent = game.best;

    dom.menu.hidden = true;
    dom.over.hidden = true;
    dom.hud.hidden = false;
    dom.soundBtn.hidden = false;
    dom.pauseBtn.hidden = false;
    dom.pauseTag.hidden = true;
    dom.milestone.hidden = true;
}

function endGame() {
    game.state = State.OVER;
    sfx.over();

    const score = scoreOf();
    const best = readBest();
    const isRecord = score > best;
    if (isRecord) writeBest(score);

    dom.finalDist.textContent = Math.floor(game.distance) + ' m';
    dom.finalJade.textContent = game.jade;
    dom.finalScore.textContent = score;
    dom.bestScore.textContent = isRecord ? score : best;
    dom.recordTag.textContent = isRecord ? '¡Nueva mejor marca!' : '';
    dom.overTitle.textContent = isRecord ? '¡RÉCORD!' : 'FIN';

    dom.hud.hidden = true;
    dom.over.hidden = false;
    dom.pauseTag.hidden = true;
    dom.pauseBtn.hidden = true;
    dom.milestone.hidden = true;
    dom.speedVeil.style.opacity = '0';
}

function togglePause() {
    if (game.state === State.PLAYING) {
        game.state = State.PAUSED;
        dom.pauseTag.hidden = false;
        dom.pauseBtn.textContent = '▶';
    } else if (game.state === State.PAUSED) {
        game.state = State.PLAYING;
        dom.pauseTag.hidden = true;
        dom.pauseBtn.textContent = 'II';
    }
}

// ===========================================================================
// Bucle principal: paso fijo acumulado
// ===========================================================================
// Paso fijo a 60 Hz con tope de 6 pasos por frame.
// Estaba a 120 Hz con tope de 8, es decir 0,067 s de simulacion por frame:
// por debajo de ~15 fps el juego entraba en camara lenta en vez de seguir el
// reloj. A 60 Hz el mismo tope cubre 0,1 s y aguanta hasta ~10 fps, ademas de
// costar la mitad de CPU. A 31 u/s un paso avanza 0,52 unidades, muy por
// debajo de la ventana de colision (2,2 de fondo), asi que nada se cuela.
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
    // Si la pestana estuvo oculta, delta puede ser enorme: se recorta para
    // que el jugador no aparezca de golpe dentro de un obstaculo.
    if (delta > 0.25) delta = 0.25;

    if (game.state === State.PLAYING) {
        accumulator += delta;
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS) {
            game.elapsed += STEP;
            game.speed = Math.min(SPEED_MAX, SPEED_START + game.elapsed * SPEED_RAMP);
            updatePlayer(STEP);
            scrollWorld(STEP);
            checkCollisions();
            checkMilestone();
            updateParticles(STEP);
            updateCompanions(STEP);
            accumulator -= STEP;
            steps++;
        }
        renderHud();
        applyPhase(game.distance);

        // Pulso del jade: un unico material compartido, asi que basta una
        // asignacion por frame para todas las piezas de la escena.
        if (jadeMaterial) {
            jadeMaterial.emissiveIntensity = 0.3 + Math.sin(t * 5) * 0.22;
        }
        if (shieldMaterial) {
            shieldMaterial.emissiveIntensity = 0.45 + Math.sin(t * 8) * 0.3;
        }

        // Vineta y campo de vision segun la velocidad: es la unica pista de
        // que aceleras de 15 a 31.
        const rush = (game.speed - SPEED_START) / (SPEED_MAX - SPEED_START);
        dom.speedVeil.style.opacity = (rush * 0.85).toFixed(2);
        const wantFov = cam.fov + rush * 6;
        if (Math.abs(camera.fov - wantFov) > 0.05) {
            camera.fov = wantFov;
            camera.updateProjectionMatrix();
        }
    } else if (game.state === State.MENU) {
        // El menu se ve sobre la escena, asi que conviene que respire
        applyPhase(0);
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
    if (!webglAvailable()) {
        dom.menu.hidden = true;
        dom.unsupported.hidden = false;
        return;
    }

    buildScene();
    initInput();

    // Preferencia de sonido guardada; por defecto activado
    let pref = null;
    try { pref = localStorage.getItem('sacbe-sound'); } catch (e) {}
    setSound(pref === null ? true : pref === '1');

    // Aviso de movimiento: el juego es movimiento continuo y no se puede
    // atenuar, asi que se avisa y se deja entrar por voluntad propia.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dom.motionNotice.hidden = false;
    }

    dom.bestScore.textContent = readBest();

    dom.playBtn.addEventListener('click', startGame);
    dom.againBtn.addEventListener('click', startGame);
    dom.soundPref.addEventListener('click', () => { initAudio(); setSound(!audio.on); });
    dom.soundBtn.addEventListener('click', () => setSound(!audio.on));
    dom.pauseBtn.addEventListener('click', togglePause);

    // Pausa al perder el foco: misma leccion que el canvas de particulas
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.state === State.PLAYING) togglePause();
    });

    window.addEventListener('resize', () => {
        layoutCamera();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, { passive: true });

    requestAnimationFrame(frame);
}

boot();
