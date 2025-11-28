"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { dictionaries, Locale } from '@/lib/i18n/dictionaries';

interface LanguageContextType {
    language: Locale;
    setLanguage: (lang: Locale) => void;
    dict: typeof dictionaries['en'];
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguage] = useState<Locale>('en');

    useEffect(() => {
        const savedLanguage = localStorage.getItem('language') as Locale;
        if (savedLanguage && (savedLanguage === 'en' || savedLanguage === 'ko')) {
            setLanguage(savedLanguage);
        } else {
            // Detect browser language
            const browserLang = navigator.language.split('-')[0];
            if (browserLang === 'ko') {
                setLanguage('ko');
            }
        }
    }, []);

    const handleSetLanguage = (lang: Locale) => {
        setLanguage(lang);
        localStorage.setItem('language', lang);
    };

    return (
        <LanguageContext.Provider value={{
            language,
            setLanguage: handleSetLanguage,
            dict: dictionaries[language]
        }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
