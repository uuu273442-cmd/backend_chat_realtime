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
        // Kiểm tra mật khẩu trước vì không cần truy vấn database
        if (dto.password !== dto.passwordConfirm) {
            throw new ConflictException("Passwords do not match");
        }

        // Hai truy vấn độc lập nên chạy song song để nhanh hơn
        const [existEmail, existPhoneNumber] = await Promise.all([
            this.userService.findByEmail(dto.email),
            this.userService.findByPhoneNumber(dto.phoneNumber),
        ]);
        if (existEmail) {
            throw new ConflictException("Email already exists");
        }
        if (existPhoneNumber) {
            throw new ConflictException("Phone number already exists");
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

    // Tạo access token (15 phút) và refresh token (7 ngày).
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

    // Refresh token được băm bằng SHA-256 trước khi lưu vào database.
    // Không dùng bcrypt vì bcrypt chỉ đọc 72 ký tự đầu, phần đầu của mọi JWT
    // cùng một người dùng giống nhau nên các token khác nhau bị coi là trùng.
    private hashRefreshToken(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    // So sánh refresh token gửi lên với giá trị đã lưu.
    // Giá trị bcrypt cũ (bắt đầu bằng "$2") vẫn được chấp nhận một lần
    // và sẽ được thay bằng SHA-256 khi token được làm mới.
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

        // Không trả mật khẩu đã băm về cho client
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
                throw new UnauthorizedException();
            }

            const isValid = await this.isRefreshTokenValid(refreshToken, user.refreshToken);
            if (!isValid) {
                throw new UnauthorizedException("Refresh token reused or invalid");
            }

            // Mỗi lần làm mới sẽ cấp cặp token mới và thu hồi token cũ
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
            throw new UnauthorizedException("Invalid refresh token");
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
