import { Trans } from '@lingui/react/macro';
import { HelpCircleIcon } from 'lucide-react';

// A branded build has no Documenso docs or community to send people to, and
// self-hosting turns billing off, so the ticket form is hidden too.
export const BrandedSupport = () => (
  <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
    <h1 className="flex flex-row items-center gap-2 font-bold text-3xl">
      <HelpCircleIcon className="h-8 w-8 text-muted-foreground" />
      <Trans>Support</Trans>
    </h1>

    <p className="mt-2 text-muted-foreground">
      <Trans>For help, contact your administrator.</Trans>
    </p>
  </div>
);
