import {Model} from "mongoose";
import {InjectModel} from "@nestjs/mongoose";
import {
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException
} from "@nestjs/common";

import {Conversation, ConversationDocument} from "./schema/conversation.schema";

import {UserService} from "../user/user.service";
import {FriendService} from "../friend/friend.service";
import {MessageService} from "../message/message.service";
import {AttachmentService} from "../attachment/attachment.service";
import {AttachmentDocument} from "../attachment/schema/attachment.schema";
import {LinkPreviewService} from "../link-preview/link-preview.service";
import {LinkPreviewDocument} from "../link-preview/schema/link-preview.schema";
import {RequestJoinRoomService} from "../requestJoinRoom/requestJoinRoom.service";
import {RedisCacheService} from "../../shared/redis/redisCache.service";

import {convertStringToObjectId} from "../../shared/helpers/convertObjectId.helpers";

import {MuteDuration} from "./dto/muteDuration.dto";

import {ChatGateway} from "../../gateway/chat.gateway";

@Injectable()
export class ConversationService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        @Inject(forwardRef(() => FriendService))
        private readonly friendService: FriendService,
        @Inject(forwardRef(() => MessageService))
        private readonly messageService: MessageService,
        private readonly attachmentService: AttachmentService,
        private readonly linkPreviewService: LinkPreviewService,
        private readonly requestJoinRoomService: RequestJoinRoomService,
        private readonly redisCacheService: RedisCacheService,
    ) {
    }

    private matchRoleToTransVN(text: string) {
        const match: Record<string, string> = {
            "admin": "quản trị",
            "member": "thành viên"
        }
        return match[text];
    }

    public async create(myUserId: string, userId: string) {
        if (myUserId === userId)
            throw new ForbiddenException("Không thể tạo cuộc trò chuyện với chính mình");
        const uniqueIds = [myUserId, userId];
        const ok = await this.checkListUser(uniqueIds);
        if (!ok) throw new ForbiddenException("Không tìm thấy người tạo hoặc người dùng");

        const existConversation = await this.conversationModel.findOne({
            type: "private",
            participants: {$all: this.convertMapCheckElement(uniqueIds)}
        });
        if (existConversation) {
            existConversation.deletedUser = existConversation.deletedUser || [];
            const newSet = new Set(existConversation.deletedUser.map(uid => uid.toString()));
            if (newSet.has(myUserId)) {
                existConversation.deletedUser = existConversation.deletedUser.filter(
                    uid => uid.toString() !== myUserId
                );
                await existConversation.save();
            }
            return existConversation;
        }
        const conversation = await this.conversationModel.create({
            type: "private",
            createdBy: convertStringToObjectId(myUserId),
            // chưa là bạn bè thì hội thoại tự vào mục lưu trữ của người nhận
            participants: this.groupParticipants(
                uniqueIds,
                myUserId,
                (await this.friendService.isFriend(myUserId, userId)) ? [] : [userId],
            )
        });
        await conversation.populate("createdBy", "name");

        // xoá cache của 2 người
        await this.redisCacheService.invalidateConversationsMany(uniqueIds);

        this.chatGateway.emitGroupCreated(uniqueIds, {
            conversation: conversation,
            createdBy: {
                _id: conversation.createdBy._id.toString(),
                name: (conversation.createdBy as any).name,
            }
        });

        return conversation;
    }

    private hashTable<T extends AttachmentDocument | LinkPreviewDocument>(
        attachments: T[]
    ): Record<number, Record<number, T[]>> {
        const hashTable: Record<number, Record<number, T[]>> = {};
        for (const att of attachments) {
            const date = new Date((att as any).createdAt);
            const month = date.getMonth() + 1;
            const year = date.getFullYear();
            if (!hashTable[year]) hashTable[year] = {};
            if (!hashTable[year][month]) hashTable[year][month] = [];
            hashTable[year][month].push(att);
        }
        return hashTable;
    }

    public async infoMediaConversation(id: string) {
        const attachments = await this.attachmentService.getAttachmentRoomMedia(id);
        return this.hashTable(attachments);
    }

    public async infoFileConversation(id: string) {
        const attachments = await this.attachmentService.getAttachmentRoomFile(id);
        return this.hashTable(attachments);
    }

    public async infoLinkPreviewConversation(id: string) {
        const linkPreviews = await this.linkPreviewService.getLinkPreview(id);
        return this.hashTable(linkPreviews);
    }

    public async infoConversation(id: string) {
        const findConversationPrivate = await this.conversationModel.findById(
            convertStringToObjectId(id)
        )
            .populate(this.arrayPopulate())
            .lean();
        if (!findConversationPrivate) {
            throw new NotFoundException("Không tìm thấy dữ liệu");
        }

        return findConversationPrivate;
    }

    public async isAnyMemberExists(
        conversationId: string,
        members: string[]
    ) {
        const mbObjectIds = members.map(uid => convertStringToObjectId(uid));
        const existingConversation = await this.conversationModel.findOne({
            _id: convertStringToObjectId(conversationId),
            "participants.userId": {$in: mbObjectIds}
        });
        return !!existingConversation;
    }

    public async validateMentions(
        conversationId: string,
        mentions?: string[]
    ) {
        if (!mentions || !mentions?.length) return [];
        const conversation = await this.findConversation(conversationId);
        const newSetMentions = new Set(
            conversation.participants.map(obj => obj.userId.toString())
        );
        return mentions!.filter(uid => newSetMentions.has(uid));
    }

    public async addMembers(
        room: string,
        actorId: string,
        nameUser: string,
        userIds: string[],
        description?: string,
    ) {
        const uniqueIds = Array.from(new Set(userIds));

        const [validUsers, alreadyExists] = await Promise.all([
            this.checkListUser(uniqueIds),
            this.isAnyMemberExists(room, uniqueIds)
        ]);
        if (!validUsers) {
            throw new ForbiddenException("Một số người dùng không tồn tại");
        }
        if (!uniqueIds.length) {
            throw new ForbiddenException("Cần chọn ít nhất 1 người dùng");
        }
        if (alreadyExists) {
            throw new ForbiddenException("Một số người dùng đã ở trong nhóm");
        }
        const conversation = await this.findConversation(room);
        const actor = this.getUserParticipant(conversation, actorId);

        if (!["owner", "admin"].includes(actor.role)) {
            const newRequests = await this.requestJoinRoomService.createResponse(
                actorId, room, uniqueIds, description,
            );
            for (const request of newRequests) {
                await request.populate([
                    {path: "userId", select: "name avatar status"},
                    {path: "actor", select: "name"}
                ]);
                this.chatGateway.emitNewRequestJoinRoom(conversation.participants, {
                    conversationId: room, 
                    request,
                });
            }
            return newRequests;
        }
        const newMembers = this.groupParticipants(userIds, actorId);
        conversation.participants.push(...newMembers);
        await conversation.save();

        // xoá cache của thành viên cũ và mới
        const allAffectedIds = [
            ...conversation.participants.map((p) => p.userId.toString()),
            ...uniqueIds,
        ];
        await this.redisCacheService.invalidateConversationsMany(allAffectedIds);

        const addedBy = {_id: actorId, name: nameUser};
        const content = `${nameUser} đã thêm vào nhóm,`;
        const [addedUsers, newMessageSystem] = await Promise.all([
            this.userService.getInfoUserIds(uniqueIds),
            this.messageService.newMessageSystem(
                actorId, content, uniqueIds, room
            )
        ]);

        this.chatGateway.emitSystemRoom(room, newMessageSystem);
        this.chatGateway.emitAddMembersGroup(room, uniqueIds, {
            conversationId: room,
            addedUsers,
            addedBy,
            conversation,
        });

        return conversation;
    }

    public async removeMembers(
        room: string,
        actorId: string,
        userName: string,
        userIds: string[],
    ) {
        const ok = await this.checkListUser(userIds);
        if (!ok) {
            throw new ForbiddenException("Một số người dùng không tồn tại");
        }
        if (!userIds.length) {
            throw new ForbiddenException("Cần chọn ít nhất 1 người dùng");
        }
        const conversation = await this.findConversation(room);
        const actor = this.getUserParticipant(conversation, actorId);
        const checkCanRemoveMem = this.checkCantRemoveMember(
            conversation, userIds, actorId
        );

        if (!["owner", "admin"].includes(actor.role)) {
            throw new ForbiddenException("Chỉ chủ nhóm hoặc quản trị viên mới có quyền này");
        }
        if (!checkCanRemoveMem) {
            throw new ForbiddenException("Không thể xoá thành viên khỏi cuộc trò chuyện này");
        }
        const uniqueIds = new Set(userIds);
        const newParticipants = conversation.participants.filter(
            obj => !uniqueIds.has(obj.userId.toString())
        );
        conversation.participants = newParticipants;
        await conversation.save();

        // xoá cache của người bị xoá khỏi nhóm
        await this.redisCacheService.invalidateConversationsMany(userIds);

        const removedBy = {_id: actorId, name: userName};
        const content = `${userName} đã xóa khỏi nhóm,`;
        const newMessageSystem = await this.messageService.newMessageSystem(
            actorId, content, userIds, room
        );

        this.chatGateway.emitSystemRoom(room, newMessageSystem);
        this.chatGateway.emitRemoveMembersGroup(
            room,
            userIds,
            {
                conversationId: room,
                removedUserIds: userIds,
                removedBy,
                conversation
            }
        );

        return conversation;
    }

    public async changeRole(
        actorId: string,
        nameUser: string,
        room: string,
        userId: string,
        role: "admin" | "member",
    ) {
        const ok = await this.checkListUser([userId]);
        if (!ok) throw new ForbiddenException("Không tìm thấy người dùng");
        const conversation = await this.findConversation(room);

        const actor = this.getUserParticipant(conversation, actorId);
        const obj = this.getUserParticipant(conversation, userId);

        if (!["owner", "admin"].includes(actor.role)) {
            throw new ForbiddenException("Chỉ chủ nhóm hoặc quản trị viên mới có quyền này")
        }
        if (actorId === userId) {
            throw new ForbiddenException("Bạn không thể đổi vai trò của chính mình")
        }
        if (actor.role === "admin" && obj.role === "owner") {
            throw new ForbiddenException("Bạn không thể đổi vai trò của người này");
        }
        const participant = this.getUserParticipant(conversation, userId);
        participant.role = role;
        await conversation.save();

        const changedBy = {_id: actorId, name: nameUser};
        const content = `${nameUser} đã đổi quyền thành ${this.matchRoleToTransVN(role)}, `
        const [targetUser, newMessageSystem] = await Promise.all([
            this.userService.getInfoById(userId),
            await this.messageService.newMessageSystem(
                actorId, content, [userId], room
            )
        ]);

        this.chatGateway.emitSystemRoom(room, newMessageSystem);
        this.chatGateway.emitChangeRoleMemberGroup(room, {
            conversationId: room,
            targetUser,
            changedBy,
            newRole: role,
            conversation
        });

        return conversation;
    }

    public async leaveGroup(
        userId: string,
        userName: string,
        room: string
    ) {
        const conversation = await this.findConversation(room);
        const actor = this.getUserParticipant(conversation, userId);

        if (actor.role === "owner") {
            let newOwner = conversation.participants.find(
                p => p.userId.toString() !== userId && p.role === "admin"
            );
            if (!newOwner) {
                newOwner = conversation.participants.find(p => p.userId.toString() !== userId);
            }
            if (newOwner) {
                newOwner.role = "owner";
            } else {
                await Promise.all([
                    conversation.deleteOne(),
                    this.messageService.deleteManyMessagesConversationGroup(room),
                    this.attachmentService.cleanDateAttachments(room),
                    this.linkPreviewService.cleanLinkPreview(room)
                ]);
                return {status: "group is deleted!"}
            }
        }
        const newParticipants = conversation.participants.filter(
            obj => obj.userId.toString() !== userId
        );
        conversation.participants = newParticipants;
        await conversation.save();

        // xoá cache của người rời nhóm
        await this.redisCacheService.invalidateConversations(userId);

        const leftUser = {_id: userId, name: userName};
        const content = `người đã rời khỏi nhóm,`;

        const newMessageSystem = await this.messageService.newMessageSystem(
            userId, content, [userId], room
        );
        this.chatGateway.emitSystemRoom(room, newMessageSystem);
        this.chatGateway.emitLeftGroup(room, userId, {
            conversationId: room,
            leftUser,
            conversation
        });

        return conversation;
    }

    public async disbandGroup(userId: string, conversationId: string) {
        const conversation = await this.findConversation(conversationId);
        const user = this.getUserParticipant(conversation, userId);

        if (user.role !== "owner") {
            throw new ForbiddenException("Bạn không có quyền giải tán nhóm");
        }

        // lấy danh sách thành viên trước khi xoá để gửi sự kiện
        const memberIds = conversation.participants.map((p) => p.userId.toString());

        await this.redisCacheService.invalidateConversationsMany(memberIds);

        await Promise.all([
            conversation.deleteOne(),
            this.messageService.deleteManyMessagesConversationGroup(conversationId),
            this.attachmentService.cleanDateAttachments(conversationId)
        ]);

        // báo cho thành viên sau khi xoá xong
        this.chatGateway.emitGroupDissolved(memberIds, conversationId, {
            conversationId,
            dissolvedBy: userId,
        });

        return {status: "group is deleted!"}
    }

    public async listRequestJoinRoom(
        room: string,
        actorId: string
    ) {
        const conversation = await this.findConversation(room);
        // ai trong nhóm cũng xem được yêu cầu đang chờ
        this.getUserParticipant(conversation, actorId);  // vẫn kiểm tra người dùng có trong nhóm
        return this.requestJoinRoomService.listRequestJoinRoom(conversation._id.toString());
    }

    public async handleRequest(
        room: string,
        action: "accept" | "reject",
        id: string,
        actorId: string,
        userName: string,
    ) {
        const conversation = await this.findConversation(room);
        const actor = this.getUserParticipant(conversation, actorId);

        if (!["owner", "admin"].includes(actor.role)) {
            throw new ForbiddenException("Chỉ chủ nhóm hoặc quản trị viên mới có quyền này");
        }
        const userId = await this.requestJoinRoomService.handleRequestJoinRoom(id, action);
        if (action === "accept") {
            const participant = this.groupParticipants([userId], actorId);
            conversation.participants.push(...participant);
            await conversation.save();

            // xoá cache của người mới được thêm
            await this.redisCacheService.invalidateConversations(userId);

            const handledBy = {_id: actorId, name: userName};
            const content = `${userName} chấp nhận yêu cầu thêm mới,`;

            const newMessageSystem = await this.messageService.newMessageSystem(
                actorId, content, [userId], room
            );
            this.chatGateway.emitSystemRoom(room, newMessageSystem);
            this.chatGateway.emitHandelRequestJoinRoom(room, userId, {
                conversationId: room,
                requestId: id,
                action,
                handledBy,
                conversation
            });
            return conversation;
        }
        return {
            status: "reject",
            message: "Yêu cầu đã bị từ chối"
        }
    }

    private checkCantRemoveMember(
        conversation: ConversationDocument,
        members: string[],
        actorId: string
    ) {
        const uids = new Set(conversation.participants.map(uid => uid.userId.toString()));
        for (const uid of members) {
            if (!uids.has(uid)) return false;
            if (uid === actorId) return false;
            const obj = this.getUserParticipant(conversation, uid)
            if (obj.role === "owner") return false;
        }
        return true;
    }

    private convertMapCheckElement(userIds: string[]) {
        return userIds.map(uid => ({
            $elemMatch: {userId: convertStringToObjectId(uid)},
        }));
    }

    private async checkListUser(userIds: string[]) {
        const group = await this.userService.getUserValid(userIds);
        if (group.length !== userIds.length) return false;
        return true;
    }

    private groupParticipants(
        userIds: string[],
        ownerId: string,
        archivedForUserIds: string[] = []
    ): ConversationDocument["participants"] {
        return userIds.map(uid => ({
            userId: convertStringToObjectId(uid),
            role: uid === ownerId ? "owner" : "member",
            isArchived: archivedForUserIds.includes(uid),
            isMuted: false,
            mutedUntil: null
        }));
    }

    public async createGroup(
        userId: string,
        name: string,
        groupIds: string[],
    ) {
        const uniqueIds = Array.from(new Set([userId, ...groupIds]));
        const ok = await this.checkListUser(uniqueIds);
        if (!ok)
            throw new ForbiddenException("Một số người dùng không tồn tại");
        if (uniqueIds.length < 3)
            throw new ForbiddenException("Nhóm phải có ít nhất 3 thành viên");
        const group = await this.conversationModel.create({
            createdBy: convertStringToObjectId(userId),
            participants: this.groupParticipants(uniqueIds, userId),
            type: "group",
            name,
        });
        await group.populate("createdBy", "name");

         // xoá cache của các thành viên mới
        await this.redisCacheService.invalidateConversationsMany(uniqueIds);

        this.chatGateway.emitGroupCreated(uniqueIds, {
            conversation: group,
            createdBy: {
                _id: group.createdBy._id.toString(),
                name: (group.createdBy as any).name,
            }
        });

        return group;
    }

    public async removeConversation(userId: string, conversationId: string) {
        const conversation = await this.findConversation(conversationId);
        const user = this.getUserParticipant(conversation, userId);

        conversation.deletedUser = conversation.deletedUser || [];
        const convertSet = new Set(conversation.deletedUser.map(uid => uid.toString()));
        if (convertSet.has(user.userId.toString()))
            throw new ForbiddenException("Bạn đã xoá cuộc trò chuyện này, vui lòng khôi phục");

        conversation.deletedUser.push(user.userId);
        if (conversation.participants.length === conversation.deletedUser.length) {
            await Promise.all([
                conversation.deleteOne(),
                this.messageService.deleteManyMessagesConversationGroup(conversationId),
                this.attachmentService.cleanDateAttachments(conversationId),
                this.linkPreviewService.cleanLinkPreview(conversationId)
            ]);
            return {status: "group is deleted!"}
        }
        await conversation.save();

        // xoá cache của người vừa xoá hội thoại
        await this.redisCacheService.invalidateConversations(userId);

        return conversation;
    }

    private arrayPopulate() {
        return [
            {path: "participants.userId", select: "name avatar status customStatusMessage lastSeen"},
            {
                path: "lastMessage",
                select: "senderId content createdAt",
                populate: {path: "senderId", select: "name avatar"}
            }
        ];
    }

    // lấy danh sách hội thoại (có cache 30s)
    public async getAllConversations(myUserId: string, includeArchived = false) {
         // 1. có cache thì trả luôn
        const cached = await this.redisCacheService.getConversations(
            myUserId,
            includeArchived,
        );
        if (cached) return cached;

        const myObjectId = convertStringToObjectId(myUserId);
        const conversations = await this.conversationModel
            .find({ 
                "participants.userId": myObjectId,
                deletedUser: {$ne: myObjectId} 
            })
            .populate(this.arrayPopulate())
            .sort({updatedAt: -1})
            .lean();

        const filteredConversations = conversations.filter(conv => {
            const me = conv.participants.find(
                p => p.userId._id.toString() === myUserId
            );
            return includeArchived ? me?.isArchived === true : !me?.isArchived;
        });
        const conversationIds = filteredConversations.map(conv => conv._id);

        // đếm tin chưa đọc bằng 1 truy vấn aggregation
        const unreadCounts = await this.messageService.getUnreadCountsPerConversation(
            conversationIds, myUserId
        );

        // map: conversationId -> số tin chưa đọc
        const hashMap = new Map<string, number>();
        for (const item of unreadCounts) {
            hashMap.set(item._id.toString(), item.count);
        }

        const result = filteredConversations.map((conv) => ({
            ...conv,
            unreadCount: hashMap.get(conv._id.toString()) || 0,
        }));
 
        // 3. lưu vào cache
        await this.redisCacheService.setConversations(myUserId, includeArchived, result);
        
        return result;
    }

    public async archiveConversation(conversationId: string, userId: string, archive: boolean) {
        const result = await this.conversationModel.updateOne({
            _id: convertStringToObjectId(conversationId),
            "participants.userId": convertStringToObjectId(userId),
        }, {
            $set: {"participants.$.isArchived": archive},
        });

        if (!result.matchedCount) {
            throw new NotFoundException("Không tìm thấy cuộc trò chuyện hoặc bạn không phải thành viên");
        }

        // xoá cache vì trạng thái lưu trữ đổi
        await this.redisCacheService.invalidateConversations(userId);

        return {success: true, archived: archive};
    }

    public async users(userId: string) {
        return this.userService.listUser(userId);
    }

    public async updateConversation(
        conversationId: string,
        messageId: string,
    ) {
        const updatedConversation = await this.conversationModel.findByIdAndUpdate(
            convertStringToObjectId(conversationId),
            {$set: {
                lastMessage: convertStringToObjectId(messageId),
                deletedUser: [],
                updatedAt: new Date()
            }},
            {new: true}
        );
        if (!updatedConversation) {
            throw new NotFoundException("Không tìm thấy cuộc trò chuyện");
        }
        return updatedConversation;
    }

    public async findConversation(room: string) {
        const conversation = await this.conversationModel.findById(
            convertStringToObjectId(room),
        );
        if (!conversation) {
            throw new NotFoundException("Không tìm thấy cuộc trò chuyện");
        }
        return conversation;
    }

    private getUserParticipant(
        conversation: ConversationDocument,
        userId: string
    ) {
        const obj = conversation.participants.find(
            conv => conv.userId.toString() === userId
        );
        if (!obj)
            throw new ForbiddenException("Không tìm thấy người tham gia");
        return obj;
    }

    public async findUserParticipants(
        userId: string,
        conversationId: string,
    ) {
        return await this.conversationModel
            .findOne({
                _id: convertStringToObjectId(conversationId),
                "participants.userId": convertStringToObjectId(userId)
            });
    }

    public async conversationsIdsForUser(conversationIds: string[], userId: string) {
        return this.conversationModel.find(
            {
                _id: {$in: conversationIds.map(conv => convertStringToObjectId(conv))},
                "participants.userId": convertStringToObjectId(userId),
            },
            {_id: 1, participants: 1}
        );
    }

    public async pins(conversationId: string) {
        const findConversation = await this.findConversation(conversationId);
        return this.messageService.filterMessageHavePins(findConversation.id);
    }

    public async findById(conversationId: string) {
        return this.conversationModel.findById(
            convertStringToObjectId(conversationId),
            {_id: 1}
        );
    }

    public async muteConversation(conversationId: string, userId: string, duration: MuteDuration) {
        const durationMap: Record<MuteDuration, number | null> = {
            "1h": 60 * 60 * 1000,
            "8h": 8 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "forever": null,
        };
        const ms = durationMap[duration];
        const mutedUntil = ms ? new Date(Date.now() + ms) : null;

        const result = await this.conversationModel.updateOne({
            _id: convertStringToObjectId(conversationId),
            "participants.userId": convertStringToObjectId(userId),
        }, {
            $set: {
                "participants.$.isMuted": true,
                "participants.$.mutedUntil": mutedUntil
            }
        });

        if (!result.matchedCount)
            throw new NotFoundException("Không tìm thấy cuộc trò chuyện hoặc bạn không phải thành viên");
        return {success: true, mutedUntil}
    }

    public async unmuteConversation(conversationId: string, userId: string) {
        const result = await this.conversationModel.updateOne({
            _id: convertStringToObjectId(conversationId),
            "participants.userId": convertStringToObjectId(userId),
        }, {
            $set: {
                "participants.$.isMuted": false,
                "participants.$.mutedUntil": null
            }
        });

        if (!result.matchedCount)
            throw new NotFoundException("Không tìm thấy cuộc trò chuyện hoặc bạn không phải thành viên");
        return {success: true}
    }
}