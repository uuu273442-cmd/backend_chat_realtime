import {Controller, Post, UseGuards, Body, Get, Param, Patch, Delete, Query} from "@nestjs/common";
import {JwtAuthGuard} from "../auth/guards/jwt-auth.guard";

import {JwtDecode} from "../../common/decorators/jwt.decorator";
import {JwtType} from "../../shared/types/jwtTypes.type";
import {ConversationService} from "./conversation.service";

import {CreatePrivateConversationDto} from "./dto/createPrivate.dto";
import {CreateGroupDto} from "./dto/createGroup.dto";
import {ConversationIdDto} from "./dto/conversationId.dto";
import {AddMemberDto} from "./dto/addMember.dto";
import {RemoveMemberDto} from "./dto/removeMember.dto";
import {ChangeRoleDto} from "./dto/changeRole.dto";
import {HandleRequestDto} from "./dto/handleRequest.dto";
import {IsArchived} from "./dto/isArchived.dto";
import {MuteDurationDto} from "./dto/muteDuration.dto";
import {ConversationParticipantGuard} from "./guard/conversationParticipant.guard";

@Controller("conversations")
@UseGuards(JwtAuthGuard)
export class ConversationController {
    constructor(
        private readonly conversationService: ConversationService
    ) {
    }

    @Post("private")
    public async createConversation(
        @JwtDecode() user: JwtType,
        @Body() dto: CreatePrivateConversationDto
    ) {
        return this.conversationService.create(user.userId, dto.userId);
    }

    // chỉ thành viên mới xem được
    @UseGuards(ConversationParticipantGuard)
    @Get(":id/info")
    public async getInfoPrivate(
        @Param("id") room: ConversationIdDto["id"]
    ) {
        return this.conversationService.infoConversation(room);
    }

    // chỉ thành viên mới xem được
    @UseGuards(ConversationParticipantGuard)
    @Get(":id/info/media")
    public async getInfoMedia(
        @Param("id") room: ConversationIdDto["id"]
    ) {
        return this.conversationService.infoMediaConversation(room);
    }

    // chỉ thành viên mới xem được
    @UseGuards(ConversationParticipantGuard)
    @Get(":id/info/file")
    public async getInfoFile(
        @Param("id") room: ConversationIdDto["id"]
    ) {
        return this.conversationService.infoFileConversation(room);
    }

    // chỉ thành viên mới xem được
    @UseGuards(ConversationParticipantGuard)
    @Get(":id/info/link-preview")
    public async getInfoLinkPreview(
        @Param("id") room: ConversationIdDto["id"]
    ) {
        return this.conversationService.infoLinkPreviewConversation(room);
    }

    @Post("group")
    public async createConversationGroup(
        @JwtDecode() user: JwtType,
        @Body() dto: CreateGroupDto
    ) {
        return this.conversationService.createGroup(
            user.userId,
            dto.name,
            dto.groupIds
        );
    }

    @Delete(":id/remove")
    public async removePrivate(
        @JwtDecode() user: JwtType,
        @Param() params: ConversationIdDto
    ) {
        return this.conversationService.removeConversation(user.userId, params.id);
    }

    @Patch(":id/members/add")
    public async addMember(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"],
        @Body() dto: AddMemberDto
    ) {
        return this.conversationService.addMembers(
            room,
            user.userId,
            user.name,
            dto.userIds,
            dto?.description
        )
    }

    @Delete(":id/members/remove")
    public async removeMember(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"],
        @Body() dto: RemoveMemberDto
    ) {
        return this.conversationService.removeMembers(
            room,
            user.userId,
            user.name,
            dto.userIds,
        )
    }

    @Patch(":id/members/role")
    public async changeRole(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"],
        @Body() dto: ChangeRoleDto
    ) {
        return this.conversationService.changeRole(
            user.userId,
            user.name,
            room,
            dto.id,
            dto.role
        )
    }

    @Delete(":id/members/leave")
    public async leaveGroup(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"],
    ) {
        return this.conversationService.leaveGroup(
            user.userId,
            user.name,
            room
        );
    }

    @Delete(":id/disband")
    public async disbandGroup(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"],
    ) {
        return this.conversationService.disbandGroup(
            user.userId,
            room
        );
    }

    @Get(":id/requests")
    public async listRequestJoinRoom(
        @JwtDecode() user: JwtType,
        @Param("id") room: ConversationIdDto["id"]
    ) {
        return this.conversationService.listRequestJoinRoom(
            room,
            user.userId,
        );
    }

    @Patch(":id/request/handle")
    public async acceptRequest(
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() dto: HandleRequestDto
    ) {
        return this.conversationService.handleRequest(
            room,
            dto.action,
            dto.id,
            user.userId,
            user.name
        );
    }

    @Get(":id/pins")
    public async pins(
        @Param("id") room: ConversationIdDto["id"],
    ) {
        return this.conversationService.pins(room);
    }

    @Get("")
    public async conversations(@JwtDecode() user: JwtType, @Query() query?: IsArchived) {
        return this.conversationService.getAllConversations(user.userId, query?.archived);
    }

    @Get("list-user")
    public async users(@JwtDecode() user: JwtType) {
        return this.conversationService.users(user.userId);
    }

    @Post(":id/archive")
    archive(@Param("id") room: ConversationIdDto["id"], @JwtDecode() user: JwtType) {
        return this.conversationService.archiveConversation(room, user.userId, true);
    }

    @Delete(":id/archive")
    unarchive(@Param("id") room: ConversationIdDto["id"], @JwtDecode() user: JwtType) {
        return this.conversationService.archiveConversation(room, user.userId, false);
    }

    @Post(":id/mute")
    mute(
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() dto: MuteDurationDto
    ) {
        return this.conversationService.muteConversation(room, user.userId, dto.duration);
    }

    @Delete(":id/mute")
    unmute(@Param("id") room: ConversationIdDto["id"], @JwtDecode() user: JwtType) {
        return this.conversationService.unmuteConversation(room, user.userId);
    }
}