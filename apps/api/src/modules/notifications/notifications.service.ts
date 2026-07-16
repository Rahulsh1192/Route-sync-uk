import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type NotificationChannel = 'push' | 'email' | 'in_app';

export interface SendNotificationParams {
  userId: string;
  channel: NotificationChannel;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /** Register a device push token for a user. */
  async registerDevice(userId: string, platform: 'ios' | 'android', token: string) {
    await this.prisma.$executeRaw`
      INSERT INTO device_tokens (id, user_id, platform, token)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${platform}, ${token})
      ON CONFLICT (token) DO UPDATE SET user_id = ${userId}::uuid
    `;
    return { ok: true };
  }

  /** Unregister a device token (e.g. on logout). */
  async unregisterDevice(token: string) {
    await this.prisma.$executeRaw`DELETE FROM device_tokens WHERE token = ${token}`;
    return { ok: true };
  }

  /** Send an in-app notification (persisted to DB; push/email handled by queue in production). */
  async send(params: SendNotificationParams) {
    const { userId, channel, title, body, data } = params;

    await this.prisma.$executeRaw`
      INSERT INTO notifications (id, user_id, channel, title, body, data)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${channel}::notification_channel,
              ${title}, ${body ?? null}, ${JSON.stringify(data ?? {})}::jsonb)
    `;

    // In production: push to FCM/APNs via BullMQ job here.
    // For now, log it.
    this.logger.log(`Notification [${channel}] → user ${userId}: ${title}`);
    return { ok: true };
  }

  /** Get unread notifications for a user. */
  async getNotifications(userId: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT * FROM notifications
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 30
    `;
  }

  /** Mark a notification as read. */
  async markRead(userId: string, notificationId: string) {
    await this.prisma.$executeRaw`
      UPDATE notifications SET read_at = now()
      WHERE id = ${notificationId}::uuid AND user_id = ${userId}::uuid
    `;
    return { ok: true };
  }

  // ── Booking notification helpers ──────────────────────────────────────────

  async notifyBookingConfirmed(learnerId: string, instructorName: string, slotDate: string) {
    await this.send({
      userId: learnerId,
      channel: 'in_app',
      title: 'Booking confirmed!',
      body: `Your lesson with ${instructorName} on ${slotDate} is confirmed.`,
      data: { type: 'booking_confirmed' },
    });
  }

  async notifyBookingCancelled(userId: string, bookingDate: string, reason?: string) {
    await this.send({
      userId,
      channel: 'in_app',
      title: 'Booking cancelled',
      body: reason
        ? `Your lesson on ${bookingDate} was cancelled: ${reason}`
        : `Your lesson on ${bookingDate} has been cancelled.`,
      data: { type: 'booking_cancelled' },
    });
  }

  async notifyNewBookingRequest(instructorId: string, learnerName: string, slotDate: string) {
    await this.send({
      userId: instructorId,
      channel: 'in_app',
      title: 'New booking request',
      body: `${learnerName} wants to book a lesson on ${slotDate}.`,
      data: { type: 'booking_request' },
    });
  }
}
