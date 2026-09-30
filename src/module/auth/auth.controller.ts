import {Body, Controller, HttpCode, Post, UseGuards} from "@nestjs/common";
import {Throttle} from "@nestjs/throttler";

import {InputRegisterUserDto} from "./dto/inputRegister.dto";
import {AuthService} from "./auth.service";

import {LocalAuthGuard} from "./guards/local-auth.guard";
import {JwtAuthGuard} from "./guards/jwt-auth.guard";

import {UserDocument} from "../user/schema/user.schema";
import {User} from "../../common/decorators/user.decorator";
import {JwtDecode} from "../../common/decorators/jwt.decorator";
import {JwtType} from "../../shared/types/jwtTypes.type";

@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService
    ) {
    }

    // Đăng ký: tối đa 10 lần mỗi 10 phút cho mỗi IP để chặn tạo tài khoản hàng loạt
    @Throttle({default: {limit: 10, ttl: 600000}})
    @Post("register")
    public async register(@Body() body: InputRegisterUserDto) {
        return this.authService.register(body);
    }

    // Đăng nhập: tối đa 20 lần mỗi phút cho mỗi IP để hạn chế dò mật khẩu
    @UseGuards(LocalAuthGuard)
    @Throttle({default: {limit: 20, ttl: 60000}})
    @Post("login")
    public async login(@User() user: UserDocument) {
        return this.authService.login(user);
    }

    // Làm mới token: tối đa 30 lần mỗi phút cho mỗi IP
    @Throttle({default: {limit: 30, ttl: 60000}})
    @Post("refresh")
    public async refresh(@Body("refreshToken") refreshToken: string) {
        return this.authService.refresh(refreshToken);
    }

    @UseGuards(JwtAuthGuard)
    @Post("logout")
    public async logout(@JwtDecode() user: JwtType) {
        return this.authService.logout(user.userId);
    }
}