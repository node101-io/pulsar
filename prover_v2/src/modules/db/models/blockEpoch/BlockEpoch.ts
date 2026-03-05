import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBlockEpoch extends Document {
    height: number;
    blocks: (Types.ObjectId | null)[];
}

const BlockEpochSchema = new Schema<IBlockEpoch>(
    {
        height: { type: Number, required: true, unique: true, index: true },
        blocks: [
            {
                type: Schema.Types.ObjectId,
                ref: "Block",
                default: null,
            },
        ],
    },
    { timestamps: true },
);

export const BlockEpochModel = mongoose.model<IBlockEpoch>(
    "BlockEpoch",
    BlockEpochSchema,
);
