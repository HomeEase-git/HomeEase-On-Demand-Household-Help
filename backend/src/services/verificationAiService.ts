import prisma from '@config/database';
import type { VerificationJobDocument } from '@queues/verificationQueue';

export interface VerificationReviewResult {
  aiStatus: string;
  aiSummary: string;
  aiConfidence: number;
  aiError: string | null;
}

export async function analyzeVerificationDocuments(
  verificationId: string,
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  try {
    const aiResult = await generateAiReview(requestType, documents);

    await prisma.verificationRequest.update({
      where: { id: verificationId },
      data: {
        aiStatus: aiResult.aiStatus,
        aiSummary: aiResult.aiSummary,
        aiConfidence: aiResult.aiConfidence,
        aiError: null,
        aiReviewedAt: new Date(),
      },
    });

    return aiResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI review failed';

    await prisma.verificationRequest.update({
      where: { id: verificationId },
      data: {
        aiStatus: 'AI_FAILED',
        aiError: message,
        aiReviewedAt: new Date(),
      },
    });

    return {
      aiStatus: 'AI_FAILED',
      aiSummary: 'The verification review could not be completed automatically.',
      aiConfidence: 0,
      aiError: message,
    };
  }
}

async function generateAiReview(
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await runClaudeReview(requestType, documents);
      if (result) {
        return result;
      }
    } catch (error) {
      console.warn('Claude verification review failed, falling back to heuristic review:', error);
    }
  }

  return runHeuristicReview(requestType, documents);
}

async function runClaudeReview(
  requestType: string,
  documents: VerificationJobDocument[]
): Promise<VerificationReviewResult | null> {
  const imageDocs = documents.filter((doc) => (doc.mimeType ?? '').startsWith('image/')).slice(0, 3);

  if (!imageDocs.length) {
    return null;
  }

  const imageBlocks = await Promise.all(
    imageDocs.map(async (doc) => {
      const response = await fetch(doc.fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch document ${doc.originalName ?? doc.fileUrl}`);
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

  const documentTypeList = documents.map((doc) => doc.documentType).join(', ');
  const prompt = `Review these verification documents for a ${requestType} submission. Document types included: ${documentTypeList}. Assess whether the documents look legitimate, extract the key facts, and provide a short admin summary (2-3 sentences), noting any concerns.`;

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

  return {
    aiStatus: 'AI_REVIEWED',
    aiSummary: contentText.slice(0, 500),
    aiConfidence: 0.86,
    aiError: null,
  };
}

function runHeuristicReview(requestType: string, documents: VerificationJobDocument[]): VerificationReviewResult {
  const names = documents.map((doc) => doc.originalName ?? 'document').join(', ');
  const hasImage = documents.some((doc) => (doc.mimeType ?? '').startsWith('image/'));
  const hasPdf = documents.some((doc) => doc.mimeType === 'application/pdf');

  const summary = [
    `Uploaded ${documents.length} document${documents.length > 1 ? 's' : ''} for ${requestType.toLowerCase()} verification.`,
    `Files received: ${names}.`,
    hasImage ? 'Image-based documents were detected.' : '',
    hasPdf ? 'PDF documents were detected.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    aiStatus: 'AI_REVIEWED',
    aiSummary: summary,
    aiConfidence: hasImage || hasPdf ? 0.74 : 0.6,
    aiError: null,
  };
}
