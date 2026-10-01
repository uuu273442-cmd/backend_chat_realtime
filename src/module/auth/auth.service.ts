import {ConflictException, Injectable, UnauthorizedException} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import {JwtService} from "@nestjs/jwt";
import {ConfigService} from "@nestjs/config";
import {createHash, randomUUID, timingSafeEqual} from "crypto";

import {UserService} from "../user/user.service";
import {InputRegisterUserDto} from "./dto/inputRegister.dto";
import {registerDto} from "./dto/register.dto";
import {UserDocument} from "../user/schema/user.schema";

@Injectable()
export class AuthService {
    constructor(
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {
    }

    public async register(dto: InputRegisterUserDto) {
        // kiểm tra mật khẩu trước vì không cần truy vấn database
        if (dto.password !== dto.passwordConfirm) {
            throw new ConflictException("Mật khẩu xác nhận không khớp");
        }

        // chạy song song cho nhanh
        const [existEmail, existPhoneNumber] = await Promise.all([
            this.userService.findByEmail(dto.email),
            this.userService.findByPhoneNumber(dto.phoneNumber),
        ]);
        if (existEmail) {
            throw new ConflictException("Email đã được sử dụng");
        }
        if (existPhoneNumber) {
            throw new ConflictException("Số điện thoại đã được sử dụng");
        }

        const data: registerDto = {
            password: dto.password,
            phoneNumber: dto.phoneNumber,
            name: `${dto.firstName} ${dto.lastName}`,
            email: dto.email,
        }
        return this.userService.create(data);
    }

    public async validateUser(email: string, password: string) {
        const user = await this.userService.getInfoByEmail(email);
        if (!user) return null;
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return null;
        return user;
    }

    // tạo access token (15 phút) và refresh token (7 ngày)
    private createTokens(user: {_id: any; name: string; avatar?: string | null; email: string}) {
        const payload = {
            sub: user._id.toString(),
            name: user.name,
            avatar: user.avatar,
            email: user.email
        };

        const accessToken = this.jwtService.sign(payload, {expiresIn: "15m"});
        const refreshToken = this.jwtService.sign(
            {...payload, jti: randomUUID()},
            {secret: this.getConfigSecretRefresh(), expiresIn: "7d"}
        );
        return {payload, accessToken, refreshToken};
    }

    // băm refresh token bằng sha-256 (bcrypt chỉ đọc 72 ký tự đầu nên các jwt bị coi là trùng)
    private hashRefreshToken(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    // so sánh refresh token, vẫn nhận giá trị bcrypt cũ ("$2") rồi đổi sang sha-256
    private async isRefreshTokenValid(token: string, stored: string): Promise<boolean> {
        if (stored.startsWith("$2")) {
            return bcrypt.compare(token, stored);
        }
        const a = Buffer.from(this.hashRefreshToken(token));
        const b = Buffer.from(stored);
        return a.length === b.length && timingSafeEqual(a, b);
    }

    public async login(user: UserDocument) {
        const {payload, accessToken, refreshToken} = this.createTokens(user);
        await this.userService.updateRefreshToken(payload.sub, this.hashRefreshToken(refreshToken));

        // không trả mật khẩu về client
        const {password: _password, ...safeUser} = user as any;
        return {
            accessToken,
            refreshToken,
            user: safeUser
        };
    }

    public async refresh(refreshToken: string) {
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.getConfigSecretRefresh(),
            });

            const user = await this.userService.findById(payload.sub);
            if (!user || !user.refreshToken) {
                throw new UnauthorizedException("Phiên đăng nhập không hợp lệ");
            }

            const isValid = await this.isRefreshTokenValid(refreshToken, user.refreshToken);
            if (!isValid) {
                throw new UnauthorizedException("Refresh token đã bị dùng lại hoặc không hợp lệ");
            }

            // mỗi lần làm mới cấp token mới và thu hồi token cũ
            const tokens = this.createTokens(user);
            await this.userService.updateRefreshToken(
                tokens.payload.sub,
                this.hashRefreshToken(tokens.refreshToken)
            );
            return {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            };
        } catch {
            throw new UnauthorizedException("Refresh token không hợp lệ");
        }
    }

    private getConfigSecretRefresh() {
        return this.configService.get<string>("JWT_SECRET_REFRESH")
    }

    public async logout(userId: string) {
        await this.userService.updateRefreshToken(userId, null);
        return {
            "message": "Logout successfully",
        };
    }
}
