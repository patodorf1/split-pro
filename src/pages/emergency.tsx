import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PhoneOffIcon,
  PlusIcon,
  SirenIcon,
} from 'lucide-react';
import Head from 'next/head';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ContactEditor, type EmergencyContactItem } from '~/components/emergency/ContactEditor';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { telHref, whatsappHref } from '~/lib/emergency';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { copyText } from '~/utils/clipboard';
import { withI18nStaticProps } from '~/utils/i18n/server';

const ICON_BUTTON_CLASSES =
  'text-primary hover:bg-primary-soft flex size-11 shrink-0 items-center justify-center rounded-full transition-colors';

const EmergencyPage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();
  const list = api.emergency.list.useQuery();
  const [editing, setEditing] = useState(false);

  const contacts = useMemo(() => list.data?.contacts ?? [], [list.data]);
  const groups = useMemo(() => list.data?.groups ?? [], [list.data]);

  /** Grupo donde se agregan contactos nuevos: el que ya tiene (en la práctica, "Casa"). */
  const defaultGroupId = contacts[0]?.groupId ?? (1 === groups.length ? groups[0]!.id : null);

  /** Contactos agrupados por grupo; el nombre del grupo sólo se muestra si hay más de uno. */
  const sections = useMemo(() => {
    const byGroup = new Map<number, EmergencyContactItem[]>();
    for (const contact of contacts) {
      byGroup.set(contact.groupId, [...(byGroup.get(contact.groupId) ?? []), contact]);
    }
    return [...byGroup.entries()].map(([groupId, items]) => ({
      groupId,
      name: groups.find((group) => group.id === groupId)?.name ?? '',
      items,
    }));
  }, [contacts, groups]);

  const move = api.emergency.move.useMutation({
    onSuccess: () => utils.emergency.list.invalidate(),
    onError: () => toast.error(t('emergency.errors.generic')),
  });

  const onCopy = useCallback(
    async (phone: string) => {
      if (await copyText(phone)) {
        toast.success(t('emergency.copied'), { duration: 1500 });
      } else {
        toast.error(t('emergency.copy_failed'));
      }
    },
    [t],
  );

  const actions = (
    <div className="flex items-center gap-4">
      {0 < contacts.length ? (
        <Button
          variant="ghost"
          size={editing ? 'sm' : 'icon'}
          className={editing ? 'h-9 px-1' : 'size-9'}
          aria-pressed={editing}
          aria-label={t('emergency.edit_list')}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? (
            <span className="text-primary text-sm font-semibold">{t('emergency.done')}</span>
          ) : (
            <PencilIcon className="text-primary size-5" />
          )}
        </Button>
      ) : null}
      <ContactEditor
        mode="create"
        groups={groups}
        defaultGroupId={defaultGroupId}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={t('emergency.editor.create')}
          >
            <PlusIcon className="text-primary size-6" />
          </Button>
        }
      />
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('emergency.title')}</title>
      </Head>
      <MainLayout title={t('emergency.title')} actions={actions} loading={list.isPending}>
        <div className="flex flex-col gap-5 pb-8">
          {0 === contacts.length ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <span className="bg-primary-soft text-primary flex size-14 items-center justify-center rounded-full">
                <SirenIcon className="size-7" />
              </span>
              <p className="text-muted-foreground max-w-[280px] text-sm">{t('emergency.empty')}</p>
            </div>
          ) : null}

          {sections.map((section) => (
            <section key={section.groupId} className="flex flex-col gap-3">
              {1 < sections.length ? <SectionLabel>{section.name}</SectionLabel> : null}

              {editing ? (
                <ul className="card-surface divide-border divide-y px-3">
                  {section.items.map((contact, index) => (
                    <li key={contact.id} className="flex items-center gap-2 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-foreground truncate text-sm font-medium">
                          {contact.name}
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {contact.phone || t('emergency.add_number')}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-10"
                        disabled={0 === index || move.isPending}
                        aria-label={t('emergency.move_up')}
                        onClick={() => move.mutate({ id: contact.id, direction: 'up' })}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-10"
                        disabled={section.items.length - 1 === index || move.isPending}
                        aria-label={t('emergency.move_down')}
                        onClick={() => move.mutate({ id: contact.id, direction: 'down' })}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <ContactEditor
                        mode="edit"
                        contact={contact}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-primary size-10"
                            aria-label={`${t('emergency.editor.edit')}: ${contact.name}`}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="flex flex-col gap-3">
                  {section.items.map((contact) => (
                    <li key={contact.id}>
                      <ContactCard contact={contact} onCopy={onCopy} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </MainLayout>
    </>
  );
};

const ContactCard: React.FC<{
  contact: EmergencyContactItem;
  onCopy: (phone: string) => Promise<void>;
}> = ({ contact, onCopy }) => {
  const { t } = useTranslationWithUtils();
  const tel = telHref(contact.phone);
  const whatsapp = whatsappHref(contact.whatsapp);

  const body = (
    <>
      <span
        className={
          tel
            ? 'bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-full'
            : 'bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-full'
        }
      >
        {tel ? <PhoneIcon className="size-5" /> : <PhoneOffIcon className="size-5" />}
      </span>
      {/* Text-left explícito: el disparador de la hoja le agrega text-center al botón. */}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-foreground truncate text-base font-semibold">{contact.name}</span>
        {contact.note ? (
          <span className="text-muted-foreground line-clamp-2 text-xs">{contact.note}</span>
        ) : null}
        <span
          className={
            tel
              ? 'text-primary truncate text-lg font-semibold tabular-nums'
              : 'text-muted-foreground truncate text-sm font-medium'
          }
        >
          {tel ? contact.phone : t('emergency.add_number')}
        </span>
      </span>
    </>
  );

  const mainClasses =
    'flex min-h-[72px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:opacity-70';

  return (
    <div className="card-surface flex items-center gap-1 pr-2">
      {tel ? (
        <a href={tel} className={mainClasses} aria-label={`${t('emergency.call')} ${contact.name}`}>
          {body}
        </a>
      ) : (
        // Sin número: tocar la tarjeta abre la edición para cargarlo.
        <ContactEditor
          mode="edit"
          contact={contact}
          trigger={
            <button type="button" className={mainClasses}>
              {body}
            </button>
          }
        />
      )}
      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={ICON_BUTTON_CLASSES}
          aria-label={`${t('emergency.whatsapp')} ${contact.name}`}
        >
          <MessageCircleIcon className="size-5" />
        </a>
      ) : null}
      {tel ? (
        <button
          type="button"
          className={ICON_BUTTON_CLASSES}
          aria-label={`${t('emergency.copy')} ${contact.phone}`}
          onClick={() => void onCopy(contact.phone)}
        >
          <CopyIcon className="size-5" />
        </button>
      ) : null}
    </div>
  );
};

EmergencyPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default EmergencyPage;
