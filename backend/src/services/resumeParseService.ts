import prisma from '@config/database';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

interface ExtractedResume {
  parsedSkills: string[];
  yearsOfExperience: number | null;
  masteryLevel: string | null;
  tradeCategory: string | null;
  summary: string | null;
}

/**
 * Downloads a worker's uploaded resume (PDF) and asks Claude to extract
 * structured skill/experience data from it, then persists the result.
 * Mirrors the Anthropic call pattern in verificationAiService.ts, but
 * targets a PDF document block instead of images (resumes are PDF-only,
 * see mobile/utils/kycDocumentConfig.ts).
 */
export async function parseWorkerResume(workerProfileId: string, resumeUrl: string) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Resume parsing is not configured (ANTHROPIC_API_KEY missing)');
  }

  const fileResponse = await fetch(resumeUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to fetch resume file (status ${fileResponse.status})`);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());

  const prompt = `Extract structured information from this worker's resume/CV for a Philippines household-services marketplace (trades like plumbing, electrical, aircon repair, cleaning, carpentry, painting, gardening, appliance repair). Respond with ONLY a JSON object — no markdown code fences, no commentary — matching exactly this shape:
{
  "parsedSkills": string[],
  "yearsOfExperience": number | null,
  "masteryLevel": "Beginner" | "Intermediate" | "Advanced" | "Expert" | null,
  "tradeCategory": string | null,
  "summary": string
}
"parsedSkills" should be concise skill names (e.g. "Pipe Installation", "Leak Detection"). "yearsOfExperience" is your best estimate of total relevant work experience. "summary" is a 2-3 sentence professional summary. If the document isn't a resume/CV or has no usable information, return an empty array for parsedSkills, null for the other fields, and say so in "summary".`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
            },
          ],
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

  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Anthropic returned no usable content');
  }

  const jsonText = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Could not parse structured data from AI response');
  }

  const extracted = normalizeExtractedResume(parsed);

  return prisma.resumeParseResult.upsert({
    where: { workerProfileId },
    update: { ...extracted, parsedAt: new Date(), modelUsed: ANTHROPIC_MODEL },
    create: { workerProfileId, ...extracted, modelUsed: ANTHROPIC_MODEL },
  });
}

function normalizeExtractedResume(raw: unknown): ExtractedResume {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  return {
    parsedSkills: Array.isArray(obj.parsedSkills)
      ? obj.parsedSkills.filter((s): s is string => typeof s === 'string')
      : [],
    yearsOfExperience: typeof obj.yearsOfExperience === 'number' ? obj.yearsOfExperience : null,
    masteryLevel: typeof obj.masteryLevel === 'string' ? obj.masteryLevel : null,
    tradeCategory: typeof obj.tradeCategory === 'string' ? obj.tradeCategory : null,
    summary: typeof obj.summary === 'string' ? obj.summary : null,
  };
}
