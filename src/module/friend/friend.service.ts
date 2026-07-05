import {
    BadRequestException,
    ForbiddenException, forwardRef, Inject,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import {InjectModel} from "@nestjs/mongoose";
import {Model} from "mongoose";

import {FriendRequest, FriendRequestDocument} from "./schema/friendRequest.schema";
import {ConversationService} from "../conversation/conversation.service";
import {ChatGateway} from "../../gateway/chat.gateway";

import {convertStringToObjectId} from "../../shared/helpers/convertObjectId.helpers";
import {UserService} from "../user/user.service";

@Injectable()
export class FriendService {
    constructor(
        @InjectModel(FriendRequest.name)
        private readonly friendRequestModel: Model<FriendRequestDocument>,
        @Inject(forwardRef(() => ConversationService))
        private readonly conversationService: ConversationService,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
    ) {
    }

    public async friendExits(
        fromId: string,
        toId: string
    ) {
        return this.friendRequestModel.findOne({
            $or: [
                {from: convertStringToObjectId(fromId), to: convertStringToObjectId(toId)},
                {from: convertStringToObjectId(toId), to: convertStringToObjectId(fromId)},
            ],
        });
    }

    public async makeFriend(
        fromId: string,
        toId: string,
        message: string,
    ) {
        if (fromId === toId) {
            throw new ForbiddenException("User not is a user");
        }
        const targetUser = await this.userService.findById(toId);
        if (!targetUser) {
            throw new NotFoundException("User not found");
        }

        const exits = await this.friendExits(fromId, toId);
        if (exits) {
            if (exits.status === "accepted")
                throw new ForbiddenException("Already friend");
            if (exits.status === "pending")
                throw new ForbiddenException("Request already pending");
            if (exits.status === "rejected")
                throw new ForbiddenException("User have rejected");
        }

        const request = await this.friendRequestModel.create({
            from: convertStringToObjectId(fromId),
            to: convertStringToObjectId(toId),
            message
        });
        await request.populate("from", "name avatar status");
        this.chatGateway.emitToUser(toId, "friend_request_received", {request});

        return request;
    }

    public async findRequestId(id: string) {
        return this.friendRequestModel.findById(convertStringToObjectId(id));
    }

    public async acceptedRequest(
        requestId: string,
        userId: string
    ) {
        const req = await this.findRequestId(requestId);

        if (!req || req.to.toString() !== userId) {
            throw new ForbiddenException("User get request not for you!");
        }
        if (req.status !== "pending") {
            throw new BadRequestException("Request already handled");
        }
        req.status = "accepted";
        await req.save();

        const conversation = await this.conversationService
            .create(
                req.from.toString(),
                req.to.toString()
            );

        await req.populate("to", "name avatar status");

        this.chatGateway.emitToUser(req.from.toString(), "friend_request_accepted", {
            friend: req.to,
            conversationId: conversation.id
        });

        return {req, conversation};
    }

    public async rejectedRequest(
        requestId: string,
        userId: string
    ) {
        const req = await this.findRequestId(requestId);

        if (!req || req.to.toString() !== userId) {
            throw new ForbiddenException("User get request not for you!");
        }
        if (req.status !== "pending") {
            throw new BadRequestException("Request already handled");
        }
        req.status = "rejected";
        await req.save();

        return req;
    }

    public async request(userId: string) {
        return this.friendRequestModel
            .find({to: convertStringToObjectId(userId), status: "pending"})
            .populate("from", "name avatar")
            .sort({createdAt: -1})
            .lean();
    }

    public async friends(userId: string) {
        const friends = await this.friendRequestModel
            .find({
                status: "accepted",
                $or: [
                    {from: convertStringToObjectId(userId)},
                    {to: convertStringToObjectId(userId)}
                ]
            })
            .populate("from to", "name avatar status")

        return friends.map(r =>
            r.from._id.toString() === userId ? r.to : r.from
        );
    }

    public async unfriend(userId: string, targetUserId: string) {
        const relation = await this.friendRequestModel
            .findOne({
                status: "accepted",
                $or: [
                    {from: convertStringToObjectId(userId), to: convertStringToObjectId(targetUserId)},
                    {from: convertStringToObjectId(targetUserId), to: convertStringToObjectId(userId)}
                ]
            });

        if (!relation) {
            throw new NotFoundException("Not friend");
        }
        await relation.deleteOne();
        return {success: true}
    }

    public async isFriend(myUserId: string, userId: string) {
        const from = convertStringToObjectId(myUserId);
        const to = convertStringToObjectId(userId);

        const friend = await this.friendRequestModel.findOne({
            status: "accepted",
            $or: [
                {from: from, to: to},
                {from: to, to: from},
            ]
        });
        return !!friend;
    }

    public async findPhone(phone: string) {
        return this.userService.findUserByPhoneNumber(phone);
    }

    public async findName(context: string) {
        return this.userService.findUserByName(context);
    }
}