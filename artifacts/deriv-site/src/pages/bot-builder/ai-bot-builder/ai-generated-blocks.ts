import type { AiGeneratedBlock } from '@workspace/api-client-react';

type MethodSpec = {
    outputType: AiGeneratedBlock['outputType'];
    parameters: Array<'number' | 'string'>;
};

type BlocklyLike = {
    Blocks: Record<string, any>;
    JavaScript: {
        javascriptGenerator: {
            ORDER_ATOMIC: number;
            ORDER_FUNCTION_CALL: number;
            forBlock: Record<string, (block: any) => string | [string, number]>;
            valueToCode: (block: any, name: string, order: number) => string;
        };
    };
    Colours?: { Base?: { colour?: string; colourSecondary?: string; colourTertiary?: string } };
    Categories?: { Tick_Analysis?: string; Before_Purchase?: string };
    OUTPUT_SHAPE_ROUND?: number;
    derivWorkspace?: {
        options?: { languageTree?: Element };
        updateToolbox?: (toolbox: Element) => void;
    };
};

const METHODS: Record<AiGeneratedBlock['method'], MethodSpec> = {
    checkLastDigitsCondition: { outputType: 'Boolean', parameters: ['string', 'number', 'number'] },
    checkLastNTicksDirection: { outputType: 'Boolean', parameters: ['string', 'number'] },
    getDigitPercentage: { outputType: 'Number', parameters: ['number', 'number', 'string'] },
    getDirectionPercentage: { outputType: 'Number', parameters: ['string', 'number'] },
    getLastDigit: { outputType: 'Number', parameters: [] },
    getMostFrequentDigit: { outputType: 'Number', parameters: ['number', 'string'] },
    getNthLastDigit: { outputType: 'Number', parameters: ['number'] },
    getParityPercentage: { outputType: 'Number', parameters: ['string', 'number'] },
    getSignalConfidence: { outputType: 'Number', parameters: ['string', 'number'] },
    purchase: { outputType: 'Statement', parameters: ['string', 'number'] },
};

const METHOD_OPTIONS: Partial<Record<AiGeneratedBlock['method'], Record<number, string[]>>> = {
    checkLastDigitsCondition: {
        0: ['ALL_ODD', 'ALL_EVEN', 'LESS_THAN', 'LESS_OR_EQUAL', 'GREATER_THAN', 'GREATER_OR_EQUAL'],
    },
    checkLastNTicksDirection: { 0: ['rise', 'fall'] },
    getDigitPercentage: { 2: ['match', 'differ'] },
    getDirectionPercentage: { 0: ['rise', 'fall'] },
    getMostFrequentDigit: { 1: ['most', 'second_most', 'least', 'second_least'] },
    getParityPercentage: { 0: ['even', 'odd'] },
    getSignalConfidence: { 0: ['CALL', 'PUT'] },
    purchase: {
        0: ['CALL', 'PUT', 'DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD'],
    },
};

const registeredDefinitions = new Map<string, string>();
const toolboxEntries = new Map<string, { category: Element; block: Element }>();

