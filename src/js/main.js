// ===========================
// Utilidades compartidas
// ===========================
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let prefersReducedMotion = reduceMotionQuery.matches;

reduceMotionQuery.addEventListener('change', (e) => {
    prefersReducedMotion = e.matches;
});

// Lee una variable CSS una sola vez; volver a leerla en cada frame
// fuerza un recalculo de estilos y era el mayor coste de la pagina.
function readCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function onIntersect(elements, callback, options = {}) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                callback(entry.target);
                observer.unobserve(entry.target); // una sola vez
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px', ...options });

    elements.forEach((el) => observer.observe(el));
    return observer;
}

// ===========================
// Pantalla de carga
// ===========================
// Antes esperaba a window.load, que a su vez esperaba al iframe de Google
// Forms y a ~4 MB de imagenes: la pantalla podia quedarse varios segundos.
// Ahora se oculta en cuanto el DOM esta listo, con un minimo para que no
// parpadee y un tope duro para que nunca se quede colgada.
const LOADER_MIN_MS = 450;
const LOADER_MAX_MS = 2000;
const loaderStart = performance.now();
let loaderDone = false;

function hideLoader() {
    if (loaderDone) return;
    loaderDone = true;

    const screen = document.getElementById('loading-screen');
    if (!screen) return;

    const wait = Math.max(0, LOADER_MIN_MS - (performance.now() - loaderStart));

    setTimeout(() => {
        screen.classList.add('hidden');
        document.body.classList.remove('is-loading');
        setTimeout(() => screen.remove(), 600);
    }, wait);
}

document.body.classList.add('is-loading');

// Se dispara con lo que ocurra primero; el timeout es la red de seguridad.
document.addEventListener('DOMContentLoaded', () => setTimeout(hideLoader, 150));
window.addEventListener('load', hideLoader);
setTimeout(hideLoader, LOADER_MAX_MS);

// ===========================
// Inicialización
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initScrollEffects();
    initParticles();
    initReveals();
    initCounters();
    initSkillBars();
    initTyping();
    initProjectTilt();
    updateYear();
});

// ===========================
// Sistema de Tema (Dark Mode)
// ===========================
// La clase ya la aplica el script anti-FOUC del <head>; aqui solo se lee
// el estado real del DOM para no reintroducir un parpadeo.
let currentTheme = document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light';

function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;

    syncThemeIcon(themeToggle);
    themeToggle.addEventListener('click', (e) => toggleTheme(e, themeToggle));
}

function syncThemeIcon(btn) {
    btn.innerHTML = currentTheme === 'dark'
        ? '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-sun"></use></svg>'
        : '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-moon"></use></svg>';
}

function applyTheme(btn) {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark-mode', currentTheme === 'dark');
    syncThemeIcon(btn);

    try {
        localStorage.setItem('theme', currentTheme);
    } catch (e) {}

    // El canvas cachea el color: hay que invalidarlo al cambiar de tema.
    document.dispatchEvent(new CustomEvent('themechanged', { detail: { theme: currentTheme } }));
}

