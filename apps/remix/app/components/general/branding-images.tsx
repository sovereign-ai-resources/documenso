import { getBasePath } from '@documenso/lib/constants/app';
import { BRAND_NAME } from '@documenso/lib/constants/brand';
import { cn } from '@documenso/ui/lib/utils';

export type BrandingImagesProps = {
  className?: string;
  light: string;
  dark: string;
};

// The pack's images carry their own colors, so `fill`/`currentColor` from the caller does not apply.
export const BrandingImages = ({ className, light, dark }: BrandingImagesProps) => (
  <>
    <img src={`${getBasePath()}${light}`} alt={BRAND_NAME()} className={cn('dark:hidden', className)} />
    <img src={`${getBasePath()}${dark}`} alt={BRAND_NAME()} className={cn('hidden dark:block', className)} />
  </>
);
