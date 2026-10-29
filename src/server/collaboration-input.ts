import { z } from "zod";
export const Join=z.object({roomId:z.string().min(12).max(64),lastSeq:z.number().int().nonnegative().default(0)}).strict();
export const MessageInput=z.object({clientId:z.string().min(8).max(100),content:z.string().trim().min(1).max(4000)}).strict();
export const AgentInput=z.object({prompt:z.string().trim().min(1).max(4000),model:z.string().min(1).max(140).optional(),agent:z.enum(["muse","gemini","llama","agent"]).optional(),idempotencyKey:z.string().min(8).max(100)}).strict();
export const ArtifactInput=z.object({id:z.string().min(8).max(80).optional(),title:z.string().trim().min(1).max(80),type:z.enum(["code","document"]),language:z.string().trim().min(1).max(32),content:z.string().max(50000),version:z.number().int().nonnegative(),overwrite:z.boolean().default(false)}).strict();
export const TypingInput=z.object({active:z.boolean()}).strict();
