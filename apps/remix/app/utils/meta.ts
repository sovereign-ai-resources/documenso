import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { BRAND_LEGAL_NAME, BRAND_NAME, IS_BRANDED } from '@documenso/lib/constants/brand';
import { i18n, type MessageDescriptor } from '@lingui/core';

export const appMetaTags = (title?: MessageDescriptor) => {
  const branded = IS_BRANDED();
  const brandName = BRAND_NAME();

  const description = branded
    ? `Sign and manage documents securely with ${brandName}.`
    : 'Join Documenso, the open signing infrastructure, and get a 10x better signing experience. Pricing starts at $30/mo. forever! Sign in now and enjoy a faster, smarter, and more beautiful document signing process. Integrates with your favorite tools, customizable, and expandable. Support our mission and become a part of our open-source community.';

  return [
    {
      title: title ? `${i18n._(title)} - ${brandName}` : brandName,
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content: branded
        ? `${brandName}, document signing, e-signature`
        : 'Documenso, open source, DocuSign alternative, document signing, open signing infrastructure, open-source community, fast signing, beautiful signing, smart templates',
    },
    {
      name: 'author',
      content: BRAND_LEGAL_NAME(),
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      property: 'og:title',
      content: branded ? brandName : 'Documenso - The Open Source DocuSign Alternative',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    ...(branded ? [] : [{ name: 'twitter:site', content: '@documenso' }]),
    {
      name: 'twitter:description',
      content: description,
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
  ];
};
