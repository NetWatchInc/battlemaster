import { z } from 'zod';

export const LocaleSchema = z.object({
	lang: z.string().min(2),
	name: z.string().min(1),
	description: z.string().min(1),
});

export const LabelSchema = z.object({
	rkey: z.string().length(13),
	identifier: z.string().min(1),
	locales: z.array(LocaleSchema).nonempty(),
});

export const LabelValueDefinitionSchema = z.object({
	identifier: z.string().min(1),
	severity: z.enum(['inform', 'alert', 'none']),
	blurs: z.enum(['content', 'media', 'none']),
	defaultSetting: z.enum(['ignore', 'warn', 'hide']),
	adultOnly: z.boolean(),
	locales: z.array(LocaleSchema).nonempty(),
});

export const ConfigSchema = z.object({
	DID: z.string().min(1),
	SIGNING_KEY: z.string().min(1),
	JETSTREAM_URL: z.string().url().default(
		'wss://jetstream.atproto.tools/subscribe',
	),
	COLLECTION: z.string().min(1).default('app.bsky.feed.like'),
	CURSOR_INTERVAL: z.number().int().positive().default(100000),
	BSKY_HANDLE: z.string().min(1),
	BSKY_PASSWORD: z.string().min(1),
});

export type Locale = z.infer<typeof LocaleSchema>;
export type Label = z.infer<typeof LabelSchema>;
export type LabelValueDefinition = z.infer<typeof LabelValueDefinitionSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type Category = 'pvp' | 'pve' | 'rp';
export const CATEGORY_PREFIXES: Record<Category, string> = {
	pvp: 'pvp',
	pve: 'pve',
	rp: 'rp',
};
