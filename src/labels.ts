import { z } from 'zod';
import { Label, LabelSchema } from './schemas.ts';

export const LABELS: readonly Label[] = [
	{
		rkey: 'rkey tbd',
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
		rkey: 'rkey tbd',
		identifier: 'pve',
		locales: [
			{
				lang: 'en',
				name: 'PvE 🛡️',
				description:
					"Not ready for the battlegrounds. You're just here to level professions in front of the auction house. Work work.",
			},
		],
	},
	{
		rkey: "'rkey tbd'",
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
