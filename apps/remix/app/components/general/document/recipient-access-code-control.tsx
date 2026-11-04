import { ACCESS_CODE_MIN_LENGTH, IS_ACCESS_CODE_ENABLED } from '@documenso/lib/constants/access-code';
import { AppError } from '@documenso/lib/errors/app-error';
import { DocumentAuth, ZRecipientAuthOptionsSchema } from '@documenso/lib/types/document-auth';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { Label } from '@documenso/ui/primitives/label';
import { PasswordInput } from '@documenso/ui/primitives/password-input';
import { Switch } from '@documenso/ui/primitives/switch';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { DocumentStatus, EnvelopeType, RecipientRole, SigningStatus } from '@prisma/client';
import { KeyRoundIcon } from 'lucide-react';
import { useState } from 'react';
import { useRevalidator } from 'react-router';

export type RecipientAccessCodeControlProps = {
  envelopeId: string;
  envelopeType: EnvelopeType;
  envelopeStatus?: DocumentStatus;
  recipient: {
    id: number;
    email: string;
    name: string;
    role: RecipientRole;
    signingStatus: SigningStatus;
    authOptions: unknown;
  };
};

/**
 * Lets the sender require an access code for one recipient and issue the
 * code. On a template only the requirement is stored; the code is set on each
 * document. Issuing a new code also unlocks a locked recipient.
 */
export const RecipientAccessCodeControl = ({
  envelopeId,
  envelopeType,
  envelopeStatus,
  recipient,
}: RecipientAccessCodeControlProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();

  const isTemplate = envelopeType === EnvelopeType.TEMPLATE;
  const isRequired = ZRecipientAuthOptionsSchema.parse(recipient.authOptions).accessAuth.includes(
    DocumentAuth.ACCESS_CODE,
  );

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(isRequired);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: setRecipientCode, isPending } = trpc.accessCode.setRecipientCode.useMutation();

  const canEdit =
    IS_ACCESS_CODE_ENABLED() &&
    recipient.role !== RecipientRole.CC &&
    recipient.signingStatus === SigningStatus.NOT_SIGNED &&
    envelopeStatus !== DocumentStatus.COMPLETED &&
    envelopeStatus !== DocumentStatus.REJECTED;

  if (!canEdit) {
    return null;
  }

  const onSave = async () => {
    setError(null);

    if (enabled && !isTemplate && code.trim().length < ACCESS_CODE_MIN_LENGTH) {
      setError(_(msg`The access code must be at least ${ACCESS_CODE_MIN_LENGTH} characters.`));
      return;
    }

    try {
      await setRecipientCode({
        envelopeId,
        recipientId: recipient.id,
        enabled,
        code: enabled && !isTemplate ? code : undefined,
      });

      toast({
        title: enabled ? _(msg`Access code saved`) : _(msg`Access code removed`),
        description: enabled && !isTemplate ? _(msg`Share the code with the recipient separately.`) : undefined,
      });

      setCode('');
      setOpen(false);
      await revalidate();
    } catch (err) {
      setError(AppError.parseError(err).message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setEnabled(isRequired);
        setCode('');
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={isRequired ? 'text-foreground' : 'text-muted-foreground'}
          title={_(msg`Access code`)}
          data-testid={`access-code-control-${recipient.id}`}
        >
          <KeyRoundIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Access code</Trans>
          </DialogTitle>
          <DialogDescription>
            {isTemplate ? (
              <Trans>
                Documents created from this template will require an access code for {recipient.email}. Set the code on
                each document before sending it.
              </Trans>
            ) : (
              <Trans>
                {recipient.email} must enter this code before they can open the document. Share it with them separately,
                not in the signing email.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="access-code-enabled">
              <Trans>Require access code</Trans>
            </Label>
            <Switch id="access-code-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && !isTemplate && (
            <div className="space-y-2">
              <Label htmlFor="access-code-value">
                {isRequired ? <Trans>New access code</Trans> : <Trans>Access code</Trans>}
              </Label>
              <PasswordInput
                id="access-code-value"
                autoComplete="new-password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                <Trans>
                  At least {ACCESS_CODE_MIN_LENGTH} characters. Repeated characters and simple sequences are not
                  allowed. Setting a new code also unlocks a recipient who entered too many wrong codes.
                </Trans>
              </p>
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm" data-testid="access-code-control-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" loading={isPending} onClick={onSave}>
            <Trans>Save</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
