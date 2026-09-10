import prisma from '@config/database';
import type { VerificationJobDocument } from '@queues/verificationQueue';

export interface VerificationReviewResult {
  aiStatus: string;
  aiSummary: string;
  aiConfidence: number | null;
  aiError: string | null;
}

// Claude can review images (JPG/PNG/WEBP) and PDFs. Anything else (or a row
// with no mimeType) is not sent.
const MAX_DOCS_REVIEWED = 12;
// ~14 MB of base64 across all attached documents. The concurrency below can
// overshoot this by up to (REVIEW_FETCH_CONCURRENCY - 1) files before it trips,
// so the ceiling leaves headroom to stay under Anthropic's 32 MB request cap
// even with a few large PDFs (PDFs, unlike images, aren't downscaled on upload).
const REVIEW_BASE64_BUDGET = 14 * 1024 * 1024;
// Fetch document bytes a few at a time rather than all at once, so a submission
// with many large files can't spike the worker's memory.
const REVIEW_FETCH_CONCURRENCY = 4;

function isReviewable(doc: VerificationJobDocument): boolean {
  const mime = doc.mimeType ?? '';
  return mime.startsWith('image/') || mime === 'application/pdf';
}

// Called by the BullMQ processor. Deliberately does NOT catch Claude/fetch
// failures here — letting them throw all the way out to BullMQ is what
// makes `VERIFICATION_JOB_OPTIONS`'s attempts/backoff actually retry the
// whole job. Only once retries are exhausted does the worker's `failed`
// handler (see verificationWorker.ts) call recordExhaustedRetriesFallback
// to degrade to the heuristic. A non-retryable case (no API key, no
// reviewable documents) resolves immediately below with no throw, since
// retrying can't fix those.
export async function analyzeVerificationDocuments(
  verificationId: string,
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  const aiResult = await generateAiReview(requestType, documents);

  await prisma.verificationRequest.update({
    where: { id: verificationId },
    data: {
      aiStatus: aiResult.aiStatus,
      aiSummary: aiResult.aiSummary,
      aiConfidence: aiResult.aiConfidence,
      aiError: aiResult.aiError,
      aiReviewedAt: new Date(),
    },
  });

  return aiResult;
}

// Called from verificationWorker's `failed` handler once BullMQ has
// exhausted all retry attempts for a job — records a heuristic fallback so
// the request doesn't sit stuck at aiStatus: 'PENDING' forever.
export async function recordExhaustedRetriesFallback(
  verificationId: string,
  requestType: string,
  documents: VerificationJobDocument[],
  lastError: unknown
): Promise<void> {
  const message = lastError instanceof Error ? lastError.message : 'AI review failed';
  const fallback = runHeuristicReview(
    requestType,
    documents,
    `Automated AI review failed after multiple attempts (${message}) — showing a basic file summary only. This submission was NOT verified by AI; review the documents manually before approving.`
  );

  await prisma.verificationRequest.update({
    where: { id: verificationId },
    data: {
      aiStatus: fallback.aiStatus,
      aiSummary: fallback.aiSummary,
      aiConfidence: fallback.aiConfidence,
      aiError: fallback.aiError,
      aiReviewedAt: new Date(),
    },
  });
}

// `AI_REVIEWED` is reserved for a genuine Claude-backed review — anything
// that falls back to the heuristic (no API key, no reviewable documents, or
// retries exhausted after Claude/fetch kept failing) is tagged
// `HEURISTIC_REVIEWED` instead, and always carries a non-null `aiError`
// explaining why, so the admin UI's existing error banner
// (VerificationDetail.jsx) surfaces the caveat instead of a heuristic
// file-listing looking identical to a real automated review.
async function generateAiReview(
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return runHeuristicReview(requestType, documents, 'Automated AI review is not configured for this environment.');
  }

  const reviewableDocs = documents.filter(isReviewable);
  if (!reviewableDocs.length) {
    return runHeuristicReview(
      requestType,
      documents,
      'No reviewable documents were included — automated review needs image (JPG/PNG/WEBP) or PDF files. This submission was not automatically reviewed; check the documents manually.'
    );
  }

  // Let transient failures (rate limits, 5xx, a document URL that didn't
  // fetch this time) throw straight through — see the comment on
  // analyzeVerificationDocuments above for why.
  return runClaudeReview(requestType, reviewableDocs);
}

type FetchedDoc =
  | { status: 'ok'; doc: VerificationJobDocument; base64: string }
  | { status: 'failed'; doc: VerificationJobDocument }
  | { status: 'skipped'; doc: VerificationJobDocument };

