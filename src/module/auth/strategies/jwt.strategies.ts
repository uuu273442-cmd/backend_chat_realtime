import {ExtractJwt, Strategy} from "passport-jwt";
import {PassportStrategy} from "@nestjs/passport";
import {Injectable, UnauthorizedException} from "@nestjs/common";

import {ConfigService} from "@nestjs/config";
import {UserService} from "../../user/user.service";

// Thời gian nhớ "người dùng này còn tồn tại" trong bộ nhớ (60 giây).
const USER_CACHE_MS = 60 * 1000;
const USER_CACHE_MAX_SIZE = 5000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    // userId -> thời điểm hết hạn của bản ghi nhớ
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

    // Luồng: giải mã token -> kiểm tra người dùng còn tồn tại -> gắn thông tin vào request.
    // Trước đây mỗi request đều truy vấn database. Nay chỉ truy vấn khi chưa nhớ
    // hoặc bản ghi đã quá 60 giây, giúp giảm rất nhiều truy vấn.
    async validate(payload: any) {
        const now = Date.now();
        const expireAt = this.knownUsers.get(payload.sub);

        if (!expireAt || expireAt < now) {
            const exists = await this.userService.existsById(payload.sub);
            if (!exists) {
                this.knownUsers.delete(payload.sub);
                throw new UnauthorizedException("User not found or account has been deleted");
            }
            // Tránh Map lớn dần theo thời gian
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
