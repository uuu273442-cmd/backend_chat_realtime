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

    // đăng ký: 10 lần mỗi 10 phút
    @Throttle({default: {limit: 10, ttl: 600000}})
    @Post("register")
    public async register(@Body() body: InputRegisterUserDto) {
        return this.authService.register(body);
    }

    // đăng nhập: 20 lần mỗi phút
    @UseGuards(LocalAuthGuard)
    @Throttle({default: {limit: 20, ttl: 60000}})
    @Post("login")
    public async login(@User() user: UserDocument) {
        return this.authService.login(user);
    }

    // làm mới token: 30 lần mỗi phút
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