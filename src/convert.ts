import { parse, ParserOptions } from "@babel/parser";
import traverse from "@babel/traverse";
import generate, { GeneratorOptions } from "@babel/generator";
import { File } from "@babel/types";
import prettier, { Options as PrettierOptions } from "prettier";
import prettierTSPlugin from "prettier/parser-typescript";

import { CliOptions } from "./cli";
import transform, { VisitorState } from "./transform";

const parseOptions: ParserOptions = {
  sourceType: "module",
  plugins: [
    // enable jsx and flow syntax
    "jsx",
    "flow",

    // handle esnext syntax
    "classProperties",
    "objectRestSpread",
    "dynamicImport",
    ["decorators", { decoratorsBeforeExport: true }]
  ]
};

const generatorOptions: GeneratorOptions = {
  decoratorsBeforeExport: true
};

const convert = (flowCode: string, options?: CliOptions) => {
  const ast = parse(flowCode, parseOptions);

  const comments: { [key: string]: File["comments"] } = {
    startLine: {},
    endLine: {}
  };
  for (const comment of ast.comments) {
    comments.startLine[comment.loc.start.line] = comment;
    comments.endLine[comment.loc.end.line] = comment;
  }

  // apply our transforms, traverse mutates the ast
  const state: VisitorState = {
    usedUtilityTypes: new Set(),
    options: { inlineUtilityTypes: false, ...options },
    comments,
    containsJSX: false,
    trailingLines: 0
  };
  traverse<VisitorState>(ast, transform, undefined, state);

  // we pass flowCode so that generate can compute source maps
  // if we ever decide to
  let tsCode = generate(ast, generatorOptions, flowCode).code;
  for (let i = 0; i < state.trailingLines; i++) {
    tsCode += "\n";
  }

  if (options && options.prettier) {
    const prettierUserConfig =
      typeof options.prettier !== "boolean"
        ? prettier.resolveConfig.sync("", { config: options.prettier })
        : {};

    const prettierOptions: PrettierOptions = {
      parser: "typescript",
      plugins: [prettierTSPlugin],
      semi: options.semi,
      singleQuote: options.singleQuote,
      tabWidth: options.tabWidth,
      trailingComma: options.trailingComma,
      bracketSpacing: options.bracketSpacing,
      arrowParens: options.arrowParens,
      printWidth: options.printWidth,
      ...prettierUserConfig // Config file overrides all
    };

    try {
      return { state, code: prettier.format(tsCode, prettierOptions).trim() };
    } catch (error) {
      console.error(
        "===> prettier-typescript could not understand syntax of this file. Please correct the syntax to a form prettier understands, or enable a plugin.",
        error
      );
    }
  }
  return { state, code: tsCode };
};

export default convert;
