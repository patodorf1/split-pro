import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { Globe } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { getSupportedLanguages } from '~/utils/i18n/client';
import { cn } from '~/lib/utils';

interface LanguageSelectorProps {
  className?: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ className = '' }) => {
  const { i18n } = useTranslation();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const supportedLanguages = useMemo(getSupportedLanguages, []);

  const currentLanguage =
    supportedLanguages.find((lang) => lang.code === i18n.language) ?? supportedLanguages[0];

  const handleLanguageChange = useCallback(
    async (languageCode: string) => {
      try {
        await fetch(`/api/locale?locale=${languageCode}`);
        await router.push(router.asPath, router.asPath, {
          locale: languageCode,
          scroll: false,
        });
        setIsOpen(false);
      } catch (error) {
        console.error('Error changing language:', error);
      }
    },
    [router],
  );

  const handleToggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);

  const handleClose = useCallback(() => setIsOpen(false), []);

  const getLanguageClickHandler = useCallback(
    (languageCode: string) => () => handleLanguageChange(languageCode),
    [handleLanguageChange],
  );

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggleOpen}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2"
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline">{currentLanguage?.name}</span>
        <span className="sm:hidden">{currentLanguage?.code.toUpperCase()}</span>
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={handleClose} />

          {/* Dropdown */}
          <div className="bg-popover text-popover-foreground border-border rounded-card absolute top-full right-0 z-20 mt-1 min-w-[120px] border shadow-lg">
            <div className="py-1">
              {supportedLanguages.map((language) => (
                <button
                  key={language.code}
                  onClick={getLanguageClickHandler(language.code)}
                  className={`hover:bg-accent block w-full px-4 py-2 text-left text-sm ${
                    i18n.language === language.code
                      ? 'bg-primary-soft text-primary font-medium'
                      : 'text-foreground'
                  }`}
                >
                  {language.name}
                  {i18n.language === language.code && <span className="text-primary ml-2">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
