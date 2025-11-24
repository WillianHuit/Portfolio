// ===========================
// Variables Globales
// ===========================
let currentTheme = localStorage.getItem('theme') || 'light';
let isMenuOpen = false;

// ===========================
// Inicialización
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initParticles();
    initAnimations();
    initContactForm();
    updateYear();
});

// ===========================
// Loading Screen
// ===========================
window.addEventListener('load', () => {
    const loadingScreen = document.getElementById('loading-screen');
    
    // Esperar un mínimo de tiempo para mostrar la animación
    setTimeout(() => {
        loadingScreen.classList.add('hidden');
        
        // Remover del DOM después de la transición
        setTimeout(() => {
            loadingScreen.remove();
        }, 500);
    }, 1500); // Mínimo 1.5 segundos de loading
});

// ===========================
// Sistema de Tema (Dark Mode)
// ===========================
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    
    // Aplicar tema guardado
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }
    
    // Event listener para cambiar tema
    themeToggle.addEventListener('click', toggleTheme);
}

function toggleTheme() {
    const themeToggle = document.getElementById('themeToggle');
    
    if (currentTheme === 'light') {
        currentTheme = 'dark';
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    } else {
        currentTheme = 'light';
        document.body.classList.remove('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    }
    
    localStorage.setItem('theme', currentTheme);
}

// ===========================
// Navegación
// ===========================
function initNavigation() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('.nav-link');
    
    // Scroll effect para navbar
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
        
        // Active link al hacer scroll
        updateActiveLink();
    });
    
    // Menú hamburguesa
    hamburger.addEventListener('click', toggleMenu);
    
    // Cerrar menú al hacer click en un link
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (isMenuOpen) {
                toggleMenu();
            }
        });
    });
    
    // Smooth scroll para los links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                const offsetTop = targetSection.offsetTop - 70;
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

function toggleMenu() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    
    isMenuOpen = !isMenuOpen;
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
}

function updateActiveLink() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let currentSection = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop - 100;
        const sectionHeight = section.offsetHeight;
        
        if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
            currentSection = section.getAttribute('id');
        }
    });
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSection}`) {
            link.classList.add('active');
        }
    });
}

// ===========================
// Sistema de Partículas
// ===========================
function initParticles() {
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const particleCount = 50;
    
    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 3 + 1;
            this.speedX = Math.random() * 2 - 1;
            this.speedY = Math.random() * 2 - 1;
        }
        
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            
            if (this.x > canvas.width || this.x < 0) this.speedX *= -1;
            if (this.y > canvas.height || this.y < 0) this.speedY *= -1;
        }
        
        draw() {
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--primary-color');
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    function init() {
        particles.length = 0;
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach(particle => {
            particle.update();
            particle.draw();
        });
        
        connectParticles();
        requestAnimationFrame(animate);
    }
    
    function connectParticles() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 150) {
                    ctx.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--primary-color');
                    ctx.lineWidth = 0.2;
                    ctx.globalAlpha = 1 - distance / 150;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
        }
    }
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        init();
    });
    
    init();
    animate();
}

// ===========================
// Animaciones al Scroll
// ===========================
function initAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Animar barras de progreso
                if (entry.target.classList.contains('skill-progress')) {
                    const progress = entry.target.getAttribute('data-progress');
                    entry.target.style.setProperty('--progress-width', progress + '%');
                    entry.target.classList.add('animated');
                }
                
                // Fade in para secciones
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observar elementos
    document.querySelectorAll('.skill-progress').forEach(el => {
        observer.observe(el);
    });
    
    document.querySelectorAll('.section').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(el);
    });
}

// ===========================
// Formulario de Contacto
// ===========================
function initContactForm() {
    const form = document.getElementById('contactForm');
    
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const formData = {
                name: form.name.value,
                email: form.email.value,
                subject: form.subject.value,
                message: form.message.value
            };
            
            // Aquí puedes agregar la lógica para enviar el formulario
            // Por ahora, mostraremos un mensaje de éxito
            
            const mailtoLink = `mailto:willian.huit.soporte@gmail.com?subject=${encodeURIComponent(formData.subject)}&body=${encodeURIComponent(`Nombre: ${formData.name}\nEmail: ${formData.email}\n\n${formData.message}`)}`;
            
            window.location.href = mailtoLink;
            
            // Opcional: Limpiar formulario
            form.reset();
        });
    }
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