import prisma from '@config/database';
import type { VerificationJobDocument } from '@queues/verificationQueue';

export interface VerificationReviewResult {
  aiStatus: string;
  aiSummary: string;
  aiConfidence: number | null;
  aiError: string | null;
}

const MAX_IMAGES_REVIEWED = 3;

// Called by the BullMQ processor. Deliberately does NOT catch Claude/fetch
// failures here — letting them throw all the way out to BullMQ is what
// makes `VERIFICATION_JOB_OPTIONS`'s attempts/backoff actually retry the
// whole job. Only once retries are exhausted does the worker's `failed`
// handler (see verificationWorker.ts) call recordExhaustedRetriesFallback
// to degrade to the heuristic. A non-retryable case (no API key, no images)
// resolves immediately below with no throw, since retrying can't fix those.
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
// that falls back to the heuristic (no API key, no images, or retries
// exhausted after Claude/fetch kept failing) is tagged `HEURISTIC_REVIEWED`
// instead, and always carries a non-null `aiError` explaining why, so the
// admin UI's existing error banner (VerificationDetail.jsx) surfaces the
// caveat instead of a heuristic file-listing looking identical to a real
// automated review.
async function generateAiReview(
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return runHeuristicReview(requestType, documents, 'Automated AI review is not configured for this environment.');
  }

  const imageDocs = documents.filter((doc) => (doc.mimeType ?? '').startsWith('image/'));
  if (!imageDocs.length) {
    return runHeuristicReview(
      requestType,
      documents,
      'No image documents were included (PDF/text only) — Claude can only review images here, so this submission was not automatically reviewed. Check the documents manually.'
    );
  }

  // Let transient failures (rate limits, 5xx, a document URL that didn't
  // fetch this time) throw straight through — see the comment on
  // analyzeVerificationDocuments above for why.
  return runClaudeReview(requestType, documents, imageDocs);
}

async function runClaudeReview(
  requestType: string,
  allDocuments: VerificationJobDocument[],
  imageDocs: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  const reviewedDocs = imageDocs.slice(0, MAX_IMAGES_REVIEWED);
  const skippedCount = imageDocs.length - reviewedDocs.length;

  // allSettled, not all — one bad document URL shouldn't sink the images
  // that fetched fine.
  const fetchResults = await Promise.allSettled(
    reviewedDocs.map(async (doc) => {
      const response = await fetch(doc.fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: doc.mimeType || 'image/jpeg',
          data: buffer.toString('base64'),
        },
      };
    })
  );

  const imageBlocks = fetchResults
    .filter((r): r is PromiseFulfilledResult<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> => r.status === 'fulfilled')
    .map((r) => r.value);
  const failedFetches = fetchResults.filter((r) => r.status === 'rejected').length;

  if (!imageBlocks.length) {
    throw new Error('None of the document images could be fetched for review');
  }

  const documentTypeList = allDocuments.map((doc) => doc.documentType).join(', ');
  const prompt = `Review these verification documents for a ${requestType} submission. Document types included: ${documentTypeList}. Assess whether the documents look legitimate, extract the key facts, and provide a short admin summary (2-3 sentences), noting any concerns. End your reply on its own final line with exactly "CONFIDENCE: 0.NN" — your own certainty (0.00-1.00) in your legitimacy assessment.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageBlocks],
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
  const aiConfidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]))) : null;
  const summaryText = confidenceMatch ? contentText.slice(0, confidenceMatch.index).trim() : contentText;

  const caveats = [
    skippedCount > 0 ? `${skippedCount} additional image document${skippedCount > 1 ? 's' : ''} were not reviewed (only the first ${MAX_IMAGES_REVIEWED} are sent to AI review).` : '',
    failedFetches > 0 ? `${failedFetches} document${failedFetches > 1 ? 's' : ''} could not be fetched for review.` : '',
    aiConfidence === null ? 'The model did not report a confidence score for this review.' : '',
  ].filter(Boolean);

  return {
    aiStatus: 'AI_REVIEWED',
    aiSummary: summaryText.slice(0, 500),
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
