import type { AiGeneratedBlock } from "@workspace/api-zod";

export type DigitTradeType = "DIGITOVER" | "DIGITUNDER";

export type DigitRuleIntent = {
  count: number;
  condition: string;
  threshold: number;
};

export type DigitContractIntent = {
  type: DigitTradeType;
  prediction: number;
};

export type StrategyIntent = {
  digitTradeTypes: DigitTradeType[];
  digitContracts: DigitContractIntent[];
  digitRules: DigitRuleIntent[];
  usesDigitOverUnder: boolean;
};

type ParsedBlock = {
  type: string;
  fields: Record<string, string>;
  parent?: ParsedBlock;
  parentInput?: string;
};

export class StrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyValidationError";
  }
}

type AiBlockParameterType = "number" | "string";
type AiBlockMethodSpec = {
  outputType: AiGeneratedBlock["outputType"];
  parameters: AiBlockParameterType[];
};

const AI_BLOCK_METHODS: Record<AiGeneratedBlock["method"], AiBlockMethodSpec> = {
  checkLastDigitsCondition: { outputType: "Boolean", parameters: ["string", "number", "number"] },
  checkLastNTicksDirection: { outputType: "Boolean", parameters: ["string", "number"] },
  getDigitPercentage: { outputType: "Number", parameters: ["number", "number", "string"] },
  getDirectionPercentage: { outputType: "Number", parameters: ["string", "number"] },
  getLastDigit: { outputType: "Number", parameters: [] },
  getMostFrequentDigit: { outputType: "Number", parameters: ["number", "string"] },
  getNthLastDigit: { outputType: "Number", parameters: ["number"] },
  getParityPercentage: { outputType: "Number", parameters: ["string", "number"] },
  getSignalConfidence: { outputType: "Number", parameters: ["string", "number"] },
  purchase: { outputType: "Statement", parameters: ["string", "number"] },
};

const AI_BLOCK_METHOD_OPTIONS: Partial<Record<AiGeneratedBlock["method"], Record<number, string[]>>> = {
  checkLastDigitsCondition: {
    0: ["ALL_ODD", "ALL_EVEN", "LESS_THAN", "LESS_OR_EQUAL", "GREATER_THAN", "GREATER_OR_EQUAL"],
  },
  checkLastNTicksDirection: { 0: ["rise", "fall"] },
  getDigitPercentage: { 2: ["match", "differ"] },
  getDirectionPercentage: { 0: ["rise", "fall"] },
  getMostFrequentDigit: { 1: ["most", "second_most", "least", "second_least"] },
  getParityPercentage: { 0: ["even", "odd"] },
  getSignalConfidence: { 0: ["CALL", "PUT"] },
  purchase: {
    0: ["CALL", "PUT", "DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF", "DIGITEVEN", "DIGITODD"],
  },
};

/**
 * AI-created blocks are declarative wrappers over a small, audited Bot API.
 * Model output never supplies JavaScript source or Blockly mutation callbacks.
 */
