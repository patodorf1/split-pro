import React, { useState } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { formatExpiryDate, isExpired } from '~/lib/documentReminders';
import { isImageMime } from '~/lib/documents';
import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

import { documentUrl } from './documentClient';
import { DocumentTypeIcon, typeLabel } from './icons';

export type DocumentItem = RouterOutputs['documents']['getFolder']['documents'][number];

/** Miniatura si es imagen (y el servidor pudo generarla); si no, el ícono del tipo. */
const DocumentThumb: React.FC<{ document: Pick<DocumentItem, 'id' | 'mimeType'> }> = ({
  document,
}) => {
  const [failed, setFailed] = useState(false);

  if (isImageMime(document.mimeType) && !failed) {
    return (
      // oxlint-disable-next-line next/no-img-element -- archivo privado servido por la API, sin optimizador
      <img
        src={documentUrl(document.id, { thumb: true })}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="bg-muted size-11 shrink-0 rounded-lg object-cover"
      />
    );
  }

  return (
    <span className="bg-primary-soft text-primary relative flex size-11 shrink-0 flex-col items-center justify-center rounded-lg">
      <DocumentTypeIcon mimeType={document.mimeType} className="size-5" />
      <span className="text-[8px] leading-none font-semibold tracking-wide">
        {typeLabel(document.mimeType)}
      </span>
    </span>
  );
};

/** Fila de documento: tocarla lo abre; el menú de la derecha tiene el resto de las acciones. */
export const DocumentRow: React.FC<{
  document: DocumentItem;
  onOpen: (document: DocumentItem) => void;
  actions: React.ReactNode;
  /** En el buscador: de qué sección es. */
  folderName?: string;
}> = ({ document, onOpen, actions, folderName }) => {
  const { t } = useTranslationWithUtils();
  // Sólo el vencimiento (por día de calendario en Argentina, como los avisos de Inicio).
  const expired = document.expiresAt ? isExpired(document.expiresAt, new Date()) : false;
  const expiry = document.expiresAt
    ? t(expired ? 'documents.expired' : 'documents.expires', {
        date: formatExpiryDate(document.expiresAt),
      })
    : null;

  return (
    <li className="flex items-center gap-3 py-3">
      <button
        type="button"
        onClick={() => onOpen(document)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <DocumentThumb document={document} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-foreground truncate text-sm font-medium">{document.name}</span>
          {folderName || expiry ? (
            <span className="text-muted-foreground truncate text-xs">
              {folderName}
              {folderName && expiry ? <span aria-hidden> · </span> : null}
              {expiry ? (
                <span className={cn(expired && 'text-destructive/80')}>{expiry}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      {actions}
    </li>
  );
};
