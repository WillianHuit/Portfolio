// ===========================================================================
// Hero 3D: plaza urbana de la Ciudad de Guatemala vista en contrapicado.
// ===========================================================================
// Composicion (de izquierda a derecha, como en la fotografia de referencia):
// dos torres gemelas de vidrio dorado con remate escalonado, una torre esbelta
// al fondo, un edificio de fachada curva azul con franjas blancas, y en primer
// plano una plaza circular de ladrillo con una escultura de celosia sostenida
// por dos figuras.
//
// - Todo es procedural: sin modelos ni imagenes externas. El cielo y las
//   ventanas se dibujan en canvas 2D.
// - El cielo tambien alimenta los reflejos del vidrio (PMREM): sin eso una torre
//   de vidrio parece una caja pintada.
// - Sombras solo en escritorio. En movil se omiten para no gastar bateria.
// - Three.js (670 KB) se importa DESPUES del primer pintado y en tiempo ocioso.
//   Sin WebGL, con "reducir movimiento" o con ahorro de datos no se carga nada:
//   el hero conserva su malla CSS y las particulas 2D.
// - La escena se pausa cuando sale de pantalla o la pestana esta oculta.
// ===========================================================================

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = navigator.connection && navigator.connection.saveData;

function hasWebGL() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
        return false;
    }
}

function whenIdle(fn) {
    const run = () => ('requestIdleCallback' in window
        ? requestIdleCallback(fn, { timeout: 2500 })
        : setTimeout(fn, 800));
    if (document.readyState === 'complete') run();
    else addEventListener('load', run, { once: true });
}

const canvas = document.getElementById('hero3d');

if (canvas && !reduce && !saveData && hasWebGL()) {
    whenIdle(async () => {
        try {
            const THREE = await import('../vendor/three.module.min.js');
            createScene(THREE, canvas);
        } catch (e) {
            console.warn('Escena 3D no disponible', e);
        }
    });
}

