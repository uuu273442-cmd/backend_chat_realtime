import {Inject, Injectable} from "@nestjs/common";
import Redis from "ioredis";
import {REDIS_CLIENT} from "./redis.module";

// lưu trạng thái cuộc gọi trên redis
//   call:{callId}          hash  thông tin cuộc gọi
//   call:{callId}:members  set   userId đang tham gia
//   user:{userId}:callId   string callId mà user đang ở trong
// ttl 2 giờ để tự xoá cuộc gọi bị bỏ dở (client crash)
@Injectable()
export class RedisCallService {
    private readonly CALL_TTL = 7200;
    
    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis
    ) {
    }

    async createCall(data: {
        callId: string;
        callerId: string;
        calleeId?: string;
        conversationId?: string;
        callType: "voice";
        isGroup: boolean;
    }): Promise<void> {
        const key = `call:${data.callId}`;
        const pipeline = this.redis.pipeline();

        pipeline.hset(key, {
            callId: data.callId,
            callerId: data.callerId,
            calleeId: data.calleeId ?? "",
            conversationId: data.conversationId ?? "",
            callType: data.callType,
            isGroup: data.isGroup ? "1" : "0",
            startedAt: "",
        });
        pipeline.expire(key, this.CALL_TTL);

        // thêm người gọi vào danh sách
        pipeline.sadd(`call:${data.callId}:members`, data.callerId);
        pipeline.expire(`call:${data.callId}:members`, this.CALL_TTL);

        // đánh dấu user đang bận
        pipeline.set(`user:${data.callerId}:callId`, data.callId, "EX", this.CALL_TTL);

        await pipeline.exec();
    }

    async getCall(callId: string): Promise<{
        callId: string;
        callerId: string;
        calleeId?: string;
        conversationId?: string;
        callType: "voice";
        isGroup: boolean;
        participants: Set<string>;
        startedAt?: Date;
    } | null> {
        const [raw, members] = await Promise.all([
            this.redis.hgetall(`call:${callId}`),
            this.redis.smembers(`call:${callId}:members`),
        ]);
 
        if (!raw || !raw.callId) return null;
 
        return {
            callId: raw.callId,
            callerId: raw.callerId,
            calleeId: raw.calleeId || undefined,
            conversationId: raw.conversationId || undefined,
            callType: "voice",
            isGroup: raw.isGroup === "1",
            participants: new Set(members),
            startedAt: raw.startedAt ? new Date(raw.startedAt) : undefined,
        };
    }

    // lưu thời điểm bắt máy

    async setStartedAt(callId: string): Promise<void> {
        await this.redis.hset(`call:${callId}`, "startedAt", new Date().toISOString());
    }

    // thêm người tham gia
    async addParticipant(callId: string, userId: string): Promise<void> {
        const pipeline = this.redis.pipeline();
        pipeline.sadd(`call:${callId}:members`, userId);
        pipeline.expire(`call:${callId}:members`, this.CALL_TTL);
        pipeline.set(`user:${userId}:callId`, callId, "EX", this.CALL_TTL);
        await pipeline.exec();
    }

    // xoá người tham gia
    async removeParticipant(callId: string, userId: string): Promise<number> {
        const pipeline = this.redis.pipeline();
        pipeline.srem(`call:${callId}:members`, userId);
        pipeline.del(`user:${userId}:callId`);
        await pipeline.exec();
        // trả về số người còn lại
        return await this.redis.scard(`call:${callId}:members`);
    }

    // xoá toàn bộ cuộc gọi
    async deleteCall(callId: string, participantIds: string[]): Promise<void> {
        const pipeline = this.redis.pipeline();
        pipeline.del(`call:${callId}`);
        pipeline.del(`call:${callId}:members`);
        for (const uid of participantIds) {
            pipeline.del(`user:${uid}:callId`);
        }
        await pipeline.exec();
    }

    // kiểm tra user có đang trong cuộc gọi không
    async getUserCallId(userId: string): Promise<string | null> {
        return this.redis.get(`user:${userId}:callId`);
    }
 
    async isUserInCall(userId: string): Promise<boolean> {
        return !!(await this.redis.exists(`user:${userId}:callId`));
    }

    // user có nằm trong cuộc gọi này không
    async isParticipant(callId: string, userId: string): Promise<boolean> {
        return (await this.redis.sismember(`call:${callId}:members`, userId)) === 1;
    }

    // lấy danh sách người tham gia
    async getParticipants(callId: string): Promise<string[]> {
        return this.redis.smembers(`call:${callId}:members`);
    }
 
    async getParticipantCount(callId: string): Promise<number> {
        return this.redis.scard(`call:${callId}:members`);
    }

    // cuộc gọi nhóm đang chạy của mỗi hội thoại (tránh tạo trùng)

    async setActiveGroupCall(conversationId: string, callId: string): Promise<void> {
        await this.redis.set(
            `conversation:${conversationId}:activeGroupCall`,
            callId,
            "EX",
            this.CALL_TTL,
        );
    }

    async getActiveGroupCall(conversationId: string): Promise<string | null> {
        return this.redis.get(`conversation:${conversationId}:activeGroupCall`);
    }

    async clearActiveGroupCall(conversationId: string): Promise<void> {
        await this.redis.del(`conversation:${conversationId}:activeGroupCall`);
    }
}