export function validateAiGeneratedBlocks(value: unknown): AiGeneratedBlock[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new StrategyValidationError("The strategy returned an invalid custom block list.");
  }

  const definitions = value as AiGeneratedBlock[];
  const seenTypes = new Set<string>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== "object") {
      throw new StrategyValidationError("The strategy returned an invalid custom block definition.");
    }
    if (
      typeof definition.type !== "string" ||
      typeof definition.message !== "string" ||
      typeof definition.tooltip !== "string" ||
      !Array.isArray(definition.arguments) ||
      !Array.isArray(definition.bindings) ||
      !/^ai_[a-z0-9_]{1,48}$/.test(definition.type) ||
      seenTypes.has(definition.type)
    ) {
      throw new StrategyValidationError("AI-generated block types must be unique and use the ai_ prefix.");
    }
    seenTypes.add(definition.type);

    const method = AI_BLOCK_METHODS[definition.method];
    if (!method || definition.outputType !== method.outputType) {
      throw new StrategyValidationError(`The custom block "${definition.type}" has an unsupported operation.`);
    }
    if (
      !Array.isArray(definition.arguments) ||
      !Array.isArray(definition.bindings) ||
      definition.arguments.length > 6 ||
      definition.bindings.length !== method.parameters.length ||
      definition.arguments.length !== method.parameters.length
    ) {
      throw new StrategyValidationError(`The custom block "${definition.type}" has invalid inputs.`);
    }

    const placeholderIndexes = [...definition.message.matchAll(/%(\d+)/g)].map(match => Number(match[1]));
    if (
      placeholderIndexes.length !== definition.arguments.length ||
      placeholderIndexes.some((index, position) => index !== position + 1)
    ) {
      throw new StrategyValidationError(`The custom block "${definition.type}" has invalid message placeholders.`);
    }

    const argumentsByName = new Map<string, AiGeneratedBlock["arguments"][number]>();
    for (const argument of definition.arguments) {
      if (argumentsByName.has(argument.name)) {
        throw new StrategyValidationError(`The custom block "${definition.type}" has duplicate input names.`);
      }
      argumentsByName.set(argument.name, argument);

      if (argument.kind === "value") {
        if (argument.check !== "Number" || argument.defaultValue !== null || argument.options.length !== 0) {
          throw new StrategyValidationError(`The custom block "${definition.type}" has an unsafe value input.`);
        }
      } else if (argument.kind === "number") {
        if (
          argument.check !== null ||
          typeof argument.defaultValue !== "number" ||
          !Number.isFinite(argument.defaultValue) ||
          argument.defaultValue < 0 ||
          argument.defaultValue > 10000 ||
          argument.options.length !== 0
        ) {
          throw new StrategyValidationError(`The custom block "${definition.type}" has an invalid number field.`);
        }
      } else if (argument.kind === "dropdown") {
        const optionValues = argument.options.map(option => option.value);
        if (
          argument.check !== null ||
          typeof argument.defaultValue !== "string" ||
          argument.options.length < 2 ||
          new Set(optionValues).size !== optionValues.length ||
          !optionValues.includes(argument.defaultValue)
        ) {
          throw new StrategyValidationError(`The custom block "${definition.type}" has an invalid dropdown.`);
        }
      } else {
        throw new StrategyValidationError(`The custom block "${definition.type}" uses an unsupported input type.`);
      }
    }

    const boundNames = new Set<string>();
    definition.bindings.forEach((binding, index) => {
      if (!binding || typeof binding.name !== "string" || boundNames.has(binding.name)) {
        throw new StrategyValidationError(`The custom block "${definition.type}" has duplicate argument bindings.`);
      }
      boundNames.add(binding.name);
      const argument = argumentsByName.get(binding.name);
      const expectedType = method.parameters[index];
      const actualType =
        argument?.kind === "value" || argument?.kind === "number"
          ? "number"
          : argument?.kind === "dropdown"
            ? "string"
            : undefined;
      const expectedSource = argument?.kind === "value" ? "input" : "field";
      if (!argument || binding.source !== expectedSource || actualType !== expectedType) {
        throw new StrategyValidationError(`The custom block "${definition.type}" has an invalid operation binding.`);
      }

      if (argument.kind === "dropdown") {
        const allowedOptions = AI_BLOCK_METHOD_OPTIONS[definition.method]?.[index] || [];
        if (argument.options.some(option => !allowedOptions.includes(option.value))) {
          throw new StrategyValidationError(`The custom block "${definition.type}" has unsupported dropdown values.`);
        }
      }
    });

    if (
      definition.method === "purchase" &&
      (!definition.arguments.some(argument => argument.kind === "dropdown") ||
        !definition.arguments.some(argument => argument.kind === "value" || argument.kind === "number"))
    ) {
      throw new StrategyValidationError(`The custom purchase block "${definition.type}" is missing its contract inputs.`);
    }
  }

  return definitions;
}

