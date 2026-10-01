import {ExtractJwt, Strategy} from "passport-jwt";
import {PassportStrategy} from "@nestjs/passport";
import {Injectable, UnauthorizedException} from "@nestjs/common";

import {ConfigService} from "@nestjs/config";
import {UserService} from "../../user/user.service";

// nhớ người dùng còn tồn tại trong 60 giây để đỡ truy vấn database
const USER_CACHE_MS = 60 * 1000;
const USER_CACHE_MAX_SIZE = 5000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    // userId -> thời điểm hết hạn
    private readonly knownUsers = new Map<string, number>();

    constructor(
        configService: ConfigService,
        private readonly userService: UserService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: configService.get<string>("JWT_SECRET")!,
        });
    }

    // kiểm tra người dùng còn tồn tại rồi gắn vào request
    async validate(payload: any) {
        const now = Date.now();
        const expireAt = this.knownUsers.get(payload.sub);

        if (!expireAt || expireAt < now) {
            const exists = await this.userService.existsById(payload.sub);
            if (!exists) {
                this.knownUsers.delete(payload.sub);
                throw new UnauthorizedException("Không tìm thấy người dùng hoặc tài khoản đã bị xoá");
            }
            // dọn bớt để map không phình to
            if (this.knownUsers.size >= USER_CACHE_MAX_SIZE) this.knownUsers.clear();
            this.knownUsers.set(payload.sub, now + USER_CACHE_MS);
        }

        return {
            userId: payload.sub,
            name: payload.name,
            email: payload.email,
            avatar: payload.avatar,
        }
    }
}
