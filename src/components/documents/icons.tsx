import {
  BabyIcon,
  BikeIcon,
  BriefcaseIcon,
  CarIcon,
  DogIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  type LucideIcon,
  PlaneIcon,
  SailboatIcon,
  ShieldIcon,
  SmileIcon,
  StethoscopeIcon,
  UserIcon,
  WalletIcon,
} from 'lucide-react';
import React from 'react';

import { type DocumentFolderIconKey, getDocumentTypeByMime } from '~/lib/documents';
import { cn } from '~/lib/utils';

export const FOLDER_ICON_COMPONENTS: Record<DocumentFolderIconKey, LucideIcon> = {
  folder: FolderIcon,
  user: UserIcon,
  baby: BabyIcon,
  smile: SmileIcon,
  heart: HeartIcon,
  car: CarIcon,
  bike: BikeIcon,
  sailboat: SailboatIcon,
  house: HouseIcon,
  dog: DogIcon,
  plane: PlaneIcon,
  stethoscope: StethoscopeIcon,
  shield: ShieldIcon,
  briefcase: BriefcaseIcon,
  'graduation-cap': GraduationCapIcon,
  wallet: WalletIcon,
};

/** Ícono de una sección; si la clave guardada no se conoce, carpeta. */
export const FolderIconBadge: React.FC<{
  icon: string;
  className?: string;
  iconClassName?: string;
}> = ({ icon, className, iconClassName }) => {
  const Icon = FOLDER_ICON_COMPONENTS[icon as DocumentFolderIconKey] ?? FolderIcon;

  return (
    <span
      className={cn(
        'bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-full',
        className,
      )}
    >
      <Icon className={cn('size-5', iconClassName)} />
    </span>
  );
};

const iconForMime = (mimeType: string): LucideIcon => {
  const type = getDocumentTypeByMime(mimeType);

  if (!type) {
    return FileIcon;
  }
  if (type.isImage) {
    return FileImageIcon;
  }
  if ('xls' === type.kind || 'xlsx' === type.kind) {
    return FileSpreadsheetIcon;
  }

  return FileTextIcon;
};

/** Etiqueta corta del tipo ("PDF", "JPG", "DOCX") para mostrar junto al ícono. */
export const typeLabel = (mimeType: string): string =>
  (getDocumentTypeByMime(mimeType)?.ext ?? '').toUpperCase();

export const DocumentTypeIcon: React.FC<{ mimeType: string; className?: string }> = ({
  mimeType,
  className,
}) => {
  const Icon = iconForMime(mimeType);

  return <Icon className={cn('size-5', className)} />;
};