function toggleTheme(event, btn) {
    // Revelacion circular desde el boton (View Transitions API).
    // Si el navegador no la soporta o el usuario pidio menos movimiento,
    // se cambia el tema directamente.
    if (!document.startViewTransition || prefersReducedMotion) {
        applyTheme(btn);
        return;
    }

    const x = event.clientX;
    const y = event.clientY;
    const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );

    // Al pasar a claro se invierte la animacion: el circulo se cierra.
    const goingDark = currentTheme === 'light';
    document.documentElement.classList.toggle('theme-transition-active', !goingDark);

    const transition = document.startViewTransition(() => applyTheme(btn));

    transition.ready.then(() => {
        const clip = [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`
        ];

        document.documentElement.animate(
            { clipPath: goingDark ? clip : [...clip].reverse() },
            {
                duration: 550,
                easing: 'ease-in-out',
                pseudoElement: goingDark
                    ? '::view-transition-new(root)'
                    : '::view-transition-old(root)'
            }
        );
    });

    transition.finished.then(() => {
        document.documentElement.classList.remove('theme-transition-active');
    });
}

// ===========================
// Navegación
// ===========================
let isMenuOpen = false;

function initNavigation() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.querySelectorAll('.nav-link');

    if (hamburger) {
        hamburger.addEventListener('click', toggleMenu);
    }

    // Smooth scroll + cierre del menu movil
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href');
            if (targetId === '#') return;

            const target = document.querySelector(targetId);
            if (!target) return;

            e.preventDefault();
            if (isMenuOpen) toggleMenu();

            window.scrollTo({
                top: target.offsetTop - 70,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
        });
    });

    // Enlace activo por IntersectionObserver en vez de recalcular
    // offsetTop/offsetHeight de cada seccion en cada evento de scroll.
    const sections = document.querySelectorAll('section[id], header[id]');

    const spy = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const id = entry.target.getAttribute('id');
            navLinks.forEach((link) => {
                link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
            });
        });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach((section) => spy.observe(section));
}

function toggleMenu() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');

    isMenuOpen = !isMenuOpen;
    hamburger.classList.toggle('active', isMenuOpen);
    navMenu.classList.toggle('active', isMenuOpen);
    hamburger.setAttribute('aria-expanded', String(isMenuOpen));
}

// ===========================
// Efectos de scroll (navbar, barra de progreso, volver arriba)
// ===========================
// Un unico listener pasivo, agrupado en un requestAnimationFrame, para
// no provocar layout thrashing en cada pixel de scroll.
function initScrollEffects() {
    const navbar = document.getElementById('navbar');
    const progress = document.getElementById('scrollProgress');
    const backToTop = document.getElementById('backToTop');
    const ring = document.querySelector('.btt-ring-fg');
    const RING_LENGTH = 126;

    let ticking = false;

    function update() {
        ticking = false;

        const scrolled = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(scrolled / max, 1) : 0;

        if (navbar) navbar.classList.toggle('scrolled', scrolled > 50);
        if (progress) progress.style.transform = `scaleX(${ratio})`;

        if (backToTop) {
            backToTop.classList.toggle('visible', scrolled > 400);
            if (ring) {
                ring.style.strokeDashoffset = String(RING_LENGTH * (1 - ratio));
            }
        }
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    }, { passive: true });

    window.addEventListener('resize', update, { passive: true });

    if (backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        });
    }

    update();
}

// ===========================
// Sistema de Partículas
// ===========================
function initParticles() {
    const canvas = document.getElementById('particles');
    if (!canvas || prefersReducedMotion) {
        if (canvas) canvas.style.display = 'none';
        return;
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    const particles = [];
    const mouse = { x: -9999, y: -9999 };

    // Color cacheado: antes se leia con getComputedStyle dentro del bucle
    // de dibujo, ~1200 lecturas forzadas de estilo por frame.
    let particleColor = readCssVar('--primary-color') || '#6366f1';
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = null;
    let running = false;

    document.addEventListener('themechanged', () => {
        particleColor = readCssVar('--primary-color') || '#6366f1';
    });

    function particleCount() {
        // Menos particulas en pantallas pequenas: el coste es cuadratico
        // por las lineas de conexion.
        if (width < 600) return 22;
        if (width < 1024) return 36;
        return 55;
    }

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.size = Math.random() * 2.5 + 1;
            this.speedX = Math.random() * 1.2 - 0.6;
            this.speedY = Math.random() * 1.2 - 0.6;
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            if (this.x > width || this.x < 0) this.speedX *= -1;
            if (this.y > height || this.y < 0) this.speedY *= -1;

            // Repulsion suave alrededor del cursor
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < 14400 && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const force = (120 - dist) / 120;
                this.x += (dx / dist) * force * 4;
                this.y += (dy / dist) * force * 4;
            }
        }
    }

    function build() {
        particles.length = 0;
        const count = particleCount();
        for (let i = 0; i < count; i++) {
            particles.push(new Particle());
        }
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        build();
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = particleColor;
        ctx.strokeStyle = particleColor;
        ctx.lineWidth = 0.6;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.update();

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();

            for (let j = i + 1; j < particles.length; j++) {
                const q = particles[j];
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < 22500) {
                    ctx.globalAlpha = 1 - Math.sqrt(distSq) / 150;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
        }

        rafId = requestAnimationFrame(draw);
    }

    function start() {
        if (running) return;
        running = true;
        rafId = requestAnimationFrame(draw);
    }

    function stop() {
        if (!running) return;
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    }

    // Solo se anima mientras el hero esta a la vista y la pestana activa.
    const hero = document.querySelector('.hero');
    if (hero) {
        new IntersectionObserver((entries) => {
            entries[0].isIntersecting ? start() : stop();
        }, { threshold: 0 }).observe(hero);
    } else {
        start();
    }

    document.addEventListener('visibilitychange', () => {
        document.hidden ? stop() : start();
    });

    window.addEventListener('pointermove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    }, { passive: true });

    window.addEventListener('pointerleave', () => {
        mouse.x = -9999;
        mouse.y = -9999;
    }, { passive: true });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 200);
    }, { passive: true });

    resize();
}

// ===========================
// Reveals al hacer scroll
// ===========================
function initReveals() {
    // Las secciones se marcan desde JS para que, sin JS, sigan visibles.
    const sections = document.querySelectorAll('.section');
    sections.forEach((el) => el.classList.add('reveal'));
    onIntersect(sections, (el) => el.classList.add('is-visible'));

    // Stagger de tarjetas
    const groups = [
        '.stat-card', '.skill-category', '.strength-card',
        '.project-card', '.certification-card', '.education-card',
        '.contact-card', '.timeline-item'
    ];

    groups.forEach((selector) => {
        const items = document.querySelectorAll(selector);
        items.forEach((el, i) => {
            el.classList.add('stagger-item');
            el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
        });
        onIntersect(items, (el) => el.classList.add('is-visible'));
    });

    initTitleReveal();
}

// Titulos de seccion letra por letra
function initTitleReveal() {
    const titles = document.querySelectorAll('.section-title');

    titles.forEach((title) => {
        // Se guarda el texto original para poder rehacerlo al cambiar de idioma
        splitTitle(title);
    });

    onIntersect(titles, (el) => el.classList.add('is-visible'));

    // Al traducir, language.js reescribe el textContent y borra los <span>.
    document.addEventListener('languagechanged', () => {
        requestAnimationFrame(() => {
            titles.forEach((title) => {
                splitTitle(title);
                title.classList.add('is-visible');
            });
        });
    });
}

function splitTitle(title) {
    const text = title.textContent.trim();
    if (!text || title.dataset.split === text) return;

    title.dataset.split = text;
    title.setAttribute('aria-label', text);

    const frag = document.createDocumentFragment();
    [...text].forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'char';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = ch === ' ' ? ' ' : ch;
        span.style.transitionDelay = `${i * 28}ms`;
        frag.appendChild(span);
    });

    title.textContent = '';
    title.appendChild(frag);
}

// ===========================
// Contadores animados
// ===========================
function initCounters() {
    const counters = document.querySelectorAll('.stat-number');

    onIntersect(counters, (el) => {
        const target = parseInt(el.dataset.count, 10) || 0;
        const suffix = el.dataset.suffix || '';

        if (prefersReducedMotion) {
            el.textContent = target + suffix;
            return;
        }

        const duration = 1400;
        const start = performance.now();

        function step(now) {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            el.textContent = Math.round(target * eased) + suffix;
            if (t < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    });
}

// ===========================
// Barras de habilidades + porcentaje
// ===========================
function initSkillBars() {
    const bars = document.querySelectorAll('.skill-progress');

    bars.forEach((bar) => {
        const info = bar.closest('.skill-info');
        if (!info || info.querySelector('.skill-percent')) return;

        const label = document.createElement('span');
        label.className = 'skill-percent';
        label.textContent = '0%';
        info.querySelector('h4').appendChild(label);
    });

    onIntersect(bars, (bar) => {
        const value = parseInt(bar.dataset.progress, 10) || 0;
        bar.style.setProperty('--progress-width', value + '%');
        bar.classList.add('animated');

        const label = bar.closest('.skill-info')?.querySelector('.skill-percent');
        if (!label) return;

        if (prefersReducedMotion) {
            label.textContent = value + '%';
            return;
        }

        const duration = 1000;
        const start = performance.now();

        function step(now) {
            const t = Math.min((now - start) / duration, 1);
            label.textContent = Math.round(value * (1 - Math.pow(1 - t, 3))) + '%';
            if (t < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    });
}

// ===========================
// Typing rotativo del hero
// ===========================
function initTyping() {
    const el = document.getElementById('typingText');
    if (!el) return;

    let timer = null;

    function currentRoles() {
        const lang = (window.languageManager && window.languageManager.currentLanguage)
            || document.documentElement.getAttribute('lang')
            || 'es';
        const pack = (window.translations && window.translations[lang]) || {};
        return (pack.hero && pack.hero.roles) || [el.textContent.trim()];
    }

    function run() {
        clearTimeout(timer);

        const roles = currentRoles();

        if (prefersReducedMotion) {
            el.textContent = roles[0];
            return;
        }

        // Arranca con el primer rol ya escrito: si empezara en vacio, el hueco
        // del titulo se veria sin texto durante el primer segundo de carga.
        let index = 0;
        let chars = roles[0].length;
        let deleting = true;
        el.textContent = roles[0];

        function tick() {
            const word = roles[index % roles.length];
            chars += deleting ? -1 : 1;
            el.textContent = word.slice(0, Math.max(chars, 0));

            let delay = deleting ? 45 : 95;

            if (!deleting && chars >= word.length) {
                delay = 1800;          // pausa con la palabra completa
                deleting = true;
            } else if (deleting && chars <= 0) {
                deleting = false;
                index++;
                delay = 350;
            }

            timer = setTimeout(tick, delay);
        }

        timer = setTimeout(tick, 2200);   // deja leer el primer rol
    }

    document.addEventListener('languagechanged', run);
    reduceMotionQuery.addEventListener('change', run);
    run();
}

// ===========================
// Tilt 3D + spotlight en tarjetas de proyecto
// ===========================
function initProjectTilt() {
    // Solo con puntero fino (raton): en tactil no aporta y estorba.
    if (prefersReducedMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        return;
    }

    const MAX_TILT = 7; // grados

    document.querySelectorAll('.project-card').forEach((card) => {
        card.classList.add('tilting');
        let frame = null;

        card.addEventListener('pointermove', (e) => {
            if (frame) return;

            frame = requestAnimationFrame(() => {
                frame = null;
                const rect = card.getBoundingClientRect();
                const px = (e.clientX - rect.left) / rect.width;
                const py = (e.clientY - rect.top) / rect.height;

                card.style.setProperty('--mx', `${px * 100}%`);
                card.style.setProperty('--my', `${py * 100}%`);
                card.style.transform =
                    `perspective(1000px) rotateX(${(0.5 - py) * MAX_TILT * 2}deg) ` +
                    `rotateY(${(px - 0.5) * MAX_TILT * 2}deg) translateY(-8px) scale(1.02)`;
            });
        }, { passive: true });

        card.addEventListener('pointerleave', () => {
            if (frame) {
                cancelAnimationFrame(frame);
                frame = null;
            }
            card.style.transform = '';
        });
    });
}

// ===========================
// Actualizar Año en Footer
// ===========================
function updateYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}
