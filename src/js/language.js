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
    }
    
    getStoredLanguage() {
        return localStorage.getItem('language') || 'es';
    }
    
    setStoredLanguage(lang) {
        localStorage.setItem('language', lang);
    }
    
    loadLanguage(lang) {
        this.currentLanguage = lang;
        this.setStoredLanguage(lang);
        this.updateContent();
        this.updateHtmlLang();
        this.updateLanguageButton();
    }
    
    updateContent() {
        const elements = document.querySelectorAll('[data-i18n]');
        
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.getTranslation(key);
            
            if (translation) {
                element.textContent = translation;
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
                console.warn(`Translation not found for key: ${key}`);
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
        }
    }
}

// Inicializar el sistema de idiomas cuando el DOM esté listo
let languageManager;

document.addEventListener('DOMContentLoaded', () => {
    languageManager = new LanguageManager();
    languageManager.init();
});
