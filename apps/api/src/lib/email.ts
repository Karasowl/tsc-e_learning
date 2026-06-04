import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";

export type EmailMessage = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerId?: string }>;
}

export class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly config: AppConfig["smtp"]) {}

  async send(message: EmailMessage): Promise<{ providerId?: string }> {
    if (!this.config.host || !this.config.user || !this.config.password) {
      throw new Error("SMTP is not configured");
    }

    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      auth: {
        user: this.config.user,
        pass: this.config.password
      }
    });

    const result = await transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text
    });

    return { providerId: result.messageId };
  }
}
