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
};

export class StrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyValidationError";
  }
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
  const tokenPattern =
    /<\/?(?:block|shadow)\b[^>]*>|<field\b[^>]*>[\s\S]*?<\/field>/gi;

  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    if (/^<\/(?:block|shadow)\b/i.test(token)) {
      stack.pop();
      continue;
    }

    if (/^<(?:block|shadow)\b/i.test(token)) {
      const block = {
        type: getAttribute(token, "type") || "",
        fields: {},
        parent: stack[stack.length - 1],
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
  const hasDigitContext = /\b(?:digits?|last\s+(?:\d+|[a-z]+)\s+digits?)\b/.test(text);
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

  const purchaseBlocks = blocks.filter(
    block => block.type === "apollo_purchase2" || block.type === "apollo_purchase",
  );
  const actualPurchases = purchaseBlocks.map(block => {
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
      block => block.type === "last_digits_condition",
    );
    const actualRules = conditionBlocks.map(block => {
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
