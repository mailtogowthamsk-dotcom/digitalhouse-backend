import { Op } from "sequelize";
import {
  SupportTicket,
  SupportTicketMessage,
  SupportFaq,
  SupportGuide,
  SupportGuideStep,
  SupportContactConfig,
  User
} from "../models";
import {
  DEFAULT_SUPPORT_FAQS,
  DEFAULT_SUPPORT_GUIDES,
  SUPPORT_STATUS_LABELS,
  type SupportTicketStatus,
  type SupportTicketType,
  type SupportBugCategory,
  type SupportPriority
} from "../constants/support.constants";
import { NOTIFICATION_ACTIONS, NOTIFICATION_TYPES } from "../constants/notification.constants";
import { dispatchNotification } from "./NotificationPlatform.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";

function err(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

async function ensureSeedContent(): Promise<void> {
  const faqCount = await SupportFaq.count();
  if (faqCount === 0) {
    await SupportFaq.bulkCreate(
      DEFAULT_SUPPORT_FAQS.map((f) => ({
        ...f,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      })) as any
    );
  }

  const guideCount = await SupportGuide.count();
  if (guideCount === 0) {
    for (const g of DEFAULT_SUPPORT_GUIDES) {
      const guide = await SupportGuide.create({
        title: g.title,
        summary: g.summary,
        sortOrder: g.sortOrder,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);
      for (const step of g.steps) {
        await SupportGuideStep.create({
          guideId: guide.id,
          title: step.title,
          body: step.body,
          sortOrder: step.sortOrder,
          imageUrl: null,
          createdAt: new Date(),
          updatedAt: new Date()
        } as any);
      }
    }
  }

  const cfg = await SupportContactConfig.findByPk(1);
  if (!cfg) {
    await SupportContactConfig.create({
      id: 1,
      email: null,
      whatsappNumber: null,
      phoneNumber: null,
      chatEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      callEnabled: false,
      supportNote: "Our team usually responds within 1–2 business days.",
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
  }
}

function ticketRef(id: number): string {
  return `#${id}`;
}

async function toTicketDto(ticket: SupportTicket, includeMessages = false) {
  const [screenshotUrl, recordingUrl] = await Promise.all([
    toSignedUrlIfR2(ticket.screenshotUrl),
    toSignedUrlIfR2(ticket.recordingUrl)
  ]);

  let messages: Array<{
    id: number;
    authorType: string;
    authorUserId: number | null;
    body: string;
    createdAt: string;
  }> = [];

  if (includeMessages) {
    const rows = await SupportTicketMessage.findAll({
      where: { ticketId: ticket.id },
      order: [["createdAt", "ASC"]]
    });
    messages = rows.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorUserId: m.authorUserId,
      body: m.body,
      createdAt: m.createdAt.toISOString()
    }));
  }

  return {
    id: ticket.id,
    ref: ticketRef(ticket.id),
    userId: ticket.userId,
    type: ticket.type,
    category: ticket.category,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    screenshotUrl: screenshotUrl ?? ticket.screenshotUrl,
    recordingUrl: recordingUrl ?? ticket.recordingUrl,
    metadata: ticket.metadata,
    assignedAdminId: ticket.assignedAdminId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
    messages
  };
}

export async function getSupportHome(userId: number) {
  await ensureSeedContent();
  const openCount = await SupportTicket.count({
    where: {
      userId,
      status: { [Op.notIn]: ["CLOSED", "RESOLVED", "REJECTED", "RELEASED"] }
    }
  });
  return {
    openTicketCount: openCount,
    sections: [
      { id: "faqs", title: "FAQs", subtitle: "Common answers" },
      { id: "guides", title: "How-to Guides", subtitle: "Step-by-step help" },
      { id: "contact", title: "Contact Support", subtitle: "Email, chat, WhatsApp" },
      { id: "bug", title: "Report a Bug", subtitle: "Tell us what broke" },
      { id: "feature", title: "Request a Feature", subtitle: "Share your ideas" },
      { id: "question", title: "Ask a Question", subtitle: "Get help from the team" },
      { id: "tickets", title: "Track My Requests", subtitle: openCount ? `${openCount} open` : "View status" }
    ]
  };
}

export async function listFaqs() {
  await ensureSeedContent();
  const rows = await SupportFaq.findAll({
    where: { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"]
    ]
  });
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    category: r.category
  }));
}

