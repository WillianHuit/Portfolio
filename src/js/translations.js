// Sistema de traducciones para el portfolio
const translations = {
    es: {
        // Navegación
        nav: {
            home: "Inicio",
            about: "Sobre Mí",
            experience: "Experiencia",
            skills: "Habilidades",
            projects: "Proyectos",
            contact: "Contacto"
        },
        
        // Hero
        hero: {
            greeting: "Hola, soy",
            role: "Programador Principiante",
            description: "Especializado en desarrollo web, COBOL y análisis de sistemas. Apasionado por crear soluciones tecnológicas innovadoras.",
            contact: "Contáctame",
            projects: "Ver Proyectos"
        },
        
        // About
        about: {
            title: "Perfil Profesional",
            description: "Programador en formación y coordinador de proyectos con experiencia en desarrollo web, análisis lógico, documentación técnica y mejora de procesos. He liderado actividades y equipos en proyectos culturales y educativos, gestionando plataformas, formularios, bases de datos y experiencia de usuario.",
            stat1: "Años Programando",
            stat2: "Proyectos Completados",
            stat3: "Equipos Liderados"
        },
        
        // Experience
        experience: {
            title: "Experiencia",
            current: "Actual",
            job1: {
                title: "Programador Principiante",
                task1: "Diseño y desarrollo de aplicaciones en COBOL para procesamiento batch y sistemas en línea",
                task2: "Análisis de historias de usuarios para implementación",
                task3: "Desarrollo de herramientas y automatizaciones para IBM zSeries"
            },
            job2: {
                title: "Coordinador de Actividades",
                task1: "Organización de eventos masivos con más de 500 participantes",
                task2: "Liderazgo y capacitación de equipos de voluntarios",
                task3: "Creación de plataformas web, formularios y documentación técnica",
                task4: "Automatizaciones con Google Apps Script y manejo de bases de datos"
            }
        },
        
        // Skills
        skills: {
            title: "Habilidades Técnicas",
            languages: "Lenguajes de Programación",
            web: "Desarrollo Web",
            database: "Bases de Datos",
            tools: "Herramientas",
            strengths: "Fortalezas Personales",
            intermediate: "Intermedio",
            basic: "Básico",
            advanced: "Avanzado",
            strength1: "Organización y liderazgo",
            strength2: "Comunicación clara",
            strength3: "Trabajo en equipo",
            strength4: "Aprendizaje rápido",
            strength5: "Proactividad",
            strength6: "Creatividad técnica"
        },
        
        // Projects
        projects: {
            title: "Proyectos Relevantes",
            project1: {
                title: "Compilador IBM zSeries",
                description: "Compilador integrado con IDE de IBM Developer for zSeries para realizar compilaciones masivas de forma eficiente y automatizada."
            },
            project2: {
                title: "Aplicativo zSeries Testing",
                description: "Aplicativo para apoyo de lectura de data y pruebas varias con zSeries, facilitando el testing y validación de sistemas mainframe."
            },
            project3: {
                title: "Calculadora VSAM",
                description: "Calculadora para generación de archivos VSAM e índices alternos, optimizando la gestión de almacenamiento en sistemas mainframe."
            },
            project4: {
                title: "Sistemas IYF Guatemala",
                description: "Desarrollo de sistemas completos incluyendo formularios web, automatizaciones, bases de datos y documentación técnica para organización sin fines de lucro."
            },
            project5: {
                title: "Portfolio Personal",
                description: "Portfolio profesional desarrollado con HTML, CSS y JavaScript, implementando sistema de internacionalización y modo oscuro."
            },
            project6: {
                title: "Co-munity",
                description: "Plataforma web en desarrollo para gestión comunitaria y colaboración social, facilitando la comunicación y organización de comunidades."
            },
            project7: {
                title: "Plataforma de Ajedrez Maya",
                description: "Plataforma interactiva para aprender y jugar ajedrez con temática histórica de Mayas vs Españoles, ofreciendo una experiencia educativa única sobre la cultura maya."
            }
        },
        
        // Education
        education: {
            title: "Educación",
            degree: "Ingeniería",
            institution: "Estudiante Universitario",
            current: "Actual",
            courses: "Cursos y Certificaciones",
            course1: "Desarrollo Web",
            course2: "Lógica de Programación",
            course3: "Google Apps Script",
            course4: "Gestión Básica de Proyectos"
        },
        
        // Contact
        contact: {
            title: "Contáctame",
            description: "¿Tienes un proyecto en mente? ¡Hablemos! Estoy disponible para colaboraciones y nuevas oportunidades.",
            email: "Email",
            form: {
                name: "Nombre",
                email: "Email",
                subject: "Asunto",
                message: "Mensaje",
                send: "Enviar Mensaje"
            }
        },
        
        // Footer
        footer: {
            tagline: "Desarrollando soluciones, creando futuro",
            rights: "Todos los derechos reservados."
        }
    },
    en: {
        // Navigation
        nav: {
            home: "Home",
            about: "About Me",
            experience: "Experience",
            skills: "Skills",
            projects: "Projects",
            contact: "Contact"
        },
        
        // Hero
        hero: {
            greeting: "Hi, I'm",
            role: "Junior Programmer",
            description: "Specialized in web development, COBOL and systems analysis. Passionate about creating innovative technological solutions.",
            contact: "Contact Me",
            projects: "View Projects"
        },
        
        // About
        about: {
            title: "Professional Profile",
            description: "Programmer in training and project coordinator with experience in web development, logical analysis, technical documentation, and process improvement. I have led activities and teams in cultural and educational projects, managing platforms, forms, databases, and user experience.",
            stat1: "Years Programming",
            stat2: "Completed Projects",
            stat3: "Teams Led"
        },
        
        // Experience
        experience: {
            title: "Experience",
            current: "Current",
            job1: {
                title: "Junior Programmer",
                task1: "Design and development of COBOL applications for batch processing and online systems",
                task2: "Analysis of user stories for implementation",
                task3: "Development of tools and automation for IBM zSeries"
            },
            job2: {
                title: "Activities Coordinator",
                task1: "Organization of massive events with over 500 participants",
                task2: "Leadership and training of volunteer teams",
                task3: "Creation of web platforms, forms, and technical documentation",
                task4: "Automation with Google Apps Script and database management"
            }
        },
        
        // Skills
        skills: {
            title: "Technical Skills",
            languages: "Programming Languages",
            web: "Web Development",
            database: "Databases",
            tools: "Tools",
            strengths: "Personal Strengths",
            intermediate: "Intermediate",
            basic: "Basic",
            advanced: "Advanced",
            strength1: "Organization and leadership",
            strength2: "Clear communication",
            strength3: "Teamwork",
            strength4: "Fast learner",
            strength5: "Proactivity",
            strength6: "Technical creativity"
        },
        
        // Projects
        projects: {
            title: "Relevant Projects",
            project1: {
                title: "IBM zSeries Compiler",
                description: "Integrated compiler with IBM Developer for zSeries IDE for efficient and automated massive compilations."
            },
            project2: {
                title: "zSeries Testing Application",
                description: "Application for data reading support and various tests with zSeries, facilitating mainframe systems testing and validation."
            },
            project3: {
                title: "VSAM Calculator",
                description: "Calculator for VSAM file generation and alternate indexes, optimizing storage management in mainframe systems."
            },
            project4: {
                title: "IYF Guatemala Systems",
                description: "Development of complete systems including web forms, automation, databases and technical documentation for non-profit organization."
            },
            project5: {
                title: "Personal Portfolio",
                description: "Professional portfolio developed with HTML, CSS and JavaScript, implementing internationalization system and dark mode."
            },
            project6: {
                title: "Co-munity",
                description: "Web platform in development for community management and social collaboration, facilitating communication and organization of communities."
            },
            project7: {
                title: "Mayan Chess Platform",
                description: "Interactive platform to learn and play chess with historical theme of Mayans vs Spanish, offering a unique educational experience about Mayan culture."
            }
        },
        
        // Education
        education: {
            title: "Education",
            degree: "Engineering",
            institution: "University Student",
            current: "Current",
            courses: "Courses and Certifications",
            course1: "Web Development",
            course2: "Programming Logic",
            course3: "Google Apps Script",
            course4: "Basic Project Management"
        },
        
        // Contact
        contact: {
            title: "Contact Me",
            description: "Have a project in mind? Let's talk! I'm available for collaborations and new opportunities.",
            email: "Email",
            form: {
                name: "Name",
                email: "Email",
                subject: "Subject",
                message: "Message",
                send: "Send Message"
            }
        },
        
        // Footer
        footer: {
            tagline: "Developing solutions, creating the future",
            rights: "All rights reserved."
        }
    }
};
