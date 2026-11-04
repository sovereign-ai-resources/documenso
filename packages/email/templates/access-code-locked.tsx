import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';

import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '../components';
import { TemplateBrandingLogo } from '../template-components/template-branding-logo';
import { TemplateDocumentImage } from '../template-components/template-document-image';
import { TemplateFooter } from '../template-components/template-footer';

export type AccessCodeLockedEmailTemplateProps = {
  documentName?: string;
  recipientName?: string;
  documentLink?: string;
  assetBaseUrl?: string;
};

export const AccessCodeLockedTemplate = ({
  documentName = 'Open Source Pledge.pdf',
  recipientName = 'John Doe',
  documentLink = 'https://documenso.com',
  assetBaseUrl = 'http://localhost:3002',
}: AccessCodeLockedEmailTemplateProps) => {
  const { _ } = useLingui();

  const previewText = msg`Access to "${documentName}" is locked for ${recipientName}.`;

  return (
    <Html>
      <Head />

      <Body className="mx-auto my-auto bg-background font-sans">
        <Preview>{_(previewText)}</Preview>

        <Section>
          <Container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-border border-solid p-4 backdrop-blur-sm">
            <Section>
              <TemplateBrandingLogo assetBaseUrl={assetBaseUrl} className="mb-4 h-6" />

              <TemplateDocumentImage className="mt-6" assetBaseUrl={assetBaseUrl} />

              <Section>
                <Text className="mx-auto mb-0 max-w-[80%] text-center font-semibold text-foreground text-lg">
                  <Trans>
                    Access code locked for "{recipientName}" on "{documentName}"
                  </Trans>
                </Text>

                <Text className="my-1 text-center text-base text-muted-foreground">
                  <Trans>
                    The access code was entered incorrectly too many times, so {recipientName} can no longer open the
                    document. Set a new access code for this recipient to let them in again.
                  </Trans>
                </Text>

                <Section className="my-4 text-center">
                  <Button
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-center font-medium text-primary-foreground text-sm no-underline"
                    href={documentLink}
                  >
                    <Trans>View Document</Trans>
                  </Button>
                </Section>
              </Section>
            </Section>
          </Container>

          <Hr className="mx-auto mt-12 max-w-xl" />

          <Container className="mx-auto max-w-xl">
            <TemplateFooter />
          </Container>
        </Section>
      </Body>
    </Html>
  );
};

export default AccessCodeLockedTemplate;
