import { AccessCodeLockedTemplate } from '@documenso/email/templates/access-code-locked';
import { prisma } from '@documenso/prisma';
import { msg } from '@lingui/core/macro';
import { createElement } from 'react';

import { getI18nInstance } from '../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { renderEmailWithI18N } from '../../utils/render-email-with-i18n';
import { formatDocumentsPath } from '../../utils/teams';
import { getEmailContext } from '../email/get-email-context';

/**
 * Tells the document owner that a recipient's access code is locked, so they
 * can set a new one.
 */
export const sendAccessCodeLockedEmail = async ({
  envelopeId,
  recipientId,
}: {
  envelopeId: string;
  recipientId: number;
}) => {
  const envelope = await prisma.envelope.findFirstOrThrow({
    where: { id: envelopeId },
    include: {
      user: { select: { email: true, name: true } },
      documentMeta: true,
      team: { select: { url: true } },
      recipients: { where: { id: recipientId }, select: { name: true, email: true } },
    },
  });

  const [recipient] = envelope.recipients;

  if (!recipient) {
    return;
  }

  const { branding, emailLanguage, senderEmail, emailsDisabled, emailTransport } = await getEmailContext({
    emailType: 'INTERNAL',
    source: { type: 'team', teamId: envelope.teamId },
    meta: envelope.documentMeta,
  });

  if (emailsDisabled) {
    return;
  }

  const i18n = await getI18nInstance(emailLanguage);
  const recipientName = recipient.name || recipient.email;

  const template = createElement(AccessCodeLockedTemplate, {
    documentName: envelope.title,
    recipientName,
    documentLink: `${NEXT_PUBLIC_WEBAPP_URL()}${formatDocumentsPath(envelope.team.url)}/${envelope.id}`,
    assetBaseUrl: NEXT_PUBLIC_WEBAPP_URL(),
  });

  const [html, text] = await Promise.all([
    renderEmailWithI18N(template, { lang: emailLanguage, branding }),
    renderEmailWithI18N(template, { lang: emailLanguage, branding, plainText: true }),
  ]);

  await emailTransport.sendMail({
    to: { name: envelope.user.name || '', address: envelope.user.email },
    from: senderEmail,
    subject: i18n._(msg`Access code locked for "${recipientName}" on "${envelope.title}"`),
    html,
    text,
  });
};