function assertBlockDefinitions(value: unknown): AiGeneratedBlock[] {
    if (!Array.isArray(value) || value.length > 8) {
        throw new Error('The strategy returned an invalid custom block list.');
    }

    const definitions = value as AiGeneratedBlock[];
    const types = new Set<string>();
    for (const definition of definitions) {
        if (
            !definition ||
            typeof definition !== 'object' ||
            !/^ai_[a-z0-9_]{1,48}$/.test(definition.type) ||
            types.has(definition.type) ||
            typeof definition.message !== 'string' ||
            typeof definition.tooltip !== 'string' ||
            !Array.isArray(definition.arguments) ||
            !Array.isArray(definition.bindings)
        ) {
            throw new Error('The strategy returned an invalid custom block definition.');
        }
        types.add(definition.type);

        const method = METHODS[definition.method];
        if (!method || method.outputType !== definition.outputType || definition.arguments.length > 6) {
            throw new Error(`The custom block "${definition.type}" uses an unsupported operation.`);
        }

        const placeholders = [...definition.message.matchAll(/%(\d+)/g)].map(match => Number(match[1]));
        if (
            placeholders.length !== definition.arguments.length ||
            placeholders.some((index, position) => index !== position + 1) ||
            definition.bindings.length !== method.parameters.length
        ) {
            throw new Error(`The custom block "${definition.type}" has invalid message placeholders or bindings.`);
        }

        const argsByName = new Map<string, AiGeneratedBlock['arguments'][number]>();
        for (const argument of definition.arguments) {
            if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(argument.name) || argsByName.has(argument.name)) {
                throw new Error(`The custom block "${definition.type}" has invalid input names.`);
            }
            argsByName.set(argument.name, argument);
            if (argument.kind === 'value') {
                if (argument.check !== 'Number' || argument.defaultValue !== null || argument.options.length !== 0) {
                    throw new Error(`The custom block "${definition.type}" has an unsafe value input.`);
                }
            } else if (argument.kind === 'number') {
                if (
                    argument.check !== null ||
                    typeof argument.defaultValue !== 'number' ||
                    !Number.isFinite(argument.defaultValue) ||
                    argument.defaultValue < 0 ||
                    argument.defaultValue > 10000 ||
                    argument.options.length !== 0
                ) {
                    throw new Error(`The custom block "${definition.type}" has an invalid number field.`);
                }
            } else if (argument.kind === 'dropdown') {
                const options = argument.options.map(option => option.value);
                if (
                    argument.check !== null ||
                    typeof argument.defaultValue !== 'string' ||
                    argument.options.length < 2 ||
                    new Set(options).size !== options.length ||
                    !options.includes(argument.defaultValue)
                ) {
                    throw new Error(`The custom block "${definition.type}" has an invalid dropdown.`);
                }
            } else {
                throw new Error(`The custom block "${definition.type}" uses an unsupported input type.`);
            }
        }

        definition.bindings.forEach((binding, index) => {
            const argument = argsByName.get(binding.name);
            const parameterType =
                argument?.kind === 'value' || argument?.kind === 'number'
                    ? 'number'
                    : argument?.kind === 'dropdown'
                      ? 'string'
                      : undefined;
            const source = argument?.kind === 'value' ? 'input' : 'field';
            if (!argument || binding.source !== source || parameterType !== method.parameters[index]) {
                throw new Error(`The custom block "${definition.type}" has an unsafe operation binding.`);
            }
            if (argument.kind === 'dropdown') {
                const allowedOptions = METHOD_OPTIONS[definition.method]?.[index] || [];
                if (argument.options.some(option => !allowedOptions.includes(option.value))) {
                    throw new Error(`The custom block "${definition.type}" has unsupported dropdown values.`);
                }
            }
        });

        if (
            definition.method === 'purchase' &&
            (!definition.arguments.some(argument => argument.kind === 'dropdown') ||
                !definition.arguments.some(argument => argument.kind === 'value' || argument.kind === 'number'))
        ) {
            throw new Error(`The custom purchase block "${definition.type}" is missing its contract inputs.`);
        }
    }
    return definitions;
}

function getBlockly(): BlocklyLike {
    const Blockly = (window as any).Blockly as BlocklyLike | undefined;
    if (!Blockly?.Blocks || !Blockly.JavaScript?.javascriptGenerator) {
        throw new Error('Blockly is not ready to register AI-generated blocks.');
    }
    return Blockly;
}

function getFieldFallback(argument: AiGeneratedBlock['arguments'][number]): string {
    if (argument.kind === 'number') {
        return String(typeof argument.defaultValue === 'number' ? argument.defaultValue : 0);
    }
    if (argument.kind === 'dropdown') {
        return JSON.stringify(typeof argument.defaultValue === 'string' ? argument.defaultValue : '');
    }
    return '0';
}

function makeGenerator(definition: AiGeneratedBlock, Blockly: BlocklyLike) {
    const generator = Blockly.JavaScript.javascriptGenerator;
    return (block: any): string | [string, number] => {
        const args = definition.bindings.map(binding => {
            const argument = definition.arguments.find(item => item.name === binding.name)!;
            if (binding.source === 'input') {
                return (
                    generator.valueToCode(block, binding.name, generator.ORDER_ATOMIC) ||
                    getFieldFallback(argument)
                );
            }
            if (argument.kind === 'number') {
                const value = Number(block.getFieldValue(binding.name));
                return String(Number.isFinite(value) ? value : argument.defaultValue ?? 0);
            }
            return JSON.stringify(String(block.getFieldValue(binding.name) ?? argument.defaultValue ?? ''));
        });
        const expression = `Bot.${definition.method}(${args.join(', ')})`;
        if (definition.outputType === 'Statement') return `${expression};\n`;
        return [expression, generator.ORDER_FUNCTION_CALL];
    };
}

function addToolboxEntry(type: string): void {
    const Blockly = getBlockly();
    const workspace = Blockly.derivWorkspace;
    const tree = workspace?.options?.languageTree;
    if (!workspace || !tree || toolboxEntries.has(type)) return;

    const namespace = tree.namespaceURI || 'http://www.w3.org/1999/xhtml';
    let category = Array.from(tree.children).find(
        child => child.localName === 'category' && child.getAttribute('id') === 'ai_generated',
    );
    if (!category) {
        category = document.createElementNS(namespace, 'category');
        category.setAttribute('id', 'ai_generated');
        category.setAttribute('name', 'AI generated');
        tree.appendChild(category);
    }
    const block = document.createElementNS(namespace, 'block');
    block.setAttribute('type', type);
    category.appendChild(block);
    toolboxEntries.set(type, { category, block });
    workspace.updateToolbox?.(tree);
}

