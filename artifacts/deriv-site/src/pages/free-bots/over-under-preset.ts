export interface OverUnderPreset {
    direction: 'OVER' | 'UNDER';
    barrier: number;
}

export function applyOverUnderPreset(xmlText: string, preset: OverUnderPreset): string {
    if (!Number.isInteger(preset.barrier) || preset.barrier < 0 || preset.barrier > 9) {
        throw new Error(`Invalid Over/Under digit barrier: ${preset.barrier}`);
    }

    const document = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (document.querySelector('parsererror')) {
        throw new Error('The Over/Under bot template contains invalid XML.');
    }

    const setField = (blockId: string, fieldName: string, value: string) => {
        const block = Array.from(document.getElementsByTagName('block'))
            .find(candidate => candidate.getAttribute('id') === blockId);
        const field = block
            ? Array.from(block.getElementsByTagName('field'))
                .find(candidate => candidate.getAttribute('name') === fieldName)
            : undefined;
        if (!field) throw new Error(`The Over/Under template is missing ${blockId}.${fieldName}.`);
        field.textContent = value;
    };

    setField('ou_contracttype', 'TYPE_LIST', `DIGIT${preset.direction}`);
    setField('ou_dir_text_val', 'TEXT', preset.direction);
    setField('ou_barrier_num', 'NUM', String(preset.barrier));
    setField('ou_ep_num', 'NUM', String(preset.barrier));

    return new XMLSerializer().serializeToString(document);
}
