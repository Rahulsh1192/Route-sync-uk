import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';

interface SummaryJob {
  userId: string;
  routeId: string;
  sessionType: 'watch' | 'practice';
}

@Processor('ai-summaries')
export class AiSummaryProcessor {
  private readonly logger = new Logger(AiSummaryProcessor.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Process('generate')
  async handle(job: Job<SummaryJob>) {
    const { userId, routeId, sessionType } = job.data;
    this.logger.log(`Generating AI summary for user=${userId} route=${routeId} type=${sessionType}`);

    try {
      // Fetch route instructions to give the LLM context
      const instructions = await this.prisma.$queryRaw<any[]>`
        SELECT type, text_ukenglish, roundabout_exit, speed_limit_mph
        FROM route_instructions
        WHERE route_id = ${routeId}::uuid
        ORDER BY seq
        LIMIT 30
      `;

      const routeInfo = await this.prisma.$queryRaw<any[]>`
        SELECT title, town, difficulty, junction_count, roundabout_count
        FROM routes WHERE id = ${routeId}::uuid
      `;

      const history = await this.prisma.$queryRaw<any[]>`
        SELECT watch_count, practice_count, watch_pct_max
        FROM user_route_history
        WHERE user_id = ${userId}::uuid AND route_id = ${routeId}::uuid
      `;

      const route = routeInfo[0];
      const hist = history[0] ?? {};

      const summary = await this.callLlm(route, instructions, hist, sessionType);

      // Upsert — one summary per user+route+sessionType
      await this.prisma.$executeRaw`
        INSERT INTO ai_summaries (id, user_id, route_id, session_type, summary_text, focus_areas, model)
        VALUES (gen_random_uuid(), ${userId}::uuid, ${routeId}::uuid,
                ${sessionType}::ai_session_type, ${summary.text}, ${JSON.stringify(summary.focusAreas)}::jsonb,
                ${summary.model})
        ON CONFLICT (user_id, route_id, session_type) DO UPDATE SET
          summary_text = EXCLUDED.summary_text,
          focus_areas  = EXCLUDED.focus_areas,
          model        = EXCLUDED.model,
          generated_at = now()
      `;

      this.logger.log(`AI summary saved for user=${userId} route=${routeId}`);
    } catch (err) {
      this.logger.error(`AI summary failed: ${(err as Error).message}`);
      throw err; // Bull will retry based on job options
    }
  }

  private async callLlm(
    route: any,
    instructions: any[],
    history: any,
    sessionType: string,
  ): Promise<{ text: string; focusAreas: any[]; model: string }> {
    const openAiKey = this.config.get<string>('OPENAI_API_KEY');

    const instructionList = instructions
      .map((i) => `- ${i.text_ukenglish}`)
      .join('\n');

    const prompt = `You are a supportive UK driving instructor assistant.
A learner just completed a ${sessionType} session on the "${route?.title ?? 'test route'}" 
in ${route?.town ?? 'the UK'} (${route?.difficulty ?? 'test standard'} difficulty).
Route has ${route?.junction_count ?? 0} junctions and ${route?.roundabout_count ?? 0} roundabouts.
They have practised this route ${history.practice_count ?? 0} times and watched it ${history.watch_count ?? 0} times.

Turn-by-turn instructions:
${instructionList}

Write a short, encouraging learning summary (3-4 sentences) highlighting:
1. The most important junctions or manoeuvres to remember
2. One specific tip to improve
3. Encouragement for their next session

Then provide 2-3 focus areas as a JSON array: [{"area": "...", "tip": "..."}]

Format your response as JSON: {"summary": "...", "focusAreas": [...]}`;

    if (!openAiKey) {
      // Fallback when no API key configured
      return {
        text: `Great work on your ${sessionType} session for ${route?.title ?? 'this route'}! Focus on the key junctions and roundabouts as you continue practising. Each repetition builds confidence — keep going!`,
        focusAreas: [
          { area: 'Roundabout exits', tip: 'Count the exits before entering to stay calm.' },
          { area: 'Junction observations', tip: 'Always check mirrors before signalling at junctions.' },
        ],
        model: 'fallback',
      };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      text: parsed.summary,
      focusAreas: parsed.focusAreas ?? [],
      model: 'gpt-4o-mini',
    };
  }
}
