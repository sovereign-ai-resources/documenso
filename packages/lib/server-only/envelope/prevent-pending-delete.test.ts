import { DocumentStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelDocument: vi.fn(),
}));

vi.mock('../document/cancel-document', () => ({
  cancelDocument: mocks.cancelDocument,
}));

import { cancelPendingInsteadOfDelete } from './prevent-pending-delete';

const requestMetadata = { auth: null, requestMetadata: {}, source: 'app' as const };

const options = (status: DocumentStatus) => ({
  envelope: { id: 'envelope_1', status, title: 'Agreement' },
  id: { type: 'envelopeId' as const, id: 'envelope_1' },
  userId: 1,
  teamId: 2,
  requestMetadata,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PRIVATE_PREVENT_PENDING_DELETE', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cancelPendingInsteadOfDelete', () => {
  it('cancels a pending document and returns it with the cancelled state', async () => {
    const completedAt = new Date();
    mocks.cancelDocument.mockResolvedValue({ id: 'envelope_1', status: DocumentStatus.CANCELLED, completedAt });

    const result = await cancelPendingInsteadOfDelete(options(DocumentStatus.PENDING));

    expect(mocks.cancelDocument).toHaveBeenCalledWith({
      id: { type: 'envelopeId', id: 'envelope_1' },
      userId: 1,
      teamId: 2,
      requestMetadata,
    });
    expect(result).toMatchObject({ id: 'envelope_1', title: 'Agreement', status: DocumentStatus.CANCELLED });
  });

  it.each([
    DocumentStatus.DRAFT,
    DocumentStatus.COMPLETED,
    DocumentStatus.REJECTED,
    DocumentStatus.CANCELLED,
  ])('leaves a %s document to the normal delete', async (status) => {
    expect(await cancelPendingInsteadOfDelete(options(status))).toBeNull();
    expect(mocks.cancelDocument).not.toHaveBeenCalled();
  });

  it.each(['', 'false', '1'])('leaves a pending document to the normal delete when the flag is "%s"', async (value) => {
    vi.stubEnv('NEXT_PRIVATE_PREVENT_PENDING_DELETE', value);

    expect(await cancelPendingInsteadOfDelete(options(DocumentStatus.PENDING))).toBeNull();
    expect(mocks.cancelDocument).not.toHaveBeenCalled();
  });

  it('propagates a refused cancel so nothing is deleted', async () => {
    mocks.cancelDocument.mockRejectedValue(new Error('Not allowed'));

    await expect(cancelPendingInsteadOfDelete(options(DocumentStatus.PENDING))).rejects.toThrow('Not allowed');
  });
});
