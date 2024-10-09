import { assertEquals, assertRejects } from '@std/assert';
import { assertSpyCall, spy } from '@std/testing/mock';
import { LABELS } from '../src/labels.ts';
import { CATEGORY_PREFIXES, Category } from '../src/schemas.ts';

class MockBattlemaster {
    private labelerServer: any;
    private agent: any;

    constructor() {
        this.labelerServer = {
            did: 'did:plc:7iza6de2dwap2sbkpav7c6c6',
            createLabels: spy(() => Promise.resolve([])),
            createLabel: spy(() => Promise.resolve({})),
            db: {
                prepare: () => ({
                    all: () => [
                        { val: 'pvp', neg: false },
                        { val: 'pve', neg: false },
                        { val: 'rp', neg: false },
                        { val: 'pvp', neg: true },
                    ],
                }),
            },
        };
        this.agent = {
            login: spy(() => Promise.resolve({})),
        };
    }

    async init(): Promise<void> {
        await this.agent.login({
            identifier: 'test-handle',
            password: 'test-password',
        });
        console.log('Battlemaster initialized');
    }

    async label(subject: string, rkey: string): Promise<void> {
        if (rkey === 'self') {
            console.log(`Self-labeling detected for ${subject}. No action taken.`);
            return;
        }

        const currentLabels = this.fetchCurrentLabels(subject);
        await this.addOrUpdateLabel(subject, rkey, currentLabels);
    }

    private fetchCurrentLabels(did: string): Record<Category, Set<string>> {
        const labelCategories: Record<Category, Set<string>> = {
            pvp: new Set(['pvp']),
            pve: new Set(['pve']),
            rp: new Set(['rp']),
        };
        return labelCategories;
    }

    private async addOrUpdateLabel(
        subject: string,
        rkey: string,
        _labelCategories: Record<Category, Set<string>>,
    ): Promise<void> {
        const newLabel = this.findLabelByPost(rkey);
        if (!newLabel) {
            console.log(`No matching label found for rkey: ${rkey}`);
            return;
        }

        const category = await this.getCategoryFromLabel(newLabel.identifier);
        await this.labelerServer.createLabel({
            uri: subject,
            val: newLabel.identifier,
            category: category,
        });
    }

    private findLabelByPost(rkey: string): { identifier: string } | undefined {
        return LABELS.find((label) => label.rkey === rkey);
    }

    private async getCategoryFromLabel(label: string): Promise<Category> {
        if (Object.keys(CATEGORY_PREFIXES).includes(label)) {
            return label as Category;
        }
        throw new Error(`Invalid label: ${label}`);
    }
}

Deno.test('Battlemaster', async (t) => {
    await t.step('init', async () => {
        const battlemaster = new MockBattlemaster();
        await battlemaster.init();
        assertSpyCall(battlemaster['agent'].login, 0);
    });

    await t.step('label - self labeling', async () => {
        const battlemaster = new MockBattlemaster();
        const consoleSpy = spy(console, 'log');
        await battlemaster.label('did:plc:7iza6de2dwap2sbkpav7c6c6', 'self');
        assertSpyCall(consoleSpy, 0, {
            args: ['Self-labeling detected for did:plc:7iza6de2dwap2sbkpav7c6c6. No action taken.'],
        });
        consoleSpy.restore();
    });

    await t.step('label - successful labeling', async () => {
        const battlemaster = new MockBattlemaster();
        await battlemaster.label('did:plc:7iza6de2dwap2sbkpav7c6c6', '3jzfcijpj2z2a');
        assertSpyCall(battlemaster['labelerServer'].createLabel, 0);
    });

    await t.step('findLabelByPost', () => {
        const battlemaster = new MockBattlemaster();
        const result = battlemaster['findLabelByPost'](LABELS[0].rkey);
        assertEquals(result, LABELS[0]);
        const notFound = battlemaster['findLabelByPost']('3jzfcijpj222a');
        assertEquals(notFound, undefined);
    });

    await t.step('getCategoryFromLabel', async () => {
        const battlemaster = new MockBattlemaster();
        const validLabels = ['pvp', 'pve', 'rp'];
        for (const label of validLabels) {
            const result = await battlemaster['getCategoryFromLabel'](label);
            assertEquals(result, label);
        }
    });

    await t.step('getCategoryFromLabel - invalid label', async () => {
        const battlemaster = new MockBattlemaster();

        await assertRejects(
            async () => {
                await battlemaster['getCategoryFromLabel']('invalid-label');
            },
            Error,
            'Invalid label: invalid-label'
        );
    });
});