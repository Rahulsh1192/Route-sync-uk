import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        locale: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { displayName?: string; avatarUrl?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, displayName: true, avatarUrl: true },
    });
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
