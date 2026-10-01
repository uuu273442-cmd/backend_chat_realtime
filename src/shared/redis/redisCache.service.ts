import {Inject, Injectable, Logger} from "@nestjs/common";
import Redis from "ioredis";
import {REDIS_CLIENT} from "./redis.module";

// cache danh sách hội thoại (30s) và các trang tin nhắn (60s) trên redis
// chỉ cache dữ liệu đọc, ghi vẫn đi thẳng vào mongodb

@Injectable()
export class RedisCacheService {
    private readonly logger = new Logger(RedisCacheService.name);
 
    private readonly CONVERSATIONS_TTL = 30;
    private readonly MESSAGES_TTL = 60;

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis
    ) {
    }

    // ─── cache danh sách hội thoại ───
 
    private conversationKey(userId: string, archived: boolean): string {
        return `conversations:${userId}:${archived ? "archived" : "active"}`;
    }
 
    async getConversations(userId: string, archived: boolean): Promise<any[] | null> {
        try {
            const cached = await this.redis.get(this.conversationKey(userId, archived));
            if (!cached) return null;
            return JSON.parse(cached);
        } catch (err) {
            this.logger.warn(`[Cache] lỗi lấy danh sách hội thoại: ${err}`);
            return null;
        }
    }
 
    async setConversations(userId: string, archived: boolean, data: any[]): Promise<void> {
        try {
            await this.redis.setex(
                this.conversationKey(userId, archived),
                this.CONVERSATIONS_TTL,
                JSON.stringify(data),
            );
        } catch (err) {
            this.logger.warn(`[Cache] lỗi lưu danh sách hội thoại: ${err}`);
        }
    }
 
    // xoá cache hội thoại của 1 user
    async invalidateConversations(userId: string): Promise<void> {
        try {
            const pipeline = this.redis.pipeline();
            pipeline.del(this.conversationKey(userId, false));
            pipeline.del(this.conversationKey(userId, true));
            await pipeline.exec();
        } catch (err) {
            this.logger.warn(`[Cache] lỗi xoá cache hội thoại: ${err}`);
        }
    }
 
    // xoá cache hội thoại của nhiều user
    async invalidateConversationsMany(userIds: string[]): Promise<void> {
        if (!userIds.length) return;
        try {
            const pipeline = this.redis.pipeline();
            for (const uid of userIds) {
                pipeline.del(this.conversationKey(uid, false));
                pipeline.del(this.conversationKey(uid, true));
            }
            await pipeline.exec();
        } catch (err) {
            this.logger.warn(`[Cache] lỗi xoá cache nhiều hội thoại: ${err}`);
        }
    }

    // ─── cache trang tin nhắn ───
 
    // tạo key cache cho 1 trang tin nhắn
    private messagePageKey(
        conversationId: string,
        cursor: string,
        limit: number,
    ): string {
        return `messages:${conversationId}:page:${cursor}:${limit}`;
    }
 
    // lấy 1 trang tin nhắn từ cache, null nếu chưa có
    async getMessages(
        conversationId: string,
        limit: number,
        before?: string,
    ): Promise<any | null> {
        try {
            const cursor = before ?? "first";
            const key = this.messagePageKey(conversationId, cursor, limit);
            const cached = await this.redis.get(key);
            if (!cached) return null;
            this.logger.debug(`[Cache] có cache tin nhắn ${conversationId} cursor=${cursor}`);
            return JSON.parse(cached);
        } catch (err) {
            this.logger.warn(`[Cache] lỗi lấy tin nhắn: ${err}`);
            return null;
        }
    }
 
    // lưu 1 trang tin nhắn vào cache
    async setMessages(
        conversationId: string,
        limit: number,
        data: any,
        before?: string,
    ): Promise<void> {
        try {
            const cursor = before ?? "first";
            const key = this.messagePageKey(conversationId, cursor, limit);
            const trackingKey = `messages:${conversationId}:keys`;
 
            const pipeline = this.redis.pipeline();
            // lưu dữ liệu trang
            pipeline.setex(key, this.MESSAGES_TTL, JSON.stringify(data));
            // lưu key để xoá sau này
            pipeline.sadd(trackingKey, key);
            // set theo dõi sống lâu hơn các trang một chút
            pipeline.expire(trackingKey, this.MESSAGES_TTL + 60);
            await pipeline.exec();
        } catch (err) {
            this.logger.warn(`[Cache] lỗi lưu tin nhắn: ${err}`);
        }
    }
 
    // xoá toàn bộ cache tin nhắn của 1 hội thoại
    async invalidateMessages(conversationId: string): Promise<void> {
        try {
            const trackingKey = `messages:${conversationId}:keys`;
            const keys = await this.redis.smembers(trackingKey);
 
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                // xoá tất cả key đã lưu
                for (const k of keys) {
                    pipeline.del(k);
                }
                // xoá set theo dõi
                pipeline.del(trackingKey);
                await pipeline.exec();
                this.logger.debug(
                    `[Cache] Invalidated ${keys.length} message pages for conversation ${conversationId}`,
                );
            }
        } catch (err) {
            this.logger.warn(`[Cache] lỗi xoá cache tin nhắn: ${err}`);
        }
    }
}