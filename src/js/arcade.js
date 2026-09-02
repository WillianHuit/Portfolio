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
const DESPAWN_Z = 14;               // pasado esto se reciclan

const HIT_WINDOW = 1.1;             // media profundidad de colision en Z
const INVULN_TIME = 1.4;            // margen tras recibir un golpe
const START_LIVES = 3;

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
    cloth: 0xc0453a
};

// ===========================================================================
// Estado
// ===========================================================================
const State = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

const game = {
    state: State.MENU,
    speed: SPEED_START,
    distance: 0,
    jade: 0,
    lives: START_LIVES,
    invuln: 0,
    elapsed: 0,
    nextSpawnZ: SPAWN_Z
};

const player = {
    lane: 1,
    x: 0,
    y: 0,
    vy: 0,
    grounded: true,
    sliding: 0,
    run: 0            // fase del ciclo de carrera, para el balanceo
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
    bestScore: document.getElementById('bestScore')
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
let playerGroup, playerParts;
const obstacles = [];
const jades = [];

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
    // Bruma de selva al amanecer: da profundidad y deja ver la piedra clara.
    // Con el verde oscuro anterior los templos del fondo se veian casi negros.
    scene.background = new THREE.Color(C.haze);
    // La niebla oculta el reciclado: los objetos aparecen fundiendose, no de golpe
    scene.fog = new THREE.Fog(C.haze, 55, 185);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    // Retirada y elevada: con la posicion anterior el personaje comia un
    // tercio del encuadre y los obstaculos se veian demasiado tarde.
    camera.position.set(0, cam.y, 14);
    layoutCamera();
    camera.lookAt(0, cam.aimY, cam.aimZ);

    // --- Luces: sin shadow maps, demasiado caro para lo que aporta aqui ---
    scene.add(new THREE.HemisphereLight(0xe8f4ea, C.jungle, 2.3));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
    sun.position.set(-9, 20, 7);
    scene.add(sun);
    // Relleno tenue desde el lado opuesto, para que las caras en sombra de
    // estelas y dinteles no queden planas del todo
    const fill = new THREE.DirectionalLight(0xbfd8e8, 0.55);
    fill.position.set(8, 6, -10);
    scene.add(fill);

    buildGround();
    buildRoad();
    buildTemples();
    buildPools();
    buildPlayer();
}

// --- Suelo de selva ---
// Es un unico plano estatico. No necesita desplazarse porque es de color
// uniforme: la sensacion de avance la dan la calzada y los templos. Sin el,
// los templos del fondo parecian flotar sobre la bruma.
function buildGround() {
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(700, 900),
        new THREE.MeshLambertMaterial({ color: C.jungle })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -1.02, -320);
    scene.add(ground);
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

function makeJade() {
    const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42),
        new THREE.MeshLambertMaterial({ color: C.jade, emissive: C.jadeDeep, emissiveIntensity: 0.6 })
    );
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, lane: 1, z: 0, active: false };
}

function buildPools() {
    for (let i = 0; i < OBSTACLE_POOL; i++) obstacles.push(makeObstacle());
    for (let i = 0; i < JADE_POOL; i++) jades.push(makeJade());
}

// --- Jugador: figura voxel de cinco cajas ---
function buildPlayer() {
    playerGroup = new THREE.Group();

    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const add = (color, sx, sy, sz, x, y, z) => {
        const m = new THREE.Mesh(BOX, mat(color));
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

function spawnJade(lane, z, height) {
    const j = freeJade();
    if (!j) return;
    j.lane = lane;
    j.z = z;
    j.active = true;
    j.mesh.visible = true;
    j.mesh.position.set(LANE_X[lane], height, z);
}

// Genera un "compas" de recorrido: un patron de obstaculos mas su jade.
// La dificultad sube reduciendo el hueco entre compases.
function generateChunk(z) {
    const t = game.elapsed;
    const hard = Math.min(t / 95, 1);              // 0 -> 1 en poco mas de un minuto
    const pattern = Math.random();

    if (pattern < 0.3 + hard * 0.15) {
        // Un solo obstaculo, jade en los carriles libres
        const lane = (Math.random() * 3) | 0;
        const type = (Math.random() * 3) | 0;
        spawnObstacle(type, lane, z);
        for (let l = 0; l < 3; l++) {
            if (l !== lane && Math.random() < 0.55) spawnJade(l, z, 1.1);
        }
    } else if (pattern < 0.62 + hard * 0.1) {
        // Dos obstaculos: queda un unico carril libre
        const free = (Math.random() * 3) | 0;
        for (let l = 0; l < 3; l++) {
            if (l !== free) spawnObstacle((Math.random() * 3) | 0, l, z);
        }
        spawnJade(free, z, 1.1);
    } else if (pattern < 0.82) {
        // Pasillo de jade: recompensa sin riesgo, para respirar
        const lane = (Math.random() * 3) | 0;
        for (let k = 0; k < 4; k++) spawnJade(lane, z - k * 3.2, 1.1);
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
    if (!player.grounded) return;
    player.vy = JUMP_V;
    player.grounded = false;
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
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; }
    }

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

    // Parpadeo durante la invulnerabilidad
    if (game.invuln > 0) {
        game.invuln -= dt;
        playerGroup.visible = Math.floor(game.invuln * 12) % 2 === 0;
        if (game.invuln <= 0) playerGroup.visible = true;
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
    // --- Jade ---
    for (const j of jades) {
        if (!j.active) continue;
        if (Math.abs(j.z - PLAYER_Z) > 1.2) continue;
        if (j.lane !== player.lane) continue;
        if (Math.abs(j.mesh.position.y - (player.y + 1.1)) > 1.6) continue;

        j.active = false;
        j.mesh.visible = false;
        game.jade++;
        sfx.jade();
        dom.jade.textContent = game.jade;
    }

    if (game.invuln > 0) return;

    // --- Obstaculos ---
    for (const o of obstacles) {
        if (!o.active) continue;
        if (Math.abs(o.z - PLAYER_Z) > HIT_WINDOW) continue;
        if (o.lane !== player.lane) continue;

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

function takeHit() {
    game.lives--;
    game.invuln = INVULN_TIME;
    jadeStreak = 0;
    sfx.hit();
    renderHud();

    // Sacudida breve de camara
    shake = 0.5;

    if (game.lives <= 0) endGame();
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
}

function scoreOf() {
    return Math.floor(game.distance) + game.jade * 25;
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
    game.lives = START_LIVES;
    game.invuln = 0;
    game.elapsed = 0;
    jadeStreak = 0;

    player.lane = 1;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.grounded = true;
    player.sliding = 0;
    playerGroup.visible = true;

    resetWorld();
    renderHud();

    dom.menu.hidden = true;
    dom.over.hidden = true;
    dom.hud.hidden = false;
    dom.soundBtn.hidden = false;
    dom.pauseTag.hidden = true;
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
}

function togglePause() {
    if (game.state === State.PLAYING) {
        game.state = State.PAUSED;
        dom.pauseTag.hidden = false;
    } else if (game.state === State.PAUSED) {
        game.state = State.PLAYING;
        dom.pauseTag.hidden = true;
    }
}

// ===========================================================================
// Bucle principal: paso fijo acumulado
// ===========================================================================
const STEP = 1 / 120;
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
        while (accumulator >= STEP && steps < 8) {
            game.elapsed += STEP;
            game.speed = Math.min(SPEED_MAX, SPEED_START + game.elapsed * SPEED_RAMP);
            updatePlayer(STEP);
            scrollWorld(STEP);
            checkCollisions();
            accumulator -= STEP;
            steps++;
        }
        renderHud();
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
