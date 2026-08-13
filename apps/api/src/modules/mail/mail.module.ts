import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Transactional email. Exported rather than global so that the modules which send mail
 * have to say so in their imports — there are two such emails today and the list of
 * things that can email a user is worth keeping visible.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
