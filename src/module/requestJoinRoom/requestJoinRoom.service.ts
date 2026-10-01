import { Model } from "mongoose";
import { ForbiddenException, Injectable, ConflictException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";

import { RequestJoinRoom, RequestJoinRoomDocument } from "./schema/requestJoinRoom.schema";
import { convertStringToObjectId } from "../../shared/helpers/convertObjectId.helpers";

@Injectable()
export class RequestJoinRoomService {
    constructor(
        @InjectModel(RequestJoinRoom.name)
        private readonly requestJoinRoomModel: Model<RequestJoinRoomDocument>,
    ) {
    }

    public async createResponse(
        ownerId: string,
        conversationId: string,
        userIds: string[],
        description?: string
    ) {
        const convIdObj = convertStringToObjectId(conversationId);
        const userIdObjs = userIds.map(uid => convertStringToObjectId(uid));

        const hasDuplicate = await this.requestJoinRoomModel.exists({
            conversationId: convIdObj,
            status: "pending",
            userId: { $in: userIdObjs }
        });

        if (hasDuplicate) {
            throw new ConflictException(
                "Một hoặc nhiều người dùng đã có yêu cầu đang chờ duyệt trong nhóm này!"
            );
        }

        const data = userIds.map(uid => ({
            userId: convertStringToObjectId(uid),
            actor: convertStringToObjectId(ownerId),
            conversationId: convIdObj,
            description
        }));
        return await this.requestJoinRoomModel.insertMany(data);
    }

    public async listRequestJoinRoom(room: string) {
        return this.requestJoinRoomModel.find({
            conversationId: convertStringToObjectId(room),
            status: "pending"
        })
            .populate([
                { path: "userId", select: "name avatar status" },
                { path: "actor", select: "name avatar status" },
            ])
            .sort({ createdAt: -1 })
            .lean();
    }

    public async handleRequestJoinRoom(id: string, action: "accept" | "reject") {
        const request = await this.requestJoinRoomModel
            .findById(convertStringToObjectId(id));

        if (!request) {
            throw new ForbiddenException("Không tìm thấy yêu cầu tham gia");
        }
        if (request.status !== "pending") {
            throw new ForbiddenException("Yêu cầu đã được xử lý")
        }
        const userId = request.userId.toString();

        request.status = action;
        await request.save();

        return userId;
    }
}