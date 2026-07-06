import {Controller, Post, HttpCode, UseGuards, Body, Patch, Param, Get, Delete, Query} from "@nestjs/common";

import {JwtAuthGuard} from "../auth/guards/jwt-auth.guard";

import {FriendService} from "./friend.service";
import {JwtType} from "../../shared/types/jwtTypes.type";

import {JwtDecode} from "../../common/decorators/jwt.decorator";
import {SendRequestDto} from "./dto/sendRequest.dto";
import {ResRequestIdDto, ResResponseActionDto} from "./dto/requestRequest.dto";
import {UnfriendDto} from "./dto/unfriend.dto";
import {FindByPhoneDto} from "./dto/findByPhone.dto";
import { FindByNameDto } from "./dto/FindByNameDto.dto";

@Controller("friends")
@UseGuards(JwtAuthGuard)
export class FriendController {
    constructor(
        private readonly friendRequestService: FriendService
    ) {
    }

    @Post("request")
    public async sendRequest(
        @JwtDecode() user: JwtType,
        @Body() dto: SendRequestDto,
    ) {
        return this.friendRequestService.makeFriend(
            user.userId,
            dto.userId,
            dto.message
        );
    }

    @Patch("request/:id")
    public async resRequest(
        @JwtDecode() user: JwtType,
        @Param("id") id: ResRequestIdDto["id"],
        @Body() data: ResResponseActionDto,
    ) {
        return data.action === "accepted"
            ? this.friendRequestService.acceptedRequest(id, user.userId)
            : this.friendRequestService.rejectedRequest(id, user.userId);
    }

    @Get("requests")
    public async requests(@JwtDecode() user: JwtType) {
        return this.friendRequestService.request(user.userId);
    }

    @Get()
    public async friends(@JwtDecode() user: JwtType) {
        return this.friendRequestService.friends(user.userId);
    }

    @Delete(":id")
    public async unfriend(
        @Param("id") userId: UnfriendDto["id"],
        @JwtDecode() user: JwtType
    ) {
        return this.friendRequestService.unfriend(user.userId, userId);
    }

    @Get("find/phone")
    public async findPhone(@Query() query: FindByPhoneDto) {
        return this.friendRequestService.findPhone(query.q);
    }

    @Get("find/name")
    public async findName(@Query() query: FindByNameDto) {
        return this.friendRequestService.findName(query.q);
    }

    @Get("status/:userId")
    public async getFriendStatus(
        @Param("userId") userId: string,
        @JwtDecode() user: JwtType,
    ) {
        return this.friendRequestService.getFriendStatus(user.userId, userId);
    }
}