export function validateBlocklyBlocksAvailable(xml: string, blockCatalog: string): void {
  const availableTypes = new Set(
    [...blockCatalog.matchAll(/<(?:block|shadow)\b[^>]*\btype=(["'])([^"']+)\1/gi)].map(
      match => match[2],
    ),
  );
  const requestedTypes = [
    ...xml.matchAll(/<(?:block|shadow)\b[^>]*\btype=(["'])([^"']+)\1/gi),
  ].map(match => match[2]);
  const unsupported = [...new Set(requestedTypes.filter(type => !availableTypes.has(type)))];

  if (unsupported.length > 0) {
    throw new StrategyValidationError(
      `The strategy used block types that are not in the active Bot Builder toolbox: ${unsupported.slice(0, 6).join(", ")}.`,
    );
  }
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const numberPattern = "(?:\\d+|" + Object.keys(NUMBER_WORDS).join("|") + ")";

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function getAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function parseBlocklyBlocks(xml: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const stack: ParsedBlock[] = [];
  const inputContexts: Array<string | undefined> = [];
  let activeInputName: string | undefined;
  const tokenPattern =
    /<\/?(?:block|shadow|value|statement)\b[^>]*>|<field\b[^>]*>[\s\S]*?<\/field>/gi;

  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    if (/^<\/(?:block|shadow)\b/i.test(token)) {
      stack.pop();
      continue;
    }

    if (/^<\/(?:value|statement)\b/i.test(token)) {
      activeInputName = inputContexts.pop();
      continue;
    }

    if (/^<(?:value|statement)\b/i.test(token)) {
      if (/\/\s*>$/.test(token)) continue;
      inputContexts.push(activeInputName);
      activeInputName = getAttribute(token, "name");
      continue;
    }

    if (/^<(?:block|shadow)\b/i.test(token)) {
      const block = {
        type: getAttribute(token, "type") || "",
        fields: {},
        parent: stack[stack.length - 1],
        parentInput: activeInputName,
      };
      blocks.push(block);
      if (!/\/>$/.test(token)) stack.push(block);
      continue;
    }

    const name = getAttribute(token.slice(0, token.indexOf(">") + 1), "name");
    const activeBlock = stack[stack.length - 1];
    if (name && activeBlock) {
      const start = token.indexOf(">") + 1;
      const end = token.toLowerCase().lastIndexOf("</field>");
      activeBlock.fields[name] = decodeXmlText(token.slice(start, end));
    }
  }

  return blocks;
}

function extractCatalogBlockTemplate(catalog: string, targetType: string): string | undefined {
  const blockTags = /<\/?block\b[^>]*>/gi;
  let depth = 0;
  let start = -1;

  for (const match of catalog.matchAll(blockTags)) {
    const tag = match[0];
    const offset = match.index ?? 0;
    if (/^<\//.test(tag)) {
      depth -= 1;
      if (depth === 0 && start >= 0) return catalog.slice(start, offset + tag.length);
      continue;
    }

    const type = getAttribute(tag, "type");
    if (start < 0 && type === targetType) {
      start = offset;
      if (/\/\s*>$/.test(tag)) return tag;
      depth = 1;
      continue;
    }
    if (start >= 0 && !/\/\s*>$/.test(tag)) depth += 1;
  }

  return undefined;
}

/**
 * Start every generation from the live toolbox's complete root-block templates.
 * The model fills this scaffold with the requested trade logic instead of having
 * to invent mandatory DBot sections from scratch.
 */
export function buildBotScaffold(blockCatalog: string): string {
  const roots = ["trade_definition", "before_purchase", "after_purchase"].map(type => {
    const template = extractCatalogBlockTemplate(blockCatalog, type);
    if (!template) {
      throw new StrategyValidationError(
        `The active Bot Builder toolbox is missing the required "${type}" root block.`,
      );
    }
    return template;
  });

  const tradeOptions = extractCatalogBlockTemplate(blockCatalog, "trade_definition_tradeoptions");
  if (!tradeOptions) {
    throw new StrategyValidationError(
      'The active Bot Builder toolbox is missing the required "trade_definition_tradeoptions" block.',
    );
  }
  const tradeDefinition = roots[0].replace(
    /<\/block>\s*$/,
    `<statement name="SUBMARKET">${tradeOptions}</statement></block>`,
  );
  if (tradeDefinition === roots[0]) {
    throw new StrategyValidationError("The active trade_definition template could not be completed.");
  }

  return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">${[
    tradeDefinition,
    roots[1],
    roots[2],
  ].join("")}</xml>`;
}

export function validateRequiredBotSections(
  xml: string,
  customBlocks: AiGeneratedBlock[] = [],
): void {
  const root = xml.match(/^\s*<xml\b([^>]*)>/i);
  if (!root || !/\bis_dbot\s*=\s*(["'])true\1/i.test(root[1])) {
    throw new StrategyValidationError(
      'The generated Blockly document is missing required bot sections: the <xml> root must set is_dbot="true".',
    );
  }

  const topLevelTypes: string[] = [];
  let depth = 0;
  for (const match of xml.matchAll(/<\/?(?:block|shadow)\b[^>]*>/gi)) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && /^<block\b/i.test(tag)) {
      topLevelTypes.push(getAttribute(tag, "type") || "");
    }
    if (!/\/\s*>$/.test(tag)) depth += 1;
  }

  const blockTypes = parseBlocklyBlocks(xml).map(block => block.type);
  const requiredTypes = ["trade_definition", "before_purchase", "after_purchase"];
  const topLevelCounts = new Map(
    requiredTypes.map(type => [type, topLevelTypes.filter(topLevelType => topLevelType === type).length]),
  );
  const hasExactlyOneTopLevelOfEach = requiredTypes.every(type => topLevelCounts.get(type) === 1);
  const hasExactlyOneOfEach = requiredTypes.every(
    type => blockTypes.filter(blockType => blockType === type).length === 1,
  );
  const customPurchaseTypes = new Set(
    customBlocks.filter(block => block.method === "purchase").map(block => block.type),
  );
  const hasPurchase = blockTypes.some(
    type =>
      ["purchase", "apollo_purchase", "apollo_purchase2"].includes(type) ||
      customPurchaseTypes.has(type),
  );

  if (!hasExactlyOneTopLevelOfEach || !hasExactlyOneOfEach) {
    const counts = requiredTypes.map(type => `${type}=${topLevelCounts.get(type)}`).join(", ");
    throw new StrategyValidationError(
      `The generated Blockly document is missing required bot sections: expected exactly one top-level trade_definition, before_purchase, and after_purchase block (${counts}).`,
    );
  }
  if (!hasPurchase) {
    throw new StrategyValidationError(
      "The generated Blockly document is missing required bot sections: no purchase block was included in the strategy.",
    );
  }
}

export function validateStrategyBlockDefinitions(
  xml: string,
  customBlocks: AiGeneratedBlock[],
  availableTypes: Iterable<string>,
): void {
  const customTypesInXml = new Set(
    [...xml.matchAll(/<(?:block|shadow)\b[^>]*\btype=(["'])(ai_[a-z0-9_]{1,48})\1/gi)].map(
      match => match[2],
    ),
  );
  const definedCustomTypes = new Set(customBlocks.map(block => block.type));
  const missingDefinitions = [...customTypesInXml].filter(type => !definedCustomTypes.has(type));
  if (missingDefinitions.length > 0) {
    throw new StrategyValidationError(
      `The strategy is missing definitions for AI-generated blocks: ${missingDefinitions.slice(0, 4).join(", ")}.`,
    );
  }

  const typeSet = new Set(availableTypes);
  for (const block of customBlocks) typeSet.add(block.type);
  validateBlocklyBlocksAvailable(
    xml,
    [...typeSet].map(type => `<block type="${type}"/>`).join(""),
  );
}

function toNumber(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, normalized)) {
    return NUMBER_WORDS[normalized];
  }
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return undefined;
}

function inferDigitRules(text: string): DigitRuleIntent[] {
  const operatorPattern =
    "(less\\s+than\\s+or\\s+equal(?:\\s+to)?|at\\s+most|no\\s+more\\s+than|<=|≤|less\\s+than|below|under|greater\\s+than\\s+or\\s+equal(?:\\s+to)?|at\\s+least|no\\s+less\\s+than|>=|≥|greater\\s+than|above|over)";
  const expression = new RegExp(
    `\\blast\\s+(${numberPattern})\\s+digits?\\s+(?:are|is)?\\s*${operatorPattern}\\s+(?:the\\s+)?(?:digit\\s+)?(${numberPattern})\\b`,
    "gi",
  );
  const rules: DigitRuleIntent[] = [];

  for (const match of text.matchAll(expression)) {
    const count = toNumber(match[1]);
    const operator = match[2].replace(/\\s+/g, " ").toLowerCase();
    const threshold = toNumber(match[3]);
    if (count === undefined || threshold === undefined) continue;

    const condition =
      /^(?:less than|below|under)$/.test(operator)
        ? "LESS_THAN"
        : /^(?:less than or equal(?: to)?|at most|no more than|<=|≤)$/.test(operator)
          ? "LESS_OR_EQUAL"
          : /^(?:greater than|above|over)$/.test(operator)
            ? "GREATER_THAN"
            : /^(?:greater than or equal(?: to)?|at least|no less than|>=|≥)$/.test(operator)
              ? "GREATER_OR_EQUAL"
              : "";
    if (condition) rules.push({ count, condition, threshold });
  }

  return rules;
}

/**
 * Detect explicit digit Over/Under contract requests so the model cannot silently
 * fall back to its common Rise/Fall template.
 */
export function inferStrategyIntent(prompt: string): StrategyIntent {
  const text = prompt.replace(/[’']/g, "'").toLowerCase();
  const explicitlyMentionsDigits = /\b(?:digits?|last\s+(?:\d+|[a-z]+)\s+digits?)\b/.test(text);
  const namesOverUnderBot = new RegExp(
    `\\b(?:over|under)\\s+${numberPattern}\\s+(?:digit\\s+)?bot\\b`,
  ).test(text);
  const hasDigitContext = explicitlyMentionsDigits || namesOverUnderBot;
  if (!hasDigitContext) {
    return {
      digitTradeTypes: [],
      digitContracts: [],
      digitRules: [],
      usesDigitOverUnder: false,
    };
  }

  const mentions: Array<DigitContractIntent & { index: number }> = [];
  const expression = new RegExp(`\\b(over|under)\\s+(${numberPattern})\\b`, "g");
  for (const match of text.matchAll(expression)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 60), index);
    // "the last three digits are over five" is a condition, not a contract
    // selection. Keep "Over 4 when ..." / "Under 5 when ..." trade requests.
    if (/\blast\s+(?:\d+|[a-z]+)\s+digits?\s+(?:are|is)\s*$/.test(prefix)) continue;
    const type = match[1] === "over" ? "DIGITOVER" : "DIGITUNDER";
    const prediction = toNumber(match[2]);
    if (prediction !== undefined) mentions.push({ type, prediction, index });
  }

  const types = [...new Set(mentions.map(mention => mention.type))];
  return {
    digitTradeTypes: types,
    digitContracts: mentions.map(({ type, prediction }) => ({ type, prediction })),
    digitRules: inferDigitRules(text),
    usesDigitOverUnder: types.length > 0,
  };
}

export function validateStrategyMatchesIntent(
  prompt: string,
  xml: string,
  customBlocks: AiGeneratedBlock[] = [],
): void {
  const intent = inferStrategyIntent(prompt);
  if (!intent.usesDigitOverUnder) return;

  const blocks = parseBlocklyBlocks(xml);
  const tradeType = blocks.find(
    block => block.type === "trade_definition_tradetype",
  );
  const contractType = blocks.find(
    block => block.type === "trade_definition_contracttype",
  );
  const category = tradeType?.fields.TRADETYPECAT_LIST?.toLowerCase();
  const tradeName = tradeType?.fields.TRADETYPE_LIST?.toLowerCase();

  if (category !== "digits" || tradeName !== "overunder") {
    throw new StrategyValidationError(
      "The strategy did not use the requested digit Over/Under contract family.",
    );
  }

  const selectedContract = contractType?.fields.TYPE_LIST?.toUpperCase();
  if (
    intent.digitTradeTypes.length > 1 &&
    selectedContract !== "BOTH"
  ) {
    throw new StrategyValidationError(
      "The strategy must enable both Over and Under contracts requested by the prompt.",
    );
  }
  if (
    intent.digitTradeTypes.length === 1 &&
    selectedContract !== intent.digitTradeTypes[0] &&
    selectedContract !== "BOTH"
  ) {
    throw new StrategyValidationError(
      "The selected contract type does not match the requested digit direction.",
    );
  }

  const customBlocksByType = new Map(customBlocks.map(block => [block.type, block]));
  const purchaseBlocks = blocks.filter(
    block =>
      block.type === "apollo_purchase2" ||
      block.type === "apollo_purchase" ||
      customBlocksByType.get(block.type)?.method === "purchase",
  );
  const customBindingValue = (
    block: ParsedBlock,
    binding: AiGeneratedBlock["bindings"][number],
  ): string | number | undefined => {
    if (binding.source === "field") return block.fields[binding.name];
    const child = blocks.find(
      candidate => candidate.parent === block && candidate.parentInput === binding.name,
    );
    const value = child?.fields.NUM;
    const numericValue = value === undefined ? undefined : Number(value);
    return numericValue !== undefined && Number.isFinite(numericValue) ? numericValue : undefined;
  };
  const actualPurchases = purchaseBlocks.map(block => {
    const customDefinition = customBlocksByType.get(block.type);
    if (customDefinition?.method === "purchase") {
      const contractType = customBindingValue(block, customDefinition.bindings[0]);
      const prediction = Number(customBindingValue(block, customDefinition.bindings[1]));
      return {
        type: typeof contractType === "string" ? contractType.toUpperCase() : undefined,
        prediction: Number.isFinite(prediction) ? prediction : undefined,
      };
    }
    const numericInputs = blocks
      .filter(child => child.parent === block)
      .map(child => Number(child.fields.NUM))
      .filter(value => Number.isFinite(value));
    return {
      type: block.fields.PURCHASE_LIST?.toUpperCase(),
      prediction: numericInputs[0],
    };
  });
  const missingContract = intent.digitContracts.some(expected =>
    !actualPurchases.some(
      actual =>
        actual.type === expected.type &&
        actual.prediction === expected.prediction,
    ),
  );

  if (missingContract) {
    throw new StrategyValidationError(
      "The strategy is missing a requested digit purchase or uses the wrong prediction barrier.",
    );
  }

  if (intent.digitRules.length > 0) {
    const conditionBlocks = blocks.filter(
      block =>
        block.type === "last_digits_condition" ||
        customBlocksByType.get(block.type)?.method === "checkLastDigitsCondition",
    );
    const actualRules = conditionBlocks.map(block => {
      const customDefinition = customBlocksByType.get(block.type);
      if (customDefinition?.method === "checkLastDigitsCondition") {
        const condition = customBindingValue(block, customDefinition.bindings[0]);
        const count = Number(customBindingValue(block, customDefinition.bindings[1]));
        const threshold = Number(customBindingValue(block, customDefinition.bindings[2]));
        return {
          count: Number.isFinite(count) ? count : undefined,
          condition: typeof condition === "string" ? condition : undefined,
          threshold: Number.isFinite(threshold) ? threshold : undefined,
        };
      }
      const numericInputs = blocks
        .filter(child => child.parent === block)
        .map(child => Number(child.fields.NUM))
        .filter(value => Number.isFinite(value));
      return {
        count: numericInputs[0],
        condition: block.fields.CONDITION,
        threshold: numericInputs[1],
      };
    });

    const missingRule = intent.digitRules.some((expected, index) => {
      const actual = actualRules[index];
      const pairedPurchase = actualPurchases[index];
      const expectedPurchase = intent.digitContracts[index];
      return (
        !actual ||
        actual.count !== expected.count ||
        actual.condition !== expected.condition ||
        actual.threshold !== expected.threshold ||
        (expectedPurchase &&
          (pairedPurchase?.type !== expectedPurchase.type ||
            pairedPurchase?.prediction !== expectedPurchase.prediction))
      );
    });
    if (missingRule) {
      throw new StrategyValidationError(
        "The digit conditions must match each requested digit count, comparison, and threshold.",
      );
    }
  }
}

export function validateDigitRuleSupport(xml: string): void {
  const unsupported = parseBlocklyBlocks(xml).some(
    block =>
      block.type === "last_digits_condition" &&
      !["ALL_ODD", "ALL_EVEN", "LESS_THAN", "LESS_OR_EQUAL", "GREATER_THAN", "GREATER_OR_EQUAL"].includes(
        block.fields.CONDITION || "",
      ),
  );

  if (unsupported) {
    throw new StrategyValidationError("The strategy uses an unsupported last-digits condition.");
  }
}
