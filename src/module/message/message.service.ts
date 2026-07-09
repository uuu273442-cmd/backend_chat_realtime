import {
    ConflictException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException
} from "@nestjs/common";
import {InjectModel} from "@nestjs/mongoose";
import {Model, Types} from "mongoose";

import {CreateCallMessageDto} from "./dto/callMessage.dto";

import {Message, MessageDocument} from "./schema/message.schema";
import {ConversationService} from "../conversation/conversation.service";
import {ChatGateway} from "../../gateway/chat.gateway";
import {AttachmentService} from "../attachment/attachment.service";
import {LinkPreviewService} from "../link-preview/link-preview.service";
import {UserService} from "../user/user.service";

import {convertStringToObjectId} from "../../shared/helpers/convertObjectId.helpers";
import {extractValidUrls} from "../../shared/utils/extractUrl.util";

import {RedisCacheService} from "../../shared/redis/redisCache.service";

import {JwtType} from "../../shared/types/jwtTypes.type";
import { AttachmentDocument } from "../attachment/schema/attachment.schema";

@Injectable()
export class MessageService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationService))
        private readonly conversationService: ConversationService,
        private readonly attachmentService: AttachmentService,
        private readonly linkPreviewService: LinkPreviewService,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
        private readonly redisCacheService: RedisCacheService,
    ) {
    }

    private async buildReplyTo(replyTo?: string) {
        if (!replyTo) return undefined;
        const message = await this.messageModel.findById(
            convertStringToObjectId(replyTo),
            {_id: 1}
        );
        if (!message) throw new NotFoundException("Reply message not found");
        return convertStringToObjectId(replyTo);
    }

    /**
     * Invalidate toàn bộ cache liên quan đến conversation:
     * - Message pages của conversation
     * - Conversation list của tất cả participants
     *
     * Tất cả lỗi cache đều bị nuốt — không để ảnh hưởng flow chính.
     */
    private async invalidateAll(conversationId: string): Promise<void> {
        try {
            // 1. Xoá tất cả message pages của conversation này
            await this.redisCacheService.invalidateMessages(conversationId);
 
            // 2. Xoá conversation list cache của tất cả participants
            const conversation = await this.conversationService.findConversation(conversationId);
            const participantIds = conversation.participants.map((p) => p.userId.toString());
            await this.redisCacheService.invalidateConversationsMany(participantIds);
        } catch {
            // Không để lỗi cache làm hỏng flow chính
        }
    }
 
    // ─── Gửi message text ────────────────────────────────────────────────────

    private getArrayPopulate() {
        return [
            {path: "senderId", select: "name avatar"},
            {
                path: "replyTo", select: "content senderId",
                populate: {path: "senderId", select: "name avatar"}
            },
            {path: "seenBy", select: "name avatar"}
        ]
    }

    public async create(
        userId: string,
        conversationId: string,
        content: string,
        replyTo?: string,
        mentions?: string[],
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        const senderId = convertStringToObjectId(userId);

        const replyToObjectId = await this.buildReplyTo(replyTo);
        const validateMentions = await this.conversationService.validateMentions(
            conversationId, mentions
        );

        const message = await this.messageModel.create({
            conversationId: convObjectId,
            senderId,
            seenBy: [senderId],
            type: "text",
            content,
            mentions: validateMentions,
            ...(replyToObjectId && {replyTo: replyToObjectId}),
        });
        await message.populate(this.getArrayPopulate());

        await this.conversationService.updateConversation(conversationId, message.id);
        await this.invalidateAll(conversationId);

        this.chatGateway.emitNewMessage(conversationId, message);

        const urls = extractValidUrls(content);
        if (urls.length) {
            const getLinks = (
                await Promise.all(
                    urls.map((url) => 
                        this.linkPreviewService.fetchLink(
                            url, message.id, conversationId, userId
                        )
                    ),
                )
            ).filter(Boolean);
            if (getLinks.length) {
                this.chatGateway.emitNewMessageLinkPreview(conversationId, getLinks);
            }
        }
        if (mentions?.length) {
            this.chatGateway.emitMentions(validateMentions, {
                message,
                conversation: conversationId,
                mentions: mentions || [],
            });
        }
        return {message};
    }

    // ─── CALL MESSAGE ────────────────────────────────────────────────────────
 
    /**
     * Tạo message loại "call" để lưu lịch sử cuộc gọi vào conversation.
     *
     * Được gọi từ ChatGateway tại các thời điểm:
     *   - call_end      → status "ended",     có duration
     *   - call_reject   → status "missed"
     *   - call_cancel   → status "cancelled"
     *   - handleDisconnect (crash) → status "ended" nếu đang call, "missed" nếu chưa bắt máy
     *
     * Sau khi lưu, emit socket event "new_message_call" đến tất cả members của conversation
     * để frontend hiển thị message trong chat list ngay lập tức.
     */
    public async createCallMessage(dto: CreateCallMessageDto): Promise<MessageDocument> {
        console.log('[createCallMessage] called with:', JSON.stringify(dto));
        const {
            conversationId,
            callerId,
            callType,
            status,
            duration,
            startedAt, 
            endedAt,
            participantIds = [],
        } = dto;
 
        const convObjectId = convertStringToObjectId(conversationId);
        const senderObjectId = convertStringToObjectId(callerId);
 
        // Tất cả participants đều đã seen message này (họ đã tham gia cuộc gọi)
        const seenByIds = participantIds.map((id) => convertStringToObjectId(id));
        if (!seenByIds.some((id) => id.equals(senderObjectId))) {
            seenByIds.push(senderObjectId);
        }
 
        // Tạo content hiển thị dựa trên status
        const contentMap: Record<string, string> = {
            ended: callType === "video" ? "Cuộc gọi video" : "Cuộc gọi thoại",
            missed: callType === "video" ? "Cuộc gọi video nhỡ" : "Cuộc gọi thoại nhỡ",
            cancelled: callType === "video" ? "Cuộc gọi video đã huỷ" : "Cuộc gọi thoại đã huỷ",
        };
 
        const message = await this.messageModel.create({
            conversationId: convObjectId,
            senderId: senderObjectId,
            type: "call",
            content: contentMap[status],
            seenBy: seenByIds,
            callInfo: {
                callType,
                status,
                duration: status === "ended" ? (duration ?? null) : null,
                startedAt: status === "ended" ? (startedAt ?? null) : null,
                endedAt: endedAt ?? new Date(),
                participants: seenByIds,
            },
        });
 
        // Populate senderId để frontend có name/avatar
        await message.populate([
            {path: "senderId", select: "name avatar"},
            {path: "callInfo.participants", select: "name avatar"},
        ]);
 
        // Cập nhật lastMessage của conversation
        await this.conversationService.updateConversation(conversationId, message.id);
 
        // Emit socket event đến tất cả members đang online trong conversation
        this.chatGateway.emitNewMessageCall(conversationId, message);
 
        // Invalidate cache — conversation list cần refresh vì lastMessage thay đổi
        await this.invalidateAll(conversationId);
 
        return message;
    }

    // ─── Search ──────────────────────────────────────────────────────────────

    public async search(q: string, conversationId: string) {
        const conversationObjectId = convertStringToObjectId(conversationId);

        if (!q || !q.trim().length) {
            return [];
        }
        const res = await this.messageModel.find(
            {
                $text: {$search: q},
                conversationId: conversationObjectId,
                isDeleted: true
            },
            {score: {$meta: "textScore"}}
        )
            .sort({score: {$meta: "textScore"}})
            .limit(20);
        return res;
    }

    // ─── Pin / Unpin ─────────────────────────────────────────────────────────

    public async pin(
        messageId: string,
        userId: string,
        conversationId: string
    ) {
        const mgs = await this.messageModel.findById(convertStringToObjectId(messageId));
        if (!mgs) throw new NotFoundException("Message not found");
        if (mgs.isPinned) throw new ForbiddenException("Message already pinned");

        mgs.isPinned = true;
        mgs.pinByUser = convertStringToObjectId(userId);
        mgs.pinnedAt = new Date();
        await mgs.save();

        this.chatGateway.emitMessagePinned(conversationId, {
            messageId: mgs.id,
            isPinned: true,
            pinByUser: mgs.pinByUser,
            pinnedAt: mgs.pinnedAt.toISOString(),
        });

        // [CACHE] Invalidate vì isPinned của message thay đổi
        await this.redisCacheService.invalidateMessages(conversationId);
        return mgs;
    }

    public async unpin(
        messageId: string,
        userId: string,
        conversationId: string
    ) {
        const mgs = await this.messageModel.findById(convertStringToObjectId(messageId));
        if (!mgs) throw new NotFoundException("Message not found");
        if (!mgs.isPinned) throw new ForbiddenException("Message already not pinned");
        if (!mgs.pinByUser || mgs.pinByUser.toString() !== userId) {
            throw new ForbiddenException("You are not user pin this message!")
        }
        mgs.isPinned = false;
        mgs.pinByUser = null;
        mgs.pinnedAt = undefined;
        await mgs.save();

        this.chatGateway.emitMessageUnpinned(conversationId, {
            messageId: mgs.id,
            isPinned: false,
            pinByUser: null,
            pinnedAt: null,
        });

        // [CACHE] Invalidate vì isPinned của message thay đổi
        await this.redisCacheService.invalidateMessages(conversationId);
        return mgs;
    }

    // ─── Upload files / media / voice ────────────────────────────────────────

    public async uploadFiles(
        files: Express.Multer.File[],
        conversationId: string,
        userId: string,
        replyTo?: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        const senderId = convertStringToObjectId(userId);

        const replyToObjectId = await this.buildReplyTo(replyTo);

        const message = await this.messageModel.create({
            conversationId: convObjectId,
            senderId,
            seenBy: [senderId],
            type: "file",
            ...(replyToObjectId && {replyTo: replyToObjectId}),
        });
        await message.populate(this.getArrayPopulate());

        const attachments = await this.attachmentService.uploadFiles(
            files,
            message.id,
            userId,
            conversationId
        );
        this.chatGateway.emitNewMessageFiles(conversationId, {message, attachments});
        await this.conversationService.updateConversation(conversationId, message.id);

        // [CACHE] Invalidate
        await this.invalidateAll(conversationId);
        return {message, attachments};
    }

    public async uploadMedias(
        files: Express.Multer.File[],
        conversationId: string,
        userId: string,
        replyTo?: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        const senderId = convertStringToObjectId(userId);
        const replyToObjectId = await this.buildReplyTo(replyTo);

        const message = await this.messageModel.create({
            conversationId: convObjectId,
            senderId,
            seenBy: [senderId],
            type: "media",
            ...(replyToObjectId && {replyTo: replyToObjectId}),
        });
        await message.populate(this.getArrayPopulate());

        const attachments = await this.attachmentService.uploadMedias(
            files, message.id, userId, conversationId
        );
        this.chatGateway.emitNewMessageMedias(conversationId, {message, attachments});
        await this.conversationService.updateConversation(conversationId, message.id);

        // [CACHE] Invalidate
        await this.invalidateAll(conversationId);
        return {message, attachments};
    }

    public async uploadVoice(
        file: Express.Multer.File,
        conversationId: string,
        userId: string,
        replyTo?: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        const senderId = convertStringToObjectId(userId);

        const replyToObjectId = await this.buildReplyTo(replyTo);

        const message = await this.messageModel.create({
            conversationId: convObjectId,
            senderId,
            seenBy: [senderId],
            type: "voice",
            ...(replyToObjectId && {replyTo: replyToObjectId}),
        });
        await message.populate(this.getArrayPopulate());

        // attachmentService.uploadVoice() trả về 1 document đơn (không phải mảng)
        // — bọc mảng ở đây để nhất quán với uploadFiles/uploadMedias và khớp với
        // format FE mong đợi (msg.attachments[0]), tránh bug hiện bubble rỗng
        // cho tới khi user refresh trang
        const voiceAttachment = await this.attachmentService.uploadVoice(
            file, message.id, userId, conversationId
        );
        const attachments = [voiceAttachment];

        this.chatGateway.emitNewMessageVoice(conversationId, {message, attachments});
        await this.conversationService.updateConversation(conversationId, message.id);

        // [CACHE] Invalidate
        await this.invalidateAll(conversationId);
        return {message, attachments};
    }

    // ─── Edit ────────────────────────────────────────────────────────────────

    public async edit(
        userId: string,
        content: string,
        id: string
    ) {
        const message = await this.messageModel.findById(convertStringToObjectId(id));
        if (!message) throw new NotFoundException("Message not found");
        if (message.senderId.toString() !== userId) {
            throw new ForbiddenException("Can't edit message");
        }

        message.content = content;
        message.isEdited = true;
        message.editedAt = new Date();
        await message.save();

        const populated = await this.messageModel
            .findById(message._id)
            .populate([
                {path: "senderId", select: "name avatar"},
                {
                    path: "replyTo",
                    select: "content senderId",
                    populate: {path: "senderId", select: "name avatar"},
                },
                {path: "seenBy", select: "name avatar"},
            ]);

        this.chatGateway.emitMessageEdited(message.conversationId.toString(), populated);

        // [CACHE] Invalidate vì nội dung message đã thay đổi
        await this.redisCacheService.invalidateMessages(message.conversationId.toString());
        return populated;
    }

    // ─── GET messages — CACHE-ASIDE ──────────────────────────────────────────

    public async messages(
        conversationId: string,
        limit: number = 20,
        before?: string
    ) {
        // 1. Thử lấy từ cache
        const cached = await this.redisCacheService.getMessages(conversationId, limit, before);
        if (cached) return cached;
 
        // 2. Cache miss — query MongoDB
        const query: any = {conversationId: convertStringToObjectId(conversationId)};
        if (before) query._id = {$lt: convertStringToObjectId(before)};
        const messages = await this.messageModel
            .find(query)
            .populate([
                {path: "senderId", select: "name avatar"},
                {
                    path: "replyTo",
                    select: "content senderId",
                    populate: {path: "senderId", select: "name avatar"}
                },
                {path: "deletedFor", select: "name avatar"},
                {path: "seenBy", select: "name avatar"},
                 // [NEW] Populate participants của callInfo
                {path: "callInfo.participants", select: "name avatar"},
            ])
            .sort({createdAt: -1})
            .limit(limit)
            .lean();

        const messageIdsAttachments = messages
            .filter(m => ["file", "media", "voice"].includes(m.type))
            .map(m => m._id);
        const messageIds = messages.map(m => m._id);
        const forwardedMediaIds = messages
            .filter(m => ["file", "media", "voice"].includes(m.type) && m.forwardedFrom)
            .map(m => m.forwardedFrom);

        const [groupAttachments, groupLinks, forwardedAttachments] = await Promise.all([
            this.attachmentService.groupAttachmentsById(messageIdsAttachments),
            this.linkPreviewService.groupLinkPreviewsById(messageIds),
            (forwardedMediaIds.length
                ? this.attachmentService.groupAttachmentsById(forwardedMediaIds as Types.ObjectId[])
                : Promise.resolve({})) as Promise<Record<string, AttachmentDocument[]>>,
        ]);

        const enriched = messages.map(m => {
            const id = m._id.toString();
            
            // Attachments: ưu tiên theo m._id, fallback về forwardedFrom
            const attachmentSource =
                groupAttachments[id] ??
                (m.forwardedFrom
                    ? forwardedAttachments[m.forwardedFrom.toString()]
                    : undefined);

            if (attachmentSource) {
                (m as any).attachments =
                    m.type === "voice" ? [attachmentSource[0]] : attachmentSource;
            }
            if (groupLinks[id]) (m as any).linkPreviews = groupLinks[id];

            return m;
        });

        const result = {
            messages: enriched.reverse(),
            nextCursor: enriched.length ? enriched[0]._id : null,
            hasMore: enriched.length === limit,
        };
 
        // 3. Lưu vào cache 60 giây
        await this.redisCacheService.setMessages(conversationId, limit, result, before);
        return result;
    }

    // ─── findByIdCheck ───────────────────────────────────────────────────────

    public async findByIdCheck(messageId: string) {
        return this.messageModel.findById(
            convertStringToObjectId(messageId),
            {conversationId: 1}
        );
    }

    // ─── React / Unreact ─────────────────────────────────────────────────────

    public async react(
        messageId: string,
        userId: string,
        emoji: string,
    ) {
        const messageObjectId = convertStringToObjectId(messageId);
        const userObjectId = convertStringToObjectId(userId);

        const updated = await this.messageModel.updateOne(
            {_id: messageObjectId, "reactions.userId": userObjectId},
            {$set: {"reactions.$.emoji": emoji}}
        );

        if (updated.matchedCount === 0) {
            await this.messageModel.findByIdAndUpdate(
                messageObjectId,
                {$addToSet: {reactions: {userId: userObjectId, emoji}}},
            );
        }

        const messageEdit = await this.messageModel.findById(messageObjectId);
        if (!messageEdit) throw new ConflictException("message not found!");

        this.chatGateway.emitMessageReacted(messageEdit.conversationId.toString(), {
            messageId, userId, emoji, action: "add"
        });

        // [CACHE] Invalidate vì reactions của message thay đổi
        await this.redisCacheService.invalidateMessages(
            messageEdit.conversationId.toString(),
        );
        return messageEdit;
    }

    public async unreact(
        messageId: string,
        userId: string,
    ) {
        const messageObjectId = convertStringToObjectId(messageId);
        const userObjectId = convertStringToObjectId(userId);

        const message = await this.messageModel.findOneAndUpdate(
            {_id: messageObjectId, "reactions.userId": userObjectId},
            {$pull: {reactions: {userId: userObjectId}}},
            {new: true},
        );
        if (!message) throw new NotFoundException("Reaction not found");
        this.chatGateway.emitMessageReacted(message.conversationId.toString(), {
            messageId, userId, emoji: null, action: "remove"
        });

        // [CACHE] Invalidate vì reactions thay đổi
        await this.redisCacheService.invalidateMessages(message.conversationId.toString());
        return message;
    }

    // ─── Unread counts ───────────────────────────────────────────────────────

    public async getUnreadCountsPerConversation(
        conversationIds: Types.ObjectId[],
        userId: string,
    ): Promise<{_id: Types.ObjectId; count: number}[]> {
        const userObjId = convertStringToObjectId(userId);
        return this.messageModel.aggregate([
            {
                $match: {
                    conversationId: {$in: conversationIds},
                    seenBy: {$ne: userObjId},
                    isDeleted: false,
                }
            },
            {$group: {_id: "$conversationId", count: {$sum: 1}}}
        ]);
    }

    // ─── Mark as seen ────────────────────────────────────────────────────────

    public async markAsSeen(
        conversationId: string,
        user: JwtType,
    ) {
        const conObjectId = convertStringToObjectId(conversationId);
        const userObjectId = convertStringToObjectId(user.userId);

        // Tôn trọng privacy "Hiển thị đã xem" — nếu user tắt, KHÔNG ghi
        // seenBy và KHÔNG báo cho người khác biết mình đã đọc tin nhắn
        const myPrivacy = await this.userService.getPrivacy(user.userId);
        if (!myPrivacy.privacy?.showReadReceipts) {
            return { success: true, hidden: true };
        }

        await this.messageModel.updateMany(
            {conversationId: conObjectId, seenBy: { $ne: userObjectId }},
            {$addToSet: { seenBy: userObjectId }},
        );

        const lastMessage = await this.messageModel
            .findOne({ conversationId: conObjectId })
            .sort({ createdAt: -1 })
            .lean();

        if (!lastMessage) return { success: false };

        this.chatGateway.emitMessageSeen(conversationId, {
            conversationId,
            messageId: lastMessage._id.toString(),
            seenBy: {
                _id: user.userId,
                name: user.name,
                avatar: user.avatar
            },
        });

        // [CACHE] seenBy thay đổi → invalidate message pages + conversation list
        await Promise.all([
            this.redisCacheService.invalidateMessages(conversationId),
            this.redisCacheService.invalidateConversations(user.userId),
        ]);
        return { success: true };
    }

    // ─── Delete ──────────────────────────────────────────────────────────────

    public async delete(
        conversationId: string,
        id: string,
        userId: string,
        scope: "self" | "everyone",
    ) {
        const objectId = convertStringToObjectId(id);
        const userObjectId = convertStringToObjectId(userId);

        try {
            let result = null;
            if (scope === "self") {
                result = await this.messageModel.findOneAndUpdate(
                    {_id: objectId, deletedFor: {$ne: userObjectId}},
                    {$addToSet: {deletedFor: userObjectId}},
                    {new: true},
                );
            }
            if (scope === "everyone") {
                result = await this.messageModel.findOneAndUpdate(
                    {_id: objectId, senderId: userObjectId, isDeleted: {$ne: true}},
                    {$set: {isDeleted: true, content: "Message deleted"}},
                    {new: true},
                );
            }

            if (!result) {
                throw new ForbiddenException("You are not allowed to delete this message");
            }
            this.chatGateway.emitMessageDeleted(conversationId, {
                messageId: result._id.toString(),
                scope: scope,
                deletedBy: userId
            });

            // [CACHE] Invalidate vì message bị xoá (isDeleted / deletedFor thay đổi)
            await this.redisCacheService.invalidateMessages(conversationId);
            return result;
        } catch (e) {
            console.error(e);
            throw e;
        }
    }

    // ─── Forward ─────────────────────────────────────────────────────────────

    public async forwardMessage(
        userId: string,
        id: string,
        conversationIds: string[],
    ) {
        const objectId = convertStringToObjectId(id);
        const originalMessage = await this.messageModel.findById(objectId);

        if (!originalMessage) throw new NotFoundException("Message not found!");
        if (originalMessage.isDeleted) {
            throw new ForbiddenException("Cannot forward this message!");
        }

        // Resolve về root message nếu đây là tin forward của forward
        const rootMessageId = originalMessage.forwardedFrom ?? originalMessage._id;
        const rootMessage =
            originalMessage.forwardedFrom
                ? await this.messageModel.findById(rootMessageId)
                : originalMessage;

        if (!rootMessage) throw new NotFoundException("Root message not found!");

        const userObjectId = convertStringToObjectId(userId);

        const conversations = await this.conversationService.conversationsIdsForUser(
            conversationIds,
            userId,
        );
        if (!conversations.length) {
            throw new ForbiddenException("No active conversation found!");
        }

        // Lấy attachments/linkPreviews của root message 1 lần duy nhất
        const isMediaType = ["file", "media", "voice"].includes(rootMessage.type);
        const [rootAttachments, rootLinks] = await Promise.all([
            (isMediaType
                ? this.attachmentService.groupAttachmentsById([rootMessage._id])
                : Promise.resolve({})) as Promise<Record<string, AttachmentDocument[]>>,
            this.linkPreviewService.groupLinkPreviewsById([rootMessage._id]),
        ]);
        const rootIdStr = rootMessage._id.toString();
        const attachments = rootAttachments[rootIdStr] ?? [];
        const linkPreviews = rootLinks[rootIdStr] ?? [];

        const docs = conversations.map(conv => ({
            conversationId: conv._id,
            senderId: userObjectId,
            type: isMediaType ? rootMessage.type : "forward",
            content: rootMessage.content,
            forwardedFrom: rootMessage._id, // luôn trỏ về root
            seenBy: [userObjectId],
        }));

        const messages = await this.messageModel.insertMany(docs);

        await Promise.all(
            messages.map(async m => {
                // updateConversation và populate chạy song song
                await Promise.all([
                    this.conversationService.updateConversation(
                        m.conversationId.toString(),
                        m._id.toString(),
                    ),
                    m.populate([
                        { path: "senderId", select: "name avatar" },
                        { path: "seenBy", select: "name avatar" },
                    ]),
                ]);

                // Gán attachments/linkPreviews từ root message
                if (isMediaType && attachments.length) {
                    (m as any).attachments =
                        m.type === "voice" ? [attachments[0]] : attachments;
                }
                if (linkPreviews.length) {
                    (m as any).linkPreviews = linkPreviews;
                }

                this.chatGateway.emitMessageForwarded(
                    m.conversationId.toString(),
                    m,
                );

                await this.invalidateAll(m.conversationId.toString());
            }),
        );

        return messages;
    }

    // ─── System messages ─────────────────────────────────────────────────────

    public async newMessageSystem(
        actorId: string,
        content: string,
        userIds: string[],
        conversationId: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        const userObjectId = convertStringToObjectId(actorId);

        const users = await this.userService.getInfoUserIds(userIds);

        const dataMap = users.map((user) => ({
            type: "system",
            content: `${content} ${user.name}!`,
            senderId: userObjectId,
            conversationId: convObjectId,
            seenBy: [userObjectId],
        }));

        const result = await this.messageModel.insertMany(dataMap);
 
        // [CACHE] System message cũng invalidate pages
        await this.redisCacheService.invalidateMessages(conversationId);
        return result;
    }

    public async deleteManyMessagesConversationGroup(
        conversationId: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        await this.messageModel.deleteMany({conversationId: convObjectId});
        
         // [CACHE] Xoá toàn bộ cache của conversation khi group bị xoá
        await this.redisCacheService.invalidateMessages(conversationId);
    }

    // find messages pins

    public async filterMessageHavePins(conversationId: string) {
        return this.messageModel.find({
            conversationId: convertStringToObjectId(conversationId),
            isPinned: true
        })
            .populate(this.getArrayPopulate())
            .sort({createdAt: -1})
            .lean();
    }
}