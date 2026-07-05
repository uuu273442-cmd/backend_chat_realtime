import {Prop, Schema, SchemaFactory} from "@nestjs/mongoose";
import {Document} from "mongoose";
import * as bcrypt from "bcrypt";

export class PrivacySettings {
    lastSeenVisibility: "everyone" | "friends" | "nobody" = "everyone";
    showReadReceipts: boolean = true;
    showTypingIndicator: boolean = true;
}

export type UserDocument = User & Document;

@Schema({timestamps: true})
export class User {
    @Prop({required: true, unique: true, lowercase: true, trim: true})
    email!: string;

    @Prop({required: true})
    password!: string;

    @Prop({required: true})
    phoneNumber!: string;

    @Prop({required: true})
    name!: string;

    @Prop({default: null})
    avatar?: string;

    @Prop({ type: String, default: null, maxlength: 150 })
    bio?: string | null;

    @Prop({
        type: String,
        enum: ["online", "away", "busy", "offline"],
        default: "offline",
    })
    status!: "online" | "away" | "busy" | "offline";

    @Prop({ type: String, default: null })
    customStatusMessage?: string | null;

    @Prop({
        type: {
            _id: false,
            lastSeenVisibility: {
                type: String,
                enum: ["everyone", "friends", "nobody"],
                default: "everyone",
            },
            showReadReceipts: { type: Boolean, default: true },
            showTypingIndicator: { type: Boolean, default: true },
        },
        default: () => ({
            lastSeenVisibility: "everyone",
            showReadReceipts: true,
            showTypingIndicator: true,
        }),
    })
    privacy!: {
        lastSeenVisibility: "everyone" | "friends" | "nobody";
        showReadReceipts: boolean;
        showTypingIndicator: boolean;
    };

    @Prop({default: null})
    lastSeen!: Date;

    @Prop({default: null})
    refreshToken?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre<UserDocument>("save", async function () {
    if (!this.isModified("password")) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.set("toJSON", {
    transform: (_, ret: any) => {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.phoneNumber;
        return ret;
    },
});

UserSchema.index({email: 1}, {unique: true});
UserSchema.index({phoneNumber: 1}, {unique: true});
UserSchema.index({name: "text"});