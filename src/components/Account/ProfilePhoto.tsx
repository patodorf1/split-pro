import { Camera, Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useId, useState } from 'react';
import { toast } from 'sonner';

import { EntityAvatar } from '~/components/ui/avatar';
import { api } from '~/utils/api';
import { uploadImage } from '~/utils/imageUpload';

/** Lado de la foto que se sube: alcanza y sobra para un avatar y pesa unos pocos KB. */
const PHOTO_SIZE = 256;
const PHOTO_QUALITY = 0.85;

const loadBitmap = async (file: File): Promise<ImageBitmap | HTMLImageElement> => {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Navegadores sin createImageBitmap para este formato: se carga como imagen común.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

/**
 * Achica la foto en el teléfono antes de subirla: recorte cuadrado del centro, 256×256, en JPEG.
 * Así no se sube la foto de 12 MP de la cámara para mostrar un círculo de 40 px.
 */
export const shrinkPhoto = async (file: File): Promise<File> => {
  const source = await loadBitmap(file);
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const side = Math.min(width, height);
  const target = Math.min(PHOTO_SIZE, side);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Cannot get canvas context');
  }

  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target,
  );
  if ('close' in source) {
    source.close();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Canvas toBlob returned null'))),
      'image/jpeg',
      PHOTO_QUALITY,
    );
  });

  return new File([blob], 'profile.jpg', { type: 'image/jpeg' });
};

/**
 * Casa: foto de perfil en Cuenta. Tocar la foto (o "Cambiar foto") abre el selector del teléfono,
 * que ofrece sacar una con la cámara o elegirla de la galería. Se achica, se sube y queda en
 * `User.image`; "Quitar foto" vuelve a la inicial.
 */
export const ProfilePhoto: React.FC<{
  user?: { id: number; name?: string | null; email?: string | null; image?: string | null };
  children?: React.ReactNode;
}> = ({ user, children }) => {
  const { t } = useTranslation();
  const inputId = useId();
  const utils = api.useUtils();
  const updateDetails = api.user.updateUserDetail.useMutation();
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (image: string | null) => {
      await updateDetails.mutateAsync({ image });
      // La foto aparece en muchas pantallas (filas, saldos, grupos): se refresca todo.
      await utils.invalidate();
    },
    [updateDetails, utils],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }

      setBusy(true);
      try {
        const photo = await shrinkPhoto(file);
        const key = await uploadImage(photo);
        await save(key);
        toast.success(t('profile_photo.saved'), { duration: 1500 });
      } catch (error) {
        console.error('Profile photo upload failed:', error);
        toast.error(t('profile_photo.error'));
      } finally {
        setBusy(false);
      }
    },
    [save, t],
  );

  const handleRemove = useCallback(async () => {
    setBusy(true);
    try {
      await save(null);
      toast.success(t('profile_photo.removed'), { duration: 1500 });
    } catch (error) {
      console.error('Profile photo removal failed:', error);
      toast.error(t('profile_photo.error'));
    } finally {
      setBusy(false);
    }
  }, [save, t]);

  const hasPhoto = Boolean(user?.image);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        disabled={busy}
      />
      <label
        htmlFor={inputId}
        className="relative shrink-0 cursor-pointer rounded-full"
        aria-label={t(hasPhoto ? 'profile_photo.change' : 'profile_photo.add')}
      >
        <EntityAvatar entity={user} size={56} />
        <span className="bg-primary text-primary-foreground ring-card absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full ring-2">
          <Camera className="size-3" aria-hidden="true" />
        </span>
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2
              className="size-5 animate-spin text-white"
              aria-label={t('profile_photo.uploading')}
            />
          </span>
        ) : null}
      </label>
      <div className="min-w-0">
        {children}
        <div className="mt-1 flex items-center gap-3 text-xs font-medium">
          <label htmlFor={inputId} className="text-primary cursor-pointer">
            {t(hasPhoto ? 'profile_photo.change' : 'profile_photo.add')}
          </label>
          {hasPhoto ? (
            <button
              type="button"
              className="text-muted-foreground disabled:opacity-50"
              onClick={handleRemove}
              disabled={busy}
            >
              {t('profile_photo.remove')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
