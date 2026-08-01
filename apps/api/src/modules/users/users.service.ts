import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { normalisePhone } from '../../common/validation/phone';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    // Raw SQL rather than the typed client: the Phase 26 contact columns are not in the
    // generated Prisma client, and selecting them through it would fail validation.
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, email, display_name AS "displayName", avatar_url AS "avatarUrl",
             role, locale, created_at AS "createdAt",
             phone, emergency_contact_name AS "emergencyContactName",
             emergency_contact_phone AS "emergencyContactPhone"
      FROM users WHERE id = ${userId}::uuid AND deleted_at IS NULL`;
    if (!rows.length) throw new NotFoundException('User not found');
    return rows[0];
  }

  async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      avatarUrl?: string;
      phone?: string;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
    },
  ) {
    // Three distinct cases per contact field, and they must stay distinct:
    //   absent from the payload → leave the column alone
    //   present as ''          → clear it (the only way a user can withdraw a number)
    //   present with a value   → store it
    // A plain COALESCE cannot express this: it collapses "absent" and "cleared" into the
    // same NULL, so a partial form submit would silently wipe fields it never displayed.
    // Hence an explicit provided-flag alongside each value.
    const phoneGiven = data.phone !== undefined;
    const nameGiven = data.emergencyContactName !== undefined;
    const emergencyGiven = data.emergencyContactPhone !== undefined;

    await this.prisma.$executeRaw`
      UPDATE users SET
        display_name            = COALESCE(${data.displayName ?? null}, display_name),
        avatar_url              = COALESCE(${data.avatarUrl ?? null}, avatar_url),
        phone                   = CASE WHEN ${phoneGiven}
                                    THEN ${normalisePhone(data.phone)} ELSE phone END,
        emergency_contact_name  = CASE WHEN ${nameGiven}
                                    THEN ${data.emergencyContactName?.trim() || null}
                                    ELSE emergency_contact_name END,
        emergency_contact_phone = CASE WHEN ${emergencyGiven}
                                    THEN ${normalisePhone(data.emergencyContactPhone)}
                                    ELSE emergency_contact_phone END,
        updated_at              = now()
      WHERE id = ${userId}::uuid`;
    return this.me(userId);
  }

  // ---------------------------------------------------------------------------
  // Phase 19b — test details (test centre + test date)
  // Stored as history; the most recent row is the user's "current" details.
  // ---------------------------------------------------------------------------

  /** True once the user has declared their test details at least once. */
  async hasTestDetails(userId: string): Promise<boolean> {
    const n = await this.prisma.userTestDetail.count({ where: { userId } });
    return n > 0;
  }

  /** Current (latest) test details plus the full history, newest first. */
  async getTestDetails(userId: string) {
    const history = await this.prisma.userTestDetail.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, testCentreId: true, testDate: true, createdAt: true },
    });
    return { current: history[0] ?? null, history };
  }

  /** Record a new test-details entry (kept as history). */
  async addTestDetails(userId: string, testCentreId: string, testDate: string) {
    const created = await this.prisma.userTestDetail.create({
      data: { userId, testCentreId, testDate: new Date(testDate) },
      select: { id: true, testCentreId: true, testDate: true, createdAt: true },
    });
    return created;
  }

  /**
   * GDPR erasure. Records the request, anonymises PII, soft-deletes, revokes tokens.
   * Heavy artefact removal (media in R2) is delegated to an async job.
   */
  async requestErasure(userId: string) {
    await this.prisma.$transaction([
      this.prisma.dataRequest.create({ data: { userId, kind: 'erasure', status: 'pending' } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          displayName: 'Deleted user',
          avatarUrl: null,
          passwordHash: null,
          deletedAt: new Date(),
        },
      }),
    ]);
    // TODO: enqueue BullMQ job to purge media/uploads owned by this user.
    return { status: 'accepted' };
  }

  /** GDPR data export — enqueue async assembly of a downloadable package. */
  async requestExport(userId: string) {
    const req = await this.prisma.dataRequest.create({
      data: { userId, kind: 'export', status: 'pending' },
    });
    // TODO: enqueue BullMQ job to assemble export → store in R2 → set result_key.
    return { status: 'accepted', requestId: req.id };
  }
}
