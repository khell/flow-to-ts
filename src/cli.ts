import commander from "commander";
import fs from "fs";
import fsReadDirRecursive from "fs-readdir-recursive";
import path from "path";
import { ParserOptions } from "prettier";
import ProgressBar from "progress";
import colors from "colors/safe";

import convert from "./convert";
const version = require("../package.json").version; // So that TS doesn't copy this over to dist on build

type LoggerFunction = (message: string) => void;
export type CliOptions = {
  inlineUtilityTypes: boolean;
  prettier: boolean;
  semi: boolean;
  singleQuote: boolean;
  tabWidth: 2 | 4;
  trailingComma: ParserOptions["trailingComma"];
  bracketSpacing: boolean;
  arrowParens: ParserOptions["arrowParens"];
  printWidth: number;
  inputPattern: string;
  outputExtension: string;
  logLevel: "info" | "warn" | "error";
  logger?: {
    log: LoggerFunction;
    warn: LoggerFunction;
    error: LoggerFunction;
  };
};

const noop = () => {};

const cli = (argv: string[]) => {
  const program = new commander.Command();
  program
    .version(version)
    .option("--inline-utility-types", "inline utility types when possible")
    .option(
      "--prettier [config]",
      "use prettier for formatting with optional path to config file"
    )
    .option(
      "--semi",
      "add semi-colons, defaults to 'false' (depends on --prettier)"
    )
    .option(
      "--single-quote",
      "use single quotes instead of double quotes, defaults to 'false' (depends on --prettier)"
    )
    .option(
      "--tab-width [width]",
      "size of tabs (depends on --prettier)",
      /2|4/,
      4
    )
    .option(
      "--trailing-comma [all|es5|none]",
      "where to put trailing commas (depends on --prettier)",
      /all|es5|none/,
      "all"
    )
    .option(
      "--bracket-spacing",
      "put spaces between braces and contents (depends on --prettier)"
    )
    .option(
      "--arrow-parens [avoid|always]",
      "arrow function param list parens (depends on --prettier)",
      /avoid|always/,
      "avoid"
    )
    .option("--print-width [width]", "line width (depends on --prettier)", 80)
    .option("--write", "write output to disk instead of STDOUT")
    .option(
      "--write-path [path]",
      "optional path to write to (depends on --write)"
    )
    .option("--delete-source", "delete the source file")
    .option(
      "--output-extension [extension]",
      "output file extension. If not supplied, it will output .ts or .tsx depending on whether JSX is present in source file."
    )
    .option(
      "--input-pattern [pattern]",
      "search input regexp for filename matching (default: /.js$/)",
      ".js$"
    )
    .option(
      "--log-level [info|warn|error]",
      "The level of logging to output to stdout (default: error).",
      /info|warn|error/,
      "error"
    );
  program.parse(argv);

  // Validate options
  let inputPattern: RegExp;
  try {
    inputPattern = new RegExp(program.inputPattern);
  } catch (error) {
    console.error("--input-pattern regular expression is invalid.");
    program.outputHelp();
    process.exit(1);
    return;
  }

  // Check write directory validity
  let isValidWriteDirectory = true;
  try {
    if (typeof program.write === "string") {
      const stat = fs.statSync(program.write);
      isValidWriteDirectory = stat.isDirectory();
    }
  } catch (error) {
    isValidWriteDirectory = false;
  }

  // Check file or dir exists or exit
  const fileOrDir = program.args[program.args.length - 1];
  if (
    program.args.length === 0 ||
    !fs.existsSync(fileOrDir) ||
    !isValidWriteDirectory
  ) {
    program.outputHelp();
    process.exit(1);
    return;
  }

  // Build file list
  let files = [fileOrDir];
  const stat = fs.statSync(fileOrDir);
  if (stat.isDirectory()) {
    files = fsReadDirRecursive(fileOrDir)
      .filter(f => path.basename(f).match(inputPattern))
      .map(f => path.join(fileOrDir, f));
  }

  // Setup logging
  const progressBar = new ProgressBar(
    "transpiling [:bar] :current/:total, current file: :file",
    {
      total: files.length,
      width: 30,
      complete: colors.green("#"),
      incomplete: " "
    }
  );

  // Build options
  const options: CliOptions = {
    inlineUtilityTypes: Boolean(program.inlineUtilityTypes),
    prettier: program.prettier,
    semi: Boolean(program.semi),
    singleQuote: Boolean(program.singleQuote),
    tabWidth: parseInt(program.tabWidth, 10) === 2 ? 2 : 4,
    trailingComma: program.trailingComma,
    bracketSpacing: Boolean(program.bracketSpacing),
    arrowParens: program.arrowParens,
    printWidth: program.printWidth,
    inputPattern: program.inputPattern,
    outputExtension: program.outputExtension,
    logLevel: program.logLevel
  };

  // Begin conversion
  let errorCount = 0;
  for (const file of files) {
    progressBar.tick(0, { file }); // Don't actually tick, just update current file

    const logger: CliOptions["logger"] = {
      log:
        options.logLevel === "error" || options.logLevel === "warn"
          ? noop
          : message =>
              progressBar.interrupt(`${colors.green(file)}\n${message}\n`),
      warn:
        options.logLevel === "error"
          ? noop
          : message =>
              progressBar.interrupt(
                colors.yellow(
                  `Warning processing ${colors.green(file)}\n${message}\n`
                )
              ),
      error: message =>
        progressBar.interrupt(
          colors.red(`Error processing ${colors.green(file)}\n${message}\n`)
        )
    };

    const inCode = fs.readFileSync(file, "utf-8");
    try {
      const { state, code: outCode } = convert(inCode, {
        ...options,
        logger
      });

      const outputExtension =
        program.outputExtension || state.containsJSX ? ".tsx" : ".ts";

      if (program.write) {
        const outPath =
          typeof program.writePath === "string"
            ? program.writePath
            : path.dirname(file);
        const outFile = path.basename(file).replace(/\.js$/, outputExtension);
        fs.writeFileSync(path.join(outPath, outFile), outCode);
      } else if (options.logLevel === "info") {
        logger.log(outCode);
      } else {
        process.stdout.write(`${colors.green(file)}\n${outCode}\n`);
      }

      if (program.deleteSource) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      logger.error(`${e}`);
      errorCount++;
    }

    progressBar.tick();
  }

  // No newline is output if only one file by ProgressBar so log a newline
  if (files.length === 1) {
    console.log("");
  }
  console.log(
    errorCount > 0
      ? `Completed with ${errorCount} errors 😱.`
      : "Completed transpilation 🚀."
  );
};

export default cli;