export async function listGuides() {
  await ensureSeedContent();
  const rows = await SupportGuide.findAll({
    where: { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"]
    ]
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary
  }));
}

export async function getGuide(guideId: number) {
  await ensureSeedContent();
  const guide = await SupportGuide.findOne({ where: { id: guideId, isActive: true } });
  if (!guide) err("Guide not found", 404);
  const steps = await SupportGuideStep.findAll({
    where: { guideId },
    order: [["sortOrder", "ASC"]]
  });
  const mappedSteps = await Promise.all(
    steps.map(async (s) => ({
      id: s.id,
      sortOrder: s.sortOrder,
      title: s.title,
      body: s.body,
      imageUrl: (await toSignedUrlIfR2(s.imageUrl)) ?? s.imageUrl
    }))
  );
  return {
    id: guide.id,
    title: guide.title,
    summary: guide.summary,
    steps: mappedSteps
  };
}

export async function getContactConfig() {
  await ensureSeedContent();
  const cfg = await SupportContactConfig.findByPk(1);
  return {
    email: cfg?.email ?? null,
    whatsappNumber: cfg?.whatsappNumber ?? null,
    phoneNumber: cfg?.phoneNumber ?? null,
    chatEnabled: cfg?.chatEnabled ?? true,
    emailEnabled: cfg?.emailEnabled ?? true,
    whatsappEnabled: cfg?.whatsappEnabled ?? false,
    callEnabled: cfg?.callEnabled ?? false,
    supportNote: cfg?.supportNote ?? null
  };
}

export type CreateTicketInput = {
  type: SupportTicketType;
  category?: SupportBugCategory | null;
  title: string;
  description: string;
  screenshotUrl?: string | null;
  recordingUrl?: string | null;
  priority?: SupportPriority;
  metadata?: Record<string, unknown> | null;
};

