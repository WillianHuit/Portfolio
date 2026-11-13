// ===========================================================================
// Escenas Three.js del portafolio: diorama voxel del hero y vista previa de Sacbe
// ===========================================================================
// - Three.js (670 KB) se importa DESPUES del primer pintado y en tiempo ocioso,
//   asi no compite con el contenido que el visitante ya esta leyendo.
// - Sin WebGL, con "reducir movimiento" o en conexiones con ahorro de datos no
//   se carga nada: el hero conserva su malla CSS y las particulas 2D.
// - Cada escena se pausa cuando sale de pantalla o la pestana esta oculta.
// - El terreno entero es UN InstancedMesh (una draw call), igual que en el arcade.
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

if (!reduce && !saveData && hasWebGL()) {
    const heroCanvas = document.getElementById('hero3d');
    const previewCanvas = document.getElementById('sacbePreview');

    if (heroCanvas || previewCanvas) {
        whenIdle(async () => {
            try {
                const THREE = await import('../vendor/three.module.min.js');
                if (heroCanvas) createScene(THREE, heroCanvas, 'hero');
                if (previewCanvas) createScene(THREE, previewCanvas, 'preview');
            } catch (e) {
                // Si falla la carga, la pagina sigue funcionando sin 3D.
                console.warn('Escena 3D no disponible', e);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Paletas por tema
// ---------------------------------------------------------------------------
const PALETTES = {
    light: {
        grass: [0x8fc98a, 0x74b57c, 0x5fa072],
        rock: 0x9a9f95,
        peak: 0xe8e4dc,
        ember: 0xe8704f,
        road: 0x44504b,
        dash: 0xf4efe0,
        cloud: 0xfaf6ea,
        ambient: 0xffffff, ambientI: 0.85,
        sun: 0xfff2cf, sunI: 1.05,
        glow: 0
    },
    dark: {
        grass: [0x2f5a4f, 0x264a45, 0x1f3d3b],
        rock: 0x45504b,
        peak: 0x7d8a84,
        ember: 0xff6a3d,
        road: 0x1a2420,
        dash: 0x8f9aa6,
        cloud: 0x2c3d38,
        ambient: 0x8fa2ff, ambientI: 0.5,
        sun: 0x9db4ff, sunI: 0.55,
        glow: 2.2
    }
};

// ---------------------------------------------------------------------------
// Terreno: funcion de altura determinista con un volcan y un camino recto
// ---------------------------------------------------------------------------
const N = 49;                 // celdas por lado
const HALF = (N - 1) / 2;
const ROAD_HALF = 1.6;        // medio ancho del camino (3 carriles)

function heightAt(x, z) {
    if (Math.abs(x) < ROAD_HALF) return 0.15;
    let h = 1.1 * Math.sin(x * 0.33) * Math.cos(z * 0.29)
          + 0.6 * Math.sin(x * 0.9 + z * 0.55)
          + 1.4;
    const dx = x + 9, dz = z + 8;
    const d = Math.sqrt(dx * dx + dz * dz);
    h += Math.max(0, 9 - d * 0.95);                       // volcan
    const d2 = Math.hypot(x - 11, z + 4);
    h += Math.max(0, 4.5 - d2 * 0.8);                     // colina
    // Suaviza el borde del camino para que no sea un muro
    const edge = Math.min(1, (Math.abs(x) - ROAD_HALF) / 2.5);
    h *= edge;
    return Math.max(0.35, Math.round(h * 2) / 2);
}

// ---------------------------------------------------------------------------
function createScene(THREE, canvas, mode) {
    const isHero = mode === 'hero';
    const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'low-power'
    });
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(isHero ? 38 : 50, 1, 0.1, 200);

    const ambient = new THREE.AmbientLight(0xffffff, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(-12, 22, 14);
    const lava = new THREE.PointLight(0xff6a3d, 0, 26, 1.6);
    lava.position.set(-9, 11, -8);
    scene.add(ambient, sun, lava);

    // --- terreno --------------------------------------------------------
    const BOX = new THREE.BoxGeometry(1, 1, 1);
    const terrain = new THREE.InstancedMesh(
        BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), N * N
    );
    const cells = [];
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let gx = 0; gx < N; gx++) {
        for (let gz = 0; gz < N; gz++) {
            const x = gx - HALF, z = gz - HALF;
            const h = heightAt(x, z);
            cells.push({ x, z, h, r: ((gx * 73856093) ^ (gz * 19349663)) >>> 0 });
            m4.makeScale(1, h, 1).setPosition(x, h / 2 - 0.5, z);
            terrain.setMatrixAt(i++, m4);
        }
    }
    terrain.instanceMatrix.needsUpdate = true;
    scene.add(terrain);

    const tmp = new THREE.Color();
    function paintTerrain(p) {
        cells.forEach((c, idx) => {
            let col;
            if (Math.abs(c.x) < ROAD_HALF) {
                const dash = Math.abs(c.x) < 0.5 && ((c.z % 4) + 4) % 4 < 2;
                col = dash ? p.dash : p.road;
            } else if (c.h >= 8) col = p.peak;
            else if (c.h >= 6.5) col = p.ember;
            else if (c.h >= 4) col = p.rock;
            else col = p.grass[c.r % 3];
            tmp.setHex(col);
            if (c.h < 6.5 && Math.abs(c.x) >= ROAD_HALF) tmp.offsetHSL(0, 0, ((c.r % 7) - 3) * 0.006);
            terrain.setColorAt(idx, tmp);
        });
        terrain.instanceColor.needsUpdate = true;
    }

    // --- nubes ----------------------------------------------------------
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    const clouds = new THREE.Group();
    for (let k = 0; k < 7; k++) {
        const c = new THREE.Mesh(BOX, cloudMat);
        c.scale.set(3 + (k % 3) * 1.6, 0.8, 1.6 + (k % 2));
        c.position.set(-26 + k * 8.5, 15 + (k % 3) * 1.5, -12 + ((k * 7) % 5) * 5);
        clouds.add(c);
    }
    scene.add(clouds);

    // --- estrellas (solo noche) ----------------------------------------
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(180 * 3);
    for (let s = 0; s < 180; s++) {
        const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 25;
        starPos[s * 3] = Math.cos(a) * r;
        starPos[s * 3 + 1] = 12 + Math.random() * 30;
        starPos[s * 3 + 2] = Math.sin(a) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true }));
    scene.add(stars);

    // --- corredor: obstaculos que se acercan al corredor ---------------
    const runner = new THREE.Group();
    const body = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xd97706 }));
    body.scale.set(0.9, 1.1, 0.6); body.position.y = 1.0;
    const head = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xf2c8a0 }));
    head.scale.set(0.6, 0.6, 0.6); head.position.y = 1.9;
    runner.add(body, head);
    runner.position.set(0, 0, 8);
    scene.add(runner);

    const obsMat = new THREE.MeshLambertMaterial({ color: 0x1b2b26 });
    const coinMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const props = [];
    for (let k = 0; k < 6; k++) {
        const isCoin = k % 2 === 1;
        const mesh = new THREE.Mesh(BOX, isCoin ? coinMat : obsMat);
        mesh.scale.set(isCoin ? 0.5 : 1.1, isCoin ? 0.5 : 1.2, isCoin ? 0.5 : 1.1);
        props.push({ mesh, lane: (k % 3) - 1, z: -20 + k * 6, coin: isCoin });
        scene.add(mesh);
    }

    // --- tema -------------------------------------------------------------
    let palette;
    function applyTheme() {
        const dark = document.documentElement.classList.contains('dark-mode');
        palette = dark ? PALETTES.dark : PALETTES.light;
        paintTerrain(palette);
        ambient.color.setHex(palette.ambient); ambient.intensity = palette.ambientI;
        sun.color.setHex(palette.sun); sun.intensity = palette.sunI;
        lava.intensity = palette.glow;
        cloudMat.color.setHex(palette.cloud);
        stars.visible = dark;
    }
    applyTheme();
    document.addEventListener('themechanged', applyTheme);

    // --- tamano -----------------------------------------------------------
    let w = 1, h = 1;
    function resize() {
        w = canvas.clientWidth; h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isHero ? 1.5 : 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // En escritorio el diorama se corre a la derecha para dejar el texto libre
        if (isHero && w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    // --- puntero ----------------------------------------------------------
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    if (isHero) {
        addEventListener('pointermove', (e) => {
            pointer.x = (e.clientX / innerWidth) * 2 - 1;
            pointer.y = (e.clientY / innerHeight) * 2 - 1;
        }, { passive: true });
    }

    // --- bucle -------------------------------------------------------------
    let running = false, raf = 0, last = 0, t = 0;

    function frame(now) {
        raf = requestAnimationFrame(frame);
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now; t += dt;

        pointer.sx += (pointer.x - pointer.sx) * 0.05;
        pointer.sy += (pointer.y - pointer.sy) * 0.05;

        if (isHero) {
            // El scroll acerca y baja la camara hacia el camino: al salir del
            // hero parece que el visitante entra en el paisaje.
            const sp = Math.min(Math.max(scrollY / innerHeight, 0), 1);
            const a = 0.75 + t * 0.045 + pointer.sx * 0.35 - sp * 0.5;
            const r = 36 - sp * 12;
            camera.position.set(Math.sin(a) * r, 19 - sp * 11 - pointer.sy * 3, Math.cos(a) * r);
            camera.lookAt(0, 3 - sp * 1.5, 0);
        } else {
            camera.position.set(Math.sin(t * 0.5) * 0.9, 4.2, 15);
            camera.lookAt(0, 1.6, -4);
        }

        clouds.children.forEach((c, k) => {
            c.position.x += dt * (0.5 + k * 0.05);
            if (c.position.x > 34) c.position.x = -34;
        });
        lava.intensity = palette.glow * (0.8 + 0.2 * Math.sin(t * 3));

        const speed = 9;
        props.forEach((p) => {
            p.z += dt * speed;
            if (p.z > 14) { p.z = -34; p.lane = ((Math.random() * 3) | 0) - 1; }
            p.mesh.position.set(p.lane * 1.05, p.coin ? 1.4 + Math.sin(t * 5 + p.z) * 0.2 : 0.7, p.z);
            if (p.coin) p.mesh.rotation.y = t * 3;
        });
        runner.position.x += (Math.sin(t * 0.9) * 1.05 - runner.position.x) * 0.1;
        runner.position.y = Math.abs(Math.sin(t * 9)) * 0.18;

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
    if (isHero) document.documentElement.classList.add('has-hero3d');
    canvas.classList.add('is-ready');
}
