// Unit test for the AI-review document selection / block-building logic.
// Prisma and the network are mocked — no DB, no real Anthropic call.

const mockUpdate = jest.fn().mockResolvedValue({});
jest.mock('@config/database', () => ({
  __esModule: true,
  default: {
    verificationRequest: { update: mockUpdate },
    // jestSetupAfterEnv.ts (this file's context too) calls this in afterAll.
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

import { analyzeVerificationDocuments } from '@services/verificationAiService';
import type { VerificationJobDocument } from '@queues/verificationQueue';

type AnthropicBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

function doc(overrides: Partial<VerificationJobDocument> = {}): VerificationJobDocument {
  return {
    documentType: 'GOVERNMENT_ID_FRONT',
    fileUrl: `https://storage.test/${Math.random().toString(36).slice(2)}.jpg`,
    mimeType: 'image/jpeg',
    originalName: 'id.jpg',
    ...overrides,
  };
}

/** fetch stub: doc URLs return bytes, the Anthropic URL returns a canned review. */
function stubFetch(reviewText = 'Documents look legitimate. No concerns.\nCONFIDENCE: 0.90') {
  return jest.fn(async (url: string) => {
    if (url === ANTHROPIC_URL) {
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: reviewText }] }),
      } as unknown as Response;
    }
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
    } as unknown as Response;
  });
}

function lastAnthropicBody(fetchMock: jest.Mock): AnthropicBody {
  const call = fetchMock.mock.calls.find(([u]) => u === ANTHROPIC_URL);
  if (!call) throw new Error('Anthropic endpoint was not called');
  return JSON.parse((call[1] as RequestInit).body as string);
}

afterEach(() => {
  jest.restoreAllMocks();
  mockUpdate.mockClear();
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe('verificationAiService.analyzeVerificationDocuments', () => {
  it('falls back to the heuristic when no ANTHROPIC_API_KEY is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = stubFetch();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const result = await analyzeVerificationDocuments('v1', 'WORKER_ONBOARDING', [doc()]);

    expect(result.aiStatus).toBe('HEURISTIC_REVIEWED');
    expect(result.aiError).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the heuristic when no document has a reviewable mimeType', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fetchMock = stubFetch();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const result = await analyzeVerificationDocuments('v1', 'WORKER_ONBOARDING', [
      doc({ mimeType: null }),
      doc({ mimeType: 'application/octet-stream' }),
    ]);

    expect(result.aiStatus).toBe('HEURISTIC_REVIEWED');
    expect(result.aiError).toMatch(/no reviewable documents/i);
    expect(fetchMock).not.toHaveBeenCalledWith(ANTHROPIC_URL, expect.anything());
  });

  it('sends images as image blocks and PDFs as document blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fetchMock = stubFetch();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const result = await analyzeVerificationDocuments('v1', 'WORKER_ONBOARDING', [
      doc({ documentType: 'GOVERNMENT_ID_FRONT', mimeType: 'image/jpeg' }),
      doc({ documentType: 'RESUME', mimeType: 'application/pdf', fileUrl: 'https://storage.test/cv.pdf' }),
    ]);

    expect(result.aiStatus).toBe('AI_REVIEWED');
    expect(result.aiConfidence).toBeCloseTo(0.9);
    expect(result.aiSummary).toContain('legitimate');

    const content = lastAnthropicBody(fetchMock).messages[0].content;
    expect(content[0]).toMatchObject({ type: 'text' });
    const blockTypes = content.slice(1).map((b) => b.type);
    expect(blockTypes).toEqual(['image', 'document']);
    const pdfBlock = content.find((b) => b.type === 'document') as Record<string, any>;
    expect(pdfBlock.source.media_type).toBe('application/pdf');
  });

  it('caps the number of documents sent and notes the rest in aiError', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fetchMock = stubFetch();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const docs = Array.from({ length: 15 }, (_, i) =>
      doc({ fileUrl: `https://storage.test/doc-${i}.jpg` })
    );
    const result = await analyzeVerificationDocuments('v1', 'WORKER_ONBOARDING', docs);

    expect(result.aiStatus).toBe('AI_REVIEWED');
    expect(result.aiError).toMatch(/not sent for AI review/i);

    const content = lastAnthropicBody(fetchMock).messages[0].content;
    // 1 text block + 12 document blocks (MAX_DOCS_REVIEWED)
    expect(content.length).toBe(13);
  });

  it('persists the review result to the verification request', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    jest.spyOn(globalThis, 'fetch').mockImplementation(stubFetch() as unknown as typeof fetch);

    await analyzeVerificationDocuments('v-123', 'WORKER_ONBOARDING', [doc()]);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v-123' },
        data: expect.objectContaining({ aiStatus: 'AI_REVIEWED' }),
      })
    );
  });
});