export async function createTicket(userId: number, input: CreateTicketInput) {
  const user = await User.findByPk(userId, {
    attributes: ["id", "fullName", "community", "username"]
  });
  if (!user) err("User not found", 404);

  const metadata = {
    ...(input.metadata ?? {}),
    userId,
    community: (input.metadata as any)?.community ?? user.community ?? null,
    submittedAt: new Date().toISOString()
  };

  const ticket = await SupportTicket.create({
    userId,
    type: input.type,
    category: input.type === "BUG" ? input.category ?? "OTHER" : input.category ?? null,
    title: input.title.trim(),
    description: input.description.trim(),
    status: "OPEN",
    priority: input.priority ?? "NORMAL",
    screenshotUrl: input.screenshotUrl?.trim() || null,
    recordingUrl: input.recordingUrl?.trim() || null,
    metadata,
    assignedAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null
  } as any);

  await SupportTicketMessage.create({
    ticketId: ticket.id,
    authorType: "USER",
    authorUserId: userId,
    body: input.description.trim(),
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);

  return toTicketDto(ticket, true);
}

export async function listMyTickets(userId: number) {
  const rows = await SupportTicket.findAll({
    where: { userId },
    order: [["updatedAt", "DESC"]],
    limit: 100
  });
  return Promise.all(rows.map((t) => toTicketDto(t, false)));
}

export async function getMyTicket(userId: number, ticketId: number) {
  const ticket = await SupportTicket.findOne({ where: { id: ticketId, userId } });
  if (!ticket) err("Ticket not found", 404);
  return toTicketDto(ticket, true);
}

export async function replyAsUser(userId: number, ticketId: number, body: string) {
  const ticket = await SupportTicket.findOne({ where: { id: ticketId, userId } });
  if (!ticket) err("Ticket not found", 404);
  if (ticket.status === "CLOSED") err("This ticket is closed.", 400);

  await SupportTicketMessage.create({
    ticketId,
    authorType: "USER",
    authorUserId: userId,
    body: body.trim(),
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);

  if (ticket.status === "RESOLVED" || ticket.status === "REJECTED") {
    await ticket.update({ status: "OPEN", updatedAt: new Date() } as any);
  } else {
    await ticket.update({ updatedAt: new Date() } as any);
  }

  return getMyTicket(userId, ticketId);
}

// ——— Admin ———

export async function adminListTickets(filters: {
  status?: string;
  type?: string;
  category?: string;
  priority?: string;
  q?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.category) where.category = filters.category;
  if (filters.priority) where.priority = filters.priority;
  if (filters.q?.trim()) {
    where[Op.or as any] = [
      { title: { [Op.like]: `%${filters.q.trim()}%` } },
      { description: { [Op.like]: `%${filters.q.trim()}%` } }
    ];
  }

  const { rows, count } = await SupportTicket.findAndCountAll({
    where,
    order: [["updatedAt", "DESC"]],
    offset: (page - 1) * limit,
    limit
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await User.findAll({
        where: { id: userIds },
        attributes: ["id", "fullName", "username", "email", "community"]
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items = await Promise.all(
    rows.map(async (t) => {
      const dto = await toTicketDto(t, false);
      const u = userMap.get(t.userId);
      return {
        ...dto,
        user: u
          ? {
              id: u.id,
              fullName: u.fullName,
              username: u.username,
              email: u.email,
              community: u.community
            }
          : null
      };
    })
  );

  return { items, page, limit, total: count };
}

export async function adminGetTicket(ticketId: number) {
  const ticket = await SupportTicket.findByPk(ticketId);
  if (!ticket) err("Ticket not found", 404);
  const dto = await toTicketDto(ticket, true);
  const u = await User.findByPk(ticket.userId, {
    attributes: ["id", "fullName", "username", "email", "community", "mobile"]
  });
  return {
    ...dto,
    user: u
      ? {
          id: u.id,
          fullName: u.fullName,
          username: u.username,
          email: u.email,
          community: u.community,
          mobile: u.mobile
        }
      : null
  };
}

export async function adminUpdateTicket(
  adminUserId: number | null,
  ticketId: number,
  patch: {
    status?: SupportTicketStatus;
    priority?: SupportPriority;
    assignedAdminId?: number | null;
    reply?: string;
  }
) {
  const ticket = await SupportTicket.findByPk(ticketId);
  if (!ticket) err("Ticket not found", 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.priority) updates.priority = patch.priority;
  if (patch.assignedAdminId !== undefined) {
    updates.assignedAdminId = patch.assignedAdminId ?? adminUserId;
  } else if (adminUserId != null && !ticket.assignedAdminId) {
    updates.assignedAdminId = adminUserId;
  }
  if (patch.status) {
    updates.status = patch.status;
    if (["RESOLVED", "CLOSED", "RELEASED", "REJECTED"].includes(patch.status)) {
      updates.resolvedAt = new Date();
    }
  }
  await ticket.update(updates as any);

  if (patch.reply?.trim()) {
    await SupportTicketMessage.create({
      ticketId,
      authorType: "ADMIN",
      authorUserId: adminUserId,
      body: patch.reply.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    await dispatchNotification({
      userId: ticket.userId,
      type: NOTIFICATION_TYPES.SYSTEM_GENERIC,
      title: "Your support ticket was updated",
      body: `Ticket ${ticketRef(ticket.id)}: ${patch.reply.trim().slice(0, 120)}`,
      actionType: NOTIFICATION_ACTIONS.OPEN_SUPPORT_TICKET,
      actionTargetId: String(ticket.id),
      force: true
    });
  } else if (patch.status) {
    await dispatchNotification({
      userId: ticket.userId,
      type: NOTIFICATION_TYPES.SYSTEM_GENERIC,
      title: "Support ticket status changed",
      body: `Ticket ${ticketRef(ticket.id)} is now ${SUPPORT_STATUS_LABELS[patch.status]}.`,
      actionType: NOTIFICATION_ACTIONS.OPEN_SUPPORT_TICKET,
      actionTargetId: String(ticket.id),
      force: true
    });
  }

  return adminGetTicket(ticketId);
}

export async function adminListFaqs() {
  await ensureSeedContent();
  return SupportFaq.findAll({ order: [["sortOrder", "ASC"]] });
}

export async function adminUpsertFaq(id: number | null, data: {
  question: string;
  answer: string;
  category?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  if (id) {
    const row = await SupportFaq.findByPk(id);
    if (!row) err("FAQ not found", 404);
    await row.update({
      question: data.question,
      answer: data.answer,
      category: data.category ?? row.category,
      sortOrder: data.sortOrder ?? row.sortOrder,
      isActive: data.isActive ?? row.isActive
    } as any);
    return row;
  }
  return SupportFaq.create({
    question: data.question,
    answer: data.answer,
    category: data.category ?? "General",
    sortOrder: data.sortOrder ?? 0,
    isActive: data.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);
}

export async function adminDeleteFaq(id: number) {
  const row = await SupportFaq.findByPk(id);
  if (!row) err("FAQ not found", 404);
  await row.destroy();
  return { ok: true };
}

export async function adminListGuides() {
  await ensureSeedContent();
  const guides = await SupportGuide.findAll({ order: [["sortOrder", "ASC"]] });
  return Promise.all(
    guides.map(async (g) => {
      const steps = await SupportGuideStep.count({ where: { guideId: g.id } });
      return { ...g.toJSON(), stepCount: steps };
    })
  );
}

export async function adminUpsertGuide(
  id: number | null,
  data: {
    title: string;
    summary?: string | null;
    sortOrder?: number;
    isActive?: boolean;
    steps?: Array<{ title: string; body: string; imageUrl?: string | null; sortOrder?: number }>;
  }
) {
  let guide: SupportGuide;
  if (id) {
    const existing = await SupportGuide.findByPk(id);
    if (!existing) err("Guide not found", 404);
    await existing.update({
      title: data.title,
      summary: data.summary ?? existing.summary,
      sortOrder: data.sortOrder ?? existing.sortOrder,
      isActive: data.isActive ?? existing.isActive
    } as any);
    guide = existing;
  } else {
    guide = await SupportGuide.create({
      title: data.title,
      summary: data.summary ?? null,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
  }

  if (data.steps) {
    await SupportGuideStep.destroy({ where: { guideId: guide.id } });
    for (let i = 0; i < data.steps.length; i++) {
      const s = data.steps[i];
      await SupportGuideStep.create({
        guideId: guide.id,
        title: s.title,
        body: s.body,
        imageUrl: s.imageUrl ?? null,
        sortOrder: s.sortOrder ?? i + 1,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);
    }
  }

  return getGuide(guide.id);
}

export async function adminDeleteGuide(id: number) {
  const guide = await SupportGuide.findByPk(id);
  if (!guide) err("Guide not found", 404);
  await SupportGuideStep.destroy({ where: { guideId: id } });
  await guide.destroy();
  return { ok: true };
}

export async function adminGetContactConfig() {
  return getContactConfig();
}

export async function adminUpdateContactConfig(patch: Record<string, unknown>) {
  await ensureSeedContent();
  const cfg = await SupportContactConfig.findByPk(1);
  if (!cfg) err("Config not found", 404);
  await cfg.update({ ...patch, updatedAt: new Date() } as any);
  return getContactConfig();
}

export const supportService = {
  getSupportHome,
  listFaqs,
  listGuides,
  getGuide,
  getContactConfig,
  createTicket,
  listMyTickets,
  getMyTicket,
  replyAsUser,
  adminListTickets,
  adminGetTicket,
  adminUpdateTicket,
  adminListFaqs,
  adminUpsertFaq,
  adminDeleteFaq,
  adminListGuides,
  adminUpsertGuide,
  adminDeleteGuide,
  adminGetContactConfig,
  adminUpdateContactConfig
};
