import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class updateProfileDto {
    @IsOptional()
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(11)
    @MinLength(10)
    phone!: string;
    
    @IsEmail()
    @IsOptional()
    email!: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    bio!: string;
}