import {
    ConflictException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    Logger,
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
    private readonly logger = new Logger(MessageService.name);

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
        if (!message) throw new NotFoundException("Không tìm thấy tin nhắn được trả lời");
        return convertStringToObjectId(replyTo);
    }

    // xoá cache tin nhắn và danh sách hội thoại của mọi thành viên (lỗi cache bỏ qua)
    private async invalidateAll(conversationId: string): Promise<void> {
        try {
            // xoá các trang tin nhắn
            await this.redisCacheService.invalidateMessages(conversationId);
 
            // xoá danh sách hội thoại của thành viên
            const conversation = await this.conversationService.findConversation(conversationId);
            const participantIds = conversation.participants.map((p) => p.userId.toString());
            await this.redisCacheService.invalidateConversationsMany(participantIds);
        } catch {
            // lỗi cache không ảnh hưởng luồng chính
        }
    }
 
    // ─── gửi tin nhắn ───

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

    // ─── tin nhắn cuộc gọi ───
 
    // tạo tin nhắn loại "call" để lưu lịch sử cuộc gọi vào hội thoại
    public async createCallMessage(dto: CreateCallMessageDto): Promise<MessageDocument> {
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
 
        // người trong cuộc gọi coi như đã xem tin nhắn này
        const seenByIds = participantIds.map((id) => convertStringToObjectId(id));
        if (!seenByIds.some((id) => id.equals(senderObjectId))) {
            seenByIds.push(senderObjectId);
        }
 
        // nội dung hiển thị theo trạng thái
        const contentMap: Record<string, string> = {
            started: "Cuộc gọi thoại nhóm",
            ended: "Cuộc gọi thoại",
            missed: "Cuộc gọi thoại nhỡ",
            cancelled: "Cuộc gọi thoại đã huỷ",
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
 
        // lấy tên và avatar cho frontend
        await message.populate([
            {path: "senderId", select: "name avatar"},
            {path: "callInfo.participants", select: "name avatar"},
        ]);
 
        // cập nhật tin nhắn cuối của hội thoại
        await this.conversationService.updateConversation(conversationId, message.id);
 
        // báo cho thành viên đang online
        this.chatGateway.emitNewMessageCall(conversationId, message);
 
        // xoá cache vì tin nhắn cuối đã đổi
        await this.invalidateAll(conversationId);
 
        return message;
    }

    // ─── tìm kiếm ───

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

    // ─── ghim / bỏ ghim ───

    public async pin(
        messageId: string,
        userId: string,
        conversationId: string
    ) {
        const mgs = await this.messageModel.findById(convertStringToObjectId(messageId));
        if (!mgs) throw new NotFoundException("Không tìm thấy tin nhắn");
        if (mgs.isPinned) throw new ForbiddenException("Tin nhắn đã được ghim");

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

        // xoá cache vì trạng thái ghim đổi
        await this.redisCacheService.invalidateMessages(conversationId);
        return mgs;
    }

    public async unpin(
        messageId: string,
        userId: string,
        conversationId: string
    ) {
        const mgs = await this.messageModel.findById(convertStringToObjectId(messageId));
        if (!mgs) throw new NotFoundException("Không tìm thấy tin nhắn");
        if (!mgs.isPinned) throw new ForbiddenException("Tin nhắn chưa được ghim");
        if (!mgs.pinByUser || mgs.pinByUser.toString() !== userId) {
            throw new ForbiddenException("Bạn không phải người đã ghim tin nhắn này")
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

        // xoá cache vì trạng thái ghim đổi
        await this.redisCacheService.invalidateMessages(conversationId);
        return mgs;
    }

    // ─── tải tệp / ảnh / giọng nói ───

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

        // bọc thành mảng cho giống file và media
        const voiceAttachment = await this.attachmentService.uploadVoice(
            file, message.id, userId, conversationId
        );
        const attachments = [voiceAttachment];

        this.chatGateway.emitNewMessageVoice(conversationId, {message, attachments});
        await this.conversationService.updateConversation(conversationId, message.id);

        await this.invalidateAll(conversationId);
        return {message, attachments};
    }

    // ─── sửa ───

    public async edit(
        userId: string,
        content: string,
        id: string
    ) {
        const message = await this.messageModel.findById(convertStringToObjectId(id));
        if (!message) throw new NotFoundException("Không tìm thấy tin nhắn");
        if (message.senderId.toString() !== userId) {
            throw new ForbiddenException("Không thể sửa tin nhắn này");
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

        // xoá cache vì nội dung đổi
        await this.redisCacheService.invalidateMessages(message.conversationId.toString());
        return populated;
    }

    // ─── lấy tin nhắn (có cache) ───

    public async messages(
        conversationId: string,
        limit: number = 20,
        before?: string
    ) {
        // 1. thử lấy từ cache
        const cached = await this.redisCacheService.getMessages(conversationId, limit, before);
        if (cached) return cached;
 
        // 2. chưa có cache thì truy vấn mongodb
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
                 // lấy thông tin người tham gia cuộc gọi
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
            
            // tệp đính kèm: ưu tiên của tin nhắn, không có thì lấy từ tin gốc
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
 
        // 3. lưu vào cache
        await this.redisCacheService.setMessages(conversationId, limit, result, before);
        return result;
    }

    // ─── tìm theo id ───

    public async findByIdCheck(messageId: string) {
        return this.messageModel.findById(
            convertStringToObjectId(messageId),
            {conversationId: 1}
        );
    }

    // ─── thả / bỏ cảm xúc ───

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
        if (!messageEdit) throw new ConflictException("Không tìm thấy tin nhắn");

        this.chatGateway.emitMessageReacted(messageEdit.conversationId.toString(), {
            messageId, userId, emoji, action: "add"
        });

        // xoá cache vì cảm xúc đổi
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
        if (!message) throw new NotFoundException("Không tìm thấy cảm xúc");
        this.chatGateway.emitMessageReacted(message.conversationId.toString(), {
            messageId, userId, emoji: null, action: "remove"
        });

        // xoá cache vì cảm xúc đổi
        await this.redisCacheService.invalidateMessages(message.conversationId.toString());
        return message;
    }

    // ─── đếm tin chưa đọc ───

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

    // ─── đánh dấu đã xem ───

    public async markAsSeen(
        conversationId: string,
        user: JwtType,
    ) {
        const conObjectId = convertStringToObjectId(conversationId);
        const userObjectId = convertStringToObjectId(user.userId);

        // nếu người dùng tắt "hiển thị đã xem" thì không ghi seenBy và không báo ai
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

        // xoá cache vì seenBy đổi
        await Promise.all([
            this.redisCacheService.invalidateMessages(conversationId),
            this.redisCacheService.invalidateConversations(user.userId),
        ]);
        return { success: true };
    }

    // ─── xoá ───

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
                throw new ForbiddenException("Bạn không có quyền xoá tin nhắn này");
            }
            this.chatGateway.emitMessageDeleted(conversationId, {
                messageId: result._id.toString(),
                scope: scope,
                deletedBy: userId
            });

            // xoá cache vì tin nhắn bị xoá
            await this.redisCacheService.invalidateMessages(conversationId);
            return result;
        } catch (e) {
            this.logger.error(`[xoá tin nhắn] lỗi: ${e}`);
            throw e;
        }
    }

    // ─── chuyển tiếp ───

    public async forwardMessage(
        userId: string,
        id: string,
        conversationIds: string[],
    ) {
        const objectId = convertStringToObjectId(id);
        const originalMessage = await this.messageModel.findById(objectId);

        if (!originalMessage) throw new NotFoundException("Không tìm thấy tin nhắn");
        if (originalMessage.isDeleted) {
            throw new ForbiddenException("Không thể chuyển tiếp tin nhắn này");
        }

        // nếu là tin chuyển tiếp của tin chuyển tiếp thì lấy về tin gốc
        const rootMessageId = originalMessage.forwardedFrom ?? originalMessage._id;
        const rootMessage =
            originalMessage.forwardedFrom
                ? await this.messageModel.findById(rootMessageId)
                : originalMessage;

        if (!rootMessage) throw new NotFoundException("Root Không tìm thấy tin nhắn");

        const userObjectId = convertStringToObjectId(userId);

        const conversations = await this.conversationService.conversationsIdsForUser(
            conversationIds,
            userId,
        );
        if (!conversations.length) {
            throw new ForbiddenException("Không tìm thấy cuộc trò chuyện hợp lệ");
        }

        // lấy tệp đính kèm và link preview của tin gốc 1 lần
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
            forwardedFrom: rootMessage._id,  // luôn trỏ về tin gốc
            seenBy: [userObjectId],
        }));

        const messages = await this.messageModel.insertMany(docs);

        await Promise.all(
            messages.map(async m => {
                // chạy song song
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

                // gán tệp đính kèm và link preview từ tin gốc
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

    // ─── tin nhắn hệ thống ───

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
 
        // xoá cache các trang tin nhắn
        await this.redisCacheService.invalidateMessages(conversationId);
        return result;
    }

    public async deleteManyMessagesConversationGroup(
        conversationId: string,
    ) {
        const convObjectId = convertStringToObjectId(conversationId);
        await this.messageModel.deleteMany({conversationId: convObjectId});
        
         // xoá cache khi nhóm bị xoá
        await this.redisCacheService.invalidateMessages(conversationId);
    }

    // lấy tin nhắn đã ghim

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