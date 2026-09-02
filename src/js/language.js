// Sistema de internacionalización (i18n)
class LanguageManager {
    constructor() {
        this.currentLanguage = this.getStoredLanguage() || 'es';
    }
    
    init() {
        // Cargar el idioma almacenado
        this.updateContent();
        this.updateHtmlLang();
        this.updateLanguageButton();
        
        // Configurar el botón de cambio de idioma
        this.setupLanguageToggle();

        document.dispatchEvent(new CustomEvent('languagechanged', {
            detail: { lang: this.currentLanguage }
        }));
    }
    
    getStoredLanguage() {
        try {
            const stored = localStorage.getItem('language');
            if (stored) return stored;
        } catch (e) {}
        // Misma deteccion que el script anti-FOUC del <head>
        const nav = (navigator.language || 'es').toLowerCase();
        return nav.indexOf('en') === 0 ? 'en' : 'es';
    }
    
    setStoredLanguage(lang) {
        try {
            localStorage.setItem('language', lang);
        } catch (e) {}
    }
    
    loadLanguage(lang) {
        this.currentLanguage = lang;
        this.setStoredLanguage(lang);
        this.updateContent();
        this.updateHtmlLang();
        this.updateLanguageButton();
        document.dispatchEvent(new CustomEvent('languagechanged', { detail: { lang } }));
    }
    
    updateContent() {
        const elements = document.querySelectorAll('[data-i18n]');
        
        elements.forEach(element => {
            // Los nodos con data-i18n-manual los controla otro modulo (typing del hero)
            if (element.hasAttribute('data-i18n-manual')) return;

            const key = element.getAttribute('data-i18n');
            const translation = this.getTranslation(key);

            if (typeof translation === 'string') {
                element.textContent = translation;
            }
        });

        // Las etiquetas para lectores de pantalla tambien se traducen
        document.querySelectorAll('[data-i18n-aria]').forEach(element => {
            const label = this.getTranslation(element.getAttribute('data-i18n-aria'));
            if (typeof label === 'string') {
                element.setAttribute('aria-label', label);
            }
        });
    }
    
    getTranslation(key) {
        const keys = key.split('.');
        let translation = translations[this.currentLanguage];
        
        for (const k of keys) {
            if (translation && translation[k]) {
                translation = translation[k];
            } else {
                return null;
            }
        }
        
        return translation;
    }
    
    updateHtmlLang() {
        document.documentElement.setAttribute('lang', this.currentLanguage);
    }
    
    toggleLanguage() {
        const newLang = this.currentLanguage === 'es' ? 'en' : 'es';
        this.loadLanguage(newLang);
    }
    
    setupLanguageToggle() {
        const toggleBtn = document.getElementById('langToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleLanguage());
        } else {
            console.error('Language toggle button not found!');
        }
    }
    
    updateLanguageButton() {
        const toggleBtn = document.getElementById('langToggle');
        const langText = toggleBtn?.querySelector('.lang-text');
        
        if (langText) {
            langText.textContent = this.currentLanguage === 'es' ? 'EN' : 'ES';
        }
        
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-label',
                this.currentLanguage === 'es' ? 'Switch to English' : 'Cambiar a Español'
            );
            // Ya tiene su etiqueta definitiva: que updateContent no la sobrescriba
            toggleBtn.removeAttribute('data-i18n-aria');
        }
    }
}

// Inicializar el sistema de idiomas cuando el DOM esté listo
let languageManager;

document.addEventListener('DOMContentLoaded', () => {
    languageManager = new LanguageManager();
    window.languageManager = languageManager;
    languageManager.init();
});
