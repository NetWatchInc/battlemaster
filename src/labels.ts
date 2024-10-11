import { z } from 'zod';
import { Label, LabelSchema } from './schemas.ts';

export const LABELS: readonly Label[] = [
	{
		rkey: '3jzfcijpj2z2a',
		identifier: 'pvp',
		locales: [
			{
				lang: 'en',
				name: 'PvP ⚔️',
				description:
					"A keyboard warrior who thrives in the trenches of the replies. May your wit be sharp and your words strike true. LOK'TAR OGAR!",
			},
		],
	},
	{
		rkey: '3jzfcijpj2z2b',
		identifier: 'pve',
		locales: [
			{
				lang: 'en',
				name: 'PvE 🛡️',
				description:
					"Not willing to queue up for battlegrounds. You're just here to level professions and browse some custom feeds. Work work.",
			},
		],
	},
	{
		rkey: '3jzfcijpj2z2c',
		identifier: 'rp',
		locales: [
			{
				lang: 'en',
				name: 'RP 🎭',
				description: 'The discourse was merely a setback!',
			},
		],
	},
] as const;

LABELS.forEach((label) => {
	LabelSchema.parse(label);
});

z.array(LabelSchema).parse(LABELS);