// Fetches up to `candidates.length` document bodies, at most
// REVIEW_FETCH_CONCURRENCY in flight, and stops committing once
// REVIEW_BASE64_BUDGET is reached (the first document is always attempted, even
// if oversized, so a single big file still gets a review). Results are written
// back in the original candidate order.
async function fetchReviewableDocs(candidates: VerificationJobDocument[]): Promise<FetchedDoc[]> {
  const out: FetchedDoc[] = new Array(candidates.length);
  let committedBase64Length = 0;
  let budgetReached = false;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    // `nextIndex++` is atomic between awaits on JS's single thread.
    for (let i = nextIndex++; i < candidates.length; i = nextIndex++) {
      const doc = candidates[i]!;

      if (budgetReached) {
        out[i] = { status: 'skipped', doc };
        continue;
      }

      try {
        const response = await fetch(doc.fileUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = buffer.toString('base64');

        const alreadyCommitted = out.some((r) => r?.status === 'ok');
        if (alreadyCommitted && committedBase64Length + base64.length > REVIEW_BASE64_BUDGET) {
          budgetReached = true;
          out[i] = { status: 'skipped', doc };
          continue;
        }

        committedBase64Length += base64.length;
        out[i] = { status: 'ok', doc, base64 };
      } catch {
        // One bad document URL shouldn't sink the ones that fetched fine.
        out[i] = { status: 'failed', doc };
      }
    }
  }

  const poolSize = Math.min(REVIEW_FETCH_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return out;
}

function toContentBlock(doc: VerificationJobDocument, base64: string) {
  if ((doc.mimeType ?? '') === 'application/pdf') {
    return {
      type: 'document' as const,
      source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
    };
  }
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: doc.mimeType || 'image/jpeg', data: base64 },
  };
}

async function runClaudeReview(
  requestType: string,
  reviewableDocs: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  const candidates = reviewableDocs.slice(0, MAX_DOCS_REVIEWED);
  const overflowCount = reviewableDocs.length - candidates.length;

  const fetched = await fetchReviewableDocs(candidates);
  const okDocs = fetched.filter((r): r is Extract<FetchedDoc, { status: 'ok' }> => r.status === 'ok');
  const failedFetches = fetched.filter((r) => r.status === 'failed').length;
  const budgetSkipped = fetched.filter((r) => r.status === 'skipped').length;

  if (!okDocs.length) {
    throw new Error('None of the documents could be fetched for review');
  }

  const contentBlocks = okDocs.map((r) => toContentBlock(r.doc, r.base64));

  const reviewedTypeList = okDocs
    .map((r) => `${r.doc.documentType}${(r.doc.mimeType ?? '') === 'application/pdf' ? ' (PDF)' : ''}`)
    .join(', ');
  const prompt = `Review these verification documents for a ${requestType} submission. Documents included: ${reviewedTypeList}. Assess whether the documents look legitimate, extract the key facts, and provide a short admin summary (2-3 sentences), noting any concerns. End your reply on its own final line with exactly "CONFIDENCE: 0.NN" — your own certainty (0.00-1.00) in your legitimacy assessment.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...contentBlocks],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const contentText = (data.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');

  if (!contentText) {
    throw new Error('Anthropic returned no usable content');
  }

  // Pull Claude's own reported confidence off the last line rather than
  // fabricating a fixed number — if it didn't follow the format, we don't
  // pretend to know how confident it was.
  const confidenceMatch = contentText.match(/CONFIDENCE:\s*([01](?:\.\d+)?)\s*$/i);
  const aiConfidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]!))) : null;
  const summaryText = confidenceMatch ? contentText.slice(0, confidenceMatch.index).trim() : contentText;

  const notReviewed = overflowCount + budgetSkipped;
  const budgetMb = Math.round(REVIEW_BASE64_BUDGET / (1024 * 1024));
  const caveats = [
    notReviewed > 0
      ? `${notReviewed} document${notReviewed > 1 ? 's were' : ' was'} not sent for AI review (limit: first ${MAX_DOCS_REVIEWED} documents / ~${budgetMb} MB). Review those manually.`
      : '',
    failedFetches > 0
      ? `${failedFetches} document${failedFetches > 1 ? 's' : ''} could not be fetched for review.`
      : '',
    aiConfidence === null ? 'The model did not report a confidence score for this review.' : '',
  ].filter(Boolean);

  return {
    aiStatus: 'AI_REVIEWED',
    aiSummary: summaryText.slice(0, 1500),
    aiConfidence,
    aiError: caveats.length ? caveats.join(' ') : null,
  };
}

function runHeuristicReview(
  requestType: string,
  documents: VerificationJobDocument[],
  reason: string
): VerificationReviewResult {
  const names = documents.map((doc) => doc.originalName ?? 'document').join(', ');
  const hasImage = documents.some((doc) => (doc.mimeType ?? '').startsWith('image/'));
  const hasPdf = documents.some((doc) => doc.mimeType === 'application/pdf');

  const summary = [
    `Uploaded ${documents.length} document${documents.length > 1 ? 's' : ''} for ${requestType.toLowerCase()} verification.`,
    `Files received: ${names}.`,
    hasImage ? 'Image-based documents were detected.' : '',
    hasPdf ? 'PDF documents were detected.' : '',
    'This is a file-listing only, not a content review — no automated legitimacy assessment was performed.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    aiStatus: 'HEURISTIC_REVIEWED',
    aiSummary: summary,
    aiConfidence: null,
    aiError: reason,
  };
}