// ---------------------------------------------------------------------------
// Generador pseudoaleatorio con semilla (misma escena en cada visita)
// ---------------------------------------------------------------------------
function rng(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ---------------------------------------------------------------------------
// Cielo: lienzo equirectangular con degradado, nubes y estrellas
// ---------------------------------------------------------------------------
function skyCanvas(night) {
    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rnd = rng(night ? 7 : 3);

    const grad = g.createLinearGradient(0, 0, 0, H);
    if (night) {
        grad.addColorStop(0.00, '#040b14');
        grad.addColorStop(0.32, '#0a1a2a');
        grad.addColorStop(0.47, '#1a3640');
        grad.addColorStop(0.50, '#2a4448');
        grad.addColorStop(0.52, '#16262a');
        grad.addColorStop(1.00, '#0b1513');
    } else {
        // Atardecer: azul arriba, crema y ambar hacia el horizonte
        grad.addColorStop(0.00, '#3a72b4');
        grad.addColorStop(0.30, '#6ea5d8');
        grad.addColorStop(0.44, '#bcd8ec');
        grad.addColorStop(0.495, '#f8dcae');
        grad.addColorStop(0.52, '#e9d1a8');
        grad.addColorStop(1.00, '#a79a82');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    if (night) {
        for (let i = 0; i < 320; i++) {
            const y = rnd() * H * 0.46;
            g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.7})`;
            g.fillRect(rnd() * W, y, rnd() < 0.15 ? 2 : 1, rnd() < 0.15 ? 2 : 1);
        }
    }

    // Nubes: manchas suaves; se dibujan tambien desplazadas +-W para que el
    // borde del lienzo no deje una costura al envolver la esfera.
    function blob(x, y, rx, ry, color) {
        for (const dx of [-W, 0, W]) {
            const r = g.createRadialGradient(x + dx, y, 0, x + dx, y, rx);
            r.addColorStop(0, color);
            r.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
            g.save();
            g.translate(0, y);
            g.scale(1, ry / rx);
            g.translate(0, -y);
            g.fillStyle = r;
            g.beginPath();
            g.arc(x + dx, y, rx, 0, Math.PI * 2);
            g.fill();
            g.restore();
        }
    }
    for (let i = 0; i < 38; i++) {
        const cx = rnd() * W, cy = H * (0.12 + rnd() * 0.30);
        const size = 50 + rnd() * 90;
        const parts = 6 + ((rnd() * 5) | 0);
        for (let p = 0; p < parts; p++) {
            const ox = (rnd() - 0.5) * size * 2.2, oy = (rnd() - 0.5) * size * 0.35;
            if (night) {
                blob(cx + ox, cy + oy, size * (0.5 + rnd() * 0.5), size * 0.22, 'rgba(70,95,125,0.22)');
            } else {
                // base calida (luz del ocaso por debajo) y cuerpo blanco
                blob(cx + ox, cy + oy + size * 0.08, size * (0.5 + rnd() * 0.5), size * 0.2, 'rgba(255,196,140,0.30)');
                blob(cx + ox, cy + oy, size * (0.45 + rnd() * 0.45), size * 0.2, 'rgba(255,255,255,0.55)');
            }
        }
    }
    return c;
}

function glowTexture(THREE, inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, inner);
    r.addColorStop(0.18, inner);
    r.addColorStop(0.45, outer);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// ---------------------------------------------------------------------------
// Fachadas: vidrio con perfiles de aluminio; de noche, ventanas encendidas
// ---------------------------------------------------------------------------
const GLASS = {
    towerL: ['#86b0c8', '#54839f', '#2f586f'],   // torre grande (izquierda)
    towerR: ['#8fb8cc', '#5f8ea8', '#3a6379'],   // torre menor (derecha)
    podium: ['#5d7684', '#415764', '#2e414c'],
    blue:   ['#5aa8dc', '#3f88c4', '#2a6aa4']    // fachada curva
};
// Pilares de piedra clara entre el vidrio (como en las fotos de referencia)
const PIER = { towerL: true, towerR: true };
// Color de las tiras LED nocturnas
const LED = { towerL: '#46a8ff', towerR: '#46a8ff', podium: '#ffd98a', blue: '#36e38a' };

function facadeCanvas(kind, night, seed, cols, rows) {
    const W = 32 * cols, H = 24 * rows;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rnd = rng(seed);

    const grad = g.createLinearGradient(0, 0, W, H);
    if (night) { grad.addColorStop(0, '#0b1d2a'); grad.addColorStop(1, '#07141c'); }
    else       { GLASS[kind].forEach((col, i) => grad.addColorStop(i / 2, col)); }
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const cw = W / cols, ch = H / rows;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (night) {
                if (rnd() < 0.30) {
                    g.fillStyle = rnd() < 0.8 ? '#ffd98a' : '#c4e7ff';
                    g.fillRect(x * cw + 4, y * ch + 4, cw - 8, ch - 9);
                }
            } else if (rnd() < 0.20) {
                // reflejos calidos del ocaso en algunos panos
                g.fillStyle = rnd() < 0.6 ? 'rgba(255,205,120,0.30)' : 'rgba(255,255,255,0.18)';
                g.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
            }
        }
    }

    // Antepecho horizontal en cada piso
    g.fillStyle = night ? 'rgba(0,0,0,0.55)' : 'rgba(20,38,48,0.65)';
    for (let y = 0; y < rows; y++) g.fillRect(0, y * ch + ch - 3, W, 3);

    // Tiras LED horizontales (solo de noche)
    if (night && LED[kind]) {
        g.fillStyle = LED[kind];
        for (let y = 0; y < rows; y += 2) g.fillRect(0, y * ch + ch - 8, W, 4);
    }

    // Pilares de piedra clara cada tres panos
    if (PIER[kind]) {
        for (let x = 0; x < cols; x += 3) {
            g.fillStyle = night ? '#1d2022' : '#cdc2ab';
            g.fillRect(x * cw, 0, 7, H);
            g.fillStyle = night ? '#101213' : '#9d927c';
            g.fillRect(x * cw + 7, 0, 2, H);
        }
    }
    return c;
}

function brickCanvas(dark) {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const rnd = rng(21);
    g.fillStyle = dark ? '#2b1710' : '#7a3d27';
    g.fillRect(0, 0, S, S);
    const bw = 32, bh = 16;
    for (let y = 0; y < S / bh; y++) {
        for (let x = -1; x < S / bw; x++) {
            const off = (y % 2) * (bw / 2);
            const v = (rnd() - 0.5) * 36;
            const base = dark ? [128, 66, 44] : [196, 98, 60];
            g.fillStyle = `rgb(${base[0] + v}, ${base[1] + v * 0.6}, ${base[2] + v * 0.4})`;
            g.fillRect(x * bw + off + 1, y * bh + 1, bw - 2, bh - 2);
        }
    }
    return c;
}

// ---------------------------------------------------------------------------
const PALETTES = {
    light: {
        exposure: 1.0,
        hemiSky: 0xbfd8f0, hemiGround: 0xd2b088, hemiI: 1.15,
        sun: 0xffd9a0, sunI: 3.4,
        fog: 0xe9d4b2, fogNear: 70, fogFar: 400,
        ground: 0x9aa09a, asphalt: 0x3c4144, side: 0xd8d3c8, podium: 0xd6d2c8,
        tree: 0x4c9a68, trunk: 0x6b4a32,
        bronze: 0x8a5a36, rust: 0x8a3f22,
        lamp: 0, spot: 0, point: 0, envI: 1.25
    },
    dark: {
        exposure: 1.15,
        hemiSky: 0x5a74b0, hemiGround: 0x1a1f26, hemiI: 0.7,
        sun: 0xa9bfff, sunI: 0.8,
        fog: 0x0c1a1f, fogNear: 60, fogFar: 340,
        ground: 0x1d2522, asphalt: 0x14191b, side: 0x59605c, podium: 0x474c4a,
        tree: 0x20493a, trunk: 0x3a2b20,
        bronze: 0xb27c4a, rust: 0x9a4a2a,
        lamp: 3.2, spot: 320, point: 140, envI: 0.7
    }
};

const SUN_DIR = [0.42, 0.26, -0.87];

// ---------------------------------------------------------------------------
function createScene(THREE, canvas) {
    const desktop = innerWidth > 900;

    const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'low-power'
    });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = desktop;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe9d4b2, 70, 260);
    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 900);

    // --- luces ------------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(SUN_DIR[0] * 90, SUN_DIR[1] * 90 + 8, SUN_DIR[2] * 90);
    sun.castShadow = desktop;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 5; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;

    // Foco desde el suelo que baña la escultura (solo de noche)
    const spot = new THREE.SpotLight(0xffc27a, 0, 80, 0.5, 0.6, 1.2);
    spot.position.set(0, 0.6, 7);
    spot.target.position.set(0, 14, 0);
    // Dos farolas de relleno sobre la plaza
    const pointL = new THREE.PointLight(0xffb866, 0, 34, 1.5);
    pointL.position.set(-9, 5, 9);
    const pointR = pointL.clone();
    pointR.position.set(9, 5, 9);
    scene.add(hemi, sun, spot, spot.target, pointL, pointR);

    // --- cielo ------------------------------------------------------------
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, toneMapped: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(520, 40, 20), skyMat);
    scene.add(dome);

    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(THREE, 'rgba(255,248,225,1)', 'rgba(255,190,110,0.45)'),
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    }));
    sunSprite.position.set(SUN_DIR[0] * 450, SUN_DIR[1] * 450 + 30, SUN_DIR[2] * 450);
    sunSprite.scale.set(260, 260, 1);
    const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(THREE, 'rgba(235,242,255,1)', 'rgba(150,180,255,0.30)'),
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    }));
    moonSprite.position.copy(sunSprite.position);
    moonSprite.scale.set(110, 110, 1);
    scene.add(sunSprite, moonSprite);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyCache = {};
    function skyFor(night) {
        const key = night ? 'n' : 'd';
        if (!skyCache[key]) {
            const cv = skyCanvas(night);
            const dtex = new THREE.CanvasTexture(cv);
            dtex.colorSpace = THREE.SRGBColorSpace;
            const etex = new THREE.CanvasTexture(cv);
            etex.mapping = THREE.EquirectangularReflectionMapping;
            etex.colorSpace = THREE.SRGBColorSpace;
            const rt = pmrem.fromEquirectangular(etex);
            etex.dispose();
            skyCache[key] = { dome: dtex, env: rt.texture };
        }
        return skyCache[key];
    }

    // --- materiales compartidos ------------------------------------------
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const groundMat = std({ color: 0x9aa09a, roughness: 1, metalness: 0 });
    const asphaltMat = std({ color: 0x3c4144, roughness: 0.95, metalness: 0 });
    const sideMat = std({ color: 0xd8d3c8, roughness: 0.9, metalness: 0 });
    const podiumMat = std({ color: 0xd6d2c8, roughness: 0.85, metalness: 0.05 });
    const rustMat = std({ color: 0x8a3f22, roughness: 0.55, metalness: 0.55 });
    const bronzeMat = std({ color: 0x8a5a36, roughness: 0.4, metalness: 0.7 });
    const whiteMat = std({ color: 0xf4f1ea, roughness: 0.5, metalness: 0.1 });
    const bandMat = std({ color: 0xf4f1ea, emissive: 0x39ff7a, emissiveIntensity: 0, roughness: 0.4, side: THREE.DoubleSide });
    const lampPoleMat = std({ color: 0x2b3033, roughness: 0.6, metalness: 0.6 });
    const lampHeadMat = std({ color: 0xfff1cf, emissive: 0xffd98a, emissiveIntensity: 0, roughness: 0.4 });
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x4c9a68 });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a32 });
    const envMats = [groundMat, asphaltMat, sideMat, podiumMat, rustMat, bronzeMat, whiteMat, bandMat, lampPoleMat];

    const brickDay = new THREE.CanvasTexture(brickCanvas(false));
    const brickNight = new THREE.CanvasTexture(brickCanvas(true));
    [brickDay, brickNight].forEach((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(5, 5);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
    });
    const brickMat = std({ map: brickDay, roughness: 0.9, metalness: 0 });
    envMats.push(brickMat);

    function shadowed(mesh, cast = true, receive = false) {
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        return mesh;
    }

    // --- suelo y calzada --------------------------------------------------
    const ground = new THREE.Mesh(new THREE.CircleGeometry(500, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    scene.add(ground);

    const road = new THREE.Mesh(new THREE.RingGeometry(16.5, 34, 80), asphaltMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.0;
    road.receiveShadow = true;
    scene.add(road);

    const walk = new THREE.Mesh(new THREE.RingGeometry(13.2, 16.5, 80), sideMat);
    walk.rotation.x = -Math.PI / 2;
    walk.position.y = 0.01;
    walk.receiveShadow = true;
    scene.add(walk);

    // --- plaza escalonada de ladrillo ------------------------------------
    [13, 12, 11, 10, 9.2].forEach((rad, i) => {
        const h = 0.3;
        const step = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.12, h, 64), brickMat);
        step.position.y = h * i + h / 2;
        step.receiveShadow = true;
        step.castShadow = true;
        scene.add(step);
    });

    // Esferas blancas del borde
    const bollards = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), whiteMat, 18);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        m4.makeTranslation(Math.cos(a) * 14.4, 0.4, Math.sin(a) * 14.4);
        bollards.setMatrixAt(i, m4);
    }
    bollards.castShadow = true;
    scene.add(bollards);

    // --- escultura: celosia sostenida por dos figuras ---------------------
    const BASE_Y = 1.5;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 1.0, 32), rustMat);
    plinth.position.y = BASE_Y + 0.5;
    shadowed(plinth, true, true);
    scene.add(plinth);

    const Y = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const unit = new THREE.CylinderGeometry(1, 1, 1, 6);
    function beamMatrix(a, b, th) {
        const d = new THREE.Vector3().subVectors(b, a);
        const len = d.length();
        q.setFromUnitVectors(Y, d.normalize());
        return new THREE.Matrix4().compose(
            new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
            q.clone(),
            new THREE.Vector3(th, len, th)
        );
    }

    // Torre de celosia: 4 montantes ahusados, anillos y cruces en cada tramo
    const TOP_Y = BASE_Y + 1.0 + 30, LEVELS = 12;
    const wb = 1.9, wt = 0.95, y0 = BASE_Y + 1.0;
    const corner = (w, y, sx, sz) => new THREE.Vector3(sx * w, y, sz * w);
    const lerpW = (l) => wb + (wt - wb) * (l / LEVELS);
    const lerpY = (l) => y0 + (TOP_Y - y0) * (l / LEVELS);
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const beams = [];
    corners.forEach(([sx, sz]) => beams.push(beamMatrix(corner(wb, y0, sx, sz), corner(wt, TOP_Y, sx, sz), 0.13)));
    for (let l = 0; l <= LEVELS; l++) {
        const w = lerpW(l), y = lerpY(l);
        for (let k = 0; k < 4; k++) {
            const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
            beams.push(beamMatrix(corner(w, y, ax, az), corner(w, y, bx, bz), 0.07));
        }
        if (l < LEVELS) {
            const w2 = lerpW(l + 1), y2 = lerpY(l + 1);
            for (let k = 0; k < 4; k++) {
                const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
                beams.push(beamMatrix(corner(w, y, ax, az), corner(w2, y2, bx, bz), 0.05));
                beams.push(beamMatrix(corner(w, y, bx, bz), corner(w2, y2, ax, az), 0.05));
            }
        }
    }
    const lattice = new THREE.InstancedMesh(unit, rustMat, beams.length);
    beams.forEach((m, i) => lattice.setMatrixAt(i, m));
    lattice.castShadow = true;
    scene.add(lattice);

    // Nucleo mas oscuro dentro de la celosia y punta piramidal (el obelisco
    // de las fotos se ve casi macizo de lejos y calado de cerca)
    const coreMat = std({ color: 0x5e2a18, roughness: 0.6, metalness: 0.5 });
    envMats.push(coreMat);
    const core = new THREE.Mesh(
        new THREE.CylinderGeometry(wt * 0.8 * 1.414, wb * 0.8 * 1.414, TOP_Y - y0, 4, 1),
        coreMat
    );
    core.rotation.y = Math.PI / 4;
    core.position.y = (TOP_Y + y0) / 2;
    shadowed(core, true, false);
    scene.add(core);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(wt * 1.414, 5, 4), rustMat);
    tip.rotation.y = Math.PI / 4;
    tip.position.y = TOP_Y + 2.5;
    shadowed(tip, true, false);
    scene.add(tip);
    // Plataforma que sostienen las figuras
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.45, 24), rustMat);
    platform.position.y = y0 + 11.6;
    shadowed(platform, true, false);
    scene.add(platform);

    // Figuras alargadas que se apoyan en la torre y alzan los brazos hacia ella
    function figure(side) {
        const s = side;
        const parts = [
            [[s * 1.55, y0, 0.0], [s * 1.35, y0 + 4.2, 0.0], 0.40],     // pierna
            [[s * 1.85, y0, 0.2], [s * 1.55, y0 + 4.0, 0.1], 0.36],     // otra pierna
            [[s * 1.35, y0 + 4.0, 0.0], [s * 1.05, y0 + 8.6, 0.0], 0.62], // torso
            [[s * 1.0, y0 + 8.0, 0.0], [s * 0.45, y0 + 11.2, 0.0], 0.20], // brazo hacia la torre
            [[s * 1.1, y0 + 7.4, 0.2], [s * 0.55, y0 + 10.2, 0.2], 0.18]
        ];
        parts.forEach(([a, b, th]) => {
            const mesh = new THREE.Mesh(unit, bronzeMat);
            const m = beamMatrix(new THREE.Vector3(...a), new THREE.Vector3(...b), th);
            m.decompose(mesh.position, mesh.quaternion, mesh.scale);
            shadowed(mesh, true, false);
            scene.add(mesh);
        });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), bronzeMat);
        head.position.set(s * 0.98, y0 + 9.3, 0);
        head.scale.set(0.9, 1.15, 0.9);
        shadowed(head, true, false);
        scene.add(head);
    }
    figure(1); figure(-1);

    // --- fachadas de vidrio ----------------------------------------------
    const facades = [];   // { mat, day, night }
    // opts: cols/rows de la textura. Con opts.world la textura se repite cada
    // N metros (los prismas extruidos llevan UV en metros); sin ella se
    // estira sobre UV 0..1 (cajas y cilindros).
    function glassMat(kind, seed, opts) {
        const cols = opts.cols || 8, rows = opts.rows || 8;
        const day = new THREE.CanvasTexture(facadeCanvas(kind, false, seed, cols, rows));
        const night = new THREE.CanvasTexture(facadeCanvas(kind, true, seed, cols, rows));
        [day, night].forEach((t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 4;
            if (opts.world) {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                t.repeat.set(1 / (cols * opts.world[0]), 1 / (rows * opts.world[1]));
            }
        });
        const mat = std({ map: day, roughness: 0.18, metalness: 0.6 });
        facades.push({ mat, day, night });
        envMats.push(mat);
        return mat;
    }

    // Prisma facetado: rectangulo con esquinas achaflanadas, extruido en altura
    function prismTower(x, z, w, d, h, rot, kind, seed) {
        const cx = 2.4, hw = w / 2, hd = d / 2;
        const shape = new THREE.Shape();
        shape.moveTo(-hw + cx, -hd);
        shape.lineTo(hw - cx, -hd);
        shape.lineTo(hw, -hd + cx);
        shape.lineTo(hw, hd - cx);
        shape.lineTo(hw - cx, hd);
        shape.lineTo(-hw + cx, hd);
        shape.lineTo(-hw, hd - cx);
        shape.lineTo(-hw, -hd + cx);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);     // la extrusion pasa a ser la altura
        const mesh = new THREE.Mesh(geo, glassMat(kind, seed, { cols: 9, rows: 8, world: [3.4, 3.6] }));
        mesh.position.set(x, 0, z);
        mesh.rotation.y = rot;
        shadowed(mesh, true, true);
        scene.add(mesh);
        // Coronacion: caja oscura retranqueada
        const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 3.2, d * 0.7), lampPoleMat);
        crown.position.set(x, h + 1.6, z);
        crown.rotation.y = rot;
        shadowed(crown, true, false);
        scene.add(crown);
        return mesh;
    }

    // Las dos torres: la izquierda, muy grande; la derecha, menor y mas clara
    prismTower(-19, -17, 17, 12, 66, 0.52, 'towerL', 101);
    prismTower(21, -20, 11.5, 9.5, 47, -0.34, 'towerR', 131);

    // Podio bajo con franjas que une ambas torres
    const podium = new THREE.Mesh(new THREE.BoxGeometry(40, 5, 12), podiumMat);
    podium.position.set(1, 2.5, -13);
    shadowed(podium, true, true);
    scene.add(podium);
    const podiumGlass = new THREE.Mesh(
        new THREE.BoxGeometry(40.2, 3.4, 12.2),
        glassMat('podium', 191, { cols: 16, rows: 3 })
    );
    podiumGlass.position.set(1, 2.2, -13);
    scene.add(podiumGlass);

    // Edificio de fachada curva azul con franjas luminosas (fondo derecho)
    const R = 19, ARC = 1.95, CH = 24;
    const curve = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, CH, 48, 1, true, -ARC / 2, ARC),
        glassMat('blue', 171, { cols: 8, rows: 7 })
    );
    curve.material.side = THREE.DoubleSide;
    curve.position.set(50, CH / 2, -30);
    curve.rotation.y = -0.4;
    shadowed(curve, true, true);
    scene.add(curve);
    for (let i = 0; i < 4; i++) {
        const band = new THREE.Mesh(
            new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.8, 48, 1, true, -ARC / 2, ARC),
            bandMat
        );
        band.position.set(50, 5 + i * 5.4, -30);
        band.rotation.y = -0.4;
        scene.add(band);
    }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.5, 48, 1, false, -ARC / 2, ARC), podiumMat);
    roof.position.set(50, CH, -30);
    roof.rotation.y = -0.4;
    scene.add(roof);

    // Autos en la rotonda (aparecen en las fotografias de referencia)
    const CAR_COLORS = [0xf2f2f2, 0xc9ced3, 0x2a2e33, 0xb3262b, 0xe2b53a, 0x2d5f9a, 0xf2f2f2, 0x8a8f94];
    const cars = [];
    for (let i = 0; i < 12; i++) {
        const inner = i % 2 === 0;
        cars.push({ rad: inner ? 20.8 : 24, a: (i / 12) * Math.PI * 2 + i, sp: (inner ? 1 : -1) * (0.11 + (i % 3) * 0.03) });
    }
    const carMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.7, 1.2, 3.8),
        std({ color: 0xffffff, roughness: 0.35, metalness: 0.5 }),
        cars.length
    );
    cars.forEach((c, i) => carMesh.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length])));
    carMesh.castShadow = true;
    scene.add(carMesh);
    const carLights = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.42, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
        cars.length * 2
    );
    cars.forEach((c, i) => {
        carLights.setColorAt(i * 2, new THREE.Color(0xfff0c0));
        carLights.setColorAt(i * 2 + 1, new THREE.Color(0xff2a2a));
    });
    scene.add(carLights);

    const dummy = new THREE.Object3D();
    function updateTraffic(dt) {
        cars.forEach((c, i) => {
            c.a += c.sp * dt;
            const x = Math.cos(c.a) * c.rad, z = Math.sin(c.a) * c.rad;
            const sg = Math.sign(c.sp);
            const hx = -Math.sin(c.a) * sg, hz = Math.cos(c.a) * sg;
            dummy.position.set(x, 0.65, z);
            dummy.rotation.set(0, Math.atan2(hx, hz), 0);
            dummy.updateMatrix();
            carMesh.setMatrixAt(i, dummy.matrix);
            m4.makeTranslation(x + hx * 1.95, 0.65, z + hz * 1.95);
            carLights.setMatrixAt(i * 2, m4);
            m4.makeTranslation(x - hx * 1.95, 0.65, z - hz * 1.95);
            carLights.setMatrixAt(i * 2 + 1, m4);
        });
        carMesh.instanceMatrix.needsUpdate = true;
        carLights.instanceMatrix.needsUpdate = true;
    }
    updateTraffic(0);

    // Estelas de luz de los autos (solo de noche)
    const trails = new THREE.Group();
    [[22, 2.4, 0xff2a2a, 0.3], [25, 1.9, 0xfff2c8, 2.6], [28, 2.0, 0xff3b30, 4.4], [20.5, 1.6, 0xfff2c8, 1.2]].forEach(([rad, arc, col, rot]) => {
        const tr = new THREE.Mesh(
            new THREE.TorusGeometry(rad, 0.09, 4, 90, arc),
            new THREE.MeshBasicMaterial({ color: col, toneMapped: false })
        );
        tr.rotation.x = Math.PI / 2;
        const holder = new THREE.Group();
        holder.rotation.y = rot;
        holder.position.y = 0.12;
        holder.add(tr);
        trails.add(holder);
    });
    scene.add(trails);

    // --- arboles ----------------------------------------------------------
    const trees = [[-17, 12], [17, 13], [-26, 4], [27, 5], [-10, 20], [11, 21], [34, 12], [-35, 14], [0, 26], [-22, 22], [24, 24]];
    trees.forEach(([x, z], i) => {
        const s = 1.2 + (i % 3) * 0.3;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.4 * s, 3.2 * s, 6), trunkMat);
        t.position.set(x, 1.6 * s, z);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 * s, 1), treeMat);
        crown.position.set(x, 4.6 * s, z);
        crown.scale.set(1, 0.85, 1);
        shadowed(t, true, false); shadowed(crown, true, false);
        scene.add(t, crown);
    });

    // --- farolas ----------------------------------------------------------
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const lx = Math.cos(a) * 17.2, lz = Math.sin(a) * 17.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), lampPoleMat);
        pole.position.set(lx, 3, lz);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lampHeadMat);
        head.position.set(lx, 6.2, lz);
        scene.add(pole, head);
    }

    // --- tema -------------------------------------------------------------
    let palette = PALETTES.light;
    function applyTheme() {
        const dark = document.documentElement.classList.contains('dark-mode');
        palette = dark ? PALETTES.dark : PALETTES.light;
        const sky = skyFor(dark);

        skyMat.map = sky.dome; skyMat.needsUpdate = true;
        scene.environment = sky.env;
        sunSprite.visible = !dark;
        moonSprite.visible = dark;

        renderer.toneMappingExposure = palette.exposure;
        hemi.color.setHex(palette.hemiSky); hemi.groundColor.setHex(palette.hemiGround); hemi.intensity = palette.hemiI;
        sun.color.setHex(palette.sun); sun.intensity = palette.sunI;
        scene.fog.color.setHex(palette.fog); scene.fog.near = palette.fogNear; scene.fog.far = palette.fogFar;

        groundMat.color.setHex(palette.ground);
        asphaltMat.color.setHex(palette.asphalt);
        sideMat.color.setHex(palette.side);
        podiumMat.color.setHex(palette.podium);
        treeMat.color.setHex(palette.tree);
        trunkMat.color.setHex(palette.trunk);
        bronzeMat.color.setHex(palette.bronze);
        rustMat.color.setHex(palette.rust);
        rustMat.emissive.setHex(dark ? 0xff2f5a : 0x000000);
        rustMat.emissiveIntensity = dark ? 0.85 : 0;
        coreMat.emissive.setHex(dark ? 0xff2f5a : 0x000000);
        coreMat.emissiveIntensity = dark ? 0.7 : 0;
        bandMat.emissiveIntensity = dark ? 1.4 : 0;
        trails.visible = dark;
        carLights.visible = dark;
        brickMat.map = dark ? brickNight : brickDay; brickMat.needsUpdate = true;

        facades.forEach((f) => {
            f.mat.map = dark ? f.night : f.day;
            f.mat.emissiveMap = dark ? f.night : null;
            f.mat.emissive.setHex(dark ? 0xffffff : 0x000000);
            f.mat.emissiveIntensity = dark ? 0.95 : 0;
            f.mat.needsUpdate = true;
        });
        envMats.forEach((m) => { m.envMapIntensity = palette.envI; });

        lampHeadMat.emissiveIntensity = palette.lamp;
        spot.intensity = palette.spot;
        pointL.intensity = palette.point;
        pointR.intensity = palette.point;
    }
    applyTheme();
    document.addEventListener('themechanged', applyTheme);

    // --- tamano -----------------------------------------------------------
    function resize() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // En escritorio la escena se corre a la derecha para dejar el texto
        // libre; la escultura queda a la derecha de la foto de perfil.
        if (w > 900) camera.setViewOffset(w, h, -w * 0.32, 0, w, h);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    // --- puntero ----------------------------------------------------------
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    addEventListener('pointermove', (e) => {
        pointer.x = (e.clientX / innerWidth) * 2 - 1;
        pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });

    // --- bucle -------------------------------------------------------------
    let running = false, raf = 0, last = 0, t = 0;

    function frame(now) {
        raf = requestAnimationFrame(frame);
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now; t += dt;

        pointer.sx += (pointer.x - pointer.sx) * 0.05;
        pointer.sy += (pointer.y - pointer.sy) * 0.05;

        // Vista elevada y abierta: muestra el conjunto completo (torres, podio,
        // edificio curvo y plaza) con un balanceo lento. El scroll baja la
        // camara hacia la plaza al salir del hero.
        const sp = Math.min(Math.max(scrollY / innerHeight, 0), 1);
        const a = Math.sin(t * 0.12) * 0.2 + pointer.sx * 0.1 + 0.16;
        const r = 94 - sp * 34;
        camera.position.set(Math.sin(a) * r, 30 - sp * 16 - pointer.sy * 2, Math.cos(a) * r);
        camera.lookAt(6, 17 - sp * 4, -10);

        updateTraffic(dt);
        renderer.render(scene, camera);
    }

    function start() {
        if (running) return;
        running = true; last = performance.now();
        raf = requestAnimationFrame(frame);
    }
    function stop() {
        running = false; cancelAnimationFrame(raf);
    }

    new IntersectionObserver((e) => (e[0].isIntersecting ? start() : stop()), { threshold: 0 }).observe(canvas);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop();
        else if (canvas.getBoundingClientRect().bottom > 0 &&
                 canvas.getBoundingClientRect().top < innerHeight) start();
    });

    // Ya hay 3D: el hero deja de necesitar su malla CSS y las particulas 2D
    document.documentElement.classList.add('has-hero3d');
    canvas.classList.add('is-ready');
}
