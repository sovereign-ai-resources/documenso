import { trpc } from '@documenso/trpc/react';
import { Alert } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Loader } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useParams } from 'react-router';

export type AccessCodeGateProps = {
  children: ReactNode;
};

/**
 * Shows the access code prompt in place of the children while the recipient
 * in the URL requires an access code this browser has not verified yet.
 */
export const AccessCodeGate = ({ children }: AccessCodeGateProps) => {
  const { token } = useParams();

  const { data: status, isLoading } = trpc.accessCode.getSignerStatus.useQuery(
    { token: token ?? '' },
    { enabled: Boolean(token) },
  );

  if (!token) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex h-[70vh] w-full items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status?.required && !status.verified) {
    return <AccessCodePrompt token={token} initiallyLocked={status.locked} issued={status.issued} />;
  }

  return <>{children}</>;
};

type AccessCodePromptProps = {
  token: string;
  initiallyLocked: boolean;
  issued: boolean;
};

const AccessCodePrompt = ({ token, initiallyLocked, issued }: AccessCodePromptProps) => {
  const { _ } = useLingui();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(initiallyLocked);

  const { mutateAsync: verifyAccessCode, isPending } = trpc.accessCode.verify.useMutation();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const result = await verifyAccessCode({ token, code });

      if (result.status === 'VERIFIED') {
        window.location.reload();
        return;
      }

      if (result.status === 'LOCKED') {
        setIsLocked(true);
        return;
      }

      if (result.status === 'NOT_SET') {
        setError(_(msg`No access code has been set for this document yet. Please contact the sender.`));
        return;
      }

      setCode('');
      setError(_(msg`Incorrect access code. ${result.attemptsRemaining} attempts remaining.`));
    } catch {
      setError(_(msg`Something went wrong. Please try again.`));
    }
  };

  return (
    <div className="mx-auto flex h-[70vh] w-full max-w-md flex-col items-center justify-center">
      <div className="w-full" data-testid="access-code-prompt">
        <h1 className="font-semibold text-3xl">
          <Trans>Access code required</Trans>
        </h1>

        {isLocked ? (
          <Alert variant="destructive" className="mt-4 text-sm" data-testid="access-code-locked">
            <Trans>
              This document is locked after too many incorrect access codes. The sender has been notified and can give
              you a new code.
            </Trans>
          </Alert>
        ) : !issued ? (
          <Alert variant="warning" className="mt-4 text-sm">
            <Trans>No access code has been set for this document yet. Please contact the sender.</Trans>
          </Alert>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={onSubmit}>
            <p className="text-muted-foreground text-sm">
              <Trans>The sender has protected this document with an access code. Enter it to continue.</Trans>
            </p>

            <div className="space-y-2">
              <Label htmlFor="access-code">
                <Trans>Access code</Trans>
              </Label>
              <Input
                id="access-code"
                type="password"
                autoComplete="off"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive" padding="tight" className="text-sm" data-testid="access-code-error">
                {error}
              </Alert>
            )}

            <Button type="submit" className="w-full" loading={isPending} disabled={code.trim().length === 0}>
              <Trans>Continue</Trans>
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};