function removeToolboxEntry(type: string): void {
    const Blockly = getBlockly();
    const entry = toolboxEntries.get(type);
    if (!entry) return;
    entry.category.removeChild(entry.block);
    if (entry.category.children.length === 0) entry.category.parentElement?.removeChild(entry.category);
    toolboxEntries.delete(type);
    const tree = Blockly.derivWorkspace?.options?.languageTree;
    if (tree) Blockly.derivWorkspace?.updateToolbox?.(tree);
}

function registerOne(definition: AiGeneratedBlock, Blockly: BlocklyLike): void {
    const serialized = JSON.stringify(definition);
    const prior = registeredDefinitions.get(definition.type);
    if (prior && prior !== serialized) {
        throw new Error(`The AI-generated block "${definition.type}" conflicts with a registered definition.`);
    }
    if (prior) return;
    if (Blockly.Blocks[definition.type]) {
        throw new Error(`The AI-generated block type "${definition.type}" is already in use.`);
    }

    const generator = Blockly.JavaScript.javascriptGenerator;
    const category =
        definition.outputType === 'Statement'
            ? Blockly.Categories?.Before_Purchase || 'Before Purchase'
            : Blockly.Categories?.Tick_Analysis || 'Tick Analysis';
    Blockly.Blocks[definition.type] = {
        init(this: any) {
            const args0 = definition.arguments.map(argument => {
                if (argument.kind === 'value') {
                    return { type: 'input_value', name: argument.name, check: argument.check };
                }
                if (argument.kind === 'number') {
                    return {
                        type: 'field_number',
                        name: argument.name,
                        value: argument.defaultValue,
                        min: 0,
                        max: 10000,
                        precision: 1,
                    };
                }
                return {
                    type: 'field_dropdown',
                    name: argument.name,
                    options: argument.options.map(option => [option.label, option.value]),
                };
            });
            this.jsonInit({
                message0: definition.message,
                args0,
                ...(definition.outputType === 'Statement'
                    ? { previousStatement: null }
                    : {
                          output: definition.outputType,
                          outputShape: Blockly.OUTPUT_SHAPE_ROUND,
                      }),
                colour: Blockly.Colours?.Base?.colour || '#087e8b',
                colourSecondary: Blockly.Colours?.Base?.colourSecondary || '#076b75',
                colourTertiary: Blockly.Colours?.Base?.colourTertiary || '#05555e',
                tooltip: definition.tooltip,
                category,
            });
            this.setInputsInline(true);
        },
        meta() {
            return { display_name: definition.message, description: definition.tooltip };
        },
    };
    generator.forBlock[definition.type] = makeGenerator(definition, Blockly);
    try {
        addToolboxEntry(definition.type);
        registeredDefinitions.set(definition.type, serialized);
    } catch (error) {
        delete Blockly.Blocks[definition.type];
        delete generator.forBlock[definition.type];
        removeToolboxEntry(definition.type);
        throw error;
    }
}

/**
 * Registers validated declarative blocks and returns an undo function for a
 * failed strategy preflight. Runtime code is always generated from the fixed
 * Bot method allowlist above; AI output is never evaluated as JavaScript.
 */
export function registerAiGeneratedBlocks(value: unknown): () => void {
    const definitions = assertBlockDefinitions(value);
    if (definitions.length === 0) return () => {};
    const Blockly = getBlockly();
    const newlyRegistered: string[] = [];
    try {
        for (const definition of definitions) {
            const existed = registeredDefinitions.has(definition.type);
            registerOne(definition, Blockly);
            if (!existed) newlyRegistered.push(definition.type);
        }
    } catch (error) {
        for (const type of newlyRegistered.reverse()) {
            delete Blockly.Blocks[type];
            delete Blockly.JavaScript.javascriptGenerator.forBlock[type];
            registeredDefinitions.delete(type);
            removeToolboxEntry(type);
        }
        throw error;
    }

    return () => {
        for (const type of newlyRegistered.reverse()) {
            delete Blockly.Blocks[type];
            delete Blockly.JavaScript.javascriptGenerator.forBlock[type];
            registeredDefinitions.delete(type);
            removeToolboxEntry(type);
        }
    };
}

export function validateAiGeneratedBlocks(value: unknown): AiGeneratedBlock[] {
    return assertBlockDefinitions(value);
}

export function getAiGeneratedBlockDefinition(type: string): AiGeneratedBlock | undefined {
    const serialized = registeredDefinitions.get(type);
    return serialized ? (JSON.parse(serialized) as AiGeneratedBlock) : undefined;
}
