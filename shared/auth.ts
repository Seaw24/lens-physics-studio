import { z } from "zod";

export const PublicUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().min(1).max(80),
    createdAt: z.string().datetime(),
  })
  .strict();

export type PublicUser = z.infer<typeof PublicUserSchema>;

export const RegisterRequestSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const LoginRequestSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
